        // ==========================================================================
        // 游戏 1：Cat Runner (横版奔跑)
        // ==========================================================================
        let runnerState = {};

        function initRunnerGame() {
            runnerState = {
                phase: 'POST', postStep: 0, postTimer: 0, phaseTimer: 0, transitionFlashTimer: 0,
                score: 0, highScore: runnerState.highScore || 0, speed: 2, frameCount: 0, nextSpawnFrame: 50,
                cat: {
                    x: 40, y: 210, width: 24, height: 24, vy: 0, gravity: 0.6, jumpPower: -9.5, isGrounded: true, legFrame: 0,
                    jump() { if (this.isGrounded) { this.vy = this.jumpPower; this.isGrounded = false; } },
                    update() {
                        this.vy += this.gravity; this.y += this.vy;
                        if (this.y >= 210) { this.y = 210; this.vy = 0; this.isGrounded = true; }
                        if (runnerState.frameCount % 6 === 0) this.legFrame = (this.legFrame + 1) % 2;
                    },
                    draw() {
                        drawPixelCat(this.x, this.y);
                        if (!this.isGrounded) {
                            ctx.fillStyle = '#444';
                            ctx.fillRect(this.x + 2, this.y + 18, 4, 4);
                            ctx.fillRect(this.x + 16, this.y + 18, 4, 4);
                        } else {
                            ctx.fillStyle = '#444';
                            if (this.legFrame === 0) {
                                ctx.fillRect(this.x + 5, this.y + 18, 3, 5);
                                ctx.fillRect(this.x + 15, this.y + 18, 3, 5);
                            } else {
                                ctx.fillRect(this.x + 8, this.y + 18, 3, 5);
                                ctx.fillRect(this.x + 12, this.y + 18, 3, 5);
                            }
                        }
                    }
                },
                obstacles: []
            };

            gameCanvas.onclick = (e) => handleRunnerAction(e);
            if (gameAnimationId) cancelAnimationFrame(gameAnimationId);
            runnerLoop();
        }

        function handleRunnerAction(e) {
            if (activeGameType !== 'runner') return;
            if (e.type === 'keydown') {
                if (['Alt', 'Control', 'Meta', 'Shift', 'Tab', 'CapsLock'].includes(e.key)) return;
                if (e.code === 'Space' || e.code === 'ArrowUp') e.preventDefault();
            }

            const s = runnerState;
            if (s.phase === 'POST') { s.phase = 'TITLE'; s.phaseTimer = 0; }
            else if (s.phase === 'TITLE' || s.phase === 'DEMO') { s.phase = 'TRANSITION'; s.transitionFlashTimer = 0; }
            else if (s.phase === 'PLAYING') { s.cat.jump(); }
            else if (s.phase === 'GAMEOVER') { s.phase = 'TRANSITION'; s.transitionFlashTimer = 0; }
        }

        function runnerLoop() {
            if (activeGameType !== 'runner') return;
            const s = runnerState;
            s.frameCount++;
            ctx.fillStyle = '#f7f7f7'; ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);

            if (s.phase === 'POST') {
                ctx.fillStyle = '#000'; ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);
                s.postTimer++;
                if (s.postTimer % 15 === 0 && s.postStep < 7) s.postStep++;
                ctx.fillStyle = '#00ff00'; ctx.font = "11px 'Share Tech Mono', monospace";
                const lines = [
                    "SAKI-SYSTEM ARCADE BOARD V2.6",
                    "CPU  : M68000 @ 12.5MHz ....... OK",
                    "SOUND: YM2610 @ 8.0MHz ........ OK",
                    "WORK RAM  0x00000-0x3FFFF ..... OK",
                    "VRAM TEST 0x00000-0x1FFFF ..... OK",
                    "SYSTEM ALL CLEAR!", "BOOTING CAT RUNNER..."
                ];
                for (let i = 0; i <= s.postStep && i < lines.length; i++) ctx.fillText(lines[i], 20, 30 + i * 18);
                if (s.postStep >= 6 && s.postTimer > 120) { s.phase = 'TITLE'; s.phaseTimer = 0; }
            } else if (s.phase === 'TITLE') {
                s.phaseTimer++;
                ctx.strokeStyle = '#ccc'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(0, 234); ctx.lineTo(gameCanvas.width, 234); ctx.stroke();
                s.cat.draw();

                if (Math.floor(s.phaseTimer / 20) % 2 === 0) {
                    ctx.fillStyle = '#111'; ctx.font = "bold 20px 'Silkscreen', monospace";
                    ctx.textAlign = 'center'; ctx.fillText("CAT RUNNER", gameCanvas.width / 2, 80);
                }
                if (Math.floor(s.phaseTimer / 15) % 2 === 0) {
                    ctx.fillStyle = '#e65100'; ctx.font = "11px 'Silkscreen', monospace";
                    ctx.textAlign = 'center'; ctx.fillText("PRESS ANY KEY TO PLAY", gameCanvas.width / 2, 120);
                }
                ctx.textAlign = 'left';
                if (s.phaseTimer > 180) { s.phase = 'DEMO'; s.obstacles = []; s.score = 0; s.speed = 3; s.frameCount = 0; s.nextSpawnFrame = 30; }
            } else if (s.phase === 'DEMO' || s.phase === 'PLAYING') {
                const isDemo = (s.phase === 'DEMO');
                ctx.strokeStyle = '#555'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(0, 234); ctx.lineTo(gameCanvas.width, 234); ctx.stroke();

                if (isDemo && s.cat.isGrounded) {
                    // 演示 AI：找到前方最近、尚未越过的障碍，在合适距离起跳，
                    // 使「障碍与猫重叠」的窗口落在猫跳跃顶点附近，从而稳定越过。
                    let target = null;
                    for (const obs of s.obstacles) {
                        if (obs.x + obs.width > s.cat.x) {
                            if (!target || obs.x < target.x) target = obs;
                        }
                    }
                    if (target) {
                        // 顶点到达帧数 ≈ |jumpPower| / gravity；起跳距离随速度自适应，
                        // 障碍重叠区间中心位于猫前方约 3px（由碰撞判定几何导出）。
                        const apexFrames = -s.cat.jumpPower / s.cat.gravity;
                        const jumpAt = s.cat.x + 3 + apexFrames * s.speed;
                        if (target.x <= jumpAt) s.cat.jump();
                    }
                }

                s.cat.update(); s.cat.draw();

                if (s.frameCount >= s.nextSpawnFrame) {
                    const isTall = Math.random() > 0.6;
                    const h = isTall ? 32 : 18;
                    s.obstacles.push({ x: gameCanvas.width, y: 234 - h, width: 18, height: h });
                    s.nextSpawnFrame = s.frameCount + Math.floor(160 / s.speed) + Math.floor(Math.random() * 40);
                }

                for (let i = s.obstacles.length - 1; i >= 0; i--) {
                    let obs = s.obstacles[i];
                    obs.x -= s.speed;
                    ctx.fillStyle = '#c68c53'; ctx.fillRect(obs.x, obs.y, obs.width, obs.height);

                    if (s.cat.x + 4 < obs.x + obs.width && s.cat.x + s.cat.width - 4 > obs.x &&
                        s.cat.y + 4 < obs.y + obs.height && s.cat.y + s.cat.height > obs.y) {
                        if (isDemo) { s.obstacles = []; s.score = 0; }
                        else { s.phase = 'GAMEOVER'; }
                    }

                    if (obs.x + obs.width < 0) {
                        s.obstacles.splice(i, 1);
                        s.score += 10;
                        if (!isDemo && s.score > s.highScore) s.highScore = s.score;
                        if (s.score % 100 === 0) s.speed += 0.5;
                    }
                }

                ctx.fillStyle = '#333'; ctx.font = "12px 'Share Tech Mono', monospace";
                ctx.fillText(`SCORE: ${s.score}`, gameCanvas.width - 100, 25);
                ctx.fillText(`HI: ${s.highScore}`, gameCanvas.width - 170, 25);

                if (isDemo && Math.floor(s.frameCount / 20) % 2 === 0) {
                    ctx.fillStyle = '#d32f2f'; ctx.font = "bold 14px 'Silkscreen', monospace";
                    ctx.textAlign = 'center'; ctx.fillText("--- DEMO MODE ---", gameCanvas.width / 2, 50);
                    ctx.textAlign = 'left';
                }
            } else if (s.phase === 'TRANSITION') {
                s.transitionFlashTimer++;
                ctx.fillStyle = (Math.floor(s.transitionFlashTimer / 4) % 2 === 0) ? '#ffffff' : '#79d2b3';
                ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);
                ctx.fillStyle = '#000'; ctx.font = "bold 22px 'Silkscreen', monospace";
                ctx.textAlign = 'center'; ctx.fillText("READY!", gameCanvas.width / 2, gameCanvas.height / 2);
                ctx.textAlign = 'left';
                if (s.transitionFlashTimer > 30) {
                    s.phase = 'PLAYING'; s.obstacles = []; s.score = 0; s.speed = 3; s.frameCount = 0; s.nextSpawnFrame = 50;
                    s.cat.y = 210; s.cat.vy = 0;
                }
            } else if (s.phase === 'GAMEOVER') {
                ctx.strokeStyle = '#555'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(0, 234); ctx.lineTo(gameCanvas.width, 234); ctx.stroke();
                s.cat.draw();
                ctx.fillStyle = '#333'; ctx.font = "16px 'Silkscreen', monospace"; ctx.textAlign = "center";
                ctx.fillText("GAME OVER", gameCanvas.width / 2, gameCanvas.height / 2 - 10);
                ctx.font = "10px 'Silkscreen', monospace";
                ctx.fillText("Press Any Key to Restart", gameCanvas.width / 2, gameCanvas.height / 2 + 15);
                ctx.textAlign = "left";
            }

            gameAnimationId = requestAnimationFrame(runnerLoop);
        }

