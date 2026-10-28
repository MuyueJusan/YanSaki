        // ===== 新建 / 导入 / 载入当前卡 =====

        function stNewCard(confirmFirst) {
            if (confirmFirst) {
                const c = stEditor.card;
                const has = c && (String(c.name || '').trim() || c.description || c.bookEntries.length ||
                    c.regex.length || c.firstMes);
                if (has && !window.confirm('新建会清空当前草稿（世界书、正则、开场白一起清），确定吗？')) return;
            }
            stEditor.card = stBlankCard();
            stEditor.raw = null;
            stEditor.rawBook = null;
            stEditor.rawTh = null;
            stEditor.srcName = '';
            stEditor.avatar = null;
            stEditor.avatarName = '';
            stEditor.lastExport = '';
            // 新建之后落在「首页」—— 刚清空的卡第一眼该是概览 +「接下来干什么」
            stEditor.tab = 'home';
            // 上一张卡没走完的「提取条目」不该跟到新卡上
            stEditor.extractSrc = null;
            stEditor.extractSel = {};
            stEditor.extractMsg = '';
            // 世界书的多选同理 —— 上一张卡勾中的那些条目 id 在新卡里一个都不存在
            stBookSelClear();
            // 搜索筛选也要清。不清的话新卡一打开就只剩「命中 0 条」，
            // 看起来像条目没导进来 —— 而且用户完全不记得自己筛过什么
            stEditor.bookFind = Object.assign({}, ST_BOOK_FIND_DEF);
            // 人设生成器的「参考素材」同理，而且连**导入的那本书**也一起丢掉：
            // 它是「为这张卡准备的额外素材」，换卡之后跟新卡没关系
            stPersonaPickClear();
            stMvuAfterLoad();     // 新卡没有 MVU / 状态栏，顺手把接管标记清干净
            stSaveDraft();
            if (stIsOpen()) renderStEditor();
            renderStCard();
        }

        function stImportPick() {
            const el = document.getElementById('st-import-file');
            if (!el) return;
            // ⚠ 每次**显式**写 mode，不靠「上次留下的」—— 见 stEditor 里那段注释：
            //   用户点「提取条目」之后在文件框点取消，change 根本不触发，mode 会留着
            el.dataset.mode = 'card';
            el.click();
        }

        // 同一个 <input>，这一次是「只把条目挑出来」。**复用而不新增节点**：
        // 往 HTML 里插一个 <input> 会让 README 那张锚点表整体后移，而这件事零收益
        function stExtractPick() {
            const el = document.getElementById('st-import-file');
            if (!el) return;
            el.dataset.mode = 'extract';
            stEditor.extractMsg = { text: '', kind: '' };
            el.click();
        }

        // 从 PNG / JSON 读一张卡进编辑器
        async function stOnImportPicked(ev) {
            const file = ev.target.files && ev.target.files[0];
            ev.target.value = '';
            // 这个 <input> 有两条用途：导入整张卡 / 只把条目挑出来。
            // ⚠ 模式读 `dataset.mode` 而**不是** stEditor 上的字段 ——
            //   用户点「提取条目」之后在文件框里点取消时 `change` 根本不触发，
            //   放在 stEditor 上就没人清它了。放 dataset 由两个入口每次显式覆盖，残留无害。
            const mode = (ev.target.dataset && ev.target.dataset.mode) || 'card';
            if (!file) return;
            stExportMsg('正在读取 ' + file.name + ' …');
            try {
                const buf = await file.arrayBuffer();
                const u8 = new Uint8Array(buf);
                let json;
                let wasPng = false;
                if (isPngBuffer(u8)) {
                    wasPng = true;
                    const chunks = readPngTextChunks(u8);
                    const rec = chunks['ccv3'] || chunks['chara'] || chunks['ccv2'];
                    if (!rec) throw new Error('这张 PNG 里没有 chara / ccv3 数据块 —— 它可能只是普通图片');
                    json = await decodePngCardChunk(rec);
                } else {
                    json = JSON.parse(new TextDecoder('utf-8').decode(u8));
                }
                // 只提取条目：走另一条路，**完全不碰当前草稿**
                if (mode === 'extract') {
                    stExtractAccept(json, file.name);
                    return;
                }
                const card = stDraftFromStJson(json, file.name);
                stEditor.card = card;
                stEditor.lastExport = '';
                // 卡里自带 MVU 的话顺手接管，这样切到「MVU」页就能直接改结构
                stMvuAfterLoad();
                // PNG 卡顺手把原图当头像 —— 改完再导出，卡面不会丢。
                // 太大就不带了（几百 KB 的 data URL 留着也存不进浏览器存储）
                let avatarNote = '';
                if (wasPng) {
                    if (file.size <= 4 * 1024 * 1024) {
                        try {
                            stEditor.avatar = await stReadDataUrl(file);
                            stEditor.avatarName = file.name;
                            avatarNote = ' · 头像沿用原图';
                        } catch (e) { avatarNote = ' · 原图读取失败，头像留空'; }
                    } else {
                        avatarNote = ' · 原图超过 4 MB，没当头像带过来';
                    }
                }
                // 存草稿是尽力而为的：存不进去也**不算导入失败**，卡已经进来了
                const saved = stSaveDraft();
                renderStEditor();
                stExportMsg('✅ 已读入「' + (card.name || '未命名') + '」：' + ST_SPEC_LABEL[card.spec] +
                    ' · 世界书 ' + card.bookEntries.length + ' 条' +
                    ' · 正则 ' + card.regex.length + ' 条' +
                    ' · 备选开场白 ' + card.alternateGreetings.length + ' 条' + avatarNote +
                    (saved ? '' : ' · ⚠ 卡太大，这次没能存进浏览器草稿，刷新会丢'), 'ok');
            } catch (e) {
                stExportMsg('❌ 导入失败：' + (e && e.message ? e.message : e), 'bad');
            }
        }

        // 用酒馆模式当前那张卡填草稿。走的是归一化后的数据，
        // 所以本应用不认识的字段带不过来 —— 要完全无损请用「📥 导入」原文件
        function stLoadFromTavern() {
            const c = aiConfig.tavernCard;
            if (!c) {
                stExportMsg('酒馆模式里还没有角色卡。先在「AI 对话 → 酒馆模式」导入一张，' +
                    '或者直接点「📥 导入」。', 'warn');
                return;
            }
            if (!window.confirm('用酒馆模式当前的「' + c.name + '」覆盖编辑器草稿？当前草稿会被清掉。')) return;
            const spec = ST_SPEC_LIST.indexOf(c.spec) >= 0 ? c.spec : 'v2';
            const raw = {
                spec: 'chara_card_' + spec,
                spec_version: spec === 'v3' ? '3.0' : '2.0',
                data: {
                    name: c.name,
                    description: c.description,
                    personality: c.personality,
                    scenario: c.scenario,
                    first_mes: c.firstMes,
                    mes_example: c.mesExample,
                    creator_notes: c.creatorNotes,
                    system_prompt: c.systemPrompt,
                    post_history_instructions: c.postHistoryInstructions,
                    alternate_greetings: c.alternateGreetings.slice(),
                    tags: c.tags.slice(),
                    creator: c.creator,
                    character_version: c.characterVersion,
                    nickname: c.nickname,
                    extensions: {}
                }
            };
            const book = getLoreBook();
            if (book) {
                raw.data.character_book = {
                    name: book.name,
                    description: book.description,
                    entries: book.entries.map(stEntryToBookJson)
                };
            }
            try {
                stEditor.card = stDraftFromStJson(raw, '酒馆模式当前卡');
                stEditor.lastExport = '';
                stMvuAfterLoad();
                stSaveDraft();
                renderStEditor();
                stExportMsg('✅ 已载入「' + c.name + '」（从酒馆模式的归一化数据重建，' +
                    '卡里本应用不认识的字段没法带过来）。', 'ok');
            } catch (e) {
                stExportMsg('❌ 载入失败：' + (e && e.message ? e.message : e), 'bad');
            }
        }

