        // —— 生成③：变量更新规则 YAML（骨架）——
        function stMvuRulesNode(n, ind) {
            const pad = ind || '';
            const kid = pad + '  ';
            const key = stMvuYamlScalar(n.name);
            if (n.type === 'object' || n.type === 'record') {
                const kids = stMvuNamed(n.children);
                if (!kids.length) return '';
                return pad + key + ':\n' +
                    kids.map(x => stMvuRulesNode(x, kid)).filter(Boolean).join('\n');
            }
            const lines = [pad + key + ':'];
            if (n.type === 'number') {
                lines.push(kid + 'type: number');
                if (n.min !== null || n.max !== null) {
                    lines.push(kid + 'range: ' + (n.min === null ? '' : n.min) + '~' +
                        (n.max === null ? '' : n.max));
                }
            } else if (n.type === 'enum') {
                lines.push(kid + 'type: ' + (n.options.length ? n.options.join(' | ') : 'string'));
            } else if (n.type === 'boolean') {
                lines.push(kid + 'type: boolean');
            } else if (n.type === 'union') {
                lines.push(kid + 'type: string | number');
            } else {
                lines.push(kid + 'type: string');
            }
            if (n.desc) lines.push(kid + 'value: ' + stMvuYamlScalar(n.desc));
            lines.push(kid + 'check:');
            lines.push(kid + '  - ' + stMvuYamlScalar(
                n.desc ? n.desc + ' 变化时更新' : '（写清楚什么时候更新这个变量）'));
            return lines.join('\n');
        }

        function stMvuRulesYaml() {
            const m = stEditor.card ? stEditor.card.mvu : null;
            const nodes = m ? stMvuNamed(m.nodes) : [];
            const body = nodes.map(n => stMvuRulesNode(n, '  ')).filter(Boolean).join('\n');
            return '---\n变量更新规则:\n' + (body || '  {}') + '\n';
        }

