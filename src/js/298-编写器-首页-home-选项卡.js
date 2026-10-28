        // ===== 各选项卡 =====

        // ==========================================================================
        // 角色卡编写器：首页
        //   别的页回答「往里填什么」，这一页回答「这张卡现在长什么样 / 从哪儿开始」。
        //   三块：① 概览 ② 快捷动作（新建 / 导入 / 读酒馆当前卡）
        //        ③ 从别的角色卡或世界书里把条目搬过来
        // ==========================================================================

        // 秒级时间戳 → 本地时间。0 / 无效值一律「—」，**不显示 1970**
        // （卡里 creation_date 缺失是常态，显示 1970 看着像数据坏了）
        function stHomeTime(ts) {
            const n = Number(ts);
            if (!Number.isFinite(n) || n <= 0) return '—';
            try {
                const d = new Date(n * 1000);
                const p = x => String(x).padStart(2, '0');
                return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
                    ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
            } catch (e) { return '—'; }
        }

        // 首页「正文字段完成度」用的清单。
        // ⚠ 必须跟 renderStCard() 里那份**逐字一致** —— 否则会出现
        //   「首页说 5/8、卡片摘要说 6/8」这种谁都不信的数字
        const ST_HOME_BODY_FIELDS = ['name', 'description', 'personality', 'scenario',
            'mesExample', 'systemPrompt', 'postHistoryInstructions', 'firstMes'];

        // 首页的**模块注册表**。首页的内容不再是一长条拼起来的字符串，而是四个各自独立的
        // 模块：每个模块有自己的头（图标 + 标题 + 一句提示）、自己的体、自己的折叠状态。
        // ⇒ **加一块内容 = 往这张表里加一行 + 写一个 body 函数**，`stPaneHome()` 不用动。
        // ⚠ 顺序就是显示顺序。`body` 返回空串 = 这个模块**整个不渲染**（比如没头像时）。
        // ⚠ `body` 直接引用函数声明（会提升），所以这张表可以写在它们前面。
        const ST_HOME_MODULES = [
            { id: 'avatar',   ico: '🖼', title: '头像',         hint: '导出时写进卡里',
              body: stHomeBodyAvatar },
            { id: 'overview', ico: '📋', title: '概览',         hint: '这张卡现在长什么样',
              body: stHomeBodyOverview },
            { id: 'actions',  ico: '⚡', title: '快捷动作',     hint: '跟顶栏那几个按钮是同一批',
              body: stHomeBodyActions },
            { id: 'extract',  ico: '📚', title: '从别处搬条目', hint: '别的角色卡 / 世界书 → 这张卡',
              body: stHomeBodyExtract }
        ];

        // 一个模块的外壳。折叠**默认展开**（不带 class 就是展开态）。
        function stHomeModule(m) {
            const body = m.body();
            if (!body) return '';               // 没内容的模块整个不出现，不留空壳
            const closed = stEditor.homeClosed[m.id] === true;
            return '<section class="st-mod' + (closed ? ' st-mod-closed' : '') +
                    '" id="st-mod-' + m.id + '" data-mod="' + m.id + '">' +
                '<button class="st-mod-head" type="button" onclick="stHomeFold(\'' + m.id + '\')">' +
                    '<span class="st-mod-ico">' + m.ico + '</span>' +
                    '<span class="st-mod-title">' + escapeHtml(m.title) + '</span>' +
                    '<span class="st-mod-hint">' + escapeHtml(m.hint) + '</span>' +
                    '<span class="st-mod-arrow">▲</span>' +
                '</button>' +
                '<div class="st-mod-body"><div class="st-mod-inner">' +
                    '<div class="st-mod-pad">' + body + '</div>' +
                '</div></div></section>';
        }

        // 折叠 / 展开一个模块。
        // ⚠ 状态留在 `stEditor.homeClosed` 里（跟 `tabsCollapsed` 一样），**不能留在 DOM 上** ——
        //   首页每次改数据都会 `stRerender()` 重铺整块 innerHTML，
        //   状态挂 DOM 上的话，用户折起来的模块会自己弹开。
        function stHomeFold(id) {
            if (!ST_HOME_MODULES.some(m => m.id === id)) return;
            if (stEditor.homeClosed[id]) delete stEditor.homeClosed[id];
            else stEditor.homeClosed[id] = true;
            stSaveDraft();
            stRerender();
        }

        function stPaneHome() {
            return stPaneHead('🏠 首页',
                '当前草稿长什么样，以及从哪儿开始。这里的新建 / 导入跟顶栏那几个按钮是同一批动作。') +
                ST_HOME_MODULES.map(stHomeModule).join('');
        }

