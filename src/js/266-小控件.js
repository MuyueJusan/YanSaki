        // ===== 小控件 =====

        function stAiChips(items, cur, fn) {
            return items.map(it =>
                '<button class="st-ai-chip' + (it.id === cur ? ' st-on' : '') + '" type="button"' +
                ' title="' + escapeHtml(it.text || it.label) + '"' +
                ' onclick="' + fn + '(\'' + it.id + '\')">' + escapeHtml(it.label) + '</button>'
            ).join('');
        }

        function stAiChipsMulti(items, cur, fn) {
            return items.map(it =>
                '<button class="st-ai-chip' + (cur.indexOf(it.id) >= 0 ? ' st-on' : '') + '" type="button"' +
                ' title="' + escapeHtml(it.text || it.label) + '"' +
                ' onclick="' + fn + '(\'' + it.id + '\')">' + escapeHtml(it.label) + '</button>'
            ).join('');
        }

        function stAiMoodChips(key, cur) {
            const items = ST_AI_MOOD_PRESETS.concat([{ id: 'free', label: '✎ 自定义' }]);
            return items.map(it =>
                '<button class="st-ai-chip' + (it.id === cur ? ' st-on' : '') + '" type="button"' +
                ' onclick="stAiMoodPick(\'' + key + '\',\'' + it.id + '\')">' + escapeHtml(it.label) + '</button>'
            ).join('');
        }

        // 只读的一格。用 disabled 的 input 而不是 div —— 字号 / 圆角跟别的字段一致，
        // 而且长 URL 能选中复制
        function stAiReadonly(label, value, hint) {
            return '<div class="st-field">' +
                '<label>' + escapeHtml(label) +
                    (hint ? ' <span class="st-hint-inline">' + escapeHtml(hint) + '</span>' : '') +
                '</label>' +
                '<input type="text" value="' + escapeHtml(value == null ? '' : String(value)) + '" disabled>' +
                '</div>';
        }

        function stAiMoodText(mood, free) {
            if (mood === 'free') return String(free || '').trim();
            if (!mood || mood === 'auto') return '';
            const p = ST_AI_MOOD_PRESETS.find(x => x.id === mood);
            return (p && p.id !== 'auto') ? p.label : '';
        }

        function stAiStatusHtml(cfg, extraCls) {
            const ready = stAiReady(cfg);
            return '<div class="st-ai-status ' + (ready.ok ? 'st-ok' : 'st-warn') + (extraCls || '') + '">' +
                '使用：' + escapeHtml(stAiModeLabel(cfg)) +
                (ready.ok ? '' : '\n⚠ ' + escapeHtml(ready.why)) +
                '</div>';
        }

