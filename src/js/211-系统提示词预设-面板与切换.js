        // ==========================================================================
        // 系统提示词预设
        // ==========================================================================
        function renderPromptPresets() {
            const row = document.getElementById('ai-preset-row');
            if (!row) return;
            row.innerHTML = '';
            const mk = (id, label) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'ai-preset-chip';
                b.dataset.preset = id;
                b.textContent = label;
                b.onclick = () => selectPromptPreset(id);
                row.appendChild(b);
            };
            AI_PROMPT_PRESETS.forEach(p => mk(p.id, p.label));
            mk(PRESET_CUSTOM, '✎ 自定义');
        }

        function syncPromptPresetUI() {
            const id = aiConfig.promptPreset || PRESET_CUSTOM;
            document.querySelectorAll('#ai-preset-row .ai-preset-chip').forEach(b => {
                b.classList.toggle('active', b.dataset.preset === id);
            });
            const desc = document.getElementById('ai-preset-desc');
            if (!desc) return;
            const p = findPromptPreset(id);
            desc.textContent = p ? p.desc : '用你自己写的设定。想回到预设，点上面任意一个就行。';
        }

        function selectPromptPreset(id) {
            const ta = document.getElementById('ai-system-prompt');
            if (!ta) return;
            if (id === PRESET_CUSTOM) {
                // 切到自定义：直接换回上次自己写的内容。
                // 注意不要拿当前 textarea 去覆盖 customPrompt —— 那里面装的是预设原文，
                // 会把你之前写的东西冲掉（onSystemPromptInput 已经在每次输入时同步过了）
                ta.value = aiConfig.customPrompt || '';
            } else {
                const p = findPromptPreset(id);
                if (!p) return;
                ta.value = p.prompt;
            }
            aiConfig.promptPreset = id;
            aiConfig.systemPrompt = ta.value;
            persistSystemPrompt();
            syncPromptPresetUI();
        }

        // textarea 被手动改动 → 内容对不上任何预设就自动切到「自定义」
        function onSystemPromptInput() {
            const ta = document.getElementById('ai-system-prompt');
            if (!ta) return;
            aiConfig.systemPrompt = ta.value;
            const detected = detectPromptPreset(ta.value);
            aiConfig.promptPreset = detected;
            if (detected === PRESET_CUSTOM) aiConfig.customPrompt = ta.value;
            persistSystemPrompt();
            syncPromptPresetUI();
        }

        // 只回写提示词相关字段（aiConfig 里的 apiKey 仍是上次载入的值，不会误存未保存的输入）
        function persistSystemPrompt() {
            // ⚠ 「第一段」现在属于 API 配置（能跟随全局），独立模式下改它也要同步进 own，
            //   所以这里得走 own 同步 —— 提示词本身的改动同步是无副作用的（值没变）
            aiSyncOwnFromEffective();
            aiPersist();
        }

