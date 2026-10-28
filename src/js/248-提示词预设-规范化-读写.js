        // ===== 提示词预设：规范化 / 读写 =====

        // 把一个提示词槽规范化。ST 的预设 JSON 用 snake_case，内部统一成 camelCase，
        // 但保留 snake_case 的读法，这样 ST 导出的预设能直接用
        function normalizePromptSlot(raw, srcIndex) {
            const e = raw || {};
            const num = v => {
                const n = Number(v);
                return Number.isFinite(n) ? n : null;
            };
            const identifier = String(e.identifier || e.id || ('slot-' + srcIndex));
            // 内容全由应用填的槽才算 marker（用户改不了它的内容）。
            // main / jailbreak 不算 —— 它们的内容可以编辑，只是会被角色卡覆盖
            const isMarker = PM_APP_FILLED.indexOf(identifier) >= 0;
            // role：ST 存字符串 'system' / 'user' / 'assistant'
            const roleMap = { system: 0, user: 1, assistant: 2 };
            let role = 0;
            if (typeof e.role === 'string') {
                role = roleMap[e.role] !== undefined ? roleMap[e.role] : 0;
            } else {
                const rn = num(e.role);
                role = (rn === 1 || rn === 2) ? rn : 0;
            }
            const depthRaw = e.injection_depth !== undefined ? e.injection_depth : e.injectionDepth;
            const orderRaw = e.injection_order !== undefined ? e.injection_order : e.injectionOrder;
            const posRaw = e.injection_position !== undefined ? e.injection_position : e.injectionPosition;
            return {
                identifier,
                name: String(e.name || PM_MARKERS[identifier] || identifier),
                systemPrompt: e.system_prompt !== false && e.systemPrompt !== false,
                marker: isMarker,
                role,
                content: String(e.content == null ? '' : e.content),
                injectionPosition: num(posRaw) === PM_INJECTION.absolute
                    ? PM_INJECTION.absolute : PM_INJECTION.relative,
                injectionDepth: depthRaw === undefined || depthRaw === null
                    ? PM_DEFAULT_DEPTH : Math.max(0, Math.min(WI_MAX_INJECTION_DEPTH, num(depthRaw) || 0)),
                injectionOrder: orderRaw === undefined || orderRaw === null
                    ? PM_DEFAULT_ORDER : (num(orderRaw) || 0),
                forbidOverrides: e.forbid_overrides === true || e.forbidOverrides === true,
                injectionTrigger: Array.isArray(e.injection_trigger) ? e.injection_trigger.slice()
                    : (Array.isArray(e.injectionTrigger) ? e.injectionTrigger.slice() : []),
            };
        }

        // 从 ST 预设的 prompt_order 里挑一份顺序。ST 是按角色 id 存的，
        // 100000 是「没有角色」那份，没有就退到第一份
        function presetOrderFromRaw(raw) {
            const list = Array.isArray(raw && raw.prompt_order) ? raw.prompt_order : [];
            if (!list.length) return null;
            const pick = list.find(x => String(x && x.character_id) === '100000') || list[0];
            const order = pick && Array.isArray(pick.order) ? pick.order : null;
            if (!order) return null;
            return order
                .filter(x => x && x.identifier)
                .map(x => ({ identifier: String(x.identifier), enabled: x.enabled !== false }));
        }

        function normalizePromptPreset(raw, fallbackName, fallbackId) {
            const prompts = (Array.isArray(raw && raw.prompts) ? raw.prompts : [])
                .map((p, i) => normalizePromptSlot(p, i));
            let order = presetOrderFromRaw(raw);
            if (!order) {
                // 没有 prompt_order 就按 prompts 的顺序铺一遍，全部启用
                order = prompts.map(p => ({ identifier: p.identifier, enabled: true }));
            }
            // prompt_order 里提到、但 prompts 里没有的槽（ST 允许）也要补上，
            // 否则导入的预设会缺槽
            const known = new Set(prompts.map(p => p.identifier));
            order.forEach(o => {
                if (!known.has(o.identifier)) {
                    prompts.push(normalizePromptSlot({ identifier: o.identifier, marker: true }, prompts.length));
                    known.add(o.identifier);
                }
            });
            return {
                id: String(fallbackId || ('user-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7))),
                name: String((raw && raw.name) || fallbackName || '未命名预设'),
                builtin: false,
                prompts,
                order,
            };
        }

        // 当前选中的预设：先找内置，再找用户的，都没有就退回内置默认
        function getActivePreset() {
            const id = String(aiConfig.tavernPresetId || '');
            const builtin = BUILTIN_PRESETS.find(p => p.id === id);
            if (builtin) return builtin;
            const user = (aiConfig.tavernPresets || []).find(p => p.id === id);
            if (user) return user;
            return BUILTIN_PRESETS[0];
        }

        function presetList() {
            return BUILTIN_PRESETS.concat(aiConfig.tavernPresets || []);
        }

        function presetNewId() {
            return 'user-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        }

        // 复制一份预设并切过去。深拷贝 —— 别让副本和原件的 prompts / order 共享引用
        function presetDuplicate(src, suffix) {
            const copy = JSON.parse(JSON.stringify(src));
            copy.id = presetNewId();
            copy.name = String(src.name || '未命名预设') + (suffix || '（副本）');
            copy.builtin = false;
            if (!Array.isArray(aiConfig.tavernPresets)) aiConfig.tavernPresets = [];
            aiConfig.tavernPresets.push(copy);
            aiConfig.tavernPresetId = copy.id;
            return copy;
        }

        // 内置预设只读。要改就 fork 一份副本出来（用户改的时候不该把内置的改坏）
        function forkPresetIfBuiltin() {
            const cur = getActivePreset();
            if (!cur.builtin) return cur;
            return presetDuplicate(cur);
        }

        // 找当前预设里某个槽的可变对象（找不到就补一个）
        function presetSlotRef(preset, identifier) {
            return preset.prompts.find(p => p.identifier === identifier) || null;
        }

        function presetOrderIndex(preset, identifier) {
            return preset.order.findIndex(o => o.identifier === identifier);
        }

