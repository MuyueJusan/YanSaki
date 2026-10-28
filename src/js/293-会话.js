        // —— 会话 ——

        function stCodeOpenSession(id) {
            if (!stCode.sessions.some(s => s.id === id)) return;
            stCode.sessionId = id;
            stCode.err = '';
            stCode.trash = [];
            stCodeSaveUi();
            stCodeRepaint();
        }

        function stCodeDropSession(id) {
            const s = stCode.sessions.filter(x => x.id === id)[0];
            if (!s) return;
            if (!window.confirm('删掉会话「' + (s.title || '未命名') + '」？删了就找不回来了。')) return;
            stCode.sessions = stCode.sessions.filter(x => x.id !== id);
            if (stCode.sessionId === id) {
                stCode.sessionId = stCode.sessions.length ? stCode.sessions[0].id : '';
            }
            stCodeSaveSessions();
            stCodeSaveUi();
            stCodeRepaint();
        }

        // —— 视图 / 强度 ——

        function stCodeViewSet(v) {
            stCode.view = v === 'agent' ? 'agent' : 'card';
            stCodeSaveUi();
            const el = document.getElementById('st-code-split');
            if (el) el.setAttribute('data-view', stCode.view);
            // 只换 class，不重画 —— 重画会把会话滚动位置丢掉
            document.querySelectorAll('.st-code-vbtn').forEach(b => {
                b.classList.toggle('st-on', b.getAttribute('data-v') === stCode.view);
            });
        }

        function stCodeThinkSet(id) {
            if (!ST_CODE_THINK.some(t => t.id === id)) return;
            stCode.think = id;
            stCode.open.think = false;
            stCodeSaveUi();
            stCodeRepaint();
        }

        function stCodeAutoApply(on) {
            stCode.autoApply = !!on;
            stCodeSaveUi();
        }

        // 「第一段」开关。只存不重画 —— 但它**改了发出去的东西**，所以得让用户看见，
        // 用 stCodeFlash 顶一下（那是一条不重画的一句话提示）
        function stCodeUseFirstSeg(on) {
            stCode.useFirstSeg = !!on;
            stCodeSaveUi();
            const seg = String((stAiCfg().firstSeg) || '').trim();
            if (stCode.useFirstSeg && !seg) {
                stCodeFlash('已开启第一段，但【AI 助手】页那段还是空的 —— 空的不会发');
            } else {
                stCodeFlash(stCode.useFirstSeg ? 'Code 页会带上第一段' : 'Code 页不再带第一段');
            }
        }

        // ⚠ 菜单的展开状态写回状态时**绝对不能重画**：<details> 的 toggle 是
        //   异步排队的，重画出来的 <details open> 还会再补一个 toggle 回来 —— 会打转。
        //   这个函数幂等，所以真转一圈也无害
        function stCodeMenuToggle(key, open) {
            stCode.open[key] = !!open;
            stCodeSaveUi();
        }

        function stCodeUndoDelete() {
            if (!stCode.trash.length) return;
            const t = stCode.trash.pop();
            // 兼容早期只存裸条目的草稿（那会儿只有世界书一种）
            const kind = t && t.kind ? t.kind : 'book';
            const e = (t && t.kind) ? t.item : t;
            const c = stEditor.card || stBlankCard();
            let where = '世界书';
            if (kind === 'book') {
                c.bookEntries = (Array.isArray(c.bookEntries) ? c.bookEntries : []).concat([e]);
            } else if (kind === 'regex') {
                c.regex = (Array.isArray(c.regex) ? c.regex : []).concat([e]);
                where = '正则';
            } else if (kind === 'th') {
                c.thScripts = (Array.isArray(c.thScripts) ? c.thScripts : []).concat([e]);
                where = '酒馆助手脚本';
            } else {
                return;
            }
            stCodePaintJson();
            stCodeRepaint();
            stCodeFlash('已把「' + (e.comment || e.scriptName || e.name || e.id) + '」放回' + where + '。');
        }

        async function stCodeCopyJson() {
            const c = stEditor.card || stBlankCard();
            const t = stCodeJsonText(c, 2);
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(t);
                    stCodeFlash('已复制整张卡的 JSON（' + t.length + ' 字符）。');
                } else {
                    stCodeFlash('这个浏览器不让直接写剪贴板，请手动选中复制。');
                }
            } catch (e) {
                stCodeFlash('复制失败：' + ((e && e.message) || e));
            }
        }

        function stCodeKey(e) {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                stCodeSend();
            }
        }

        function stCodeDraftSet(v) { stCodeDraft = String(v == null ? '' : v); }

        function stCodeAttr(s) {
            return escapeHtml(String(s == null ? '' : s)).replace(/'/g, '&#39;');
        }

        // 一句话反馈。走 DOM 直改，不重画 —— 否则每复制一次整页闪一下
        function stCodeFlash(text) {
            const t = String(text == null ? '' : text);
            const el = document.getElementById('st-code-flash');
            if (el) el.textContent = t;
            if (stCode.flashTimer) clearTimeout(stCode.flashTimer);
            if (!t) return;
            stCode.flashTimer = setTimeout(() => {
                const e2 = document.getElementById('st-code-flash');
                if (e2) e2.textContent = '';
            }, 5000);
        }

