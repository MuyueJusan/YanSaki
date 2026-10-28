        // ===== 世界书扫描 =====
        // 这一整段是 SillyTavern checkWorldInfo 的移植：扫描状态机、缓冲区、定时效果、
        // 包含组、装饰器、概率、最小激活数……判断顺序都照原样，方便对着源码逐条核对。
        // 唯一的差别是没有 token 预算 —— 本应用没有 maxContext 概念，用户也要求不截断，
        // 所以 ST 里 budget / token_budget_overflowed / ignoreBudget 这几条都没有搬过来。

        // ST parseDecorators：正文开头的 @@ 行是装饰器，要从正文里剥掉
        function wiParseDecorators(content) {
            const text = String(content == null ? '' : content);
            const isKnown = data => {
                const d = data.startsWith('@@@') ? data.substring(1) : data;
                return WI_KNOWN_DECORATORS.some(k => d.startsWith(k));
            };
            if (!text.startsWith('@@')) return { decorators: [], content: text };
            let newContent = text;
            const lines = text.split('\n');
            const decorators = [];
            let fallbacked = false;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].startsWith('@@')) {
                    if (lines[i].startsWith('@@@') && !fallbacked) continue;
                    if (isKnown(lines[i])) {
                        decorators.push(lines[i].startsWith('@@@') ? lines[i].substring(1) : lines[i]);
                        fallbacked = false;
                    } else {
                        fallbacked = true;
                    }
                } else {
                    newContent = lines.slice(i).join('\n');
                    break;
                }
            }
            return { decorators, content: newContent };
        }

        // 定时效果的键。ST 用 getStringHash(JSON.stringify(entry))，这里用等价的稳定哈希，
        // 只要求「条目一改、键就变」——算法不要求和 ST 一致
        function wiStringHash(str) {
            let h = 5381;
            const s = String(str);
            for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
            return h;
        }

        // ST parseRegexFromString：key 写成 /pattern/flags 就走正则，覆盖其它所有匹配选项
        function wiParseRegex(input) {
            const m = String(input).match(/^\/([\w\W]+?)\/([gimsuy]*)$/);
            if (!m) return null;
            let pattern = m[1];
            const flags = m[2];
            // 出现没转义的分隔符就不是合法正则（ST 原样）
            if (pattern.match(/(^|[^\\])\//)) return null;
            pattern = pattern.replace('\\/', '/');
            try { return new RegExp(pattern, flags); } catch (e) { return null; }
        }

        function wiScanDepth() {
            const v = Number(aiConfig.tavernScanDepth);
            return Number.isFinite(v) ? Math.max(0, Math.min(WI_MAX_SCAN_DEPTH, v)) : 2;
        }

        // 扫描时消息要不要带说话人名字（ST 的 world_info_include_names，默认开）
        function wiSpeakerName(role) {
            if (role === 'user') return String(aiConfig.userName || '').trim() || '你';
            return getMacroContext().charName;
        }

        // ST 的 globalScanData：除了聊天，还能一起扫的角色卡字段。
        // personaDescription 在 ST 里是 power_user.persona_description 的 trim
        // （script.js:3412 的 persona 宏 → 4627 塞进 globalScanData），
        // 也就是用户人设描述的正文，不是 {{user}} 的名字
        function wiGlobalScanData() {
            const c = aiConfig.tavernCard || {};
            return {
                personaDescription: personaText().trim(),
                characterDescription: String(c.description || ''),
                characterPersonality: String(c.personality || ''),
                characterDepthPrompt: '',
                scenario: String(c.scenario || ''),
                creatorNotes: String(c.creatorNotes || ''),
                trigger: WI_GENERATION_TYPE
            };
        }

        // 定时效果的「消息时钟」。ST 直接用 chat.length；本应用会把历史截到 40 条，
        // 截断之后 length 不再增长，黏性/冷却就永远不过期，所以用一个只增不减的计数器
        function wiChatClock() {
            const n = Number(aiConfig.tavernTimed && aiConfig.tavernTimed.msgCount);
            return (Number.isFinite(n) && n > 0) ? n : 0;
        }

        function wiBumpClock() {
            if (!aiConfig.tavernTimed) aiConfig.tavernTimed = { sticky: {}, cooldown: {}, msgCount: 0 };
            aiConfig.tavernTimed.msgCount = wiChatClock() + 1;
        }

        function wiResetTimed() {
            aiConfig.tavernTimed = { sticky: {}, cooldown: {}, msgCount: 0 };
        }

        // ST WorldInfoBuffer：深度缓冲（下标 0 = 最新一条消息）+ 递归缓冲
        function wiMakeBuffer(history, globalScanData) {
            const includeNames = aiConfig.tavernIncludeNames !== false;
            const depthBuffer = [];
            for (let i = history.length - 1; i >= 0 && depthBuffer.length < WI_MAX_SCAN_DEPTH; i--) {
                const m = history[i] || {};
                const raw = includeNames
                    ? wiSpeakerName(m.role) + ': ' + String(m.content == null ? '' : m.content)
                    : String(m.content == null ? '' : m.content);
                depthBuffer.push(raw.trim());
            }
            const recurseBuffer = [];
            const baseDepth = wiScanDepth();
            let skew = 0;

            const transform = (str, entry) => {
                const cs = (entry.caseSensitive === null || entry.caseSensitive === undefined)
                    ? aiConfig.tavernCaseSensitive === true : entry.caseSensitive === true;
                return cs ? String(str) : String(str).toLowerCase();
            };

            return {
                getDepth: () => baseDepth + skew,
                advanceScan: () => { skew++; },
                hasRecurse: () => recurseBuffer.length > 0,
                addRecurse: t => { recurseBuffer.push(t); },

                // ST get()：取最近 depth 条消息，外加该条目要求一起扫的角色卡字段与递归缓冲
                get(entry, scanState) {
                    let depth = (entry.scanDepth === null || entry.scanDepth === undefined)
                        ? (baseDepth + skew) : entry.scanDepth;
                    if (depth <= 0) return '';
                    if (depth > WI_MAX_SCAN_DEPTH) depth = WI_MAX_SCAN_DEPTH;

                    const MATCHER = '\u0001';
                    const JOINER = '\n' + MATCHER;
                    let result = MATCHER + depthBuffer.slice(0, depth).join(JOINER);
                    if (entry.matchPersonaDescription && globalScanData.personaDescription)
                        result += JOINER + globalScanData.personaDescription;
                    if (entry.matchCharacterDescription && globalScanData.characterDescription)
                        result += JOINER + globalScanData.characterDescription;
                    if (entry.matchCharacterPersonality && globalScanData.characterPersonality)
                        result += JOINER + globalScanData.characterPersonality;
                    if (entry.matchCharacterDepthPrompt && globalScanData.characterDepthPrompt)
                        result += JOINER + globalScanData.characterDepthPrompt;
                    if (entry.matchScenario && globalScanData.scenario)
                        result += JOINER + globalScanData.scenario;
                    if (entry.matchCreatorNotes && globalScanData.creatorNotes)
                        result += JOINER + globalScanData.creatorNotes;
                    // 最小激活数扫描不看递归缓冲（ST 原样）
                    if (recurseBuffer.length && scanState !== WI_SCAN_STATE.MIN_ACTIVATIONS)
                        result += JOINER + recurseBuffer.join(JOINER);
                    return result;
                },

                // ST matchKeys()
                matchKeys(haystack, needle, entry) {
                    const re = wiParseRegex(needle);
                    if (re) return re.test(haystack);
                    const hay = transform(haystack, entry);
                    const s = transform(needle, entry);
                    const mww = (entry.matchWholeWords === null || entry.matchWholeWords === undefined)
                        ? aiConfig.tavernMatchWholeWords === true : entry.matchWholeWords === true;
                    if (mww) {
                        const words = s.split(/\s+/);
                        // 多词关键词直接子串匹配；单词才做词边界
                        if (words.length > 1) return hay.includes(s);
                        try {
                            // 注意不加 i 标记 —— 大小写已经在 transform 里统一过了
                            const re2 = new RegExp('(?:^|\\W)(' + escapeRe(s) + ')(?:$|\\W)');
                            return re2.test(hay);
                        } catch (e) {
                            return hay.includes(s);
                        }
                    }
                    return hay.includes(s);
                },

                // ST getScore()：数命中几个关键词，给包含组的「组内评分」用。
                // ST 这里对 key 不做宏替换（主循环里做了），照抄，免得两边选出不同的赢家
                getScore(entry, scanState) {
                    const buf = this.get(entry, scanState);
                    let nPrimary = 0, nSecondary = 0, pScore = 0, sScore = 0;
                    if (Array.isArray(entry.keys)) {
                        nPrimary = entry.keys.length;
                        for (const k of entry.keys) if (this.matchKeys(buf, k, entry)) pScore++;
                    }
                    if (Array.isArray(entry.secondaryKeys)) {
                        nSecondary = entry.secondaryKeys.length;
                        for (const k of entry.secondaryKeys) if (this.matchKeys(buf, k, entry)) sScore++;
                    }
                    if (!nPrimary) return 0;
                    if (nSecondary > 0) {
                        if (entry.selectiveLogic === WI_LOGIC.AND_ANY) return pScore + sScore;
                        if (entry.selectiveLogic === WI_LOGIC.AND_ALL)
                            return sScore === nSecondary ? pScore + sScore : pScore;
                    }
                    return pScore;
                }
            };
        }

        // ST WorldInfoTimedEffects：黏性 / 冷却 / 延迟。
        // ST 把状态存在 chat_metadata.timedWorldInfo 里，键是 `${world}.${uid}`，
        // 值是 { hash, start, end, protected }，start/end 是消息序号。
        // 本应用没有 chat_metadata，就存在配置里，用上面的「消息时钟」当序号。
        // dryRun 的处理也照 ST：试算（预览）不推进黏性/冷却，也不写新效果
        function wiMakeTimedEffects(history, entries, isDryRun) {
            const clock = wiChatClock();
            const store = aiConfig.tavernTimed;
            const buffer = { sticky: [], cooldown: [], delay: [] };
            const bookName = (getLoreBook() && getLoreBook().name) || 'book';
            const keyOf = entry => bookName + '.' + entry.id;
            const findEntry = hash => entries.find(x => String(x.hash) === String(hash));
            const makeEffect = (type, entry, isProtected) => ({
                hash: entry.hash,
                start: clock,
                end: clock + Number(entry[type]),
                protected: !!isProtected
            });

            function checkOfType(type, onEnded) {
                const map = store[type] || {};
                for (const key of Object.keys(map)) {
                    const value = map[key] || {};
                    const entry = findEntry(value.hash);
                    // 聊天没往前走 → 非保护态直接丢掉（ST 原样）
                    if (clock <= Number(value.start) && !value.protected) { delete map[key]; continue; }
                    if (!entry) {
                        if (clock >= Number(value.end)) delete map[key];
                        continue;
                    }
                    if (!entry[type]) { delete map[key]; continue; }
                    if (clock >= Number(value.end)) {
                        delete map[key];
                        if (typeof onEnded === 'function') onEnded(entry);
                        continue;
                    }
                    buffer[type].push(entry);
                }
            }

            return {
                buffer,
                check() {
                    if (!isDryRun) {
                        checkOfType('sticky', entry => {
                            // 黏性刚结束立刻进入冷却（ST 原样）
                            if (!entry.cooldown) return;
                            store.cooldown[keyOf(entry)] = makeEffect('cooldown', entry, true);
                            buffer.cooldown.push(entry);
                        });
                        checkOfType('cooldown', null);
                    }
                    // 延迟：消息条数还没到 delay 就一直压制（ST 里 dry run 也会算这条）
                    for (const entry of entries) {
                        if (!entry.delay) continue;
                        if (history.length < entry.delay) buffer.delay.push(entry);
                    }
                },
                isActive(type, entry) {
                    return buffer[type].some(x => String(x.hash) === String(entry.hash));
                },
                // ST setTimedEffects：激活的条目如果配了黏性/冷却，记下时间窗
                set(activated) {
                    if (isDryRun) return;
                    for (const entry of activated) {
                        for (const type of ['sticky', 'cooldown']) {
                            if (!entry[type]) continue;
                            const k = keyOf(entry);
                            if (!store[type][k]) store[type][k] = makeEffect(type, entry, false);
                        }
                    }
                }
            };
        }

        // ST 的角色过滤器。names 存的是「头像文件名（去掉扩展名）」，本应用用导入时的文件名；
        // tags 存的是标签 ID，本应用没有标签系统，ST 在没有 tagMap 时同样会整段跳过
        function wiCharacterFiltered(entry) {
            const cf = entry.characterFilter;
            if (!cf || (!cf.names.length && !cf.tags.length)) return false;
            const card = aiConfig.tavernCard || {};
            if (cf.names.length) {
                const self = String(card.fileName || '');
                const nameIncluded = self ? cf.names.includes(self) : false;
                if (cf.isExclude ? nameIncluded : !nameIncluded) return true;
            }
            return false;
        }

        // ST filterByInclusionGroups：同一组的条目里只留一个赢家
        function wiFilterByInclusionGroups(newEntries, allActivated, buffer, scanState, timed, useGroupScoring) {
            const grouped = {};
            for (const item of newEntries) {
                if (!item.group) continue;
                item.group.split(/,\s*/).filter(x => x).forEach(g => {
                    if (!grouped[g]) grouped[g] = [];
                    grouped[g].push(item);
                });
            }
            if (!Object.keys(grouped).length) return;

            const removeEntry = entry => {
                const i = newEntries.indexOf(entry);
                if (i >= 0) newEntries.splice(i, 1);
            };
            const removeAllBut = (group, chosen) => {
                for (const entry of group.slice()) {
                    if (entry === chosen) continue;
                    removeEntry(entry);
                }
            };

            // ① 定时效果：组里有黏性条目 → 只留黏性；冷却/延迟的直接踢掉
            const hasSticky = {};
            for (const [key, group] of Object.entries(grouped)) {
                hasSticky[key] = false;
                const stickyEntries = group.filter(x => timed.isActive('sticky', x));
                if (stickyEntries.length) {
                    for (const entry of group.slice()) {
                        if (stickyEntries.includes(entry)) continue;
                        removeEntry(entry);
                    }
                    hasSticky[key] = true;
                }
                for (const entry of group.slice()) {
                    if (timed.isActive('cooldown', entry) || timed.isActive('delay', entry)) removeEntry(entry);
                }
            }

            // ② 组内评分：分低的踢掉（全局开关或条目自己开都要算）
            for (const [key, group] of Object.entries(grouped)) {
                if (!useGroupScoring && !group.some(x => x.useGroupScoring)) continue;
                if (hasSticky[key]) continue;
                const scores = group.map(e => buffer.getScore(e, scanState));
                const maxScore = Math.max.apply(null, scores);
                for (let i = group.length - 1; i >= 0; i--) {
                    const scored = (group[i].useGroupScoring === null || group[i].useGroupScoring === undefined)
                        ? useGroupScoring : group[i].useGroupScoring === true;
                    if (!scored) continue;
                    if (scores[i] < maxScore) {
                        removeEntry(group[i]);
                        group.splice(i, 1);
                        scores.splice(i, 1);
                    }
                }
            }

            // ③ 每组只留一个
            for (const [key, group] of Object.entries(grouped)) {
                if (hasSticky[key]) continue;
                // 这个组之前已经激活过 → 剩下的全部作废
                if ([...allActivated.values()].some(x => x.group === key)) {
                    removeAllBut(group, null);
                    continue;
                }
                if (group.length <= 1) continue;
                // 组内优先级：groupOverride 的按 order 倒序取第一个
                const prios = group.filter(x => x.groupOverride).sort((a, b) => b.order - a.order);
                if (prios.length) { removeAllBut(group, prios[0]); continue; }
                // 加权随机
                const total = group.reduce((n, x) => n + (x.groupWeight == null ? WI_DEFAULT_WEIGHT : x.groupWeight), 0);
                const roll = Math.random() * total;
                let acc = 0, winner = null;
                for (const entry of group) {
                    acc += (entry.groupWeight == null ? WI_DEFAULT_WEIGHT : entry.groupWeight);
                    if (roll <= acc) { winner = entry; break; }
                }
                if (!winner) continue;
                removeAllBut(group, winner);
            }
        }

        // 扫描世界书。返回按位置分好桶的条目引用：
        //   { before, after, anTop, anBottom, emTop, emBottom, depth:[{depth,role,entries}],
        //     outlet:{name:[entry]}, activated:[entry], reasons:Map }
        // isDryRun = true 时只做试算（预览用），不推进黏性/冷却状态 —— 和 ST 的 dryRun 一致
        function scanWorldInfo(history, isDryRun) {
            const empty = {
                before: [], after: [], anTop: [], anBottom: [], emTop: [], emBottom: [],
                depth: [], outlet: {}, activated: [], reasons: new Map(), scanned: []
            };
            const book = getLoreBook();
            if (!book || !book.entries || !book.entries.length) return empty;

            // ST getSortedEntries：先按 order 倒序（sortFn = b.order - a.order）。
            // 后面入桶时用的是 unshift，所以最终文本里是 order 升序。
            // 同 order 的靠「源文件顺序」决定（JS 的 sort 稳定）。
            // 一定要 clone：扫描过程会改写 entry.content（宏替换），不能污染配置里的原对象
            const sortedEntries = book.entries.map(e => Object.assign({}, e))
                .sort((a, b) => b.order - a.order);
            empty.scanned = sortedEntries;

            const globalScanData = wiGlobalScanData();
            const buffer = wiMakeBuffer(history, globalScanData);
            const timed = wiMakeTimedEffects(history, sortedEntries, isDryRun);
            timed.check();

            // ST：把所有「延迟到递归」的层级收集起来，从小到大逐级解锁
            const delayLevels = [...new Set(sortedEntries
                .filter(e => e.delayUntilRecursion)
                .map(e => e.delayUntilRecursion === true ? 1 : e.delayUntilRecursion))]
                .sort((a, b) => a - b);
            let currentRecursionDelayLevel = delayLevels.length ? delayLevels.shift() : 0;

            const recursive = aiConfig.tavernRecursive === true;
            const minActivations = Math.max(0, Number(aiConfig.tavernMinActivations) || 0);
            const minActivationsDepthMax = Math.max(0, Number(aiConfig.tavernMinActivationsDepthMax) || 0);
            const maxRecursionSteps = Math.max(0, Number(aiConfig.tavernMaxRecursionSteps) || 0);
            const useGroupScoring = aiConfig.tavernGroupScoring === true;

            const allActivated = new Map();
            const failedProbability = new Set();
            const reasons = new Map();       // entry.id → 没激活的原因（给界面看）
            let scanState = WI_SCAN_STATE.INITIAL;
            let count = 0;
            let allActivatedText = '';
            // 安全阀。ST 靠「没有新条目」自然收敛，这里再兜一个上限，正常永远碰不到
            const stepLimit = Math.max(8, sortedEntries.length * 2 + delayLevels.length + 4);

            while (scanState) {
                // max_recursion_steps 非 0 时，到步数就停（和最小激活数互斥，ST 原样）
                if (maxRecursionSteps && maxRecursionSteps <= count) break;
                if (++count > stepLimit) break;

                let nextScanState = WI_SCAN_STATE.NONE;
                const activatedNow = new Set();

                for (const entry of sortedEntries) {
                    const id = entry.id;
                    if (failedProbability.has(entry) || allActivated.has(id)) continue;

                    if (!entry.enabled) { reasons.set(id, '已禁用'); continue; }
                    // 生成类型过滤器（本应用只有 normal 一种生成方式）
                    if (entry.triggers.length && !entry.triggers.includes(globalScanData.trigger)) {
                        reasons.set(id, '生成类型不匹配（triggers）');
                        continue;
                    }
                    if (wiCharacterFiltered(entry)) { reasons.set(id, '被角色过滤器拦下'); continue; }

                    const isSticky = timed.isActive('sticky', entry);
                    const isCooldown = timed.isActive('cooldown', entry);
                    const isDelay = timed.isActive('delay', entry);
                    if (isDelay) { reasons.set(id, '被 delay 压制'); continue; }
                    if (isCooldown && !isSticky) { reasons.set(id, '冷却中'); continue; }

                    // 递归相关的标记只在递归轮生效
                    if (scanState !== WI_SCAN_STATE.RECURSION && entry.delayUntilRecursion && !isSticky) {
                        reasons.set(id, '延迟到递归');
                        continue;
                    }
                    if (scanState === WI_SCAN_STATE.RECURSION && entry.delayUntilRecursion &&
                        entry.delayUntilRecursion > currentRecursionDelayLevel && !isSticky) {
                        reasons.set(id, '延迟到更深的递归层级 ' + entry.delayUntilRecursion);
                        continue;
                    }
                    if (scanState === WI_SCAN_STATE.RECURSION && recursive && entry.excludeRecursion && !isSticky) {
                        reasons.set(id, '不参与递归');
                        continue;
                    }

                    // 装饰器优先于一切关键词判断
                    if (entry.decorators.includes('@@activate')) { activatedNow.add(entry); continue; }
                    if (entry.decorators.includes('@@dont_activate')) { reasons.set(id, '@@dont_activate'); continue; }

                    if (entry.constant) { activatedNow.add(entry); continue; }
                    if (isSticky) { activatedNow.add(entry); continue; }
                    if (!entry.keys.length) { reasons.set(id, '没有关键词'); continue; }

                    const textToScan = buffer.get(entry, scanState);
                    // 主关键词：宏先展开（ST 的 substituteParams）
                    const primary = entry.keys.find(k => {
                        const sub = applyCardMacros(k);
                        return sub && buffer.matchKeys(textToScan, sub.trim(), entry);
                    });
                    if (!primary) { reasons.set(id, '主关键词没命中'); continue; }

                    const hasSecondary = entry.selective && entry.secondaryKeys.length > 0;
                    if (!hasSecondary) { activatedNow.add(entry); continue; }

                    let anyHit = false, allHit = true;
                    for (const k of entry.secondaryKeys) {
                        const sub = applyCardMacros(k);
                        const hit = !!(sub && buffer.matchKeys(textToScan, sub.trim(), entry));
                        if (hit) anyHit = true; else allHit = false;
                    }
                    const logic = entry.selectiveLogic;
                    const ok = logic === WI_LOGIC.AND_ANY ? anyHit
                        : logic === WI_LOGIC.NOT_ALL ? !allHit
                            : logic === WI_LOGIC.NOT_ANY ? !anyHit
                                : logic === WI_LOGIC.AND_ALL ? allHit
                                    : anyHit;
                    if (!ok) { reasons.set(id, '次关键词不满足'); continue; }
                    activatedNow.add(entry);
                }

                // 概率检查之前先排序：黏性优先，其余保持 sortedEntries 的顺序（ST 原样）
                let newEntries;
                if (activatedNow.size > 1) {
                    const idxOf = new Map(sortedEntries.map((e, i) => [e, i]));
                    newEntries = [...activatedNow].sort((a, b) => {
                        const sa = timed.isActive('sticky', a) ? 1 : 0;
                        const sb = timed.isActive('sticky', b) ? 1 : 0;
                        return (sb - sa) || ((idxOf.get(a) == null ? -1 : idxOf.get(a)) -
                            (idxOf.get(b) == null ? -1 : idxOf.get(b)));
                    });
                } else {
                    newEntries = [...activatedNow];
                }

                wiFilterByInclusionGroups(newEntries, allActivated, buffer, scanState, timed, useGroupScoring);

                for (const entry of newEntries) {
                    // 概率：不启用或 100% 就不掷；黏性条目不重掷
                    if (entry.useProbability && entry.probability !== 100 && !timed.isActive('sticky', entry)) {
                        if (Math.random() * 100 > entry.probability) {
                            failedProbability.add(entry);
                            reasons.set(entry.id, '概率没过（' + entry.probability + '%）');
                            continue;
                        }
                    }
                    // 内容里的宏在这里就展开（ST 的 substituteParams(entry.content)）
                    entry.content = applyCardMacros(entry.content);
                    reasons.delete(entry.id);
                    allActivated.set(entry.id, entry);
                }

                const successful = newEntries.filter(x => !failedProbability.has(x));
                const forRecursion = successful.filter(x => !x.preventRecursion);

                if (recursive && forRecursion.length) nextScanState = WI_SCAN_STATE.RECURSION;
                if (recursive && scanState === WI_SCAN_STATE.MIN_ACTIVATIONS && buffer.hasRecurse())
                    nextScanState = WI_SCAN_STATE.RECURSION;

                // 最小激活数没凑够 → 把扫描窗口往历史深处推一条，再来一轮
                const minNotSatisfied = minActivations > 0 && allActivated.size < minActivations;
                if (!nextScanState && minNotSatisfied) {
                    const overMax = (minActivationsDepthMax > 0 && buffer.getDepth() > minActivationsDepthMax) ||
                        (buffer.getDepth() > history.length);
                    if (!overMax) {
                        nextScanState = WI_SCAN_STATE.MIN_ACTIVATIONS;
                        buffer.advanceScan();
                    }
                }

                // 还有没解锁的「延迟到递归」层级 → 继续递归
                if (nextScanState === WI_SCAN_STATE.NONE && delayLevels.length) {
                    nextScanState = WI_SCAN_STATE.RECURSION;
                    currentRecursionDelayLevel = delayLevels.shift();
                }

                scanState = nextScanState;
                if (scanState) {
                    const text = forRecursion.map(x => x.content).join('\n');
                    if (text) {
                        buffer.addRecurse(text);
                        allActivatedText = text + '\n' + allActivatedText;
                    }
                }
            }

            timed.set([...allActivated.values()]);
            return wiBucketEntries(allActivated, sortedEntries, reasons);
        }

        // ST 的入桶逻辑：把激活的条目按 order 倒序遍历，再往各桶 unshift，
        // 于是每个桶里最终是 order 升序。@D 按 (depth, role) 分组。
        function wiBucketEntries(allActivated, sortedEntries, reasons) {
            const buckets = {
                before: [], after: [], anTop: [], anBottom: [], emTop: [], emBottom: [],
                depth: [], outlet: {}, activated: [], reasons: reasons, scanned: sortedEntries
            };
            const depthMap = new Map();

            [...allActivated.values()].sort((a, b) => b.order - a.order).forEach(entry => {
                // 空内容不入桶（ST 原样）。宏已经展开过了
                const content = entry.content;
                if (!content) return;
                switch (entry.position) {
                    case WI_POS.beforeChar: buckets.before.unshift(entry); break;
                    case WI_POS.afterChar: buckets.after.unshift(entry); break;
                    case WI_POS.anTop: buckets.anTop.unshift(entry); break;
                    case WI_POS.anBottom: buckets.anBottom.unshift(entry); break;
                    case WI_POS.emTop: buckets.emTop.unshift(entry); break;
                    case WI_POS.emBottom: buckets.emBottom.unshift(entry); break;
                    case WI_POS.atDepth: {
                        // ST 按 (depth, role) 分组，同组内容用换行拼成一条消息
                        const d = (entry.depth == null ? WI_DEFAULT_DEPTH : entry.depth);
                        const r = (entry.role == null ? 0 : entry.role);
                        const key = d + '|' + r;
                        if (!depthMap.has(key)) {
                            const g = { depth: d, role: r, entries: [] };
                            depthMap.set(key, g);
                            buckets.depth.push(g);
                        }
                        depthMap.get(key).entries.unshift(entry);
                        break;
                    }
                    case WI_POS.outlet: {
                        const name = entry.outletName || '(未命名出口)';
                        if (!buckets.outlet[name]) buckets.outlet[name] = [];
                        buckets.outlet[name].push(entry);
                        break;
                    }
                    default: break;
                }
            });

            // 只保留内容非空的 @D 分组
            buckets.depth = buckets.depth.filter(g => g.entries.some(e => e.content));
            buckets.activated = [...allActivated.values()];
            return buckets;
        }

