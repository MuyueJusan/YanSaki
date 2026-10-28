        // ===== AI 聊天窗口放大 =====
        // 手机/窄屏 → 铺满整个浏览器窗口；桌面/宽屏 → 手机比例竖向居中
        let aiMaxPrevState = null;

        function scrollAiMessagesToBottom() {
            requestAnimationFrame(() => {
                const box = document.getElementById('ai-messages');
                if (box) box.scrollTop = box.scrollHeight;
            });
        }

        function toggleAiMaximize() {
            const card = document.getElementById('ai-card');
            const btn = document.getElementById('ai-max-btn');
            const on = card.classList.toggle('ai-maximized');
            document.body.classList.toggle('ai-max-on', on);

            if (on) {
                // 记下原来的展开状态；放大时收起设置面板，把高度让给聊天
                aiMaxPrevState = {
                    collapsed: card.classList.contains('ai-collapsed'),
                    settingsCollapsed: card.classList.contains('ai-settings-collapsed'),
                    advCollapsed: card.classList.contains('ai-adv-collapsed')
                };
                card.classList.remove('ai-collapsed');
                card.classList.add('ai-settings-collapsed', 'ai-adv-collapsed');
                btn.classList.add('active');
                btn.title = '退出放大';
            } else {
                // 还原放大前的折叠状态
                if (aiMaxPrevState) {
                    card.classList.toggle('ai-collapsed', aiMaxPrevState.collapsed);
                    card.classList.toggle('ai-settings-collapsed', aiMaxPrevState.settingsCollapsed);
                    card.classList.toggle('ai-adv-collapsed', aiMaxPrevState.advCollapsed);
                    aiMaxPrevState = null;
                }
                btn.classList.remove('active');
                btn.title = '放大聊天窗口';
            }

            scrollAiMessagesToBottom();
        }

        function isAiMaximized() {
            return document.getElementById('ai-card').classList.contains('ai-maximized');
        }

        // Esc 退出放大
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && isAiMaximized()) toggleAiMaximize();
        });

        // 点击遮罩（body 空白处）退出放大
        document.body.addEventListener('click', (e) => {
            if (e.target === document.body && document.body.classList.contains('ai-max-on')) {
                toggleAiMaximize();
            }
        });

