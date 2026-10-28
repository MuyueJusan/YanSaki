        // —— 局部刷新 ——
        // ⚠ 会话是流式长的，**绝不能**每来一条消息就 stRerender() ——
        //   那会把输入框、滚动位置、菜单展开状态一起重建掉
        function stCodePaint() {
            const el = document.getElementById('st-code-log');
            if (!el) return;
            const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            el.innerHTML = stCodeLogHtml();
            if (nearBottom) el.scrollTop = el.scrollHeight;
        }

        function stCodePaintJson() {
            const el = document.getElementById('st-code-json');
            if (!el) return;
            const top = el.scrollTop;
            el.innerHTML = stCodeJsonHtml();
            el.scrollTop = top;
        }

        // —— skill 自报的进度 ——
        // ⚠ 走**局部刷新**，不调 stCodePaint()：一次 run 里可能来几十条进度，
        //   每来一条就把整个消息流 innerHTML 重建一遍，用户往上翻的历史会被弹回底部
        //   （stCodePaint 只在「已经贴在底部」时才滚，但你正在读的那条还是会被重画）
        function stCodeProgressShow(id, text) {
            const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
            // 空串不是「没进度」，是「清掉那一行」—— 给 skill 一个主动收尾的办法
            if (!t) { stCodeProgressClear(id); return; }
            stCode.prog = { id: id, text: t.slice(0, ST_CODE_PROG_CHARS) };
            stCodeProgressRefresh();
        }

        function stCodeProgressClear(id) {
            // ⚠ 只清**自己那条**。另一次 run 已经报上进度时，被超时掐掉的那一次
            //   收尾不该把它抹掉 —— 那会变成「进度闪一下就没了」
            if (stCode.prog && id != null && stCode.prog.id !== id) return;
            stCode.prog = null;
            stCodeProgressRefresh();
        }

        function stCodeProgressHtml() {
            const p = stCode.prog;
            if (!p || !p.text) return '';
            return '<div class="st-code-prog" id="st-code-prog">' +
                '<span class="st-code-prog-ico">⏳</span>' +
                '<span class="st-code-prog-t">' + escapeHtml(p.text) + '</span></div>';
        }

        function stCodeProgressRefresh() {
            const el = document.getElementById('st-code-prog');
            if (!el) return;
            const h = stCodeProgressHtml();
            // 没内容时**整块拿掉**（不是留个空 div）—— 空 div 会把下面那条消息顶下去
            if (!h) { el.remove(); return; }
            const tmp = document.createElement('div');
            tmp.innerHTML = h;
            const nw = tmp.firstChild;
            // 只换文字，不换元素 —— 换掉元素会让 CSS 进场动画每 120ms 重放一次，
            // 看着像在闪
            const old = el.querySelector('.st-code-prog-t');
            if (old) { old.textContent = (stCode.prog && stCode.prog.text) || ''; return; }
            el.parentNode.replaceChild(nw, el);
        }

        function stCodeRepaint() {
            if (stEditor.tab !== 'code') return;
            stRerender();
            const box = document.getElementById('st-code-input');
            if (box) box.value = stCodeDraft;
            // skill 的地址同理：它活在状态里，重画之后要填回去
            const u = document.getElementById('st-code-skill-url');
            if (u) u.value = stCode.skillUrl;
            const log = document.getElementById('st-code-log');
            if (log) log.scrollTop = log.scrollHeight;
        }

