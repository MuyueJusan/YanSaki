        // —— 模块 ③：快捷动作。跟顶栏那几个按钮是同一批动作，只是收在一处 ——
        function stHomeBodyActions() {
            return '<div class="st-actions">' +
                '<button class="st-big" type="button" onclick="stNewCard(true)">✚ 新建角色卡</button>' +
                '<button class="st-big" type="button" onclick="stImportPick()">' +
                    '📥 导入角色卡（PNG / JSON）</button>' +
                '<button class="st-big st-plain" type="button" onclick="stLoadFromTavern()">' +
                    '📇 读取酒馆当前卡</button>' +
            '</div>';
        }

        // —— 模块 ④：从别处搬条目。两种形态：
        //   还没选文件 → 一个按钮 + 说明；选好了 → 来源信息 + 勾选清单 + 导入
        // ⚠ 这里**不再自带小标题**（`.st-sub`）—— 标题归模块头，别再重复一遍
        function stHomeBodyExtract() {
            const src = stEditor.extractSrc;
            const msg = stEditor.extractMsg || { text: '', kind: '' };
            const msgHtml = msg.text
                ? '<div class="st-ai-status' + (msg.kind === 'bad' ? ' st-bad'
                    : (msg.kind === 'warn' ? ' st-warn' : ' st-ok')) + '">' +
                  escapeHtml(msg.text) + '</div>'
                : '';

            if (!src) {
                return '<div class="st-note">' +
                        '选一张<b>别的角色卡</b>（PNG / JSON）或一份<b>世界书 JSON</b>，' +
                        '把里面的条目挑出来、并进当前这张卡的世界书。' +
                        '来源文件<b>不会被改动</b>，当前卡的正文一个字段都不动。' +
                    '</div>' +
                    '<div class="st-actions">' +
                        '<button class="st-big" type="button" onclick="stExtractPick()">' +
                            '📚 选择来源文件…</button>' +
                    '</div>' + msgHtml;
            }

            const entries = src.entries || [];
            const selN = entries.filter((e, i) => stEditor.extractSel[i]).length;
            const rows = entries.map((e, i) => {
                const on = !!stEditor.extractSel[i];
                const keys = (e.keys || []).join('、');
                const chip = e.constant ? '<span class="st-chip st-const">常驻</span>' : '';
                // title 里放正文前 200 字，鼠标悬停能先看一眼写了什么
                return '<label class="st-check" title="' +
                        escapeHtml(String(e.content || '').slice(0, 200)) + '">' +
                    '<input type="checkbox" id="st-ex-' + i + '"' + (on ? ' checked' : '') +
                        ' onchange="stExtractToggle(' + i + ',this.checked)">' +
                    '<span>' + chip +
                        (e.comment ? escapeHtml(e.comment) : '<i>（没写备注）</i>') +
                        (keys ? ' · ' + escapeHtml(keys.slice(0, 40)) : '') +
                    '</span></label>';
            }).join('');

            return '<div class="st-note">来源：<b>' + escapeHtml(src.srcName) + '</b>（' +
                    escapeHtml(src.kind) + '）· 世界书名 ' + escapeHtml(src.bookName || '未命名') +
                    ' · 共 ' + entries.length + ' 条</div>' +
                '<div class="st-actions">' +
                    '<button class="st-mini" type="button" onclick="stExtractSetAll(true)">全选</button>' +
                    '<button class="st-mini" type="button" onclick="stExtractSetAll(false)">全不选</button>' +
                '</div>' +
                (entries.length
                    ? rows
                    : '<div class="st-empty">这份来源里没有能导入的条目。</div>') +
                '<div class="st-actions">' +
                    '<button class="st-big" type="button"' + (selN ? '' : ' disabled') +
                        ' onclick="stExtractImport()">📥 导入选中的 ' + selN + ' 条</button>' +
                    '<button class="st-big st-plain" type="button" onclick="stExtractClear()">取消</button>' +
                '</div>' + msgHtml;
        }

        // 把一份「角色卡」或「世界书」JSON 解析成待导入的条目。
        // 只认世界书那部分 —— 卡的正文 / 正则 / 开场白一律不碰。
        function stExtractAccept(json, fileName) {
            try {
                // V2 / V3 卡把 character_book 装在 data 里；世界书文件则是顶层 entries。
                // ⚠ 先按 spec+data 解一层，`parseWorldBook` 自己会去找 character_book / entries
                const cand = (json && json.spec && json.data && typeof json.data === 'object')
                    ? json.data : json;
                const book = parseWorldBook(cand, fileName);
                // 跟 stDraftFromStJson 里那段**保持同一套处理**：
                // 装饰器贴回正文（编辑器要让用户看得见、改得动），并给每个条目发一个新 id
                const entries = book.entries.map(e => {
                    const x = Object.assign({}, e);
                    x.id = stUuid();
                    const dec = Array.isArray(x.decorators) ? x.decorators : [];
                    if (dec.length) {
                        x.content = dec.join('\n') + '\n' + x.content;
                        x.decorators = [];
                    }
                    return x;
                });
                const isCard = !!(json && json.spec);
                stEditor.extractSrc = {
                    srcName: fileName || '（未命名来源）',
                    kind: isCard ? '角色卡' : '世界书',
                    bookName: book.name || '',
                    entries: entries
                };
                // 默认**全选**：用户多半就是想把这份书整个搬过来，逐条点掉比逐条点上省事
                const sel = {};
                entries.forEach((e, i) => { sel[i] = true; });
                stEditor.extractSel = sel;
                stEditor.extractMsg = entries.length
                    ? { text: '', kind: '' }
                    : { text: '这份来源里没有条目（entries 是空的）。', kind: 'warn' };
                stRerender();
            } catch (e) {
                stEditor.extractSrc = null;
                stEditor.extractSel = {};
                stEditor.extractMsg = {
                    text: '读不出来：' + (e && e.message ? e.message : e),
                    kind: 'bad'
                };
                stRerender();
            }
        }

        function stExtractToggle(i, on) {
            if (!stEditor.extractSrc) return;
            if (on) stEditor.extractSel[i] = true;
            else delete stEditor.extractSel[i];
            stRerender();
        }

        function stExtractSetAll(on) {
            if (!stEditor.extractSrc) return;
            const sel = {};
            if (on) stEditor.extractSrc.entries.forEach((e, i) => { sel[i] = true; });
            stEditor.extractSel = sel;
            stRerender();
        }

        // 把勾上的条目**追加**到当前卡的世界书。
        // ⚠ 追加而不是替换 —— 用户点的是「导入条目」，不是「用这份书换掉我的书」
        function stExtractImport() {
            const src = stEditor.extractSrc;
            if (!src) return;
            const picked = src.entries.filter((e, i) => stEditor.extractSel[i]);
            if (!picked.length) {
                stEditor.extractMsg = { text: '一条都没勾，没东西可导入。', kind: 'warn' };
                stRerender();
                return;
            }
            // 逐条 clone 再进书：这几个对象还挂在 extractSrc 上，
            // 直接塞进去会让两处指向同一个对象，之后再改条目会互相影响
            const added = picked.map(e => Object.assign({}, e, { id: stUuid() }));
            stEditor.card.bookEntries.push(...added);
            // 书级字段：只在当前卡还没写名字时补上，**不覆盖**用户自己起的名字
            const tookBookName = !String(stEditor.card.bookName || '').trim() && !!src.bookName;
            if (tookBookName) stEditor.card.bookName = src.bookName;
            stSaveDraft();
            stEditor.extractSrc = null;
            stEditor.extractSel = {};
            stEditor.extractMsg = {
                text: '✅ 已从「' + src.srcName + '」导入 ' + added.length + ' 条到世界书' +
                    (tookBookName ? '，世界书名也一并补上了' : ''),
                kind: ''
            };
            stRerender();
        }

        function stExtractClear() {
            stEditor.extractSrc = null;
            stEditor.extractSel = {};
            stEditor.extractMsg = { text: '', kind: '' };
            stRerender();
        }

        function stPaneName() {
            const c = stEditor.card;
            return stPaneHead('📛 名字',
                '角色的显示名。V3 还多一个 <code>nickname</code>：填了的话，' +
                '<code>{{char}}</code> 会优先用它而不是 <code>name</code>。') +
                '<div class="st-grid">' +
                    stInput('角色名 name', 'card.name', { id: 'name', ph: '比如：猫猫 Saki' }) +
                    stInput('昵称 nickname（V3）', 'card.nickname', {
                        id: 'nickname', ph: '留空就用角色名',
                        hint: c.spec === 'v3' ? '' : '只有 V3 会写出去'
                    }) +
                '</div>' +
                '<div class="st-note">' +
                    '名字会同时决定三件事：卡里写什么、导出文件名默认叫什么、' +
                    '以及酒馆模式下 <code>{{char}}</code> 展开成什么。' +
                '</div>';
        }

        function stPaneSpec() {
            const c = stEditor.card;
            const rows = ST_SPEC_LIST.map(v =>
                '<label class="st-check">' +
                    '<input type="radio" name="st-spec" id="st-spec-' + v + '" value="' + v + '"' +
                        (c.spec === v ? ' checked' : '') +
                        ' onchange="stSet(\'card.spec\',this.value)">' +
                    '<span>' + escapeHtml(ST_SPEC_LABEL[v]) + '</span>' +
                '</label>').join('');
            const drops = [];
            if (c.spec === 'v1') {
                if (c.bookEntries.length) drops.push('世界书 ' + c.bookEntries.length + ' 条');
                if (c.regex.length) drops.push('正则 ' + c.regex.length + ' 条');
                if (c.thScripts.length) drops.push('酒馆助手脚本 ' + stThCountScripts(c.thScripts) + ' 个');
                if (c.alternateGreetings.length) drops.push('备选开场白 ' + c.alternateGreetings.length + ' 条');
                if (c.systemPrompt || c.postHistoryInstructions) drops.push('系统提示词 / 历史后指令');
                if (c.creator || c.characterVersion || c.tags.length) drops.push('作者 / 版本 / 标签');
            }
            return stPaneHead('🏷 类型',
                '卡的规格版本。它决定导出 JSON / PNG 的顶层结构 —— ' +
                '<code>spec</code> 字段和 <code>data</code> 里能装哪些字段都由它说了算。') +
                '<div class="st-checks" style="flex-direction:column;gap:6px">' + rows + '</div>' +
                '<div class="st-note">' + ST_SPEC_DESC[c.spec] + '</div>' +
                (drops.length
                    ? '<div class="st-note st-warn"><b>当前选了 V1，导出会丢掉这些内容：</b>' +
                      escapeHtml(drops.join('、')) + '。要留住它们就换成 V2 或 V3。</div>'
                    : '') +
                '<div class="st-sub">导出顶层结构预览</div>' +
                '<pre class="st-json">' + escapeHtml(stSpecShapePreview()) + '</pre>';
        }

        function stSpecShapePreview() {
            const c = stEditor.card;
            if (c.spec === 'v1') {
                return JSON.stringify({
                    name: c.name || '未命名角色',
                    description: '…',
                    personality: '…',
                    scenario: '…',
                    first_mes: '…',
                    mes_example: '…',
                    creatorcomment: '…',
                    tags: c.tags
                }, null, 2);
            }
            const data = {
                name: c.name || '未命名角色',
                description: '…',
                personality: '…',
                scenario: '…',
                first_mes: '…',
                mes_example: '…',
                creator_notes: '…',
                system_prompt: '…',
                post_history_instructions: '…',
                alternate_greetings: c.alternateGreetings.map(() => '…'),
                tags: c.tags,
                creator: c.creator,
                character_version: c.characterVersion,
                character_book: c.bookEntries.length ? { name: c.bookName || '…', entries: ['…'] } : undefined,
                extensions: {
                    depth_prompt: c.depthPrompt ? { prompt: '…', depth: c.depthPromptDepth, role: c.depthPromptRole } : undefined,
                    regex_scripts: c.regex.length ? ['…'] : undefined,
                    tavern_helper: c.thScripts.length
                        ? { scripts: c.thScripts.map(() => '…') } : undefined
                }
            };
            if (c.spec === 'v3') {
                data.nickname = c.nickname;
                data.group_only_greetings = c.groupOnlyGreetings.map(() => '…');
                data.source = c.source;
                data.creation_date = c.creationDate;
                data.modification_date = '导出时写入';
            }
            Object.keys(data).forEach(k => { if (data[k] === undefined) delete data[k]; });
            return JSON.stringify({
                spec: 'chara_card_' + c.spec,
                spec_version: c.spec === 'v3' ? '3.0' : '2.0',
                data: data
            }, null, 2);
        }

        function stPaneDesc() {
            return stPaneHead('📝 角色描述',
                '角色的正身。这四个字段是拼提示词时分开成四条消息发出去的 ' +
                '（对应预设里的 <code>charDescription</code> / <code>charPersonality</code> / ' +
                '<code>scenario</code> / <code>dialogueExamples</code> 四个槽）。') +
                '<div class="st-grid">' +
                    stArea('角色描述 description', 'card.description', {
                        id: 'desc', rows: 12, tall: true,
                        ph: '外貌、性格、说话方式、背景……'
                    }) +
                    stArea('性格 personality', 'card.personality', {
                        id: 'personality', rows: 5,
                        ph: '一句话概括也行'
                    }) +
                    stArea('场景 scenario', 'card.scenario', {
                        id: 'scenario', rows: 5,
                        ph: '故事发生在哪里、当前是什么局面'
                    }) +
                    stArea('示例对话 mes_example', 'card.mesExample', {
                        id: 'mes', rows: 8,
                        ph: '<START>\n{{user}}: 你好\n{{char}}: 嗯。'
                    }) +
                '</div>';
        }

