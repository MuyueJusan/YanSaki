        // ===== MVU 状态栏（外观）=====
        // MVU 的「外观」= 聊天里那块状态栏。它在卡里就是**一条正则**：
        //   正则名「状态栏界面」（MVU 五件套里的 sbShow），findRegex 是
        //   <StatusPlaceHolderImpl/>，replaceString 就是那段 HTML。
        // 所以「编辑外观」= 可视化地搭一段 HTML，再写回那条正则的 replaceString。
        //
        // 三个硬约束（决定了生成器只能这么写）：
        //   ① 替换产物里**只走内联 style**。⚠ 理由**不是**「沙盒会剥掉 head 样式」——
        //      这条早先写在注释里，是错的、已推翻：只要代码在 ``` 围栏里且**同时有
        //      `<body>` 和 `</body>`**，酒馆助手就把它当**独立网页塞进 iframe**，
        //      `<style>` / `<script>` / 外链资源全都可用。之所以仍然内联，是因为
        //      **「尽可能按原样解析」要跟主题色 / 用户改色共存** —— 内联的优先级
        //      最直观，也不会被别的 `<style>` 规则意外盖掉。真要写 `<style>` 也不会坏。
        //   ② 变量要用酒馆助手宏取，显示时才会被替换成当前楼层的值。
        //      两个宏的区别很关键：
        //        {{format_message_variable::stat_data.好感度}} → 格式化后的值（给人看）
        //        {{get_message_variable::stat_data.好感度}}    → 一行 JSON（数字是裸的）
        //      进度条 / 圆点要**算数**，必须用 get_ 那个 —— format_ 会带上单位或格式，
        //      塞进 CSS 的 calc() 就是语法错误，整条声明会被浏览器丢掉
        //   ③ 路径里的键以 $ 开头的变量会被宏忽略（酒馆助手的特性），别拿它当显示源
        //
        // 结构存在哪？直接**编进那段 HTML 的注释里**（base64 —— 避免 JSON 里的
        // `-->` 把注释提前截断）。这样导出的 PNG / JSON 带着它转一圈回来还能接着编辑，
        // 而不是只剩一坨认不出结构的 HTML
        const ST_SB_MARK = 'MVU_STATUS_BAR';
        const ST_SB_BLOCKS = ['title', 'text', 'var', 'bar', 'dots', 'row', 'divider', 'space', 'html'];
        const ST_SB_BLOCK_LABEL = {
            title: '标题', text: '文字', var: '变量值', bar: '进度条', dots: '圆点',
            row: '一行多列', divider: '分割线', space: '间距', html: '高级 HTML'
        };
        const ST_SB_BLOCK_ICON = {
            title: '🅣', text: '🅰', var: '🔢', bar: '📊', dots: '◉',
            row: '⬓', divider: '─', space: '␣', html: '⌨'
        };
        const ST_SB_BLOCK_HINT = {
            title: '一条小标题，一般放在最上面。',
            text: '一段纯文字。可以插宏，例如「{{user}}」「{{char}}」。',
            var: '显示一个变量的值。左边是标签，右边是值。',
            bar: '把一个数值变量画成进度条。条宽按 (值 − 最小) / (最大 − 最小) 算。',
            dots: '把一个数值变量画成圆点（星级）。值 3 / 满 5 就点亮 3 个。',
            row: '把几个块并排放在一行，每列各占一份宽度。',
            divider: '一条横向分割线。',
            space: '一段空白，用来拉开间距。',
            html: '直接写 HTML —— 前面那些块拼不出来的效果用这个兜底。仍然要内联 style。'
        };
        const ST_SB_CONTAINER = ['row'];
        const ST_SB_ALIGN = [
            { value: 'left', label: '左' },
            { value: 'center', label: '居中' },
            { value: 'right', label: '右' }
        ];

        // 主题 = 外壳那一层的内联样式。因为拿不到 <style>，主题只能是
        // 「渲染每个块时把颜色一个个写进去」，而不是一条 CSS 规则
        const ST_SB_THEMES = {
            dark: {
                name: '暗夜', bg: '#0d1320', fg: '#e8ecf3', border: '#7b9fd4',
                accent: '#79aed2', dim: '#8b9bb4', radius: 8, pad: '8px 10px',
                font: "'Segoe UI',system-ui,-apple-system,sans-serif"
            },
            light: {
                name: '明亮', bg: '#ffffff', fg: '#1f2733', border: '#c9d4e2',
                accent: '#3b7dd8', dim: '#6b7a90', radius: 8, pad: '8px 10px',
                font: "'Segoe UI',system-ui,-apple-system,sans-serif"
            },
            glass: {
                name: '玻璃', bg: 'rgba(20,28,44,.55)', fg: '#eef3fa',
                border: 'rgba(160,190,230,.35)', accent: '#8fd0ff', dim: '#a9b8cc',
                radius: 12, pad: '10px 12px',
                font: "'Segoe UI',system-ui,-apple-system,sans-serif"
            },
            sakura: {
                name: '樱花', bg: '#fff4f7', fg: '#5a3446', border: '#f3c2d2',
                accent: '#e8749b', dim: '#a8788c', radius: 12, pad: '10px 12px',
                font: "'Segoe UI',system-ui,-apple-system,sans-serif"
            },
            terminal: {
                name: '终端', bg: '#04140a', fg: '#8ef0a8', border: '#2f7a4a',
                accent: '#5ee08a', dim: '#4f9c6b', radius: 2, pad: '8px 10px',
                font: "Consolas,'Courier New',monospace"
            },
            paper: {
                name: '纸张', bg: '#fbf8f1', fg: '#3a342a', border: '#ded3bd',
                accent: '#b08b4f', dim: '#8a8070', radius: 4, pad: '10px 12px',
                font: "Georgia,'Songti SC',serif"
            }
        };
        const ST_SB_THEME_IDS = ['dark', 'light', 'glass', 'sakura', 'terminal', 'paper'];

        // 预置版式。点一下就把块列表整套换掉 —— 这是「像编辑 PPT」里
        // 「挑模板」那一步，比从零拖块快得多
        function stSbTplBlocks(id) {
            const mk = (type, o) => {
                const b = stBlankSbBlock(type);
                Object.keys(o || {}).forEach(k => { b[k] = o[k]; });
                return b;
            };
            const rowOf = (...kids) => {
                const r = mk('row');
                r.children = kids;
                return r;
            };
            if (id === 'simple') return [
                mk('title', { text: '状态' }),
                mk('var', { path: 'stat_data.好感度', label: '好感度' }),
                mk('var', { path: 'stat_data.金币', label: '金币' })
            ];
            if (id === 'bars') return [
                mk('title', { text: '状态' }),
                mk('bar', { path: 'stat_data.好感度', label: '好感度', min: 0, max: 100 }),
                mk('bar', { path: 'stat_data.体力', label: '体力', min: 0, max: 100 })
            ];
            if (id === 'card') return [
                mk('title', { text: '状态栏' }),
                rowOf(
                    mk('var', { path: 'stat_data.好感度', label: '好感度' }),
                    mk('var', { path: 'stat_data.金币', label: '金币' })),
                mk('divider'),
                mk('bar', { path: 'stat_data.好感度', label: '好感度', min: 0, max: 100 })
            ];
            if (id === 'stars') return [
                mk('title', { text: '关系' }),
                mk('dots', { path: 'stat_data.好感度', label: '好感', min: 0, max: 5, count: 5 }),
                mk('dots', { path: 'stat_data.信赖', label: '信赖', min: 0, max: 5, count: 5 })
            ];
            if (id === 'plain') return [
                rowOf(
                    mk('var', { path: 'stat_data.好感度', label: '好感度' }),
                    mk('var', { path: 'stat_data.金币', label: '金币' }),
                    mk('var', { path: 'stat_data.时间', label: '时间' }))
            ];
            return [];   // blank
        }

        const ST_SB_TEMPLATES = [
            { id: 'simple', name: '简约数值行', theme: 'dark' },
            { id: 'bars', name: '进度条面板', theme: 'dark' },
            { id: 'card', name: '状态卡片', theme: 'glass' },
            { id: 'stars', name: '星级关系', theme: 'sakura' },
            { id: 'plain', name: '横排速览', theme: 'terminal' },
            { id: 'blank', name: '空白', theme: 'dark' }
        ];

