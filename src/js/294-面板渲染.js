        // ===== 面板渲染 =====

        // JSON 上色。一次扫描搞定，不引第三方库
        function stCodeHighlight(txt) {
            return escapeHtml(String(txt)).replace(
                /(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)?|(-?\d+(?:\.\d+)?)|\b(true|false|null)\b/g,
                (m, str, colon, num, bool) => {
                    if (str) {
                        return colon
                            ? '<span class="j-k">' + str + '</span>' + colon
                            : '<span class="j-s">' + str + '</span>';
                    }
                    if (num) return '<span class="j-n">' + num + '</span>';
                    if (bool) return '<span class="j-b">' + bool + '</span>';
                    return m;
                }
            );
        }

        function stCodeJsonHtml() {
            let txt = '';
            try { txt = JSON.stringify(stEditor.card || stBlankCard(), null, 2); }
            catch (e) { txt = '（这张卡里有无法序列化的内容）'; }
            return stCodeHighlight(txt);
        }

        function stCodeMsgHtml(m) {
            const role = String((m && m.role) || '');
            const body = escapeHtml(String((m && m.content) || ''));
            if (role === 'note') {
                return '<div class="st-code-msg st-n"><div class="st-code-role">📌 提示</div>' +
                    '<div class="st-code-body">' + body + '</div></div>';
            }
            if (role === 'user') {
                return '<div class="st-code-msg st-u"><div class="st-code-role">🧑 你</div>' +
                    '<div class="st-code-body">' + body + '</div></div>';
            }
            if (role === 'assistant') {
                let h = '<div class="st-code-msg st-a"><div class="st-code-role">🤖 Agent' +
                    // 这一轮花了多少 —— 老会话里没有 usage 字段，那就什么也不显示
                    ((m && m.usage) ? '<span class="st-code-usage">' +
                        escapeHtml(stAiUsageText(m.usage, false)) + '</span>' : '') +
                    '</div>';
                if (body.trim()) h += '<div class="st-code-body">' + body + '</div>';
                ((m && m.calls) || []).forEach(c => {
                    h += '<details class="st-code-tool"><summary>🔧 调用 <b>' + escapeHtml(String(c.name || '')) +
                        '</b></summary><pre>' + escapeHtml(stCodeJsonText(c.args || {}, 2)) + '</pre></details>';
                });
                return h + '</div>';
            }
            if (role === 'tool') {
                let h = '<div class="st-code-msg st-t"><div class="st-code-role">🧰 工具结果</div>';
                ((m && m.toolResults) || []).forEach(r => {
                    const t = String(r.text == null ? '' : r.text);
                    h += '<details class="st-code-tool"' + (t.length <= 240 ? ' open' : '') + '>' +
                        '<summary>' + (r.ok === false ? '⚠ ' : '✔ ') + escapeHtml(String(r.name || '')) +
                        '（' + t.length + ' 字）</summary><pre>' + escapeHtml(t) + '</pre></details>';
                });
                return h + '</div>';
            }
            return '';
        }

        function stCodeEmptyHtml() {
            const n = stCode.skills.length;
            return '<div class="st-code-empty">' +
                '<div style="font-size:1.5rem">🤖</div>' +
                '<div style="margin-top:8px"><b>Agent 会直接改左边这张卡</b></div>' +
                '<div>试试：「把 description 写细一点，加上说话习惯」</div>' +
                '<div>「给世界书加一条关于『黑市』的条目」</div>' +
                (n ? '<div>「按「' + escapeHtml(stCode.skills[0].name) + '」这个 skill 来改」</div>'
                   : '<div>还没导入 skill —— 工具条上的「🧩 当前 skill 列表」里可以导入</div>') +
                '</div>';
        }

        function stCodeLogHtml() {
            const s = stCodeSession();
            let h = s.msgs.length ? s.msgs.map(stCodeMsgHtml).join('') : stCodeEmptyHtml();
            if (stCode.running) {
                h += '<div class="st-code-msg st-a"><div class="st-code-role">🤖 Agent' +
                    (stCode.step ? ' · 第 ' + stCode.step + ' 步' : '') + '</div>' +
                    '<div class="st-code-body st-code-cursor">正在思考</div></div>';
            }
            // ⚠ 进度**挂在「正在思考」下面**，跟着它一起出现 / 消失 ——
            //   它是「这一轮正在做什么」的补充，不是一个独立的消息
            h += stCodeProgressHtml();
            if (stCode.err) {
                h += '<div class="st-code-msg st-e"><div class="st-code-role">⚠ 出错了</div>' +
                    '<div class="st-code-body">' + escapeHtml(stCode.err) + '</div></div>';
            }
            return h;
        }

        function stCodeWhen(ts, now) {
            const d = new Date(Number(ts) || 0);
            const p = n => (n < 10 ? '0' : '') + n;
            const diff = Math.max(0, (now || Date.now()) - Number(ts || 0));
            if (diff < 60000) return '刚刚';
            if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
            if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
            return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
        }

