        // —— 生成②：initvar YAML ——
        function stMvuYamlScalar(v) {
            const s = String(v == null ? '' : v);
            if (s === '') return '""';
            if (/^\s|\s$/.test(s) || /[:#\-?*&!|>%@`"'\[\]{},\n]/.test(s) ||
                /^(true|false|null|yes|no|on|off|~)$/i.test(s)) {
                return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
                    .replace(/\n/g, '\\n') + '"';
            }
            return s;
        }

        function stMvuYamlNode(n, ind) {
            const pad = ind || '';
            const key = stMvuYamlScalar(n.name);
            if (n.type === 'object') {
                const kids = stMvuNamed(n.children);
                if (!kids.length) return pad + key + ': {}';
                return pad + key + ':\n' +
                    kids.map(x => stMvuYamlNode(x, pad + '  ')).join('\n');
            }
            // 动态表 / 多选一没有确定的初始值
            if (n.type === 'record' || n.type === 'union') return pad + key + ': {}';
            return pad + key + ': ' + stMvuYamlScalar(stMvuDefaultText(n));
        }

        function stMvuInitVarYaml() {
            const m = stEditor.card ? stEditor.card.mvu : null;
            const nodes = m ? stMvuNamed(m.nodes) : [];
            const body = nodes.map(n => stMvuYamlNode(n, '')).join('\n');
            return body ? body + '\n' : '';
        }

