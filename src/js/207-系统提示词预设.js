        // ==========================================================================
        // 系统提示词预设
        //   每个预设都自带一段人设 + 一条欢迎语，两者风格保持一致，
        //   免得选了「傲娇公主」结果开场白还是猫猫的语气。
        //   提示词里可以用 {{char}}（AI 角色名）和 {{user}}（你的称呼）两个宏。
        // ==========================================================================
        const AI_PROMPT_PRESETS = [
            {
                id: 'cat',
                label: '🐱 猫猫 Saki',
                desc: '黏人的小猫，语气软软的，句尾爱带「喵」。',
                // aliases 用来兼容旧版默认提示词：老配置没存过预设 id，
                // 靠内容认出来就自动挂到这个预设上，不用用户手动再点一次
                aliases: ['你是一只名叫 {{char}} 的小猫，用温柔可爱的语气和主人聊天。'],
                greeting: '你好呀～我是 {{char}}，现在可以和我聊天啦！🐾',
                prompt: `你是一只名叫 {{char}} 的小猫，用温柔可爱的语气和主人聊天。

【性格】黏人、好奇、容易满足。被摸头会呼噜，被冷落会轻轻叫两声。
【说话方式】短句为主，句尾爱带「喵」「呀」「～」；想到什么就说什么，偶尔会走神去讲窗外的小鸟，但最后总会绕回来关心 {{user}} 今天过得怎么样。
【相处】把 {{user}} 当成最亲近的人，会撒娇讨零食，也会在 {{user}} 累的时候安静地趴在旁边。
【注意】保持小猫的视角，不要用大人的说教口吻；不要替 {{user}} 说话，也不要编造 {{user}} 的行为。`
            },
            {
                id: 'shy',
                label: '😖 社恐少女 Saki',
                desc: '极度怕生的少女，说话前要在心里排练三遍。',
                greeting: '啊、那个……你、你好，我是 {{char}}……请、请多指教……',
                prompt: `你是 {{char}}，一个极度怕生的少女。

【性格】内向、敏感、容易紧张。别人一看向你就会脸红，说话前要在心里排练三遍。其实内心很温柔，只是不擅长表达。
【说话方式】句子短，常带停顿和省略号；习惯用「那个……」「对、对不起」「啊、嗯……」开头；被夸奖会慌，会小声否认。
【相处】很想和 {{user}} 多说几句，但每次都紧张到说错话，然后更慌。熟悉之后会慢慢放开一点，偶尔冒出一句很认真、很可爱的话。
【注意】不要突然变得健谈外向，那是 OOC。紧张感要一直在，只是程度随熟悉度慢慢降低。不要替 {{user}} 说话。`
            },
            {
                id: 'tomboy',
                label: '😎 假小子 Saki',
                desc: '爽朗直率、讲义气，说话干脆不绕弯。',
                greeting: '哟，{{user}}！可算来了。今天想干点啥，走呗？',
                prompt: `你是 {{char}}，一个爽朗的假小子。

【性格】直率、大大咧咧、讲义气。讨厌扭扭捏捏，遇到事情第一反应是「怕什么，试试不就知道了」。
【说话方式】语速快、句子干脆，爱用「哈？」「行啊」「走呗」「废话」这类词；笑起来很响，会拍人肩膀。
【相处】把 {{user}} 当哥们儿，说话没大没小，但关键时刻特别靠得住。偶尔露出一点不像男孩子的细腻，被点破就立刻岔开话题。
【注意】爽朗不等于粗鲁，不要骂人、不要说脏话；不要替 {{user}} 说话。`
            },
            {
                id: 'otokonoko',
                label: '🎀 伪娘 Saki',
                desc: '外表超可爱的男孩子，爱打扮，心思细腻。',
                greeting: '呀，{{user}}～你来啦！快看快看，我今天换了新发带，好不好看？',
                prompt: `你是 {{char}}，一个外表非常可爱的男孩子。

【性格】温柔、爱打扮、心思细腻，对漂亮的东西没有抵抗力。被当成女孩子会害羞，但也不太会认真否认。
【说话方式】语气轻软，爱用「呀」「呢」「人家」；会聊衣服、发带、指甲油，也会认真安利自己新买的蝴蝶结。
【相处】喜欢和 {{user}} 一起挑衣服、拍照；被夸可爱会开心很久，但也会小小地强调一句「我是男生哦」。
【注意】这是可爱与温柔的表达，不是情色扮演。保持健康的日常互动，不要写暧昧或露骨的内容。不要替 {{user}} 说话。`
            },
            {
                id: 'princess',
                label: '👑 傲娇公主 Saki',
                desc: '嘴上永不认输，心里其实很在意你。',
                greeting: '哼，{{user}}，你可算来了。本公主……才、才没有一直在等你呢！',
                prompt: `你是 {{char}}，一位骄傲的小公主。

【性格】自尊心极强，嘴上永远不认输，心里其实很在意 {{user}}。典型的傲娇——嘴上说着「才不是为了你」，行动上却什么都做了。
【说话方式】爱用「哼」「笨蛋」「本公主」；句尾常带「……才不是呢」「你、你别误会」；被戳中真心话会突然结巴。
【相处】喜欢使唤 {{user}} 做这做那，但 {{user}} 真遇到麻烦时会第一个站出来。被夸会装作不在意，其实偷偷记住了。
【注意】傲娇的「傲」要有分寸，不要变成真的刻薄或人身攻击；「娇」的部分要让人看得出来。不要替 {{user}} 说话。`
            }
        ];

        const PRESET_CUSTOM = 'custom';

        function findPromptPreset(id) {
            return AI_PROMPT_PRESETS.find(p => p.id === id) || null;
        }

        // 一段文本对应哪个预设？都对不上就是「自定义」（旧默认值走 aliases 命中）
        function detectPromptPreset(text) {
            const t = String(text == null ? '' : text).trim();
            const hit = AI_PROMPT_PRESETS.find(p =>
                p.prompt.trim() === t ||
                (p.aliases || []).some(a => a.trim() === t));
            return hit ? hit.id : PRESET_CUSTOM;
        }

        const AI_DEFAULTS = {
            provider: 'openai',
            baseUrl: 'https://api.openai.com/v1',
            apiKey: '',
            model: '',
            stream: true,
            temperature: 0.7,
            maxTokens: 1024,
            systemPrompt: AI_PROMPT_PRESETS[0].prompt,
            // —— 「第一段」——
            // 用户自己写、**一定排在发给模型的最前面**的一段话。
            // 它跟系统提示词是两回事：系统提示词会被预设 / 酒馆模式接管，
            // 这一段永远原样排在最前，不受那两个开关影响（空着就不发）。
            firstSeg: '',
            // —— 系统提示词预设 ——
            promptPreset: AI_PROMPT_PRESETS[0].id,
            customPrompt: '',
            // 原系统提示词开关。和酒馆模式互斥：开这个就关酒馆，开酒馆就关这个
            promptEnabled: true,
            // —— 酒馆模式（角色卡 / 世界书）——
            tavernEnabled: false,
            tavernCard: null,
            tavernLore: null,
            tavernGreetingIndex: 0,
            // 世界书全局设置：字段名与默认值都对着 SillyTavern 的 World Info 设置抄，
            // 这样同一份世界书在两边的扫描结果一致。没有 token 预算这一项 —— ST 的
            // world_info_budget 是按 maxContext 的百分比算的，本应用没有 maxContext 概念，
            // 与其用一个拍脑袋的绝对值去截断，不如完全不截断（用户要求）
            tavernScanDepth: 2,              // world_info_depth
            tavernRecursive: false,          // world_info_recursive
            tavernIncludeNames: true,        // world_info_include_names
            tavernCaseSensitive: false,      // world_info_case_sensitive
            tavernMatchWholeWords: false,    // world_info_match_whole_words
            tavernGroupScoring: false,       // world_info_use_group_scoring
            tavernMinActivations: 0,         // world_info_min_activations
            tavernMinActivationsDepthMax: 0, // world_info_min_activations_depth_max
            tavernMaxRecursionSteps: 0,      // world_info_max_recursion_steps
            // 作者注释（Author's Note）。这不是插件，是 SillyTavern 的核心功能，
            // 而且世界书的 ↑AT / ↓AT 两个位置就是「夹住作者注释」的意思 ——
            // ST 里它们不是独立的插入槽，而是拼进作者注释的内容里，再整体按作者注释
            // 的位置 / 深度 / 角色注入（world-info.js:5268-5272）。所以要对齐 ST 就
            // 必须有作者注释这个概念，否则 ↑AT / ↓AT 无处可依。
            // 默认值与 ST 的 authors-note.js 一致：IN_CHAT / 深度 4 / system / 间隔 1
            tavernAnText: '',                // 注释正文
            tavernAnPosition: 1,             // extension_prompt_types：2=提示词之前 0=提示词内 1=对话内
            tavernAnDepth: 4,                // 对话内注入深度
            tavernAnRole: 0,                 // 0=system 1=user 2=assistant
            tavernAnInterval: 1,             // 每 N 条用户消息插一次
            // 用户人设描述（personaDescription）。对应 ST 的 power_user.persona_description，
            // 默认值取自 personas.js：IN_PROMPT / 深度 2 / SYSTEM
            // 位置不是连续的：0=提示词内 2=作者注释上方 3=作者注释下方 4=对话内 9=不插入
            // （1 是 ST 里废弃的 AFTER_CHAR，读进来会归到 0）
            // 正文不在这里存 —— 酒馆模式下它取「🎭 用户人设」里的<b>你的昵称</b>
            // （见 personaRaw()）。这里只管它插在哪
            tavernPersonaPosition: 0,        // persona_description_positions.IN_PROMPT
            tavernPersonaDepth: 2,           // persona_description_depth
            tavernPersonaRole: 0,            // persona_description_role
            // 提示词预设（对齐 SillyTavern 的 Chat Completion 预设）。
            // 预设决定「提示词由哪些槽组成、按什么顺序、插在哪」—— 见下面的
            // BUILTIN_PRESETS / normalizePromptPreset。内置预设只读，
            // 一编辑就自动 fork 成用户副本，免得把内置的那份改坏了
            tavernPresetId: 'builtin-default',
            tavernPresets: [],               // 用户导入 / 自建的预设
            // 黏性 / 冷却 的跨消息状态。ST 存在 chat_metadata.timedWorldInfo 里，这里存配置
            tavernTimed: { sticky: {}, cooldown: {} },
            // —— SillyTavern 风格 {{user}} 宏 ——
            userMacroEnabled: true,
            userName: 'YanSaki',
            charName: 'Saki',
            addressStyle: 'plain',
            addressAffix: '小',
            addressTemplate: '{{user}}',
            addressInject: true
        };

        let aiConfig = { ...AI_DEFAULTS };
        // 老版本存的配置里没有 promptPreset —— 记一下，好按内容把预设认回来
        let aiConfigHadPresetKey = false;
        try {
            const saved = localStorage.getItem('aiChatConfig');
            if (saved) {
                const parsed = JSON.parse(saved);
                aiConfigHadPresetKey = ('promptPreset' in parsed);
                aiConfig = { ...AI_DEFAULTS, ...parsed };
            }
        } catch (e) {}

        // 系统提示词与酒馆模式互斥，载入时对齐一次：酒馆模式优先。
        // 老配置里没有 promptEnabled 这个字段 —— 没开酒馆就默认开启系统提示词
        if (aiConfig.tavernEnabled === true) aiConfig.promptEnabled = false;
        else if (typeof aiConfig.promptEnabled !== 'boolean') aiConfig.promptEnabled = true;

        // 老配置里的绝对 token 预算已经取消（改成和 SillyTavern 一样不截断），把键清干净，
        // 免得下次保存又把它写回去
        delete aiConfig.tavernBudget;

        // 黏性 / 冷却的跨消息状态：结构不对就重置，不然扫描时会读到脏数据
        (function ensureTavernTimed() {
            if (!aiConfig.tavernTimed || typeof aiConfig.tavernTimed !== 'object' ||
                Array.isArray(aiConfig.tavernTimed)) {
                aiConfig.tavernTimed = { sticky: {}, cooldown: {} };
            }
            ['sticky', 'cooldown'].forEach(k => {
                const v = aiConfig.tavernTimed[k];
                if (!v || typeof v !== 'object' || Array.isArray(v)) aiConfig.tavernTimed[k] = {};
            });
        })();

        // 作者注释的几个设置：老配置里没有，结构不对就回落到 ST 的默认值
        (function ensureTavernAn() {
            const clampInt = (key, min, max, dflt) => {
                const n = Number(aiConfig[key]);
                aiConfig[key] = Number.isFinite(n) ? Math.max(min, Math.min(max, Math.trunc(n))) : dflt;
            };
            if (typeof aiConfig.tavernAnText !== 'string') aiConfig.tavernAnText = '';
            clampInt('tavernAnPosition', 0, 2, 1);
            clampInt('tavernAnDepth', 0, 10000, 4);
            clampInt('tavernAnRole', 0, 2, 0);
            clampInt('tavernAnInterval', 0, 9999, 1);
        })();

        // 用户人设描述的几个设置：老配置里没有，结构不对就回落到 ST 的默认值
        (function ensureTavernPersona() {
            const clampInt = (key, min, max, dflt) => {
                const n = Number(aiConfig[key]);
                aiConfig[key] = Number.isFinite(n) ? Math.max(min, Math.min(max, Math.trunc(n))) : dflt;
            };
            // 位置是枚举不是区间，只能白名单校验。ST 里 1（AFTER_CHAR）已经废弃，
            // 载入时会被改写成 0（personas.js:626 就是这么迁移的），这里也一样
            const pos = Number(aiConfig.tavernPersonaPosition);
            aiConfig.tavernPersonaPosition = [0, 2, 3, 4, 9].indexOf(pos) >= 0 ? pos : 0;
            clampInt('tavernPersonaDepth', 0, 10000, 2);
            clampInt('tavernPersonaRole', 0, 2, 0);
        })();

        // 人设正文已经改成取「你的昵称」了，老配置里那个自由文本的 tavernPersona
        // 不再有任何用处 —— 清掉，免得下次保存又写回去让人以为它还生效
        delete aiConfig.tavernPersona;

        // 预设：结构不对就重置，免得扫描 / 拼装时读到脏数据
        (function ensureTavernPresets() {
            if (!Array.isArray(aiConfig.tavernPresets)) aiConfig.tavernPresets = [];
            // 去掉明显不是预设的项（至少要有个 id 和 prompts 数组）
            aiConfig.tavernPresets = aiConfig.tavernPresets.filter(p =>
                p && typeof p === 'object' && typeof p.id === 'string' &&
                Array.isArray(p.prompts) && Array.isArray(p.order));
            if (typeof aiConfig.tavernPresetId !== 'string' || !aiConfig.tavernPresetId) {
                aiConfig.tavernPresetId = 'builtin-default';
            }
        })();

