        // ==========================================================================
        // 【ai对话】的历史会话：保存 / 切换 / 导出
        //
        // 一段对话 = 一段会话。切回旧会话时，**连它当时用的人设一起切回来**
        // （系统提示词 / 预设，或酒馆模式下的角色卡 + 世界书）。
        //
        // ⚠ 为什么不塞进 aiChatConfig：
        //   那份是「设置」，被 st-ai.js / apig-verify.js 断言着，而且每次「保存设置」
        //   都会整份重写一遍 —— 把聊天记录塞进去等于每点一次保存就把几百条消息重写一次。
        //   所以另起一个键 aiChatSessions，只装会话本身。
        //
        // ⚠ 人设快照按内容去重（personas 表 + pid 引用）：
        //   同一张角色卡聊 20 段，没必要存 20 份世界书。快照**一旦生成就不再改写**，
        //   所以「这条对话当时用的是哪份人设」永远是准的 —— 哪怕后来把卡改了。
        // ==========================================================================

        const AI_SESS_KEY = 'aiChatSessions';
        const AI_SESS_MAX = 40;          // 最多留多少段（超了先扔最久没动过的）
        const AI_SESS_MAX_MSGS = 200;    // 每段最多存多少条气泡
        const AI_SESS_UNTITLED = '新对话';

        // 发给模型的历史条数上限。原先在 334 里写死了三处 40，
        // 现在只有这一份 —— 会话恢复也用它，不然「恢复出来的上下文」和「聊出来的」会不一样长
        const AI_CHAT_HIST_MAX = 40;

        // 哪些字段算「人设」。
        // ⚠ 故意**不含** provider / apiKey / model / temperature 那一批 ——
        //   跟着全局走的是「钥匙」，不是「人格」（同 setAiCfgSource 的注释）。
        // ⚠ 也**不含** firstSeg：它在 API_GLOBAL_FIELDS 里，属于「钥匙」那一组，
        //   syncAiCfgSourceUI() 每次都会拿全局 / 独立那份把它盖回去 ——
        //   存进会话只会得到一个「切过来是对的、动一下又变回去」的假状态。
        // ⚠ 也**不含** tavernTimed：那是黏性 / 冷却的时钟，每发一条消息都在变，
        //   放进快照会让「人设」每发一句就多出一份副本。它按会话单独存。
        const AI_PERSONA_FIELDS = [
            // 系统提示词 / 预设
            'systemPrompt', 'promptPreset', 'customPrompt', 'promptEnabled',
            // 酒馆模式：角色卡 + 世界书 + 开场白选择 + Chat Completion 预设
            'tavernEnabled', 'tavernCard', 'tavernLore', 'tavernGreetingIndex', 'tavernPresetId',
            // 世界书扫描设置
            'tavernScanDepth', 'tavernRecursive', 'tavernIncludeNames',
            'tavernCaseSensitive', 'tavernMatchWholeWords', 'tavernGroupScoring',
            'tavernMinActivations', 'tavernMinActivationsDepthMax', 'tavernMaxRecursionSteps',
            // 作者注释
            'tavernAnText', 'tavernAnPosition', 'tavernAnDepth', 'tavernAnRole', 'tavernAnInterval',
            // 用户人设描述插在哪
            'tavernPersonaPosition', 'tavernPersonaDepth', 'tavernPersonaRole',
            // {{user}} 宏：你的昵称 / AI 的名字 / 称呼方式 —— 这些也是「人设」
            'userMacroEnabled', 'userName', 'charName',
            'addressStyle', 'addressAffix', 'addressTemplate', 'addressInject'
        ];

        let aiSessStore = { v: 1, active: '', personas: {}, list: [] };

        function aiSessUid() {
            return 's' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
        }

        // 深拷贝。世界书 / 角色卡都是嵌套对象，直接赋值会让「会话里的快照」
        // 跟 aiConfig 指向同一份 —— 用户一编辑卡，历史会话里的人设就跟着变，
        // 那就等于没存
        function aiSessClone(v) {
            if (v === null || typeof v !== 'object') return v;
            try { return JSON.parse(JSON.stringify(v)); } catch (e) { return v; }
        }

        // 内容指纹：FNV-1a + 长度。这个用途（去重、不设防）碰撞率足够了，
        // 长度后缀是白送的保险
        function aiSessHash(s) {
            let h = 0x811c9dc5;
            for (let i = 0; i < s.length; i++) {
                h ^= s.charCodeAt(i);
                h = Math.imul(h, 0x01000193) >>> 0;
            }
            return h.toString(36) + '-' + s.length.toString(36);
        }

        function aiSessPersonaSnapshot() {
            const o = {};
            AI_PERSONA_FIELDS.forEach(k => {
                o[k] = aiSessClone(aiConfig[k] === undefined ? null : aiConfig[k]);
            });
            return o;
        }

        function aiSessPersonaKey(snap) {
            return aiSessHash(JSON.stringify(snap));
        }

        // 世界书条目数。ST 的 entries 既可能是数组也可能是对象（218 里两种都认），
        // 所以这里也两种都数 —— 只数一种的话标签会永远显示「0 条」
        function aiSessLoreCount(lore) {
            if (!lore) return 0;
            const e = lore.entries;
            if (Array.isArray(e)) return e.length;
            if (e && typeof e === 'object') return Object.keys(e).length;
            return 0;
        }

        // 一句话说清「这段用的是什么人设」。面板每行都要显示它 ——
        // 不然「切换时会换人设」这件事用户根本看不出来
        function aiSessPersonaLabel(snap) {
            if (!snap) return '（人设未知）';
            if (snap.tavernEnabled === true) {
                const card = snap.tavernCard;
                const name = card ? String(card.name || '').trim() : '';
                const n = aiSessLoreCount(snap.tavernLore);
                return '🎭 ' + (name || '未导入角色卡') + (n ? (' · 世界书 ' + n + ' 条') : '');
            }
            if (snap.promptEnabled === false) return '⭕ 已关闭系统提示词';
            const p = findPromptPreset(snap.promptPreset);
            return p ? ('📝 ' + p.label) : '📝 自定义提示词';
        }

        function aiSessTitleFrom(msgs) {
            const first = (msgs || []).filter(m => m && m.inHist === true && m.role === 'user')[0];
            if (!first) return AI_SESS_UNTITLED;
            const t = String(first.content == null ? '' : first.content).replace(/\s+/g, ' ').trim();
            if (!t) return AI_SESS_UNTITLED;
            return t.length > 24 ? (t.slice(0, 24) + '…') : t;
        }

        function aiSessDisplayTitle(s) {
            const t = String((s && s.title) || '').trim();
            return t || '未命名对话';
        }

        function aiSessTimeText(ms) {
            const d = new Date(Number(ms) || Date.now());
            const pad = n => (n < 10 ? '0' : '') + n;
            return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
        }

        function aiSessStamp(ms) {
            const d = new Date(Number(ms) || Date.now());
            const pad = n => (n < 10 ? '0' : '') + n;
            return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
                '-' + pad(d.getHours()) + pad(d.getMinutes());
        }

        function aiSessLoad() {
            let raw = null;
            try { raw = localStorage.getItem(AI_SESS_KEY); } catch (e) { raw = null; }
            if (!raw) return false;
            let parsed = null;
            try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
            if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.list)) return false;
            aiSessStore = {
                v: 1,
                active: String(parsed.active || ''),
                personas: (parsed.personas && typeof parsed.personas === 'object' && !Array.isArray(parsed.personas))
                    ? parsed.personas : {},
                list: parsed.list.filter(s => s && typeof s === 'object' && s.id)
            };
            // 手改过 / 老版本的那份可能缺字段，逐条补齐再上路
            aiSessStore.list.forEach(s => {
                s.id = String(s.id);
                s.title = String(s.title || '');
                s.at = Number(s.at) || Date.now();
                s.pid = String(s.pid || '');
                s.msgs = Array.isArray(s.msgs) ? s.msgs.filter(m => m && m.role) : [];
                if (!s.timed || typeof s.timed !== 'object') {
                    s.timed = { sticky: {}, cooldown: {}, msgCount: 0 };
                }
            });
            if (!aiSessStore.list.some(s => s.id === aiSessStore.active)) {
                aiSessStore.active = aiSessStore.list.length ? aiSessStore.list[0].id : '';
            }
            return true;
        }

        function aiSessPrune() {
            // 只留还被引用的人设快照
            const used = {};
            aiSessStore.list.forEach(s => {
                if (s.pid && aiSessStore.personas[s.pid]) used[s.pid] = aiSessStore.personas[s.pid];
            });
            aiSessStore.personas = used;
            // 条数上限：先扔最久没动过的，**当前这段绝不扔**
            if (aiSessStore.list.length > AI_SESS_MAX) {
                const cur = aiSessStore.list.filter(s => s.id === aiSessStore.active);
                const room = Math.max(0, AI_SESS_MAX - cur.length);
                const rest = aiSessStore.list
                    .filter(s => s.id !== aiSessStore.active)
                    .sort((a, b) => (b.at || 0) - (a.at || 0))
                    .slice(0, room);
                aiSessStore.list = cur.concat(rest);
            }
        }

        function aiSessPersist() {
            const write = () => {
                localStorage.setItem(AI_SESS_KEY, JSON.stringify({
                    v: 1,
                    active: aiSessStore.active,
                    personas: aiSessStore.personas,
                    list: aiSessStore.list
                }));
            };
            try { write(); return true; }
            catch (e) {
                // 多半是配额满了（世界书太大 / 会话太长）。把最老的一半扔掉再试一次。
                // ⚠ 当前这段**绝不能扔** —— 扔了就成「刚聊完、一刷新没了」
                const keep = aiSessStore.list.filter(s => s.id === aiSessStore.active);
                const room = Math.max(0, Math.ceil((aiSessStore.list.length - keep.length) / 2));
                const rest = aiSessStore.list
                    .filter(s => s.id !== aiSessStore.active)
                    .sort((a, b) => (b.at || 0) - (a.at || 0))
                    .slice(0, room);
                aiSessStore.list = keep.concat(rest);
                aiSessPrune();
                try {
                    write();
                    updateAiStatus('⚠️ 浏览器存储快满了，已清掉最老的一半历史会话');
                    return true;
                } catch (e2) {
                    updateAiStatus('⚠️ 历史会话保存失败（浏览器存储已满）：' + e2.message);
                    return false;
                }
            }
        }

        function aiSessCurrent() {
            return aiSessStore.list.filter(s => s.id === aiSessStore.active)[0] || null;
        }

        function aiSessCreate() {
            const s = {
                id: aiSessUid(),
                title: '',
                at: Date.now(),
                pid: '',
                timed: { sticky: {}, cooldown: {}, msgCount: 0 },
                msgs: []
            };
            aiSessStore.list.unshift(s);
            return s;
        }

        function aiSessHasHistory(s) {
            return !!(s && (s.msgs || []).some(m => m && m.inHist === true));
        }

        // 从 DOM 反读气泡。为什么读 DOM 而不是直接存 chatHistory：
        //   chatHistory 只留最后 40 条（发给模型的上限），而 DOM 里是**整段可见的对话**。
        //   导出 / 切回来要的是后者；只有 inHist 的那些才进模型上下文。
        function aiSessCollectBubbles() {
            const box = document.getElementById('ai-messages');
            if (!box) return [];
            const nodes = box.querySelectorAll('#ai-messages > .ai-msg');
            const out = [];
            for (let i = 0; i < nodes.length; i++) {
                const n = nodes[i];
                // 「请求失败」「思考中…」不是对话内容 —— 存进去下次打开会看到一条假消息
                if (n.querySelector('.ai-bubble.failed') || n.querySelector('.ai-bubble.loading')) continue;
                const b = n.querySelector('.ai-bubble');
                const hasHist = !!(n.dataset.historyRole &&
                    (n.dataset.historyRole === 'user' || n.dataset.historyRole === 'assistant'));
                const role = hasHist ? n.dataset.historyRole
                    : (n.classList.contains('from-user') ? 'user' : 'assistant');
                const content = hasHist ? (n.dataset.historyContent || '') : (b ? b.textContent : '');
                // token 用量跟着气泡一起存 —— 不存的话切回来这段对话的
                // 「花了多少」就凭空消失了（而用户刚要求每个调用点都看得见）
                let usage = null;
                if (n.dataset.usage) {
                    try { usage = JSON.parse(n.dataset.usage); } catch (e) { usage = null; }
                }
                const rec = { role: role, content: String(content), inHist: hasHist };
                if (usage && (usage.in || usage.out)) rec.usage = usage;
                out.push(rec);
            }
            return out.slice(-AI_SESS_MAX_MSGS);
        }

        function aiSessSaveCurrent() {
            const cur = aiSessCurrent();
            if (!cur) return false;
            cur.msgs = aiSessCollectBubbles();
            cur.at = Date.now();
            cur.timed = aiSessClone(aiConfig.tavernTimed) ||
                { sticky: {}, cooldown: {}, msgCount: 0 };
            const snap = aiSessPersonaSnapshot();
            const pid = aiSessPersonaKey(snap);
            aiSessStore.personas[pid] = snap;
            cur.pid = pid;
            // ⚠ 标题要在「还没有真标题」时一直重算。
            //   空会话一建出来就会被写成「新对话」，那是**占位符**不是标题 ——
            //   写成 `if (!cur.title)` 的话第一句用户消息进来时它已经非空，
            //   于是每一段都永远叫「新对话」（踩过：探针 B5 红在这里）
            const t = aiSessTitleFrom(cur.msgs);
            if (t !== AI_SESS_UNTITLED || !cur.title) cur.title = t;
            aiSessPrune();
            return aiSessPersist();
        }

        // 把人设快照写回 aiConfig 并把控件全部刷一遍。
        // ⚠ 刷新顺序**照 initAiArea() 的收口顺序**，别自己另写一份 ——
        //   少一步就会留下「配置是对的、但面板上显示的还是上一份」的假状态
        function aiSessApplyPersona(snap) {
            if (!snap || typeof snap !== 'object') return false;
            AI_PERSONA_FIELDS.forEach(k => {
                if (!(k in snap)) return;
                aiConfig[k] = aiSessClone(snap[k]);
            });
            // 系统提示词那格 syncPromptPresetUI() 不管（它只点预设小圆点），自己回填
            const ta = document.getElementById('ai-system-prompt');
            if (ta) ta.value = aiConfig.systemPrompt || '';
            renderPromptPresets();
            syncPromptPresetUI();
            renderPromptUI();      // 系统提示词开关的勾 + 灰化
            renderTavernUI();      // 酒馆开关 / 角色卡 / 世界书 / 预设 / 预览
            fillUserMacroInputs();
            syncUserMacroUI();
            syncAiCfgSourceUI();   // 最后收口「配置来源」，它才是 API 那批字段的最终来源
            aiPersist();
            return true;
        }

        // withPersona：切换会话时 true（这是需求本体）；
        //              页面刚打开时 false（见 aiSessionInit 的注释）
        function aiSessRestore(s, withPersona) {
            if (!s) return;
            if (withPersona) {
                const snap = aiSessStore.personas[s.pid];
                if (snap) aiSessApplyPersona(snap);
            }
            // 世界书黏性 / 冷却时钟跟着会话走。不恢复的话，切回一段旧对话会带着
            // **另一段**的冷却状态 —— 世界书条目会莫名其妙不触发
            const t = s.timed;
            aiConfig.tavernTimed = (t && typeof t === 'object') ? {
                sticky: (t.sticky && typeof t.sticky === 'object') ? aiSessClone(t.sticky) : {},
                cooldown: (t.cooldown && typeof t.cooldown === 'object') ? aiSessClone(t.cooldown) : {},
                msgCount: Number(t.msgCount) || 0
            } : { sticky: {}, cooldown: {}, msgCount: 0 };
            aiPersist();

            const box = document.getElementById('ai-messages');
            if (!box) return;
            box.innerHTML = '';
            chatHistory = [];
            (s.msgs || []).forEach(m => {
                if (!m || !m.role) return;
                const isUser = (m.role === 'user');
                const text = String(m.content == null ? '' : m.content);
                const inHist = (m.inHist === true);
                const bubble = appendAiBubble(isUser ? 'user' : 'ai', text, {
                    retryable: !isUser && inHist
                });
                // 恢复用量标签（在 appendAiBubble 之后 —— 那时 .ai-msg 外层才在 DOM 里）
                if (m.usage) setBubbleUsage(bubble, m.usage);
                if (inHist) {
                    // ⚠ 必须补 setBubbleHistory —— 否则「重试」那条路只能靠 DOM 还原，
                    //   而它读的正是 dataset.historyRole / historyContent
                    setBubbleHistory(bubble, m.role, text);
                    chatHistory.push({ role: m.role, content: text });
                }
            });
            if (chatHistory.length > AI_CHAT_HIST_MAX) chatHistory = chatHistory.slice(-AI_CHAT_HIST_MAX);
            if (!box.querySelector('.ai-msg')) appendAiGreeting();
            scrollAiMessagesToBottom();
        }

        function aiSessSwitch(id) {
            if (aiBusy) { updateAiStatus('⚠️ 正在回复中，等这条说完再切'); return; }
            if (!id) return;
            if (id === aiSessStore.active) { toggleAiHistory(false); return; }
            const s = aiSessStore.list.filter(x => x.id === id)[0];
            if (!s) return;
            aiSessSaveCurrent();          // 先把当前这段（连同它的人设）落下来
            aiSessStore.active = id;
            aiSessRestore(s, true);       // 切换 = 连人设一起切回来（需求本体）
            aiSessSaveCurrent();          // 让人设快照跟上「现在生效的那份」
            aiSessRenderList();
            toggleAiHistory(false);
            updateAiStatus('🕘 已切到「' + aiSessDisplayTitle(s) + '」· ' +
                aiSessPersonaLabel(aiSessStore.personas[s.pid]));
        }

        function aiSessDrop(id, ev) {
            if (ev) { ev.stopPropagation(); ev.preventDefault(); }
            const s = aiSessStore.list.filter(x => x.id === id)[0];
            if (!s) return;
            if (!window.confirm('删掉会话「' + aiSessDisplayTitle(s) + '」？删了就找不回来了。')) return;
            aiSessStore.list = aiSessStore.list.filter(x => x.id !== id);
            if (aiSessStore.active === id) {
                // ⚠ 这里**不能**先 aiSessSaveCurrent() —— 那会把刚删掉的这段又写回来
                const next = aiSessStore.list.slice().sort((a, b) => (b.at || 0) - (a.at || 0))[0];
                if (next) {
                    aiSessStore.active = next.id;
                    aiSessRestore(next, true);
                } else {
                    aiSessStore.active = '';
                    const fresh = aiSessCreate();
                    aiSessStore.active = fresh.id;
                    chatHistory = [];
                    wiResetTimed();
                    const box = document.getElementById('ai-messages');
                    if (box) box.innerHTML = '';
                    appendAiGreeting();
                }
            }
            aiSessSaveCurrent();
            aiSessRenderList();
            updateAiStatus('🗑 已删除会话');
        }

        function aiSessRenderList() {
            const list = document.getElementById('ai-hist-list');
            const cnt = document.getElementById('ai-hist-count');
            if (!list) return;
            if (cnt) cnt.textContent = aiSessStore.list.length ? ('共 ' + aiSessStore.list.length + ' 段') : '';
            list.innerHTML = '';
            const sorted = aiSessStore.list.slice().sort((a, b) => (b.at || 0) - (a.at || 0));
            if (!sorted.length) {
                const e = document.createElement('div');
                e.className = 'ai-hist-empty';
                e.textContent = '还没有历史会话。发一条消息就会自动记下来。';
                list.appendChild(e);
                return;
            }
            sorted.forEach(s => {
                const row = document.createElement('div');
                row.className = 'ai-hist-row' + (s.id === aiSessStore.active ? ' ai-hist-cur' : '');
                row.title = '点一下切到这段对话（人设也会一起切回来）';

                const main = document.createElement('div');
                main.className = 'ai-hist-main';

                const name = document.createElement('div');
                name.className = 'ai-hist-name';
                name.textContent = aiSessDisplayTitle(s);
                main.appendChild(name);

                const meta = document.createElement('div');
                meta.className = 'ai-hist-meta';
                const who = document.createElement('span');
                who.className = 'ai-hist-persona';
                who.textContent = aiSessPersonaLabel(aiSessStore.personas[s.pid]);
                meta.appendChild(who);
                const info = document.createElement('span');
                const n = (s.msgs || []).filter(m => m && m.inHist === true).length;
                info.textContent = aiSessTimeText(s.at) + ' · ' + n + ' 条';
                meta.appendChild(info);
                main.appendChild(meta);
                row.appendChild(main);

                const tools = document.createElement('div');
                tools.className = 'ai-hist-tools';

                const eb = document.createElement('button');
                eb.type = 'button';
                eb.className = 'ai-hist-btn';
                eb.title = '导出这一段（Markdown）';
                eb.textContent = '⬇';
                eb.onclick = (ev) => { ev.stopPropagation(); aiExportSession(s.id, 'md'); };
                tools.appendChild(eb);

                const db = document.createElement('button');
                db.type = 'button';
                db.className = 'ai-hist-btn ai-hist-del';
                db.title = '删除这一段';
                db.textContent = '✕';
                db.onclick = (ev) => aiSessDrop(s.id, ev);
                tools.appendChild(db);

                row.appendChild(tools);
                row.onclick = () => aiSessSwitch(s.id);
                list.appendChild(row);
            });
        }

        function toggleAiHistory(force) {
            const panel = document.getElementById('ai-hist-panel');
            if (!panel) return;
            const open = (force === undefined) ? !panel.classList.contains('ai-hist-on') : !!force;
            if (open) {
                // 打开面板顺手存一次 —— 不然「刚聊完就切走」那一句会丢
                aiSessSaveCurrent();
                aiSessRenderList();
            }
            panel.classList.toggle('ai-hist-on', open);
            const btn = document.getElementById('ai-hist-btn');
            if (btn) btn.classList.toggle('active', open);
        }

        // —— 导出 ——

        function aiSessFileBase(s) {
            return 'ai-chat-' + stSafeFileName(aiSessDisplayTitle(s)) + '-' + aiSessStamp(s && s.at);
        }

        // 人读版。JSON 那份是给「以后能导回来」留的，这份是给「现在就想看」用的
        function aiSessTranscript(s) {
            const snap = aiSessStore.personas[s.pid] || null;
            const msgs = (s.msgs || []).filter(m => m && m.role && String(m.content == null ? '' : m.content).trim());
            const cardName = (snap && snap.tavernEnabled === true && snap.tavernCard)
                ? String(snap.tavernCard.name || '').trim() : '';
            const who = cardName || getMacroContext().charName || 'AI';
            const inHist = msgs.filter(m => m.inHist === true).length;
            const lines = [];
            lines.push('# AI 对话记录 · ' + aiSessDisplayTitle(s));
            lines.push('');
            lines.push('- 会话时间：' + aiSessStamp(s.at));
            lines.push('- 人设：' + aiSessPersonaLabel(snap));
            lines.push('- 消息：' + msgs.length + ' 条（其中 ' + inHist + ' 条进入模型上下文）');
            lines.push('');
            lines.push('---');
            lines.push('');
            msgs.forEach(m => {
                lines.push(m.role === 'user' ? '**你**' : ('**' + who + '**'));
                lines.push('');
                lines.push(String(m.content == null ? '' : m.content));
                lines.push('');
            });
            return lines.join('\n');
        }

        function aiExportSession(id, fmt) {
            if (!id) aiSessSaveCurrent();
            const s = id
                ? aiSessStore.list.filter(x => x.id === id)[0]
                : aiSessCurrent();
            if (!s) { updateAiStatus('⚠️ 没有可导出的会话'); return; }
            try {
                if (fmt === 'json') {
                    const snap = aiSessStore.personas[s.pid] || null;
                    stDownload(aiSessFileBase(s) + '.json', new Blob([
                        JSON.stringify({
                            app: 'saki', kind: 'ai-chat', v: 1,
                            exportedAt: new Date().toISOString(),
                            title: aiSessDisplayTitle(s),
                            at: s.at,
                            personaLabel: aiSessPersonaLabel(snap),
                            persona: snap,
                            timed: s.timed || null,
                            messages: s.msgs || []
                        }, null, 2)
                    ], { type: 'application/json' }));
                } else {
                    stDownload(aiSessFileBase(s) + '.md', new Blob(
                        [aiSessTranscript(s)], { type: 'text/markdown;charset=utf-8' }));
                }
                updateAiStatus('⬇ 已导出「' + aiSessDisplayTitle(s) + '」');
            } catch (e) {
                updateAiStatus('⚠️ 导出失败：' + e.message);
            }
        }

        function aiExportAll() {
            aiSessSaveCurrent();
            const sorted = aiSessStore.list.slice().sort((a, b) => (a.at || 0) - (b.at || 0));
            if (!sorted.length) { updateAiStatus('⚠️ 还没有历史会话'); return; }
            const head = '# AI 对话记录（全部 ' + sorted.length + ' 段）\n\n导出时间：' +
                aiSessStamp(Date.now()) + '\n\n';
            const body = sorted.map(s => aiSessTranscript(s)).join('\n\n---\n\n');
            try {
                stDownload('ai-chat-all-' + aiSessStamp(Date.now()) + '.md',
                    new Blob([head + body], { type: 'text/markdown;charset=utf-8' }));
                updateAiStatus('⬇ 已导出全部 ' + sorted.length + ' 段会话');
            } catch (e) {
                updateAiStatus('⚠️ 导出失败：' + e.message);
            }
        }

        // —— 启动 ——

        function aiSessionInit() {
            aiSessLoad();
            let cur = aiSessCurrent();
            if (!cur) {
                cur = aiSessCreate();
                aiSessStore.active = cur.id;
            }
            // ⚠⚠ 这里**不**恢复人设（withPersona = false）。
            //   页面刚打开时 aiConfig 才是「现在生效的那份」，会话里那份是「当时用的那份」。
            //   反过来做的话，用户导入一张新卡、刷新一下就被旧快照盖掉了。
            //   只有用户**主动切到别的会话**时，才拿快照覆盖 —— 那才是需求要的语义。
            aiSessRestore(cur, false);
            aiSessSaveCurrent();   // 用「现在生效的人设」刷新当前这段的快照
            aiSessRenderList();
            document.addEventListener('keydown', aiSessKeydown);
        }

        function aiSessKeydown(e) {
            // 输入法组字中的 Esc 是「取消选字」，不是「关面板」
            if (e.isComposing || e.keyCode === 229) return;
            if (e.key !== 'Escape') return;
            const panel = document.getElementById('ai-hist-panel');
            if (panel && panel.classList.contains('ai-hist-on')) {
                toggleAiHistory(false);
                e.stopPropagation();
            }
        }

