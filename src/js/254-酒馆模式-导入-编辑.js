        // ===== 酒馆模式：导入 / 编辑 =====

        async function onCardFilePicked(ev) {
            const file = ev.target.files && ev.target.files[0];
            ev.target.value = '';   // 允许重复选同一个文件
            if (!file) return;
            setTavernStatus('正在读取 ' + file.name + ' …');
            try {
                const buf = await file.arrayBuffer();
                let json;
                if (isPngBuffer(buf)) {
                    const chunks = readPngTextChunks(buf);
                    const rec = chunks['ccv3'] || chunks['chara'] || chunks['ccv2'];
                    if (!rec) {
                        throw new Error('这张 PNG 里没有 chara / ccv3 数据块 —— 它可能只是普通图片，不是角色卡');
                    }
                    json = await decodePngCardChunk(rec);
                } else {
                    json = JSON.parse(new TextDecoder('utf-8').decode(new Uint8Array(buf)));
                }
                const parsed = parseCharacterCard(json);
                // 记下文件名（去扩展名）。ST 的角色过滤器 names 存的就是「头像文件名去扩展名」，
                // 记下来才能正确判断世界书里按角色过滤的条目
                parsed.card.fileName = file.name.replace(/\.[^.]+$/, '');
                aiConfig.tavernCard = parsed.card;
                aiConfig.tavernGreetingIndex = 0;
                wiResetTimed();      // 换卡了，黏性 / 冷却的旧状态作废
                const wasPromptOn = aiConfig.promptEnabled !== false;
                enterTavernMode();   // 互斥：进酒馆模式就关掉原系统提示词

                let loreMsg = '';
                if (parsed.book) {
                    try {
                        const book = parseWorldBook(parsed.book, parsed.card.name + ' 的世界书');
                        aiConfig.tavernLore = book;
                        const declared = adoptBookSettings(book);
                        loreMsg = '，并读入内置世界书 ' + book.entries.length + ' 条' +
                            (declared ? '（书里声明：' + declared + '，SillyTavern 不自动采纳）' : '');
                    } catch (e) {
                        loreMsg = '（卡内世界书读取失败：' + e.message + '）';
                    }
                } else {
                    aiConfig.tavernLore = null;
                }
                persistTavern();
                renderTavernUI();
                renderPromptUI();
                // 导入角色卡就顺手把开场白换成这张卡的（还没真正聊过的话）
                refreshGreetingIfFresh();
                setTavernStatus('✅ 已载入角色卡「' + parsed.card.name + '」' + loreMsg +
                    (wasPromptOn ? ' · 已停用原系统提示词' : ''), 'ok');
            } catch (e) {
                setTavernStatus('❌ 角色卡读取失败：' + e.message, 'err');
            }
        }

        async function onLoreFilePicked(ev) {
            const file = ev.target.files && ev.target.files[0];
            ev.target.value = '';
            if (!file) return;
            setTavernStatus('正在读取 ' + file.name + ' …');
            try {
                const text = new TextDecoder('utf-8').decode(new Uint8Array(await file.arrayBuffer()));
                const book = parseWorldBook(JSON.parse(text), file.name.replace(/\.json$/i, ''));
                const wasPromptOn = aiConfig.promptEnabled !== false;
                enterTavernMode();   // 互斥：进酒馆模式就关掉原系统提示词
                const note = wasPromptOn ? ' · 已停用原系统提示词' : '';
                const old = getLoreBook();
                wiResetTimed();      // 换书了，黏性 / 冷却的旧状态作废
                if (old && old.entries.length) {
                    // 追加，不覆盖已有条目（索引重排，避免 id 撞车）
                    const base = old.entries.length;
                    book.entries.forEach((e, i) => { e.id = 'x' + base + '_' + i; });
                    book.name = old.name + ' + ' + book.name;
                    book.entries = old.entries.concat(book.entries);
                    setTavernStatus('✅ 已追加世界书 ' + file.name + '（共 ' + book.entries.length + ' 条）' + note, 'ok');
                } else {
                    const declared = adoptBookSettings(book);
                    setTavernStatus('✅ 已载入世界书「' + book.name + '」' + book.entries.length + ' 条' + note +
                        (declared ? '（书里声明：' + declared + '，SillyTavern 不自动采纳）' : ''), 'ok');
                }
                aiConfig.tavernLore = book;
                persistTavern();
                renderTavernUI();
                renderPromptUI();
                refreshGreetingIfFresh();
            } catch (e) {
                setTavernStatus('❌ 世界书读取失败：' + e.message, 'err');
            }
        }

        // 酒馆模式与原系统提示词互斥，进酒馆就关掉系统提示词。
        // 导入角色卡 / 世界书 也会自动进酒馆模式，所以这几处必须走同一个入口
        function enterTavernMode() {
            aiConfig.tavernEnabled = true;
            aiConfig.promptEnabled = false;
            // 酒馆模式下「用户人设」只留昵称，其余的宏玩法在这里清掉（用户要求
            // 「酒馆模式启用时清除之前的输入」）。控件由 syncUserMacroUI 锁住
            tavernLockUserMacro();
        }

        function onTavernToggle() {
            const chk = document.getElementById('ai-tavern-enabled');
            const on = !!(chk && chk.checked);
            if (on) {
                enterTavernMode();
            } else {
                aiConfig.tavernEnabled = false;
                // 退出酒馆模式 → 回到普通模式，把系统提示词还回来。
                // 不然会落到「两个都不管」的状态，等于把 AI 的人设整个丢掉
                aiConfig.promptEnabled = true;
            }
            persistTavern();
            renderTavernUI();
            renderPromptUI();
            // 进 / 出酒馆模式都要重刷「用户人设」面板：进去时锁住 + 回填清空后的值，
            // 出来时解锁。放在 persistTavern 之后，免得又被 DOM 里的旧值写回去
            syncUserMacroUI();
            // 还没聊过就直接换成对应人设的开场白，免得开场白和人设对不上
            refreshGreetingIfFresh();
            const has = aiConfig.tavernCard || getLoreBook();
            setTavernStatus(on
                ? (has
                    ? '酒馆模式已开启 · ' + (aiConfig.tavernCard ? '角色「' + aiConfig.tavernCard.name + '」' : '仅世界书') + ' · 已停用原系统提示词'
                    : '酒馆模式已开启，但还没导入角色卡或世界书')
                : '酒馆模式已关闭 · 已恢复原系统提示词',
                on && !has ? 'err' : '');
        }

        // 换人设之后刷新开场白 —— 但只在「还没真正聊过」时才动，
        // 免得把用户看得见的历史或失败气泡清掉
        function refreshGreetingIfFresh() {
            if (chatHistory.length) return;
            const box = document.getElementById('ai-messages');
            if (!box) return;
            if (box.querySelector('.ai-msg.from-user, .ai-bubble.failed')) return;
            box.innerHTML = '';
            appendAiGreeting();
        }

        function onTavernGreetingChange(v) {
            aiConfig.tavernGreetingIndex = Math.max(0, parseInt(v, 10) || 0);
            persistTavern();
            renderTavernPreview();
        }

        // 世界书全局设置里哪些是布尔开关
        const TAVERN_BOOL_KEYS = ['tavernRecursive', 'tavernIncludeNames', 'tavernCaseSensitive',
            'tavernMatchWholeWords', 'tavernGroupScoring'];
        // 作者注释正文是字符串，不能走 parseInt，否则会被吃成 0
        // （人设正文已经改成取「你的昵称」，不再是这里的文本项了）
        const TAVERN_TEXT_KEYS = ['tavernAnText'];

        function onTavernSetting(key, value) {
            if (TAVERN_TEXT_KEYS.indexOf(key) >= 0) {
                aiConfig[key] = String(value == null ? '' : value);
            } else if (TAVERN_BOOL_KEYS.indexOf(key) >= 0) {
                aiConfig[key] = !!value;
            } else {
                const n = parseInt(value, 10);
                aiConfig[key] = Number.isFinite(n) ? Math.max(0, n) : 0;
            }
            persistTavern();
            // 设置会改变「哪些条目会插入」，所以条目列表和预览都要重画。
            // 输入框用的是 onchange（失焦/回车才触发），重画不会打断输入
            renderTavernLore();
            renderTavernPreview();
        }

        function onLoreEntryToggle(i, checked) {
            const book = getLoreBook();
            if (!book || !book.entries[i]) return;
            book.entries[i].enabled = !!checked;
            persistTavern();
            renderTavernLore();
            renderTavernPreview();
        }

        function onLoreEntryField(i, field, value) {
            const book = getLoreBook();
            if (!book || !book.entries[i]) return;
            const e = book.entries[i];
            if (field === 'position') {
                e.position = Math.max(0, Math.min(7, parseInt(value, 10) || 0));
            } else if (field === 'depth') {
                e.depth = Math.max(0, Math.min(WI_MAX_INJECTION_DEPTH, parseInt(value, 10) || 0));
            } else if (field === 'role') {
                e.role = Math.max(0, Math.min(2, parseInt(value, 10) || 0));
            } else if (field === 'order') {
                e.order = Math.max(0, Math.min(9999, parseInt(value, 10) || 0));
            }
            persistTavern();
            renderTavernLore();       // 位置变了要重画（深度/角色行会显隐）
            renderTavernPreview();
        }

        function clearTavernData() {
            if ((aiConfig.tavernCard || getLoreBook()) &&
                !window.confirm('清除已载入的角色卡与世界书？')) return;
            aiConfig.tavernCard = null;
            aiConfig.tavernLore = null;
            aiConfig.tavernGreetingIndex = 0;
            aiConfig.tavernEnabled = false;
            wiResetTimed();
            persistTavern();
            renderTavernUI();
            setTavernStatus('已清除角色卡与世界书');
        }

        function expandAiAdvanced() {
            document.getElementById('ai-card').classList.remove('ai-adv-collapsed');
        }

        function toggleAiAdvanced() {
            document.getElementById('ai-card').classList.toggle('ai-adv-collapsed');
        }

        function toggleAiSettings() {
            document.getElementById('ai-card').classList.toggle('ai-settings-collapsed');
        }

        function toggleAiArea() {
            const card = document.getElementById('ai-card');
            card.classList.toggle('ai-collapsed');
            if (!card.classList.contains('ai-collapsed')) {
                // 展开整个 AI 对话时，同步展开模型设置与高级设置
                card.classList.remove('ai-settings-collapsed');
                expandAiAdvanced();
            }
        }

