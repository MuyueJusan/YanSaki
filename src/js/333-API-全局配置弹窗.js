        // ==========================================================================
        // 🔌 API 全局配置弹窗
        //
        // 主页那个按钮开的就是这里。面板里的字段与【ai对话】的模型设置**刻意长得一样**，
        // 因为两者管的本来就是同一批东西 —— 只是这里那份是真相源。
        // ==========================================================================
        let apigBaseDraft = '';      // 自定义服务商的 Base URL 草稿（切服务商时不被冲掉）
        // Vertex 那三格的草稿。跟 Base URL 同一个理由：切走再切回来不该丢 ——
        // Service Account JSON 是一大段粘贴，丢了要重新找文件
        let apigProjectDraft = '';
        let apigLocationDraft = '';
        let apigSaDraft = '';

        function openApiGlobalModal() {
            apigLoadToUI();
            document.getElementById('apiGlobalModal').classList.add('active');
        }

        function closeApiGlobalModal() {
            document.getElementById('apiGlobalModal').classList.remove('active');
            // 关掉时清掉状态行 —— 免得下次打开还挂着上一次的「已保存」
            apigStatus('');
        }

        // 把 apiGlobal 回填到弹窗控件
        function apigLoadToUI() {
            const sel = document.getElementById('apig-provider');
            aiFillProviderSelect(sel);
            sel.value = apiGlobal.provider;
            apigBaseDraft = (apiGlobal.provider === 'custom') ? apiGlobal.baseUrl : '';
            // Vertex 三格也进草稿，切走再切回来不丢
            apigProjectDraft = apiGlobal.project || '';
            apigLocationDraft = apiGlobal.location || 'global';
            apigSaDraft = apiGlobal.saJson || '';
            // ⚠ 顺序：先把三格的**值**灌进控件，再调 syncApigProviderUI ——
            //   它会顺手按 authMode 决定那几格显不显示。反过来的话第一次打开弹窗
            //   是按上一轮的 authMode 算的可见性，要开关一次才正常
            document.getElementById('apig-auth-mode').value = apiGlobal.authMode || 'key';
            document.getElementById('apig-project').value = apigProjectDraft;
            document.getElementById('apig-location').value = apigLocationDraft;
            document.getElementById('apig-sa').value = apigSaDraft;
            // 存过就进掩码态（不把私钥明文摊在屏幕上）。⚠ 必须在灌完值之后调
            apigSaRender();
            syncApigProviderUI();
            document.getElementById('apig-api-key').value = apiGlobal.apiKey || '';
            // 模型：**可手输**的 input + datalist。把缓存里拉过的列表灌进 datalist，
            // 当前值直接写在输入框里 —— 用户想手打一个列表里没有的模型名也行
            const mInput = document.getElementById('apig-model');
            mInput.value = apiGlobal.model || '';
            const dl = document.getElementById('apig-model-list');
            const models = (apiGlobal.models || []).slice();
            // ⚠ Vertex 没有缓存列表时**直接摆内置候选** —— Google 那边列模型经常
            //   不可用（见 stAiGeminiModelsUrls 的注释），不能让用户面对一个空候选框
            if (!models.length && (AI_PROVIDERS.find(x => x.value === apiGlobal.provider) || {}).vertex) {
                ST_GEMINI_MODEL_HINTS.forEach(m => models.push(m));
            }
            if (apiGlobal.model && models.indexOf(apiGlobal.model) < 0) models.unshift(apiGlobal.model);
            dl.innerHTML = models.map(m => '<option value="' + escapeHtml(m) + '"></option>').join('');
            document.getElementById('apig-stream').checked = !!apiGlobal.stream;
            updateApigStreamLabel();
            document.getElementById('apig-temperature').value = apiGlobal.temperature;
            document.getElementById('apig-temp-value').textContent = Number(apiGlobal.temperature).toFixed(1);
            document.getElementById('apig-max-tokens').value = apiGlobal.maxTokens;
            document.getElementById('apig-first-seg').value = apiGlobal.firstSeg || '';
            apigStatus('');
        }

        // 服务商变了：Base URL 那一格 + Vertex 那一整块跟着显示/隐藏。
        // ⚠ 隐藏用 `hidden` 而不是只加 class —— 只加 class 的话控件还在 DOM 里可聚焦，
        //   键盘 Tab 会跳进一块「看不见但能改」的表单。
        // ⚠⚠ 但 `hidden` **只有在有 `[hidden] { display: none }` 兜底时才有效** ——
        //   本页给这些元素设了 `display: flex`，同权重下它**盖掉** hidden 自带的
        //   display:none，于是 `el.hidden = true` 静默失效（见样式块里那条全局兜底）。
        function syncApigProviderUI() {
            const v = document.getElementById('apig-provider').value;
            const p = AI_PROVIDERS.find(x => x.value === v) || AI_PROVIDERS[0];
            const urlInput = document.getElementById('apig-base-url');
            if (p.custom) {
                urlInput.disabled = false;
                urlInput.value = apigBaseDraft || '';
            } else {
                urlInput.disabled = true;
                urlInput.value = p.baseUrl || '';
            }
            const box = document.getElementById('apig-vertex-box');
            if (box) box.hidden = !p.vertex;
            syncApigAuthUI();
        }

        // Vertex 的验证模式变了：项目 / 区域 / SA JSON 三格跟着显示/隐藏，并换提示文案。
        // ⚠ 快速模式**不需要 project**（Express 的 Key 自带项目）—— 把 project 也
        //   摆在那儿会让人以为必填，填了又没用
        function syncApigAuthUI() {
            const modeEl = document.getElementById('apig-auth-mode');
            if (!modeEl) return;
            const mode = modeEl.value === 'sa' ? 'sa' : 'key';
            const locF = document.getElementById('apig-location-field');
            const projF = document.getElementById('apig-project-field');
            const saF = document.getElementById('apig-sa-field');
            const keyF = document.getElementById('apig-key-field');
            const note = document.getElementById('apig-vertex-note');
            // 区域**两种模式都要**：完整模式进 URL 的 `locations/{loc}`，
            // 快速模式进 hostname（`{loc}-aiplatform.googleapis.com`）。
            // ⚠ 我原来在这里写过「快速模式只能是 global」——**那是错的**，
            //   参考酒馆 src/endpoints/google.js：两种模式都是
            //   `region === 'global' ? 'https://aiplatform.googleapis.com/v1'
            //                        : https://${region}-aiplatform.googleapis.com/v1`
            if (locF) locF.hidden = false;
            if (projF) projF.hidden = (mode !== 'sa');
            if (saF) saF.hidden = (mode !== 'sa');
            // ⚠⚠ API Key 那一格「藏起来」的判据 = **真的是 Vertex** 且 完整模式 ——
            //   不能只写 `mode === 'sa'`。authMode 是**全局**的那一个下拉（它跟着
            //   vertex-box 一起被藏），**切走服务商时不会重置** ⇒ 只写 mode 的话，
            //   「Vertex 完整模式 → 切到 OpenAI」之后 Key 那一格**再也不出现**，
            //   而 apigReadyCheck 又拦着「请先填写 API Key」⇒ 用户被锁在门外。
            //   ⚠ 判据必须和 stAiNeedsKey / syncAiVertexHint / stAiGeminiAuthHeaders
            //     用**同一个** stAiIsVertex()（它除了下拉框还看 baseUrl —— 自定义服务商
            //     填 aiplatform 域名时，只认下拉框那一份会和真正发请求那条路分叉）
            //   ⚠ 这里读 baseUrl 输入框是安全的：syncApigProviderUI 先灌值、再调本函数
            const vertexSa = !!(stAiIsVertex({
                provider: (document.getElementById('apig-provider') || {}).value || '',
                baseUrl: (document.getElementById('apig-base-url') || {}).value || ''
            }) && (mode === 'sa'));
            // 完整模式用 SA JSON 换 token，API Key 那一格就不该还摆着
            if (keyF) keyF.hidden = vertexSa;
            if (note) {
                note.innerHTML = (mode === 'sa')
                    ? '完整模式：把 Service Account 密钥 JSON 整个粘进来（粘完点「验证 JSON」分步体检）。' +
                      '应用会在<b>本机</b>用私钥签一个 JWT 去换 access token（私钥不上传、不落盘）。' +
                      '⚠ <b>项目 ID 不用手填</b> —— 自动取 JSON 里的 <code>project_id</code>，' +
                      '填了就以你填的为准。' +
                      '⚠ <code>global</code> 的端点<b>不带地区前缀</b>；别的区域才带。'
                    : '快速模式：只填一个 API Key（Express mode）。' +
                      '⚠ 区域<b>照样生效</b> —— <code>global</code> 走 <code>aiplatform.googleapis.com</code>，' +
                      '别的区域走 <code>{区域}-aiplatform.googleapis.com</code>。';
            }
            // 切回「完整模式」时按草稿决定是掩码态还是编辑态（存过就掩码）
            apigSaRender();
        }

        function updateApigStreamLabel() {
            const on = document.getElementById('apig-stream').checked;
            document.getElementById('apig-stream-label').textContent = on ? '流式输出' : '非流式（一次性返回）';
        }

        function updateApigTempLabel() {
            document.getElementById('apig-temp-value').textContent =
                Number(document.getElementById('apig-temperature').value).toFixed(1);
        }

        function apigStatus(msg, kind) {
            const el = document.getElementById('apig-status');
            if (!el) return;
            el.className = 'apig-status' + (kind ? ' ' + kind : '');
            el.textContent = msg || '';
        }

        // 从控件里读出一份全局配置（不落盘）
        function apigGather() {
            const p = AI_PROVIDERS.find(x => x.value === document.getElementById('apig-provider').value) || AI_PROVIDERS[0];
            const baseUrl = (p.custom
                ? (document.getElementById('apig-base-url').value || '')
                : (p.baseUrl || '')).replace(/\/+$/, '');
            return apiGlobalNormalize({
                provider: p.value,
                baseUrl: baseUrl,
                apiKey: document.getElementById('apig-api-key').value.trim(),
                model: document.getElementById('apig-model').value.trim(),
                models: (apiGlobal.models || []).slice(),
                stream: document.getElementById('apig-stream').checked,
                temperature: parseFloat(document.getElementById('apig-temperature').value),
                maxTokens: parseInt(document.getElementById('apig-max-tokens').value, 10),
                firstSeg: document.getElementById('apig-first-seg').value,
                // Vertex 那几格：非 vertex 服务商也照读（值留着，切回 vertex 时不丢）
                authMode: document.getElementById('apig-auth-mode').value,
                project: document.getElementById('apig-project').value.trim(),
                location: document.getElementById('apig-location').value.trim(),
                saJson: document.getElementById('apig-sa').value
            });
        }

        // 保存：写 apiGlobalCfg ⇒ 刷生效值 ⇒ 重画【ai对话】的镜像与编写器
        function saveApiGlobal() {
            apiGlobal = apigGather();
            if (apiGlobal.provider === 'custom') apigBaseDraft = apiGlobal.baseUrl;
            const ok = apiGlobalPersist();
            aiApplyEffective();
            // ⚠ 独立模式下不能顺手 aiSyncOwnFromEffective()：那会把用户自己那份冲成全局的
            aiPersist();
            syncAiCfgSourceUI();
            refreshStAiCfgViews();
            // 保存完立刻回到掩码态：刚粘完的私钥不该继续摊在屏幕上
            apigSaRender();
            apigStatus(ok ? '✅ 已保存，全站立即生效' : '⚠️ 存不进 localStorage（隐私模式？），本次会话内有效',
                ok ? 'ok' : 'warn');
        }

        // 全局面板的「能不能发请求」检查。跟 stAiReady 的区别：这里还要管 Vertex
        // 两条路**各自**的必填项 —— 快速模式要 Key，完整模式要 SA JSON + project
        // ⚠ `opts.needModel === false` 时**不要求模型名** —— 「获取模型列表」那一步
        //   本来就是为了挑模型，要求先有就成了死循环。编写器那边（`stAiReady`）
        //   一直带着这个开关，全局面板这边**漏了** ⇒ Vertex 下必须先手打一个模型名
        //   才能点「获取模型列表」，等于把这个按钮废掉了
        function apigReadyCheck(cfg, opts) {
            const needModel = !(opts && opts.needModel === false);
            // ⚠ 判据与 stAiNeedsKey / stAiGeminiAuthHeaders / syncApigAuthUI 一致：
            //   走 stAiIsVertex()（它除了下拉框**还看 baseUrl**）。只认下拉框那一份的话，
            //   「自定义服务商 + 填了 aiplatform 域名」会被当成普通服务商去要 Key，
            //   而真正发请求那条路走的是 Vertex 那一条 ⇒ **校验与发送用两套判据**，
            //   必然出现「拦着不让发」或「放过去但发错」。
            //   ⚠ 更糟的是 Key 那一格的显隐也换成了这个判据 ⇒ 判据不一致会做出
            //     「格子藏起来了、却还要求你填」——正是用户报的那个锁死形态
            if (stAiIsVertex(cfg)) {
                if (cfg.authMode === 'sa') {
                    if (!cfg.saJson) return '完整模式要先把 Service Account JSON 粘进去';
                    const sa = stAiSaParse(cfg.saJson);
                    if (!sa.ok) return sa.why;
                    // ⚠ 项目 ID **不用手填** —— 没填就从 JSON 的 project_id 取（stAiVertexProject）。
                    //   两处都没有才拦：否则拼出 `/v1/projects//locations/...` 拿一个 404 回来，
                    //   报错里看不出是「少了项目」
                    if (!stAiVertexProject(cfg)) {
                        return '这份 Service Account JSON 里没有 project_id，也没填「项目 ID」—— 完整模式的 URL 必须有项目';
                    }
                } else if (!cfg.apiKey) {
                    return '快速模式要填 API Key';
                }
                if (needModel && !cfg.model) return '请填一个模型名，例如 gemini-2.5-flash';
                return '';
            }
            if (!cfg.baseUrl) return '请填写服务商或 Base URL';
            if (!cfg.apiKey && !stAiIsLocal(cfg.baseUrl)) return '请先填写 API Key';
            return '';
        }

        // ── SA JSON 的掩码态 ────────────────────────────────────────────
        // 存过之后只显示「存的是哪一份」，不把私钥明文摊在屏幕上（照酒馆的做法）。
        // ⚠ 只是把 textarea **藏起来**，它的 value 一直留着 ⇒ apigGather() 读到的还是
        //   那份 JSON，「打开面板看一眼再点保存」不会把密钥弄丢。
        function apigSaRender() {
            const box = document.getElementById('apig-sa-masked');
            const ta = document.getElementById('apig-sa');
            const who = document.getElementById('apig-sa-who');
            if (!box || !ta) return;
            const sum = stAiSaSummary(apigSaDraft);
            if (sum.ok) {
                box.hidden = false;
                ta.hidden = true;
                if (who) who.textContent = '已保存：' + sum.label;
            } else {
                box.hidden = true;
                ta.hidden = false;
            }
        }

        // 「换一份」：把 textarea 显出来并**全选**（方便直接粘覆盖）。
        // ⚠ **不清空** —— 清空之后用户要是改主意直接点保存，密钥就没了。
        //   真粘一份新的进来时 oninput 会覆盖掉
        function apigSaEditMode() {
            const ta = document.getElementById('apig-sa');
            const box = document.getElementById('apig-sa-masked');
            const out = document.getElementById('apig-verify-out');
            if (box) box.hidden = true;
            if (out) out.hidden = true;
            if (ta) {
                ta.hidden = false;
                try { ta.focus(); ta.select(); } catch (e) {}
            }
        }

        // ── 「验证 JSON」：**分步**做，每步失败都说清是哪一步、为什么 ──────────
        // 酒馆那个按钮就是这个用意：把「JSON 粘错了」「私钥不对」「被 CORS 挡了」
        // 「项目 / 区域 / 权限不对」这四种**完全不同的**失败分开。
        // 笼统一句「请求失败」等于什么都没说 —— 用户没法据此改任何东西。
        //
        // ① ② ③ ④ 全是**纯本地**（不发一个网络请求）：JSON 语法 → 必填字段 →
        // 私钥导入 WebCrypto → 签 JWT。⑤ 才是第一次真的发请求。
        async function apigVerifyJson() {
            const out = document.getElementById('apig-verify-out');
            const btn = document.getElementById('apig-verify-btn');
            if (!out) return;
            const raw = apigSaDraft || '';
            const lines = [];
            const show = () => { out.hidden = false; out.innerHTML = lines.join('<br>'); };
            const ok = t => { lines.push('✅ ' + escapeHtml(t)); show(); };
            const no = t => { lines.push('❌ ' + escapeHtml(t)); show(); };
            const tip = t => { lines.push('　　⚠ ' + t); show(); };
            if (btn) { btn.disabled = true; btn.textContent = '验证中…'; }
            show();
            try {
                // ① JSON 语法
                let obj = null;
                try { obj = JSON.parse(String(raw || '')); } catch (e) { obj = null; }
                if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
                    no('① JSON 不合法 —— 多半是粘漏了开头的 { 或结尾的 }');
                    tip('密钥文件有 2~3 KB，用「复制全部」再粘，别手动划选');
                    return;
                }
                ok('① JSON 合法');

                // ② 必填字段
                const sa = stAiSaParse(raw);
                if (!sa.ok) { no('② ' + sa.why); return; }
                ok('② 必填字段齐（client_email / private_key）');
                if (!sa.projectId) tip('这份 JSON 里没有 project_id —— 完整模式的 URL 需要它，请手动填「项目 ID」');

                // ③ 私钥导入（纯本地）
                try {
                    await stAiSaKey(sa);
                } catch (e) {
                    no('③ 私钥导入失败：' + ((e && e.message) || e));
                    tip('前面两步都过了，所以问题**只在 private_key 本身**');
                    return;
                }
                ok('③ 私钥能导入 WebCrypto（PKCS#8 · RS256）');

                // ④ 签 JWT（纯本地）
                try {
                    await stAiSaJwt(sa, Math.floor(Date.now() / 1000));
                } catch (e) {
                    no('④ 签 JWT 失败：' + ((e && e.message) || e));
                    return;
                }
                ok('④ JWT 签得出来（本地签名，没发网络请求）');

                // ⑤ 换 access token —— 第一次真的发请求
                let token = '';
                try {
                    token = await stAiSaAccessToken(raw, true);
                } catch (e) {
                    no('⑤ 换 access token 失败：' + ((e && e.message) || e));
                    tip('走到这一步说明 <b>JSON 和私钥都没问题</b>，是网络 / 凭证这一层');
                    return;
                }
                ok('⑤ 换到 access token（' + escapeHtml(String(token).slice(0, 12)) + '…）');

                // ⑥ 真列一次模型 —— 只为验证「项目 / 区域 / 权限」
                // ⚠⚠ 这一步失败**不等于配置坏了**：⑤ 已经把 token 换到手，说明
                //   JSON / 私钥 / 账号都是对的。列模型是**额外**能力，而且 Google
                //   那边经常不可用（v1 那条资源根本没有 list 方法、账号也常没这个权限）。
                //   ⇒ 必须说清「这不挡对话」，否则用户会一直以为自己配错了 ——
                //     这一轮用户报的就是这个症状（「已经开放代理，却还是列模型失败」）。
                const cfg = apigGather();
                cfg.authMode = 'sa';
                cfg.saJson = raw;
                try {
                    const ids = await stAiFetchModels(cfg);
                    ok('⑥ 列模型成功（' + ids.length + ' 个）—— 项目 / 区域 / 权限都对得上');
                    tip('可以点「保存」了');
                } catch (e) {
                    no('⑥ 列模型失败：' + ((e && e.message) || e));
                    tip('⚠ <b>但这不代表配置坏了</b> —— ⑤ 已经换到 token，说明 JSON / 私钥 / 账号都对');
                    tip('列模型只是额外能力，Google 这条接口经常不可用（也常常没给账号这个权限）' +
                        '⇒ <b>不影响对话</b>：模型名在面板里直接手输就行，例如 gemini-2.5-flash');
                    tip('真要查：① 项目 ID / 区域与项目是否一致；② 该 Service Account 有没有 ' +
                        'Vertex AI 的查看权限；③ 这个接口允不允许浏览器直连');
                    // 顺手把内置候选摆上，用户点「保存」之前就有东西可选
                    const dl = document.getElementById('apig-model-list');
                    const cur = (document.getElementById('apig-model').value || '').trim();
                    const hints = ST_GEMINI_MODEL_HINTS.slice();
                    if (cur && hints.indexOf(cur) < 0) hints.unshift(cur);
                    if (dl) dl.innerHTML = hints.map(m => '<option value="' + escapeHtml(m) + '"></option>').join('');
                }
            } finally {
                if (btn) { btn.disabled = false; btn.textContent = '✅ 验证 JSON（分步）'; }
            }
        }

        async function apigFetchModels() {
            const cfg = stAiEnsureProto(apigGather());
            // ⚠ 拉模型**不能要求先有模型**（`needModel:false`）—— 这一步就是为了挑模型
            const bad = apigReadyCheck(cfg, { needModel: false });
            if (bad) { apigStatus('⚠️ ' + bad, 'warn'); return; }
            const btn = document.getElementById('apig-fetch-btn');
            btn.disabled = true;
            btn.textContent = '获取中…';
            apigStatus('⏳ 正在获取模型列表…');
            try {
                // ⚠ 复用编写器那份 stAiFetchModels：三种协议的 URL / 头都在那里。
                //   这里自己再拼一遍就是「改了一处忘了另一处」的老毛病 ——
                //   上一版就是这么把 Anthropic 的头漏掉的
                let list = null, why = '';
                try {
                    list = await stAiFetchModels(cfg);
                } catch (e) {
                    // ⚠⚠ Google 那边列模型**经常不可用**（v1 那条资源没有 list 方法 /
                    //    该账号没这个权限 / 形状又变了），而**列不出来根本不该挡路** ——
                    //    模型框本来就能手输，酒馆（SillyTavern）连列都不列。
                    //    ⇒ 退回内置候选。但**必须把失败原因说出来**，绝不能把失败
                    //      伪装成成功（RULES 六之二十七）。
                    if (cfg.proto !== 'gemini') throw e;
                    list = ST_GEMINI_MODEL_HINTS.slice();
                    why = (e && e.message) || String(e);
                }
                if (!why) {
                    apiGlobal.models = list;
                    // 落盘一份，免得刷新后又得重拉（模型列表是缓存，不是配置本体）
                    apiGlobalPersist();
                }
                const dl = document.getElementById('apig-model-list');
                const keep = document.getElementById('apig-model').value.trim();
                const all = list.slice();
                if (keep && all.indexOf(keep) < 0) all.unshift(keep);
                dl.innerHTML = all.map(m => '<option value="' + escapeHtml(m) + '"></option>').join('');
                if (why) {
                    apigStatus('⚠️ 列不出来（' + why + '）—— 已摆上内置候选，直接挑或手输模型名都行。' +
                        '⚠ 这**不影响对话**：模型名本来就能手输', 'warn');
                } else {
                    apigStatus('✅ 拉到 ' + list.length + ' 个模型（输入框里点一下就能挑），选一个再保存', 'ok');
                }
            } catch (e) {
                apigStatus('❌ 获取失败：' + ((e && e.message) ? e.message : String(e)), 'warn');
            } finally {
                btn.disabled = false;
                btn.textContent = '🔄 获取模型列表';
            }
        }

        // 测试连接：**真发一次最小对话**。
        // 比只拉 /models 有意义得多 —— /models 通不代表对话能通（协议形状、模型名、
        // 鉴权方式都可能是错的），而这一下把「URL + 鉴权 + 协议 + 模型名」全验了。
        // ⚠ 会产生一次极小的调用费用（几个 token），按钮上写明了
        async function apigTestConnection() {
            const cfg = apigGather();
            const bad = apigReadyCheck(cfg);
            if (bad) { apigStatus('⚠️ ' + bad, 'warn'); return; }
            const btn = document.getElementById('apig-test-btn');
            btn.disabled = true;
            apigStatus('⏳ 正在测试（真发一条最小对话，会消耗几个 token）…');
            try {
                const plan = stAiRequest(cfg, [{ role: 'user', content: 'ping' }], {
                    stream: false, maxTokens: 64, temperature: 0
                });
                await stAiPlanAuth(plan, cfg);
                // ⚠ 走 stAiPostChat（不是直接 fetch）—— 264 里写着「只有这里发」，
                //   这里再写一份的话，以后加协议 / 加兜底就会漏掉这一条
                stAiUsageReset();
                const resp = await stAiPostChat(plan);
                if (!resp.ok) {
                    let t = '';
                    try { t = (await resp.text()).slice(0, 200); } catch (e) {}
                    apigStatus('❌ 服务端返回 HTTP ' + resp.status + (t ? ' ' + t : '') +
                        '（依次检查 Key / 模型名 / 区域 / 认证模式）', 'warn');
                    return;
                }
                const data = await resp.json();
                stAiUsageNote(plan.proto, data);
                const text = stAiFullText(plan.proto, data);
                // 按钮上写着「会消耗几个 token」，那就把到底几个说清楚
                apigStatus('✅ 通了（' + plan.proto + '）。模型回了 ' + text.length +
                    ' 个字符：' + JSON.stringify(text.slice(0, 40)) + stAiUsageSuffix(), 'ok');
            } catch (e) {
                // 发不出去最常见的三个原因，和编写器那边共用同一段文案
                apigStatus('❌ ' + stAiErrText(e), 'warn');
            } finally {
                btn.disabled = false;
            }
        }

