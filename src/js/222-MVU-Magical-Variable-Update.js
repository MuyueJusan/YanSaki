        // ===== MVU（Magical Variable Update）=====
        // 酒馆助手的变量框架，本体是 MagicalAstrogy/MagVarUpdate。
        // 一张卡要跑起来 MVU，需要 7 类组件（对着 MVU Maker 的 docs/03 核过）：
        //   ① MVU 脚本       extensions.tavern_helper.scripts 里一条 import bundle
        //   ② Zod 脚本       同上，registerMvuSchema(Schema)
        //   ③ [InitVar] 条目  世界书，**必须 disabled**（MVU 只读禁用状态的 initvar）
        //   ④ 变量列表        世界书，@D depth 0
        //   ⑤ 更新规则        世界书，@D depth 0
        //   ⑥ 输出格式        世界书，@D depth 4
        //   ⑦ 状态栏占位符    first_mes 末尾的 <StatusPlaceHolderImpl/>
        //   另有正则五件套：隐藏变量更新 / 更新中 / 更新美化 / 隐藏状态栏 / 状态栏界面
        //
        // 本编辑器只负责**写进卡里**，不执行任何脚本。
        //
        // 「像编辑 PPT 一样」的落点：变量结构用左侧大纲 + 右侧检查器编辑，
        // Zod 代码 / initvar YAML / 更新规则 YAML 三份产物全部由结构生成，
        // 结构一改就自动重写，用户不用碰代码
        const ST_MVU_SCRIPT_URL =
            'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js';
        const ST_MVU_ZOD_URL =
            'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';
        const ST_MVU_PLACEHOLDER = '<StatusPlaceHolderImpl/>';
        const ST_MVU_SCRIPT_NAME = 'MVU';
        const ST_MVU_ZOD_NAME = 'Zod';
        const ST_MVU_INITVAR = '[InitVar]请勿打开';
        const ST_MVU_VARLIST = '变量列表';
        const ST_MVU_RULES = '[mvu_update]变量更新规则';
        const ST_MVU_FORMAT = '[mvu_update]变量输出格式';
        // 用来认「变量更新」那几条正则
        const ST_MVU_RX_TAG = /<update(?:variable)?>/i;

        // 七种字段类型。record 是「动态键」，object 是「固定字段」——
        // 背包 / 称号 / 关系表用 record，人物档案 / 装备栏用 object
        const ST_MVU_TYPES = ['string', 'number', 'boolean', 'enum', 'object', 'record', 'union'];
        const ST_MVU_TYPE_LABEL = {
            string: '文本', number: '数值', boolean: '开关', enum: '枚举',
            object: '分组', record: '动态表', union: '多选一'
        };
        const ST_MVU_TYPE_ICON = {
            string: '🔵', number: '🟢', boolean: '🟡', enum: '🟣',
            object: '🟠', record: '🟠', union: '🔷'
        };
        const ST_MVU_TYPE_HINT = {
            string: '名字、状态、描述这类任意文本',
            number: '好感度、HP 这类数字，可以设范围钳制',
            boolean: '觉醒、中毒这类开 / 关',
            enum: '固定几个取值（属性：火 / 水 / 雷）',
            object: '字段固定的分组（人物档案、装备栏）',
            record: '键是动态的（背包、称号表、NPC 列表）—— 键由剧情产生',
            union: '值可能是几种类型之一'
        };
        // 能装子字段的类型
        const ST_MVU_CONTAINER = ['object', 'record', 'union'];

        function stBlankMvuNode(type) {
            return {
                id: stUuid(),
                name: '',
                type: ST_MVU_TYPES.indexOf(type) >= 0 ? type : 'string',
                desc: '',        // → .describe()
                value: '',       // 默认值（标量用，容器不用）
                int: false,      // 数值：整数
                min: null,       // 数值：钳制下限（可以为负）
                max: null,       // 数值：钳制上限
                options: [],     // 枚举：可选值
                children: []
            };
        }

        function stBlankMvu() {
            return { nodes: [] };
        }

        function stMvuNodeFromRaw(raw) {
            const n = stBlankMvuNode();
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return n;
            n.id = stStr(raw.id) || n.id;
            n.name = stStr(raw.name);
            n.type = ST_MVU_TYPES.indexOf(stStr(raw.type)) >= 0 ? stStr(raw.type) : 'string';
            n.desc = stStr(raw.desc);
            n.value = stStr(raw.value);
            n.int = raw.int === true;
            // 范围可以为负，所以不能套 ST_NULLABLE_NUM 那套「夹到 >= 0」
            const num = v => (v === null || v === undefined || v === '' ||
                !Number.isFinite(Number(v))) ? null : Math.trunc(Number(v));
            n.min = num(raw.min);
            n.max = num(raw.max);
            n.options = stStrList(raw.options).filter(o => o !== '');
            n.children = Array.isArray(raw.children)
                ? raw.children.map(stMvuNodeFromRaw) : [];
            return n;
        }

        function stMvuNormalize(raw) {
            const m = stBlankMvu();
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return m;
            m.nodes = Array.isArray(raw.nodes) ? raw.nodes.map(stMvuNodeFromRaw) : [];
            return m;
        }

