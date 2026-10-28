        // ===== ST JSON → 草稿 =====

        // 把导入的卡读成草稿。会抛错（不是卡的话），交给调用方提示
        // 编辑器本身很宽松（允许只有名字、正文全空），但不能什么 JSON 都收 ——
        // 随便拖进来一个配置文件就把草稿清空成空卡，用户只会以为「导入没反应」。
        // 所以要求至少命中一个角色卡字段名，一个都没有就报错
        const ST_CARD_KEYS = ['spec', 'spec_version', 'data', 'name', 'char_name', 'description',
            'char_persona', 'personality', 'scenario', 'world_scenario', 'first_mes',
            'char_greeting', 'mes_example', 'example_dialogue', 'creator_notes', 'system_prompt',
            'post_history_instructions', 'alternate_greetings', 'character_book', 'tags',
            'creator', 'character_version', 'nickname', 'group_only_greetings', 'source',
            'creation_date', 'modification_date', 'extensions', 'avatar', 'talkativeness'];

        function stLooksLikeCard(raw) {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
            const has = o => o && typeof o === 'object' &&
                ST_CARD_KEYS.some(k => Object.prototype.hasOwnProperty.call(o, k));
            // V2/V3 的字段在 data 里，V1 在顶层，两处都认
            return has(raw) || has(raw.data);
        }

        function stDraftFromStJson(raw, srcName) {
            if (!stLooksLikeCard(raw)) {
                throw new Error('这个 JSON 里没有任何角色卡字段（name / description / first_mes …），' +
                    '不像是角色卡 —— 草稿没有被改动');
            }
            // lenient：编辑器允许名字之外全空，不像酒馆模式那样要求「看起来像张卡」
            const parsed = parseCharacterCard(raw, true);
            const c = stBlankCard();
            const k = parsed.card;
            c.spec = ST_SPEC_LIST.indexOf(k.spec) >= 0 ? k.spec : 'v2';
            c.name = k.name === '未命名角色' ? '' : k.name;
            c.description = k.description;
            c.personality = k.personality;
            c.scenario = k.scenario;
            c.firstMes = k.firstMes;
            c.mesExample = k.mesExample;
            c.creatorNotes = k.creatorNotes;
            c.systemPrompt = k.systemPrompt;
            c.postHistoryInstructions = k.postHistoryInstructions;
            c.alternateGreetings = k.alternateGreetings.slice();
            c.tags = k.tags.slice();
            c.creator = k.creator;
            c.characterVersion = k.characterVersion;
            c.nickname = k.nickname;

            const data = (raw.spec && raw.data && typeof raw.data === 'object') ? raw.data : raw;
            c.source = stStrList(data.source);
            c.groupOnlyGreetings = stStrList(data.group_only_greetings);
            c.creationDate = Math.max(0, Math.trunc(Number(data.creation_date) || 0));
            c.modificationDate = Math.max(0, Math.trunc(Number(data.modification_date) || 0));

            const ext = (data.extensions && typeof data.extensions === 'object') ? data.extensions : {};
            const dp = ext.depth_prompt;
            if (dp && typeof dp === 'object' && !Array.isArray(dp)) {
                c.depthPrompt = stStr(dp.prompt);
                const d = Math.trunc(Number(dp.depth));
                c.depthPromptDepth = Number.isFinite(d) ? Math.max(0, Math.min(WI_MAX_INJECTION_DEPTH, d)) : 4;
                c.depthPromptRole = [0, 1, 2].indexOf(Number(dp.role)) >= 0 ? Number(dp.role) : 0;
            }
            if (Array.isArray(ext.regex_scripts)) {
                c.regex = ext.regex_scripts.map(stRegexFromRaw);
            }
            c.thScripts = stThScriptsFromExtensions(ext);
            // 原始 tavern_helper 留着，导出时把 variables 之类的旁支字段并回去
            const thRaw = (ext.tavern_helper && typeof ext.tavern_helper === 'object' &&
                !Array.isArray(ext.tavern_helper)) ? ext.tavern_helper : null;
            stEditor.rawTh = thRaw ? Object.assign({}, thRaw) : null;

            if (parsed.book) {
                const book = parseWorldBook(parsed.book, (c.name || '角色') + ' 的世界书');
                c.bookName = book.name;
                c.bookDescription = book.description;
                c.bookEntries = book.entries.map(e => {
                    const x = Object.assign({}, e);
                    x.id = stUuid();
                    // 装饰器在 parseWorldBook 里已经被剥进 e.decorators 了。
                    // 编辑器要让用户看得见、改得动，所以贴回正文里，
                    // 导出时原样写出去（再导入酒馆模式会重新解析）
                    const dec = Array.isArray(x.decorators) ? x.decorators : [];
                    if (dec.length) {
                        x.content = dec.join('\n') + '\n' + x.content;
                        x.decorators = [];
                    }
                    return x;
                });
            }

            stEditor.raw = raw;
            stEditor.rawBook = parsed.book || null;
            stEditor.srcName = srcName || '';
            return c;
        }

