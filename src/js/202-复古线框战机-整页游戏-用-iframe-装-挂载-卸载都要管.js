        // ------------------------------------------------------------------
        // 复古线框战机（整页游戏）—— 用 iframe 装，挂载 / 卸载都要管
        // ------------------------------------------------------------------
        // ⚠ **必须卸载，不能只是藏起来。** 那个游戏的 gameLoop 在
        //   `gameState !== 'PLAYING'` 时**照样**把 requestAnimationFrame 排回去
        //   （它靠这个在选机页 / 暂停页继续画星空），也就是循环一旦启动就**永不停止**。
        //   只把 iframe 藏起来的话，关掉弹窗之后它还在后台满帧跑，白烧 CPU，
        //   而且从外面**完全看不出来**（页面上什么都没有）。
        //   唯一可靠的停法是**把 iframe 从 DOM 里摘掉** —— 文档销毁，循环随之消失。
        let shooterFrame = null;

        function stShooterMount() {
            const host = document.getElementById('gameShooterFrameHost');
            if (!host) return;
            stShooterUnmount();                       // 防手抖挂出两个
            const f = document.createElement('iframe');
            f.id = 'gameShooterFrame';
            f.setAttribute('title', 'Retro Vector Shooter');
            // ⚠ 用 `srcdoc` 而不是 `src`：内容就在本文件里（`ST_SHOOTER_SRC`），
            //   不额外发请求，也不受 `file://` 下 fetch 被拦的影响。
            f.srcdoc = ST_SHOOTER_SRC;
            // ⚠ 挂上去就立刻聚焦，不能只挂在 `load` 上：那个页面里有一条 `@import`
            //   拉 Google Fonts，字体慢的时候 `load` 要等好几秒才触发 ——
            //   期间游戏已经在跑了（`readyState` 是 `interactive`），键盘却一个键都进不去。
            //   `load` 里那次保留，是为了字体到位后把焦点再确认一遍。
            f.addEventListener('load', () => stShooterFocus(f));
            host.appendChild(f);
            stShooterFocus(f);
            shooterFrame = f;
        }

        // 把键盘焦点送进 iframe。
        // ⚠ **时机是关键：挂上去就立刻送（那时导航还没开始），不能只挂在 `load` 上。**
        //   实测（2026-09-21 · headless Chrome）：只把焦点放在 `load` 里送的话，
        //   父页面的 `activeElement` 还是 `BODY`、子文档 `document.hasFocus()` 还是 false ——
        //   按 WASD 一个键都进不去，而游戏画面**看不出任何异常**（好好地显示着，就是不动）。
        //   雪上加霜的是那个页面里有一条 `@import` 拉 Google Fonts，`load` 会被拖后好几秒，
        //   期间游戏已经在跑了（`readyState` 是 `interactive`），键盘却一个键都不响应。
        // 两个调用都留着：`f.focus()` 是规范里「把元素设成 activeElement」的正路，
        // `contentWindow.focus()` 是原来就在的（导航之前调它同样能生效）。
        // ⚠ 但**套件分不出这两个的差别** —— `_reverse12.js` 的 R4 试过：只留
        //   `contentWindow.focus()`、把元素 `focus()` 拿掉时，87 条**全绿**。
        //   所以 `game-verify.js` 守的是「焦点进没进去」这个**行为**，不是「用了哪个 API」。
        //   这条缺口写在这儿，不藏。
        function stShooterFocus(f) {
            try { f.focus(); } catch (e) {}
            try { f.contentWindow.focus(); } catch (e) {}
        }

        function stShooterUnmount() {
            if (shooterFrame) { try { shooterFrame.remove(); } catch (e) {} shooterFrame = null; }
            // 兜底：真出现「变量是 null、DOM 里却还留着一个」就一起清掉 ——
            // 那个孤儿 iframe 会在后台一直跑，而页面上看不见任何异常
            const host = document.getElementById('gameShooterFrameHost');
            if (host) while (host.firstChild) host.removeChild(host.firstChild);
        }

        // 「回到菜单」和「关弹窗」都要收的三件事。抽成一个函数是**故意的**：
        // 分头写两遍就一定会有一遍漏掉，而漏掉的表现是「后台还在跑」——
        // 看不见、也不报错。（这个项目在「展开键有两个」上已经栽过一次同款跟头。）
        function stShooterReset() {
            stShooterUnmount();
            const wrap = document.getElementById('gameShooterWrap');
            if (wrap) wrap.style.display = 'none';
            const card = document.getElementById('gameCard');
            if (card) card.classList.remove('game-card--wide');
        }

        // 绑定实体触屏按钮事件
        function bindTouchButtonEvents() {
            const btnLeft = document.getElementById('btnLeft');
            const btnRight = document.getElementById('btnRight');

            const handlePress = (direction, isPressed) => {
                if (direction === 'left') touchMoveState.left = isPressed;
                if (direction === 'right') touchMoveState.right = isPressed;

                if (isPressed && activeGameType === 'doodle') {
                    handleDoodleTouchPress();
                }
            };

            ['touchstart', 'mousedown'].forEach(evtName => {
                btnLeft.addEventListener(evtName, (e) => { e.preventDefault(); handlePress('left', true); });
                btnRight.addEventListener(evtName, (e) => { e.preventDefault(); handlePress('right', true); });
            });

            ['touchend', 'touchcancel', 'mouseup', 'mouseleave'].forEach(evtName => {
                btnLeft.addEventListener(evtName, (e) => { e.preventDefault(); handlePress('left', false); });
                btnRight.addEventListener(evtName, (e) => { e.preventDefault(); handlePress('right', false); });
            });

            // 绑定十字键按键事件
            const dpadMap = [
                { id: 'btnUp', dir: 'up' },
                { id: 'btnDown', dir: 'down' },
                { id: 'btnDpadLeft', dir: 'left' },
                { id: 'btnDpadRight', dir: 'right' }
            ];

            dpadMap.forEach(item => {
                const btn = document.getElementById(item.id);
                ['touchstart', 'mousedown'].forEach(evtName => {
                    btn.addEventListener(evtName, (e) => {
                        e.preventDefault();
                        if (activeGameType === 'parade') {
                            handleParadeTouchPress(item.dir);
                        }
                    });
                });
            });
        }

        window.addEventListener('keydown', (e) => {
            keysPressed[e.code] = true;
            if (activeGameType === 'runner') handleRunnerAction(e);
            else if (activeGameType === 'doodle') handleDoodleAction(e);
            else if (activeGameType === 'parade') handleParadeAction(e);
        });

        window.addEventListener('keyup', (e) => {
            keysPressed[e.code] = false;
        });

        // 绘制像素猫咪（支持自然基因配色：毛色 & 眼睛）
        function drawPixelCat(x, y, isFacingLeft = false, furColor = '#444444', eyeColor = '#66ccff') {
            ctx.save();
            if (isFacingLeft) {
                ctx.translate(x + 24, y);
                ctx.scale(-1, 1);
                x = 0; y = 0;
            }
            
            // 身体
            ctx.fillStyle = furColor; 
            ctx.fillRect(x + 4, y + 8, 16, 10); 
            ctx.fillRect(x + 12, y + 2, 10, 10); 
            ctx.fillRect(x + 13, y, 3, 3); 
            ctx.fillRect(x + 18, y, 3, 3);
            
            // 眼睛
            ctx.fillStyle = eyeColor;
            ctx.fillRect(x + 19, y + 4, 2, 2); 
            
            // 尾巴
            ctx.fillStyle = furColor;
            ctx.fillRect(x, y + 4, 4, 3); 
            ctx.fillRect(x - 2, y + 2, 3, 3);

            ctx.restore();
        }

        // 自然界猫猫毛色与眼睛颜色池
        const NATURAL_FUR_COLORS = [
            '#444444', // 经典灰黑
            '#e67e22', // 橘猫
            '#2c3e50', // 纯黑猫
            '#ecf0f1', // 纯白猫
            '#95a5a6', // 蓝灰色 (英国短毛)
            '#d35400', // 深赭棕色
            '#f39c12', // 奶油黄
            '#7f8c8d'  // 烟灰色
        ];

        const NATURAL_EYE_COLORS = [
            '#66ccff', // 天蓝
            '#2ecc71', // 翡翠绿
            '#f1c40f', // 珀金黄
            '#e67e22', // 琥珀铜
            '#1abc9c'  // 青蓝
        ];

        function getRandomCatColors() {
            return {
                fur: NATURAL_FUR_COLORS[Math.floor(Math.random() * NATURAL_FUR_COLORS.length)],
                eye: NATURAL_EYE_COLORS[Math.floor(Math.random() * NATURAL_EYE_COLORS.length)]
            };
        }

