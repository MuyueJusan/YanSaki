        // —— 进度上报（host.progress）——
        // 一条**单向**通道：skill 说一句、界面顶上就换一句。没有回信、不等结果。
        // ⚠ 为什么单开一条而不是复用 host.call：host.call 是**请求-应答**，
        //   它会占掉 ST_CODE_SANDBOX_RPC_MAX 那 20 次预算。一个逐条处理 50 项
        //   的 skill 光是报进度就把预算用光，然后真正读卡的那次调用被拒 ——
        //   而「报进度」和「读卡」是两件完全不相干的事，共用一个额度说不通
        // ⚠ 它**不是无成本的**：每次上报都会改父页面的 DOM（重画那一小块）。
        //   `for (var i=0;i<1e6;i++) host.progress('第'+i+'条')` 能在 5 秒里
        //   让父页面重画几十万次 —— 沙盒自己不卡，卡的是父页面
        //   （沙盒在不透明源里是独立进程，见上面那四条实测）。
        //   所以要有自己的闸：**最小间隔** + **总次数上限**，两个都要
        const ST_CODE_PROG_MS = 120;        // 两次上报之间至少隔这么久（快了就丢，不排队）
        const ST_CODE_PROG_MAX = 200;       // 一次 run 最多认几次
        // 单条进度文字的上限。⚠ 截断而不是拒绝 —— 进度是给人看的一句话，
        //   长了没有额外信息，但拒绝会让 skill 以为「我这条没报上去」而重试
        const ST_CODE_PROG_CHARS = 160;

        // —— skill 的落盘 ——
        // ⚠ 为什么不用 localStorage：配额 5MB 量级，而且**写失败是整个键一起失败** ——
        //   用户导入一个新 skill，结果老的反而全没了。IndexedDB 没有这个量级的问题。
        // ⚠ 但内存里的 stCode.skills 才是**唯一真相**：所有读路径（system 拼装 /
        //   read_skill / 面板渲染）都是同步的，不能为了异步存储把它们全改成 await。
        //   存储只在「导入 / 删除 / 清空」三处写，启动时读一次
        const ST_CODE_IDB_NAME = 'saki-code';
        const ST_CODE_IDB_STORE = 'kv';
        const ST_CODE_IDB_MS = 3000;   // 打开超时。不设的话被禁用的环境会一直挂着
        // 降级标记。⚠ 不打的后果：某次 IndexedDB 临时抽风 → 这次写进了 localStorage
        //   → 下次打开 IndexedDB 又好了 → 读到的是**旧的那份**，新的悄无声息地没了
        const ST_CODE_SKILL_LS_DIRTY = 'stCodeSkillsLsDirty';
        // 一次「从链接导入」最多拉几个 SKILL.md —— 有的仓库里几十个 skill
        const ST_CODE_IMPORT_MAX = 50;
        // 拉一个 URL 的超时。不给的话一个不响应的地址会把 Agent 循环挂死在那里
        const ST_CODE_URL_MS = 15000;

        // 自动注入的 skill **正文**总量上限。单个 skill 本身可以到 40000 字，
        // 一次把好几个全塞进 system 等于把上下文一次烧光 —— 所以按顺序装，
        // 装不下的退回「只列名字」，模型还能用 read_skill 自己去拿
        const ST_CODE_AUTO_CHARS = 24000;
        // 触发词最多记几个（防手滑粘一整段进去）
        const ST_CODE_TRIG_MAX = 12;

        // 项目记忆：用户写的「长期要求」，一行一条。**很小** ——
        // 它是偏好，不是知识库，塞满了反而挤掉真正要看的东西
        const ST_CODE_MEMO_KEY = 'stCodeMemo';
        const ST_CODE_MEMO_CHARS = 4000;

        // 任务清单：条数 + 单条文字上限。上限不是怕它写不下，
        // 是怕模型把「每一步」都拆成一条，清单本身变成噪声
        const ST_CODE_TASKS_MAX = 24;
        const ST_CODE_TASK_CHARS = 240;

        // 读一个大字段时，超过这个字数就改给「形状摘要」而不是整段 JSON。
        // 比 ST_CODE_TOOL_CHARS（12000）小一截 —— 那是硬上限，这是**体感**上限：
        // 让模型在被硬截断之前就先拿到「这东西有多大、里面有什么」，
        // 它才知道该去读哪一块，而不是对着一截断掉的 JSON 猜
        const ST_CODE_BRIEF_CHARS = 3000;
        // 三种状态。枚举放一处 —— 工具校验和界面渲染都用它，
        // 分成两份写的那天一定会出现「工具收了但界面认不出来」
        const ST_CODE_TASK_ST = [
            { id: 'pending', ico: '○' },
            { id: 'doing',   ico: '◐' },
            { id: 'done',    ico: '●' }
        ];

        // 思维强度：只改 system 里那段「怎么做」的措辞和步数上限。
        // ⚠ **不去动 temperature** —— 同一件事换个强度就换个写法，那不叫强度，叫随机
        const ST_CODE_THINK = [
            { id: 'off',  ico: '⚡', label: '关', steps: 4,
              tip: '能一次做完就别分两步，不用反复核对' },
            { id: 'low',  ico: '🌤', label: '低', steps: 8,
              tip: '先看一眼卡再动手，别铺开' },
            { id: 'mid',  ico: '🧠', label: '中', steps: 12,
              tip: '先读卡、再改、改完自己复核一遍' },
            { id: 'high', ico: '🔬', label: '高', steps: 20,
              tip: '每一步都先取证，改完必复核，必要时对照检查' }
        ];

        // 允许模型写的文本字段 —— **白名单**。放它自由写路径，等于给它一个
        // 「把 card 整个写成字符串」的机会（stSet 只写标量叶子，写坏了整块都没了）
        const ST_CODE_TEXT_PATHS = [
            'name', 'nickname', 'description', 'personality', 'scenario',
            'mesExample', 'systemPrompt', 'postHistoryInstructions', 'depthPrompt',
            'creator', 'characterVersion', 'creatorNotes',
            'firstMes', 'bookName', 'bookDescription'
        ];

        const ST_CODE_LIST_PATHS = ['tags', 'source', 'alternateGreetings', 'groupOnlyGreetings'];

        // 「这个字段确实在卡里，但 read_card / write_text 够不着 —— 该走哪个工具」。
        // ⚠ 加这张表是因为原来那句提示是**假话**：模型问 regex，回它「卡里没有这个字段」，
        //   它就会得出「这张卡没有正则」的结论，然后压根不去动 —— 而卡里明明有一堆。
        //   报错信息说错话比不报错更坏：它会让人**放弃**。
        const ST_CODE_PATH_HINT = {
            regex: '用 read_regex（不带 id 给清单，带 id 给那一条的全文）',
            thScripts: '用 read_th（同上）',
            statusBar: '用 read_doc({kind:"statusbar"})，改它用 write_doc',
            mvu: '用 read_doc({kind:"mvu"})，改它用 write_doc',
            extensions: '这个字段（卡的其他扩展数据）暂时读写都不支持'
        };

        let stCode = {
            // —— 运行时（一律不进 localStorage）——
            running: false,
            abort: null,
            err: '',
            step: 0,
            trash: [],          // 被删掉的世界书条目，能撤回来
            flashTimer: null,   // 「已复制」这类一句话反馈的定时器
            // ⚠ skillUrl 必须活在状态里：stCodeRepaint() 会重建整个 pane，
            //   只放在 <input> 的 value 里的话，一次重画（导入中、flash、别的面板动作）
            //   就把用户刚贴的地址抹掉了。但它**不持久化** —— 地址里可能带着
            //   私有仓库的 token 之类的东西，没必要留在磁盘上
            skillUrl: '',
            skillBusy: false,   // 正在取链接
            skillErr: '',       // 导入失败的原因。⚠ 显示在 skill 面板里，不借 stCode.err ——
            skillMsg: '',       //   那个只在会话为空时才看得见，有消息时就静默丢了
            // skill 自己报的进度（host.progress）。**只活在这一次 run 里** ——
            // 不进 localStorage、不写进会话消息。理由：它是「此刻在做什么」，
            // 一秒钟后就过时了，存下来只会让历史会话里全是没用的进度气泡
            // ⚠ 带 `id` 是为了防串台：一条晚到的进度不该显示成另一次 run 的
            prog: null,         // { id, text } | null
            // —— 持久化到 stCodeUi ——
            think: 'mid',
            view: 'card',       // 窄屏看哪一栏：card | agent
            open: {},           // 四个折叠菜单的展开状态
            autoApply: true,    // 工具是否真的落卡（关掉 = 只演示不写）
            // ⚠ **默认 false**：Code 页原先**没有**「第一段」，这是用户明确要求的
            //   （「不受『第一段』影响」）。加开关不能改变老行为 —— 默认关掉，
            //   想用的人自己打开。打开后发出去的是：第一段 → system → 会话。
            useFirstSeg: false,
            // —— 持久化到 stCodeSkills ——
            skills: [],
            // —— 持久化到 stCodeMemo ——
            // 项目记忆：用户写的长期要求（也允许模型用 remember 追加）。
            // ⚠ 和 skill / 会话一样**不进角色卡** —— 它是这个工具的使用习惯，不是卡的内容
            memo: '',
            // —— 持久化到 stCodeSessions ——
            sessionId: '',
            sessions: []
        };

        // 输入框里的草稿。**不进 localStorage** —— 它是「这次还没发出去的话」，
        // 刷新之后还留着反而奇怪
        let stCodeDraft = '';

        function stCodeThink() {
            const id = String(stCode.think || '');
            return ST_CODE_THINK.filter(t => t.id === id)[0] || ST_CODE_THINK[2];
        }

        function stCodeSaveUi() {
            try {
                localStorage.setItem(ST_CODE_UI_KEY, JSON.stringify({
                    think: stCode.think,
                    view: stCode.view,
                    open: stCode.open,
                    autoApply: stCode.autoApply,
                    useFirstSeg: stCode.useFirstSeg,
                    sessionId: stCode.sessionId
                }));
                return true;
            } catch (e) { return false; }
        }

        function stCodeSaveSessions() {
            try {
                const list = stCode.sessions.map(s => ({
                    id: s.id,
                    title: s.title,
                    ts: s.ts,
                    msgs: s.msgs.slice(-ST_CODE_MAX_MSGS),
                    // 任务清单和「本会话自动加载过的 skill」跟着会话走 ——
                    // 刷新之后计划还在，用户不会觉得「刚才列的单子没了」
                    tasks: (Array.isArray(s.tasks) ? s.tasks : []).slice(0, ST_CODE_TASKS_MAX),
                    autoSkills: (Array.isArray(s.autoSkills) ? s.autoSkills : []).slice(0, 64)
                }));
                localStorage.setItem(ST_CODE_SESS_KEY, JSON.stringify({ v: 1, list: list }));
                return true;
            } catch (e) {
                // 多半是配额满了（会话很长）。把最老的砍掉一半再试一次
                try {
                    stCode.sessions = stCode.sessions.slice(0, Math.max(1, Math.ceil(stCode.sessions.length / 2)));
                    localStorage.setItem(ST_CODE_SESS_KEY, JSON.stringify({ v: 1, list: stCode.sessions }));
                    return true;
                } catch (e2) { return false; }
            }
        }

