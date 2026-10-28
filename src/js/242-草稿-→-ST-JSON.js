        // ===== 草稿 → ST JSON =====

        // 世界书条目的正文。扫描器（parseWorldBook → finalizeLoreEntry）会把正文开头的
        // @@ 装饰器剥进 e.decorators，导出时要贴回去，否则一进一出就把装饰器弄丢了
        function stEntryContentRaw(e) {
            const dec = Array.isArray(e.decorators) ? e.decorators : [];
            return dec.length ? (dec.join('\n') + '\n' + e.content) : e.content;
        }

        // 世界书条目 → 卡内 character_book 的条目（V2 / V3 规范里 entries 是数组）
        // 规范只认 position: 'before_char' | 'after_char'，完整的八种位置靠
        // extensions.position 带过去 —— ST 自己也是这么写的
        function stEntryToBookJson(e) {
            const camel = {
                position: e.position,
                depth: e.depth,
                role: e.role,
                probability: e.probability,
                useProbability: e.useProbability,
                selectiveLogic: e.selectiveLogic,
                disable: !e.enabled,
                caseSensitive: e.caseSensitive,
                matchWholeWords: e.matchWholeWords,
                useGroupScoring: e.useGroupScoring,
                excludeRecursion: e.excludeRecursion,
                preventRecursion: e.preventRecursion,
                delayUntilRecursion: e.delayUntilRecursion,
                scanDepth: e.scanDepth,
                group: e.group,
                groupWeight: e.groupWeight,
                groupOverride: e.groupOverride,
                triggers: e.triggers.slice(),
                sticky: e.sticky == null ? 0 : e.sticky,
                cooldown: e.cooldown == null ? 0 : e.cooldown,
                delay: e.delay == null ? 0 : e.delay,
                outletName: e.outletName,
                matchPersonaDescription: e.matchPersonaDescription,
                matchCharacterDescription: e.matchCharacterDescription,
                matchCharacterPersonality: e.matchCharacterPersonality,
                matchCharacterDepthPrompt: e.matchCharacterDepthPrompt,
                matchScenario: e.matchScenario,
                matchCreatorNotes: e.matchCreatorNotes,
                useRegex: !!e.useRegex
            };
            const ext = {};
            Object.keys(camel).forEach(k => {
                ext[k] = camel[k];
                const snake = k.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
                if (snake !== k) ext[snake] = camel[k];
            });
            ext.characterFilter = {
                isExclude: !!e.characterFilter.isExclude,
                names: e.characterFilter.names.slice(),
                tags: e.characterFilter.tags.slice()
            };
            ext.character_filter = ext.characterFilter;
            ext.vectorized = false;
            ext.addMemo = true;
            return {
                keys: e.keys.slice(),
                content: stEntryContentRaw(e),
                extensions: ext,
                enabled: !!e.enabled,
                insertion_order: e.order,
                case_sensitive: e.caseSensitive,
                name: e.comment,
                priority: e.order,
                id: e.id,
                comment: e.comment,
                selective: !!e.selective,
                secondary_keys: e.secondaryKeys.slice(),
                constant: !!e.constant,
                position: e.position === WI_POS.beforeChar ? 'before_char' : 'after_char',
                use_regex: !!e.useRegex
            };
        }

        function stBookToJson() {
            const c = stEditor.card;
            const book = {
                name: c.bookName || ((c.name ? c.name + ' 的世界书' : '世界书')),
                description: c.bookDescription || '',
                extensions: {},
                entries: c.bookEntries.map(stEntryToBookJson)
            };
            // 导入时书里声明的全局字段原样留着（本编辑器不管它们）
            const rb = stEditor.rawBook;
            if (rb && typeof rb === 'object' && !Array.isArray(rb)) {
                ['scan_depth', 'token_budget', 'recursive_scanning'].forEach(k => {
                    if (rb[k] !== undefined) book[k] = rb[k];
                });
                if (rb.extensions && typeof rb.extensions === 'object') {
                    book.extensions = Object.assign({}, rb.extensions);
                }
            }
            return book;
        }

        function stRegexToRaw(r) {
            const depth = v => (v === null || v === undefined || v === '') ? null : Math.trunc(Number(v));
            return {
                id: r.id,
                scriptName: r.scriptName,
                findRegex: r.findRegex,
                replaceString: r.replaceString,
                trimStrings: r.trimStrings.slice(),
                placement: r.placement.slice(),
                disabled: !!r.disabled,
                markdownOnly: !!r.markdownOnly,
                promptOnly: !!r.promptOnly,
                runOnEdit: !!r.runOnEdit,
                substituteRegex: Number(r.substituteRegex) || 0,
                minDepth: depth(r.minDepth),
                maxDepth: depth(r.maxDepth)
            };
        }

        function stRegexFromRaw(x) {
            const r = stBlankRegex();
            if (!x || typeof x !== 'object' || Array.isArray(x)) return r;
            r.id = stStr(x.id) || r.id;
            r.scriptName = stStr(x.scriptName) || stStr(x.script_name);
            r.findRegex = stStr(x.findRegex) || stStr(x.find_regex);
            r.replaceString = stStr(x.replaceString) || stStr(x.replace_string);
            const trim = Array.isArray(x.trimStrings) ? x.trimStrings
                : (Array.isArray(x.trim_strings) ? x.trim_strings : []);
            r.trimStrings = trim.map(stStr);
            const pl = Array.isArray(x.placement) ? x.placement : [];
            r.placement = pl.map(Number).filter(n => ST_REGEX_PLACEMENT_ORDER.indexOf(n) >= 0);
            r.disabled = x.disabled === true;
            r.markdownOnly = x.markdownOnly === true || x.markdown_only === true;
            r.promptOnly = x.promptOnly === true || x.prompt_only === true;
            r.runOnEdit = (x.runOnEdit !== false) && (x.run_on_edit !== false);
            r.substituteRegex = Number(x.substituteRegex || x.substitute_regex) || 0;
            const d = v => (v === null || v === undefined || v === '') ? null : Math.trunc(Number(v));
            r.minDepth = d(x.minDepth !== undefined ? x.minDepth : x.min_depth);
            r.maxDepth = d(x.maxDepth !== undefined ? x.maxDepth : x.max_depth);
            return r;
        }

        // 导入卡里那些本编辑器不管、但导出时要原样带回去的 extensions 字段。
        // depth_prompt / regex_scripts / world / tavern_helper 是本编辑器自己管的，
        // 先剔掉免得被旧值盖住（tavern_helper 的 variables 之类的旁支字段由
        // stThExtras() 从 stEditor.rawTh 单独合并回去）
        function stExtraExtensions() {
            const raw = stEditor.raw;
            const out = {};
            if (!raw || typeof raw !== 'object') return out;
            const data = (raw.spec && raw.data && typeof raw.data === 'object') ? raw.data : raw;
            const ext = (data && data.extensions && typeof data.extensions === 'object') ? data.extensions : {};
            Object.keys(ext).forEach(k => { out[k] = ext[k]; });
            delete out.depth_prompt;
            delete out.regex_scripts;
            delete out.world;
            delete out.character_book;
            delete out.tavern_helper;
            // 老键已经迁到 tavern_helper 里了，别再写回去
            delete out.TavernHelper_scripts;
            delete out.TavernHelper_characterScriptVariables;
            return out;
        }

        // 卡里 extensions.tavern_helper 的原始对象。本编辑器只接管 scripts，
        // variables 和别的旁支字段原样留着，导出时合并回去
        function stThExtras() {
            const th = stEditor.rawTh;
            return (th && typeof th === 'object' && !Array.isArray(th)) ? th : {};
        }

        // 草稿 → 一张完整的 ST 卡 JSON
        function stCardToStJson() {
            const c = stEditor.card;
            const spec = ST_SPEC_LIST.indexOf(c.spec) >= 0 ? c.spec : 'v2';
            const name = c.name || '未命名角色';
            const flat = {
                name: name,
                description: c.description,
                personality: c.personality,
                scenario: c.scenario,
                first_mes: c.firstMes,
                mes_example: c.mesExample
            };
            if (spec === 'v1') {
                // V1 就是这几个扁平字段 + 一点老元数据，没有 data 包一层
                return Object.assign(flat, {
                    creatorcomment: c.creatorNotes,
                    avatar: 'none',
                    chat: '',
                    talkativeness: '0.5',
                    fav: false,
                    tags: c.tags.slice()
                });
            }

            const ext = stExtraExtensions();
            if (c.depthPrompt) {
                ext.depth_prompt = {
                    prompt: c.depthPrompt,
                    depth: c.depthPromptDepth,
                    role: c.depthPromptRole
                };
            } else {
                delete ext.depth_prompt;
            }
            if (c.regex.length) {
                ext.regex_scripts = c.regex.map(stRegexToRaw);
            } else {
                delete ext.regex_scripts;
            }
            // 酒馆助手脚本：卡里只有 scripts 一个键是本编辑器管的，
            // variables 之类的从导入的原始对象里并回来
            const thExtras = stThExtras();
            if (c.thScripts.length || Object.keys(thExtras).length) {
                ext.tavern_helper = Object.assign({}, thExtras, {
                    scripts: c.thScripts.map(stThNodeToRaw)
                });
            } else {
                delete ext.tavern_helper;
            }

            const data = {
                name: name,
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
                extensions: ext
            };
            // 世界书没条目就不写这个字段（规范里它是可选的）
            if (c.bookEntries.length) data.character_book = stBookToJson();

            if (spec === 'v3') {
                data.nickname = c.nickname;
                data.group_only_greetings = c.groupOnlyGreetings.slice();
                data.creation_date = c.creationDate || 0;
                data.modification_date = Math.floor(Date.now() / 1000);
                if (c.source.length) data.source = c.source.slice();
                const raw = stEditor.raw;
                const rawData = (raw && raw.spec && raw.data && typeof raw.data === 'object') ? raw.data : null;
                if (rawData) {
                    if (rawData.creator_notes_multilingual &&
                        typeof rawData.creator_notes_multilingual === 'object') {
                        data.creator_notes_multilingual = rawData.creator_notes_multilingual;
                    }
                    if (Array.isArray(rawData.assets)) data.assets = rawData.assets;
                }
            }
            // undefined 的键直接删掉，JSON 里干净点（V2 尤其不该出现 V3 的字段）
            Object.keys(data).forEach(k => { if (data[k] === undefined) delete data[k]; });

            return {
                spec: 'chara_card_' + spec,
                spec_version: spec === 'v3' ? '3.0' : '2.0',
                data: data
            };
        }

