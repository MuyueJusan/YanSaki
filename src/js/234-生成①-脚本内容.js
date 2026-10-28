        // —— 生成①：脚本内容 ——
        function stMvuMvuScriptCode() {
            return "import '" + ST_MVU_SCRIPT_URL + "'";
        }

        // 只有 ASCII 标识符和 CJK 能直接写出来，其余加引号
        const ST_MVU_SAFE_KEY = /^[A-Za-z_$\u4e00-\u9fa5][A-Za-z0-9_$\u4e00-\u9fa5]*$/;

        function stMvuQuote(s) {
            return "'" + String(s == null ? '' : s)
                .replace(/\\/g, '\\\\').replace(/'/g, "\\'")
                .replace(/\n/g, '\\n').replace(/\r/g, '') + "'";
        }

        function stMvuKey(name) {
            const s = String(name == null ? '' : name);
            return ST_MVU_SAFE_KEY.test(s) ? s : stMvuQuote(s);
        }

        function stMvuNumLit(v) {
            const n = Number(String(v == null ? '' : v).trim());
            return (String(v == null ? '' : v).trim() !== '' && Number.isFinite(n)) ? String(n) : null;
        }

        // 默认值字面量。容器 / 没填的返回 null（就不生成 prefault）
        function stMvuDefaultLit(n) {
            const v = String(n.value == null ? '' : n.value).trim();
            switch (n.type) {
                case 'string': return v === '' ? null : stMvuQuote(n.value);
                case 'number': return stMvuNumLit(v);
                case 'boolean': return (v === 'true' || v === '1') ? 'true'
                    : ((v === 'false' || v === '0') ? 'false' : null);
                case 'enum': return n.options.length
                    ? stMvuQuote(n.options.indexOf(v) >= 0 ? v : n.options[0]) : null;
                default: return null;   // object / record / union 不给 prefault
            }
        }

        // YAML 用的默认值文本（不带引号，交给 stMvuYamlScalar 决定要不要引）
        function stMvuDefaultText(n) {
            const v = String(n.value == null ? '' : n.value).trim();
            switch (n.type) {
                case 'number': return stMvuNumLit(v) === null ? '0' : stMvuNumLit(v);
                case 'boolean': return (v === 'true' || v === '1') ? 'true' : 'false';
                case 'enum': return n.options.length
                    ? (n.options.indexOf(v) >= 0 ? v : n.options[0]) : '';
                default: return String(n.value == null ? '' : n.value);
            }
        }

        // 一个节点 → 一段 zod 表达式（不含 key）。ind 只用来排版
        function stMvuZodOf(n, ind) {
            const pad = ind || '';
            const inner = pad + '  ';
            let core;
            switch (n.type) {
                case 'number':
                    core = 'z.coerce.number()';
                    if (n.int) core += '.int()';
                    if (n.min !== null || n.max !== null) {
                        core += '.transform(v => _.clamp(v, ' +
                            (n.min === null ? '-Infinity' : String(n.min)) + ', ' +
                            (n.max === null ? 'Infinity' : String(n.max)) + '))';
                    }
                    break;
                case 'boolean':
                    core = 'z.boolean()';
                    break;
                case 'enum':
                    core = 'z.enum([' +
                        (n.options.length ? n.options : ['']).map(stMvuQuote).join(', ') + '])';
                    break;
                case 'object':
                    core = 'z.object({' + stMvuZodFields(n.children, inner) + '\n' + pad + '})';
                    break;
                case 'record':
                    // 动态键：键是 z.string()，值是子字段组成的对象
                    core = 'z.record(z.string(), ' + (stMvuNamed(n.children).length
                        ? 'z.object({' + stMvuZodFields(n.children, inner) + '\n' + pad + '})'
                        : 'z.any()') + ')';
                    break;
                case 'union':
                    // 子节点只取类型，名字忽略
                    core = 'z.union([' + (n.children.length
                        ? n.children.map(x => stMvuZodOf(x, inner)).join(', ')
                        : 'z.string()') + '])';
                    break;
                default:
                    core = 'z.string()';
            }
            if (n.desc) core += '.describe(' + stMvuQuote(n.desc) + ')';
            const dflt = stMvuDefaultLit(n);
            if (dflt !== null) core += '.prefault(' + dflt + ')';
            return core;
        }

        function stMvuNamed(children) {
            return (children || []).filter(n => n && n.name);
        }

        function stMvuZodFields(children, pad) {
            const list = stMvuNamed(children);
            if (!list.length) return '';
            return list.map(n => '\n' + pad + stMvuKey(n.name) + ': ' + stMvuZodOf(n, pad)).join(',');
        }

        function stMvuZodCode() {
            const m = stEditor.card ? stEditor.card.mvu : null;
            const body = m ? stMvuZodFields(m.nodes, '  ') : '';
            const schema = 'z.object({' + body + '\n})';
            return "import { registerMvuSchema } from '" + ST_MVU_ZOD_URL + "';\n\n" +
                'export const Schema = ' + schema + ';\n\n' +
                '$( () => { registerMvuSchema(Schema); });';
        }

