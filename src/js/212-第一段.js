        // —— 「第一段」——
        // 用户自己写、**一定排在发给模型最前面**的那一段。
        // 跟系统提示词的区别：系统提示词会被预设 / 酒馆模式接管（还能整个关掉），
        // 这一段永远原样排在最前，不受那两个开关影响；空着就不发。
        function firstSegText() {
            const raw = String(aiConfig.firstSeg || '');
            if (!raw.trim()) return '';
            // 跟系统提示词同一套宏 —— 同一页里两种语义会让人猜不透
            return applyUserMacros(raw);
        }

        function onFirstSegInput() {
            const ta = document.getElementById('ai-first-seg');
            if (!ta) return;
            aiConfig.firstSeg = ta.value;
            // 同一个 localStorage 键，直接复用（它写的就是整个 aiConfig）
            persistSystemPrompt();
        }

        // —— 原系统提示词开关（与酒馆模式互斥）——
        function renderPromptUI() {
            const on = aiConfig.promptEnabled !== false;
            const chk = document.getElementById('ai-prompt-enabled');
            if (chk) chk.checked = on;
            const body = document.getElementById('ai-prompt-body');
            if (body) body.classList.toggle('ai-prompt-off', !on);
        }

        // 开系统提示词 → 关酒馆模式，两者不能同时生效
        function onPromptToggle() {
            const chk = document.getElementById('ai-prompt-enabled');
            aiConfig.promptEnabled = !!(chk && chk.checked);
            if (aiConfig.promptEnabled) aiConfig.tavernEnabled = false;
            persistTavern();
            renderPromptUI();
            renderTavernUI();
            // 顺带关掉了酒馆模式 → 「用户人设」面板要解锁
            syncUserMacroUI();
            setTavernStatus(aiConfig.promptEnabled
                ? '系统提示词已开启 · 酒馆模式已关闭'
                : '系统提示词已关闭，此时不会发送任何主提示词');
            refreshGreetingIfFresh();
        }

