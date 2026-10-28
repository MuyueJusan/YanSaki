        // —— 消息整形 ——
        // Anthropic 的 system 走顶层字段，不在 messages 里；而且 messages 必须
        // 以 user 开头、不能有连续的相同角色。这里一次全处理掉
        function stAiSplitSystem(messages) {
            const sys = [], rest = [];
            (messages || []).forEach(m => {
                const role = m && m.role === 'assistant' ? 'assistant' : (m && m.role === 'system' ? 'system' : 'user');
                const content = String(m && m.content != null ? m.content : '');
                if (role === 'system') sys.push(content);
                else rest.push({ role: role, content: content });
            });
            return { system: sys.join('\n\n'), messages: stAiMergeRoles(rest) };
        }

        function stAiMergeRoles(list) {
            const out = [];
            list.forEach(m => {
                const last = out[out.length - 1];
                if (last && last.role === m.role) last.content += '\n\n' + m.content;
                else out.push({ role: m.role, content: m.content });
            });
            if (!out.length) out.push({ role: 'user', content: '（继续）' });
            if (out[0].role !== 'user') out.unshift({ role: 'user', content: '（继续）' });
            return out;
        }

