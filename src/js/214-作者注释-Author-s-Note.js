        // ===== 作者注释（Author's Note）=====
        // extension_prompt_types：ST 的 constants 里是 { NONE:-1, IN_PROMPT:0, IN_CHAT:1, BEFORE_PROMPT:2 }
        // authors-note.js 的默认值：position=1(IN_CHAT)、depth=4、role=SYSTEM、interval=1
        const AN_POS = { inPrompt: 0, inChat: 1, beforePrompt: 2 };
        const AN_POS_NAME = {
            0: '提示词内（角色定义之后）',
            1: '对话内（按深度插入）',
            2: '提示词之前（最前）'
        };
        const AN_DEFAULT_DEPTH = 4;
        const AN_DEFAULT_ROLE = 0;
        const AN_DEFAULT_INTERVAL = 1;
        const AN_LABEL = '作者注释';

        // ===== 用户人设描述（personaDescription）=====
        // ST personas.js:88 的 persona_description_positions。1 是废弃的 AFTER_CHAR
        // （等价于 IN_PROMPT），保留常量只为读得懂源码，界面上不给这个选项
        const PERSONA_POS = { inPrompt: 0, afterChar: 1, topAn: 2, bottomAn: 3, atDepth: 4, none: 9 };
        const PERSONA_POS_NAME = {
            0: '提示词内（按预设顺序）',
            2: '作者注释上方',
            3: '作者注释下方',
            4: '对话内（按深度插入）',
            9: '不插入（关闭）'
        };
        const PERSONA_POS_LIST = [0, 2, 3, 4, 9];   // 界面上能选的（不含废弃的 1）
        const PERSONA_DEFAULT_DEPTH = 2;            // personas.js DEFAULT_DEPTH
        const PERSONA_DEFAULT_ROLE = 0;             // personas.js DEFAULT_ROLE
        const PERSONA_LABEL = '用户人设描述';

