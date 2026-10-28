        // ==========================================================================
        // 【ai对话】的「配置来源」开关
        //
        // 跟随 = 下面那批 API 字段是 apiGlobal 的**只读镜像**（改不了，只能去全局面板改）；
        // 独立 = 自己一套，真相源是 aiConfig.own。
        //
        // ⚠ 跟随时**绝不留「能改、但下次刷新又变回去」的假输入框** ——
        //   所以这里是真 disabled，不是一个只挡样子的 readonly。
        // ⚠ 切来源只动那几个 API 字段 + 第一段；系统提示词 / 酒馆模式那一大堆
        //   仍然归【ai对话】自己管，跟着全局走的是「钥匙」，不是「人格」。
        // ==========================================================================
        function setAiCfgSource(follow) {
            aiConfig.followGlobal = !!follow;
            aiApplyEffective();
            aiPersist();
            syncAiCfgSourceUI();
            updateAiStatus(aiConfig.followGlobal
                ? '🔗 已改为跟随 API 全局配置'
                : '🔑 已改为独立配置（自己一套，跟全局互不干扰）');
        }

        function syncAiCfgSourceUI() {
            const follow = aiConfig.followGlobal !== false;
            const src = follow ? apiGlobal : (aiConfig.own || {});

            // 高亮 + 折叠状态下的角标
            document.querySelectorAll('#ai-cfg-src .ai-src-btn').forEach(b => {
                b.classList.toggle('ai-src-on', (b.dataset.follow === '1') === follow);
            });
            const badge = document.getElementById('ai-src-badge');
            if (badge) badge.textContent = follow ? '· 🔗 跟随全局' : '· 🔑 独立';

            // 把镜像值刷成真相源那份（⚠ 先写值再上锁，顺序反了 disabled 也不影响赋值，
            //   但「自定义服务商」那格的可编辑性由 syncAiProviderUI 决定，必须排在它后面收口）
            const psel = document.getElementById('ai-provider');
            if (psel) {
                psel.value = src.provider || 'openai';
                customBaseUrlDraft = (src.provider === 'custom') ? (src.baseUrl || '') : '';
                syncAiProviderUI();
                const urlInput = document.getElementById('ai-base-url');
                if (urlInput && src.provider !== 'custom') urlInput.value = src.baseUrl || '';
            }
            const key = document.getElementById('ai-api-key');
            if (key) key.value = src.apiKey || '';
            setAiModelOption(src.model || '');
            const st = document.getElementById('ai-stream');
            if (st) { st.checked = src.stream !== false; updateAiStreamLabel(); }
            const tp = document.getElementById('ai-temperature');
            if (tp) { tp.value = src.temperature; updateAiTempLabel(); }
            const mt = document.getElementById('ai-max-tokens');
            if (mt) mt.value = src.maxTokens;
            const fs = document.getElementById('ai-first-seg');
            if (fs) fs.value = src.firstSeg || '';

            ['ai-provider', 'ai-base-url', 'ai-api-key', 'ai-model', 'ai-stream',
                'ai-temperature', 'ai-max-tokens', 'ai-first-seg'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.disabled = follow;
            });
            const fb = document.getElementById('ai-fetch-btn');
            if (fb) fb.disabled = follow;

            const hint = document.getElementById('ai-cfg-src-hint');
            if (hint) hint.style.display = follow ? '' : 'none';
            // ⚠ 排在最后：它要看的是**收口之后**的 followGlobal 与 provider
            syncAiVertexHint();
        }

        // 全局配置变了 ⇒ 编写器开着就重画一次（跟随模式下它整页显示的都是全局的镜像）
        function refreshStAiCfgViews() {
            if (typeof stEditor === 'object' && stEditor && stEditor.open) stRerender();
        }

        function saveAiSettings() {
            aiCommitInputs(getAiConfigFromInputs());
            if (aiConfig.provider === 'custom') customBaseUrlDraft = aiConfig.baseUrl;
            updateAiStatus('✅ 设置已保存');
        }

        function applyAiSettings() {
            const cfg = getAiConfigFromInputs();
            // 跟随模式下这几格是只读镜像，缺了也只能去全局配置里补 —— 别让用户在这儿干瞪眼
            const where = (cfg.followGlobal !== false) ? '【API 全局配置】' : '这里';
            // ⚠⚠ 不能无条件要求 apiKey。Vertex 完整模式用的是 SA JSON，Key 那一格
            //   在面板里是**藏起来**的（syncAiVertexHint）—— 原来这里直接
            //   `if (!cfg.apiKey)` ⇒ 完整模式点「应用」永远被拦，而用户连那格都看不见，
            //   根本无从「去填一个」，只能干瞪眼。
            //   判据走 stAiNeedsKey()，别再在这儿写第三份
            if (stAiNeedsKey(cfg) && !cfg.apiKey) { updateAiStatus('⚠️ 请先在' + where + '填写 API Key'); return; }
            if (!cfg.baseUrl) { updateAiStatus('⚠️ 请先在' + where + '填写服务商或 Base URL'); return; }
            if (!cfg.model) { updateAiStatus('⚠️ 请先在' + where + '获取并选择模型'); return; }
            aiCommitInputs(cfg);
            if (cfg.provider === 'custom') customBaseUrlDraft = cfg.baseUrl;
            // 折叠模型设置（保留在对话上方作为子展开），聊天保持展开
            document.getElementById('ai-card').classList.add('ai-settings-collapsed');
            updateAiStatus('');
            if (!chatHistory.length) {
                appendAiGreeting();
            }
        }

        async function fetchModels() {
            const cfg = getAiConfigFromInputs();
            // 半成品兜底：这个对象里没有 proto（协议是推导出来的），
            // 少了这步 gemini / vertex 会按 openai 发出去
            stAiEnsureProto(cfg);
            // ⚠ 原来这里写的是 `!(cfg.proto === 'gemini' && cfg.authMode === 'sa')` ——
            //   拿「协议是 gemini」代替「是 Vertex」是不等价的：
            //   自定义服务商填一个 `generativelanguage.googleapis.com` 的地址时，
            //   `stAiGuessProto()` 也会猜成 gemini，可它**不是 Vertex**；
            //   而 `authMode` 是**跟着配置留着的**（从 Vertex 切走不会自动清）
            //   ⇒ 那种组合下旧写法会判「不需要 Key」，于是**不带 Key 就发出去**拿一个 401。
            //   （⚠ 注意：`provider:'gemini'` 那个预设走的是 OpenAI 兼容层，
            //    它的 `proto` 是 `'openai'`，所以**不**在这个坑里。）
            //   判据收归 stAiNeedsKey()：只有**真的是 Vertex** 且 sa 才免 Key
            const needKey = stAiNeedsKey(cfg);
            if (needKey && !cfg.apiKey) { updateAiStatus('⚠️ 请先填写 API Key'); return; }
            if (cfg.proto !== 'gemini' && !cfg.baseUrl) { updateAiStatus('⚠️ 请填写服务商或 Base URL'); return; }
            const btn = document.getElementById('ai-fetch-btn');
            btn.disabled = true;
            btn.textContent = '获取中…';
            updateAiStatus('⏳ 正在获取模型列表…');
            try {
                // ⚠ 走共用那一份（第十八轮并的）：它管三种返回形状 + **去重 + 排序** +
                //   剥 `models/` 前缀 + anthropic 的换头 + gemini 的列模型路径。
                //   这里原来自己写了一份 OpenAI 专属的 ⇒ anthropic / gemini 用不了，
                //   而且漏了去重（同一份响应里两个 `gpt-4o` 就真的显示两个）
                const ids = await stAiFetchModels(cfg);
                const sel = document.getElementById('ai-model-list');
                sel.innerHTML = '';
                ids.forEach(id => {
                    const opt = document.createElement('option');
                    opt.value = id;
                    sel.appendChild(opt);
                });
                setAiModelOption(cfg.model);
                updateAiStatus('✅ 获取到 ' + ids.length + ' 个模型，请选择');
            } catch (e) {
                updateAiStatus('❌ 获取模型失败：' + e.message);
            } finally {
                btn.disabled = false;
                btn.textContent = '获取模型';
            }
        }

        // 气泡外层是 .ai-msg（气泡 + 操作按钮），历史内容挂在它身上，
        // 这样重试时可以只靠 DOM 就能还原出「这条之前的对话」
        function setBubbleHistory(bubbleEl, role, content) {
            const wrap = bubbleEl && bubbleEl.parentElement;
            if (!wrap || !wrap.classList.contains('ai-msg')) return;
            wrap.dataset.historyRole = role;
            wrap.dataset.historyContent = content;
        }

        function appendAiBubble(role, text, opts) {
            opts = opts || {};
            const isUser = (role === 'user');
            const retryable = (opts.retryable !== undefined) ? opts.retryable : !isUser;

            const container = document.getElementById('ai-messages');
            const wrap = document.createElement('div');
            wrap.className = 'ai-msg ' + (isUser ? 'from-user' : 'from-ai');

            const div = document.createElement('div');
            div.className = 'ai-bubble ' + (isUser ? 'user' : 'ai');
            div.textContent = text;
            wrap.appendChild(div);

            if (retryable) {
                const tools = document.createElement('div');
                tools.className = 'ai-msg-tools';
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'ai-msg-btn';
                btn.title = '重新生成这条回复';
                btn.textContent = '↻';
                btn.onclick = () => retryFrom(wrap);
                tools.appendChild(btn);
                wrap.appendChild(tools);
            }

            container.appendChild(wrap);
            container.scrollTop = container.scrollHeight;
            return div;
        }

        function appendAiGreeting() {
            const ctx = getMacroContext();
            // 酒馆模式：优先用角色卡的开场白（主开场白或选中的备选）
            if (tavernEnabled()) {
                const g = getActiveGreeting();
                if (g) {
                    appendAiBubble('ai', applyCardMacros(g), { retryable: false });
                    return;
                }
            }
            // 原系统提示词被关掉时，预设自带的开场白也不能用 —— 不然会说「我是猫猫 Saki」
            // 却根本没把猫猫的人设发出去
            const preset = (aiConfig.promptEnabled === false) ? null : findPromptPreset(aiConfig.promptPreset);
            let greet;
            if (preset && preset.greeting) {
                // 预设自带开场白，跟人设语气保持一致。
                // 注意这里不能用 applyUserMacros()：关掉宏之后它会原样返回，
                // 开场白里就会漏出 {{char}} 这种字面量。开场白是给人看的文案，
                // 所以 {{char}} 永远展开；{{user}} 只在宏开着时换成昵称。
                const addr = (ctx.enabled && ctx.address) ? ctx.address : '你';
                greet = String(preset.greeting)
                    .split('{{char}}').join(ctx.charName)
                    .split('{{user}}').join(addr);
                if (ctx.enabled && ctx.address && preset.greeting.indexOf('{{user}}') < 0) {
                    greet += `（我是 ${ctx.charName}，以后就称呼你「${ctx.address}」啦）`;
                }
            } else {
                greet = (ctx.enabled && ctx.address)
                    ? `你好呀～我是 ${ctx.charName}，以后就称呼你「${ctx.address}」啦，现在可以和我聊天啦！🐾`
                    : `你好呀～我是 ${ctx.charName}，现在可以和我聊天啦！🐾`;
            }
            appendAiBubble('ai', greet, { retryable: false });
        }

        function setAiBusy(busy) {
            aiBusy = busy;
            const sendBtn = document.getElementById('ai-send-btn');
            if (sendBtn) sendBtn.disabled = busy;
            document.querySelectorAll('.ai-msg-btn').forEach(b => { b.disabled = busy; });
        }

        function newAiConversation() {
            if (aiBusy) return;
            const container = document.getElementById('ai-messages');
            const hasAny = !!container.querySelector('.ai-msg');
            if (hasAny && !window.confirm('开始新对话？当前聊天记录会被清空。')) return;
            // 卡片折叠着的时候点「新对话」，清空是看不见的 —— 先展开再清
            const card = document.getElementById('ai-card');
            if (card.classList.contains('ai-collapsed')) {
                card.classList.remove('ai-collapsed');
                card.classList.remove('ai-settings-collapsed');
                expandAiAdvanced();
            }
            chatHistory = [];
            wiResetTimed();      // 新对话 = 新的聊天上下文，黏性 / 冷却从零开始
            container.innerHTML = '';
            appendAiGreeting();
            updateAiStatus('');
            const input = document.getElementById('ai-input');
            if (input) input.focus();
            scrollAiMessagesToBottom();
        }

        // 重试：丢掉这条气泡及其之后的所有气泡，用剩下的内容重新请求
        function retryFrom(wrapEl) {
            if (aiBusy) return;
            const all = [...document.querySelectorAll('#ai-messages > .ai-msg')];
            const idx = all.indexOf(wrapEl);
            if (idx < 0) return;

            const keep = all.slice(0, idx);
            const drop = all.slice(idx);

            // 只用真正进过历史的气泡重建（欢迎语、失败的气泡都不算）
            chatHistory = keep
                .filter(n => n.dataset.historyRole)
                .map(n => ({ role: n.dataset.historyRole, content: n.dataset.historyContent || '' }));
            if (chatHistory.length > 40) chatHistory = chatHistory.slice(-40);

            drop.forEach(n => n.remove());
            requestAssistantReply();
        }

        function scrollAiBottom() {
            const c = document.getElementById('ai-messages');
            c.scrollTop = c.scrollHeight;
        }

        async function safeErrorText(resp) {
            try { const t = await resp.text(); return t.slice(0, 200); } catch (e) { return ''; }
        }

        // 【ai对话】用的 cfg —— 读的是 aiConfig 顶层的**生效值**（跟随全局时它已经
        // 被 aiApplyEffective() 刷过了），所以这里不必再关心「跟随还是独立」。
        // ⚠ 全站 40 多个读点都是直接读 aiConfig.xxx；只有**协议相关**的这几处
        //   需要把它打包成 cfg 交给 stAiRequest
        function aiEffectiveCfg() {
            const base = String(aiConfig.baseUrl || '').replace(/\/+$/, '');
            return Object.assign({
                mode: aiConfig.followGlobal === false ? 'own' : 'follow',
                provider: aiConfig.provider,
                providerLabel: (AI_PROVIDERS.find(p => p.value === aiConfig.provider) || {}).label || aiConfig.provider,
                baseUrl: base,
                apiKey: String(aiConfig.apiKey || ''),
                model: String(aiConfig.model || ''),
                temperature: stAiNum(aiConfig.temperature, 0.7, 0, 2),
                maxTokens: Math.trunc(stAiNum(aiConfig.maxTokens, 1024, 64, 32000)),
                stream: aiConfig.stream !== false,
                proto: stAiProtoOf(aiConfig.provider, base),
                firstSeg: ''
            }, stAiVertexFields(aiConfig));
        }

        // ⚠ 这两个函数**曾经各自写了一份 OpenAI 专属的请求 + SSE 解析**，
        //   于是「Anthropic / Gemini 在编写器里能用、在【ai对话】里不能用」。
        //   现在都并到 stAiRequest / stAiPlanAuth / stAiStream —— 协议只在一处实现，
        //   以后加协议不会再出现「只加了一半」
        async function nonStreamChat(messages) {
            const cfg = aiEffectiveCfg();
            const plan = stAiRequest(cfg, messages, { stream: false, maxTokens: cfg.maxTokens });
            await stAiPlanAuth(plan, cfg);
            const resp = await fetch(plan.url, {
                method: 'POST',
                headers: plan.headers,
                body: JSON.stringify(plan.body)
            });
            if (!resp.ok) throw new Error('HTTP ' + resp.status + ' ' + (await safeErrorText(resp)));
            const data = await resp.json();
            const full = stAiFullText(plan.proto, data);
            // ⚠ 空正文要问原因（同 stAiChat）—— 本页以前是**静默返回空串**，
            //   用户看到「AI 没说话」，而真实原因多半是被安全策略拦了
            if (!full) {
                const why = stAiWhyEmpty(plan.proto, data);
                if (why) throw new Error(why);
            }
            return full;
        }

        async function streamChat(messages, onDelta) {
            const cfg = aiEffectiveCfg();
            const plan = stAiRequest(cfg, messages, { stream: true, maxTokens: cfg.maxTokens });
            await stAiPlanAuth(plan, cfg);
            const resp = await fetch(plan.url, {
                method: 'POST',
                headers: plan.headers,
                body: JSON.stringify(plan.body)
            });
            if (!resp.ok) throw new Error('HTTP ' + resp.status + ' ' + (await safeErrorText(resp)));
            // 服务端可能不理会 stream（返一整段 JSON）。那时没有 body 流可读，
            // 退回按非流式解析，别在这里抛「Cannot read property getReader」
            if (!resp.body || typeof resp.body.getReader !== 'function') {
                const data = await resp.json();
                const full = stAiFullText(plan.proto, data);
                if (!full) {
                    const why = stAiWhyEmpty(plan.proto, data);
                    if (why) throw new Error(why);
                }
                if (onDelta) onDelta(full);
                return full;
            }
            return await stAiStream(resp, plan.proto, onDelta);
        }

        async function sendAiMessage() {
            if (aiBusy) return;
            const input = document.getElementById('ai-input');
            const text = input.value.trim();
            if (!text) return;
            input.value = '';

            const userBubble = appendAiBubble('user', text);
            const historyText = applyUserMacros(text);
            setBubbleHistory(userBubble, 'user', historyText);
            chatHistory.push({ role: 'user', content: historyText });
            wiBumpClock();       // 世界书定时效果的「消息时钟」跟着往前走
            if (chatHistory.length > 40) chatHistory = chatHistory.slice(-40);

            await requestAssistantReply();
        }

        // 按当前 chatHistory 请求一条回复（首次发送 / 重试都走这里）
        async function requestAssistantReply() {
            const aiBubble = appendAiBubble('ai', '思考中…', { retryable: true });
            aiBubble.classList.add('loading');

            setAiBusy(true);

            // 普通模式 = system + 历史；酒馆模式 = 角色定义 / 世界书按位置与深度拼装
            const messages = buildRequestPlan().messages;

            try {
                let full = '';
                if (aiConfig.stream) {
                    full = await streamChat(messages, (acc) => {
                        aiBubble.textContent = acc;
                        aiBubble.classList.remove('loading');
                        scrollAiBottom();
                    });
                } else {
                    full = await nonStreamChat(messages);
                }
                aiBubble.classList.remove('loading');
                aiBubble.classList.remove('failed');
                aiBubble.textContent = full || '(空回复)';
                setBubbleHistory(aiBubble, 'assistant', full);
                chatHistory.push({ role: 'assistant', content: full });
                wiBumpClock();
            } catch (e) {
                aiBubble.classList.remove('loading');
                aiBubble.classList.add('failed');
                aiBubble.textContent = '请求失败：' + e.message;
                // 失败这条不进历史；点旁边的 ↻ 就能重试
            } finally {
                setAiBusy(false);
                scrollAiBottom();
            }
        }

        // 初始化页面与按键绑定
        bindTouchButtonEvents();
        renderTimezoneButtons();
        updateClock();
        renderCalendar();
        initAiArea();
        stInit();
        setInterval(updateClock, 1000);

