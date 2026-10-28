        // ===== 页面上的那张小卡片 =====

        // 手机比例下左上角那个入口菜单，要在**面板外面**标出「正在编哪张卡」。
        // 数据源就是 `stEditor.card` —— 跟上面那行「当前草稿」是同一份，
        // 另找一处（比如 `aiConfig.tavernCard`）两边迟早会不一致。
        // ⚠ 没名字 / 没草稿就写空串，交给 CSS 的 `:empty` 把整块收掉 ——
        //   留个空壳它照样是 flex 项，`gap` 会把按钮挤偏。
        function stRenderNavName(c) {
            const el = document.getElementById('mobile-nav-name');
            if (!el) return;
            const nm = String((c && c.name) || '').trim();
            el.textContent = nm ? '📝 ' + nm : '';
            el.title = nm;   // 名字长到被 ellipsis 截掉时，hover 还能看全
        }

        function renderStCard() {
            const box = document.getElementById('st-card-summary');
            if (!box) return;
            const c = stEditor.card;
            if (!c) { box.innerHTML = ''; stRenderNavName(null); return; }
            // 标题栏下面那一行：折叠起来时它是唯一能看出「在编哪张卡」的地方。
            // 单独占一行，所以名字 + 规格 + 来源都能写全
            const head = document.getElementById('st-head-sub');
            if (head) {
                const nm = String(c.name || '').trim();
                head.textContent = '当前草稿：' + (nm || '未命名') + ' · ' +
                    ST_SPEC_LABEL[c.spec].replace(/（.*$/, '') +
                    (stEditor.srcName ? ' · 来源 ' + stEditor.srcName : '');
            }
            stRenderNavName(c);
            const bodyFields = ['name', 'description', 'personality', 'scenario', 'mesExample',
                'systemPrompt', 'postHistoryInstructions', 'firstMes'];
            const filled = bodyFields.filter(k => String(c[k] || '').trim()).length;
            const greet = (String(c.firstMes || '').trim() ? 1 : 0) +
                c.alternateGreetings.filter(g => String(g).trim()).length;
            const bits = [
                ST_SPEC_LABEL[c.spec],
                '正文字段 ' + filled + '/' + bodyFields.length,
                '开场白 ' + greet + ' 条',
                '世界书 ' + c.bookEntries.length + ' 条',
                '正则 ' + c.regex.length + ' 条',
                stEditor.avatar ? '头像已选' : '头像未选'
            ];
            box.innerHTML =
                '<div class="st-sum">' +
                    (String(c.name || '').trim()
                        ? '当前草稿：<b>' + escapeHtml(c.name) + '</b>'
                        : '当前草稿：<b>（还没起名字）</b>') +
                    ' · ' + bits.map(escapeHtml).join(' · ') +
                    (stEditor.srcName ? '<br>来源：' + escapeHtml(stEditor.srcName) : '') +
                '</div>' +
                (c.tags.length
                    ? '<div class="st-sum-tags">' +
                      c.tags.map(t => '<span class="st-sum-tag">' + escapeHtml(t) + '</span>').join('') +
                      '</div>'
                    : '');
        }

