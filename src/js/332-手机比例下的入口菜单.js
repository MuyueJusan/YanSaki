        // ===== 手机比例下的入口菜单 =====
        // 窄屏 / 极扁窗口下，`#ai-card` 和 `#st-card` 被上面那条 @media 收起，改由左上角按钮呼出。
        // ⚠ 这个字符串必须跟 CSS 里那条 @media **逐字一致**，否则会出现「按钮在、点了没反应」
        //   或者「卡片收了、按钮没出来」这种**只在某个宽度区间才复现**的鬼影。
        const MOBILE_NAV_MQ = '(max-width: 600px), (max-height: 480px)';

        function mobileNavIsPhone() {
            return window.matchMedia(MOBILE_NAV_MQ).matches;
        }

        function setMobileNav(open) {
            const nav = document.getElementById('mobile-nav');
            const btn = document.getElementById('mobile-nav-btn');
            const ico = document.getElementById('mobile-nav-ico');
            if (!nav) return;
            nav.classList.toggle('open', open);
            if (btn) {
                btn.setAttribute('aria-expanded', open ? 'true' : 'false');
                btn.setAttribute('aria-label', open ? '收起菜单' : '展开菜单');
            }
            if (ico) ico.textContent = open ? '✕' : '☰';
        }

        function toggleMobileNav() {
            const nav = document.getElementById('mobile-nav');
            setMobileNav(!(nav && nav.classList.contains('open')));
        }

        function closeMobileNav() { setMobileNav(false); }

        // 菜单里点「AI 对话」：**手机比例下直接进全屏**，而不是先把那张内嵌卡片展开。
        // 窄屏上内嵌卡片本来就没多少可用高度，「先展开、再点放大」是白白多一步。
        // 复用已有的 `toggleAiMaximize()` —— 它在 ≤600px 时本来就是 `position: fixed; inset: 0`
        // （铺满整个浏览器窗口），正是这里要的效果；⚠ 它是 toggle，所以要先判 `isAiMaximized()`，
        // 否则「已经全屏时再点一次」会变成退出全屏。
        function mobileOpenAi() {
            closeMobileNav();
            if (mobileNavIsPhone() && !isAiMaximized()) toggleAiMaximize();
        }

        // 菜单里点「角色卡编写器」：直接开它的全屏浮层（那张卡片本来就只是个入口）
        function mobileOpenSt() {
            closeMobileNav();
            openStEditor();
        }

        // 点空白处收起菜单（点在菜单自己身上不算）
        document.addEventListener('click', (e) => {
            const nav = document.getElementById('mobile-nav');
            if (!nav || !nav.classList.contains('open')) return;
            if (!nav.contains(e.target)) setMobileNav(false);
        });

        // 转屏 / 改窗口大小：一旦离开手机比例就收起，
        // 免得留下一个「已经显示不出来了、状态却还开着」的菜单
        window.addEventListener('resize', () => {
            if (!mobileNavIsPhone()) closeMobileNav();
        });

