        // ===== 世界书解析 =====

        // 世界书条目：字段名同时兼容三种写法
        //   ① SillyTavern 自己的世界书（顶层 camelCase：key / keysecondary / order / position …）
        //   ② 角色卡 V2/V3 的 character_book（顶层 keys / secondary_keys + 字符串 position，
        //      其余在 extensions 里，snake_case：match_whole_words / delay_until_recursion …）
        //   ③ 更老的格式（insertion_order、enabled:false）
        // 取值一律「顶层优先、extensions 兜底」，和 SillyTavern 的 addMissingWorldInfoFields 对齐
        function normalizeLoreEntry(e, idx) {
            const ext = (e && e.extensions) || {};
            const num = v => {
                if (v === null || v === undefined || v === '' || v === true || v === false) return null;
                const n = Number(v);
                return Number.isFinite(n) ? n : null;
            };
            const bool = v => v === true || v === 'true';
            // 取第一个「有值」的候选 —— false / 0 / '' 都算有值，所以不能用 ||
            const pick = (...vals) => {
                for (const v of vals) if (v !== undefined && v !== null) return v;
                return undefined;
            };
            const pickNum = (...vals) => {
                for (const v of vals) { const n = num(v); if (n !== null) return n; }
                return null;
            };
            // 返回 null 表示「没设」，交给全局设置决定（ST 的 caseSensitive 等就是三态）
            const pickBool = (...vals) => {
                const v = pick(...vals);
                return v === undefined ? null : bool(v);
            };
            // 同一个字段在四种地方可能出现：顶层 camelCase / 顶层 snake_case /
            // extensions.camelCase / extensions.snake_case。V2 角色卡的 character_book
            // 把 case_sensitive 放在条目顶层，把 match_whole_words 放在 extensions 里，
            // 所以四种都得看一遍
            const cand = name => {
                const snake = name.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
                return [e[name], e[snake], ext[name], ext[snake]];
            };

            // —— 位置 ——
            let position = pickNum.apply(null, cand('position'));
            if (position === null) {
                const p = String(e.position == null ? '' : e.position).toLowerCase();
                if (p === 'after_char' || p === 'after') position = WI_POS.afterChar;
                else if (p === 'before_char' || p === 'before') position = WI_POS.beforeChar;
                else position = WI_POS.beforeChar;
            }
            if (position < 0 || position > 7) position = WI_POS.beforeChar;

            const depthRaw = pickNum.apply(null, cand('depth'));
            const depth = Math.max(0, Math.min(WI_MAX_INJECTION_DEPTH,
                depthRaw === null ? WI_DEFAULT_DEPTH : depthRaw));

            const roleRaw = pickNum.apply(null, cand('role'));
            const role = (roleRaw === null || roleRaw < 0 || roleRaw > 2) ? 0 : roleRaw;

            const order = pickNum(e.order, e.insertion_order, ext.order, ext.insertion_order);

            const keys = Array.isArray(e.key) ? e.key : (Array.isArray(e.keys) ? e.keys : []);
            const secKeys = Array.isArray(e.keysecondary) ? e.keysecondary
                : (Array.isArray(e.secondary_keys) ? e.secondary_keys : []);

            // 延迟到递归：ST 里是数字（老数据的 true 当 1 用），0 / false 表示不延迟
            const durRaw = pick.apply(null, cand('delayUntilRecursion'));
            let delayUntilRecursion = 0;
            if (durRaw === true) delayUntilRecursion = 1;
            else {
                const n = num(durRaw);
                delayUntilRecursion = (n === null || n <= 0) ? 0 : n;
            }

            const probRaw = pickNum.apply(null, cand('probability'));
            const probability = probRaw === null ? 100 : Math.max(0, Math.min(100, probRaw));

            // 角色过滤器：V3 用 characterFilter 对象，老版用 extensions.characterFilterNames / Tags / Exclude
            const cfRaw = pick.apply(null, cand('characterFilter'));
            const cf = (cfRaw && typeof cfRaw === 'object' && !Array.isArray(cfRaw)) ? cfRaw : {};
            const arrOf = v => (Array.isArray(v) ? v.map(String) : []);
            const cfNames = pick.apply(null, cand('characterFilterNames'));
            const cfTags = pick.apply(null, cand('characterFilterTags'));
            const characterFilter = {
                isExclude: bool(pick(cf.isExclude, pick.apply(null, cand('characterFilterExclude')))),
                names: cf.names ? arrOf(cf.names) : arrOf(cfNames),
                tags: cf.tags ? arrOf(cf.tags) : arrOf(cfTags)
            };

            const triggers = arrOf(pick.apply(null, cand('triggers')))
                .filter(t => WI_GENERATION_TRIGGERS.includes(t));

            const scanDepthRaw = pickNum.apply(null, cand('scanDepth'));

            return {
                id: (e.uid != null) ? String(e.uid) : ((e.id != null) ? String(e.id) : ('e' + idx)),
                srcIndex: idx,
                comment: String(pick(e.comment, e.name, '') || ''),
                content: String(e.content == null ? '' : e.content),
                keys: keys.map(k => String(k)).filter(k => k !== ''),
                secondaryKeys: secKeys.map(k => String(k)).filter(k => k !== ''),
                // ST 的 selective 默认是 true（「所有条目都是 selective 的」）
                selective: pickBool.apply(null, cand('selective')) !== false,
                selectiveLogic: pickNum.apply(null, cand('selectiveLogic')) ?? WI_LOGIC.AND_ANY,
                constant: bool(pick.apply(null, cand('constant'))),
                // ST 用 disable；老格式用 enabled:false
                enabled: !bool(pick.apply(null, cand('disable'))) && e.enabled !== false,
                // V3 的世界书条目里 use_regex 是必填；本应用的关键词匹配还是纯子串，
                // 这个开关目前只负责原样读写（编辑器里能改、导出时带上）
                useRegex: bool(pick.apply(null, cand('useRegex'))),
                position, depth, role,
                order: order === null ? WI_DEFAULT_ORDER : order,
                probability,
                useProbability: pickBool.apply(null, cand('useProbability')) !== false,
                // 三态：null = 跟随全局设置
                caseSensitive: pickBool.apply(null, cand('caseSensitive')),
                matchWholeWords: pickBool.apply(null, cand('matchWholeWords')),
                useGroupScoring: pickBool.apply(null, cand('useGroupScoring')),
                excludeRecursion: bool(pick.apply(null, cand('excludeRecursion'))),
                preventRecursion: bool(pick.apply(null, cand('preventRecursion'))),
                delayUntilRecursion,
                scanDepth: (scanDepthRaw === null ? null : Math.max(0, Math.min(WI_MAX_SCAN_DEPTH, scanDepthRaw))),
                group: String(pick.apply(null, cand('group')) || ''),
                groupWeight: pickNum.apply(null, cand('groupWeight')) ?? WI_DEFAULT_WEIGHT,
                groupOverride: bool(pick.apply(null, cand('groupOverride'))),
                triggers,
                characterFilter,
                sticky: pickNum.apply(null, cand('sticky')),
                cooldown: pickNum.apply(null, cand('cooldown')),
                delay: pickNum.apply(null, cand('delay')),
                outletName: String(pick.apply(null, cand('outletName')) || ''),
                matchPersonaDescription: bool(pick.apply(null, cand('matchPersonaDescription'))),
                matchCharacterDescription: bool(pick.apply(null, cand('matchCharacterDescription'))),
                matchCharacterPersonality: bool(pick.apply(null, cand('matchCharacterPersonality'))),
                matchCharacterDepthPrompt: bool(pick.apply(null, cand('matchCharacterDepthPrompt'))),
                matchScenario: bool(pick.apply(null, cand('matchScenario'))),
                matchCreatorNotes: bool(pick.apply(null, cand('matchCreatorNotes'))),
                // 装饰器在 getSortedEntries 阶段解析（ST 的位置），解析后 content 已经是剥掉装饰器的正文
                decorators: [],
                hash: 0
            };
        }

        function parseWorldBook(raw, fallbackName) {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('不是有效的 JSON 对象');
            let src = null;
            if (Array.isArray(raw.entries)) src = raw.entries;
            else if (raw.entries && typeof raw.entries === 'object') src = Object.values(raw.entries);
            else if (raw.character_book) return parseWorldBook(raw.character_book, fallbackName);
            if (!src) throw new Error('没找到 entries（这看起来不是世界书 JSON）');
            const num = v => (Number.isFinite(Number(v)) ? Number(v) : null);
            const entries = src.map(normalizeLoreEntry)
                .filter(e => e.content.trim() || e.keys.length || e.constant);
            return {
                name: String(raw.name || fallbackName || '世界书'),
                description: String(raw.description || ''),
                // 这两个是「书里声明的」全局设置。SillyTavern 导入世界书时并不会采纳它们
                // （它们是全局设置，不属于书），所以这里也只是显示出来，不自动套用
                declaredScanDepth: num(raw.scan_depth),
                declaredRecursive: raw.recursive_scanning === true,
                declaredTokenBudget: num(raw.token_budget),
                entries: entries.map(finalizeLoreEntry)
            };
        }

        // ST 的 getSortedEntries 里做两件事：解析 @@ 装饰器、算 hash。
        // 解析出来的装饰器决定条目能不能激活，所以必须在扫描之前完成。
        function finalizeLoreEntry(entry) {
            const parsed = wiParseDecorators(entry.content);
            const out = Object.assign({}, entry, {
                decorators: parsed.decorators,
                content: parsed.content
            });
            // hash 用来做定时效果（黏性 / 冷却）的键：条目一改，键就变，效果自动失效。
            // ST 也是这个思路（getStringHash(JSON.stringify(entry))），算法不要求一致
            out.hash = wiStringHash([out.comment, out.keys.join('\u0001'),
                out.secondaryKeys.join('\u0001'), out.content].join('\u0002'));
            return out;
        }

