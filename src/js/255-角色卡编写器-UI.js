        // ==========================================================================
        // 角色卡编写器：UI
        //   左侧十六个选项卡（可以折叠成一条图标栏），右侧是当前选项卡的内容。
        //   文本输入走 stSet() 只改状态、不重画 —— 否则每敲一个字都会丢焦点；
        //   只有结构变化（换规格、换位置、增删条目）才整块重画，重画前把焦点和
        //   光标位置记下来，画完还回去。
        // ==========================================================================

        const ST_TABS = [
            // ⚠ 「首页」**排在最前**（用户指定）。别的页回答「往里填什么」，
            //   只有它回答「这张卡现在长什么样 / 从哪儿开始」——
            //   所以它既不能按「产出的是角色描述」塞到 desc 旁边，
            //   也不能按「导入导出」塞到 export 旁边。
            { id: 'home', ico: '🏠', label: '首页' },
            { id: 'name', ico: '📛', label: '名字' },
            { id: 'spec', ico: '🏷', label: '类型' },
            { id: 'desc', ico: '📝', label: '角色描述' },
            { id: 'sys', ico: '⚙', label: '系统提示词' },
            { id: 'meta', ico: 'ℹ', label: '元信息' },
            { id: 'ai', ico: '🤖', label: 'AI 助手' },
            { id: 'book', ico: '📖', label: '世界书' },
            { id: 'greet', ico: '💬', label: '开场白' },
            { id: 'regex', ico: '🔧', label: '正则' },
            { id: 'th', ico: '🧩', label: '酒馆助手' },
            { id: 'mvu', ico: '🧮', label: 'MVU' },
            { id: 'sb', ico: '🎨', label: '状态栏' },
            { id: 'code', ico: '⌨', label: 'Code' },
            // ⚠ 人设生成器**排在 Code 后面**（用户指定的位置）。别按「它产出的东西是角色描述」
            //   顺手挪回 `desc` 旁边 —— 那是个看起来更合理的错位。
            { id: 'persona', ico: '🎭', label: '人设生成器' },
            { id: 'export', ico: '💾', label: '导出' }
        ];

        let stEditor = {
            open: false,
            // ⚠ 默认落在「首页」：打开编辑器第一眼该看到「这张卡现在什么样」，
            //   而不是一个空的名字输入框
            tab: 'home',
            tabsCollapsed: false,
            // 首页那四个模块各自的折叠状态：`{ 模块 id: true }` = 这个模块收起了。
            // ⚠ 跟 `tabsCollapsed` 一样**落盘**（不像 personaTplOpen 那样故意不落盘）——
            //   模块默认是**展开**的，落盘只会让「用户自己折起来的那几个」保持折着，
            //   不会破坏「默认展开」这个意图。⚠ 也**不随新建重置**：它是界面偏好，不是卡数据。
            homeClosed: {},
            card: null,
            raw: null,          // 导入的原始 JSON，只在本次会话里留着
            rawBook: null,      // 导入的原始 character_book，用来兜住书级字段
            rawTh: null,        // 导入的原始 extensions.tavern_helper，用来兜住 variables 等字段
            srcName: '',
            avatar: null,       // data URL
            avatarName: '',
            dirty: false,
            lastExport: '',
            // —— MVU 变量结构编辑器的界面状态 ——
            // 选中 / 展开都按节点 id 记，不按路径 —— 路径在增删移动之后就失效了
            mvuSel: '',
            mvuOpen: {},
            // 「本编辑器接管了这张卡的 MVU」。
            // 只有接管了才会把结构回写成 Zod / initvar ——
            // 否则一打开别人手写的卡就会把人家格式不同的内容换掉
            mvuOwn: false,
            // —— 状态栏外观编辑器的界面状态 ——
            // 块可能挂在根上也可能挂在某个 row 里，所以选中 / 展开一律按块 id 记
            sbSel: '',
            sbOpen: {},
            // 「存为预制块」那格输入框里的名字。
            // ⚠ 面板参数**不能只活在 DOM 里** —— stRerender 会把整个 pane 重建，
            //   只写在 input 上的话，选一下画布上的块就把刚敲的名字冲掉了
            sbPfName: '',
            // 「让 AI 生成预制块」那两格：描述文字 + 生成中。
            // ⚠ 跟 sbPfName 同一条理由 —— 面板参数不能只活在 DOM 里；
            //   而且忙态必须扛得过 stRerender，否则「生成中…」一重绘就没了
            sbPfAiDesc: '',
            sbPfAiBusy: false,
            // —— 人设生成器 ——
            // ⚠ 同 sbPfName / sbPfAiDesc 那条理由：面板参数不能只活在 DOM 里，
            //   stRerender 会把整个 pane 重建，只写在 input 上的话一切页就没了；
            //   忙态也必须扛得过重绘，否则「生成中…」一重绘就变回「生成人设」
            personaReq: '',      // 用户写的设定 / 要求
            personaOut: '',      // 生成结果（可编辑，要用户点「写入」才进卡）
            personaBusy: false,
            // 自定义模板。**null = 还没从 localStorage 读过**（懒加载，见 stPersonaTpl()）——
            // 初始化成 '' 的话那个「读过没有」的判断就永远成立，自定义模板永远读不出来
            personaTpl: null,
            // 「模板」那个折叠块展开没有。**默认收起**，而且**故意不落盘** ——
            // 落盘的话「默认折叠」只在第一次成立：用户展开过一次之后，以后每次打开编辑器
            // 都是摊开的，面板又变回原来那个长条。跟 personaReq / personaOut 一样，
            // 当**会话级**面板状态处理。
            personaTplOpen: false,
            // 「拿角色卡的名字当人物姓名」。默认**开** —— 卡名通常就是人物名。
            // ⚠ 跟 personaTplOpen 同一类：它是「这一次怎么生成」的面板参数，
            //   跟 personaReq / personaOut 一起当会话级状态，不落盘。
            personaNameUse: true,
            // —— 人设生成器 · 参考素材（世界书）——
            // 额外导入的那本世界书。**只喂这一次生成、绝不进卡** ——
            // 「额外导入」的全部意义就是「手上有一份书，但不想把它塞进这张卡」。
            // null = 没导入。形状 { name, entries }，entries 跟卡内条目**同构**
            // （都是 parseWorldBook → normalizeLoreEntry 的产物），所以下面一套逻辑渲染两边。
            personaLore: null,
            // 勾中的条目，键是 'card:<id>' / 'imp:<id>'。
            // ⚠ **必须带来源前缀**：卡内条目和导入条目的 id 各自独立生成
            //   （导入的是 'e0' 'e1'…，卡内的也可能撞），裸 id 会把两边混成一条。
            // ⚠ 存 id 不存下标 —— 下标会被世界书页的增删挪走（跟 personaBookRef 同一条理由）。
            // ⚠ 会话级、不落盘。条目被删之后这里会指向不存在的东西，
            //   所以「已选 N 条」里的 N 只数**能解析出来的**那些（见 stPersonaPickHint）。
            personaPick: [],
            // 「参考素材」那个折叠块展开没有。默认**收起** —— 卡内世界书几十条，
            // 摊开会把「生成人设」按钮挤出屏幕。跟 personaTplOpen 同一类，不落盘
            personaPickOpen: false,
            // 「追加到世界书」的记账：上一次那个动作写出的**条目 id**。
            // ⚠ 世界书条目里**没有任何字段**能标出「这条是人设生成器写的」——
            //   所以「已经添加过了」只能靠这里记着。存 id 不存下标：下标会被
            //   世界书页的增删改挪走，id 不会。
            personaBookRef: null,
            // 非 null = 正弹着那个三选一（取消 / 覆盖 / 追加为新条目），值是 { name }。
            // ⚠ 跟 personaTplOpen 一样是**会话级**状态、不落盘：重开编辑器不该带着
            //   上一次没回答完的问题。**从状态渲染**（见 stPanePersona），
            //   这样 stRerender() 重建面板时弹窗不会掉、也不会出现两个。
            personaBookAsk: null,
            // 画布上的拖动是「自由摆放（像素级）」还是「结构排序（换顺序）」。
            // **默认自由摆放** —— 「像编辑 ppt 一样」的默认动作就是把东西拖到想放的
            // 地方，而不是让编辑器猜「你想插到第几行」
            sbFree: true,
            // 「本编辑器接管了这张卡的状态栏」。
            // 状态栏存在 sbShow 那条正则的 replaceString 里，接管了才会回写 ——
            // 否则一打开别人手写的状态栏就会把人家的 HTML 换掉
            sbOwn: false,
            // —— 首页：从别处搬条目 ——
            // 从别的角色卡 / 世界书里读出来的条目，等用户挑。
            // null = 还没选过文件（面板显示「选文件」那一屏）
            // 形状：{ srcName, kind, bookName, entries: [...] }
            extractSrc: null,
            // 勾选状态按**索引**记 —— 这批条目的 id 要到「导入」那一下才生成
            // （跟 stEditor.personaBookRef 存 id 的理由正好相反：那边是导入之后要认人，
            //   这边是导入之前还没有 id）
            extractSel: {},
            // 提取区自己的一条提示。**不跟 stEditor.msg 合并** ——
            // 那条会被 stPaintMsg 分给常驻条 / 人设页，而这条要贴在提取区里
            extractMsg: { text: '', kind: '' },
            // —— 世界书的多选 ——
            // 选中的条目 **id**（不是下标 —— 下标在增删 / 上下移动之后就失效了）。
            // ⚠ 跟 extractSel 相反：那边是导入**之前**还没有 id 才按索引记，
            //   这边条目早就在卡里了，id 是稳的。
            // ⚠ 会话级界面状态：不落盘、不进卡、不进任何导出的 JSON
            bookSel: [],
            // —— 世界书的搜索与筛选 ——
            // ⚠ 也是**会话级界面状态**：不落盘、不进卡、不出现在任何导出的 JSON 里。
            //   落盘的话下次打开会莫名其妙只剩几条，用户以为条目丢了。
            // ⚠ 筛选**只影响显示**，不改 `bookEntries` 的顺序、不改下标 ——
            //   卡片是按 index 寻址的（`st-entry-<i>` / `stDupEntry(i)` / `stMoveEntry(i)`），
            //   筛完重排会让「复制」「上移」作用到另一条上。
            bookFind: { q: '', state: 'all', constant: 'all', pos: 'all', keys: 'all' },
            // ⚠ **「这一次点导入是干嘛的」故意不放在这里**，放在 `<input>` 的
            //   `dataset.mode` 上。理由：用户点了「提取条目」又**在文件框里点取消**时，
            //   `change` 事件**根本不触发** ⇒ 存在 stEditor 上的模式**没有机会被清掉**，
            //   会留到下一次正常导入上（症状：导入一张卡，结果弹出一堆条目让你挑）。
            //   放 dataset 则由 stImportPick / stExtractPick **每次都显式覆盖**，残留无害。
            // 最近一条提示。导入 / 导出的反馈不能只往导出页里塞 ——
            // 顶栏那几个按钮在任何选项卡下都能点，而导出页没渲染时那个节点根本不存在
            msg: { text: '', kind: '' }
        };

        function stInit() {
            // 拦掉「往页面别处丢文件」的默认行为 —— 不拦的话浏览器会直接打开那个文件，
            // 整个应用被顶掉（用户丢歪一次就白干了）
            stCodeInstallFileDropGuard();
            stLoadDraft();
            renderStCard();
        }

        function stLoadDraft() {
            let saved = null;
            try { saved = JSON.parse(localStorage.getItem(ST_DRAFT_KEY) || 'null'); } catch (e) {}
            if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
                stEditor.card = stNormalizeDraft(saved.card);
                stEditor.tab = ST_TABS.some(t => t.id === saved.tab) ? saved.tab : 'home';
                stEditor.tabsCollapsed = saved.tabsCollapsed === true;
                stEditor.homeClosed = (saved.homeClosed && typeof saved.homeClosed === 'object' &&
                    !Array.isArray(saved.homeClosed)) ? saved.homeClosed : {};
                stEditor.srcName = stStr(saved.srcName);
                stEditor.mvuOwn = saved.mvuOwn === true;
                stEditor.sbOwn = saved.sbOwn === true;
                // 拖动模式跟着草稿走：上次关掉了自由摆放，这次打开就还是结构排序
                stEditor.sbFree = saved.sbFree !== false;
                // 原始 JSON 只在卡不大的时候才存下来（存两份大卡会把配额吃光）
                stEditor.raw = (saved.raw && typeof saved.raw === 'object') ? saved.raw : null;
                stEditor.rawBook = null;
                stEditor.rawTh = (saved.rawTh && typeof saved.rawTh === 'object' &&
                    !Array.isArray(saved.rawTh)) ? saved.rawTh : null;
            } else {
                stEditor.card = stBlankCard();
            }
            try {
                const av = JSON.parse(localStorage.getItem(ST_AVATAR_KEY) || 'null');
                if (av && typeof av.data === 'string' && av.data) {
                    stEditor.avatar = av.data;
                    stEditor.avatarName = stStr(av.name);
                }
            } catch (e) {}
        }

        // 返回有没有真的落盘。草稿太大时退回「不带原始 JSON」再试一次。
        // 这个函数**保证不抛** —— 它只是尽力而为的持久化，里面出任何意外都不该
        // 让上层（导入 / 编辑）看起来像是失败了
        function stSaveDraft() {
            try { return stSaveDraftInner(); } catch (e) { return false; }
        }

        function stSaveDraftInner() {
            const c = stEditor.card;
            if (!c) return true;
            const base = {
                v: 1,
                tab: stEditor.tab,
                tabsCollapsed: stEditor.tabsCollapsed,
                homeClosed: stEditor.homeClosed,
                srcName: stEditor.srcName,
                mvuOwn: stEditor.mvuOwn === true,
                sbOwn: stEditor.sbOwn === true,
                sbFree: stEditor.sbFree !== false,
                card: c
            };
            if (stEditor.rawTh) {
                let thLen = 0;
                try { thLen = JSON.stringify(stEditor.rawTh).length; } catch (e) { thLen = Infinity; }
                if (thLen <= ST_TH_RAW_KEEP_MAX) base.rawTh = stEditor.rawTh;
            }
            const attempts = [];
            if (stEditor.raw) {
                let len = 0;
                try { len = JSON.stringify(stEditor.raw).length; } catch (e) { len = Infinity; }
                if (len <= ST_RAW_KEEP_MAX) attempts.push(Object.assign({ raw: stEditor.raw }, base));
            }
            attempts.push(base);

            let ok = false;
            for (const payload of attempts) {
                try {
                    localStorage.setItem(ST_DRAFT_KEY, JSON.stringify(payload));
                    ok = true;
                    break;
                } catch (e) { /* 太大就退一档再试 */ }
            }
            try {
                if (stEditor.avatar && stEditor.avatar.length <= ST_AVATAR_MAX) {
                    localStorage.setItem(ST_AVATAR_KEY, JSON.stringify({
                        name: stEditor.avatarName,
                        data: stEditor.avatar
                    }));
                } else {
                    localStorage.removeItem(ST_AVATAR_KEY);
                }
            } catch (e) { ok = false; }
            return ok;
        }

        function toggleStArea() {
            const card = document.getElementById('st-card');
            if (card) card.classList.toggle('ai-collapsed');
        }

