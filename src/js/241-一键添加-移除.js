        // ===== 一键添加 / 移除 =====
        // 「一键添加」把 7 类组件一次补齐：MVU 脚本 / Zod 脚本 / 4 条世界书 /
        // 5 条正则 / 开场白占位符。每一类都**按内容先认一遍**，有的就跳过 ——
        // 所以同一个按钮在「全新卡」和「装了一半的卡」上都管用，
        // 也不会把用户自己改过的条目重复加一份
        function stMvuRemoveScriptDeep(target) {
            const walk = list => {
                if (!Array.isArray(list)) return false;
                for (let i = 0; i < list.length; i++) {
                    const n = list[i];
                    if (n === target) { list.splice(i, 1); return true; }
                    if (n && n.kind === 'folder' && walk(n.scripts)) return true;
                }
                return false;
            };
            return walk(stEditor.card.thScripts);
        }

        function stMvuInstall() {
            const c = stEditor.card;
            if (!c) return [];
            const did = [];
            const d = stMvuDetect();

            // ① MVU 框架本体
            if (!d.mvuScript) {
                const s = stBlankThScript();
                s.name = ST_MVU_SCRIPT_NAME;
                s.enabled = true;
                s.content = stMvuMvuScriptCode();
                s.info = 'MVU（Magical Variable Update）变量框架本体，从 CDN 加载。' +
                    '负责解析 AI 回复末尾的 <UpdateVariable>，校验后改写本楼层的 stat_data。';
                s.buttonEnabled = true;
                s.buttons = [{ name: '重新处理变量', visible: true }];
                c.thScripts.push(s);
                did.push('脚本「MVU」');
            }
            // ② Zod 结构校验脚本（内容由变量结构生成）
            if (!d.zodScript) {
                const s = stBlankThScript();
                s.name = ST_MVU_ZOD_NAME;
                s.enabled = true;
                s.content = stMvuZodCode();
                s.info = '变量结构校验（zod）。内容由「变量结构」页自动生成 —— ' +
                    '在那边改结构，这里会跟着重写。';
                c.thScripts.push(s);
                did.push('脚本「Zod」');
            }

            // ③ 四条世界书条目。深度 / 开关照 MVU Maker 的 templates.ts：
            //    initvar 必须**禁用**（MVU 只读禁用状态的 initvar 条目），depth 4
            //    变量列表 / 更新规则 depth 0（要贴近最新上下文）
            //    输出格式 depth 4
            //    一律 @D（position 4）、role system、order 200、常驻、无关键词
            const want = [
                [ST_MVU_INITVAR, stMvuInitVarYaml(), 4, false, 'initvar'],
                [ST_MVU_VARLIST, stMvuVarListTemplate(), 0, true, 'varlist'],
                [ST_MVU_RULES, stMvuRulesYaml(), 0, true, 'rules'],
                [ST_MVU_FORMAT, stMvuOutputFormatTemplate(), 4, true, 'format']
            ];
            want.forEach(w => {
                if (d[w[4]]) return;
                c.bookEntries.push(stMvuMakeEntry(w[0], w[1], w[2], w[3]));
                did.push('世界书「' + w[0] + '」');
            });

            // ④ 正则五件套
            let madeSb = false;
            stMvuRegexSpecs().forEach(sp => {
                const dup = c.regex.some(r => String(r.findRegex || '') === sp[1] &&
                    (r.promptOnly === true) === (sp[3].promptOnly === true) &&
                    (r.markdownOnly === true) === (sp[3].markdownOnly === true));
                if (dup) return;
                // 状态栏那条（sbShow）改成本编辑器生成的版本：结构 base64 塞在
                // 注释里，装完就能在「状态栏」页里改外观，而不是先看到一坨
                // 认不出结构的默认 HTML、还得先点一次「接管」
                const isSb = sp[0] === ST_MVU_RX_NAME.sbShow;
                if (isSb) {
                    c.statusBar = stBlankStatusBar();
                    c.statusBar.blocks = stSbDefaultBlocks();
                }
                c.regex.push(stMvuMakeRegex(sp[0], sp[1],
                    isSb ? stSbDocHtml() : sp[2], sp[3]));
                if (isSb) madeSb = true;
                did.push('正则「' + sp[0] + '」');
            });

            // ⑤ 开场白末尾的状态栏占位符。
            //    MVU 靠开场白初始化变量，一张**没有开场白**的卡加完 MVU 也不会动，
            //    所以这里顺手补一个空开场白，而不是丢一句警告让用户自己想办法
            if (!d.placeholder) {
                const cur = String(c.firstMes || '');
                if (!cur.trim()) {
                    c.firstMes = ST_MVU_PLACEHOLDER;
                    did.push('开场白（原来是空的，已补占位符）');
                } else {
                    c.firstMes = cur.replace(/\s+$/, '') + '\n\n' + ST_MVU_PLACEHOLDER;
                    did.push('开场白末尾的状态栏占位符');
                }
            }

            // ⑥ 接管已有结构。判据只有一条：**卡里的 Zod 读不读得回来**。
            //    读得回来 → 顺手填进变量树，接管（这样「编辑当前 MVU」才成立）
            //    读不回来 → 默认**不接管**。因为 mvuOwn 一旦置 true，
            //               用户随手加一个变量就会用编辑器里的树覆盖掉
            //               卡里原有的结构，等于静默销毁原作者的变量定义。
            //               要覆盖必须用户明确点头
            let own = true;
            if (d.zodScript) {
                const z = stMvuZodParsed();
                if (z.state === 'ok') {
                    if (!stMvuCount(c.mvu.nodes)) {
                        stMvuAdopt();
                        // 只在实际读回东西时才报 —— 空 Zod 读回来是 0 个变量，
                        // 再点一次「一键添加」会冒一句「反推出 0 个变量」，
                        // 看着像出了错，其实什么都没发生
                        const n = stMvuCount(c.mvu.nodes);
                        if (n) did.push('从卡里已有的 Zod 反推出 ' + n + ' 个变量');
                    }
                } else {
                    const mine = stMvuCount(c.mvu.nodes);
                    const go = mine && window.confirm(
                        '卡里已有的 Zod 结构认不出来，本编辑器读不回变量树。\n\n' +
                        '继续会用你在编辑器里搭的 ' + mine + ' 个变量覆盖它。确定吗？');
                    if (go) {
                        did.push('⚠ 用编辑器里的结构覆盖了卡里原有的 Zod');
                    } else {
                        own = false;
                        did.push('⚠ 卡里的 Zod 写法认不出来，没有接管 —— ' +
                            '变量结构可以编辑，但改动不会写回这张卡');
                    }
                }
            }

            // 从这一刻起这张卡的 MVU 归本编辑器管（读不回 Zod 且用户不同意覆盖时除外）
            stEditor.mvuOwn = own;
            if (own) stMvuSync();

            // ⑦ 状态栏的接管。判据同样只有一条：**块列表读不读得回来**。
            //    刚创建的那条就是本编辑器画的（结构注释在），直接接管；
            //    卡里本来就有别人的状态栏 → 不接管，去「状态栏」页点头才换
            if (madeSb || stSbAdopt()) {
                stEditor.sbOwn = true;
            } else {
                stEditor.sbOwn = false;
                if (stSbDetect().state === 'foreign') {
                    did.push('⚠ 卡里已有状态栏，不是本编辑器画的 —— 没接管，' +
                        '「状态栏」页里可以接管');
                }
            }

            stSaveDraft();
            return did;
        }

        function stMvuRemove() {
            const c = stEditor.card;
            if (!c) return [];
            const d = stMvuDetect();
            const did = [];

            // 脚本按内容认出来的那个对象，直接按引用删
            [['mvuScript', 'MVU'], ['zodScript', 'Zod']].forEach(pair => {
                const s = d[pair[0]];
                if (!s) return;
                if (stMvuRemoveScriptDeep(s)) did.push('脚本「' + (s.name || pair[1]) + '」');
            });
            // 世界书条目
            [['initvar', ST_MVU_INITVAR], ['varlist', ST_MVU_VARLIST],
                ['rules', ST_MVU_RULES], ['format', ST_MVU_FORMAT]].forEach(pair => {
                const e = d[pair[0]];
                if (!e) return;
                const at = c.bookEntries.indexOf(e);
                if (at < 0) return;
                c.bookEntries.splice(at, 1);
                did.push('世界书「' + (e.comment || pair[1]) + '」');
            });
            // 正则五件套
            for (let i = c.regex.length - 1; i >= 0; i--) {
                const r = c.regex[i];
                if (stMvuRegexKind(r)) {
                    c.regex.splice(i, 1);
                    did.push('正则「' + (r.scriptName || '?') + '」');
                }
            }
            // 占位符（只去掉占位符本身，开场白正文留着）
            if (String(c.firstMes || '').indexOf(ST_MVU_PLACEHOLDER) >= 0) {
                c.firstMes = String(c.firstMes)
                    .split(ST_MVU_PLACEHOLDER).join('')
                    .replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
                did.push('开场白里的状态栏占位符');
            }
            stEditor.mvuOwn = false;
            // 状态栏那条正则也被上面删掉了 —— 块列表没有落脚点，接管标记一并清掉，
            // 否则「状态栏」页会显示「已接管」而实际上写不回去
            stEditor.sbOwn = false;
            stEditor.card.statusBar = stBlankStatusBar();
            stSaveDraft();
            return did;
        }

        function stBlankCard() {
            const now = Math.floor(Date.now() / 1000);
            return {
                spec: 'v2',
                // —— 名字 ——
                name: '',
                nickname: '',
                // —— 设定 ——
                description: '',
                personality: '',
                scenario: '',
                mesExample: '',
                // —— 提示词 ——
                systemPrompt: '',
                postHistoryInstructions: '',
                depthPrompt: '',
                depthPromptDepth: 4,
                depthPromptRole: 0,
                // —— 元信息 ——
                creator: '',
                characterVersion: '',
                creatorNotes: '',
                tags: [],
                source: [],
                creationDate: now,
                modificationDate: now,
                // —— 开场白 ——
                firstMes: '',
                alternateGreetings: [],
                groupOnlyGreetings: [],
                // —— 世界书 ——
                bookName: '',
                bookDescription: '',
                bookEntries: [],
                // —— 正则 ——
                regex: [],
                // —— 酒馆助手脚本 ——
                thScripts: [],
                // —— MVU 变量框架 ——
                mvu: stBlankMvu(),
                // —— MVU 状态栏（外观）——
                statusBar: stBlankStatusBar()
            };
        }

        const stStr = v => (typeof v === 'string' ? v : (v == null ? '' : String(v)));
        const stStrList = v => (Array.isArray(v) ? v.map(stStr) : []);

        // 从 localStorage / 导入结果里读回来的草稿一律过一遍这里，
        // 免得某个字段是 undefined 或类型不对，渲染时炸在半个页面上
        function stNormalizeDraft(raw) {
            const c = stBlankCard();
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return c;
            c.spec = ST_SPEC_LIST.indexOf(raw.spec) >= 0 ? raw.spec : 'v2';
            ['name', 'nickname', 'description', 'personality', 'scenario', 'mesExample',
                'systemPrompt', 'postHistoryInstructions', 'depthPrompt', 'creator',
                'characterVersion', 'creatorNotes', 'firstMes', 'bookName',
                'bookDescription'].forEach(k => { c[k] = stStr(raw[k]); });
            ['tags', 'source', 'alternateGreetings', 'groupOnlyGreetings'].forEach(k => {
                c[k] = stStrList(raw[k]);
            });
            const numOr = (v, d) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : d);
            c.depthPromptDepth = Math.max(0, Math.min(WI_MAX_INJECTION_DEPTH,
                numOr(raw.depthPromptDepth, 4)));
            c.depthPromptRole = [0, 1, 2].indexOf(numOr(raw.depthPromptRole, 0)) >= 0
                ? numOr(raw.depthPromptRole, 0) : 0;
            c.creationDate = Math.max(0, numOr(raw.creationDate, 0));
            c.modificationDate = Math.max(0, numOr(raw.modificationDate, 0));

            c.bookEntries = Array.isArray(raw.bookEntries)
                ? raw.bookEntries.map(stNormalizeEntry).filter(Boolean) : [];
            c.regex = Array.isArray(raw.regex)
                ? raw.regex.map(stRegexFromRaw).filter(Boolean) : [];
            c.thScripts = Array.isArray(raw.thScripts)
                ? raw.thScripts.map(stThNodeFromRaw).filter(Boolean) : [];
            c.mvu = stMvuNormalize(raw.mvu);
            c.statusBar = stStatusBarFromRaw(raw.statusBar);
            return c;
        }

        // 单条世界书条目的清洗：以 stBlankEntry() 为底，逐字段覆盖
        function stNormalizeEntry(raw) {
            if (!raw || typeof raw !== 'object') return null;
            const e = stBlankEntry();
            e.id = stStr(raw.id) || e.id;
            e.comment = stStr(raw.comment);
            e.content = stStr(raw.content);
            e.keys = stStrList(raw.keys).filter(k => k !== '');
            e.secondaryKeys = stStrList(raw.secondaryKeys).filter(k => k !== '');
            const bool = v => v === true;
            const tri = v => (v === true || v === false) ? v : null;
            e.selective = raw.selective !== false;
            e.constant = bool(raw.constant);
            e.enabled = raw.enabled !== false;
            e.useRegex = bool(raw.useRegex);
            const pos = Number(raw.position);
            e.position = WI_POS_ORDER.indexOf(pos) >= 0 ? pos : WI_POS.beforeChar;
            e.depth = Math.max(0, Math.min(WI_MAX_INJECTION_DEPTH,
                Number.isFinite(Number(raw.depth)) ? Math.trunc(Number(raw.depth)) : WI_DEFAULT_DEPTH));
            e.role = [0, 1, 2].indexOf(Number(raw.role)) >= 0 ? Number(raw.role) : 0;
            e.order = Number.isFinite(Number(raw.order)) ? Math.trunc(Number(raw.order)) : WI_DEFAULT_ORDER;
            e.probability = Math.max(0, Math.min(100,
                Number.isFinite(Number(raw.probability)) ? Math.trunc(Number(raw.probability)) : 100));
            e.useProbability = raw.useProbability !== false;
            const logic = Number(raw.selectiveLogic);
            e.selectiveLogic = [0, 1, 2, 3].indexOf(logic) >= 0 ? logic : WI_LOGIC.AND_ANY;
            e.caseSensitive = tri(raw.caseSensitive);
            e.matchWholeWords = tri(raw.matchWholeWords);
            e.useGroupScoring = tri(raw.useGroupScoring);
            e.excludeRecursion = bool(raw.excludeRecursion);
            e.preventRecursion = bool(raw.preventRecursion);
            e.delayUntilRecursion = Math.max(0, Math.trunc(Number(raw.delayUntilRecursion) || 0));
            e.scanDepth = Number.isFinite(Number(raw.scanDepth)) && raw.scanDepth !== null &&
                raw.scanDepth !== '' && raw.scanDepth !== undefined
                ? Math.max(0, Math.min(WI_MAX_SCAN_DEPTH, Math.trunc(Number(raw.scanDepth)))) : null;
            e.group = stStr(raw.group);
            e.groupWeight = Number.isFinite(Number(raw.groupWeight))
                ? Math.trunc(Number(raw.groupWeight)) : WI_DEFAULT_WEIGHT;
            e.groupOverride = bool(raw.groupOverride);
            e.triggers = stStrList(raw.triggers).filter(t => WI_GENERATION_TRIGGERS.indexOf(t) >= 0);
            const cf = (raw.characterFilter && typeof raw.characterFilter === 'object') ? raw.characterFilter : {};
            e.characterFilter = {
                isExclude: bool(cf.isExclude),
                names: stStrList(cf.names),
                tags: stStrList(cf.tags)
            };
            e.sticky = raw.sticky == null ? null : Math.max(0, Math.trunc(Number(raw.sticky) || 0));
            e.cooldown = raw.cooldown == null ? null : Math.max(0, Math.trunc(Number(raw.cooldown) || 0));
            e.delay = raw.delay == null ? null : Math.max(0, Math.trunc(Number(raw.delay) || 0));
            e.outletName = stStr(raw.outletName);
            ['matchPersonaDescription', 'matchCharacterDescription', 'matchCharacterPersonality',
                'matchCharacterDepthPrompt', 'matchScenario', 'matchCreatorNotes'].forEach(k => {
                e[k] = bool(raw[k]);
            });
            return e;
        }

