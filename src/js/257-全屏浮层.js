        // ===== 全屏浮层 =====

        function stIsOpen() {
            const ov = document.getElementById('st-overlay');
            return !!(ov && ov.classList.contains('active'));
        }

        function openStEditor() {
            const ov = document.getElementById('st-overlay');
            if (!ov) return;
            // Code 页的配置 / 会话在 localStorage 里，进来之前先读回来。
            // ⚠ Agent 正在跑的时候别读 —— 磁盘上那份会比内存里少最后几条消息
            if (!stCode.running) stCodeLoad();
            // skill 住在 IndexedDB 里，**只能异步读** —— 读完重画一次。
            // ⚠ 不 await：打开编辑器不该被一个数据库拖着；读完自己刷新界面
            if (!stCode.running) {
                stCodeSkillsLoad().then(changed => { if (changed) stCodeRepaint(); });
            }
            stEditor.open = true;
            ov.classList.add('active');
            ov.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';
            renderStEditor();
        }

        function closeStEditor() {
            const ov = document.getElementById('st-overlay');
            if (!ov) return;
            stEditor.open = false;
            ov.classList.remove('active');
            ov.setAttribute('aria-hidden', 'true');
            document.body.style.overflow = '';
            stSaveDraft();
            renderStCard();
        }

        // Esc 关掉；点击浮层外的遮罩也关（浮层是满屏的，只有 shell 之外那圈才是遮罩）
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && stIsOpen()) {
                e.stopPropagation();
                closeStEditor();
            }
        }, true);

        document.addEventListener('click', (e) => {
            const ov = document.getElementById('st-overlay');
            if (ov && e.target === ov) closeStEditor();
        });

        // 折叠态写进 DOM 的**唯一**一处。
        // ⚠ 原来 rail 的 class 散在 stToggleTabs / renderStTabs 两个调用点；再加一个
        //   「顶栏那个展开键也要跟着变」就会变成四处，而漏掉任何一处的症状都是
        //   「状态/动画不对」—— 最难查的那种。所以收敛成一个函数，两处都只调它。
        function stSyncTabsCollapsed() {
            const on = !!stEditor.tabsCollapsed;
            const rail = document.getElementById('st-tabs');
            if (rail) rail.classList.toggle('st-tabs-collapsed', on);
            // ⚠ 折叠态还得挂到**按钮的祖先**（`.st-shell`）上：展开键在顶栏，
            //   跟左侧栏是堂兄弟，rail 自己的 class 驱动不了它。
            const shell = document.getElementById('st-shell');
            if (shell) shell.classList.toggle('st-tabs-collapsed', on);
        }

        function stToggleTabs() {
            stEditor.tabsCollapsed = !stEditor.tabsCollapsed;
            stSyncTabsCollapsed();
            stSaveDraft();
        }

        function stSwitchTab(id) {
            if (!ST_TABS.some(t => t.id === id)) return;
            stEditor.tab = id;
            stSaveDraft();
            renderStEditor();
        }

        // 重画时把焦点与光标位置还回去，不然改一下下拉框就得重新点回输入框。
        // 注意：真正生效的是下面 9886 附近那个（多了滚动位置与展开状态保持），
        // 这里不再重复声明 —— 两份同名函数声明只有后一份会生效，留着只会误导
        function stTabBadge(id) {
            const c = stEditor.card;
            if (id === 'book') return c.bookEntries.length || '';
            if (id === 'regex') return c.regex.length || '';
            if (id === 'greet') {
                const n = (String(c.firstMes || '').trim() ? 1 : 0) + c.alternateGreetings.length;
                return n || '';
            }
            return '';
        }

        function renderStTabs() {
            const rail = document.getElementById('st-tabs');
            if (!rail) return;
            stSyncTabsCollapsed();
            rail.innerHTML = ST_TABS.map(t => {
                const badge = stTabBadge(t.id);
                return '<button class="st-tab' + (stEditor.tab === t.id ? ' active' : '') + '"' +
                    ' type="button" id="st-tab-' + t.id + '"' +
                    ' title="' + escapeHtml(t.label) + '"' +
                    ' onclick="stSwitchTab(\'' + t.id + '\')">' +
                    '<span class="st-tab-ico">' + t.ico + '</span>' +
                    '<span class="st-tab-label">' + escapeHtml(t.label) + '</span>' +
                    (badge ? '<span class="st-tab-count">' + badge + '</span>' : '') +
                    '</button>';
            }).join('');
        }

        function renderStEditor() {
            const panes = document.getElementById('st-panes');
            if (!panes) return;
            if (!stEditor.card) stEditor.card = stBlankCard();
            renderStTabs();

            const sub = document.getElementById('st-topbar-sub');
            if (sub) {
                const c = stEditor.card;
                sub.textContent = (String(c.name || '').trim() || '（未命名）') + ' · ' +
                    ST_SPEC_LABEL[c.spec] +
                    (stEditor.srcName ? ' · 来源 ' + stEditor.srcName : '');
            }

            const tab = stEditor.tab;
            // Code 页要占满整块高度（左右两栏各自滚），别的页照旧整页滚。
            // ⚠ 这个 class 每次都得重设 —— innerHTML 换了之后它会丢
            panes.classList.toggle('st-code-mode', tab === 'code');
            panes.innerHTML = '<div class="st-pane">' + stPaneHtml(tab) + '</div>';
            panes.scrollTop = 0;
            // 常驻状态条不属于任何一页，得单独刷一遍
            stPaintMsg();
            // 世界书那个「全选」勾选框的**半选态**（indeterminate）没有对应的 HTML 属性，
            // 只能等节点挂上去之后再补一次 —— 光靠拼字符串是设不出来的
            stBookSelPaint();
            renderStCard();
        }

        function stPaneHtml(tab) {
            switch (tab) {
                case 'home': return stPaneHome();
                case 'spec': return stPaneSpec();
                case 'desc': return stPaneDesc();
                case 'persona': return stPanePersona();
                case 'sys': return stPaneSys();
                case 'meta': return stPaneMeta();
                case 'ai': return stPaneAi();
                case 'book': return stPaneBook();
                case 'greet': return stPaneGreet();
                case 'regex': return stPaneRegex();
                case 'th': return stPaneTh();
                case 'mvu': return stPaneMvu();
                case 'sb': return stPaneSb();
                case 'code': return stPaneCode();
                case 'export': return stPaneExport();
                default: return stPaneName();
            }
        }

