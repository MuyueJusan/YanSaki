        // ⚠ 覆盖时**只改 content / comment / keys**，条目对象本身留着（`id` 不变）——
        //   这样它还在原位、还是同一条，用户在世界书页里给它调过的东西
        //   （启用开关、正则开关、顺序）不会跟着被抹掉。
        function stPersonaBookWrite(action) {
            const out = String(stEditor.personaOut || '').trim();
            if (!out) { stExportMsg('⚠ 还没有生成结果。', 'warn', 'persona'); return; }
            if (!stEditor.card) return;
            if (!Array.isArray(stEditor.card.bookEntries)) stEditor.card.bookEntries = [];
            const a = stEditor.card.bookEntries;
            const r = stPersonaOutName(out);
            // ⚠ 记过账、但那条已经不在了（用户在世界书页删掉了）⇒ 当新条目处理。
            //   这件事也要**说出来**，否则「点了却没弹窗」看着像记账失灵了。
            const stale = !!(stEditor.personaBookRef && !stPersonaBookRefEntry());
            const prev = (action === 'overwrite') ? stPersonaBookRefEntry() : null;
            const e = prev || stBlankEntry();
            e.content = out;
            // 备注留空的话，世界书列表里那一行只剩「（没写备注）」+ 关键词，很难认出来
            e.comment = r.name || '人设';
            e.keys = r.name ? [r.name] : [];
            let idx;
            if (prev) { idx = a.indexOf(prev); }
            else { a.push(e); idx = a.length - 1; }
            stEditor.personaBookRef = e.id;
            stEditor.personaBookAsk = null;
            stSaveDraft();
            stRerender();
            // ⚠ 提示里那个「第 N 条」是**这次操作自己算出来的数**，所以它天然为真 ——
            //   push 被拆掉时 `a.length` 根本不会变，提示照样说得出口。
            //   ⇒ 断言别盯这句话，盯状态（条数 / 正文 / 备注 / 关键词）。见 RULES.md 六之二十五。
            //
            // ⚠ 一条既没有关键词、也不是常驻的条目**永远不会触发**，
            //   而「按钮点了、条目也建了、聊起来却像没生效」是最难查的一种坏。
            // ⚠ 回落这件事**必须在提示里说出来**：用的是卡名而不是生成结果里的名字，
            //   从条目本身完全看不出来（照样建好了、照样有内容）。
            const tail = r.fromOut ? ''
                : (r.name ? ' —— 生成结果里没有「姓名:」，用的是卡名'
                          : ' —— 生成结果里没有「姓名:」、卡里也没写名字，' +
                            '去世界书页补一个关键词它才会触发');
            stExportMsg('✅ 已将' + (r.name ? '「' + r.name + '」' : '结果') +
                (prev ? '覆盖到世界书第 ' + (idx + 1) + ' 条'
                      : '追加为新的世界书条目（第 ' + (idx + 1) + ' 条）') +
                (stale ? '（上一次那条已经不在了，这次当新条目）' : '') + tail + '。',
                r.name ? 'ok' : 'warn', 'persona');
        }

        // 弹窗里的三个选择。⚠ 用「按钮 → 函数」而不是 `window.confirm`：
        //   confirm 只有两个出口，而这里要**三选一**，且「取消」必须等于**什么都不做**。
        function stPersonaBookAnswer(choice) {
            if (!stEditor.personaBookAsk) return;   // 没在问就别理（防重复点）
            if (choice === 'overwrite') { stPersonaBookWrite('overwrite'); return; }
            if (choice === 'new') { stPersonaBookWrite('new'); return; }
            stEditor.personaBookAsk = null;
            stRerender();
            stExportMsg('已取消 —— 世界书没动。', 'warn', 'persona');
        }

        function stPersonaCopy() {
            const out = String(stEditor.personaOut || '');
            if (!out) { stExportMsg('⚠ 还没有生成结果。', 'warn', 'persona'); return; }
            // 名字跟另外三个按钮同源（取「姓名:」，取不到回落卡名）—— 四个按钮的反馈
            // 说的是同一个人，不然「复制」那条会看起来像在说别的东西
            const nm = stPersonaOutName(out).name;
            const done = ok => stExportMsg(ok
                ? '✅ ' + (nm ? '已复制「' + nm + '」的人设' : '已复制') +
                  '（' + out.length + ' 字符）。'
                : '复制失败，请手动选中预览框里的文字。', ok ? 'ok' : 'warn', 'persona');
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(out).then(() => done(true), () => done(false));
                return;
            }
            // headless / 非安全上下文里 navigator.clipboard 可能没有，退回老路
            try {
                const ta = document.createElement('textarea');
                ta.value = out;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                const ok = document.execCommand('copy');
                ta.remove();
                done(ok);
            } catch (e) { done(false); }
        }

        function stPanePersona() {
            const busy = stEditor.personaBusy === true;
            const tpl = stPersonaTpl();
            const out = String(stEditor.personaOut || '');
            // 「要不要拿卡名当人物姓名」—— 勾选框的状态，以及卡名本身（标签里要显示它）。
            // ⚠ 勾选态**从状态渲染**，不是只活在 DOM 上 —— 否则 stRerender 一重建就弹回勾上
            const nameUse = stPersonaNameUse();
            const nm = stStr((stEditor.card || {}).name);
            const cfg = stAiCfg();
            const ready = stAiReady(cfg);
            const custom = !stPersonaTplIsDefault();
            const labels = stPersonaLabels(tpl);
            const hit = out ? labels.filter(k => out.indexOf(k) >= 0).length : 0;
            // 折叠态**从状态渲染**，不是只活在 DOM 上 —— 否则 stRerender 一重建就弹回展开
            const tplOpen = stEditor.personaTplOpen === true;
            // 「参考素材」那一块的折叠态 / 标题提示 / 两个来源，同样全部从状态算
            const pickOpen = stEditor.personaPickOpen === true;
            const pickHint = stPersonaPickHintText();
            const loreSources = stPersonaLoreSources();
            return stPaneHead('🎭 人设生成器',
                '写一句设定或要求，AI 按下面这份<b>模板</b>逐项填好，生成一整份人设。' +
                '还能从世界书里挑几条当<b>参考素材</b>（本卡的，或额外导入一本只喂生成、不进卡的）。' +
                '模板可以换成你自己的（存在浏览器本地，<b>不写进卡</b>）；' +
                '生成结果先给你过目、可以直接改，点<b>写入</b>才进角色描述（也可以存成世界书条目）。') +
                '<div class="st-sub">你想要什么</div>' +
                '<div class="st-field st-wide">' +
                    '<label for="st-persona-req">设定 / 要求 ' +
                        '<span class="st-hint-inline">写人设的由头，越具体越准</span></label>' +
                    '<textarea id="st-persona-req" rows="3"' +
                        ' placeholder="例如：冷淡的吸血鬼女仆，喜欢红茶，讨厌阳光，说话很短"' +
                        ' oninput="stPersonaReqSet(this.value)">' +
                        escapeHtml(stEditor.personaReq || '') + '</textarea>' +
                '</div>' +
                // 要不要拿卡名当人物姓名。**放在要求下面**：它跟「要求」一起构成输入，
                // 而不是跟生成按钮一起构成动作。
                // ⚠ 卡里还没写名字时**不禁用**它 —— 禁用看着像坏了；勾着也确实没东西可喂，
                //   所以直接把这个事实写在标签里
                '<div class="st-checks">' +
                    '<label class="st-check" title="勾上 = 生成时把这张卡的名字一并告诉 AI，' +
                        '让它当人物姓名；取消 = 由 AI 按你写的设定自己起名">' +
                        '<input type="checkbox" id="st-persona-name-use"' +
                            (nameUse ? ' checked' : '') +
                            ' onchange="stPersonaNameUseSet(this.checked)">' +
                        '<span>把角色卡名字当人物姓名' +
                            (nm ? '（' + escapeHtml(nm) + '）' : '（这张卡还没写名字）') +
                        '</span>' +
                    '</label>' +
                '</div>' +
                // —— 参考素材（世界书）——
                // 折叠块，跟「模板」同一个 `.st-fold` 实现。**默认收起**：卡内世界书几十条，
                // 摊开会把「生成人设」按钮挤出屏幕。
                // ⚠ 两个来源共用一套渲染：`src` 只用来拼勾选键和标题，条目本身**同构**
                //   （卡内的是 card.bookEntries，导入的是 parseWorldBook 的产物）。
                // ⚠ 勾选框带 `data-key`（'card:<id>' / 'imp:<id>'），**不带下标** ——
                //   下标会被世界书页的增删挪走。
                '<div class="st-fold' + (pickOpen ? ' st-fold-open' : '') +
                    '" id="st-persona-pick-fold">' +
                    '<button class="st-fold-head" type="button" id="st-persona-pick-toggle"' +
                        ' aria-expanded="' + (pickOpen ? 'true' : 'false') + '"' +
                        ' aria-controls="st-persona-pick-body"' +
                        ' onclick="stPersonaPickFoldToggle()">' +
                        '<span class="st-fold-ico">▲</span>' +
                        '<span class="st-sub">参考素材（世界书）</span>' +
                        '<span class="st-fold-hint" id="st-persona-pick-hint">' +
                            escapeHtml(pickHint) + '</span>' +
                    '</button>' +
                    '<div class="st-fold-body" id="st-persona-pick-body">' +
                        '<div class="st-fold-inner">' +
                            (loreSources.length
                                ? loreSources.map(s =>
                                    '<div class="st-sub">' + escapeHtml(s.name) +
                                        ' · ' + s.entries.length + ' 条</div>' +
                                    '<div class="st-lore-list">' +
                                        s.entries.map(e => {
                                            const key = stPersonaPickKey(s.src, e.id);
                                            const ks = (e.keys || []).join('、');
                                            const meta = [];
                                            if (ks) meta.push(ks.slice(0, 28));
                                            if (!e.enabled) meta.push('停用');
                                            const label = stStr(e.comment) || '（没写备注）';
                                            return '<label class="st-check" title="' +
                                                    escapeHtml(label) + '">' +
                                                '<input type="checkbox" data-key="' +
                                                    escapeHtml(key) + '"' +
                                                    (stPersonaPickHas(key) ? ' checked' : '') +
                                                    ' onchange="stPersonaPickToggle(this)">' +
                                                '<span>' + escapeHtml(label) +
                                                    (meta.length
                                                        ? '（' + escapeHtml(meta.join(' · ')) + '）'
                                                        : '') +
                                                '</span>' +
                                            '</label>';
                                        }).join('') +
                                    '</div>').join('')
                                : '<div class="st-empty">这张卡还没有世界书条目。' +
                                    '可以先导入一本世界书（只喂生成，不会进卡）。</div>') +
                            '<div class="st-actions">' +
                                '<button class="st-mini" type="button" id="st-persona-lore-import"' +
                                    ' onclick="stPersonaLorePick()">📖 导入世界书 JSON</button>' +
                                '<input type="file" id="st-persona-lore-file" class="ai-hidden-file"' +
                                    ' accept=".json,application/json"' +
                                    ' onchange="stPersonaLoreFilePicked(event)">' +
                                (loreSources.length
                                    ? '<button class="st-mini st-plain" type="button"' +
                                        ' onclick="stPersonaPickAll(true)">全选</button>' +
                                      '<button class="st-mini st-plain" type="button"' +
                                        ' onclick="stPersonaPickAll(false)">清空</button>'
                                    : '') +
                                (stEditor.personaLore
                                    ? '<button class="st-mini st-danger" type="button"' +
                                        ' onclick="stPersonaLoreDrop()">✕ 移除导入的书</button>'
                                    : '') +
                            '</div>' +
                            '<div class="st-note">' +
                                '勾中的条目会跟「要求」一起发给 AI，让它按这些设定写人设。<br>' +
                                '⚠ <b>额外导入的世界书不会进卡</b> —— 它只喂这一次生成；' +
                                '想让它进卡，去「世界书」页自己加。<br>' +
                                '⚠ 停用的条目也能勾（「启用」管的是聊天时插不插，跟这里无关）。' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                // 「模板」折叠块 —— **默认收起**，点标题展开。
                // ⚠ 标题仍用 `.st-sub` 包着：它既是可见标签（默认 / 已自定义），
                //   也是套件按 `.st-sub` 去找的那个节点。
                '<div class="st-fold' + (tplOpen ? ' st-fold-open' : '') +
                    '" id="st-persona-tpl-fold">' +
                    '<button class="st-fold-head" type="button" id="st-persona-tpl-toggle"' +
                        ' aria-expanded="' + (tplOpen ? 'true' : 'false') + '"' +
                        ' aria-controls="st-persona-tpl-body"' +
                        ' onclick="stPersonaTplToggle()">' +
                        '<span class="st-fold-ico">▲</span>' +
                        '<span class="st-sub">模板' + (custom ? '（已自定义）' : '（默认）') + '</span>' +
                        '<span class="st-fold-hint">' + labels.length + ' 项 · 点这里展开改</span>' +
                    '</button>' +
                    '<div class="st-fold-body" id="st-persona-tpl-body">' +
                        '<div class="st-fold-inner">' +
                            '<div class="st-field st-wide">' +
                                '<label for="st-persona-tpl">模板内容 ' +
                                    '<span class="st-hint-inline">' + labels.length +
                                    ' 项 · 清空 = 回到默认模板</span></label>' +
                                '<textarea id="st-persona-tpl" rows="14"' +
                                    ' oninput="stPersonaTplSet(this.value)">' +
                                    escapeHtml(tpl) + '</textarea>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                // 状态提示：**挪到模板下面**（原来夹在模板和它自己的按钮之间，
                // 把「模板」和「跟模板一起看的 AI 配置」隔成了两截）
                '<div class="st-ai-status' + (ready.ok ? ' st-ok' : ' st-warn') + '"' +
                    ' id="st-persona-ai-status">' +
                    '当前生效：' + escapeHtml(stAiModeLabel(cfg)) +
                    (ready.ok ? '' : '\n⚠ ' + escapeHtml(ready.why)) +
                '</div>' +
                // 生成器的**工作状态**（「⏳ 正在让 AI 生成人设…」/「✅ 生成了 N 字符」…）
                // —— **就贴在按钮上方**。原来它只出现在浮层最上面那条常驻状态条里，
                //   眼睛在按钮上时看不见，点了没反应看着像坏了。内容由 `stPaintMsg()` 刷。
                '<div class="st-ai-status" id="st-persona-msg" style="display:none"></div>' +
                '<div class="st-actions">' +
                    '<button class="st-big" type="button" id="st-persona-run"' +
                        (busy ? ' disabled' : '') + ' onclick="stPersonaRun()">' +
                        (busy ? '⏳ 生成中…' : '✨ 生成人设') + '</button>' +
                    '<button class="st-big st-plain" type="button" id="st-persona-tpl-reset"' +
                        ' onclick="stPersonaTplReset()">↩ 恢复默认模板</button>' +
                '</div>' +
                '<div class="st-sub">生成结果' + (out
                    ? '（' + out.length + ' 字符' + (labels.length
                        ? ' · 模板 ' + labels.length + ' 项对上了 ' + hit + ' 项' : '') + '）'
                    : '') + '</div>' +
                (out
                    ? '<div class="st-field st-wide">' +
                        '<label for="st-persona-out">可以在这里直接改，改完再写入 ' +
                            '<span class="st-hint-inline">不会自动进卡</span></label>' +
                        '<textarea id="st-persona-out" rows="16"' +
                            ' oninput="stPersonaOutSet(this.value)">' +
                            escapeHtml(out) + '</textarea>' +
                      '</div>' +
                      '<div class="st-actions">' +
                        '<button class="st-big" type="button" id="st-persona-write"' +
                            ' onclick="stPersonaApply(\'replace\')">📝 写入角色描述</button>' +
                        '<button class="st-big st-plain" type="button" id="st-persona-append"' +
                            ' onclick="stPersonaApply(\'append\')">➕ 追加到角色描述</button>' +
                        '<button class="st-big st-plain" type="button" id="st-persona-to-book"' +
                            ' onclick="stPersonaApply(\'book\')">📖 追加到世界书</button>' +
                        '<button class="st-big st-plain" type="button" id="st-persona-copy"' +
                            ' onclick="stPersonaCopy()">📋 复制</button>' +
                      '</div>'
                    : '<div class="st-empty" id="st-persona-empty">还没有生成结果。' +
                      '写好要求，点上面的「✨ 生成人设」。</div>') +
                '<div class="st-note">' +
                    '模板里<b>每一行都以冒号结尾</b>，AI 会在冒号后面填内容 —— ' +
                    '所以你可以自由增删行、改字段名，它会跟着变。<br>' +
                    '⚠ 生成结果<b>要你点一下才进卡</b>；角色描述里已经有内容时，' +
                    '「写入」还会先问一句，「追加到角色描述」不用问（它不覆盖已有内容）。<br>' +
                    '「📖 追加到世界书」把结果存成一条世界书条目，' +
                    '名称和关键词都取生成结果里<b>「姓名:」后面的字符</b>；' +
                    '生成结果里没写「姓名:」就回落卡名，两处都没有才会留空。<br>' +
                    '⚠ <b>已经追加过一次</b>之后再点，它会先问一句：' +
                    '「覆盖」改写原来那条、「追加为新条目」再建一条、「取消」什么都不做；' +
                    '重新生成一份人设之后，这个记账会<b>清零</b>（第一次点直接追加）。' +
                '</div>' +
                // 三选一弹窗。**从状态渲染**（`stEditor.personaBookAsk`）——
                // 不是凭空 appendChild，所以 `stRerender()` 重建面板时它不会掉、也不会出现两个。
                // 放在面板最后：它是盖住全屏的一层，DOM 位置不影响它盖住谁。
                (stEditor.personaBookAsk
                    ? '<div class="st-ask" id="st-persona-book-ask">' +
                        '<div class="st-ask-box" role="dialog" aria-modal="true"' +
                            ' aria-labelledby="st-persona-book-ask-title">' +
                            '<div class="st-ask-title" id="st-persona-book-ask-title">' +
                                (stEditor.personaBookAsk.name
                                    ? '「' + escapeHtml(stEditor.personaBookAsk.name) +
                                      '」已经添加过了，请选择'
                                    : '这份人设已经添加过了，请选择') +
                            '</div>' +
                            '<div class="st-ask-note">' +
                                '世界书里还留着上一次「追加到世界书」写出的那条。' +
                                '<b>覆盖</b>会改写那一条（位置和它的开关都不动）；' +
                                '<b>追加为新条目</b>会再建一条。' +
                            '</div>' +
                            '<div class="st-actions">' +
                                '<button class="st-big st-plain" type="button"' +
                                    ' id="st-persona-book-cancel"' +
                                    ' onclick="stPersonaBookAnswer(\'cancel\')">取消</button>' +
                                '<button class="st-big" type="button"' +
                                    ' id="st-persona-book-overwrite"' +
                                    ' onclick="stPersonaBookAnswer(\'overwrite\')">覆盖</button>' +
                                '<button class="st-big st-plain" type="button"' +
                                    ' id="st-persona-book-new"' +
                                    ' onclick="stPersonaBookAnswer(\'new\')">追加为新条目</button>' +
                            '</div>' +
                        '</div>' +
                      '</div>'
                    : '');
        }

        function stPaneSys() {
            const c = stEditor.card;
            return stPaneHead('⚙ 系统提示词',
                '卡自带的提示词。在酒馆模式下，<code>system_prompt</code> 会覆盖预设里的主提示词、' +
                '<code>post_history_instructions</code> 会覆盖收尾槽（预设里那个槽标了' +
                '「禁止覆盖」就除外）。') +
                '<div class="st-grid">' +
                    stArea('卡片系统提示词 system_prompt', 'card.systemPrompt', {
                        id: 'sys', rows: 8, tall: true,
                        ph: '留空则用预设里的主提示词'
                    }) +
                    stArea('历史后指令 post_history_instructions', 'card.postHistoryInstructions', {
                        id: 'post', rows: 6,
                        ph: '拼在聊天记录之后、收尾槽里'
                    }) +
                '</div>' +
                '<div class="st-sub">深度提示词 depth_prompt（V3，存在 extensions 里）</div>' +
                '<div class="st-grid">' +
                    stArea('深度提示词正文', 'card.depthPrompt', {
                        id: 'dprompt', rows: 4,
                        ph: '按深度插进对话里的一段补充说明'
                    }) +
                    stSelect('角色', 'card.depthPromptRole', [
                        { value: '0', label: '系统' }, { value: '1', label: '用户' }, { value: '2', label: 'AI' }
                    ], { id: 'dprole' }) +
                    stNum('深度', 'card.depthPromptDepth', 0, WI_MAX_INJECTION_DEPTH, {
                        id: 'ddepth', hint: '默认 4'
                    }) +
                '</div>' +
                (c.spec === 'v1'
                    ? '<div class="st-note st-warn">当前是 V1，这一页的内容不会被写进卡里。</div>'
                    : '');
        }

        function stPaneMeta() {
            const c = stEditor.card;
            const fmt = ts => {
                const n = Number(ts);
                if (!n) return '未设置';
                try { return new Date(n * 1000).toLocaleString(); } catch (e) { return String(n); }
            };
            return stPaneHead('ℹ 元信息',
                '作者、版本、标签这些「关于这张卡」的信息。它们不参与提示词拼装，' +
                '但在 SillyTavern 的角色列表里会显示出来。') +
                '<div class="st-grid">' +
                    stInput('作者 creator', 'card.creator', { id: 'creator', ph: '你的名字' }) +
                    stInput('角色版本 character_version', 'card.characterVersion', {
                        id: 'cver', ph: '1.0'
                    }) +
                    stInput('标签 tags', 'card.tagsText', {
                        id: 'tags', wide: true, ph: '用逗号分隔：猫娘, 日常, 治愈'
                    }) +
                    stArea('作者备注 creator_notes', 'card.creatorNotes', {
                        id: 'notes', rows: 6,
                        ph: '给使用者看的说明：怎么用、有什么注意事项'
                    }) +
                    (c.spec === 'v3'
                        ? stArea('来源 source', 'card.sourceText', {
                            id: 'source', rows: 3,
                            ph: '一行一个：链接或 ID'
                          })
                        : '') +
                '</div>' +
                '<div class="st-sub">时间戳（V3 才有）</div>' +
                '<div class="st-kv">' +
                    '<b>创建时间</b><span>' + escapeHtml(fmt(c.creationDate)) + '</span>' +
                    '<b>修改时间</b><span>导出时自动写成当前时间</span>' +
                '</div>' +
                '<div class="st-actions">' +
                    '<button class="st-mini" type="button" onclick="stTouchDate()">用当前时间重置创建时间</button>' +
                '</div>';
        }

