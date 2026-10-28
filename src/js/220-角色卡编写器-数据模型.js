        // ==========================================================================
        // 角色卡编写器：数据模型
        //   编辑器的草稿结构和 ST 的卡 JSON 不是一回事 —— 这里用扁平 camelCase，
        //   导出时再按规格拼成 V1 / V2 / V3（见 stCardToStJson）。
        //   「导入 → 改写 → 导出」想尽量无损，所以导入时会把原始 JSON 整个留着
        //   （stEditor.raw），导出时把本编辑器不认识的 extensions 字段原样带回去。
        // ==========================================================================

        const ST_SPEC_LIST = ['v1', 'v2', 'v3'];
        const ST_SPEC_LABEL = {
            v1: 'V1（老式扁平卡）',
            v2: 'V2（chara_card_v2）',
            v3: 'V3（chara_card_v3）'
        };
        const ST_SPEC_DESC = {
            v1: '最老的一版，只有 name / description / personality / scenario / first_mes / ' +
                'mes_example 这几个扁平字段。装不下世界书、正则、备选开场白 —— 选了 V1 这些会丢，' +
                '导出前会提醒。',
            v2: '目前最通用的版本。在 V1 之上加了 creator / tags / creator_notes / system_prompt / ' +
                'post_history_instructions / alternate_greetings，以及内置世界书 character_book。',
            v3: '在 V2 上继续加：nickname / source / group_only_greetings / creation_date / ' +
                'modification_date / assets，世界书条目多了必填的 use_regex 字段。'
        };

        // ST 的 regex_placement（constants.js）。
        // 0 是「只在界面显示」，卡里一般不用，界面上不给这个选项
        const ST_REGEX_PLACEMENT = {
            1: '用户输入', 2: 'AI 输出', 3: '斜杠命令', 4: '世界书', 5: '思维链'
        };
        const ST_REGEX_PLACEMENT_ORDER = [1, 2, 3, 4, 5];

        const ST_DRAFT_KEY = 'stCardDraft';
        const ST_AVATAR_KEY = 'stCardAvatar';
        // 头像的 data URL 动辄几百 KB，超过这个大小就不往 localStorage 里塞了
        const ST_AVATAR_MAX = 900 * 1024;
        // 草稿里带上原始 JSON 的上限 —— 大卡就不带，免得把 localStorage 顶爆
        const ST_RAW_KEEP_MAX = 200 * 1024;
        // 原始 tavern_helper 单独一份上限。它跟 raw 是重叠的（raw 里本来就含它），
        // 所以给得比 raw 小一档，免得两个都带上时把草稿撑成两倍
        const ST_TH_RAW_KEEP_MAX = 100 * 1024;

        const ST_PLACEHOLDER_W = 400;
        const ST_PLACEHOLDER_H = 600;

        function stUuid() {
            try {
                if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
                    return crypto.randomUUID();
                }
            } catch (e) {}
            return 'st-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
        }

        // 一条空的世界书条目。直接借扫描器那套 normalize，
        // 保证编辑器里造出来的条目和导入进来的条目是同一个形状。
        // 故意不走 finalizeLoreEntry —— 那一步会把正文开头的 @@ 装饰器剥进
        // decorators 字段，编辑器里就看不见也改不动了
        function stBlankEntry() {
            const e = normalizeLoreEntry({}, 0);
            e.id = stUuid();
            e.useRegex = false;
            return e;
        }

        function stBlankRegex() {
            return {
                id: stUuid(),
                scriptName: '',
                findRegex: '',
                replaceString: '',
                trimStrings: [],
                // ST 新建脚本的默认值就是「用户输入 + AI 输出」两个都管
                placement: [1, 2],
                disabled: false,
                markdownOnly: false,
                promptOnly: false,
                runOnEdit: false,
                substituteRegex: 0,
                minDepth: null,
                maxDepth: null
            };
        }

