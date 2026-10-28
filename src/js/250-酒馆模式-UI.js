        // ===== 酒馆模式 UI =====

        // 「用户人设描述」面板是昵称的只读镜像，昵称一改就得跟着重画。
        // 记个缓存是因为初始化那条路是 renderTavernUI() → syncUserMacroUI()，
        // 没缓存的话每次开页面都要白画两遍
        let personaMirrorCache = null;

        function refreshPersonaMirror() {
            if (personaMirrorCache === personaRaw()) return;
            if (!tavernEnabled()) { personaMirrorCache = personaRaw(); return; }
            renderTavernLore();
            renderTavernPreview();
            personaMirrorCache = personaRaw();
        }

        function renderTavernUI() {
            const chk = document.getElementById('ai-tavern-enabled');
            if (chk) chk.checked = aiConfig.tavernEnabled === true;
            const body = document.getElementById('ai-tavern-body');
            if (body) body.classList.toggle('ai-tavern-off', aiConfig.tavernEnabled !== true);
            const clearBtn = document.getElementById('ai-tavern-clear');
            if (clearBtn) clearBtn.disabled = !aiConfig.tavernCard && !getLoreBook();
            renderTavernCard();
            renderTavernLore();
            renderTavernPreset();
            renderTavernPreview();
            // 记下这一轮画的是哪个昵称，好让 refreshPersonaMirror 判断要不要重画
            personaMirrorCache = personaRaw();
        }

        function renderTavernCard() {
            const box = document.getElementById('ai-tavern-card');
            if (!box) return;
            const c = aiConfig.tavernCard;
            if (!c) {
                box.innerHTML = '<div class="ai-tv-empty">还没有角色卡。点「📇 导入角色卡」选一个 PNG 或 JSON 卡。</div>';
                return;
            }
            const fields = [
                ['角色描述 description', c.description],
                ['性格 personality', c.personality],
                ['场景 scenario', c.scenario],
                ['示例对话 mes_example', c.mesExample],
                ['卡片系统提示词 system_prompt', c.systemPrompt],
                ['历史后指令 post_history_instructions', c.postHistoryInstructions],
                ['作者备注 creator_notes', c.creatorNotes]
            ].filter(f => f[1]);
            const greetings = greetingList();
            const gIdx = Number(aiConfig.tavernGreetingIndex) || 0;
            const book = getLoreBook();
            box.innerHTML =
                '<div class="ai-tv-card">' +
                    '<div class="ai-tv-name">📇 ' + escapeHtml(c.name) + '</div>' +
                    '<div class="ai-tv-meta">' +
                        '格式 ' + escapeHtml(String(c.spec).toUpperCase()) +
                        (c.creator ? ' · 作者 ' + escapeHtml(c.creator) : '') +
                        (c.characterVersion ? ' · 版本 ' + escapeHtml(c.characterVersion) : '') +
                        (book ? ' · 内置世界书 ' + book.entries.length + ' 条' : '') +
                    '</div>' +
                    (c.tags.length
                        ? '<div class="ai-tv-tags">' + c.tags.map(t => '<span class="ai-tv-tag">' + escapeHtml(t) + '</span>').join('') + '</div>'
                        : '') +
                    (greetings.length
                        ? '<div class="ai-tv-field"><b>开场白</b>' +
                          '<select id="ai-tv-greeting" onchange="onTavernGreetingChange(this.value)">' +
                          greetings.map((g, i) => '<option value="' + i + '"' + (i === gIdx ? ' selected' : '') + '>' +
                              escapeHtml(g.label) + '（' + g.text.length + ' 字）</option>').join('') +
                          '</select></div>'
                        : '') +
                    fields.map(f =>
                        '<details class="ai-tv-field"><summary><b>' + escapeHtml(f[0]) + '</b>' +
                        '<span class="ai-tv-len">' + f[1].length + ' 字</span></summary>' +
                        '<span class="ai-tv-text">' + escapeHtml(f[1]) + '</span></details>'
                    ).join('') +
                '</div>';
        }

        // 条目上那些「影响激活、但不适合做成输入框」的字段，列成一行行事实。
        // 只列真正设过的，避免每个条目都堆一大片默认值
        function wiEntryFacts(e) {
            const out = [];
            if (e.decorators.length) out.push('装饰器 ' + e.decorators.join(' / '));
            if (!e.useProbability) out.push('概率开关已关（总是通过）');
            else if (e.probability !== 100) out.push('概率 ' + e.probability + '%');
            if (e.delayUntilRecursion) out.push('延迟到递归层级 ' + e.delayUntilRecursion);
            if (e.excludeRecursion) out.push('不参与递归');
            if (e.preventRecursion) out.push('激活后不触发递归');
            if (e.sticky) out.push('黏性 ' + e.sticky + ' 条消息');
            if (e.cooldown) out.push('冷却 ' + e.cooldown + ' 条消息');
            if (e.delay) out.push('前 ' + e.delay + ' 条消息内不激活');
            if (e.group) {
                out.push('包含组「' + e.group + '」权重 ' + e.groupWeight +
                    (e.groupOverride ? ' · 组内优先' : '') +
                    (e.useGroupScoring === true ? ' · 组内评分' : ''));
            }
            if (e.scanDepth !== null && e.scanDepth !== undefined) out.push('单独扫描深度 ' + e.scanDepth);
            if (e.caseSensitive !== null) out.push(e.caseSensitive ? '区分大小写' : '不区分大小写');
            if (e.matchWholeWords !== null) out.push(e.matchWholeWords ? '全词匹配' : '子串匹配');
            if (e.triggers.length) out.push('只在 ' + e.triggers.join('/') + ' 生成时生效');
            if (e.characterFilter.names.length) {
                out.push((e.characterFilter.isExclude ? '排除角色 ' : '只对角色 ') +
                    e.characterFilter.names.join('、'));
            }
            if (e.characterFilter.tags.length) out.push('标签过滤（本应用没有标签系统，跳过）');
            const scans = [];
            if (e.matchPersonaDescription) scans.push('用户人设');
            if (e.matchCharacterDescription) scans.push('角色描述');
            if (e.matchCharacterPersonality) scans.push('性格');
            if (e.matchCharacterDepthPrompt) scans.push('角色深度提示词');
            if (e.matchScenario) scans.push('场景');
            if (e.matchCreatorNotes) scans.push('作者备注');
            if (scans.length) out.push('连同这些一起扫：' + scans.join('、'));
            if (e.position === WI_POS.outlet) {
                out.push('出口名「' + (e.outletName || '未命名') + '」（要插件消费，本模式不插入）');
            }
            return out;
        }

        function loreEntryHtml(e, i, act) {
            const off = e.enabled === false;
            const live = !!(act && act.activated);
            const posLabel = WI_POS_LABEL[e.position] || '?';
            const depthTag = (e.position === WI_POS.atDepth) ? ' · D' + e.depth : '';
            const keyText = e.constant
                ? '<b>常驻</b>（不看关键词，总是插入）'
                : '主关键词：' + (e.keys.length ? escapeHtml(e.keys.join('、')) : '<i>（空）</i>');
            const secText = (e.selective && e.secondaryKeys.length)
                ? '<br>次关键词：' + escapeHtml(e.secondaryKeys.join('、')) +
                  '　逻辑：' + escapeHtml(WI_SELECTIVE_LOGIC[e.selectiveLogic] || '任一命中')
                : '';
            const posOpts = WI_POS_ORDER.map(v =>
                '<option value="' + v + '"' + (v === e.position ? ' selected' : '') + '>' +
                WI_POS_LABEL[v] + ' ' + WI_POS_NAME[v] + '</option>').join('');
            const depthRow = (e.position === WI_POS.atDepth)
                ? '<label>深度 <input type="number" min="0" max="' + WI_MAX_INJECTION_DEPTH + '" value="' + e.depth +
                  '" onchange="onLoreEntryField(' + i + ',\'depth\',this.value)"></label>' +
                  '<label>角色 <select onchange="onLoreEntryField(' + i + ',\'role\',this.value)">' +
                  [0, 1, 2].map(r => '<option value="' + r + '"' + (r === e.role ? ' selected' : '') + '>' +
                      WI_ROLE_LABEL[r] + '</option>').join('') + '</select></label>'
                : '';
            const facts = wiEntryFacts(e);
            const actRow = act
                ? (live
                    ? '<div class="ai-tv-act on">✓ 本轮会插入</div>'
                    : '<div class="ai-tv-act">· 本轮不插入' +
                      (act.reason ? ' · ' + escapeHtml(act.reason) : '') + '</div>')
                : '';
            return '<details class="ai-tv-entry' + (off ? ' off' : '') + (live ? ' live' : '') + '">' +
                '<summary>' +
                    '<input type="checkbox"' + (off ? '' : ' checked') +
                        ' onclick="event.stopPropagation()" onchange="onLoreEntryToggle(' + i + ',this.checked)">' +
                    '<span class="ai-tv-dot' + (e.constant ? '' : ' key') + (live ? ' live' : '') + '"></span>' +
                    '<span class="ai-tv-label">' + escapeHtml(e.comment || entryLabel(e)) + '</span>' +
                    '<span class="ai-tv-pos">' + posLabel + depthTag + '</span>' +
                '</summary>' +
                '<div class="ai-tv-body">' +
                    actRow +
                    '<div class="ai-tv-keys">' + keyText + secText + '</div>' +
                    (facts.length
                        ? '<div class="ai-tv-facts">' +
                          facts.map(f => '<span>' + escapeHtml(f) + '</span>').join('') + '</div>'
                        : '') +
                    '<div class="ai-tv-grid">' +
                        '<label>位置 <select onchange="onLoreEntryField(' + i + ',\'position\',this.value)">' +
                            posOpts + '</select></label>' +
                        depthRow +
                        '<label>顺序 <input type="number" min="0" max="9999" value="' + e.order +
                            '" onchange="onLoreEntryField(' + i + ',\'order\',this.value)"></label>' +
                    '</div>' +
                    '<div class="ai-tv-content">' + (escapeHtml(e.content) || '<i>（空内容）</i>') + '</div>' +
                '</div>' +
            '</details>';
        }

        function renderTavernLore() {
            const box = document.getElementById('ai-tavern-lore');
            if (!box) return;
            const book = getLoreBook();
            if (!book || !book.entries.length) {
                box.innerHTML = '<div class="ai-tv-empty">还没有世界书。角色卡自带的话会自动读入，也可以单独导入 JSON。</div>';
                return;
            }
            // 改位置/深度会整块重画，先把展开状态记下来，画完再恢复
            const wasOpen = new Set();
            box.querySelectorAll('.ai-tv-entry').forEach((d, i) => { if (d.open) wasOpen.add(i); });
            // 几个折叠面板（全局设置 / 作者注释 / 用户人设描述）各记各的，
            // 别一个开了把另一个也带开
            const panelKey = d => d.classList.contains('ai-tv-an') ? 'an'
                : (d.classList.contains('ai-tv-persona') ? 'persona' : 'global');
            const wasOpenPanels = new Set();
            box.querySelectorAll('.ai-tv-an, .ai-tv-global, .ai-tv-persona').forEach(d => {
                if (d.open) wasOpenPanels.add(panelKey(d));
            });

            // 顺手跑一次试算，把「本轮哪些条目会插入、哪些不会」标出来。
            // dryRun：预览不能推进黏性 / 冷却状态
            const wi = tavernEnabled() ? scanWorldInfo(chatHistory, true) : null;
            const liveIds = new Set(wi ? wi.activated.map(e => e.id) : []);

            const on = book.entries.filter(e => e.enabled !== false).length;
            const declared = wiBookDeclaredNote(book);
            const numInput = (label, key, min, max, title) =>
                '<label title="' + title + '">' + label +
                ' <input type="number" min="' + min + '" max="' + max + '" value="' +
                (Number(aiConfig[key]) || 0) + '" onchange="onTavernSetting(\'' + key + '\',this.value)"></label>';
            const chkInput = (label, key, title) =>
                '<label title="' + title + '"><input type="checkbox"' +
                (aiConfig[key] === true ? ' checked' : '') +
                ' onchange="onTavernSetting(\'' + key + '\',this.checked)"> ' + label + '</label>';

            // 作者注释：↑AT / ↓AT 两个世界书位置夹住的就是它。
            // 位置 / 深度 / 角色 / 间隔 都对着 ST 的 authors-note.js 默认值
            const anPosOpts = [2, 0, 1].map(v =>
                '<option value="' + v + '"' + (anPosition() === v ? ' selected' : '') + '>' +
                AN_POS_NAME[v] + '</option>').join('');
            const anRoleOpts = [0, 1, 2].map(r =>
                '<option value="' + r + '"' + (anRole() === r ? ' selected' : '') + '>' +
                WI_ROLE_LABEL[r] + '</option>').join('');
            const anWillInsert = anShouldInsert();
            const anTopN = wi ? wi.anTop.length : 0;
            const anBottomN = wi ? wi.anBottom.length : 0;
            const anPanel =
                '<details class="ai-tv-an">' +
                    '<summary>作者注释（Author\'s Note）' +
                        (anTopN + anBottomN ? ' · 夹着 ' + (anTopN + anBottomN) + ' 条 ↑AT/↓AT' : '') +
                    '</summary>' +
                    '<div class="ai-hint">' +
                        'SillyTavern 里 <b>↑AT / ↓AT</b> 不是独立的插入位置，而是用来<b>夹住</b>作者注释的：' +
                        '它们会拼进注释的内容里（↑AT 在前、↓AT 在后），再整体按注释的位置 / 深度 / 角色注入。' +
                        '所以这里的设置会直接决定 ↑AT / ↓AT 落在哪。' +
                        (anWillInsert
                            ? ' 本轮<b>会</b>插入注释。'
                            : ' 本轮<b>不</b>插入注释（间隔未到），↑AT / ↓AT 跟着一起不插。') +
                    '</div>' +
                    '<div class="ai-tv-grid">' +
                        '<label>位置 <select onchange="onTavernSetting(\'tavernAnPosition\',this.value)">' +
                            anPosOpts + '</select></label>' +
                        '<label>角色 <select onchange="onTavernSetting(\'tavernAnRole\',this.value)">' +
                            anRoleOpts + '</select></label>' +
                        numInput('深度', 'tavernAnDepth', 0, WI_MAX_INJECTION_DEPTH,
                            '对应 SillyTavern 的 Author\'s Note Depth，默认 4') +
                        numInput('间隔', 'tavernAnInterval', 0, 9999,
                            '对应 Author\'s Note Insertion Frequency：每 N 条用户消息插一次，默认 1') +
                    '</div>' +
                    '<textarea class="ai-tv-an-text" rows="3" placeholder="作者注释正文（留空就只有 ↑AT / ↓AT 的内容）"' +
                        ' onchange="onTavernSetting(\'tavernAnText\',this.value)">' +
                        escapeHtml(String(aiConfig.tavernAnText || '')) + '</textarea>' +
                '</details>';

            // 用户人设描述：对应 ST 的 personaDescription。
            // 深度 / 角色只在「对话内」这一种位置下才有意义，别的时候藏起来免得误导
            const pPos = personaPosition();
            const personaPosOpts = PERSONA_POS_LIST.map(v =>
                '<option value="' + v + '"' + (pPos === v ? ' selected' : '') + '>' +
                PERSONA_POS_NAME[v] + '</option>').join('');
            const personaRoleOpts = [0, 1, 2].map(r =>
                '<option value="' + r + '"' + (personaRole() === r ? ' selected' : '') + '>' +
                WI_ROLE_LABEL[r] + '</option>').join('');
            const personaOnAn = (pPos === PERSONA_POS.topAn || pPos === PERSONA_POS.bottomAn);
            const personaPanel =
                '<details class="ai-tv-persona">' +
                    '<summary>用户人设描述（personaDescription） · ' +
                        (personaRaw()
                            ? '你的昵称「' + personaRaw() + '」 · ' + PERSONA_POS_NAME[pPos]
                            : '还没填「你的昵称」') +
                    '</summary>' +
                    '<div class="ai-hint">' +
                        '对应 SillyTavern 的 <b>Persona Description</b>。' +
                        '酒馆模式下<b>正文取「🎭 用户人设」里的「你的昵称」</b> —— 那里现在只剩这一个输入项，' +
                        '所以下面只读，要改去上面改。五种去处 —— ' +
                        '<b>提示词内</b>走预设里 <b>Persona Description</b> 那个槽，按预设顺序排；' +
                        '<b>作者注释上方 / 下方</b>拼进注释正文，跟着注释的位置 / 深度 / 角色一起走；' +
                        '<b>对话内</b>按下面的深度和角色单独注入一条。' +
                        (personaOnAn
                            ? (anShouldInsert()
                                ? ' 本轮<b>会</b>插入注释，人设跟着一起插。'
                                : ' 本轮<b>不</b>插入注释，人设也跟着不插 —— 这是 SillyTavern 的原样行为。')
                            : '') +
                    '</div>' +
                    '<div class="ai-tv-grid">' +
                        '<label>位置 <select onchange="onTavernSetting(\'tavernPersonaPosition\',this.value)">' +
                            personaPosOpts + '</select></label>' +
                        (pPos === PERSONA_POS.atDepth
                            ? '<label>角色 <select onchange="onTavernSetting(\'tavernPersonaRole\',this.value)">' +
                                personaRoleOpts + '</select></label>' +
                              numInput('深度', 'tavernPersonaDepth', 0, WI_MAX_INJECTION_DEPTH,
                                '对应 SillyTavern 的 Persona Description Depth，默认 2')
                            : '') +
                    '</div>' +
                    // 只读：正文来自「你的昵称」，这里只是让你看清到底会发什么
                    '<textarea class="ai-tv-an-text ai-tv-persona-text" rows="2" readonly' +
                        ' title="酒馆模式下这一项取「🎭 用户人设」里的你的昵称"' +
                        ' placeholder="还没填「你的昵称」">' +
                        escapeHtml(personaRaw()) + '</textarea>' +
                '</details>';

            box.innerHTML =
                '<div class="ai-tv-lore-head">📖 ' + escapeHtml(book.name) + ' · ' +
                    book.entries.length + ' 条 · 启用 ' + on + ' 条' +
                    (wi ? ' · 本轮插入 ' + wi.activated.length + ' 条' : '') + '</div>' +
                '<div class="ai-tv-legend">' +
                    '<span><i></i>常驻（始终插入）</span>' +
                    '<span><i class="key"></i>关键词触发</span>' +
                    '<span><i class="live"></i>本轮会插入</span>' +
                '</div>' +
                (declared
                    ? '<div class="ai-tv-declared">书里声明了 <b>' + escapeHtml(declared) + '</b>。' +
                      'SillyTavern 导入世界书时不会采纳书里的这些设置（它们是全局设置），本应用也一样 —— ' +
                      '要启用请改下面的全局设置。</div>'
                    : '') +
                '<div class="ai-tv-grid">' +
                    numInput('扫描深度', 'tavernScanDepth', 0, WI_MAX_SCAN_DEPTH, '对应 SillyTavern 的 Scan Depth') +
                    chkInput('递归扫描', 'tavernRecursive', '对应 SillyTavern 的 Recursive Scan') +
                '</div>' +
                '<details class="ai-tv-global">' +
                    '<summary>世界书全局设置（对齐 SillyTavern）</summary>' +
                    '<div class="ai-tv-grid">' +
                        chkInput('消息带角色名', 'tavernIncludeNames', '对应 Include Names：扫描时消息前面加「角色名: 」') +
                        chkInput('区分大小写', 'tavernCaseSensitive', '对应 Case Sensitive') +
                        chkInput('全词匹配', 'tavernMatchWholeWords', '对应 Match Whole Words') +
                        chkInput('组内评分', 'tavernGroupScoring', '对应 Use Group Scoring') +
                        numInput('最小激活数', 'tavernMinActivations', 0, 9999, '对应 Min Activations，0 = 关闭') +
                        numInput('最小激活最大深度', 'tavernMinActivationsDepthMax', 0, 9999, '对应 Min Activations Depth Max') +
                        numInput('最大递归步数', 'tavernMaxRecursionSteps', 0, 9999, '对应 Max Recursion Steps，0 = 不限') +
                    '</div>' +
                    '<div class="ai-hint">' +
                        '这里<b>没有 Token 预算</b>：SillyTavern 的预算是「上下文长度的百分之多少」，' +
                        '本应用没有上下文长度这个概念，所以干脆不截断 —— 命中的条目全部插入。' +
                    '</div>' +
                '</details>' +
                anPanel +
                personaPanel +
                '<div class="ai-tv-lore-list">' +
                    book.entries.map((e, i) => loreEntryHtml(e, i, wi ? {
                        activated: liveIds.has(e.id),
                        reason: wi.reasons.get(e.id) || ''
                    } : null)).join('') +
                '</div>';

            if (wasOpen.size) {
                const rows = box.querySelectorAll('.ai-tv-entry');
                wasOpen.forEach(i => { if (rows[i]) rows[i].open = true; });
            }
            // 折叠面板也各保各的展开状态，不然改一下注释正文它就自己收起来了
            if (wasOpenPanels.size) {
                box.querySelectorAll('.ai-tv-an, .ai-tv-global, .ai-tv-persona').forEach(d => {
                    if (wasOpenPanels.has(panelKey(d))) d.open = true;
                });
            }
        }

