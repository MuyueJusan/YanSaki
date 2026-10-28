        // —— 工具执行 ——

        function stCodeJsonText(v, indent) {
            try { return JSON.stringify(v, null, indent || 2); } catch (e) { return String(v); }
        }

        function stCodeStrList(v) {
            if (Array.isArray(v)) return v.map(x => String(x == null ? '' : x).trim()).filter(Boolean);
            const s = String(v == null ? '' : v).trim();
            if (!s) return [];
            return s.split(/[\n,，、;；]+/).map(x => x.trim()).filter(Boolean);
        }

        function stCodeGetPath(obj, path) {
            const segs = String(path == null ? '' : path).split('.').filter(Boolean);
            let cur = obj;
            for (let i = 0; i < segs.length; i++) {
                if (cur == null || typeof cur !== 'object') return undefined;
                cur = cur[segs[i]];
            }
            return cur;
        }

        // 只写白名单路径，且段数 <= 2（够 depthPrompt 那种一层嵌套）
        function stCodeSetPath(obj, path, value) {
            const segs = String(path == null ? '' : path).split('.').filter(Boolean);
            if (!segs.length || segs.length > 2) return false;
            let cur = obj;
            for (let i = 0; i < segs.length - 1; i++) {
                if (cur[segs[i]] == null || typeof cur[segs[i]] !== 'object') cur[segs[i]] = {};
                cur = cur[segs[i]];
            }
            cur[segs[segs.length - 1]] = value;
            return true;
        }

        // 找条目：先按 id 精确，再按备注名，最后按 id 前缀（模型常把 uuid 抄漏几位）
        function stCodeFindEntry(c, id) {
            const list = Array.isArray(c.bookEntries) ? c.bookEntries : [];
            const key = String(id == null ? '' : id).trim();
            if (!key) return null;
            return list.filter(e => e && e.id === key)[0] ||
                list.filter(e => e && e.comment && e.comment === key)[0] ||
                list.filter(e => e && e.id && e.id.indexOf(key) === 0)[0] ||
                list.filter(e => e && e.comment && e.comment.indexOf(key) >= 0)[0] || null;
        }

