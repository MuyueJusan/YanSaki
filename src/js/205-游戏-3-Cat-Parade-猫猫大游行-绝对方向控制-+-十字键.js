        // ==========================================================================
        // 游戏 3：Cat Parade (猫猫大游行 - 绝对方向控制 + 十字键)
        // ==========================================================================
        let paradeState = {};
        const GRID_SIZE = 24;
        const PARADE_CATCH_RADIUS = 1; // 收集野生猫咪的判定半径（格），越大越容易收集到同伴

        function initParadeGame() {
            paradeState = {
                phase: 'POST', postStep: 0, postTimer: 0, phaseTimer: 0, transitionFlashTimer: 0,
                score: 0, highScore: paradeState.highScore || 0,
                moveTimer: 0, speedInterval: 18, // 移动帧率隔帧
                dir: { x: 1, y: 0 }, // 当前移动方向
                nextDir: { x: 1, y: 0 }, // 下一次移动将改变的方向
                cats: [
                    { x: 5, y: 5, fur: '#444444', eye: '#66ccff' } // 主角猫咪
                ],
                wildCat: null
            };

            spawnWildCat();
            gameCanvas.onclick = () => handleParadeTouchPress('click');

            if (gameAnimationId) cancelAnimationFrame(gameAnimationId);
            paradeLoop();
        }

        function spawnWildCat() {
            const cols = Math.floor(gameCanvas.width / GRID_SIZE);
            const rows = Math.floor(gameCanvas.height / GRID_SIZE);

            let valid = false;
            let rx, ry;
            while (!valid) {
                // 同胞猫咪不生成在边缘一圈，只落在内部区域 [1, cols-2] × [1, rows-2]
                rx = 1 + Math.floor(Math.random() * (cols - 2));
                ry = 1 + Math.floor(Math.random() * (rows - 2));
                valid = !paradeState.cats.some(c => c.x === rx && c.y === ry);
            }

            const colors = getRandomCatColors();
            paradeState.wildCat = { x: rx, y: ry, fur: colors.fur, eye: colors.eye };
        }

        function setParadeDirection(targetDir) {
            const s = paradeState;
            if (s.phase !== 'PLAYING') return;

            // 绝对方向映射
            let newDir = null;
            if (targetDir === 'up') newDir = { x: 0, y: -1 };
            if (targetDir === 'down') newDir = { x: 0, y: 1 };
            if (targetDir === 'left') newDir = { x: -1, y: 0 };
            if (targetDir === 'right') newDir = { x: 1, y: 0 };

            if (newDir) {
                // 禁止 180 度直接反向移动（自吞防护）
                if (s.dir.x + newDir.x !== 0 || s.dir.y + newDir.y !== 0) {
                    s.nextDir = newDir;
                }
            }
        }

        function handleParadeTouchPress(action) {
            if (activeGameType !== 'parade') return;
            const s = paradeState;

            if (s.phase === 'POST') { s.phase = 'TITLE'; s.phaseTimer = 0; }
            else if (s.phase === 'TITLE' || s.phase === 'GAMEOVER') {
                s.phase = 'TRANSITION'; s.transitionFlashTimer = 0;
            } else if (s.phase === 'PLAYING') {
                setParadeDirection(action);
            }
        }

        function handleParadeAction(e) {
            if (activeGameType !== 'parade') return;
            const s = paradeState;

            if (s.phase === 'POST') { s.phase = 'TITLE'; s.phaseTimer = 0; }
            else if (s.phase === 'TITLE' || s.phase === 'GAMEOVER') {
                s.phase = 'TRANSITION'; s.transitionFlashTimer = 0;
            } else if (s.phase === 'PLAYING') {
                if (e.code === 'KeyW' || e.code === 'ArrowUp') setParadeDirection('up');
                if (e.code === 'KeyS' || e.code === 'ArrowDown') setParadeDirection('down');
                if (e.code === 'KeyA' || e.code === 'ArrowLeft') setParadeDirection('left');
                if (e.code === 'KeyD' || e.code === 'ArrowRight') setParadeDirection('right');
            }
        }

        function paradeLoop() {
            if (activeGameType !== 'parade') return;

            const s = paradeState;
            ctx.fillStyle = '#7f9a7a'; // 中灰绿底色：浅色与深色猫猫都能清晰辨认
            ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);

            // 绘制底板点阵
            ctx.fillStyle = '#6b8466';
            for (let x = 12; x < gameCanvas.width; x += GRID_SIZE) {
                for (let y = 12; y < gameCanvas.height; y += GRID_SIZE) {
                    ctx.fillRect(x - 1, y - 1, 2, 2);
                }
            }

            if (s.phase === 'POST') {
                ctx.fillStyle = '#000'; ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);
                s.postTimer++;
                if (s.postTimer % 15 === 0 && s.postStep < 5) s.postStep++;
                ctx.fillStyle = '#00ff00'; ctx.font = "11px 'Share Tech Mono', monospace";
                const lines = [
                    "CAT PARADE ENGINE V2.0",
                    "COLOR GEN MATRIX ......... OK",
                    "WRAP AROUND BOUNDS ....... OK",
                    "BOOTING CAT PARADE..."
                ];
                for (let i = 0; i <= s.postStep && i < lines.length; i++) ctx.fillText(lines[i], 20, 50 + i * 20);
                if (s.postStep >= 3 && s.postTimer > 90) { s.phase = 'TITLE'; s.phaseTimer = 0; }
            } else if (s.phase === 'TITLE') {
                s.phaseTimer++;
                drawPixelCat(228, 110, false, '#444444', '#66ccff');
                if (Math.floor(s.phaseTimer / 20) % 2 === 0) {
                    ctx.fillStyle = '#ffffff'; ctx.font = "bold 18px 'Silkscreen', monospace";
                    ctx.textAlign = 'center'; ctx.fillText("CAT PARADE", gameCanvas.width / 2, 70);
                }
                if (Math.floor(s.phaseTimer / 15) % 2 === 0) {
                    ctx.fillStyle = '#ffffff'; ctx.font = "11px 'Silkscreen', monospace";
                    ctx.textAlign = 'center'; ctx.fillText("CLICK / PRESS BUTTON TO PLAY", gameCanvas.width / 2, 160);
                }
                ctx.textAlign = 'left';
            } else if (s.phase === 'PLAYING') {
                s.moveTimer++;

                if (s.moveTimer >= s.speedInterval) {
                    s.moveTimer = 0;
                    s.dir = { ...s.nextDir };

                    const cols = gameCanvas.width / GRID_SIZE;
                    const rows = gameCanvas.height / GRID_SIZE;

                    // 计算首领新位置 (包含边界安全穿透逻辑)
                    let newX = (s.cats[0].x + s.dir.x + cols) % cols;
                    let newY = (s.cats[0].y + s.dir.y + rows) % rows;

                    // 碰撞自身身体判定
                    const selfCollide = s.cats.slice(1).some(c => c.x === newX && c.y === newY);
                    if (selfCollide) {
                        s.phase = 'GAMEOVER';
                    } else {
                        // 移动队伍：后面的猫跟上前一节
                        for (let i = s.cats.length - 1; i > 0; i--) {
                            s.cats[i].x = s.cats[i - 1].x;
                            s.cats[i].y = s.cats[i - 1].y;
                        }
                        s.cats[0].x = newX;
                        s.cats[0].y = newY;

                        // 碰到野生猫咪 -> 增加队伍（判定范围扩大，更容易收集到同伴）
                        const dx = Math.abs(newX - s.wildCat.x);
                        const dy = Math.abs(newY - s.wildCat.y);
                        if (dx <= PARADE_CATCH_RADIUS && dy <= PARADE_CATCH_RADIUS) {
                            // 新同伴追加到队伍尾部，保持队伍连续
                            const tail = s.cats[s.cats.length - 1];
                            s.cats.push({
                                x: tail.x,
                                y: tail.y,
                                fur: s.wildCat.fur,
                                eye: s.wildCat.eye
                            });
                            s.score += 10;
                            if (s.score > s.highScore) s.highScore = s.score;
                            // 随着猫咪增多稍许加快游行速度
                            if (s.speedInterval > 8 && s.cats.length % 3 === 0) s.speedInterval--;
                            spawnWildCat();
                        }
                    }
                }

                // 绘制野生等待加入的猫咪 (微动动画)
                if (s.wildCat) {
                    const breathOffset = (Math.floor(Date.now() / 300) % 2 === 0) ? 0 : -1;
                    drawPixelCat(s.wildCat.x * GRID_SIZE, s.wildCat.y * GRID_SIZE + breathOffset, false, s.wildCat.fur, s.wildCat.eye);
                }

                // 绘制游行中的猫猫队伍
                for (let i = s.cats.length - 1; i >= 0; i--) {
                    const c = s.cats[i];
                    const isLeft = (s.dir.x === -1);
                    drawPixelCat(c.x * GRID_SIZE, c.y * GRID_SIZE, isLeft, c.fur, c.eye);
                }

                // 分数与统计
                ctx.fillStyle = '#ffffff'; ctx.font = "12px 'Share Tech Mono', monospace";
                ctx.fillText(`CATS: ${s.cats.length}`, gameCanvas.width - 100, 25);
                ctx.fillText(`HI: ${s.highScore}`, gameCanvas.width - 170, 25);
            } else if (s.phase === 'TRANSITION') {
                s.transitionFlashTimer++;
                ctx.fillStyle = (Math.floor(s.transitionFlashTimer / 4) % 2 === 0) ? '#ffffff' : '#a5d6a7';
                ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);
                ctx.fillStyle = '#1b5e20'; ctx.font = "bold 22px 'Silkscreen', monospace";
                ctx.textAlign = 'center'; ctx.fillText("MARCH!", gameCanvas.width / 2, gameCanvas.height / 2);
                ctx.textAlign = 'left';
                if (s.transitionFlashTimer > 30) {
                    s.phase = 'PLAYING';
                    s.score = 0; s.speedInterval = 16; s.moveTimer = 0;
                    s.dir = { x: 1, y: 0 }; s.nextDir = { x: 1, y: 0 };
                    s.cats = [{ x: 5, y: 5, fur: '#444444', eye: '#66ccff' }];
                    spawnWildCat();
                }
            } else if (s.phase === 'GAMEOVER') {
                ctx.fillStyle = '#2e7d32'; ctx.font = "16px 'Silkscreen', monospace"; ctx.textAlign = "center";
                ctx.fillText("PARADE ENDED", gameCanvas.width / 2, gameCanvas.height / 2 - 10);
                ctx.font = "10px 'Silkscreen', monospace";
                ctx.fillText("Click / Press Button to March Again", gameCanvas.width / 2, gameCanvas.height / 2 + 15);
                ctx.textAlign = "left";
            }

            gameAnimationId = requestAnimationFrame(paradeLoop);
        }

