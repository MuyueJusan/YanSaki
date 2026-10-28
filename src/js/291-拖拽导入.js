        // —— 拖拽导入 ——
        // 高亮**直接改 DOM class，不走状态**：dragover 一秒能触发几十次，
        // 走状态就意味着每次都要 stRerender()，面板会闪成频闪灯
        function stCodeIsFileDrag(ev) {
            const t = ev && ev.dataTransfer && ev.dataTransfer.types;
            return !!t && Array.prototype.indexOf.call(t, 'Files') >= 0;
        }

        function stCodeDragOver(ev) {
            if (!stCodeIsFileDrag(ev)) return;
            ev.preventDefault();
            try { ev.dataTransfer.dropEffect = 'copy'; } catch (e) {}
            const el = document.getElementById('st-code-skill-pop');
            if (el) el.classList.add('st-drop-on');
        }

        function stCodeDragLeave(ev) {
            const el = document.getElementById('st-code-skill-pop');
            if (!el) return;
            // 从子元素划到父元素也会触发 dragleave，用 relatedTarget 排掉
            if (ev && ev.relatedTarget && el.contains(ev.relatedTarget)) return;
            el.classList.remove('st-drop-on');
        }

        // ⚠ 这个函数必须是**同步**的：dataTransfer.items 只在 drop 事件处理期间有效，
        //   一旦 await 过就作废（拿到的会是空列表）。所以这里同步把 entry 全取出来，
        //   之后再交给异步的读文件流程
        function stCodeDragDrop(ev) {
            if (!ev || !ev.dataTransfer) return;
            ev.preventDefault();
            const el = document.getElementById('st-code-skill-pop');
            if (el) el.classList.remove('st-drop-on');
            const dt = ev.dataTransfer;
            const entries = [];
            const items = dt.items ? Array.prototype.slice.call(dt.items) : [];
            items.forEach(it => {
                if (!it || it.kind !== 'file') return;
                const e = (typeof it.webkitGetAsEntry === 'function') ? it.webkitGetAsEntry() : null;
                if (e) entries.push(e);
            });
            const flat = dt.files ? Array.prototype.slice.call(dt.files) : [];
            stCodeImportDropped(entries, flat);
        }

        async function stCodeImportDropped(entries, flat) {
            let files = [];
            if (entries.length) {
                const lists = await Promise.all(entries.map(e => stCodeEntryFiles(e, 0)));
                lists.forEach(l => { files = files.concat(l); });
            }
            if (!files.length) files = flat;
            if (!files.length) {
                stCode.skillErr = '没接到文件。拖文件夹的话浏览器要先把目录读完，稍等一下再试。';
                stCode.skillMsg = '';
                stCodeRepaint();
                return;
            }
            const r = await stCodeImportFiles(files);
            await stCodeSkillsApply(r.found, r.mds + r.js, '拖进来 ', r.errs);
        }

        // 递归展开一个拖进来的目录项。
        // ⚠ readEntries **一次最多只给 100 条**，必须一直读到返回空数组为止 ——
        //   只调一次的话超过 100 个文件的目录会被静默截断
        function stCodeEntryFiles(entry, depth) {
            return new Promise(resolve => {
                if (!entry || (depth || 0) > 8) return resolve([]);
                if (entry.isFile) return entry.file(f => resolve([f]), () => resolve([]));
                if (!entry.isDirectory) return resolve([]);
                const reader = entry.createReader();
                const all = [];
                const step = () => {
                    reader.readEntries(batch => {
                        if (!batch || !batch.length) {
                            Promise.all(all.map(e => stCodeEntryFiles(e, (depth || 0) + 1)))
                                .then(lists => resolve([].concat.apply([], lists)));
                            return;
                        }
                        all.push.apply(all, batch);
                        step();
                    }, () => resolve([]));
                };
                step();
            });
        }

        // 往页面别处丢文件时，浏览器默认会**直接打开那个文件**，整个应用被顶掉。
        // 只拦「拖的是文件」这一种 —— 状态栏编辑器的拖拽换位走的是自定义类型，
        // 不加这个判断的话会把那边一起废掉
        let stFileDropGuardOn = false;
        function stCodeInstallFileDropGuard() {
            if (stFileDropGuardOn) return;
            stFileDropGuardOn = true;
            window.addEventListener('dragover', e => { if (stCodeIsFileDrag(e)) e.preventDefault(); }, false);
            window.addEventListener('drop', e => { if (stCodeIsFileDrag(e)) e.preventDefault(); }, false);
        }

