        // —— 预设：切换 / 增删 / 排序 ——

        function onPresetSelect(id) {
            const p = presetList().find(x => x.id === id);
            if (!p) return;
            aiConfig.tavernPresetId = p.id;
            presetRefresh();
        }

        // 改名：内置的不能改，所以先 fork 一份出来（会切到副本，得整块重画）
        function onPresetNameInput(value) {
            const cur = getActivePreset();
            if (cur.builtin) {
                const copy = forkPresetIfBuiltin();
                copy.name = String(value == null ? '' : value) || '未命名预设';
                presetRefresh();
                const el = document.querySelector('#ai-tavern-preset .ai-tv-preset-name');
                if (el) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch (e) { } }
                return;
            }
            cur.name = String(value == null ? '' : value) || '未命名预设';
            presetRefresh({ soft: true });
            // 外层 summary 上写着名字，顺手同步一下（省得整块重画掉焦点）
            const sum = document.querySelector('#ai-tavern-preset .ai-tv-preset > summary');
            if (sum) {
                const enabledN = cur.order.filter(o => o.enabled !== false).length;
                sum.textContent = '🧩 提示词预设 · ' + cur.name + ' · ' + enabledN + '/' + cur.order.length + ' 槽启用';
            }
        }

        function presetSaveCopy() {
            const cur = getActivePreset();
            const copy = presetDuplicate(cur);
            presetRefresh();
            setTavernStatus('已另存为「' + copy.name + '」（' + copy.prompts.length + ' 个槽）', 'ok');
        }

        function presetDelete() {
            const cur = getActivePreset();
            if (cur.builtin) return;
            if (!window.confirm('删除预设「' + cur.name + '」？')) return;
            const i = (aiConfig.tavernPresets || []).findIndex(p => p.id === cur.id);
            if (i >= 0) aiConfig.tavernPresets.splice(i, 1);
            aiConfig.tavernPresetId = BUILTIN_PRESETS[0].id;
            presetRefresh();
            setTavernStatus('已删除预设「' + cur.name + '」', 'ok');
        }

        function presetAddSlot() {
            const preset = forkPresetIfBuiltin();
            let n = 1;
            while (preset.prompts.some(p => p.identifier === 'custom' + n)) n++;
            const slot = normalizePromptSlot({
                identifier: 'custom' + n,
                name: '自定义提示词 ' + n,
                role: 'system',
                content: ''
            }, preset.prompts.length);
            preset.prompts.push(slot);
            // 新槽放在 main 之后，最贴近 ST 里「加在列表中间」的直觉
            const at = Math.max(0, presetOrderIndex(preset, 'main')) + 1;
            preset.order.splice(at, 0, { identifier: slot.identifier, enabled: true });
            presetRefresh();
            setTavernStatus('已加一个槽「' + slot.name + '」—— 展开它写内容', 'ok');
        }

        function onPresetSlotToggle(index, checked) {
            const preset = forkPresetIfBuiltin();
            const o = preset.order[index];
            if (!o) return;
            o.enabled = !!checked;
            presetRefresh();
        }

        function onPresetSlotMove(index, delta) {
            const preset = forkPresetIfBuiltin();
            const to = index + delta;
            if (to < 0 || to >= preset.order.length) return;
            const arr = preset.order;
            const moved = arr.splice(index, 1)[0];
            arr.splice(to, 0, moved);
            presetRefresh();
        }

        function onPresetSlotDelete(index) {
            const preset = forkPresetIfBuiltin();
            const o = preset.order[index];
            if (!o) return;
            const slot = presetSlotRef(preset, o.identifier);
            const label = slot ? slot.name : o.identifier;
            if (!window.confirm('从预设里删掉「' + label + '」？')) return;
            preset.order.splice(index, 1);
            // 定义也一起删 —— ST 的预设里 prompts 和 prompt_order 是一体的
            const pi = preset.prompts.findIndex(p => p.identifier === o.identifier);
            if (pi >= 0) preset.prompts.splice(pi, 1);
            presetRefresh();
            setTavernStatus('已删掉槽「' + label + '」', 'ok');
        }

        // 改槽的字段。名称 / 内容是边打边存的，所以不重画列表（会掉焦点）
        function onPresetSlotField(index, field, value) {
            const preset = forkPresetIfBuiltin();
            const o = preset.order[index];
            if (!o) return;
            const slot = presetSlotRef(preset, o.identifier);
            if (!slot) return;
            switch (field) {
                case 'name': slot.name = String(value == null ? '' : value) || o.identifier; break;
                case 'content': slot.content = String(value == null ? '' : value); break;
                case 'role':
                    slot.role = Number(value) === 1 ? 1 : (Number(value) === 2 ? 2 : 0);
                    break;
                case 'injectionPosition':
                    slot.injectionPosition = Number(value) === PM_INJECTION.absolute
                        ? PM_INJECTION.absolute : PM_INJECTION.relative;
                    break;
                case 'injectionDepth':
                    slot.injectionDepth = Math.max(0, Math.min(WI_MAX_INJECTION_DEPTH, parseInt(value, 10) || 0));
                    break;
                case 'injectionOrder':
                    slot.injectionOrder = Math.max(0, Math.min(9999, parseInt(value, 10) || 0));
                    break;
                case 'forbidOverrides': slot.forbidOverrides = value === true; break;
                default: return;
            }
            const soft = (field === 'name' || field === 'content');
            presetRefresh({ soft: soft });
            if (soft) {
                // 行头 / 外层 summary 上的名字也得跟着变，但不重画整个列表
                const row = document.querySelectorAll('#ai-tavern-preset .ai-tv-slot')[index];
                if (row && field === 'name') {
                    const lab = row.querySelector('.ai-tv-label');
                    if (lab) lab.textContent = slot.name;
                }
            }
        }

