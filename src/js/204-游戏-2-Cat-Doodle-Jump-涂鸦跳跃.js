        // ==========================================================================
        // 游戏 2：Cat Doodle Jump (涂鸦跳跃)
        // ==========================================================================
        let doodleState = {};

        function initDoodleGame() {
            doodleState = {
                phase: 'POST', postStep: 0, postTimer: 0, phaseTimer: 0, transitionFlashTimer: 0,
                score: 0, highScore: doodleState.highScore || 0,
                cat: { x: 228, y: 150, width: 24, height: 24, vx: 0, vy: 0, gravity: 0.14, jumpPower: -8.0, facingLeft: false },
                platforms: [], cameraY: 0
            };

            gameCanvas.onclick = () => handleDoodleTouchPress();
            if (gameAnimationId) cancelAnimationFrame(gameAnimationId);
            doodleLoop();
        }

        function handleDoodleTouchPress() {
            if (activeGameType !== 'doodle') return;
            const s = doodleState;
            if (s.phase === 'POST') { s.phase = 'TITLE'; s.phaseTimer = 0; }
            else if (s.phase === 'TITLE' || s.phase === 'DEMO' || s.phase === 'GAMEOVER') {
                s.phase = 'TRANSITION'; s.transitionFlashTimer = 0;
            }
        }

        function handleDoodleAction(e) { handleDoodleTouchPress(); }

        function doodleLoop() {
            if (activeGameType !== 'doodle') return;
            const s = doodleState;
            ctx.fillStyle = '#faf8f0'; ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);

            ctx.strokeStyle = '#f0ebd8'; ctx.lineWidth = 1;
            for (let x = 0; x < gameCanvas.width; x += 20) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, gameCanvas.height); ctx.stroke(); }
            for (let y = 0; y < gameCanvas.height; y += 20) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(gameCanvas.width, y); ctx.stroke(); }

            if (s.phase === 'POST') {
                ctx.fillStyle = '#000'; ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);
                s.postTimer++;
                if (s.postTimer % 15 === 0 && s.postStep < 6) s.postStep++;
                ctx.fillStyle = '#00ff00'; ctx.font = "11px 'Share Tech Mono', monospace";
                const lines = [
                    "DOODLE ENGINE V1.0",
                    "GRAVITY MOTOR CHECK ...... OK",
                    "PLATFORM GEN TEST ........ OK",
                    "BOUNCE SPRINGS .......... OK",
                    "BOOTING CAT DOODLE..."
                ];
                for (let i = 0; i <= s.postStep && i < lines.length; i++) ctx.fillText(lines[i], 20, 40 + i * 20);
                if (s.postStep >= 4 && s.postTimer > 100) { s.phase = 'TITLE'; s.phaseTimer = 0; }
            } else if (s.phase === 'TITLE') {
                s.phaseTimer++;
                drawPixelCat(228, 120);
                if (Math.floor(s.phaseTimer / 20) % 2 === 0) {
                    ctx.fillStyle = '#333'; ctx.font = "bold 18px 'Silkscreen', monospace";
                    ctx.textAlign = 'center'; ctx.fillText("CAT DOODLE JUMP", gameCanvas.width / 2, 80);
                }
                if (Math.floor(s.phaseTimer / 15) % 2 === 0) {
                    ctx.fillStyle = '#3a7bd5'; ctx.font = "11px 'Silkscreen', monospace";
                    ctx.textAlign = 'center'; ctx.fillText("PRESS ANY KEY / CLICK TO START", gameCanvas.width / 2, 170);
                }
                ctx.textAlign = 'left';
                if (s.phaseTimer > 180) { s.phase = 'DEMO'; resetDoodleWorld(); }
            } else if (s.phase === 'DEMO' || s.phase === 'PLAYING') {
                const isDemo = (s.phase === 'DEMO');

                if (!isDemo) {
                    const moveLeft = keysPressed['KeyA'] || keysPressed['ArrowLeft'] || touchMoveState.left;
                    const moveRight = keysPressed['KeyD'] || keysPressed['ArrowRight'] || touchMoveState.right;

                    if (moveLeft) { s.cat.vx = -3.0; s.cat.facingLeft = true; }
                    else if (moveRight) { s.cat.vx = 3.0; s.cat.facingLeft = false; }
                    else { s.cat.vx *= 0.97; }
                } else {
                    // 演示 AI：按上升/下落阶段选择目标平台并水平接近，保证持续向上弹跳
                    let target = null;
                    let best = Infinity;
                    const catCx = s.cat.x + 12;
                    if (s.cat.vy <= 0) {
                        // 上升阶段：瞄准上方 20~160px 内水平最近的平台
                        for (const p of s.platforms) {
                            const rise = s.cat.y - p.y; // 正 = 平台在上方
                            if (rise < 20 || rise > 160) continue;
                            const dx = Math.abs(catCx - (p.x + p.width / 2));
                            if (dx < best) { best = dx; target = p; }
                        }
                    } else {
                        // 下落阶段：瞄准下方最近的平台，确保踩到后继续弹跳
                        for (const p of s.platforms) {
                            if (p.y <= s.cat.y) continue;
                            const dx = Math.abs(catCx - (p.x + p.width / 2));
                            const dy = p.y - s.cat.y;
                            const score = dx + dy * 0.05;
                            if (score < best) { best = score; target = p; }
                        }
                    }
                    if (target) {
                        const targetCx = target.x + target.width / 2;
                        if (catCx < targetCx - 4) { s.cat.vx = 3.0; s.cat.facingLeft = false; }
                        else if (catCx > targetCx + 4) { s.cat.vx = -3.0; s.cat.facingLeft = true; }
                        else { s.cat.vx *= 0.9; }
                    }
                }

                s.cat.vy += s.cat.gravity; s.cat.x += s.cat.vx; s.cat.y += s.cat.vy;
                if (s.cat.x < -12) s.cat.x = gameCanvas.width - 12;
                if (s.cat.x > gameCanvas.width - 12) s.cat.x = -12;

                if (s.cat.y < 110) {
                    const diff = 110 - s.cat.y;
                    s.cat.y = 110; s.score += Math.floor(diff);
                    if (!isDemo && s.score > s.highScore) s.highScore = s.score;
                    s.platforms.forEach(p => p.y += diff);
                }

                if (s.cat.y > gameCanvas.height) {
                    if (isDemo) resetDoodleWorld(); else s.phase = 'GAMEOVER';
                }

                if (s.cat.vy > 0) {
                    s.platforms.forEach(p => {
                        if (s.cat.x + 4 < p.x + p.width && s.cat.x + s.cat.width - 4 > p.x &&
                            s.cat.y + s.cat.height >= p.y && s.cat.y + s.cat.height <= p.y + 12) {
                            s.cat.vy = p.isSpring ? s.cat.jumpPower * 1.35 : s.cat.jumpPower;
                        }
                    });
                }

                s.platforms = s.platforms.filter(p => p.y < gameCanvas.height);
                while (s.platforms.length < 9) {
                    const highestY = Math.min(...s.platforms.map(p => p.y));
                    s.platforms.push({
                        x: Math.random() * (gameCanvas.width - 60),
                        y: highestY - (25 + Math.random() * 25),
                        width: 58, height: 10, isSpring: Math.random() < 0.18
                    });
                }

                s.platforms.forEach(p => {
                    ctx.fillStyle = p.isSpring ? '#4caf50' : '#8d6e63'; ctx.fillRect(p.x, p.y, p.width, p.height);
                    ctx.fillStyle = p.isSpring ? '#2e7d32' : '#5d4037'; ctx.fillRect(p.x, p.y + p.height - 2, p.width, 2);
                });

                drawPixelCat(s.cat.x, s.cat.y, s.cat.facingLeft);

                ctx.fillStyle = '#333'; ctx.font = "12px 'Share Tech Mono', monospace";
                ctx.fillText(`HEIGHT: ${s.score}`, gameCanvas.width - 120, 25);
                ctx.fillText(`HI: ${s.highScore}`, gameCanvas.width - 200, 25);

                if (isDemo && Math.floor(Date.now() / 400) % 2 === 0) {
                    ctx.fillStyle = '#d32f2f'; ctx.font = "bold 14px 'Silkscreen', monospace";
                    ctx.textAlign = 'center'; ctx.fillText("--- DEMO MODE ---", gameCanvas.width / 2, 45);
                    ctx.textAlign = 'left';
                }
            } else if (s.phase === 'TRANSITION') {
                s.transitionFlashTimer++;
                ctx.fillStyle = (Math.floor(s.transitionFlashTimer / 4) % 2 === 0) ? '#ffffff' : '#79d2b3';
                ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);
                ctx.fillStyle = '#000'; ctx.font = "bold 22px 'Silkscreen', monospace";
                ctx.textAlign = 'center'; ctx.fillText("JUMP!", gameCanvas.width / 2, gameCanvas.height / 2);
                ctx.textAlign = 'left';
                if (s.transitionFlashTimer > 30) { s.phase = 'PLAYING'; resetDoodleWorld(); }
            } else if (s.phase === 'GAMEOVER') {
                ctx.fillStyle = '#333'; ctx.font = "16px 'Silkscreen', monospace"; ctx.textAlign = "center";
                ctx.fillText("GAME OVER", gameCanvas.width / 2, gameCanvas.height / 2 - 10);
                ctx.font = "10px 'Silkscreen', monospace";
                ctx.fillText("Click / Press Button to Restart", gameCanvas.width / 2, gameCanvas.height / 2 + 15);
                ctx.textAlign = "left";
            }

            gameAnimationId = requestAnimationFrame(doodleLoop);
        }

        function resetDoodleWorld() {
            const s = doodleState;
            s.score = 0; s.cat.x = 228; s.cat.y = 150; s.cat.vx = 0; s.cat.vy = 0;
            s.platforms = [
                { x: 210, y: 220, width: 60, height: 10, isSpring: false },
                { x: 130, y: 180, width: 58, height: 10, isSpring: false },
                { x: 280, y: 140, width: 58, height: 10, isSpring: true },
                { x: 100, y: 100, width: 58, height: 10, isSpring: false },
                { x: 230, y: 60, width: 58, height: 10, isSpring: false },
                { x: 150, y: 20, width: 58, height: 10, isSpring: false }
            ];
        }

