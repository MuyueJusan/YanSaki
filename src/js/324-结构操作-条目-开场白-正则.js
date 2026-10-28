        // ===== 结构操作：条目 / 开场白 / 正则 =====

        function stAddEntry() {
            const a = stEditor.card.bookEntries;
            a.push(stBlankEntry());
            stSaveDraft();
            stRerender();
            const el = document.getElementById('st-entry-' + (a.length - 1));
            if (el) {
                el.open = true;
                try { el.scrollIntoView({ block: 'nearest' }); } catch (e) {}
            }
        }

        function stDelEntry(i) {
            const a = stEditor.card.bookEntries;
            if (i < 0 || i >= a.length) return;
            a.splice(i, 1);
            // 单条删除也要把它从选中集里摘掉 —— 留着的话「已选 N 条」会多算一个。
            // （stBookSelIds 本来就会滤掉死 id，这里只是顺手把数组本身也清干净）
            stBookSelPut(stBookSelIds());
            stSaveDraft();
            stRerender();
        }

        function stMoveEntry(i, d) {
            const a = stEditor.card.bookEntries;
            const j = i + d;
            if (i < 0 || i >= a.length || j < 0 || j >= a.length) return;
            const t = a[i]; a[i] = a[j]; a[j] = t;
            stSaveDraft();
            stRerender();
        }

        function stDupEntry(i) {
            const a = stEditor.card.bookEntries;
            const src = a[i];
            if (!src) return;
            let copy = null;
            try { copy = stNormalizeEntry(JSON.parse(JSON.stringify(src))); } catch (e) { copy = null; }
            if (!copy) return;
            copy.id = stUuid();
            a.splice(i + 1, 0, copy);
            stSaveDraft();
            stRerender();
        }

