        // —— 检测：一次扫清 7 类组件在不在 ——
        // 脚本按**内容**认（名字用户可以随便改），世界书条目按备注认
        // （MVU 自己就是按备注名找条目的），正则按 findRegex 认
        function stMvuDetect() {
            const c = stEditor.card;
            const out = {
                mvuScript: null, zodScript: null,
                initvar: null, varlist: null, rules: null, format: null,
                regex: { hide: 0, beautify: 0, sbHide: 0, sbShow: 0 },
                placeholder: false, hasAny: false, hasCore: false
            };
            if (!c) return out;
            stMvuEachScript(s => {
                const t = String(s.content || '');
                if (!out.mvuScript && t.indexOf('MagVarUpdate') >= 0) out.mvuScript = s;
                if (!out.zodScript && t.indexOf('registerMvuSchema') >= 0) out.zodScript = s;
            });
            c.bookEntries.forEach(e => {
                const k = String(e.comment || '');
                if (!out.initvar && k.indexOf('[InitVar]') >= 0) out.initvar = e;
                else if (!out.varlist && k.replace(/\s/g, '') === ST_MVU_VARLIST) out.varlist = e;
                else if (!out.rules && k.indexOf('变量更新规则') >= 0) out.rules = e;
                else if (!out.format && k.indexOf('变量输出格式') >= 0) out.format = e;
            });
            c.regex.forEach(r => {
                const k = stMvuRegexKind(r);
                if (k === 'hide') out.regex.hide++;
                else if (k === 'wait' || k === 'done') out.regex.beautify++;
                else if (k === 'sbHide') out.regex.sbHide++;
                else if (k === 'sbShow') out.regex.sbShow++;
            });
            out.placeholder = String(c.firstMes || '').indexOf(ST_MVU_PLACEHOLDER) >= 0;
            out.hasAny = !!(out.mvuScript || out.zodScript || out.initvar || out.varlist ||
                out.rules || out.format || out.placeholder ||
                out.regex.hide || out.regex.beautify || out.regex.sbHide || out.regex.sbShow);
            out.hasCore = !!(out.mvuScript && out.zodScript && out.initvar);
            return out;
        }

