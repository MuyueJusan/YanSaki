        // ===== 世界书页：AI 扩写面板 =====

        function stAiExpandPanel() {
            const cfg = stAiCfg();
            const ui = stAiUi;
            const prev = ui.exPreview;
            const srcItems = [
                { id: 'card', label: '📛 角色卡设定', text: '拿角色描述 / 性格 / 场景 / 系统提示词当素材' },
                { id: 'book', label: '📖 已有世界书', text: '拿现有条目当素材，在它上面扩' },
                { id: 'free', label: '✎ 自由输入', text: '自己贴一段设定进去' }
            ];
            const body =
                stAiStatusHtml(cfg) +
                '<div class="st-note">这里生成的是<b>新条目</b>，会追加到世界书末尾。' +
                    '想只改某一条，展开那一条，用它自己的「✍ AI 改写这一条」。</div>' +
                '<div class="st-sub">素材来源</div>' +
                '<div class="st-ai-chips">' + stAiChips(srcItems, ui.exSource, 'stAiSourcePick') + '</div>' +
                (ui.exSource === 'free'
                    ? '<div class="st-grid"><div class="st-field st-wide">' +
                        '<label for="st-ai-exfree">素材 <span class="st-hint-inline">' +
                            '直接贴设定 / 大纲 / 片段，模型会据此扩写</span></label>' +
                        '<textarea id="st-ai-exfree" rows="6" placeholder="比如：主角是一名在雨夜里捡到猫的侦探……"' +
                            ' oninput="stAiUiSet(\'exFree\',this.value)">' + escapeHtml(ui.exFree) + '</textarea>' +
                      '</div></div>'
                    : '') +
                (ui.exSource === 'book'
                    ? '<div class="st-note">当前卡里有 ' + (stEditor.card.bookEntries || []).length +
                        ' 条条目，会连同角色卡设定一起交给模型。</div>'
                    : '<div class="st-checks">' +
                        '<label class="st-check" title="把已有条目一并告诉模型，让它别写出重复的条目">' +
                            '<input type="checkbox"' + (ui.exKeepBook ? ' checked' : '') +
                            ' onchange="stAiUiSet(\'exKeepBook\',this.checked)">' +
                            '<span>把已有世界书条目也交给模型（避免重复）</span></label>' +
                      '</div>') +
                '<div class="st-sub">扩写要求 <span class="st-hint-inline">可多选，会按顺序拼成指令</span></div>' +
                '<div class="st-ai-chips">' + stAiChipsMulti(ST_AI_REQ_PRESETS, ui.exReq, 'stAiReqToggle') + '</div>' +
                '<div class="st-grid"><div class="st-field st-wide">' +
                    '<label for="st-ai-exreq">额外要求 <span class="st-hint-inline">' +
                        '自由写，比如「每条都要有触发条件」</span></label>' +
                    '<input id="st-ai-exreq" type="text" value="' + escapeHtml(ui.exReqFree) + '"' +
                        ' oninput="stAiUiSet(\'exReqFree\',this.value)">' +
                '</div></div>' +
                '<div class="st-sub">氛围</div>' +
                '<div class="st-ai-chips">' + stAiMoodChips('exMood', ui.exMood) + '</div>' +
                (ui.exMood === 'free'
                    ? '<div class="st-grid"><div class="st-field st-wide">' +
                        '<label for="st-ai-exmood">氛围描述</label>' +
                        '<input id="st-ai-exmood" type="text" value="' + escapeHtml(ui.exMoodFree) + '"' +
                            ' placeholder="比如：梅雨季的湿冷，闷得人喘不过气"' +
                            ' oninput="stAiUiSet(\'exMoodFree\',this.value)">' +
                      '</div></div>'
                    : '') +
                '<div class="st-sub">正文格式</div>' +
                '<div class="st-ai-chips">' + stAiChips(ST_AI_FORMAT_PRESETS, ui.exFormat, 'stAiFormatPick') + '</div>' +
                '<div class="st-sub">生成参数</div>' +
                '<div class="st-grid">' +
                    '<div class="st-field">' +
                        '<label for="st-ai-excount">新增条数 <span class="st-hint-inline">1 ~ 20</span></label>' +
                        '<input id="st-ai-excount" type="number" min="1" max="20"' +
                            ' value="' + escapeHtml(String(ui.exCount)) + '"' +
                            ' oninput="stAiUiSet(\'exCount\',this.value)">' +
                    '</div>' +
                    '<div class="st-field">' +
                        '<label for="st-ai-exdepth">按深度插入时的 depth <span class="st-hint-inline">' +
                            '只在 position = @D 时用</span></label>' +
                        '<input id="st-ai-exdepth" type="number" min="0" max="' + WI_MAX_INJECTION_DEPTH + '"' +
                            ' value="' + escapeHtml(String(ui.exDepth)) + '"' +
                            ' oninput="stAiUiSet(\'exDepth\',this.value)">' +
                    '</div>' +
                '</div>' +
                stAiPlanPreview(stAiExpandPlan()) +
                '<div class="st-actions">' +
                    '<button class="st-big" type="button" onclick="stAiExpandRun()"' +
                        (ui.exRunning ? ' disabled' : '') + '>' +
                        (ui.exRunning ? '⏳ 生成中…' : '✨ 生成 ' + escapeHtml(String(ui.exCount)) + ' 条') +
                    '</button>' +
                    (ui.exRaw
                        ? '<button class="st-big st-plain" type="button" onclick="stAiCopyRaw(\'ex\')">📋 复制原始回复</button>'
                        : '') +
                    (prev && prev.length
                        ? '<button class="st-big" type="button" onclick="stAiExpandApply()">➕ 全部加入世界书</button>' +
                          '<button class="st-big st-plain" type="button" onclick="stAiExpandClear()">✕ 丢弃结果</button>'
                        : '') +
                '</div>' +
                (ui.exErr ? '<div class="st-ai-status st-bad">❌ ' + escapeHtml(ui.exErr) + '</div>' : '') +
                (ui.exMsg ? '<div class="st-ai-status st-ok">✅ ' + escapeHtml(ui.exMsg) + '</div>' : '') +
                (prev && prev.length
                    ? '<div class="st-sub">生成结果（' + prev.length + ' 条，还没加入世界书）</div>' +
                      stAiEntryPreviewHtml(prev)
                    : '');

            return '<details class="st-ai-box' + (ui.exRunning ? ' st-busy' : '') + '"' +
                (ui.exOpen ? ' open' : '') +
                ' ontoggle="stAiUiSet(\'exOpen\',this.open)">' +
                '<summary>✨ AI 扩写条目' +
                    '<span class="st-chip">' + (stEditor.card.bookEntries || []).length + ' 条现有</span>' +
                    '<span class="st-chip">' + escapeHtml(stAi.mode === 'own' ? '独立配置' : '跟随全局') + '</span>' +
                '</summary>' +
                '<div class="st-ai-box-body">' + body + '</div>' +
                '</details>';
        }

