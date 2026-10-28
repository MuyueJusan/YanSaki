        // ===== 正则 =====

        function stPaneRegex() {
            const c = stEditor.card;
            return stPaneHead('🔧 正则',
                '对应卡里 <code>data.extensions.regex_scripts</code> —— SillyTavern 的' +
                '「正则」扩展脚本。本应用只负责<b>写进卡里 / 从卡里读出来</b>，' +
                '酒馆模式不会执行它们（要用得在 SillyTavern 里跑）。') +
                (c.spec === 'v1'
                    ? '<div class="st-note st-warn">当前是 V1，正则不会被写进卡里。</div>'
                    : '') +
                (c.regex.length
                    ? c.regex.map((r, i) => stRegexHtml(r, i)).join('')
                    : '<div class="st-empty">还没有正则脚本。</div>') +
                '<div class="st-actions">' +
                    '<button class="st-big" type="button" onclick="stAddRegex()">✚ 添加正则脚本</button>' +
                '</div>';
        }

        function stRegexHtml(r, i) {
            const p = 'card.regex[' + i + ']';
            const places = r.placement.map(v => ST_REGEX_PLACEMENT[v] || v).join('/');
            return '<details class="st-entry' + (r.disabled ? ' st-entry-off' : '') + '" id="st-regex-' + i + '">' +
                '<summary>' +
                    '<span class="st-chip' + (r.disabled ? '' : ' st-on') + '">' +
                        (r.disabled ? '停用' : '启用') + '</span>' +
                    '<span class="st-chip">' + escapeHtml(places || '没选范围') + '</span>' +
                    '<span class="st-entry-sum">' +
                        (r.scriptName ? escapeHtml(r.scriptName) : '<i>（没写名字）</i>') +
                        (r.findRegex ? ' · ' + escapeHtml(r.findRegex.slice(0, 40)) : '') +
                    '</span>' +
                '</summary>' +
                '<div class="st-entry-body">' +
                    '<div class="st-grid">' +
                        stInput('脚本名 scriptName', p + '.scriptName', { id: 'r' + i + '-name' }) +
                        stInput('查找 findRegex', p + '.findRegex', {
                            id: 'r' + i + '-find', wide: true,
                            ph: '/pattern/flags —— 比如 /\\*[^*]+\\*/g'
                        }) +
                        stArea('替换为 replaceString', p + '.replaceString', {
                            id: 'r' + i + '-rep', rows: 3,
                            ph: '支持 $1 $2 这种捕获组引用'
                        }) +
                        stArea('要裁掉的字符串 trimStrings', p + '.trimStringsText', {
                            id: 'r' + i + '-trim', rows: 2,
                            ph: '一行一个'
                        }) +
                    '</div>' +
                    '<div class="st-sub">生效范围 placement</div>' +
                    '<div class="st-checks">' +
                        ST_REGEX_PLACEMENT_ORDER.map(v =>
                            stCheckIn(ST_REGEX_PLACEMENT[v], p + '.placement', v, {
                                id: 'r' + i + '-pl' + v, title: 'placement = ' + v
                            })).join('') +
                    '</div>' +
                    '<div class="st-checks">' +
                        stCheck('停用', p + '.disabled', { id: 'r' + i + '-off' }) +
                        stCheck('只在界面显示（markdownOnly）', p + '.markdownOnly', { id: 'r' + i + '-md' }) +
                        stCheck('只作用于提示词（promptOnly）', p + '.promptOnly', { id: 'r' + i + '-po' }) +
                        stCheck('编辑时也跑（runOnEdit）', p + '.runOnEdit', { id: 'r' + i + '-roe' }) +
                    '</div>' +
                    '<div class="st-grid">' +
                        stSelect('替换模式 substituteRegex', p + '.substituteRegex', [
                            { value: '0', label: '不替换（0）' },
                            { value: '1', label: '替换 {{macro}}（1）' },
                            { value: '2', label: '替换 <tag>（2）' }
                        ], { id: 'r' + i + '-sub' }) +
                        stNum('最小深度 minDepth', p + '.minDepth', 0, 9999, {
                            id: 'r' + i + '-min', hint: '留空=不限'
                        }) +
                        stNum('最大深度 maxDepth', p + '.maxDepth', 0, 9999, {
                            id: 'r' + i + '-max', hint: '留空=不限'
                        }) +
                    '</div>' +
                    '<div class="st-actions">' +
                        '<button class="st-mini" type="button" onclick="stMoveRegex(' + i + ',-1)"' +
                            (i === 0 ? ' disabled' : '') + '>↑ 上移</button>' +
                        '<button class="st-mini" type="button" onclick="stMoveRegex(' + i + ',1)"' +
                            (i === stEditor.card.regex.length - 1 ? ' disabled' : '') + '>↓ 下移</button>' +
                        '<button class="st-mini" type="button" onclick="stDupRegex(' + i + ')">⧉ 复制</button>' +
                        '<button class="st-mini st-danger" type="button" onclick="stDelRegex(' + i + ')">✕ 删除</button>' +
                    '</div>' +
                '</div>' +
            '</details>';
        }

