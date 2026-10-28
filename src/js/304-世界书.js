        // ===== 世界书 =====

        function stPaneBook() {
            const c = stEditor.card;
            const entries = c.bookEntries;
            const on = entries.filter(e => e.enabled).length;
            // 命中集只算一次：条目多的时候每条都算一遍关键词匹配会明显卡
            const hitSet = new Set(stBookFindIdx(entries));
            const noHit = entries.length > 0 && stBookFindActive() && hitSet.size === 0;
            return stPaneHead('📖 世界书',
                '卡内世界书 <code>character_book</code>。这里写好的条目会跟着卡一起导出，' +
                '酒馆模式导入这张卡时会自动读进来。条目的字段和 SillyTavern 的世界书编辑器一一对应。') +
                stAiExpandPanel() +
                '<div class="st-grid">' +
                    stInput('世界书名字', 'card.bookName', {
                        id: 'bookname', wide: true,
                        ph: '留空就用「角色名 的世界书」'
                    }) +
                    stArea('世界书描述', 'card.bookDescription', {
                        id: 'bookdesc', rows: 2
                    }) +
                '</div>' +
                '<div class="st-sub">条目（' + entries.length + ' 条 · 启用 ' + on + ' 条）</div>' +
                (entries.length ? stBookFindBar(entries) : '') +
                (entries.length ? stBookBatchBar(entries) : '') +
                (entries.length
                    ? entries.map((e, i) => stEntryHtml(e, i, !hitSet.has(i))).join('') +
                      // ⚠ 独立的 class + id，**不复用 .st-empty**：那是个「首个匹配」
                      //   型选择器，多一个实例会让别处的断言挑错元素
                      '<div class="st-find-empty" id="st-book-find-empty"' +
                          (noHit ? '' : ' hidden') + '>' +
                          '没有匹配的条目（共 ' + entries.length + ' 条被筛掉）。' +
                          '换个词，或者点上面的「重置」。</div>'
                    : '<div class="st-empty">还没有条目。点下面的「✚ 添加条目」。</div>') +
                '<div class="st-actions">' +
                    '<button class="st-big" type="button" onclick="stAddEntry()">✚ 添加条目</button>' +
                    (entries.length
                        ? '<button class="st-big st-plain" type="button" onclick="stCollapseEntries(false)">全部展开</button>' +
                          '<button class="st-big st-plain" type="button" onclick="stCollapseEntries(true)">全部收起</button>'
                        : '') +
                '</div>';
        }

        function stEntryHtml(e, i, hide) {
            const p = 'card.bookEntries[' + i + ']';
            const keys = e.keys.join('、');
            const sum = '<span class="st-chip' + (e.enabled ? ' st-on' : '') + '">' +
                    (e.enabled ? '启用' : '停用') + '</span>' +
                (e.constant ? '<span class="st-chip st-const">常驻</span>' : '') +
                '<span class="st-chip">' + escapeHtml(WI_POS_LABEL[e.position] || '?') + '</span>' +
                '<span class="st-entry-sum">' +
                    (e.comment ? escapeHtml(e.comment) : '<i>（没写备注）</i>') +
                    (keys ? ' · ' + escapeHtml(keys.slice(0, 40)) : '') +
                '</span>';
            // 多选那个勾选框。⚠ 它待在 <summary> 里，而点 <summary> 会开合 <details> ——
            // 所以 onclick 里必须 stopPropagation 把冒泡挡掉，否则勾一条就把那条摊开了
            const box = '<input type="checkbox" class="st-sel-box"' +
                ' data-id="' + escapeHtml(e.id) + '"' +
                (stBookSelIds().has(e.id) ? ' checked' : '') +
                ' onclick="event.stopPropagation()"' +
                ' onchange="stBookSelToggle(this)" title="选中这一条">';
            return '<details class="st-entry' + (e.enabled ? '' : ' st-entry-off') +
                (hide ? ' st-entry-hide' : '') + '" id="st-entry-' + i + '">' +
                '<summary>' + box + sum + '</summary>' +
                '<div class="st-entry-body">' +
                    stAiEntryPanel(e, i) +
                    '<div class="st-grid">' +
                        stInput('备注 comment', p + '.comment', {
                            id: 'e' + i + '-comment', ph: '只给自己看，比如「好感度系统」'
                        }) +
                        // 关键词 / 次关键词用标签控件：一个词一个圆角矩形，
                        // 回车落一个、点 × 删一个。存的还是数组，只是编辑手感换了
                        stTags('关键词 keys', p + '.keysText', {
                            id: 'e' + i + '-keys',
                            ph: '输入后回车落一个词（逗号也行）',
                            hint: '回车落一个 · 点 × 删掉'
                        }) +
                        stTags('次关键词 secondary_keys', p + '.secondaryKeysText', {
                            id: 'e' + i + '-sec',
                            ph: '输入后回车落一个词',
                            hint: '回车落一个 · 点 × 删掉'
                        }) +
                        stArea('内容 content', p + '.content', {
                            id: 'e' + i + '-content', rows: 6, tall: true
                        }) +
                    '</div>' +
                    '<div class="st-checks">' +
                        stCheck('启用', p + '.enabled', { id: 'e' + i + '-en' }) +
                        stCheck('常驻（始终插入）', p + '.constant', { id: 'e' + i + '-const' }) +
                        stCheck('选择性', p + '.selective', { id: 'e' + i + '-sel' }) +
                        stCheck('关键词用正则匹配', p + '.useRegex', { id: 'e' + i + '-rx' }) +
                    '</div>' +
                    '<div class="st-grid">' +
                        stSelect('位置', p + '.position', WI_POS_ORDER.map(v => ({
                            value: String(v), label: WI_POS_LABEL[v] + ' · ' + WI_POS_NAME[v]
                        })), { id: 'e' + i + '-pos' }) +
                        stNum('顺序 order', p + '.order', 0, 999999, { id: 'e' + i + '-order', hint: '默认 100' }) +
                        stSelect('选择性逻辑', p + '.selectiveLogic', [0, 1, 2, 3].map(v => ({
                            value: String(v), label: WI_SELECTIVE_LOGIC[v]
                        })), { id: 'e' + i + '-logic' }) +
                        stNum('概率 %', p + '.probability', 0, 100, { id: 'e' + i + '-prob' }) +
                    '</div>' +
                    (e.position === WI_POS.atDepth
                        ? '<div class="st-grid">' +
                            stNum('深度 depth', p + '.depth', 0, WI_MAX_INJECTION_DEPTH, { id: 'e' + i + '-depth' }) +
                            stSelect('角色 role', p + '.role', [
                                { value: '0', label: '系统' }, { value: '1', label: '用户' }, { value: '2', label: 'AI' }
                            ], { id: 'e' + i + '-role' }) +
                          '</div>'
                        : '') +
                    '<div class="st-sub">匹配细节</div>' +
                    '<div class="st-grid">' +
                        stTri('大小写敏感', p + '.caseSensitive', { id: 'e' + i + '-case' }) +
                        stTri('全词匹配', p + '.matchWholeWords', { id: 'e' + i + '-whole' }) +
                        stTri('组内评分', p + '.useGroupScoring', { id: 'e' + i + '-score' }) +
                        stNum('单独扫描深度', p + '.scanDepth', 0, WI_MAX_SCAN_DEPTH, {
                            id: 'e' + i + '-scan', hint: '留空跟随全局'
                        }) +
                    '</div>' +
                    '<div class="st-sub">递归与定时</div>' +
                    '<div class="st-checks">' +
                        stCheck('不参与递归', p + '.excludeRecursion', { id: 'e' + i + '-exrec' }) +
                        stCheck('激活后不触发递归', p + '.preventRecursion', { id: 'e' + i + '-prerec' }) +
                    '</div>' +
                    '<div class="st-grid">' +
                        stNum('延迟到递归层级', p + '.delayUntilRecursion', 0, 999, { id: 'e' + i + '-dur' }) +
                        stNum('黏性 sticky', p + '.sticky', 0, 9999, { id: 'e' + i + '-sticky', hint: '留空=不设' }) +
                        stNum('冷却 cooldown', p + '.cooldown', 0, 9999, { id: 'e' + i + '-cd', hint: '留空=不设' }) +
                        stNum('前置延迟 delay', p + '.delay', 0, 9999, { id: 'e' + i + '-delay', hint: '留空=不设' }) +
                    '</div>' +
                    '<div class="st-sub">包含组</div>' +
                    '<div class="st-grid">' +
                        stInput('组名 group', p + '.group', { id: 'e' + i + '-group' }) +
                        stNum('组内权重 group_weight', p + '.groupWeight', 0, 999999, { id: 'e' + i + '-gw' }) +
                        stCheck('组内优先 group_override', p + '.groupOverride', { id: 'e' + i + '-go' }) +
                        stInput('出口名 outlet_name', p + '.outletName', {
                            id: 'e' + i + '-outlet', hint: '位置 = Outlet 时才用'
                        }) +
                    '</div>' +
                    '<div class="st-sub">生效时机 triggers</div>' +
                    '<div class="st-checks">' +
                        WI_GENERATION_TRIGGERS.map(t =>
                            stCheckIn(t, p + '.triggers', t, { id: 'e' + i + '-tr-' + t })).join('') +
                    '</div>' +
                    '<div class="st-note">不勾任何一个 = 所有生成类型都生效。</div>' +
                    '<div class="st-sub">按角色过滤 characterFilter</div>' +
                    '<div class="st-checks">' +
                        stCheck('反向（排除命中的角色）', p + '.characterFilter.isExclude', { id: 'e' + i + '-cfx' }) +
                    '</div>' +
                    '<div class="st-grid">' +
                        stInput('角色名（一行一个）', p + '.characterFilter.namesText', { id: 'e' + i + '-cfn' }) +
                        stInput('角色标签（一行一个）', p + '.characterFilter.tagsText', { id: 'e' + i + '-cft' }) +
                    '</div>' +
                    '<div class="st-sub">额外扫描来源（V3）</div>' +
                    '<div class="st-checks">' +
                        stCheck('扫用户人设描述', p + '.matchPersonaDescription', { id: 'e' + i + '-mp' }) +
                        stCheck('扫角色描述', p + '.matchCharacterDescription', { id: 'e' + i + '-mcd' }) +
                        stCheck('扫角色性格', p + '.matchCharacterPersonality', { id: 'e' + i + '-mcp' }) +
                        stCheck('扫深度提示词', p + '.matchCharacterDepthPrompt', { id: 'e' + i + '-mcdp' }) +
                        stCheck('扫场景', p + '.matchScenario', { id: 'e' + i + '-ms' }) +
                        stCheck('扫作者备注', p + '.matchCreatorNotes', { id: 'e' + i + '-mcn' }) +
                    '</div>' +
                    '<div class="st-actions">' +
                        '<button class="st-mini" type="button" onclick="stMoveEntry(' + i + ',-1)"' +
                            (i === 0 ? ' disabled' : '') + '>↑ 上移</button>' +
                        '<button class="st-mini" type="button" onclick="stMoveEntry(' + i + ',1)"' +
                            (i === entriesLen() - 1 ? ' disabled' : '') + '>↓ 下移</button>' +
                        '<button class="st-mini" type="button" onclick="stDupEntry(' + i + ')">⧉ 复制</button>' +
                        '<button class="st-mini st-danger" type="button" onclick="stDelEntry(' + i + ')">✕ 删除</button>' +
                    '</div>' +
                '</div>' +
            '</details>';
        }

        function entriesLen() {
            return stEditor.card ? stEditor.card.bookEntries.length : 0;
        }

        function stCollapseEntries(collapse) {
            document.querySelectorAll('#st-panes .st-entry').forEach(d => { d.open = !collapse; });
        }

