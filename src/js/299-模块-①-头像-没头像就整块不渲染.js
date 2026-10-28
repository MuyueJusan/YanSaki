        // —— 模块 ①：头像。没头像就整块不渲染 ——
        function stHomeBodyAvatar() {
            if (!stEditor.avatar) return '';
            return '<div class="st-avatar-box">' +
                '<img class="st-avatar-prev" src="' + escapeHtml(stEditor.avatar) + '" alt="">' +
                '<div class="st-avatar-meta">头像：' +
                    escapeHtml(stEditor.avatarName || '已选') + '</div></div>';
        }

        // —— 模块 ②：概览。这些数字**一律现算**，不缓存 ——
        function stHomeBodyOverview() {
            const c = stEditor.card;
            const nm = String(c.name || '').trim();
            const filled = ST_HOME_BODY_FIELDS.filter(k => String(c[k] || '').trim()).length;
            const greet = (String(c.firstMes || '').trim() ? 1 : 0) +
                c.alternateGreetings.filter(g => String(g).trim()).length;
            const thN = stThCountScripts(c.thScripts);
            const onEntries = c.bookEntries.filter(e => e.enabled).length;
            const own = [];
            if (stEditor.mvuOwn) own.push('MVU');
            if (stEditor.sbOwn) own.push('状态栏');

            return '<div class="st-kv">' +
                '<b>名字</b><span>' + (nm ? escapeHtml(nm) : '<i>（还没起名字）</i>') + '</span>' +
                '<b>规格</b><span>' + escapeHtml(ST_SPEC_LABEL[c.spec]) + '</span>' +
                '<b>来源</b><span>' + (stEditor.srcName
                    ? escapeHtml(stEditor.srcName) : '<i>新建的空卡</i>') + '</span>' +
                '<b>正文字段</b><span>' + filled + ' / ' + ST_HOME_BODY_FIELDS.length + '</span>' +
                '<b>开场白</b><span>' + greet + ' 条</span>' +
                '<b>世界书</b><span>' + c.bookEntries.length + ' 条' +
                    (c.bookEntries.length ? '（启用 ' + onEntries + '）' : '') + '</span>' +
                '<b>正则</b><span>' + c.regex.length + ' 条</span>' +
                '<b>酒馆助手</b><span>' + thN + ' 个脚本</span>' +
                '<b>本编辑器接管</b><span>' + (own.length
                    ? escapeHtml(own.join(' / ')) : '<i>无</i>') + '</span>' +
                '<b>创建时间</b><span>' + escapeHtml(stHomeTime(c.creationDate)) + '</span>' +
            '</div>';
        }

