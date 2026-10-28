        // ==========================================================================
        // 酒馆模式（SillyTavern 角色卡 + 世界书）
        //   · 角色卡：PNG（chara / ccv3 数据块）与 JSON（V1 / V2 / V3）
        //   · 世界书：卡内 character_book，或单独导入的世界书 JSON
        //   · 世界书条目按 SillyTavern 的「插入位置」与「深度」语义拼进提示词
        // ==========================================================================

        // SillyTavern 的 world_info_position
        // 位置枚举与 SillyTavern 的 world_info_position 完全一致
        const WI_POS = {
            beforeChar: 0, afterChar: 1, anTop: 2, anBottom: 3,
            atDepth: 4, emTop: 5, emBottom: 6, outlet: 7
        };
        const WI_POS_LABEL = {
            0: '↑Char', 1: '↓Char', 2: '↑AT', 3: '↓AT',
            4: '@D', 5: '↑EM', 6: '↓EM', 7: 'Outlet'
        };
        const WI_POS_NAME = {
            0: '角色定义之前', 1: '角色定义之后', 2: '作者注释之前', 3: '作者注释之后',
            4: '按深度插入对话', 5: '示例对话之前', 6: '示例对话之后', 7: '出口（需插件，不插入）'
        };
        // 和 ST 条目编辑器里的下拉同一个顺序（就是 world_info_position 枚举顺序）
        const WI_POS_ORDER = [0, 1, 2, 3, 4, 5, 6, 7];
        const WI_ROLE = { 0: 'system', 1: 'user', 2: 'assistant' };
        const WI_ROLE_LABEL = { 0: '系统', 1: '用户', 2: 'AI' };
        const WI_SELECTIVE_LOGIC = { 0: '任一命中', 1: '并非全部命中', 2: '全部不命中', 3: '全部命中' };

