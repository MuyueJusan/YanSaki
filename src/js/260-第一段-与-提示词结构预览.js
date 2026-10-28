        // ===== 「第一段」与「提示词结构预览」=====
        //
        // 「第一段」= 用户自己写、**一定排在发给模型最前面**的那一段。
        // 它跟各功能面板的 system / user 是两回事：那两个是程序拼的，
        // 这一段永远原封不动排在最前（空着就不发）。
        //
        // ⚠ 它必须是 role = 'system'：Anthropic 的 messages 里 system 会被
        // stAiSplitSystem 提到顶层 system 字段，而 messages 必须以 user 开头；
        // 换成 user 角色塞在最前面就会变成「先说话再给指令」，而且 OpenAI 那边
        // 也是 system 更符合语义。两条协议下它都在最前面，这是能同时成立的唯一写法。
        function stAiFirstSegText() {
            const raw = String(stAiCfg().firstSeg || '');
            if (!raw.trim()) return '';
            // 卡片编写器里没有「用户昵称」这个概念，所以只认 {{char}}。
            // 留着的 {{user}} 会原样发出去 —— 在这里替换成「你」反而更怪
            const name = String((stEditor.card && stEditor.card.name) || '').trim();
            return name ? raw.split('{{char}}').join(name) : raw;
        }

        // 三个功能面板发出去的消息长得一模一样：第一段 → system → user。
        // 抽出来是为了让「第一段确实在最前面」这件事只有一个实现点
        function stAiPlanMessages(plan) {
            const out = [];
            const seg = stAiFirstSegText();
            if (seg) out.push({ role: 'system', content: seg, label: '第一段（你自己写的）', first: true });
            out.push({ role: 'system', content: String(plan.system || ''), label: '任务提示词 system' });
            out.push({ role: 'user', content: String(plan.user || ''), label: '任务与素材 user' });
            return out;
        }

