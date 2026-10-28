        // ===== 预制块 =====
        // 一个预制块 = 用块库里那 9 种块拼出来的**一整组**，点一下整组进画布。
        //   · 跟**版式模板**的区别：模板把画布整套换掉，预制块是往里加一段
        //   · 跟**块库**的区别：块库给的是单个原子块，预制块给「常一起出现的那几块」
        //   · 跟**用户预制块**的区别：下面这批是产品给的，用户自己攒的在
        //     stSbUserPrefabs() 那份里（存 localStorage）
        //
        // ⚠ 预制块里的变量路径**尽量自动绑到卡里已有的变量**（见 stSbPrefabBind）：
        //   绑不上就写兜底路径。作者还没建变量时，块先摆好、路径先填好，回头在 MVU 页
        //   建一个同名的就通了。这是刻意的 —— 宁可给一条「看着对、还没生效」的路径，
        //   也不要给一块「未选变量」，后者用户根本不知道该往里填什么
        const ST_SB_PREFAB_CATS = ['生命与属性', '物品与经济', '关系', '世界与剧情', '通用'];

        const ST_SB_PREFABS = [
            // —— 生命与属性 ——
            {
                id: 'hp', icon: '❤', name: '生命值', cat: '生命与属性',
                hint: '一条红色进度条，数值跟在右边。变量优先绑「生命值 / 生命 / HP / 血量」。',
                build: v => [v.blk('bar',
                    v.bind(['生命值', '生命', 'hp', '血量'], 'stat_data.生命值',
                        { num: true, label: '生命值', min: 0, max: 100 }),
                    { color: '#e5484d', height: 9, bold: true })]
            },
            {
                id: 'hpmp', icon: '💠', name: '生命 + 魔力', cat: '生命与属性',
                hint: '两条进度条上下排：生命值（红）+ 魔力 / MP（蓝）。',
                build: v => [
                    v.blk('bar', v.bind(['生命值', '生命', 'hp', '血量'], 'stat_data.生命值',
                        { num: true, label: '生命值', min: 0, max: 100 }),
                        { color: '#e5484d', height: 8 }),
                    v.blk('bar', v.bind(['魔力', 'mp', '法力', '魔法'], 'stat_data.魔力',
                        { num: true, label: '魔力', min: 0, max: 100 }),
                        { color: '#3b7dd8', height: 8 })
                ]
            },
            {
                id: 'attr3', icon: '📊', name: '三项属性', cat: '生命与属性',
                hint: '力量 / 敏捷 / 智力 三条进度条。默认路径就是这三个名字，改成自己的即可。',
                build: v => [v.blk('title', null, { text: '属性', size: 13 })].concat(
                    ['力量', '敏捷', '智力'].map(k => v.blk('bar',
                        v.bind([k], 'stat_data.' + k, { num: true, label: k, min: 0, max: 100 }),
                        { color: '#79aed2', height: 7, size: 12 })))
            },
            {
                id: 'level', icon: '⭐', name: '等级与经验', cat: '生命与属性',
                hint: '一行两列：等级（数值）+ 经验（进度条）。',
                build: v => [v.row([
                    v.blk('var', v.bind(['等级', 'lv', 'level'], 'stat_data.等级',
                        { num: true, label: '等级' }), { size: 13, bold: true }),
                    v.blk('bar', v.bind(['经验', 'exp', '熟练'], 'stat_data.经验',
                        { num: true, label: '经验', min: 0, max: 100 }), { height: 7, size: 12 })
                ], 10)]
            },

            // —— 物品与经济 ——
            {
                id: 'bag', icon: '🎒', name: '物品栏', cat: '物品与经济',
                hint: '小标题 + 一整串物品（背包 / 物品栏那种变量整串显示）。',
                build: v => [
                    v.blk('title', null, { text: '🎒 物品栏', size: 13 }),
                    v.blk('var', v.bind(['背包', '物品', '道具', 'inventory', 'bag'],
                        'stat_data.背包', { label: '持有' }), { size: 12 })
                ]
            },
            {
                id: 'bagslots', icon: '🎒', name: '物品栏（三格）', cat: '物品与经济',
                hint: '一行三格，每格一件物品。默认路径是 stat_data.背包.物品1…，按自己的变量改。',
                build: v => [
                    v.blk('title', null, { text: '🎒 物品栏', size: 13 }),
                    v.row(['物品1', '物品2', '物品3'].map(k => v.blk('var',
                        v.bind([k], 'stat_data.背包.' + k, { label: k }), { size: 12 })), 8)
                ]
            },
            {
                id: 'money', icon: '🪙', name: '金钱与阶段', cat: '物品与经济',
                hint: '一行两列：金钱（金色加粗）+ 好感阶段。',
                build: v => [v.row([
                    v.blk('var', v.bind(['金钱', '金币', '货币', 'gold', 'money'],
                        'stat_data.金钱', { num: true, label: '金钱' }),
                        { color: '#d9a441', bold: true, size: 13 }),
                    v.blk('var', v.bind(['阶段', '关系'], 'stat_data.好感阶段', { label: '阶段' }),
                        { size: 12 })
                ], 10)]
            },

            // —— 关系 ——
            {
                id: 'affdots', icon: '💗', name: '好感度（星级）', cat: '关系',
                hint: '五星圆点。变量优先绑「好感度 / 好感 / 亲密度」。',
                build: v => [v.blk('dots',
                    v.bind(['好感度', '好感', '亲密度', 'affection'], 'stat_data.好感度',
                        { num: true, label: '好感度', min: 0, max: 5 }),
                    { count: 5, color: '#e8749b', size: 14 })]
            },
            {
                id: 'affbar', icon: '💗', name: '好感度（进度条）', cat: '关系',
                hint: '0~100 的粉色进度条。',
                build: v => [v.blk('bar',
                    v.bind(['好感度', '好感', '亲密度', 'affection'], 'stat_data.好感度',
                        { num: true, label: '好感度', min: 0, max: 100 }),
                    { color: '#e8749b', height: 8, bold: true })]
            },
            {
                id: 'affcard', icon: '💗', name: '好感度（完整）', cat: '关系',
                hint: '小标题 + 星级 + 阶段 —— 单个 NPC 的一张「关系卡」。',
                build: v => [
                    v.blk('title', null, { text: '💗 好感度', size: 13 }),
                    v.blk('dots', v.bind(['好感度', '好感', '亲密度'], 'stat_data.好感度',
                        { num: true, label: '好感度', min: 0, max: 5 }),
                        { count: 5, color: '#e8749b' }),
                    v.blk('var', v.bind(['阶段', '关系'], 'stat_data.好感阶段', { label: '阶段' }),
                        { size: 12 })
                ]
            },
            {
                id: 'affmany', icon: '💞', name: '好感度（多人 · 竖排）', cat: '关系',
                hint: '三个 NPC 各一行星级。卡里若有多个「好感度.角色名」变量，会自动按顺序绑上去。',
                build: v => {
                    const b = v.many(['好感度', '好感', '亲密度'],
                        ['stat_data.好感度.角色A', 'stat_data.好感度.角色B', 'stat_data.好感度.角色C'],
                        { num: true, min: 0, max: 5 });
                    return [v.blk('title', null, { text: '💞 好感度', size: 13 })].concat(
                        b.map(x => v.blk('dots', x,
                            { count: 5, color: '#e8749b', size: 13 })));
                }
            },
            {
                id: 'affmanyrow', icon: '📋', name: '好感度（多人 · 横排）', cat: '关系',
                hint: '三个 NPC 挤在一行里，只显示数值，适合人多的卡。',
                build: v => {
                    const b = v.many(['好感度', '好感', '亲密度'],
                        ['stat_data.好感度.角色A', 'stat_data.好感度.角色B', 'stat_data.好感度.角色C'],
                        { num: true, min: 0, max: 100 });
                    return [v.row(b.map(x => v.blk('var', x,
                        { size: 12, align: 'center' })), 6)];
                }
            },

            // —— 世界与剧情 ——
            {
                id: 'world', icon: '🌍', name: '时间与地点', cat: '世界与剧情',
                hint: '一行两列：当前时间 + 当前地点。',
                build: v => [v.row([
                    v.blk('var', v.bind(['时间', '日期', 'time'], 'stat_data.世界.当前时间',
                        { label: '时间' }), { size: 12 }),
                    v.blk('var', v.bind(['地点', '位置', '场所', 'location'],
                        'stat_data.世界.当前地点', { label: '地点' }), { size: 12 })
                ], 8)]
            },
            {
                id: 'hero', icon: '🧑', name: '主角状态', cat: '世界与剧情',
                hint: '一行两列：主角姓名 + 当前状态。',
                build: v => [v.row([
                    v.blk('var', v.bind(['姓名', '名字', 'name'], 'stat_data.主角.姓名',
                        { label: '名字' }), { size: 12 }),
                    v.blk('var', v.bind(['状态', 'status'], 'stat_data.主角.状态',
                        { label: '状态' }), { size: 12 })
                ], 8)]
            },

            // —— 通用 ——
            {
                id: 'head', icon: '🅣', name: '标题 + 分割线', cat: '通用',
                hint: '一个小标题加一条分割线，常用来给状态栏开场。',
                build: v => [
                    v.blk('title', null, { text: '状态', size: 14, bold: true }),
                    v.blk('divider', null, {})
                ]
            },
            {
                id: 'kvrow', icon: '⬓', name: '两列数值', cat: '通用',
                hint: '自动挑两个还没用过的变量，并排放一行。挑不到就在属性面板里自己选。',
                build: v => [v.row([
                    v.blk('var', v.free(false, ''), { size: 12 }),
                    v.blk('var', v.free(false, ''), { size: 12 })
                ], 8)]
            }
        ];

