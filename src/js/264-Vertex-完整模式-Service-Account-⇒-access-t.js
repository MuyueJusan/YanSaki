        // —— Vertex 完整模式：Service Account ⇒ access token ——
        //
        // 私钥（PKCS#8 PEM）→ WebCrypto 导入 → 签 RS256 JWT → POST token_uri 换 token。
        //
        // ⚠ 全程在**本机浏览器**里：私钥不上传任何地方，只用来本地签名；
        //   换到的 token 缓存在内存（`stAiSaTokens`），不落 localStorage。
        //   access token 有 1 小时有效期，提前 60 秒续一次
        // ⚠ token 缓存键用 client_email —— 换一份 Service Account 立刻就拿新的，
        //   不会串用上一个项目的 token
        let stAiSaTokens = {};

        function stAiSaParse(saJson) {
            let o = null;
            try { o = JSON.parse(String(saJson || '')); } catch (e) { o = null; }
            if (!o || typeof o !== 'object' || Array.isArray(o)) {
                return { ok: false, why: 'Service Account JSON 不是合法 JSON（粘漏了开头的 { 或结尾的 }？）。' };
            }
            if (!o.client_email || !o.private_key) {
                return { ok: false, why: 'JSON 里缺 client_email 或 private_key —— 确认粘的是**密钥文件**本身，不是项目里的别的 JSON。' };
            }
            return {
                ok: true,
                email: String(o.client_email),
                key: String(o.private_key),
                tokenUri: String(o.token_uri || 'https://oauth2.googleapis.com/token'),
                projectId: String(o.project_id || '')
            };
        }

        function stAiB64Url(input) {
            const bytes = (input instanceof Uint8Array) ? input : new Uint8Array(input);
            let s = '';
            for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
            return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        }

        // ⚠ 中文/emoji 要先 UTF-8 编码再 btoa —— 直接 btoa(中文) 抛 InvalidCharacterError
        function stAiB64UrlText(txt) {
            return stAiB64Url(new TextEncoder().encode(String(txt)));
        }

        // PEM（PKCS#8）→ ArrayBuffer
        function stAiPemToBuf(pem) {
            const body = String(pem).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
            const bin = atob(body);
            const buf = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
            return buf;
        }

        // Service Account 的**概览**：给界面显示「存的是哪一份」，也用来判「能不能用」。
        // ⚠ 只回 client_email / project_id —— **绝不把 private_key 往界面送**。
        function stAiSaSummary(saJson) {
            const sa = stAiSaParse(saJson);
            if (!sa.ok) return { ok: false, why: sa.why, email: '', projectId: '', label: '' };
            return {
                ok: true,
                why: '',
                email: sa.email,
                projectId: String(sa.projectId || ''),
                label: sa.email + (sa.projectId ? ' · ' + sa.projectId : '')
            };
        }

        // PEM（PKCS#8）→ CryptoKey。单独抽出来是为了「验证 JSON」能只做到这一步
        // （不换 token、不发任何网络请求）就把私钥的问题报出来。
        // ⚠ 导入结果按 client_email 缓存 —— importKey 不便宜，而每次发消息都要签一次
        let stAiSaKeys = {};

        async function stAiSaKey(sa) {
            if (stAiSaKeys[sa.email]) return stAiSaKeys[sa.email];
            if (!(typeof crypto !== 'undefined' && crypto.subtle)) {
                throw new Error('这个环境没有 WebCrypto（或不是安全上下文），完整模式签不了 JWT。' +
                    '换「快速模式」，或用 https 打开本页。');
            }
            let key;
            try {
                key = await crypto.subtle.importKey('pkcs8', stAiPemToBuf(sa.key),
                    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
            } catch (e) {
                throw new Error('私钥读不出来（private_key 不是 PKCS#8 PEM？）：' + ((e && e.message) || e));
            }
            stAiSaKeys[sa.email] = key;
            return key;
        }

        // 签一个 RS256 的 JWT。claims 与酒馆 `generateJWTToken()` 逐字段一致：
        //   iss = client_email · scope = cloud-platform · aud = token 端点 · iat / exp(1h)
        // ⚠ `aud` 必须**等于**真正去换 token 的那个地址（用 sa.tokenUri 而不是写死），
        //   否则服务端会以 `invalid_grant: audience mismatch` 拒收
        async function stAiSaJwt(sa, now) {
            const key = await stAiSaKey(sa);
            const signingInput = stAiB64UrlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' +
                stAiB64UrlText(JSON.stringify({
                    iss: sa.email,
                    scope: 'https://www.googleapis.com/auth/cloud-platform',
                    aud: sa.tokenUri,
                    iat: now,
                    exp: now + 3600
                }));
            const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key,
                new TextEncoder().encode(signingInput));
            return signingInput + '.' + stAiB64Url(sig);
        }

        // ⚠ 「发不出去」和「发出去被拒」要分开说 —— 完整模式最容易卡在**前者**：
        //   浏览器直连 oauth2.googleapis.com 要是被 CORS 挡住，`fetch` 抛的是
        //   `TypeError: Failed to fetch`，跟「Key 不对」长得完全不一样。
        function stAiIsFetchBlocked(e) {
            const m = (e && e.message) ? String(e.message) : String(e);
            return (e instanceof TypeError) ||
                /Failed to fetch|NetworkError|Load failed|CORS|ERR_/i.test(m);
        }

        async function stAiSaAccessToken(saJson, force) {
            const sa = stAiSaParse(saJson);
            if (!sa.ok) throw new Error(sa.why);
            const now = Math.floor(Date.now() / 1000);
            const hit = stAiSaTokens[sa.email];
            if (!force && hit && hit.exp - 60 > now) return hit.token;
            const jwt = await stAiSaJwt(sa, now);

            let resp;
            try {
                resp = await fetch(sa.tokenUri, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') +
                        '&assertion=' + encodeURIComponent(jwt)
                });
            } catch (e) {
                if (stAiIsFetchBlocked(e)) {
                    throw new Error('换 access token 的请求**发不出去**（' + ((e && e.message) || e) + '）—— ' +
                        '这一步要浏览器直连 ' + sa.tokenUri + '，被 CORS / 网络挡了。' +
                        '完整模式依赖浏览器直连 Google，被挡就只能用「快速模式」。');
                }
                throw e;
            }
            if (!resp.ok) {
                let t = '';
                try { t = (await resp.text()).slice(0, 300); } catch (e) {}
                throw new Error('换 access token 失败 HTTP ' + resp.status + (t ? ' ' + t : ''));
            }
            const data = await resp.json();
            if (!data || !data.access_token) throw new Error('token 响应里没有 access_token');
            const exp = now + Math.max(60, Number(data.expires_in) || 3600);
            stAiSaTokens[sa.email] = { token: String(data.access_token), exp: exp };
            return stAiSaTokens[sa.email].token;
        }

        // gemini 的鉴权头。**可能是异步的**（完整模式要现换 token），所以单开一条 ——
        // 塞进同步的 stAiRequest 只会得到 `[object Promise]` 当 header 值
        async function stAiGeminiAuthHeaders(cfg) {
            if (stAiIsVertex(cfg) && (cfg.authMode === 'sa')) {
                const token = await stAiSaAccessToken(cfg.saJson);
                return { 'Authorization': 'Bearer ' + token };
            }
            // API Key 统一走 x-goog-api-key（Google 各 API 通用，官方 SDK 也用它）
            return { 'x-goog-api-key': String(cfg.apiKey || '') };
        }

        // cfg 可能是「半成品」—— 全局面板 apigGather() 给的对象里**没有 proto**
        // （它只装用户填的那些字段，协议是推导出来的）。少了这一步，gemini / vertex
        // 会被当成 openai 发出去：拿 Bearer 去打 Google、URL 里也不带模型名。
        // ⇒ 一律在这里补，别指望每个调用方都记得填
        function stAiEnsureProto(cfg) {
            if (cfg && !cfg.proto) cfg.proto = stAiProtoOf(cfg.provider, cfg.baseUrl);
            return cfg;
        }

        // 「发去哪、带什么头」两种协议只差这一处 —— stAiRequest 与 stCodeRequest
        // 共用它。协议细节散成两份的那天，一定会出现「改了 A 忘了 B」
        // ⚠ 只管 openai / anthropic。gemini 的 URL 里**要拼模型名**、头还可能异步，
        //   形状对不上，所以它走 stAiGemini* 那一组（见上）
        function stAiEndpoint(cfg, path) {
            const proto = cfg.proto === 'anthropic' ? 'anthropic' : 'openai';
            const headers = { 'Content-Type': 'application/json' };
            if (proto === 'anthropic') {
                headers['x-api-key'] = cfg.apiKey;
                headers['anthropic-version'] = '2023-06-01';
                // 浏览器直连 Anthropic 必须显式开这个头，否则预检直接挂
                headers['anthropic-dangerous-direct-browser-access'] = 'true';
            } else {
                headers['Authorization'] = 'Bearer ' + cfg.apiKey;
            }
            return { proto: proto, url: stAiJoin(cfg.baseUrl, path), headers: headers };
        }

        // 请求长什么样，单独抽出来 —— 验证套件要能直接断言 URL / 头 / 体
        // ⚠ 保持**同步**：套件里是 `stAiRequest(...)` 直接取返回值的，改成 async
        //   会静默变成 Promise（断言全拿到 undefined）。所以 gemini 完整模式的
        //   access token 不在这里拿 —— 这里只留一个 `needsToken` 标记，
        //   由调用方（stAiChat / 列模型 / 测试连接）await 之后合并进 headers
        function stAiRequest(cfg, messages, opts) {
            stAiEnsureProto(cfg);
            const o = opts || {};
            const stream = !!o.stream;
            const maxTokens = Math.trunc(stAiNum(o.maxTokens, cfg.maxTokens, 64, 32000));
            const temperature = stAiNum(o.temperature, cfg.temperature, 0, 2);
            if (cfg.proto === 'gemini') {
                const headers = { 'Content-Type': 'application/json' };
                const needsToken = stAiIsVertex(cfg) && (cfg.authMode === 'sa');
                if (!needsToken) headers['x-goog-api-key'] = String(cfg.apiKey || '');
                return {
                    proto: 'gemini',
                    url: stAiGeminiUrl(cfg, cfg.model, stream),
                    headers: headers,
                    needsToken: needsToken,
                    body: stAiGeminiBody(cfg, messages, {
                        stream: stream, temperature: temperature, maxTokens: maxTokens
                    })
                };
            }
            if (cfg.proto === 'anthropic') {
                const ep = stAiEndpoint(cfg, '/messages');
                const sp = stAiSplitSystem(messages);
                const body = {
                    model: cfg.model,
                    max_tokens: maxTokens,
                    temperature: temperature,
                    messages: sp.messages
                };
                if (sp.system) body.system = sp.system;
                if (stream) body.stream = true;
                return { proto: ep.proto, url: ep.url, headers: ep.headers, body: body };
            }
            const ep = stAiEndpoint(cfg, '/chat/completions');
            const body = {
                model: cfg.model,
                messages: messages,
                stream: stream,
                temperature: temperature
            };
            if (maxTokens > 0) body.max_tokens = maxTokens;
            // ⚠ 流式时 OpenAI 系**默认不返回用量**，要显式点名才在最后一个 chunk 里带
            //   `usage`。不加这一条，流式下永远只能给估算值。
            //   ⚠ 但少数自建反代会因为「不认识这个字段」直接 400 —— 所以发送那一层
            //   有一份「400 就退回不带它再试一次」的兜底（见 stAiPostChat）
            if (stream) body.stream_options = { include_usage: true };
            return { proto: ep.proto, url: ep.url, headers: ep.headers, body: body };
        }

        // 把「完整模式才要的那个 Bearer」补进 plan.headers。
        // ⚠ 单独一个函数是为了让 stAiChat / 列模型 / 测试连接三处**走同一条**补头逻辑，
        //   各写一遍迟早会漏掉其中一处
        async function stAiPlanAuth(plan, cfg) {
            if (!plan || !plan.needsToken) return plan;
            const extra = await stAiGeminiAuthHeaders(cfg);
            plan.headers = Object.assign({}, plan.headers, extra);
            return plan;
        }

        // Gemini 的取文：candidates[0].content.parts[].text。
        // 流式与非流式**形状完全一样**（流式每行就是一个完整的 GenerateContentResponse），
        // 所以两种取法共用一个函数 —— 分开写就会出现「流式好了非流式没改」
        // ⚠ parts 里除了 text 还可能是 thought / functionCall 等，只挑有 text 的
        function stAiGeminiText(data) {
            if (!data || typeof data !== 'object') return '';
            const cands = Array.isArray(data.candidates) ? data.candidates : [];
            if (!cands.length) return '';
            const parts = (cands[0] && cands[0].content && Array.isArray(cands[0].content.parts))
                ? cands[0].content.parts : [];
            return parts.filter(p => p && typeof p.text === 'string')
                .map(p => String(p.text)).join('');
        }

        // 从一段 SSE 的 JSON 里取增量文本。三种协议的字段名完全不同
        function stAiSseText(proto, json) {
            if (!json || typeof json !== 'object') return '';
            if (proto === 'gemini') return stAiGeminiText(json);
            if (proto === 'anthropic') {
                if (json.type === 'content_block_delta' && json.delta &&
                    typeof json.delta.text === 'string') return json.delta.text;
                return '';
            }
            const ch = json.choices && json.choices[0];
            if (!ch) return '';
            if (ch.delta && typeof ch.delta.content === 'string') return ch.delta.content;
            return '';
        }

        // 非流式响应里取正文
        function stAiFullText(proto, data) {
            if (!data || typeof data !== 'object') return '';
            if (proto === 'gemini') return stAiGeminiText(data);
            if (proto === 'anthropic') {
                const parts = Array.isArray(data.content) ? data.content : [];
                return parts.filter(p => p && p.type === 'text')
                    .map(p => String(p.text || '')).join('');
            }
            const ch = data.choices && data.choices[0];
            if (!ch) return '';
            if (ch.message && typeof ch.message.content === 'string') return ch.message.content;
            return '';
        }

        // ===== 用量（tokens）=====
        // 三种协议把「发了多少 / 回了多少」放在完全不同的地方，收在一处 ——
        // 每个板块各取一份的话，加一种协议就要改 N 处（六之五十一）。
        //
        // ⚠ 为什么要有 stAiUsageMerge：**Anthropic 的流式把用量拆成两条事件** ——
        //   `message_start` 只带 input_tokens，`message_delta` 只带 output_tokens。
        //   让后一条**覆盖**前一条的话 input 就变成 0 了（看着像「什么都没发」）。
        //   逐字段取 max 对三家都对：gemini / openai 每个 chunk 带的是**累计值**，
        //   后面只会更大；anthropic 的两个字段各在各的事件里，另一个是 0。
        let stAiUsageLast = null;

        function stAiUsageOf(proto, data) {
            if (!data || typeof data !== 'object') return null;
            if (proto === 'gemini') {
                const m = data.usageMetadata;
                if (!m) return null;
                const i = Number(m.promptTokenCount) || 0;
                const o = Number(m.candidatesTokenCount) || 0;
                if (!i && !o) return null;
                return { in: i, out: o, total: Number(m.totalTokenCount) || (i + o) };
            }
            if (proto === 'anthropic') {
                const u = data.usage || (data.message && data.message.usage) || null;
                if (!u) return null;
                const i = Number(u.input_tokens) || 0;
                const o = Number(u.output_tokens) || 0;
                if (!i && !o) return null;
                return { in: i, out: o, total: i + o };
            }
            const u = data.usage;
            if (!u) return null;
            const i = Number(u.prompt_tokens) || 0;
            const o = Number(u.completion_tokens) || 0;
            if (!i && !o) return null;
            return { in: i, out: o, total: Number(u.total_tokens) || (i + o) };
        }

        function stAiUsageMerge(a, b) {
            if (!b) return a || null;
            if (!a) return { in: b.in, out: b.out, total: b.total, estimated: !!b.estimated };
            return {
                in: Math.max(a.in, b.in),
                out: Math.max(a.out, b.out),
                total: Math.max(a.total, b.total),
                estimated: !!(a.estimated || b.estimated)
            };
        }

        function stAiUsageReset() { stAiUsageLast = null; }

        function stAiUsageNote(proto, data) {
            const u = stAiUsageOf(proto, data);
            if (u) stAiUsageLast = stAiUsageMerge(stAiUsageLast, u);
            return u;
        }

        function stAiUsage() { return stAiUsageLast; }

        // 一份可以安全塞进会话 / 消息 / dataset 的副本。
        // ⚠ 别把 stAiUsage() 的返回值直接存起来：它跟「当前这一轮」是同一个对象，
        //   下一轮一合并，历史里那条的用量会跟着一起变（而且 JSON 里会带多余字段）
        function stAiUsageSnapshot(u) {
            const x = u || stAiUsageLast;
            if (!x) return null;
            return {
                in: Number(x.in) || 0,
                out: Number(x.out) || 0,
                total: Number(x.total) || 0,
                estimated: !!x.estimated
            };
        }

        function stAiMsgsText(messages) {
            return (Array.isArray(messages) ? messages : [])
                .map(m => (m && typeof m.content === 'string') ? m.content : '')
                .join('\n');
        }

        // 服务商没给用量时的兜底：按字数估。
        // ⚠ **必须标出来是估算**（界面上加 `≈`）—— 不标的话「1 234」和「≈1 234」
        //   长得一样，用户会把它当成账单（六之二十七：回落必须说出来）
        function stAiUsageEstimate(promptText, replyText) {
            const i = estimateTokens(promptText);
            const o = estimateTokens(replyText);
            return { in: i, out: o, total: i + o, estimated: true };
        }

        // 真的一家都没给用量时才兜底估算。三个调用方（stAiChat / streamChat /
        // nonStreamChat）共用这一份 —— 各写一遍就会出现「有一处忘了标 estimated」
        function stAiUsageEnsureEstimate(promptText, replyText) {
            if (!stAiUsageLast) stAiUsageLast = stAiUsageEstimate(promptText, replyText);
            return stAiUsageLast;
        }

        function stAiNumText(n) {
            const v = Math.max(0, Math.round(Number(n) || 0));
            return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
        }

        // 「发送 / 应答」分开写。**全站只有这一处决定长什么样** ——
        // 各板块各写一份的话，早晚出现「这里写 tok、那里写 tokens」
        function stAiUsageText(u, short) {
            if (!u) return '';
            const eq = u.estimated ? '≈' : '';
            if (short) return '↑' + eq + stAiNumText(u.in) + ' · ↓' + eq + stAiNumText(u.out);
            return '发送 ' + eq + stAiNumText(u.in) + ' / 应答 ' + eq + stAiNumText(u.out) + ' tokens';
        }

        // 拼在状态行后面用。没有用量就返回空串，调用方不用自己判
        function stAiUsageSuffix(u) {
            const t = stAiUsageText(u || stAiUsageLast, false);
            return t ? (' · ' + t) : '';
        }

        // 「一句提示 + 用量」。msg 为空时不留开头那个分隔符 ——
        // 不然状态行会变成「 · 发送 1 234 / 应答 567 tokens」（开头一个孤零零的点）
        function stAiUsageWith(msg) {
            const t = stAiUsageText(stAiUsageLast, false);
            const m = String(msg == null ? '' : msg);
            if (!m) return t;
            return t ? (m + ' · ' + t) : m;
        }

        // 发一次对话请求。**只有这里发** ——
        // ⚠ 原先 stAiChat 和【ai对话】的 streamChat 各写了一份 fetch，而
        //   「400 就退回不带 stream_options」这个兜底只能加在一处，否则踩过的那条
        //   修了、另一条没修（六之五十一：一份逻辑 N 份实现 ⇒ 逐份点名）。
        async function stAiPostChat(plan, opts) {
            const o = opts || {};
            const send = p => fetch(p.url, {
                method: 'POST',
                headers: p.headers,
                body: JSON.stringify(p.body),
                ...(o.signal ? { signal: o.signal } : {})
            });
            let resp = await send(plan);
            if (resp.status === 400 && plan.body && plan.body.stream_options) {
                // 这个服务商不认识 stream_options ⇒ 丢掉它重发一次。
                // 代价是一次多余的往返，换来的是「不为了要一个用量把聊天搞挂」
                try { await resp.text(); } catch (e) {}
                const body2 = Object.assign({}, plan.body);
                delete body2.stream_options;
                plan.usageDropped = true;
                resp = await send(Object.assign({}, plan, { body: body2 }));
            }
            return resp;
        }

        // 模型列表的形状：OpenAI 系给 {data:[{id}]}，Anthropic 给 {data:[{id,display_name}]}，
        // 少数反代直接给数组或 {models:[{name}]}。三种都兜住
        // 从各种「列模型」响应里把模型 id 抠出来。
        // 认的形状（都是实测/文档见过的）：
        //   · OpenAI 系      `{ data: [{ id }] }`
        //   · 裸数组          `[{ id | name | model }]`
        //   · `{ models: [] }`（Anthropic 风格）
        //   · Vertex         `{ publisherModels: [{ name: 'publishers/google/models/x' }] }`
        //     ⚠⚠ 这一支是**后补的**：`projects.locations.publishers.models` 那条资源
        //        根本没有 `list` 方法（官方 REST 目录里只有 computeTokens / countTokens /
        //        embedContent / generateContent / predict / rawPredict / stream*），
        //        能列的是 **v1beta1 的 `publishers.models`**，而它回的字段就叫
        //        `publisherModels`。少了这一支，就算 URL 蒙对了也照样得到空列表 ⇒
        //        报「这个接口没返回任何模型」，看着像「这个 Key 没有权限」。
        function stAiModelIds(data) {
            const out = [];
            const push = v => {
                const s = String(v == null ? '' : v).trim()
                    .replace(/^models\//, '')
                    .replace(/^publishers\/google\/models\//, '');
                if (s) out.push(s);
            };
            if (Array.isArray(data)) {
                data.forEach(m => push(m && (m.id || m.name || m.model)));
            } else if (data && Array.isArray(data.data)) {
                data.data.forEach(m => push(m && (m.id || m.name || m.model)));
            } else if (data && Array.isArray(data.models)) {
                data.models.forEach(m => push(m && (m.name || m.id || m.model)));
            } else if (data && Array.isArray(data.publisherModels)) {
                data.publisherModels.forEach(m => push(m && (m.name || m.id)));
            }
            const uniq = [];
            out.forEach(s => { if (uniq.indexOf(s) < 0) uniq.push(s); });
            return uniq.sort();
        }

        // 打一次「列模型」的 GET。失败一律 throw（原因写成人话）——
        // 「要不要再试别的路径 / 退回内置候选」是调用方的决定，这里不管
        async function stAiFetchModelsOnce(url, headers) {
            let resp;
            try {
                resp = await fetch(url, { headers: headers });
            } catch (e) {
                // ⚠ 「连不出去」和「服务端拒绝」是两件事，文案要分开 ——
                //   否则用户会去改 Key，而真正的问题是 CORS
                if (stAiIsFetchBlocked(e)) {
                    throw new Error('请求发不出去（' + ((e && e.message) || e) + '）—— ' +
                        '要浏览器直连 ' + url.split('/v1')[0] + '，被 CORS / 网络挡了');
                }
                throw e;
            }
            if (!resp.ok) {
                let t = '';
                try { t = (await resp.text()).slice(0, 200); } catch (e) {}
                throw new Error('HTTP ' + resp.status + (t ? ' ' + t : ''));
            }
            const data = await resp.json();
            const ids = stAiModelIds(data);
            if (!ids.length) throw new Error('返回里没有模型（字段名对不上？）');
            return ids;
        }

        async function stAiFetchModels(cfg) {
            const c = stAiEnsureProto(cfg || stAiCfg());
            if (c.proto === 'gemini') {
                // Google：候选路径**逐条试**（v1 那条资源没有 list，见 stAiGeminiModelsUrls）。
                // 鉴权头跟对话请求同一套（完整模式会先换 access token）
                const headers = Object.assign({}, await stAiGeminiAuthHeaders(c));
                const urls = stAiGeminiModelsUrls(c);
                const errs = [];
                for (let i = 0; i < urls.length; i++) {
                    try {
                        return await stAiFetchModelsOnce(urls[i], headers);
                    } catch (e) {
                        const msg = (e && e.message) || String(e);
                        errs.push(msg);
                        // ⚠ 「发不出去」（CORS / 网络）对同一台 host 的**每条路径**都一样，
                        //   再试只是白等，还会把真正的原因埋到最后一串里 ⇒ 直接抛
                        if (msg.indexOf('发不出去') >= 0) throw new Error('列模型失败：' + msg);
                    }
                }
                // 全试完了：**把「试过哪几条、各报什么」都带上**。
                // 只丢一句「列模型失败」，用户完全不知道该去改什么 —— 这一轮用户报的
                // 就是这个症状（「我已经开放代理，却还是显示列模型失败」）。
                throw new Error('列模型失败（' + urls.length + ' 条路径都不行）：' +
                    urls.map((u, i) => u.replace(/^https:\/\//, '') + ' → ' + (errs[i] || '?')).join('；'));
            }
            const proto = c.proto === 'anthropic' ? 'anthropic' : 'openai';
            const headers = proto === 'anthropic'
                ? { 'x-api-key': c.apiKey, 'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true' }
                : { 'Authorization': 'Bearer ' + c.apiKey };
            return await stAiFetchModelsOnce(stAiJoin(c.baseUrl, '/models'), headers);
        }

        // 发一次对话。messages 里可以带 system，两种协议各自安排位置。
        // opts: { cfg, stream, temperature, maxTokens, onDelta, timeout }
        async function stAiChat(messages, opts) {
            const o = opts || {};
            const cfg = o.cfg || stAiCfg();
            const plan = stAiRequest(cfg, messages, {
                stream: o.stream !== undefined ? o.stream : cfg.stream,
                temperature: o.temperature,
                maxTokens: o.maxTokens
            });
            // 每次调用从零开始记 —— 不重置的话「这一轮没拿到用量」会显示成上一轮的数字
            stAiUsageReset();
            // ⚠ 换 token 要在**起计时器之前**：完整模式第一次要签 JWT + 一次网络往返，
            //   算进请求超时里会让「慢」看起来像「服务商不响应」
            try {
                await stAiPlanAuth(plan, cfg);
            } catch (e) {
                throw new Error(stAiErrText(e));
            }

            const ctl = (typeof AbortController === 'function') ? new AbortController() : null;
            const ms = Math.max(1000, Number(o.timeout) || 180000);
            let timer = null;
            if (ctl) timer = setTimeout(() => { try { ctl.abort(); } catch (e) {} }, ms);

            let resp;
            try {
                resp = await stAiPostChat(plan, { signal: ctl ? ctl.signal : null });
            } catch (e) {
                if (timer) clearTimeout(timer);
                throw new Error(stAiErrText(e));
            }
            if (!resp.ok) {
                if (timer) clearTimeout(timer);
                let t = '';
                try { t = (await resp.text()).slice(0, 300); } catch (e) {}
                throw new Error('HTTP ' + resp.status + (t ? ' ' + t : ''));
            }

            try {
                let full;
                if (plan.body.stream && resp.body && typeof resp.body.getReader === 'function') {
                    // 用量由 stAiStream 在每个 chunk 上累进来
                    full = await stAiStream(resp, plan.proto, o.onDelta);
                } else {
                    const data = await resp.json();
                    stAiUsageNote(plan.proto, data);
                    full = stAiFullText(plan.proto, data);
                    // ⚠ 正文为空时**追问原因**再返回 —— 空串是合法返回值，所以「被拦了」
                    //   和「真的空回复」在调用方看来一模一样（见 stAiWhyEmpty）
                    if (!full) {
                        const why = stAiWhyEmpty(plan.proto, data);
                        if (why) throw new Error(why);
                    }
                    if (o.onDelta) o.onDelta(full);
                }
                // 一家都没给 ⇒ 按字数估，打上 estimated 标记（界面上会显示 `≈`）
                stAiUsageEnsureEstimate(stAiMsgsText(messages), full);
                return full;
            } finally {
                if (timer) clearTimeout(timer);
            }
        }

        async function stAiStream(resp, proto, onDelta) {
            const reader = resp.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '', full = '';
            // ⚠ 留一份**最后一条** JSON：空输出时它的 finishReason 就是唯一线索
            //   （流式下每一行都是一个完整响应，最后那行带着结束原因）
            let last = null;
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                let idx;
                while ((idx = buffer.indexOf('\n')) >= 0) {
                    const line = buffer.slice(0, idx).trim();
                    buffer = buffer.slice(idx + 1);
                    if (!line.startsWith('data:')) continue;
                    const payload = line.slice(5).trim();
                    if (!payload || payload === '[DONE]') continue;
                    let json = null;
                    try { json = JSON.parse(payload); } catch (e) { continue; }
                    last = json;
                    // 用量跟着每个 chunk 累。gemini / openai 带的是**累计值**，
                    // anthropic 拆成 message_start / message_delta 两条 ⇒ 逐字段取 max
                    // （见 stAiUsageMerge，别改成「后一条覆盖前一条」）
                    stAiUsageNote(proto, json);
                    const d = stAiSseText(proto, json);
                    if (d) { full += d; if (onDelta) onDelta(full); }
                }
            }
            // 一个字都没出来的流式响应，同样要问原因（被安全策略拦时服务端就返这样一段）
            if (!full && last) {
                const why = stAiWhyEmpty(proto, last);
                if (why) throw new Error(why);
            }
            return full;
        }

        // 从模型的回复里抠 JSON。模型很爱加 ``` 围栏、加前后寒暄、加尾逗号 ——
        // 三种都得兜住，不然一次生成就白跑了
        function stAiJsonOf(text) {
            const raw = String(text == null ? '' : text);
            const out = { ok: false, value: null, error: '', raw: raw };
            let t = raw.trim();
            if (!t) { out.error = '回复是空的'; return out; }
            // ① 有围栏就说明模型自己划了边界，优先取里面
            const fence = /```(?:json|yaml|javascript|js)?\s*([\s\S]*?)```/i.exec(t);
            if (fence) t = fence[1].trim();
            // ② 尾逗号是模型最常见的语法错误
            const repair = s => s.replace(/,(\s*[}\]])/g, '$1');
            const tryParse = s => {
                try { return { ok: true, v: JSON.parse(s) }; }
                catch (e) { return { ok: false, e: e }; }
            };
            let r = tryParse(t);
            if (!r.ok) r = tryParse(repair(t));
            // ③ 还不行就从第一个 { / [ 切到最后一个 } / ]（前后挂着寒暄）
            if (!r.ok) {
                const cands = [];
                const i1 = t.indexOf('{'), i2 = t.lastIndexOf('}');
                if (i1 >= 0 && i2 > i1) cands.push(t.slice(i1, i2 + 1));
                const j1 = t.indexOf('['), j2 = t.lastIndexOf(']');
                if (j1 >= 0 && j2 > j1) cands.push(t.slice(j1, j2 + 1));
                for (const c of cands) {
                    let rr = tryParse(c);
                    if (!rr.ok) rr = tryParse(repair(c));
                    if (rr.ok) { r = rr; break; }
                }
            }
            if (!r.ok) {
                out.error = (r.e && r.e.message) ? r.e.message : '不是合法 JSON';
                return out;
            }
            out.ok = true;
            out.value = r.v;
            return out;
        }

        // 从抠出来的 JSON 里取出条目数组：可以是裸数组，也可以裹在
        // entries / items / list / data / greetings 里
        function stAiPickArray(v, keys) {
            if (Array.isArray(v)) return v;
            if (!v || typeof v !== 'object') return null;
            const cand = (keys || []).concat(['entries', 'items', 'list', 'data', 'results']);
            for (const k of cand) {
                if (Array.isArray(v[k])) return v[k];
            }
            return null;
        }

        // 关键词：字符串按换行 / 逗号 / 顿号拆，数组直接摊平
        function stAiKeyList(v) {
            let arr = [];
            if (Array.isArray(v)) arr = v;
            else if (typeof v === 'string') arr = v.split(/[\n,，、;；]+/);
            else if (v != null) arr = [v];
            const out = [];
            arr.forEach(k => {
                const s = String(k == null ? '' : k).trim();
                if (s && out.indexOf(s) < 0) out.push(s);
            });
            return out;
        }

        // 把模型给的一个对象整成我们自己的条目结构。认不出来的字段一律退回默认值 ——
        // 宁可少写一个字段，也不能让一条脏数据把世界书页渲染炸掉
        function stAiEntryFromAi(a) {
            if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
            const e = stBlankEntry();
            e.comment = String(a.comment != null ? a.comment
                : (a.name != null ? a.name : (a.title != null ? a.title : ''))).slice(0, 200);
            e.content = String(a.content != null ? a.content
                : (a.text != null ? a.text : (a.body != null ? a.body : '')));
            e.keys = stAiKeyList(a.keys != null ? a.keys : a.key);
            e.secondaryKeys = stAiKeyList(a.secondary_keys != null ? a.secondary_keys
                : (a.secondaryKeys != null ? a.secondaryKeys : a.keysecondary));
            e.constant = a.constant === true;
            const pos = Number(a.position);
            e.position = (Number.isFinite(pos) && pos >= 0 && pos <= 7) ? Math.trunc(pos) : WI_POS.beforeChar;
            const dep = Number(a.depth);
            e.depth = Number.isFinite(dep) ? Math.max(0, Math.min(WI_MAX_INJECTION_DEPTH, Math.trunc(dep))) : WI_DEFAULT_DEPTH;
            const ord = Number(a.order);
            e.order = Number.isFinite(ord) ? Math.max(0, Math.min(999999, Math.trunc(ord))) : WI_DEFAULT_ORDER;
            e.enabled = a.enabled === false ? false : true;
            // 正文和关键词都空的条目没有任何意义，直接丢掉 —— 留着只会在世界书页里
            // 变成一条看不见内容的空壳，用户还得手动删
            if (!e.content.trim() && !e.keys.length && !e.constant) return null;
            return e;
        }

        // 角色卡设定摘要，给模型当素材
        function stAiCardBrief(maxLen) {
            const c = stEditor.card || stBlankCard();
            const n = Math.max(80, Number(maxLen) || 1200);
            const cut = s => {
                const t = String(s == null ? '' : s).trim();
                return t.length > n ? t.slice(0, n) + '…' : t;
            };
            const L = [];
            if (c.name) L.push('角色名：' + c.name);
            if (c.nickname) L.push('昵称：' + c.nickname);
            if (c.description) L.push('角色描述：' + cut(c.description));
            if (c.personality) L.push('性格：' + cut(c.personality));
            if (c.scenario) L.push('场景：' + cut(c.scenario));
            if (c.systemPrompt) L.push('系统提示词：' + cut(c.systemPrompt));
            if (c.creatorNotes) L.push('作者备注：' + cut(c.creatorNotes));
            if (c.firstMes) L.push('现有开场白：' + cut(c.firstMes));
            return L.join('\n');
        }

        // 已有世界书的摘要（扩写时要把它喂给模型，免得写出重复条目）
        function stAiBookBrief(limit) {
            const list = stEditor.card.bookEntries || [];
            const n = Math.max(1, Number(limit) || 60);
            if (!list.length) return '';
            return list.slice(0, n).map((e, i) => {
                const body = String(e.content || '').replace(/\s+/g, ' ').trim();
                return '[' + (i + 1) + '] ' + (e.comment || '（无备注）') +
                    (e.keys.length ? ' | 关键词：' + e.keys.join('、') : '') +
                    ' | ' + (body.length > 160 ? body.slice(0, 160) + '…' : body);
            }).join('\n');
        }

