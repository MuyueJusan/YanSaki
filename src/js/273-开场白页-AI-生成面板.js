        // ===== 开场白页：AI 生成面板 =====

        function stAiGreetPanel() {
            const cfg = stAiCfg();
            const ui = stAiUi;
            const prev = ui.grPreview;
            const rows = stAiInjectList({ includeDisabled: ui.grIncOff });
            const offCount = (stEditor.card.bookEntries || []).filter(e => !e.enabled).length;
            const body =
                stAiStatusHtml(cfg) +
                '<div class="st-sub">会注入的世界观（' + rows.length + ' 条）</div>' +
                '<div class="st-note">' +
                    '按世界书<b>当前</b>的启用状态与位置深度排序：停用的条目会被跳过' +
                    '（共 ' + offCount + ' 条停用）、位置是「Outlet」的条目运行时也不插入正文，同样跳过；' +
                    '「按深度插入」的条目按 depth <b>从大到小</b>排 —— depth 越大离最后一条消息越远，插得越靠前。' +
                '</div>' +
                '<div class="st-checks">' +
                    '<label class="st-check" title="把停用的条目也算进来">' +
                        '<input type="checkbox"' + (ui.grIncOff ? ' checked' : '') +
                        ' onchange="stAiUiSetR(\'grIncOff\',this.checked)">' +
                        '<span>把「已停用」的条目也算进去</span></label>' +
                '</div>' +
                '<details class="st-ai-box"' + (ui.grShowInject ? ' open' : '') +
                    ' ontoggle="stAiUiSet(\'grShowInject\',this.open)">' +
                    '<summary>🧩 展开注入预览' +
                        '<span class="st-chip">' + rows.length + ' 条参与</span>' +
                    '</summary>' +
                    '<div class="st-ai-box-body">' +
                        (rows.length
                            ? '<div class="st-ai-card"><div class="st-ai-card-body">' +
                                escapeHtml(stAiInjectText(rows)) + '</div></div>'
                            : '<div class="st-empty">这张卡还没有可注入的世界书条目。</div>') +
                    '</div>' +
                '</details>' +
                '<div class="st-sub">氛围</div>' +
                '<div class="st-ai-chips">' + stAiMoodChips('grMood', ui.grMood) + '</div>' +
                (ui.grMood === 'free'
                    ? '<div class="st-grid"><div class="st-field st-wide">' +
                        '<label for="st-ai-grmood">氛围描述</label>' +
                        '<input id="st-ai-grmood" type="text" value="' + escapeHtml(ui.grMoodFree) + '"' +
                            ' placeholder="比如：深夜便利店的白炽灯，安静得能听见冰柜的嗡嗡声"' +
                            ' oninput="stAiUiSet(\'grMoodFree\',this.value)">' +
                      '</div></div>'
                    : '') +
                '<div class="st-sub">生成参数</div>' +
                '<div class="st-grid">' +
                    '<div class="st-field">' +
                        '<label for="st-ai-grcount">生成段数 <span class="st-hint-inline">1 ~ 5</span></label>' +
                        '<input id="st-ai-grcount" type="number" min="1" max="5"' +
                            ' value="' + escapeHtml(String(ui.grCount)) + '"' +
                            ' oninput="stAiUiSet(\'grCount\',this.value)">' +
                    '</div>' +
                    '<div class="st-field">' +
                        '<label for="st-ai-grlen">每段字数 <span class="st-hint-inline">100 ~ 3000</span></label>' +
                        '<input id="st-ai-grlen" type="number" min="100" max="3000" step="50"' +
                            ' value="' + escapeHtml(String(ui.grLen)) + '"' +
                            ' oninput="stAiUiSet(\'grLen\',this.value)">' +
                    '</div>' +
                '</div>' +
                '<div class="st-grid"><div class="st-field st-wide">' +
                    '<label for="st-ai-grextra">额外要求 <span class="st-hint-inline">' +
                        '比如「必须提到窗外在下雨」「不要写自我介绍」</span></label>' +
                    '<textarea id="st-ai-grextra" rows="3" placeholder="留空就用默认要求"' +
                        ' oninput="stAiUiSet(\'grExtra\',this.value)">' + escapeHtml(ui.grExtra) + '</textarea>' +
                '</div></div>' +
                '<div class="st-sub">写到哪里</div>' +
                '<div class="st-ai-chips">' +
                    stAiChips([
                        { id: 'main', label: '📌 覆盖主开场白', text: '用第一段覆盖 first_mes' },
                        { id: 'alt', label: '➕ 追加为备选', text: '全部追加进 alternate_greetings' }
                    ], ui.grTarget, 'stAiTargetPick') +
                '</div>' +
                stAiPlanPreview(stAiGreetPlan()) +
                '<div class="st-actions">' +
                    '<button class="st-big" type="button" onclick="stAiGreetRun()"' +
                        (ui.grRunning ? ' disabled' : '') + '>' +
                        (ui.grRunning ? '⏳ 生成中…' : '✨ 生成开场白') +
                    '</button>' +
                    (ui.grRaw
                        ? '<button class="st-big st-plain" type="button" onclick="stAiCopyRaw(\'gr\')">📋 复制原始回复</button>'
                        : '') +
                    (prev && prev.length
                        ? '<button class="st-big" type="button" onclick="stAiGreetApply()">' +
                            (ui.grTarget === 'main' ? '📌 覆盖主开场白' : '➕ 追加为备选') + '</button>' +
                          '<button class="st-big st-plain" type="button" onclick="stAiGreetClear()">✕ 丢弃结果</button>'
                        : '') +
                '</div>' +
                (ui.grErr ? '<div class="st-ai-status st-bad">❌ ' + escapeHtml(ui.grErr) + '</div>' : '') +
                (ui.grMsg ? '<div class="st-ai-status st-ok">✅ ' + escapeHtml(ui.grMsg) + '</div>' : '') +
                (prev && prev.length
                    ? '<div class="st-sub">生成结果（' + prev.length + ' 段，还没写进卡里）</div>' +
                      stAiGreetPreviewHtml(prev)
                    : '');

            return '<details class="st-ai-box' + (ui.grRunning ? ' st-busy' : '') + '"' +
                (ui.grOpen ? ' open' : '') +
                ' ontoggle="stAiUiSet(\'grOpen\',this.open)">' +
                '<summary>✨ AI 生成开场白' +
                    '<span class="st-chip">世界书 ' + rows.length + ' 条参与</span>' +
                    '<span class="st-chip">' + escapeHtml(stAi.mode === 'own' ? '独立配置' : '跟随全局') + '</span>' +
                '</summary>' +
                '<div class="st-ai-box-body">' + body + '</div>' +
                '</details>';
        }

