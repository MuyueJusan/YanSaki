        // ===== 单条改写：只动世界书里指定的那一条 =====
        // 跟上面那套「批量新增」不是一回事，所以参数另开一组（en*）。
        // 批量那套问的是「生成几条、从哪取素材」，这套问的是
        // 「改哪一条、要不要参考别的条目」。

        // 参考范围。「同分组」只在条目自己带 group 时才有意义 ——
        // 没有分组就静默退回「仅启用」，免得给出一个永远参考不到东西的选项
        const ST_AI_REF_SCOPES = [
            { id: 'on', label: '仅启用', text: '只把「启用」状态的条目交给模型参考' },
            { id: 'all', label: '全部', text: '连已停用的条目也一并交给模型参考' },
            { id: 'same', label: '同分组', text: '只参考和本条同一个包含组（group）的条目' }
        ];

        function stAiEntryRefScope(target) {
            const s = stAiUi.enRefScope;
            if (s === 'same' && !String(target.group || '').trim()) return 'on';
            return (s === 'all' || s === 'same') ? s : 'on';
        }

        // 挑出「其他条目」里对模型真正有用的部分。整条整条地喂既超预算又没用 ——
        // 单条改写时被改的那一条才是主角，别的只负责「别写重、别写串」
        function stAiEntryRefRows(target, scope) {
            const list = stEditor.card.bookEntries || [];
            const tg = String(target.group || '').trim();
            const out = [];
            list.forEach((e, i) => {
                if (e.id === target.id) return;
                // 空壳（没正文也没关键词）参考了等于没参考，还白占额度
                if (!String(e.content || '').trim() && !e.keys.length) return;
                if (scope === 'on' && !e.enabled) return;
                if (scope === 'same' && (!tg || String(e.group || '').trim() !== tg)) return;
                out.push({ e: e, i: i });
            });
            return out;
        }

        function stAiEntryRefText(target, scope) {
            const rows = stAiEntryRefRows(target, scope);
            if (!rows.length) return '';
            return rows.slice(0, 40).map(r => {
                const e = r.e;
                const body = String(e.content || '').replace(/\s+/g, ' ').trim();
                return '· ' + (e.comment || '（无备注）') +
                    (e.keys.length ? '｜关键词：' + e.keys.join('、') : '') +
                    '｜' + (WI_POS_LABEL[e.position] || '?') +
                    (e.position === WI_POS.atDepth ? ' 深度 ' + e.depth : '') +
                    (e.enabled ? '' : '（已停用）') +
                    '\n  ' + (body.length > 200 ? body.slice(0, 200) + '…' : body);
            }).join('\n');
        }

        // 要改的那一条，完整摊开给模型 —— 单条改写不像批量新增，
        // 原条目本身就是最要紧的素材，不能只给摘要
        function stAiEntryBrief(e, maxLen) {
            const n = Math.max(200, Number(maxLen) || 2000);
            const body = String(e.content || '');
            const L = [];
            L.push('备注：' + (e.comment || '（没写）'));
            L.push('关键词：' + (e.keys.join('、') || '（空）'));
            if (e.secondaryKeys.length) L.push('次关键词：' + e.secondaryKeys.join('、'));
            L.push('位置：' + (WI_POS_LABEL[e.position] || '?') +
                (e.position === WI_POS.atDepth ? '（深度 ' + e.depth + '）' : '') +
                ' · 顺序 ' + e.order + (e.constant ? ' · 常驻' : '') +
                (e.enabled ? '' : ' · 已停用'));
            if (String(e.group || '').trim()) L.push('包含组：' + e.group);
            L.push('正文：\n' + (body.length > n ? body.slice(0, n) + '…' : (body || '（空）')));
            return L.join('\n');
        }

        function stAiEntryPlan(target) {
            const ui = stAiUi;
            const scope = stAiEntryRefScope(target);
            const refText = ui.enRef ? stAiEntryRefText(target, scope) : '';
            const reqs = [];
            ui.enReq.forEach(id => {
                const p = ST_AI_REQ_PRESETS.find(x => x.id === id);
                if (p) reqs.push(p.text);
            });
            const free = String(ui.enReqFree || '').trim();
            if (free) reqs.push(free);
            const fmt = ST_AI_FORMAT_PRESETS.find(p => p.id === ui.enFormat);
            const mood = stAiMoodText(ui.enMood, ui.enMoodFree);

            const sys = [
                '你是一位 SillyTavern 角色卡的世界书作者。现在只改写**一条**世界书条目。',
                '',
                '【输出格式（必须严格遵守）】',
                '只输出一个 JSON 对象。不要任何解释、寒暄、前后缀，不要 Markdown 围栏。结构：',
                '{"comment":"备注","keys":["关键词1","关键词2"],"secondary_keys":[],' +
                    '"content":"条目正文","constant":false,"position":0,"depth":4,"order":100}',
                '',
                '【字段说明】',
                '· comment：给自己看的备注，一句话，不超过 12 个字。',
                '· keys：触发关键词，3~6 个。必须是会真实出现在对话里的具体名词；' +
                    '不要用「的」「我」「很」「然后」这类泛词。',
                '· content：条目正文，写法见下面「正文格式」。',
                '· constant：true = 常驻（不看关键词一直生效），false = 靠关键词触发。',
                '· position：0 = 角色定义之前，1 = 角色定义之后，4 = 按深度插入对话。',
                '· depth：只在 position = 4 时有意义，一般 3~6。',
                '· order：插入顺序，默认 100。',
                '· **只输出这一个对象，不要包成数组。**'
            ].join('\n');

            const u = [];
            u.push('【要改写的条目】\n' + stAiEntryBrief(target, 2000));
            if (refText) {
                u.push('【其他世界书条目（参考用 —— 不要和它们写重，也不要和它们写串）】\n' + refText);
            }
            if (reqs.length) {
                u.push('【改写要求】\n' + reqs.map((t, i) => (i + 1) + '. ' + t).join('\n'));
            }
            u.push('【氛围】\n' + (mood || '不指定，跟着原条目走。'));
            u.push('【正文格式】\n' + (fmt ? fmt.text : '自然段落。'));
            if (ui.enKeepMeta) {
                u.push('【额外约束】\n用户会保留原条目的关键词 / 位置 / 深度 / 顺序，' +
                    '所以 keys / position / depth / order 照抄原条目即可，把力气全花在 content 上。');
            }
            return { system: sys, user: u.join('\n\n'), id: target.id, keepMeta: !!ui.enKeepMeta };
        }

        function stAiEnReqToggle(id) {
            const i = stAiUi.enReq.indexOf(id);
            if (i >= 0) stAiUi.enReq.splice(i, 1); else stAiUi.enReq.push(id);
            stAiRepaint();
        }

        // 展开 / 收起。**面板收着的时候一条参数都不渲染** —— 世界书动辄几十条，
        // 每条都铺开一整套（14 个要求 chip + 14 个氛围 chip + 7 个格式 chip …），
        // 光是按钮就上百个，而 stRerender() 每次都要整页重建一遍
        function stAiEntryToggle(ev, i) {
            const e = (stEditor.card.bookEntries || [])[i];
            if (!e) return;
            // 幂等：新渲染出来的 <details open> 也可能补一个 toggle 事件回来，
            // 这里两次都判一遍就不会打转
            if (ev.target.open) {
                if (stAiUi.enOpenId !== e.id) { stAiUi.enOpenId = e.id; stAiRepaint(); }
            } else if (stAiUi.enOpenId === e.id) {
                stAiUi.enOpenId = '';
                stAiRepaint();
            }
        }

        function stAiEntryPanel(e, i) {
            const ui = stAiUi;
            const open = ui.enOpenId === e.id;
            const pv = (ui.enPreview && ui.enPreview.id === e.id) ? ui.enPreview.entry : null;
            const running = ui.enRunning && ui.enRunId === e.id;
            const group = String(e.group || '').trim();

            if (!open) {
                return '<details class="st-ai-box st-ai-inline"' +
                    ' ontoggle="stAiEntryToggle(event,' + i + ')">' +
                    '<summary>✍ AI 改写这一条' +
                        (pv ? '<span class="st-chip st-on">有结果待套用</span>' : '') +
                    '</summary>' +
                    '<div class="st-ai-box-body"></div>' +
                    '</details>';
            }

            const scope = stAiEntryRefScope(e);
            const refRows = ui.enRef ? stAiEntryRefRows(e, scope) : [];
            const scopes = ST_AI_REF_SCOPES.filter(s => s.id !== 'same' || group);

            const body =
                stAiStatusHtml(stAiCfg()) +
                '<div class="st-checks">' +
                    '<label class="st-check" title="把其他条目的备注 / 关键词 / 正文摘要一并交给模型，免得改出来的东西跟别处打架">' +
                        '<input type="checkbox"' + (ui.enRef ? ' checked' : '') +
                        ' onchange="stAiUiSetR(\'enRef\',this.checked)">' +
                        '<span>参考其他世界书条目（' + (ui.enRef ? refRows.length + ' 条' : '已关闭') + '）</span>' +
                    '</label>' +
                '</div>' +
                (ui.enRef
                    ? '<div class="st-ai-chips">' + stAiChips(scopes, scope, 'stAiRefPick') + '</div>' +
                      (refRows.length
                          ? '<div class="st-ai-refs">' + escapeHtml(refRows.slice(0, 40).map(r =>
                                '· ' + (r.e.comment || '（无备注）') +
                                '｜' + (WI_POS_LABEL[r.e.position] || '?') +
                                (r.e.enabled ? '' : '（已停用）')).join('\n')) +
                            (refRows.length > 40 ? '\n…还有 ' + (refRows.length - 40) + ' 条没列出来' : '') +
                            '</div>'
                          : '<div class="st-note">按这个范围挑不出别的条目（可能别的都是空壳，' +
                            '或者本条就是唯一一条）。</div>')
                    : '') +
                '<div class="st-sub">改写要求 <span class="st-hint-inline">可多选，会按顺序拼成指令</span></div>' +
                '<div class="st-ai-chips">' + stAiChipsMulti(ST_AI_REQ_PRESETS, ui.enReq, 'stAiEnReqToggle') + '</div>' +
                '<div class="st-grid"><div class="st-field st-wide">' +
                    '<label for="st-ai-enreq-' + i + '">额外要求 <span class="st-hint-inline">' +
                        '自由写，比如「保留原来的关键词，只把正文写细」</span></label>' +
                    '<input id="st-ai-enreq-' + i + '" type="text" value="' + escapeHtml(ui.enReqFree) + '"' +
                        ' oninput="stAiUiSet(\'enReqFree\',this.value)">' +
                '</div></div>' +
                '<div class="st-sub">氛围</div>' +
                '<div class="st-ai-chips">' + stAiMoodChips('enMood', ui.enMood) + '</div>' +
                (ui.enMood === 'free'
                    ? '<div class="st-grid"><div class="st-field st-wide">' +
                        '<label for="st-ai-enmood-' + i + '">氛围描述</label>' +
                        '<input id="st-ai-enmood-' + i + '" type="text" value="' + escapeHtml(ui.enMoodFree) + '"' +
                            ' placeholder="比如：冷硬、克制，不写多余的心理活动"' +
                            ' oninput="stAiUiSet(\'enMoodFree\',this.value)">' +
                      '</div></div>'
                    : '') +
                '<div class="st-sub">正文格式</div>' +
                '<div class="st-ai-chips">' + stAiChips(ST_AI_FORMAT_PRESETS, ui.enFormat, 'stAiEnFormatPick') + '</div>' +
                '<div class="st-checks">' +
                    '<label class="st-check" title="勾上 = 只把新正文写回去，关键词 / 位置 / 深度 / 顺序全部保持原样">' +
                        '<input type="checkbox"' + (ui.enKeepMeta ? ' checked' : '') +
                        ' onchange="stAiUiSetR(\'enKeepMeta\',this.checked)">' +
                        '<span>只改正文，保留原关键词 / 位置 / 深度 / 顺序</span></label>' +
                '</div>' +
                stAiPlanPreview(stAiEntryPlan(e)) +
                '<div class="st-actions">' +
                    '<button class="st-big" type="button" onclick="stAiEntryRun(' + i + ')"' +
                        (running ? ' disabled' : '') + '>' +
                        (running ? '⏳ 生成中…' : '✨ 改写这一条') + '</button>' +
                    (ui.enRaw && ui.enRunId === e.id
                        ? '<button class="st-big st-plain" type="button" onclick="stAiCopyRaw(\'en\')">' +
                          '📋 复制原始回复</button>'
                        : '') +
                    (pv
                        ? '<button class="st-big" type="button" onclick="stAiEntryApply(' + i + ',\'replace\')">' +
                              '✅ 替换本条</button>' +
                          '<button class="st-big st-plain" type="button" onclick="stAiEntryApply(' + i + ',\'append\')">' +
                              '➕ 追加为新条目</button>' +
                          '<button class="st-big st-plain" type="button" onclick="stAiEntryClear()">✕ 丢弃结果</button>'
                        : '') +
                '</div>' +
                (ui.enErr && ui.enErrId === e.id
                    ? '<div class="st-ai-status st-bad">❌ ' + escapeHtml(ui.enErr) + '</div>' : '') +
                (ui.enMsg && ui.enMsgId === e.id
                    ? '<div class="st-ai-status st-ok">✅ ' + escapeHtml(ui.enMsg) + '</div>' : '') +
                (pv
                    ? '<div class="st-sub">生成结果（还没套用）</div>' +
                      '<div class="st-ai-kv">正文 ' + String(e.content || '').length + ' 字 → ' +
                          String(pv.content || '').length + ' 字 · ' +
                          (ui.enKeepMeta ? '套用时只换正文' : '套用时关键词 / 位置等也一并按模型的来') + '</div>' +
                      stAiEntryPreviewHtml([pv])
                    : '');

            return '<details class="st-ai-box st-ai-inline' + (running ? ' st-busy' : '') + '" open' +
                ' ontoggle="stAiEntryToggle(event,' + i + ')">' +
                '<summary>✍ AI 改写这一条' +
                    '<span class="st-chip">' + escapeHtml(e.comment || '（无备注）') + '</span>' +
                    (pv ? '<span class="st-chip st-on">有结果待套用</span>' : '') +
                '</summary>' +
                '<div class="st-ai-box-body">' + body + '</div>' +
                '</details>';
        }

        async function stAiEntryRun(i) {
            if (stAiUi.enRunning) return;
            const list = stEditor.card.bookEntries || [];
            const e = list[i];
            if (!e) return;
            const id = e.id;
            const cfg = stAiCfg();
            const ready = stAiReady(cfg);
            stAiUi.enErr = '';
            stAiUi.enErrId = '';
            stAiUi.enMsg = '';
            stAiUi.enMsgId = '';
            if (!ready.ok) {
                stAiUi.enErr = ready.why;
                stAiUi.enErrId = id;
                stAiUi.enOpenId = id;
                stRerender();
                return;
            }
            const plan = stAiEntryPlan(e);
            stAiUi.enOpenId = id;
            stAiUi.enRunning = true;
            stAiUi.enRunId = id;
            stAiUi.enPreview = null;
            stAiUi.enRaw = '';
            stRerender();
            try {
                const text = await stAiChat(stAiPlanMessages(plan),
                    { cfg: cfg, temperature: cfg.temperature, maxTokens: Math.max(1024, cfg.maxTokens) });
                // 生成期间用户可能把这一条删了 / 挪走了 —— 回来时按 id 重新找一遍，
                // 别拿着一个已经失效的下标往数组里写
                const cur = (stEditor.card.bookEntries || []).find(x => x.id === id);
                if (!cur) throw new Error('这一条已经不在世界书里了（生成期间被删掉了？）。');
                stAiUi.enRaw = text;
                const j = stAiJsonOf(text);
                if (!j.ok) {
                    throw new Error('模型没返回合法 JSON（' + j.error +
                        '）。可以点「复制原始回复」看看它到底说了什么。');
                }
                // 有些模型会习惯性包一层：裸数组、{entry:{}}、{entries:[{}]} 都认
                let obj = j.value;
                if (Array.isArray(obj)) obj = obj[0];
                else if (obj && typeof obj === 'object') {
                    if (obj.entry && typeof obj.entry === 'object') obj = obj.entry;
                    else if (Array.isArray(obj.entries)) obj = obj.entries[0];
                    else if (Array.isArray(obj.items)) obj = obj.items[0];
                }
                const one = stAiEntryFromAi(obj);
                if (!one) throw new Error('解析出来的条目是空的（没正文也没关键词）。');
                stAiUi.enPreview = { id: id, entry: one };
                // 这一条改写的用量，认领到这一条上（enMsgId 不对的话它会串到别的条目面板里）
                stAiUi.enMsg = stAiUsageWith('');
                stAiUi.enMsgId = id;
            } catch (err) {
                stAiUi.enErr = stAiErrText(err);
                stAiUi.enErrId = id;
            } finally {
                stAiUi.enRunning = false;
                stRerender();
            }
        }

        function stAiEntryApply(i, mode) {
            const list = stEditor.card.bookEntries || [];
            const e = list[i];
            const pv = stAiUi.enPreview;
            if (!e || !pv || pv.id !== e.id) return;
            const src = pv.entry;
            if (mode === 'append') {
                let copy = null;
                try { copy = stNormalizeEntry(JSON.parse(JSON.stringify(src))); } catch (err) { copy = null; }
                if (!copy) {
                    stAiUi.enErr = '复制这一条失败了。';
                    stAiUi.enErrId = e.id;
                    stAiRepaint();
                    return;
                }
                // 必须换 id —— 两条条目共用一个 id 的话，
                // enOpenId 会同时匹配上两块面板
                copy.id = stUuid();
                list.splice(i + 1, 0, copy);
                stAiUi.enPreview = null;
                stAiUi.enRaw = '';
                stAiUi.enOpenId = copy.id;
                stAiUi.enMsg = '已经在第 ' + (i + 1) + ' 条后面追加了一条新的（现在是第 ' + (i + 2) + ' 条）。';
                stAiUi.enMsgId = copy.id;
            } else {
                if (stAiUi.enKeepMeta) {
                    e.content = src.content;
                } else {
                    e.content = src.content;
                    // 空值一律不覆盖 —— 模型偷懒给个空数组 / 空串，
                    // 不该把用户原来写好的关键词和备注抹掉
                    if (src.comment) e.comment = src.comment;
                    if (src.keys.length) e.keys = src.keys.slice();
                    if (src.secondaryKeys.length) e.secondaryKeys = src.secondaryKeys.slice();
                    e.constant = src.constant;
                    e.position = src.position;
                    e.depth = src.depth;
                    e.order = src.order;
                }
                stAiUi.enPreview = null;
                stAiUi.enRaw = '';
                stAiUi.enMsg = '第 ' + (i + 1) + ' 条已经换成新的了（' +
                    String(e.content || '').length + ' 字）。';
                stAiUi.enMsgId = e.id;
            }
            stEditor.dirty = true;
            stSaveDraft();
            stRerender();
        }

        function stAiEntryClear() {
            const pv = stAiUi.enPreview;
            stAiUi.enPreview = null;
            stAiUi.enRaw = '';
            stAiUi.enErr = '';
            stAiUi.enErrId = '';
            stAiUi.enMsg = '已丢弃这份结果。';
            stAiUi.enMsgId = pv ? pv.id : '';
            stAiRepaint();
        }

        async function stAiGreetRun() {
            if (stAiUi.grRunning) return;
            const cfg = stAiCfg();
            const ready = stAiReady(cfg);
            stAiUi.grErr = '';
            stAiUi.grMsg = '';
            if (!ready.ok) { stAiUi.grErr = ready.why; stAiUi.grOpen = true; stRerender(); return; }
            const plan = stAiGreetPlan();
            stAiUi.grRunning = true;
            stAiUi.grOpen = true;
            stAiUi.grPreview = null;
            stAiUi.grRaw = '';
            stRerender();
            try {
                const text = await stAiChat(stAiPlanMessages(plan),
                    { cfg: cfg, temperature: cfg.temperature, maxTokens: Math.max(1024, cfg.maxTokens) });
                stAiUi.grRaw = text;
                const j = stAiJsonOf(text);
                if (!j.ok) throw new Error('模型没返回合法 JSON（' + j.error + '）。可以点「复制原始回复」看看它到底说了什么。');
                let arr = stAiPickArray(j.value, ['greetings', 'messages', 'items', 'list']);
                // 有些模型会偷懒回一个裸字符串
                if (!arr && typeof j.value === 'string') arr = [j.value];
                if (!arr || !arr.length) throw new Error('回复里的 JSON 没有开场白数组（没有 greetings）。');
                const list = arr.map(g => {
                    if (g && typeof g === 'object') {
                        return String(g.content != null ? g.content
                            : (g.text != null ? g.text : (g.mes != null ? g.mes : '')));
                    }
                    return String(g == null ? '' : g);
                }).map(s => s.trim()).filter(Boolean);
                if (!list.length) throw new Error('解析出来的开场白都是空的。');
                stAiUi.grPreview = list;
                // 用量挂在状态行上（段数对不上时跟那句话拼成一句）
                stAiUi.grMsg = stAiUsageWith(list.length !== plan.count
                    ? '要了 ' + plan.count + ' 段，模型给了 ' + list.length + ' 段。'
                    : '');
            } catch (e) {
                stAiUi.grErr = stAiErrText(e);
            } finally {
                stAiUi.grRunning = false;
                stRerender();
            }
        }

        function stAiGreetApply() {
            const list = stAiUi.grPreview || [];
            if (!list.length) return;
            const c = stEditor.card;
            if (stAiUi.grTarget === 'alt') {
                list.forEach(g => c.alternateGreetings.push(g));
                stAiUi.grMsg = '已追加 ' + list.length + ' 段备选开场白，现在共 ' +
                    c.alternateGreetings.length + ' 段。';
            } else {
                c.firstMes = list[0];
                stAiUi.grMsg = '已覆盖主开场白（' + String(list[0]).length + ' 字）。' +
                    (list.length > 1 ? '另外 ' + (list.length - 1) + ' 段没有用到 —— 想留就切到「追加为备选」再点一次。' : '');
            }
            stAiUi.grPreview = null;
            stAiUi.grRaw = '';
            stEditor.dirty = true;
            stSaveDraft();
            stRerender();
        }

        function stAiGreetClear() {
            stAiUi.grPreview = null;
            stAiUi.grRaw = '';
            stAiUi.grErr = '';
            stAiUi.grMsg = '已丢弃这一批结果。';
            stAiRepaint();
        }

