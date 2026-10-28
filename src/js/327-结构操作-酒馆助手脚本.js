        // ===== 结构操作：酒馆助手脚本 =====
        // 节点路径一律用 'card.thScripts[i]' / 'card.thScripts[i].scripts[j]' 这种字符串，
        // 和控件那套路径读写是同一套，所以文件夹里的脚本不用另写一遍增删改

        // 新加的那条自动展开并滚进视野，不然点了按钮像没反应
        function stThRevealNode(path) {
            const el = document.getElementById(stThDomId(path));
            if (!el) return;
            el.open = true;
            try { el.scrollIntoView({ block: 'nearest' }); } catch (e) {}
        }

        // containerPath 省略 = 加到顶层
        function stThAddScript(containerPath) {
            const cp = containerPath || 'card.thScripts';
            const r = stResolve(cp);
            if (!r || !Array.isArray(r.obj[r.key])) return;
            r.obj[r.key].push(stBlankThScript());
            stSaveDraft();
            stRerender();
            stThRevealNode(cp + '[' + (r.obj[r.key].length - 1) + ']');
        }

        function stThAddFolder() {
            const a = stEditor.card.thScripts;
            a.push(stBlankThFolder());
            stSaveDraft();
            stRerender();
            stThRevealNode('card.thScripts[' + (a.length - 1) + ']');
        }

        function stThDelNode(path) {
            const c = stThContainer(path);
            if (!c || c.index < 0 || c.index >= c.arr.length) return;
            c.arr.splice(c.index, 1);
            stSaveDraft();
            stRerender();
        }

        function stThMoveNode(path, d) {
            const c = stThContainer(path);
            if (!c) return;
            const j = c.index + d;
            if (c.index < 0 || c.index >= c.arr.length || j < 0 || j >= c.arr.length) return;
            const t = c.arr[c.index];
            c.arr[c.index] = c.arr[j];
            c.arr[j] = t;
            stSaveDraft();
            stRerender();
        }

        function stThDupNode(path) {
            const c = stThContainer(path);
            if (!c) return;
            const src = c.arr[c.index];
            if (!src) return;
            let copy = null;
            try { copy = stThNodeFromRaw(JSON.parse(JSON.stringify(src))); } catch (e) { copy = null; }
            if (!copy) return;
            // 复制出来的 id 要换掉 —— 两个同 id 的脚本在酒馆助手里会互相顶掉
            copy.id = stUuid();
            if (copy.kind === 'folder') copy.scripts.forEach(s => { s.id = stUuid(); });
            c.arr.splice(c.index + 1, 0, copy);
            stSaveDraft();
            stRerender();
        }

        function stThAddButton(path) {
            const r = stResolve(path);
            if (!r || !Array.isArray(r.obj[r.key])) return;
            r.obj[r.key].push(stBlankThButton());
            stSaveDraft();
            stRerender();
        }

        function stThDelButton(path, j) {
            const r = stResolve(path);
            if (!r || !Array.isArray(r.obj[r.key])) return;
            if (j < 0 || j >= r.obj[r.key].length) return;
            r.obj[r.key].splice(j, 1);
            stSaveDraft();
            stRerender();
        }

        function stThButton(path, j, field, value) {
            const r = stResolve(path);
            if (!r || !Array.isArray(r.obj[r.key])) return;
            const b = r.obj[r.key][j];
            if (!b) return;
            if (field === 'visible') b.visible = (value === true || value === 'true');
            else b.name = String(value == null ? '' : value);
            stAfterSet(path);
        }

        // 导出单个脚本：和酒馆助手自己的「导出脚本」对齐 ——
        // 写出去的是裸的 Script 对象（不套壳），文件名「酒馆助手脚本-<名字>.json」，
        // 勾了「不带 data / 按钮」就按空对象 / 空数组写
        function stThExportScript(path) {
            const r = stResolve(path);
            const s = r ? r.obj[r.key] : null;
            if (!s || s.kind !== 'script') return;
            try {
                const out = stThScriptToRaw(s);
                if (!out.export_with.data) out.data = {};
                if (!out.export_with.button) out.button.buttons = [];
                const nm = String(s.name || 'script').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
                stDownload('酒馆助手脚本-' + (nm || 'script') + '.json',
                    new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
                stExportMsg('✅ 已导出脚本「' + (s.name || '未命名') + '」', 'ok');
            } catch (e) {
                stExportMsg('❌ 导出脚本失败：' + (e && e.message ? e.message : e), 'bad');
            }
        }

        function stThImportPick() {
            const el = document.getElementById('st-th-import-file');
            if (el) el.click();
        }

        async function stOnThImportPicked(ev) {
            const file = ev.target.files && ev.target.files[0];
            ev.target.value = '';
            if (!file) return;
            try {
                const buf = await file.arrayBuffer();
                const json = JSON.parse(new TextDecoder('utf-8').decode(new Uint8Array(buf)));
                if (!stLooksLikeThScript(json)) {
                    throw new Error('这个 JSON 里没有酒馆助手脚本的字段（type / name / content），' +
                        '不像是脚本 —— 草稿没有被改动');
                }
                const node = stThNodeFromRaw(json);
                if (!node) throw new Error('看不懂这个 JSON');
                // 换新 id，免得和已有的撞
                node.id = stUuid();
                if (node.kind === 'folder') node.scripts.forEach(s => { s.id = stUuid(); });
                stEditor.card.thScripts.push(node);
                stSaveDraft();
                stRerender();
                stExportMsg('✅ 已导入' + (node.kind === 'folder' ? '文件夹' : '脚本') +
                    '「' + (node.name || '未命名') + '」' +
                    (node.kind === 'folder' ? '（含 ' + node.scripts.length + ' 个脚本）' : ''), 'ok');
            } catch (e) {
                stExportMsg('❌ 脚本导入失败：' + (e && e.message ? e.message : e), 'bad');
            }
        }

        function stTouchDate() {
            stEditor.card.creationDate = Math.floor(Date.now() / 1000);
            stSaveDraft();
            stRerender();
        }

