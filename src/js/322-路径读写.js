        // ===== 路径读写 =====
        // 控件上写的是 'card.bookEntries[2].keysText' 这种路径字符串，这里统一解析。
        // 用路径而不是给每个控件写一个 onchange 函数，是因为条目 / 脚本是动态增删的，
        // 写死函数名会随数量爆炸

        function stResolve(path) {
            const parts = String(path).split('.');
            const re = /^([A-Za-z_$][\w$]*)(?:\[(\d+)\])?$/;
            let cur = stEditor;
            for (let i = 0; i < parts.length - 1; i++) {
                const m = re.exec(parts[i]);
                if (!m) return null;
                cur = cur[m[1]];
                if (m[2] !== undefined) {
                    if (!Array.isArray(cur)) return null;
                    cur = cur[Number(m[2])];
                }
                if (!cur || typeof cur !== 'object') return null;
            }
            const last = re.exec(parts[parts.length - 1]);
            if (!last) return null;
            if (last[2] !== undefined) {
                const arr = cur[last[1]];
                if (!Array.isArray(arr)) return null;
                return { obj: arr, key: Number(last[2]) };
            }
            return { obj: cur, key: last[1] };
        }

        // 界面上是「一行一个」的文本框、存的却是数组的字段。
        // 统一用 XxxText 这个别名读写，省得每个都写一遍转换
        const ST_TEXT_LIST = {
            tagsText: 'tags',
            sourceText: 'source',
            keysText: 'keys',
            secondaryKeysText: 'secondaryKeys',
            trimStringsText: 'trimStrings',
            namesText: 'names'
        };
        const ST_TEXT_LIST_JOIN = { tagsText: ', ', sourceText: '\n' };

        // 逗号和换行都当分隔符 —— ST 的关键词输入框也是按逗号切的
        function stSplitList(text) {
            return String(text == null ? '' : text)
                .split(/[\n,，]/)
                .map(s => s.trim())
                .filter(s => s !== '');
        }

        function stListText(path) {
            const m = /^(.*)\.([A-Za-z]+)$/.exec(String(path));
            if (!m) return undefined;
            const listKey = ST_TEXT_LIST[m[2]];
            if (!listKey) return undefined;
            const parent = stResolve(m[1]);
            if (!parent) return undefined;
            const obj = parent.obj[parent.key];
            if (!obj || typeof obj !== 'object') return undefined;
            const list = Array.isArray(obj[listKey]) ? obj[listKey] : [];
            return list.join(ST_TEXT_LIST_JOIN[m[2]] || '\n');
        }

        function stSetListText(path, value) {
            const m = /^(.*)\.([A-Za-z]+)$/.exec(String(path));
            if (!m) return false;
            const listKey = ST_TEXT_LIST[m[2]];
            if (!listKey) return false;
            const parent = stResolve(m[1]);
            if (!parent) return false;
            const obj = parent.obj[parent.key];
            if (!obj || typeof obj !== 'object') return false;
            obj[listKey] = stSplitList(value);
            return true;
        }

