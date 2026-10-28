        // ===== 提示词预设面板 =====
        // 一行 = 一个槽，行的顺序就是 ST 的 prompt_order。
        // 改结构（勾选 / 排序 / 增删）会整块重画；改内容不会 —— 否则输入框会掉焦点

        function presetSlotHtml(preset, orderEntry, index) {
            const slot = presetSlotRef(preset, orderEntry.identifier);
            if (!slot) return '';
            const enabled = orderEntry.enabled !== false;
            const isCardField = PM_CARD_OVERRIDABLE.indexOf(slot.identifier) >= 0;
            const isAbs = slot.injectionPosition === PM_INJECTION.absolute;
            const n = preset.order.length;

            // 三个小徽章：内容从哪来 / 插在哪 / 用什么角色发出去
            const srcBadge = slot.marker
                ? '<span class="ai-tv-pos marker" title="内容由应用填，预设里改不了">应用填</span>'
                : (isCardField
                    ? '<span class="ai-tv-pos marker" title="角色卡自带字段会覆盖这里写的内容">卡覆盖</span>'
                    : '<span class="ai-tv-pos" title="内容写在预设里">预设</span>');
            const posBadge = isAbs
                ? '<span class="ai-tv-pos abs" title="' + PM_INJECTION_NAME[1] + '">深度 ' + slot.injectionDepth + '</span>'
                : '<span class="ai-tv-pos" title="' + PM_INJECTION_NAME[0] + '">顺序</span>';
            const roleBadge = '<span class="ai-tv-pos" title="这条消息的角色">' +
                (WI_ROLE_LABEL[slot.role] || '系统') + '</span>';

            const roleOpts = [0, 1, 2].map(r => '<option value="' + r + '"' +
                (slot.role === r ? ' selected' : '') + '>' + WI_ROLE_LABEL[r] + '</option>').join('');
            const posOpts = [PM_INJECTION.relative, PM_INJECTION.absolute].map(v =>
                '<option value="' + v + '"' + (slot.injectionPosition === v ? ' selected' : '') + '>' +
                PM_INJECTION_NAME[v] + '</option>').join('');

            // 内容由应用填的槽不给编辑框 —— 给了也没用，改完还是被覆盖
            const contentEditor = slot.marker
                ? '<div class="ai-tv-slot-tip">内容由应用填' +
                    (PM_MARKERS[slot.identifier] ? '（' + escapeHtml(PM_MARKERS[slot.identifier]) + '）' : '') +
                    '，预设里改不了。把它关掉或挪个位置就好。</div>'
                : '<textarea class="ai-tv-slot-content" rows="3"' +
                    ' placeholder="这个槽的内容（支持 {{char}} / {{user}} 等宏）"' +
                    ' oninput="onPresetSlotField(' + index + ',\'content\',this.value)">' +
                    escapeHtml(slot.content) + '</textarea>';

            // injection_trigger 非空时只在列出的生成类型下生效。本应用只有 normal
            const trigNote = (slot.injectionTrigger.length &&
                slot.injectionTrigger.indexOf(PM_GENERATION_TYPE) < 0)
                ? '<div class="ai-tv-slot-tip">⚠️ 这个槽的 injection_trigger 是 ' +
                  escapeHtml(slot.injectionTrigger.join(' / ')) +
                  '，不含 normal —— 本应用只做普通生成，所以它永远不会插入。</div>'
                : '';

            return '<details class="ai-tv-slot' + (enabled ? '' : ' off') + '">' +
                '<summary>' +
                    '<label class="ai-tv-slot-chkwrap" title="启用 / 停用这个槽"' +
                        ' onclick="event.stopPropagation()">' +
                        '<input class="ai-tv-slot-chk" type="checkbox"' + (enabled ? ' checked' : '') +
                            ' onchange="onPresetSlotToggle(' + index + ',this.checked)">' +
                    '</label>' +
                    '<span class="ai-tv-slot-idx">' + (index + 1) + '</span>' +
                    '<span class="ai-tv-label">' + escapeHtml(slot.name) + '</span>' +
                    srcBadge + posBadge + roleBadge +
                    '<span class="ai-tv-slot-move">' +
                        '<button type="button" title="上移"' + (index === 0 ? ' disabled' : '') +
                            ' onclick="onPresetSlotMove(' + index + ',-1)">⇧</button>' +
                        '<button type="button" title="下移"' + (index === n - 1 ? ' disabled' : '') +
                            ' onclick="onPresetSlotMove(' + index + ',1)">⇩</button>' +
                    '</span>' +
                '</summary>' +
                '<div class="ai-tv-body">' +
                    (slot.marker ? '' :
                        '<label class="ai-tv-slot-namewrap">名称' +
                        '<input class="ai-tv-slot-name" type="text" value="' + escapeHtml(slot.name) + '"' +
                        ' oninput="onPresetSlotField(' + index + ',\'name\',this.value)"></label>') +
                    contentEditor +
                    '<div class="ai-tv-grid">' +
                        '<label>角色 <select onchange="onPresetSlotField(' + index + ',\'role\',this.value)">' +
                            roleOpts + '</select></label>' +
                        '<label>插入 <select onchange="onPresetSlotField(' + index + ',\'injectionPosition\',this.value)">' +
                            posOpts + '</select></label>' +
                        (isAbs
                            ? '<label>深度 <input type="number" min="0" max="' + WI_MAX_INJECTION_DEPTH +
                              '" value="' + slot.injectionDepth + '"' +
                              ' title="injection_depth：从对话末尾往回数第几条"' +
                              ' onchange="onPresetSlotField(' + index + ',\'injectionDepth\',this.value)"></label>'
                            : '') +
                        '<label>优先级 <input type="number" min="0" max="9999" value="' + slot.injectionOrder + '"' +
                            ' title="injection_order：同一个深度里数值大的先收集（ST 的语义）"' +
                            ' onchange="onPresetSlotField(' + index + ',\'injectionOrder\',this.value)"></label>' +
                        (isCardField
                            ? '<label title="对应 ST 的 forbid_overrides：勾上就用预设里的内容，不让角色卡字段覆盖">' +
                              '<input type="checkbox"' + (slot.forbidOverrides ? ' checked' : '') +
                              ' onchange="onPresetSlotField(' + index + ',\'forbidOverrides\',this.checked)"> 禁止角色卡覆盖</label>'
                            : '') +
                    '</div>' +
                    trigNote +
                    '<button class="ai-btn ai-btn-mini ai-tv-slot-del" type="button"' +
                        ' onclick="onPresetSlotDelete(' + index + ')">🗑 删除这个槽</button>' +
                '</div>' +
            '</details>';
        }

        function renderTavernPreset() {
            const box = document.getElementById('ai-tavern-preset');
            if (!box) return;
            const preset = getActivePreset();
            const list = presetList();

            // 重画前记下展开状态：外层折叠面板 + 每个槽
            const outer = box.querySelector('.ai-tv-preset');
            const outerOpen = outer ? outer.open : false;
            const wasOpen = new Set();
            box.querySelectorAll('.ai-tv-slot').forEach((d, i) => { if (d.open) wasOpen.add(i); });

            const opts = list.map(p => '<option value="' + escapeHtml(p.id) + '"' +
                (p.id === preset.id ? ' selected' : '') + '>' +
                escapeHtml(p.name) + (p.builtin ? '（内置）' : '') + '</option>').join('');

            const enabledN = preset.order.filter(o => o.enabled !== false).length;
            box.innerHTML =
                '<details class="ai-tv-preset"' + (outerOpen ? ' open' : '') + '>' +
                    '<summary>🧩 提示词预设 · ' + escapeHtml(preset.name) +
                        ' · ' + enabledN + '/' + preset.order.length + ' 槽启用</summary>' +
                    '<div class="ai-tv-grid">' +
                        '<label>预设 <select id="ai-tv-preset-select" onchange="onPresetSelect(this.value)">' +
                            opts + '</select></label>' +
                        (preset.builtin
                            ? '<label title="内置预设只读">名称 ' +
                              '<span class="ai-tv-slot-name-ro ai-tv-preset-name-ro">' + escapeHtml(preset.name) + '</span></label>'
                            : '<label>名称 <input class="ai-tv-slot-name ai-tv-preset-name" type="text" value="' +
                              escapeHtml(preset.name) + '"' +
                              ' oninput="onPresetNameInput(this.value)"></label>') +
                    '</div>' +
                    '<div class="ai-tv-preset-actions">' +
                        '<button class="ai-btn ai-btn-mini" type="button"' +
                            ' onclick="document.getElementById(\'ai-preset-file\').click()">📥 导入预设 JSON</button>' +
                        '<button class="ai-btn ai-btn-mini" type="button" onclick="presetSaveCopy()">💾 另存为副本</button>' +
                        '<button class="ai-btn ai-btn-mini" type="button" onclick="presetAddSlot()">＋ 加一个槽</button>' +
                        '<button class="ai-btn ai-btn-mini" type="button" id="ai-tv-preset-del"' +
                            ' onclick="presetDelete()"' + (preset.builtin ? ' disabled' : '') + '>🗑 删除预设</button>' +
                    '</div>' +
                    '<input type="file" id="ai-preset-file" class="ai-hidden-file"' +
                        ' accept=".json,application/json" onchange="onPresetFilePicked(event)">' +
                    '<div class="ai-tv-preset-note">' +
                        (preset.builtin
                            ? '内置预设<b>只读</b>：一改就自动生成一份你自己的副本，内置那份保持原样。'
                            : '这是你自己的预设，改动会立刻保存。') +
                        ' 行序就是 ST 的 <code>prompt_order</code>：勾选框 = 启用，⇧ / ⇩ 调顺序。<br>' +
                        '「应用填」的槽内容由应用提供（世界书 / 角色卡字段 / 聊天记录）；' +
                        '「卡覆盖」的槽可以在预设里写内容，但角色卡自带字段会盖掉它（ST 的 <code>forbid_overrides</code> 可以禁止覆盖）。<br>' +
                        '标记为<b>对话内注入</b>的槽会从顺序流里摘出来，按 <code>injection_depth</code> 插进聊天记录里。' +
                    '</div>' +
                    '<div class="ai-tv-preset-list">' +
                        preset.order.map((o, i) => presetSlotHtml(preset, o, i)).join('') +
                    '</div>' +
                '</details>';

            if (wasOpen.size) {
                const rows = box.querySelectorAll('.ai-tv-slot');
                wasOpen.forEach(i => { if (rows[i]) rows[i].open = true; });
            }
        }

        function presetRefresh(opts) {
            persistTavern();
            renderTavernPreview();
            if (!(opts && opts.soft)) renderTavernPreset();
        }

