        // —— 迁移与载入 ——
        (function initApiGlobal() {
            const firstTime = apiGlobalLoad();
            // 老配置里没有这两个字段：独立配置默认播种成「当前这份」，
            // 免得用户一切到独立就面对一片空白
            if (!aiConfig.own || typeof aiConfig.own !== 'object' || Array.isArray(aiConfig.own)) {
                aiConfig.own = apiGlobalPick(aiConfig);
            } else {
                aiConfig.own = apiGlobalNormalize(aiConfig.own);
            }
            // 默认跟随全局（用户指定）。只有明确写了 false 才算独立
            aiConfig.followGlobal = aiConfig.followGlobal !== false;
            aiApplyEffective();
            // 第一次播种要落盘，不然下次刷新又「第一次」一遍（每次都会把
            // 用户后来在全局面板改的东西当成播种源，那就白改了）
            if (firstTime) { apiGlobalPersist(); aiPersist(); }
        })();

        let customBaseUrlDraft = (aiConfig.provider === 'custom') ? aiConfig.baseUrl : '';
        let chatHistory = [];
        let aiBusy = false;

        // 把服务商预设装进一个 <select>，按 group 分组（optgroup）。
        // ⚠ 三处下拉共用这一个 —— 手写三份 forEach 的那天，一定会出现
        //   「新分组只加到了一处」，而且不报错、只是少几个选项
        function aiFillProviderSelect(sel) {
            if (!sel) return;
            const map = {};
            const seen = [];
            AI_PROVIDERS.forEach(p => {
                const name = String(p.group || '其他');
                if (!map[name]) { map[name] = []; seen.push(name); }
                map[name].push(p);
            });
            // 已知分组按 AI_PROVIDER_GROUPS 的顺序排前面；表里出现的新分组按出现序接在后面
            const names = AI_PROVIDER_GROUPS.filter(n => map[n])
                .concat(seen.filter(n => AI_PROVIDER_GROUPS.indexOf(n) < 0));
            sel.innerHTML = '';
            names.forEach(n => {
                const og = document.createElement('optgroup');
                og.label = n;
                map[n].forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.value;
                    opt.textContent = p.label;
                    og.appendChild(opt);
                });
                sel.appendChild(og);
            });
        }

        // 同上，但返回 HTML 字符串（编写器那一页是拼字符串渲染的，不是 DOM 操作）。
        // ⚠ 和 aiFillProviderSelect 共用同一套分组逻辑顺序 —— 两处若各写一份
        //   「哪个组排前面」的规则，迟早会不一致
        function aiProviderOptionsHtml(selected) {
            const map = {};
            const seen = [];
            AI_PROVIDERS.forEach(p => {
                const name = String(p.group || '其他');
                if (!map[name]) { map[name] = []; seen.push(name); }
                map[name].push(p);
            });
            const names = AI_PROVIDER_GROUPS.filter(n => map[n])
                .concat(seen.filter(n => AI_PROVIDER_GROUPS.indexOf(n) < 0));
            return names.map(n =>
                '<optgroup label="' + escapeHtml(n) + '">' +
                    map[n].map(p => '<option value="' + escapeHtml(p.value) + '"' +
                        (p.value === selected ? ' selected' : '') + '>' +
                        escapeHtml(p.label) + '</option>').join('') +
                '</optgroup>').join('');
        }

        function initAiArea() {
            const providerSel = document.getElementById('ai-provider');
            aiFillProviderSelect(providerSel);
            providerSel.value = aiConfig.provider;
            syncAiProviderUI();
            document.getElementById('ai-api-key').value = aiConfig.apiKey || '';
            document.getElementById('ai-stream').checked = !!aiConfig.stream;
            updateAiStreamLabel();
            document.getElementById('ai-temperature').value = aiConfig.temperature;
            document.getElementById('ai-temp-value').textContent = Number(aiConfig.temperature).toFixed(1);
            document.getElementById('ai-max-tokens').value = aiConfig.maxTokens;
            document.getElementById('ai-system-prompt').value = aiConfig.systemPrompt || '';
            // 「第一段」：老配置里没这个字段，合并默认值之后是空串 —— 回填一次
            document.getElementById('ai-first-seg').value = aiConfig.firstSeg || '';
            // 系统提示词预设：老配置没存过预设 id，就按内容认回来
            if (!aiConfigHadPresetKey) {
                const detected = detectPromptPreset(aiConfig.systemPrompt);
                aiConfig.promptPreset = detected;
                if (detected === PRESET_CUSTOM) {
                    aiConfig.customPrompt = aiConfig.systemPrompt || '';
                } else {
                    // 认出来是老版默认提示词 —— 直接升级成带性格描述的完整版
                    aiConfig.systemPrompt = findPromptPreset(detected).prompt;
                    document.getElementById('ai-system-prompt').value = aiConfig.systemPrompt;
                    aiConfig.customPrompt = '';
                }
                aiConfigHadPresetKey = true;
            }
            renderPromptPresets();
            syncPromptPresetUI();
            renderPromptUI();
            renderTavernUI();
            // {{user}} 宏相关控件回填（syncUserMacroUI 里会按酒馆模式决定锁不锁）
            fillUserMacroInputs();
            syncUserMacroUI();
            setAiModelOption(aiConfig.model);
            // 最后收口「配置来源」：跟随时它会把上面那批 API 控件改成只读镜像
            // ⚠ 必须排在所有回填之后 —— 它才是 API 字段的最终来源
            syncAiCfgSourceUI();
        }

        // 把模型名装进候选（datalist）并写进输入框。
        // ⚠ 控件是 input + datalist ⇒ 「候选」和「当前值」是**两个元素**：
        //   候选读 `ai-model-list`，当前值读 `ai-model`。写成 `sel.options` 会当场崩
        // ⚠ 空值也要**照写**：这个函数同时被 syncAiCfgSourceUI 当镜像用 ——
        //   切来源时全局那份模型名是空的，不写就等于把上一个来源的名字留在框里
        function setAiModelOption(modelId) {
            const input = document.getElementById('ai-model');
            const list = document.getElementById('ai-model-list');
            const v = String(modelId == null ? '' : modelId);
            if (v && list && ![...list.options].some(o => o.value === v)) {
                const opt = document.createElement('option');
                opt.value = v;
                list.appendChild(opt);
            }
            if (input) input.value = v;
        }

        function syncAiProviderUI() {
            const p = AI_PROVIDERS.find(x => x.value === document.getElementById('ai-provider').value) || AI_PROVIDERS[0];
            const urlInput = document.getElementById('ai-base-url');
            if (p.custom) {
                urlInput.disabled = false;
                urlInput.value = customBaseUrlDraft || '';
            } else {
                urlInput.disabled = true;
                urlInput.value = p.baseUrl || '';
            }
            syncAiVertexHint();
        }

        // 这个面板**没有** Vertex 的项目 / 位置 / 认证方式那几格（只有全局面板有）。
        // 独立配置选了 Vertex 就得说清楚「那几项沿用全局那份」，否则用户会以为
        // 完整模式在这个面板里用不了（或者更糟：以为能用，填了个 Key 就走了快速模式）
        function syncAiVertexHint() {
            const prov = (document.getElementById('ai-provider') || {}).value;
            const baseUrl = (document.getElementById('ai-base-url') || {}).value || '';
            const isVertex = !!(AI_PROVIDERS.find(x => x.value === prov) || {}).vertex;
            const follow = aiConfig.followGlobal !== false;
            // ⚠⚠ API Key 那一格在完整模式下要**藏起来**：那一档是拿 SA JSON 去换
            //   access token 的，Key 根本没有用武之地。全局面板早就这么做了
            //   （apig-key-field，见 syncApigAuthUI），这里漏了 —— 于是用户在
            //   【ai对话】里对着一个「填了没用、不填又像缺了东西」的空框发愣，
            //   点「应用」还被「请先填写 API Key」拦住。那是**同一个 bug 的两半**。
            // ⚠ 判据与 stAiNeedsKey() 对齐：走 stAiIsVertex()（它还会看 baseUrl），
            //   别只用下拉框那一份 —— 自定义服务商填 aiplatform 域名时两者会分叉
            const keyField = document.getElementById('ai-key-field');
            if (keyField) {
                keyField.hidden = !!(stAiIsVertex({ provider: prov, baseUrl: baseUrl })
                    && aiConfig.authMode === 'sa');
            }
            const el = document.getElementById('ai-vertex-hint');
            if (!el) return;
            el.style.display = (isVertex && !follow) ? '' : 'none';
        }

        function getAiConfigFromInputs() {
            const p = AI_PROVIDERS.find(x => x.value === document.getElementById('ai-provider').value) || AI_PROVIDERS[0];
            let baseUrl = p.custom
                ? (document.getElementById('ai-base-url').value || '').trim()
                : (p.baseUrl || '');
            baseUrl = baseUrl.replace(/\/+$/, '');
            return {
                provider: p.value,
                baseUrl: baseUrl,
                apiKey: document.getElementById('ai-api-key').value.trim(),
                model: document.getElementById('ai-model').value.trim(),
                stream: document.getElementById('ai-stream').checked,
                temperature: parseFloat(document.getElementById('ai-temperature').value) || 0.7,
                maxTokens: parseInt(document.getElementById('ai-max-tokens').value, 10) || 1024,
                systemPrompt: document.getElementById('ai-system-prompt').value,
                firstSeg: document.getElementById('ai-first-seg').value,
                // 这两个没有对应的输入控件，直接沿用当前值，
                // 否则点「保存 / 应用」会把预设选择丢掉
                promptPreset: aiConfig.promptPreset,
                // ⚠⚠ 配置来源与独立快照也必须原样带回去 —— 这个函数返回的是**新对象**，
                //   漏掉这两个字段就等于「点一次保存，配置来源被打回默认 + 独立那份没了」
                followGlobal: aiConfig.followGlobal,
                own: aiConfig.own,
                // ⚠⚠ 同理：Vertex 那四个字段在这个面板里**没有控件**（只在【API 全局配置】
                //   里改），但独立模式保存时 `aiSyncOwnFromEffective()` 会拿这个对象去
                //   `apiGlobalPick()` —— 漏掉它们 = 点一次保存，独立那份的 project /
                //   location / 认证方式 / Service Account JSON 全被打回默认
                authMode: aiConfig.authMode,
                project: aiConfig.project,
                location: aiConfig.location,
                saJson: aiConfig.saJson,
                customPrompt: aiConfig.customPrompt,
                // 原系统提示词开关（读 DOM，和酒馆开关一样）
                promptEnabled: document.getElementById('ai-prompt-enabled').checked,
                // 酒馆模式：角色卡 / 世界书整份沿用（只有开关读 DOM）
                tavernEnabled: document.getElementById('ai-tavern-enabled').checked,
                tavernCard: aiConfig.tavernCard,
                tavernLore: aiConfig.tavernLore,
                tavernGreetingIndex: aiConfig.tavernGreetingIndex,
                tavernScanDepth: aiConfig.tavernScanDepth,
                tavernRecursive: aiConfig.tavernRecursive,
                tavernIncludeNames: aiConfig.tavernIncludeNames,
                tavernCaseSensitive: aiConfig.tavernCaseSensitive,
                tavernMatchWholeWords: aiConfig.tavernMatchWholeWords,
                tavernGroupScoring: aiConfig.tavernGroupScoring,
                tavernMinActivations: aiConfig.tavernMinActivations,
                tavernMinActivationsDepthMax: aiConfig.tavernMinActivationsDepthMax,
                tavernMaxRecursionSteps: aiConfig.tavernMaxRecursionSteps,
                tavernTimed: aiConfig.tavernTimed,
                ...readUserMacroInputs()
            };
        }

        function updateAiStatus(msg) {
            const el = document.getElementById('ai-status');
            if (el) el.textContent = msg || '';
        }

        function updateAiTempLabel() {
            const v = document.getElementById('ai-temperature').value;
            document.getElementById('ai-temp-value').textContent = Number(v).toFixed(1);
        }

        function updateAiStreamLabel() {
            const checked = document.getElementById('ai-stream').checked;
            document.getElementById('ai-stream-label').textContent = checked ? '流式输出' : '非流式输出';
        }

