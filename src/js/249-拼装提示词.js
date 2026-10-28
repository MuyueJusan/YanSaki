        // ===== 拼装提示词 =====

        function greetingList() {
            const c = aiConfig.tavernCard;
            if (!c) return [];
            const out = [];
            if (c.firstMes) out.push({ label: '主开场白', text: c.firstMes });
            (c.alternateGreetings || []).forEach((g, i) => out.push({ label: '备选开场白 ' + (i + 1), text: g }));
            return out;
        }

        function getActiveGreeting() {
            const list = greetingList();
            if (!list.length) return '';
            const idx = Number(aiConfig.tavernGreetingIndex) || 0;
            return (list[idx] || list[0]).text;
        }

        // 把 mes_example 拆成真正的 user/assistant 消息对（SillyTavern 就是这么做的）
        function parseExampleMessages(text, charName, userName) {
            const s = String(text || '');
            if (!s.trim()) return [];
            const out = [];
            const matchWho = who => {
                const w = who.trim();
                if (w === '{{char}}' || w === charName) return 'assistant';
                if (w === '{{user}}' || w === userName) return 'user';
                if (w.toLowerCase() === String(charName).toLowerCase()) return 'assistant';
                if (w.toLowerCase() === String(userName).toLowerCase()) return 'user';
                return null;
            };
            for (const block of s.split(/<START>/i)) {
                let cur = null;
                for (const line of block.split('\n')) {
                    const m = line.match(/^\s*([^:：\n]{1,40}?)\s*[:：]\s*([\s\S]*)$/);
                    const role = m ? matchWho(m[1]) : null;
                    if (role) {
                        if (cur) out.push(cur);
                        cur = { role, content: m[2].trim() };
                    } else if (cur) {
                        cur.content += '\n' + line;
                    }
                }
                if (cur) out.push(cur);
            }
            return out.map(m => ({ role: m.role, content: m.content.trim() })).filter(m => m.content);
        }

        function entryLabel(e) {
            return e.comment || (e.constant ? '常驻条目' : (e.keys[0] || '未命名条目'));
        }

        // 把聊天历史 + 对话内注入合成最终的消息序列。
        // 直接照搬 SillyTavern populationInjectionPrompts 的做法：把消息倒过来（下标 0 = 最新一条），
        // 按 depth 从小到大 splice，最后再倒回去。这样连「depth 超过聊天条数」这种边角行为都一致
        // （ST 里会落到聊天的最前面，而不是被丢掉）。
        //
        // injections 是一个扁平的注入点列表：{ depth, order, role, seq, content, label }
        //   depth  —— 注入深度
        //   order  —— ST 的 injection_order，同一个深度里大的先收集（倒序分组）
        //   role   —— 0/1/2
        //   seq    —— 同一个「深度 + order + 角色」里的先后（ST 里是
        //             预设槽 → 扩展注册表里的作者注释 → 世界书 @D，靠 id 字典序排出来的）
        function applyDepthEntries(history, injections) {
            // 一定要先倒序：ST 里 messages 在 populationInjectionPrompts 进来时就是倒序的
            // （下标 0 = 最新一条），splice 的坐标是按这个倒序数组算的
            const rev = history.map(m => ({ role: m.role, text: m.text, kind: m.kind, label: m.label })).reverse();
            const depths = [...new Set(injections.map(i => i.depth))]
                .filter(d => d >= 0 && d <= WI_MAX_INJECTION_DEPTH)
                .sort((a, b) => a - b);
            let totalInserted = 0;
            for (const d of depths) {
                const atDepth = injections.filter(i => i.depth === d);
                // ST：同一深度里按 injection_order 倒序分组处理
                const orders = [...new Set(atDepth.map(i => i.order))].sort((a, b) => b - a);
                const roleMessages = [];
                for (const order of orders) {
                    const inOrder = atDepth.filter(i => i.order === order);
                    // 同一深度同一 order 里按 system → user → assistant 收集，和 ST 的 roles 顺序一致
                    for (const roleNum of [0, 1, 2]) {
                        const role = WI_ROLE[roleNum];
                        const items = inOrder
                            .filter(i => i.role === roleNum)
                            .sort((a, b) => (a.seq || 0) - (b.seq || 0));
                        if (!items.length) continue;
                        const text = items.map(i => String(i.content).trim())
                            .filter(Boolean).join('\n');
                        if (!text) continue;
                        roleMessages.push({
                            role,
                            kind: 'wi',
                            text,
                            label: '@D' + d + ' ' + (WI_ROLE_LABEL[roleNum] || role) +
                                ' · ' + items.map(i => i.label).filter(Boolean).join('、')
                        });
                    }
                }
                if (!roleMessages.length) continue;
                rev.splice(d + totalInserted, 0, ...roleMessages);
                totalInserted += roleMessages.length;
            }
            return rev.reverse();
        }

        // 返回 { layout, messages, worldInfo }：layout 带来源标签（给预览用），
        // messages 是真正发出去的，worldInfo 是这一轮的扫描结果（给界面做诊断用）
        function buildRequestPlan(opts) {
            const dryRun = !!(opts && opts.dryRun);
            const layout = [];
            const add = (role, kind, label, text) => {
                if (text === undefined || text === null || text === '') return;
                layout.push({ role, kind, label, text: String(text) });
            };
            const M = applyCardMacros;

            // 「第一段」永远排在最前面 —— 用户自己写的那段话，
            // 系统提示词 / 酒馆模式拼出来的提示词 / 全部聊天记录统统排在它后面。
            // 空着就不插（add 自己会跳过空串），所以没填过的用户产物一个字节都不变。
            // ⚠ 放在两条 return 之前，是为了让「开不开酒馆模式」都一样生效
            add('system', 'first', '第一段', firstSegText());

            if (!tavernEnabled()) {
                // 原系统提示词被关掉时就不发主提示词（聊天历史照常发）
                if (aiConfig.promptEnabled !== false) {
                    add('system', 'main', '系统提示词', buildSystemPrompt());
                }
                chatHistory.forEach((m, i) => add(m.role, m.role === 'user' ? 'user' : 'ai',
                    (m.role === 'user' ? '你' : 'AI') + ' · 第 ' + (i + 1) + ' 条', m.content));
                return { layout, messages: layout.map(x => ({ role: x.role, content: x.text })), worldInfo: null };
            }

            const c = aiConfig.tavernCard || {};
            const wi = scanWorldInfo(chatHistory, dryRun);
            const preset = getActivePreset();

            // ST 把每个非深度位置桶用 \n 拼成「一条」消息再塞进提示词
            // （world-info.js:5265 worldInfoBefore = WIBeforeEntries.join('\n')），
            // 所以这里也拼成一条，预览里用 label 说明这条里都有谁。
            // 世界书内容里的宏在扫描阶段就展开过了，这里直接拼，不要再展开一次
            const bucketText = list => list.map(e => e.content).join('\n');
            const bucketLabel = (prefix, list) => prefix + ' · ' +
                (list.length > 1 ? list.length + ' 条：' : '') + list.map(entryLabel).join('、');

            // 作者注释：↑AT / ↓AT 夹住它，整体按注释自己的位置注入。
            // 这一轮不该插注释时 anText 就是空，↑AT / ↓AT 也跟着不插（ST 原样）
            const anText = anBlockText(wi);
            const anPos = anPosition();
            // 人设位置是「作者注释上方 / 下方」时它就在注释正文里，预览得标一下，
            // 不然用户会以为人设没生效（这一条只是显示用的标签，不影响发出去的内容）
            const anLabelFull = AN_LABEL + (personaRidesAn() ? '（内含' + PERSONA_LABEL + '）' : '');

            // 示例对话：能拆成消息对就拆，拆不出来退回文本。
            // 世界书的 ↑EM / ↓EM 条目是 unshift / push 进示例对话前后的（ST 原样），
            // 所以它们跟着 dialogueExamples 这个槽一起走 —— 槽关掉就一起不插
            let exampleRows = [];
            if (wi.emTop.length) {
                exampleRows.push({
                    role: 'system', kind: 'wi',
                    label: bucketLabel('↑EM', wi.emTop), text: bucketText(wi.emTop)
                });
            }
            if (c.mesExample) {
                const resolved = M(c.mesExample);
                const examples = parseExampleMessages(resolved, getMacroContext().charName,
                    getMacroContext().address || 'user');
                if (examples.length) {
                    examples.forEach((m, i) => exampleRows.push({
                        role: m.role, kind: m.role === 'user' ? 'user' : 'ai',
                        label: '示例对话 ' + (i + 1) + (m.role === 'user' ? '（用户）' : '（AI）'),
                        text: m.content
                    }));
                } else {
                    exampleRows.push({
                        role: 'system', kind: 'example',
                        label: '示例对话 mes_example（未能拆成消息对）', text: resolved
                    });
                }
            }
            if (wi.emBottom.length) {
                exampleRows.push({
                    role: 'system', kind: 'wi',
                    label: bucketLabel('↓EM', wi.emBottom), text: bucketText(wi.emBottom)
                });
            }

            // 聊天历史（对话内注入稍后插进去）
            const hist = chatHistory.map((m, i) => ({
                role: m.role, text: m.content,
                kind: m.role === 'user' ? 'user' : 'ai',
                label: (m.role === 'user' ? '你' : 'AI') + ' · 第 ' + (i + 1) + ' 条'
            }));

            // ===== 对话内注入点 =====
            // ST 里同一个「深度 + injection_order + 角色」的内容会按注册顺序拼成一条消息。
            // seq 就是那个注册顺序。ST 的 getExtensionPrompt 是 Object.keys().sort()
            // 之后再取的，也就是按 key 的字典序 —— 大写字母排在前面：
            //   '2_floating_prompt'（作者注释） < 'DEPTH_PROMPT' < 'PERSONA_DESCRIPTION'（人设）
            //     < 'QUIET_PROMPT' < 'chromadb' < 'customDepthWI_<depth>_<role>'（世界书 @D）
            // 所以顺序是：预设的绝对注入槽 → 作者注释 → 用户人设描述 → 世界书 @D
            const injections = [];
            // 世界书 @D：ST 没给它们设 injection_order，所以恒为默认值 100
            wi.depth.forEach(g => g.entries.forEach(e => injections.push({
                depth: g.depth, order: PM_DEFAULT_ORDER,
                role: (g.role == null ? 0 : g.role), seq: 3,
                content: e.content, label: entryLabel(e)
            })));
            // 作者注释：位置 = 对话内时也走这条路
            if (anText && anPos === AN_POS.inChat) {
                injections.push({
                    depth: anDepth(), order: PM_DEFAULT_ORDER, role: anRole(),
                    seq: 1, content: anText, label: anLabelFull
                });
            }
            // 用户人设描述：位置 = 对话内时是一条独立的注入点，深度 / 角色用它自己的设置
            // （ST script.js:3222 那一段，读的是 persona_description_depth / _role，
            //   跟预设槽无关 —— 槽关掉也不影响它）
            if (personaRaw() && personaPosition() === PERSONA_POS.atDepth) {
                injections.push({
                    depth: personaDepth(), order: PM_DEFAULT_ORDER, role: personaRole(),
                    seq: 2, content: personaText(), label: PERSONA_LABEL
                });
            }

            // ===== 按预设的 prompt_order 走一遍 =====
            const slotOf = id => preset.prompts.find(p => p.identifier === id);
            const ctx = { card: c, wi: wi, bucketText: bucketText };
            // 槽的文本从哪来：
            //   ① marker 槽 —— 内容 100% 由应用填（世界书 / 角色卡字段 / 聊天记录）
            //   ② main / jailbreak —— 预设里可以写内容，但角色卡自带字段会盖掉它
            //   ③ 其余槽 —— 就用预设里写的内容
            const slotText = s => (s.marker || PM_CARD_OVERRIDABLE.indexOf(s.identifier) >= 0)
                ? presetMarkerText(s.identifier, s, ctx)
                : (s.content ? M(s.content) : '');
            // parts 里按顺序存「一段东西」：一批行 / 示例对话 / 聊天历史。
            // 示例对话和聊天历史是一个槽展开成好几条消息，所以要留位子
            const parts = [];
            const rows = [];
            const flushRows = () => { if (rows.length) { parts.push({ kind: 'rows', rows: rows.splice(0) }); } };
            // main 槽在哪，作者注释的相对位置就跟着哪（ST 的 injectToMain）
            let anBeforeMain = anText && anPos === AN_POS.beforePrompt ? anText : '';
            let anAfterMain = anText && anPos === AN_POS.inPrompt ? anText : '';
            let sawMain = false;
            let sawHistory = false;

            for (const orderEntry of preset.order) {
                const slot = slotOf(orderEntry.identifier);
                if (!slot) continue;
                if (orderEntry.enabled === false) continue;
                // injection_trigger 非空时只在该生成类型下生效（本应用只有 normal）
                if (slot.injectionTrigger.length &&
                    slot.injectionTrigger.indexOf(PM_GENERATION_TYPE) < 0) continue;

                // ① 绝对注入槽：从顺序流里摘出来，按深度注进对话
                if (slot.injectionPosition === PM_INJECTION.absolute) {
                    const text = slotText(slot);
                    if (text) {
                        injections.push({
                            depth: slot.injectionDepth, order: slot.injectionOrder,
                            role: slot.role, seq: 0, content: text, label: slot.name
                        });
                    }
                    continue;
                }

                // ② 多消息槽：留个位子，最后再展开
                if (slot.identifier === 'dialogueExamples') {
                    flushRows();
                    parts.push({ kind: 'examples' });
                    continue;
                }
                if (slot.identifier === 'chatHistory') {
                    flushRows();
                    parts.push({ kind: 'history' });
                    sawHistory = true;
                    continue;
                }

                // ③ 普通槽
                const text = slotText(slot);
                if (slot.identifier === 'main') {
                    sawMain = true;
                    // 作者注释的相对位置就贴着 main（ST 的 injectToMain 'start' / 'end'）
                    if (anBeforeMain) { rows.push(anRow(anLabelFull + '（提示词之前）', anBeforeMain)); anBeforeMain = ''; }
                    if (text) rows.push(slotRow(slot, text));
                    if (anAfterMain) { rows.push(anRow(anLabelFull + '（提示词内）', anAfterMain)); anAfterMain = ''; }
                    continue;
                }
                if (!text) continue;
                rows.push(slotRow(slot, text));
            }
            flushRows();

            // main 槽不存在（或没启用）时，作者注释别丢 —— 放到最前面
            const orphanAn = anBeforeMain || anAfterMain;
            if (orphanAn) parts.unshift({ kind: 'rows', rows: [anRow(anLabelFull + '（提示词之前）', orphanAn)] });

            // ===== 展开 =====
            const finalLayout = [];
            for (const part of parts) {
                if (part.kind === 'rows') finalLayout.push(...part.rows);
                else if (part.kind === 'examples') finalLayout.push(...exampleRows);
                else if (part.kind === 'history') finalLayout.push(...applyDepthEntries(hist, injections));
            }
            return {
                layout: finalLayout,
                messages: finalLayout.map(x => ({ role: x.role, content: x.text })),
                worldInfo: wi,
                preset: preset,
                hasHistorySlot: sawHistory,
                hasMainSlot: sawMain,
            };

            // —— 小工具 ——
            function slotRow(slot, text) {
                // main / jailbreak 的内容虽然可以在预设里写，但配色按「角色卡字段」算
                const usesCard = slot.marker || PM_CARD_OVERRIDABLE.indexOf(slot.identifier) >= 0;
                let label = slot.name;
                if (PM_CARD_OVERRIDABLE.indexOf(slot.identifier) >= 0) {
                    const field = slot.identifier === 'main' ? 'systemPrompt' : 'postHistoryInstructions';
                    const fromCard = !!(ctx.card && ctx.card[field]);
                    label += '（' + (fromCard && !slot.forbidOverrides ? '角色卡自带字段' : '预设内容') + '）';
                }
                return {
                    role: WI_ROLE[slot.role] || 'system',
                    kind: usesCard ? (PM_MARKER_KIND[slot.identifier] || 'prompt') : 'prompt',
                    label: label, text: String(text)
                };
            }
            function anRow(label, text) {
                return { role: 'system', kind: 'an', label: label, text: String(text) };
            }
        }

        // marker 槽的内容由应用填（ST 里这些槽在预设中只是占位）。
        // main / jailbreak 会被角色卡自带的字段覆盖 —— 就是 ST 的
        // systemPromptOverride / jailbreakPromptOverride，除非槽标了 forbid_overrides
        function presetMarkerText(identifier, slot, ctx) {
            const M = applyCardMacros;
            switch (identifier) {
                case 'main':
                    if (ctx.card.systemPrompt && !slot.forbidOverrides) return M(ctx.card.systemPrompt);
                    return slot.content ? M(slot.content) : '';
                case 'jailbreak':
                    if (ctx.card.postHistoryInstructions && !slot.forbidOverrides) {
                        return M(ctx.card.postHistoryInstructions);
                    }
                    return slot.content ? M(slot.content) : '';
                case 'worldInfoBefore': return ctx.bucketText(ctx.wi.before);
                case 'worldInfoAfter': return ctx.bucketText(ctx.wi.after);
                case 'charDescription': return ctx.card.description ? M(ctx.card.description) : '';
                case 'charPersonality': return ctx.card.personality ? M(ctx.card.personality) : '';
                case 'scenario': return ctx.card.scenario ? M(ctx.card.scenario) : '';
                // 用户人设描述只在「位置 = 提示词内」时走预设槽（ST openai.js:1433
                // 那个 systemPrompts.push 就是被 position === IN_PROMPT 卡住的）。
                // 其余位置要么搭作者注释走，要么按深度注入，都不该在这里出内容
                case 'personaDescription':
                    return personaPosition() === PERSONA_POS.inPrompt ? personaText() : '';
                default: return slot.content ? M(slot.content) : '';
            }
        }

