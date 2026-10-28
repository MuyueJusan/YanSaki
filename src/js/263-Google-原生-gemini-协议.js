        // ==========================================================================
        // Google 原生（gemini）协议
        //
        // 一个协议盖三条路，它们**请求体完全一样**，只有 URL 和鉴权不同：
        //
        //   · AI Studio 原生    https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent
        //   · Vertex 快速模式   https://{loc}-aiplatform.googleapis.com/v1/publishers/google/models/{m}:generateContent
        //   · Vertex 完整模式   https://{loc}-aiplatform.googleapis.com/v1/projects/{proj}/locations/{loc}/publishers/google/models/{m}:generateContent
        //
        // 鉴权：
        //   · AI Studio / Vertex 快速模式 —— API Key，走 `x-goog-api-key` 头
        //   · Vertex 完整模式            —— Service Account 私钥签 JWT 换 access token，走 Bearer
        //
        // ⚠ `location = 'global'` 时**端点不带地区前缀** —— 是 `aiplatform.googleapis.com`
        //   而不是 `global-aiplatform.googleapis.com`。写成后者是 DNS 直接解析失败，
        //   报错信息里根本看不出是「global 这个特例」
        // ⚠ **location 在快速模式下也真的生效**（进 hostname，不是摆设）——
        //   我原来在这里写过「快速模式只能是 global」，那是错的。
        //   参考酒馆 `src/endpoints/google.js`：两种模式都是
        //   `region === 'global' ? 'https://aiplatform.googleapis.com/v1'
        //                        : https://${region}-aiplatform.googleapis.com/v1`
        // ⚠ 快速模式的路径里**默认没有 projects 那一段**（Express 的 Key 自己带项目），
        //   照完整模式的形状拼会 404；但**填了项目就该带上** ——
        //   酒馆就是这么做的（`vertexai_express_project_id` 有值就走 projects 形状）。
        //
        // ⚠⚠ **项目 ID 一律从 Service Account JSON 里取**（`project_id`），
        //   酒馆是 `getProjectIdFromServiceAccount()`，不让用户手填。
        //   我第一版要求手填 ⇒ 不填就拼出 `/v1/projects//locations/...`，
        //   服务端回 404，而报错里看不出是「少了项目」。见 stAiVertexProject()。
        //
        // ⚠⚠ **两个模式都要发 safetySettings，而且阈值是 `OFF`。**
        //   不发的话 Gemini 按默认策略拦，角色扮演内容很容易撞上 ——
        //   表现是 `candidates` **根本不存在**（或 `finishReason: SAFETY`），
        //   前端拿到空串，看着像「AI 没说话」。酒馆的 GEMINI_SAFETY / VERTEX_SAFETY
        //   全是 `threshold: 'OFF'`，Vertex 还多 5 类（含 JAILBREAK 与 IMAGE_*）。
        // ==========================================================================

        // 模型名归一：用户可能从文档里连前缀一起抄过来。带前缀拼进 URL 会 404，
        // 而且报错只说「模型不存在」，看不出是前缀的问题
        function stAiGeminiModel(model) {
            return String(model || '').trim()
                .replace(/^\/+/, '')
                .replace(/^models\//, '')
                .replace(/^google\//, '')
                .replace(/^publishers\/google\/models\//, '');
        }

        // 项目 ID：**用户填了就用用户的，没填就从 Service Account JSON 里取**。
        // 酒馆就是这么做的（`getProjectIdFromServiceAccount()` 直接读 `project_id`），
        // 界面上根本没有让用户手填项目这一格。
        //
        // ⚠ 两处都不给就是空串 ⇒ URL 变成 `/v1/projects//locations/global/...`，
        //   服务端回 404，而报错只说「找不到」，看不出是「少了项目」。
        //   所以 stAiReady() 里还有一道「完整模式必须有项目」的明说闸门。
        function stAiVertexProject(cfg) {
            const typed = String((cfg && cfg.project) || '').trim();
            if (typed) return typed;
            const sa = stAiSaParse((cfg && cfg.saJson) || '');
            return sa.ok ? String(sa.projectId || '').trim() : '';
        }

        // 这家服务商是不是 Vertex（AI Studio 与 Vertex 共用 gemini 协议，靠这个分叉）
        function stAiIsVertex(cfg) {
            const p = AI_PROVIDERS.find(x => x.value === (cfg && cfg.provider)) || {};
            if (p.vertex) return true;
            return /aiplatform|vertex/.test(String((cfg && cfg.baseUrl) || '').toLowerCase());
        }

        // 区域。两种模式都真的用它 —— 进 hostname（`global` 是唯一不带前缀的特例）
        function stAiGeminiLoc(cfg) {
            return String((cfg && cfg.location) || 'global').trim() || 'global';
        }

        function stAiGeminiHost(cfg) {
            if (!stAiIsVertex(cfg)) return 'https://generativelanguage.googleapis.com';
            const loc = stAiGeminiLoc(cfg);
            return loc === 'global'
                ? 'https://aiplatform.googleapis.com'
                : 'https://' + loc + '-aiplatform.googleapis.com';
        }

        function stAiGeminiPath(cfg, model, action) {
            const m = stAiGeminiModel(model);
            if (!stAiIsVertex(cfg)) return '/v1beta/models/' + m + ':' + action;
            const loc = stAiGeminiLoc(cfg);
            const proj = stAiVertexProject(cfg);
            // 有项目就走带 `projects/` 的形状 —— 完整模式**必须**有（没项目服务端只会回 404）；
            // 快速模式填了也认（酒馆的 `vertexai_express_project_id` 就是这个意思）
            if (proj) {
                return '/v1/projects/' + proj + '/locations/' + loc +
                    '/publishers/google/models/' + m + ':' + action;
            }
            // 没项目 = Express 的短路径（Key 自己带项目）
            return '/v1/publishers/google/models/' + m + ':' + action;
        }

        // 流式要用 `alt=sse`，否则服务端返的是**一段一段的 JSON 数组**（不是 SSE），
        // 现有的按行解析会一行都读不出来、表现为「流式永远没输出、最后突然全出来」
        function stAiGeminiUrl(cfg, model, stream) {
            const action = stream ? 'streamGenerateContent' : 'generateContent';
            const q = stream ? '?alt=sse' : '';
            return stAiGeminiHost(cfg) + stAiGeminiPath(cfg, model, action) + q;
        }

        // 列模型的候选路径 —— **按顺序试，谁先给出非空列表就用谁**。
        //
        // ⚠⚠ 为什么是「一串」而不是「一个」：Google 这条 API 的形状改过，而且
        //   **v1 的 `projects.locations.publishers.models` 根本没有 `list` 方法**
        //   （官方 REST 目录里那条资源只有 computeTokens / countTokens / embedContent /
        //     generateContent / predict / rawPredict / stream*），
        //   v1 的 `publishers.models` 也只有 `get`。
        //   真正有 `list` 的是 **v1beta1 的 `publishers.models`**，回的是 `publisherModels`。
        //   ⇒ 与其赌一条，不如两条都试；Express 与完整模式的 host 本来也不同。
        //
        // ⚠ 而且**列不出来不该挡路**：酒馆（SillyTavern）压根没有列模型的路由，
        //   模型名全靠手填。所以调用方拿不到列表时要退回内置候选，而不是把用户堵死。
        function stAiGeminiModelsUrls(cfg) {
            if (!stAiIsVertex(cfg)) return ['https://generativelanguage.googleapis.com/v1beta/models'];
            const host = stAiGeminiHost(cfg);
            const loc = stAiGeminiLoc(cfg);
            const proj = stAiVertexProject(cfg);
            const out = [];
            // ① v1beta1 · publisher models（不需要 project，也是唯一确认有 list 的那条）
            out.push(host + '/v1beta1/publishers/google/models');
            if (proj) {
                // ② v1beta1 · 带 project（有些项目/区域只认这条）
                out.push(host + '/v1beta1/projects/' + proj + '/locations/' + loc +
                    '/publishers/google/models');
                // ③ v1 · 带 project（老形状，留着兜底）
                out.push(host + '/v1/projects/' + proj + '/locations/' + loc +
                    '/publishers/google/models');
            }
            return out;
        }

        // 兼容旧调用：给「第一条候选」（要精确断言全部候选请用 stAiGeminiModelsUrls）
        function stAiGeminiModelsUrl(cfg) {
            return stAiGeminiModelsUrls(cfg)[0];
        }

        // 列不出来时的**内置候选**（不是白名单 —— 模型框本来就能手输任意名字）。
        // 用途：Google 那边列模型经常不可用（没 list 方法 / 账号没该权限 / 形状变了），
        // 这时给用户一个能直接点的起点，而不是只丢一句「失败」。
        const ST_GEMINI_MODEL_HINTS = [
            'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite',
            'gemini-2.0-flash', 'gemini-2.0-flash-lite',
            'gemini-1.5-pro', 'gemini-1.5-flash'
        ];

        // 安全阈值 —— **照抄酒馆**（`src/constants.js` 的 GEMINI_SAFETY / VERTEX_SAFETY）。
        //
        // ⚠⚠ 不发这个字段时 Gemini 按**默认策略**拦，角色扮演内容很容易撞上，
        //   而表现是 `candidates` **根本不存在**（或 `finishReason: 'SAFETY'`）——
        //   前端拿到空串，看着像「AI 没说话」。第一版我一个都没发。
        // ⚠ Vertex 比 AI Studio **多 5 类**（含 JAILBREAK 与 IMAGE_*），所以分开两份。
        // ⚠ 阈值全是 `OFF`（酒馆就是这么写的）。⚠ 个别新模型会拒收某些类别的 OFF，
        //   那时服务端会回 400 并点名是哪个 category —— 报错要原样带出来，别吞。
        const ST_GEMINI_SAFETY = [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'OFF' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'OFF' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'OFF' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'OFF' },
            { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'OFF' }
        ];

        const ST_VERTEX_SAFETY = [
            { category: 'HARM_CATEGORY_IMAGE_HATE', threshold: 'OFF' },
            { category: 'HARM_CATEGORY_IMAGE_DANGEROUS_CONTENT', threshold: 'OFF' },
            { category: 'HARM_CATEGORY_IMAGE_HARASSMENT', threshold: 'OFF' },
            { category: 'HARM_CATEGORY_IMAGE_SEXUALLY_EXPLICIT', threshold: 'OFF' },
            { category: 'HARM_CATEGORY_JAILBREAK', threshold: 'OFF' }
        ];

        function stAiGeminiSafety(cfg) {
            return ST_GEMINI_SAFETY.concat(stAiIsVertex(cfg) ? ST_VERTEX_SAFETY : []);
        }

        // 为什么「一个字都没有」？把服务端给的**原因**翻出来。
        //
        // ⚠ 空响应有三种完全不同的成因，前端一律返回空串就是**把失败伪装成成功**
        //   （RULES 六之二十七）：① 提示词被拦（`promptFeedback.blockReason`，
        //   这时**没有 candidates**）；② 生成被中断（`finishReason` 是 SAFETY /
        //   RECITATION / MAX_TOKENS / OTHER，不是 STOP）；③ 真的是空回复。
        function stAiGeminiWhy(data) {
            if (!data || typeof data !== 'object') return '';
            const fb = data.promptFeedback;
            if (fb && fb.blockReason) {
                return '提示词被 Google 的安全策略拦下了（promptFeedback.blockReason = ' + fb.blockReason + '）';
            }
            const cands = Array.isArray(data.candidates) ? data.candidates : [];
            if (!cands.length) return '响应里没有 candidates（多半也是被安全策略拦了）';
            const fr = cands[0] && cands[0].finishReason;
            if (fr && fr !== 'STOP') {
                if (fr === 'MAX_TOKENS') return '生成被 maxOutputTokens 截断了（finishReason = MAX_TOKENS）';
                return '生成被中断（finishReason = ' + fr + '）';
            }
            return '';
        }

        // 空响应的原因，按协议分派 —— 三种协议的字段名又不一样：
        //   · gemini    —— promptFeedback.blockReason / candidates[0].finishReason
        //   · anthropic —— stop_reason（max_tokens / refusal）
        //   · openai    —— choices[0].finish_reason（content_filter / length）
        //
        // ⚠⚠ 存在的意义：**空串是个合法返回值**，所以「被拦了」和「真的回了空」在
        //   调用方看起来**一模一样**。不把原因翻出来，用户看到的就是「AI 没说话」，
        //   而真正发生的是「被安全策略拦了」—— 这就是把失败伪装成成功（RULES 六之二十七）。
        // ⚠ 只在**正文为空**时才追问原因：正常 STOP 但内容为空，那是真的空回复，不算错。
        function stAiWhyEmpty(proto, data) {
            if (!data || typeof data !== 'object') return '';
            if (proto === 'gemini') return stAiGeminiWhy(data);
            if (proto === 'anthropic') {
                const sr = data.stop_reason;
                if (sr === 'refusal') return '模型拒绝了这次请求（stop_reason = refusal）';
                if (sr === 'max_tokens') return '生成被 max_tokens 截断了（stop_reason = max_tokens）';
                return '';
            }
            const ch = data.choices && data.choices[0];
            const fr = ch && ch.finish_reason;
            if (fr === 'content_filter') return '内容被服务商的内容过滤拦下了（finish_reason = content_filter）';
            if (fr === 'length') return '生成被 max_tokens 截断了（finish_reason = length）';
            return '';
        }

        // OpenAI 形状的 messages → Gemini 的 contents + systemInstruction
        //   角色映射：system → 抽到 systemInstruction；assistant → model；其余 → user
        // ⚠ Gemini 要求 contents **非空**且**第一条必须是 user** —— 两条都不满足时
        //   服务端报的是 400 INVALID_ARGUMENT，看起来像「请求体写错了」而不是「少了条消息」
        function stAiGeminiBody(cfg, messages, opts) {
            const o = opts || {};
            const sys = [];
            const contents = [];
            (messages || []).forEach(m => {
                const role = m && m.role;
                const text = String((m && m.content) != null ? m.content : '');
                if (role === 'system') { if (text) sys.push(text); return; }
                contents.push({
                    role: role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: text }]
                });
            });
            if (!contents.length) contents.push({ role: 'user', parts: [{ text: '（继续）' }] });
            if (contents[0].role !== 'user') contents.unshift({ role: 'user', parts: [{ text: '（继续）' }] });

            const body = { contents: contents };
            if (sys.length) body.systemInstruction = { parts: [{ text: sys.join('\n\n') }] };
            const gc = {};
            gc.temperature = stAiNum(o.temperature, cfg.temperature, 0, 2);
            const mt = Math.trunc(stAiNum(o.maxTokens, cfg.maxTokens, 64, 32000));
            if (mt > 0) gc.maxOutputTokens = mt;
            body.generationConfig = gc;
            // ⚠ 一定要带 —— 不带就等于把拦截阈值交给 Google 的默认值（见上面那串注释）
            body.safetySettings = stAiGeminiSafety(cfg);
            return body;
        }

