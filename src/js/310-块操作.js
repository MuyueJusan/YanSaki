        // ---------- 块操作 ----------

        function stSbAddBlock(type, containerId) {
            const c = stEditor.card;
            if (!c || ST_SB_BLOCKS.indexOf(String(type)) < 0) return;
            const b = stBlankSbBlock(type);
            if (b.type === 'title') b.text = '状态';
            else if (b.type === 'text') b.text = '{{char}} · 当前状态';
            else if (b.type === 'html') {
                b.text = '<div style="padding:6px 0">在这里写任意 HTML（记得内联 style）</div>';
            } else if (b.type === 'var' || b.type === 'bar' || b.type === 'dots') {
                const p = stSbAutoPick(b.type);
                if (p) { b.path = p.path; b.label = p.label; b.min = p.min; b.max = p.max; }
            }
            // 当前选中的是个分组 → 新块直接进那个分组；否则落到根上
            let cid = String(containerId || '');
            if (!cid) {
                const sel = stSbSelected();
                if (sel && stSbIsBox(sel.block)) cid = sel.block.id;
            }
            const hit = cid ? stSbLocate(cid) : null;
            if (hit && stSbIsBox(hit.block)) {
                hit.block.children.push(b);
                stEditor.sbOpen[hit.block.id] = true;
            } else {
                c.statusBar.blocks.push(b);
            }
            stEditor.sbSel = b.id;
            stSbSync();
            stSaveDraft();
            stRerender();
        }

        function stSbSelect(id, fromCanvas) {
            stEditor.sbSel = String(id || '');
            stRerender();
            // 从画布点进来的才把焦点挪到舞台上 —— 方向键微调要有地方接事件。
            // 从图层树点进来时不抢焦点（那边点一下是去改名字的）
            if (fromCanvas) stSbStageFocus();
        }

        // 把焦点放到画布舞台。preventScroll 是必须的：默认聚焦会把整个面板
        // 滚到舞台那儿，点一下块画面就跳一下
        function stSbStageFocus() {
            const el = document.querySelector('#st-sb-canvas .st-sb-stage');
            if (!el) return;
            try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) {} }
        }

        // 双击画布上的块 = 选中它，并把光标送进右边最该改的那个输入框。
        // 这是「像编辑 PPT」里双击就改字那一下 —— 只是改字的地方在右边的属性栏，
        // 不做 contenteditable：画布是整块 innerHTML 重画的，可编辑节点会被换掉
        function stSbDblClick(id) {
            const b = stSbBlockById(id);
            if (!b) return;
            // 必须先落选中再重画 —— 不然重画出来的属性面板还是「没选中」那版，
            // 下面要聚焦的输入框根本不存在。别指望前面那次 click 一定先跑过：
            // 双击是个独立事件，程序化派发时就没有前面的 click
            if (stEditor.sbSel !== String(id)) {
                stEditor.sbSel = String(id);
                stRerender();
            }
            const wid = stSbDomId(b.id).replace(/^st-/, '');
            const leaf = {
                title: '-text', text: '-text', html: '-html',
                var: '-label', bar: '-label', dots: '-label',
                space: '-h', row: '-gap', divider: '-color'
            }[b.type] || '-text';
            const el = document.getElementById('st-' + wid + leaf);
            if (!el) return;
            try {
                el.focus();
                if (typeof el.select === 'function' && el.type !== 'color') el.select();
            } catch (e) {}
        }

        function stSbToggleOpen(id) {
            const k = String(id);
            stEditor.sbOpen[k] = stEditor.sbOpen[k] === false;
            stRerender();
        }

        function stSbDelBlock(id) {
            const hit = stSbLocate(id);
            if (!hit) return;
            hit.list.splice(hit.index, 1);
            // 删掉的是选中项（或它的祖先）→ 清空选中，否则检查器会指向空气
            if (stEditor.sbSel === id || !stSbLocate(stEditor.sbSel)) stEditor.sbSel = '';
            stSbSync();
            stSaveDraft();
            stRerender();
        }

        function stSbMoveBlock(id, d) {
            const hit = stSbLocate(id);
            if (!hit) return;
            const j = hit.index + d;
            if (j < 0 || j >= hit.list.length) return;
            const t = hit.list[hit.index];
            hit.list[hit.index] = hit.list[j];
            hit.list[j] = t;
            stSbSync();
            stSaveDraft();
            stRerender();
        }

        function stSbDupBlock(id) {
            const hit = stSbLocate(id);
            if (!hit) return;
            let copy = null;
            try {
                copy = stSbBlockFromRaw(JSON.parse(JSON.stringify(hit.block)));
            } catch (e) { copy = null; }
            if (!copy) return;
            // 复制出来的整棵子树都要换 id —— 同 id 会让选中 / 拖拽串味
            const reid = n => { n.id = stUuid(); (n.children || []).forEach(reid); };
            reid(copy);
            hit.list.splice(hit.index + 1, 0, copy);
            stEditor.sbSel = copy.id;
            stSbSync();
            stSaveDraft();
            stRerender();
        }

        // 从根到该块的整条链（含它自己）。链长 > 1 就说明它挂在某个分组里
        // stSbLocate 的「从根到这块」版本。同样的坑：这一层没有子块就是空列表，
        // 不能兜底回根列表（理由见 stSbLocate）
        function stSbChain(id, list, prefix, _d) {
            const d = _d || 0;
            if (d > 40) return null;
            const fromRoot = (list === undefined && prefix === undefined);
            const blocks = fromRoot
                ? ((stEditor.card && stEditor.card.statusBar &&
                    Array.isArray(stEditor.card.statusBar.blocks))
                    ? stEditor.card.statusBar.blocks : [])
                : (Array.isArray(list) ? list : []);
            const pre = fromRoot ? 'card.statusBar.blocks' : String(prefix);
            for (let i = 0; i < blocks.length; i++) {
                const b = blocks[i];
                if (!b || typeof b !== 'object') continue;
                const path = pre + '[' + i + ']';
                if (b.id === id) return [{ block: b, list: blocks, index: i, path: path }];
                const sub = stSbChain(id, b.children, path + '.children', d + 1);
                if (sub) {
                    sub.unshift({ block: b, list: blocks, index: i, path: path });
                    return sub;
                }
            }
            return null;
        }

        // 把块从所在分组里提到分组的后面
        function stSbOutdent(id) {
            const chain = stSbChain(id);
            if (!chain || chain.length < 2) return;
            const me = chain[chain.length - 1];
            const parent = chain[chain.length - 2];
            parent.block.children.splice(me.index, 1);
            parent.list.splice(parent.index + 1, 0, me.block);
            stSbSync();
            stSaveDraft();
            stRerender();
        }

        // 用一个「一行多列」把当前块包起来 —— 之后往这个分组里再拖块就是并排
        function stSbWrapRow(id) {
            const hit = stSbLocate(id);
            if (!hit || stSbIsBox(hit.block)) return;
            const row = stBlankSbBlock('row');
            row.children = [hit.block];
            hit.list[hit.index] = row;
            stEditor.sbSel = row.id;
            stEditor.sbOpen[row.id] = true;
            stSbSync();
            stSaveDraft();
            stRerender();
        }

        // 解散分组：把子块原地提出来
        function stSbUnwrapRow(id) {
            const hit = stSbLocate(id);
            if (!hit || !stSbIsBox(hit.block)) return;
            const kids = hit.block.children || [];
            hit.list.splice(hit.index, 1);
            if (kids.length) hit.list.splice(hit.index, 0, ...kids);
            stEditor.sbSel = kids.length ? kids[0].id : '';
            stSbSync();
            stSaveDraft();
            stRerender();
        }

