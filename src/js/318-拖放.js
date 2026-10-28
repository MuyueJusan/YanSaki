        // ---------- 拖放 ----------

        function stSbClearDropHints() {
            document.querySelectorAll('#st-sb-canvas .st-sb-hit').forEach(el =>
                el.classList.remove('st-sb-db', 'st-sb-da', 'st-sb-di'));
            const end = document.querySelector('#st-sb-canvas .st-sb-dropend');
            if (end) end.classList.remove('st-sb-db');
        }

        function stSbDragStart(e, id) {
            // 自由摆放模式下指针拖动接管，原生拖放让位。
            // 真拦住（preventDefault）而不是只在 UI 上藏起来 —— 两道闸都留着的话，
            // 拖到一半会变成「既挪了位置又换了顺序」，没人能预期那是什么结果
            if (stSbFreeOn()) {
                if (e && typeof e.preventDefault === 'function') e.preventDefault();
                return;
            }
            stSbDragId = String(id);
            stSbDropAt = null;
            try {
                e.dataTransfer.setData('text/plain', String(id));
                e.dataTransfer.effectAllowed = 'move';
            } catch (err) {}
            if (e.currentTarget && e.currentTarget.classList) {
                e.currentTarget.classList.add('st-sb-drag');
            }
        }

        function stSbDragEnd() {
            stSbDragId = null;
            stSbDropAt = null;
            stSbClearDropHints();
            stSbPaintCanvas();
        }

        // 落点判定：上下边缘 25% 是「插到这一行前后」，中间 50% 是「放进这一行」。
        // 不是分组就只有前后两种
        function stSbDragOver(e, id) {
            const drag = stSbDragId;
            if (!drag || drag === String(id)) return;
            const target = stSbBlockById(id);
            if (!target) return;
            if (stSbHasBlock(target, drag)) return;
            e.preventDefault();
            e.stopPropagation();
            try { e.dataTransfer.dropEffect = 'move'; } catch (err) {}
            const el = e.currentTarget;
            const r = el.getBoundingClientRect();
            const y = r.height ? (e.clientY - r.top) / r.height : 0.5;
            let mode = (y < 0.5) ? 'before' : 'after';
            if (stSbIsBox(target)) mode = (y < 0.25) ? 'before' : (y > 0.75 ? 'after' : 'in');
            stSbDropAt = { target: String(id), mode: mode };
            stSbClearDropHints();
            el.classList.add(mode === 'in' ? 'st-sb-di' : (mode === 'before' ? 'st-sb-db' : 'st-sb-da'));
        }

        // 从父级移到子元素上也会触发父级的 dragleave。判一下 relatedTarget，
        // 否则指示线会一路闪
        function stSbDragLeave(e) {
            const el = e.currentTarget;
            const to = e.relatedTarget;
            if (to && el.contains(to)) return;
            el.classList.remove('st-sb-db', 'st-sb-da', 'st-sb-di');
        }

        function stSbDragOverEnd(e) {
            if (!stSbDragId) return;
            e.preventDefault();
            e.stopPropagation();
            if (e.currentTarget && e.currentTarget.classList) {
                e.currentTarget.classList.add('st-sb-db');
            }
        }

        function stSbDrop(e, id) {
            e.preventDefault();
            e.stopPropagation();
            const info = (stSbDropAt && stSbDropAt.target === String(id))
                ? stSbDropAt : { target: String(id), mode: 'after' };
            const drag = stSbDragId;
            const x = e.clientX;
            stSbDragId = null;
            stSbDropAt = null;
            stSbClearDropHints();
            if (drag) stSbMoveTo(drag, info.target, info.mode, x);
        }

        function stSbDropEnd(e) {
            e.preventDefault();
            e.stopPropagation();
            const drag = stSbDragId;
            stSbDragId = null;
            stSbDropAt = null;
            stSbClearDropHints();
            if (!drag) return;
            const dh = stSbLocate(drag);
            if (!dh) return;
            dh.list.splice(dh.index, 1);
            stEditor.card.statusBar.blocks.push(dh.block);
            stEditor.sbSel = dh.block.id;
            stSbSync();
            stSaveDraft();
            stRerender();
        }

        // 放进分组时按横坐标决定插在第几列
        function stSbDropIndexIn(row, x) {
            const kids = row.children || [];
            for (let i = 0; i < kids.length; i++) {
                const el = document.querySelector('#st-sb-canvas [data-sb="' + kids[i].id + '"]');
                if (!el) continue;
                const r = el.getBoundingClientRect();
                if (x < r.left + r.width / 2) return i;
            }
            return kids.length;
        }

        // 先摘下来再定位目标 —— 摘之前算出来的下标，摘完就错位了
        function stSbMoveTo(dragId, targetId, mode, x) {
            if (String(dragId) === String(targetId)) return;
            const dh = stSbLocate(dragId);
            if (!dh) return;
            if (stSbHasBlock(dh.block, targetId)) return;
            dh.list.splice(dh.index, 1);
            const th = stSbLocate(targetId);
            if (!th) { dh.list.splice(dh.index, 0, dh.block); return; }
            if (mode === 'in' && stSbIsBox(th.block)) {
                th.block.children.splice(stSbDropIndexIn(th.block, x), 0, dh.block);
                stEditor.sbOpen[th.block.id] = true;
            } else {
                th.list.splice(th.index + (mode === 'after' ? 1 : 0), 0, dh.block);
            }
            stEditor.sbSel = dh.block.id;
            stSbSync();
            stSaveDraft();
            stRerender();
        }

