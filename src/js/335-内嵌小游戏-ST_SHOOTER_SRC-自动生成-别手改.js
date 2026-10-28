        // ==== BEGIN ST_SHOOTER_SRC（自动生成 · 改游戏请重跑 _verify/_mk-shooter-embed.js）====
        // 复古线框战机（`retro_vector_space_shooter`）的整份源码，内联在这里。
        // 小游戏弹窗把它当 `srcdoc` 喂给 iframe —— 见 stShooterMount()。
        // ⚠ 放在 `<script>` 的**最末尾**是故意的：这样它上面所有行号锚点都不动。
        // ⚠ 这里面是转义过的（`\\` / `` \` `` / `\${` / `<\/script` / `<\!--`），
        //   五个规则各挡一个解析器 —— 别手改，改游戏源文件然后重跑生成脚本。
        const ST_SHOOTER_SRC = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>VECTOR SHOT - 复古线框战机 (AI 增强版)</title>
    <script src="https://cdn.tailwindcss.com"><\/script>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&display=swap');

        * {
            user-select: none;
            -webkit-user-select: none;
            touch-action: none;
        }

        body {
            background-color: #050508;
            font-family: 'Orbitron', monospace, sans-serif;
            overflow: hidden;
            color: #00ffcc;
        }

        /* CRT Glow Effect */
        .crt-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: linear-gradient(
                rgba(18, 16, 16, 0) 50%, 
                rgba(0, 0, 0, 0.25) 50%
            ), linear-gradient(
                90deg,
                rgba(255, 0, 0, 0.03),
                rgba(0, 255, 0, 0.01),
                rgba(0, 0, 255, 0.03)
            );
            background-size: 100% 3px, 6px 100%;
            pointer-events: none;
            z-index: 50;
        }

        .crt-glow {
            text-shadow: 0 0 8px currentColor;
        }

        .vector-box {
            background: rgba(10, 15, 25, 0.88);
            border: 2px solid #00ffcc;
            box-shadow: 0 0 15px rgba(0, 255, 204, 0.3), inset 0 0 15px rgba(0, 255, 204, 0.2);
        }

        .vector-box-pink {
            background: rgba(25, 10, 20, 0.88);
            border: 2px solid #ff0077;
            box-shadow: 0 0 15px rgba(255, 0, 119, 0.3), inset 0 0 15px rgba(255, 0, 119, 0.2);
        }

        .vector-btn {
            transition: all 0.2s ease;
            position: relative;
            overflow: hidden;
        }

        .vector-btn:hover {
            background: #00ffcc;
            color: #000;
            box-shadow: 0 0 20px #00ffcc;
        }

        /* Custom Scrollbar for plane selector */
        ::-webkit-scrollbar {
            width: 6px;
        }
        ::-webkit-scrollbar-track {
            background: #050508;
        }
        ::-webkit-scrollbar-thumb {
            background: #00ffcc;
            border-radius: 3px;
        }

        @keyframes pulseGlow {
            0%, 100% { opacity: 0.8; transform: scale(1); }
            50% { opacity: 1; transform: scale(1.02); }
        }
        .ai-pulse {
            animation: pulseGlow 2s infinite ease-in-out;
        }

        /* 水母机的激光会扫过 HUD 区域，纯发光文字压在亮色光束上会糊掉。
           加一圈暗色描边保证可读 —— 在黑色背景上这圈描边完全看不见，
           所以对其他战机的外观没有任何影响。 */
        #hud-overlay .hud-readable {
            text-shadow: 0 0 8px currentColor,
                         1px 0 0 #050508, -1px 0 0 #050508,
                         0 1px 0 #050508, 0 -1px 0 #050508,
                         1px 1px 0 #050508, -1px -1px 0 #050508,
                         1px -1px 0 #050508, -1px 1px 0 #050508;
        }

        /* 窄视口下 HUD 会横向溢出。三栏自然宽度约 611px
           （左 w-48=192 + 中 max-w-xs=320 + 右 PAUSE=75 + p-3 24），390px 手机里塞不下。
           flex 子项默认 min-width:auto 不肯收缩，于是挤压全落在左栏（实测 192px → 69.6px，
           "100 / 100" 被迫折行），右栏的 PAUSE 按钮被整个推出屏幕（实测 x 396.8→471.5）——
           手机上根本点不到暂停。标准战机同样如此，是原版就有的响应式缺陷。
           窄视口下改为两行：第一行 状态条 + PAUSE，第二行 中央信息占满整宽。 */
        @media (max-width: 620px) {
            #hud-overlay { flex-wrap: wrap; row-gap: 0.375rem; }
            #hud-left { order: 1; width: 8rem; }
            #hud-right { order: 2; margin-left: auto; }
            #hud-center { order: 3; flex: 1 1 100%; max-width: none; min-width: 0; }
            #hp-text, #shield-text { white-space: nowrap; }
            #hud-meta { flex-wrap: wrap; }
            /* min-width:auto 会把 min-content 一路向上传递：ai-radio-text 是 nowrap，
               它的 min-content 就是整段文字宽（实测 234.7px），于是 ai-radio-box 的
               min-content 变成 315.2px，中栏也就卡在 315.2px 不肯收缩（320px 视口下溢出 7px）。
               中栏本体的 min-width:0 才是关键 —— 让它可以收到 100% 基准宽，
               再由文字这层的 min-width:0 真正触发 ellipsis 截断。两层都要。 */
            #ai-radio-box, #ai-radio-text { min-width: 0; }
        }
    </style>
</head>
<body class="h-screen w-screen flex flex-col justify-center items-center relative select-none">
    <div class="crt-overlay"></div>

    <\!-- Main Game Canvas Container -->
    <div id="game-container" class="relative w-full h-full max-w-4xl max-h-[900px] flex justify-center items-center">
        <canvas id="gameCanvas" class="block w-full h-full bg-black cursor-crosshair"></canvas>

        <\!-- UI Screen: Select Ship -->
        <div id="ship-select-screen" class="absolute inset-0 z-20 flex flex-col items-center justify-between p-4 bg-black/90 text-white overflow-y-auto">
            <div class="text-center mt-2">
                <h1 class="text-3xl md:text-5xl font-black text-cyan-400 crt-glow tracking-widest mb-1">VECTOR SHOT</h1>
                <p class="text-xs md:text-sm text-gray-400 tracking-wider">选择你的战机以启动任务 | AI 战术指挥系统在线</p>
            </div>

            <\!-- Ship Cards Container -->
            <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 w-full my-auto max-w-6xl px-2">
                <\!-- Ship 1: Standard -->
                <div onclick="selectShip(0)" class="ship-card vector-box p-3 rounded-lg flex flex-col justify-between cursor-pointer hover:scale-105 transition-transform border-cyan-400">
                    <div>
                        <div class="text-center font-bold text-cyan-300 text-lg border-b border-cyan-500/40 pb-1 mb-2">标准战机</div>
                        <div class="text-xs space-y-1 text-gray-300">
                            <p><span class="text-cyan-400">生命:</span> 100 HP</p>
                            <p><span class="text-cyan-400">射速:</span> 3发/秒</p>
                            <p><span class="text-cyan-400">初始弹幕:</span> 品字(3发)</p>
                            <p><span class="text-cyan-400">得分倍率:</span> 1.0x</p>
                        </div>
                    </div>
                    <div class="mt-3 text-center text-xs bg-cyan-950/60 py-1 border border-cyan-500/50 rounded text-cyan-300">均衡型配置</div>
                </div>

                <\!-- Ship 2: High Freq -->
                <div onclick="selectShip(1)" class="ship-card vector-box p-3 rounded-lg flex flex-col justify-between cursor-pointer hover:scale-105 transition-transform border-yellow-400">
                    <div>
                        <div class="text-center font-bold text-yellow-300 text-lg border-b border-yellow-500/40 pb-1 mb-2">高频轻型机</div>
                        <div class="text-xs space-y-1 text-gray-300">
                            <p><span class="text-yellow-400">生命:</span> 50 HP <span class="text-red-400 text-[10px]">(-50%)</span></p>
                            <p><span class="text-yellow-400">射速:</span> 6发/秒 <span class="text-green-400 text-[10px]">(+100%)</span></p>
                            <p><span class="text-yellow-400">初始弹幕:</span> 品字(3发)</p>
                            <p><span class="text-yellow-400">得分倍率:</span> 1.0x</p>
                        </div>
                    </div>
                    <div class="mt-3 text-center text-xs bg-yellow-950/60 py-1 border border-yellow-500/50 rounded text-yellow-300">极速输出 / 薄皮</div>
                </div>

                <\!-- Ship 3: Wingman Spec -->
                <div onclick="selectShip(2)" class="ship-card vector-box p-3 rounded-lg flex flex-col justify-between cursor-pointer hover:scale-105 transition-transform border-purple-400">
                    <div>
                        <div class="text-center font-bold text-purple-300 text-lg border-b border-purple-500/40 pb-1 mb-2">双僚机协同</div>
                        <div class="text-xs space-y-1 text-gray-300">
                            <p><span class="text-purple-400">生命:</span> 100 HP</p>
                            <p><span class="text-purple-400">射速:</span> 1发/秒 <span class="text-red-400 text-[10px]">(主机/僚机)</span></p>
                            <p><span class="text-purple-400">特性:</span> 2台火力僚机</p>
                            <p><span class="text-purple-400">得分倍率:</span> 1.0x</p>
                        </div>
                    </div>
                    <div class="mt-3 text-center text-xs bg-purple-950/60 py-1 border border-purple-500/50 rounded text-purple-300">三路打击 / 升级共享</div>
                </div>

                <\!-- Ship 4: Cheater -->
                <div onclick="selectShip(3)" class="ship-card vector-box-pink p-3 rounded-lg flex flex-col justify-between cursor-pointer hover:scale-105 transition-transform border-pink-500">
                    <div>
                        <div class="text-center font-bold text-pink-300 text-lg border-b border-pink-500/40 pb-1 mb-2">无敌作弊机</div>
                        <div class="text-xs space-y-1 text-gray-300">
                            <p><span class="text-pink-400">生命/护盾:</span> 200/200</p>
                            <p><span class="text-pink-400">射速:</span> 5发/秒</p>
                            <p><span class="text-pink-400">弹幕:</span> 满级V阵+双僚机</p>
                            <p><span class="text-pink-400">得分:</span> 0.1倍 <span class="text-red-400 text-[10px]">(惩罚)</span></p>
                        </div>
                    </div>
                    <div class="mt-3 text-center text-xs bg-pink-950/60 py-1 border border-pink-500/50 rounded text-pink-300">新手爽快体验</div>
                </div>

                <\!-- Ship 5: Jellyfish Laser Sweeper -->
                <div onclick="selectShip(4)" class="ship-card vector-box p-3 rounded-lg flex flex-col justify-between cursor-pointer hover:scale-105 transition-transform border-fuchsia-400">
                    <div>
                        <div class="text-center font-bold text-fuchsia-300 text-lg border-b border-fuchsia-500/40 pb-1 mb-2">水母激光机</div>
                        <div class="text-xs space-y-1 text-gray-300">
                            <p><span class="text-fuchsia-400">生命:</span> 80 HP</p>
                            <p><span class="text-fuchsia-400">射速:</span> 持续激光</p>
                            <p><span class="text-fuchsia-400">弹幕:</span> 全场穿透扫射</p>
                            <p><span class="text-fuchsia-400">得分倍率:</span> 1.0x</p>
                        </div>
                    </div>
                    <div class="mt-3 text-center text-xs bg-fuchsia-950/60 py-1 border border-fuchsia-500/50 rounded text-fuchsia-300">升级增加激光道数</div>
                </div>
            </div>

            <\!-- Controls Info Footnote -->
            <div class="text-center text-xs text-gray-400 border-t border-gray-800 pt-3 w-full max-w-2xl">
                <p>🎮 操控模式：键盘 [WASD/方向键] + [J/空格开火] | 鼠标/触摸 [按住拖拽自动开火]</p>
                <p class="text-yellow-400/80 mt-1">⚠️ 触控/鼠标模式下松开屏幕将自动暂停游戏</p>
            </div>
        </div>

        <\!-- In-game HUD -->
        <div id="hud-overlay" class="absolute top-0 left-0 right-0 p-3 flex justify-between items-start pointer-events-none hidden z-10">
            <\!-- Left Stats (HP & Shield Bars) -->
            <div id="hud-left" class="w-48 md:w-64 space-y-1.5">
                <\!-- HP Bar -->
                <div>
                    <div class="flex justify-between text-[11px] font-bold text-green-400 mb-0.5">
                        <span>HP</span>
                        <span id="hp-text">100 / 100</span>
                    </div>
                    <div class="w-full h-2.5 bg-gray-900 border border-green-500/50 rounded-sm p-0.5">
                        <div id="hp-bar" class="h-full bg-green-500 rounded-sm transition-all duration-150" style="width: 100%;"></div>
                    </div>
                </div>
                <\!-- Shield Bar -->
                <div>
                    <div class="flex justify-between text-[11px] font-bold text-cyan-400 mb-0.5">
                        <span>SHIELD</span>
                        <span id="shield-text">0 / 100</span>
                    </div>
                    <div class="w-full h-2 bg-gray-900 border border-cyan-500/50 rounded-sm p-0.5">
                        <div id="shield-bar" class="h-full bg-cyan-400 rounded-sm transition-all duration-150" style="width: 0%;"></div>
                    </div>
                </div>
            </div>

            <\!-- Center Info & Live AI Wingman Radio -->
            <div id="hud-center" class="text-center pointer-events-auto max-w-xs md:max-w-md">
                <div id="bonus-banner" class="hidden text-xs md:text-sm font-black text-yellow-300 bg-yellow-950/80 border border-yellow-400 rounded px-2 py-0.5 mb-1 animate-pulse crt-glow">
                    ⭐ BONUS WAVE! 10X SCORE (12s) ⭐
                </div>
                <div id="boss-warning-banner" class="hidden text-xs md:text-base font-black text-red-500 bg-red-950/90 border-2 border-red-500 rounded px-3 py-1 mb-1 animate-bounce crt-glow tracking-widest">
                    ⚠️ WARNING: HUGE ENEMY DETECTED ⚠️
                </div>
                <div id="boss-hp-container" class="hidden w-full bg-black/80 border border-red-500 rounded p-1 mb-1 shadow-lg">
                    <div class="flex justify-between text-[10px] font-bold text-red-400 mb-0.5">
                        <span id="boss-name-text">BOSS: DREADNOUGHT</span>
                        <span id="boss-hp-text">200 / 200</span>
                    </div>
                    <div class="w-full h-3 bg-gray-900 border border-red-500/60 rounded-sm">
                        <div id="boss-hp-bar" class="h-full bg-gradient-to-r from-red-600 via-orange-500 to-yellow-400 rounded-sm transition-all duration-100" style="width: 100%;"></div>
                    </div>
                </div>
                <div class="text-2xl font-black text-cyan-300 tracking-wider crt-glow hud-readable" id="score-text">000000</div>
                <div id="hud-meta" class="text-[10px] text-gray-400 tracking-widest mt-0.5 flex justify-center gap-3">
                    <span class="hud-readable" id="bullet-level-text">弹幕 LEVEL 1 (3发)</span>
                    <span id="bonus-progress-text" class="text-yellow-400 hud-readable">奖励波进度: 0/50</span>
                </div>
                <\!-- AI Radio Broadcast -->
                <div id="ai-radio-box" class="mt-2 bg-black/80 border border-purple-500/60 rounded px-2.5 py-1 text-[11px] text-purple-300 flex items-center justify-between gap-2 hidden">
                    <span id="ai-radio-text" class="truncate text-left">📡 HQ: 战术无线电连接建立...</span>
                </div>
            </div>

            <\!-- Right Controls -->
            <div id="hud-right" class="pointer-events-auto flex flex-col items-end gap-1">
                <button id="pause-btn" onclick="togglePause()" class="px-3 py-1 border border-cyan-400 text-cyan-400 text-xs rounded hover:bg-cyan-400/20 vector-btn">
                    PAUSE [P]
                </button>
            </div>
        </div>

        <\!-- Pause Screen Overlay -->
        <div id="pause-screen" class="absolute inset-0 bg-black/80 z-30 flex flex-col justify-center items-center hidden p-4">
            <h2 class="text-4xl font-black text-yellow-400 crt-glow mb-2">GAME PAUSED</h2>
            <p class="text-sm text-gray-300 mb-6" id="pause-tip">按 P 键或按住屏幕继续游戏</p>

            <div class="flex flex-col sm:flex-row gap-3">
                <button onclick="togglePause()" class="px-5 py-2 border-2 border-yellow-400 text-yellow-400 font-bold rounded vector-btn">
                    RESUME [继续]
                </button>
                <button onclick="restartGame()" class="px-5 py-2 border-2 border-cyan-400 text-cyan-400 font-bold rounded vector-btn">
                    RESTART [重新开始]
                </button>
                <button onclick="showShipSelect()" class="px-5 py-2 border-2 border-gray-500 text-gray-300 font-bold rounded hover:border-white">
                    SHIP [更换战机]
                </button>
            </div>
        </div>

        <\!-- Game Over Screen -->
        <div id="game-over-screen" class="absolute inset-0 bg-black/95 z-30 flex flex-col justify-center items-center hidden p-4 overflow-y-auto">
            <h2 class="text-4xl md:text-5xl font-black text-red-500 crt-glow mb-2 tracking-wider">GAME OVER</h2>
            
            <div class="vector-box p-5 rounded-lg text-center my-3 w-full max-w-lg">
                <div class="grid grid-cols-2 gap-2 mb-3 border-b border-cyan-500/30 pb-3">
                    <div>
                        <p class="text-[10px] text-gray-400 mb-0.5">FINAL SCORE</p>
                        <p class="text-2xl font-black text-cyan-300" id="final-score">0</p>
                    </div>
                    <div>
                        <p class="text-[10px] text-gray-400 mb-0.5">ENEMIES DESTROYED</p>
                        <p class="text-2xl font-black text-white" id="final-kills">0</p>
                    </div>
                </div>

            </div>

            <div class="flex gap-4 mt-2">
                <button onclick="restartGame()" class="px-5 py-2 border-2 border-cyan-400 text-cyan-400 font-bold rounded vector-btn">
                    TRY AGAIN
                </button>
                <button onclick="showShipSelect()" class="px-5 py-2 border-2 border-gray-500 text-gray-300 font-bold rounded hover:border-white">
                    SELECT SHIP
                </button>
            </div>
        </div>
    </div>

    <script>
        // --- GAME ENGINE & STATE CONFIGURATION ---
        const canvas = document.getElementById('gameCanvas');
        const ctx = canvas.getContext('2d');
        const container = document.getElementById('game-container');

        // Ship Preset Configurations
        const SHIP_PRESETS = [
            { name: "标准战机", hpMax: 100, shieldMax: 100, fireRate: 3, wingmen: false, cheater: false, scoreMult: 1.0 },
            { name: "高频轻型机", hpMax: 50, shieldMax: 100, fireRate: 6, wingmen: false, cheater: false, scoreMult: 1.0 },
            { name: "双僚机协同机", hpMax: 100, shieldMax: 100, fireRate: 1.0, wingmen: true, cheater: false, scoreMult: 1.0 },
            { name: "无敌作弊机", hpMax: 200, shieldMax: 200, fireRate: 5.0, wingmen: true, cheater: true, scoreMult: 0.1 },
            { name: "水母激光机", hpMax: 80, shieldMax: 100, fireRate: 1.0, wingmen: false, cheater: false, scoreMult: 1.0, jellyfish: true }
        ];

        let selectedShipIdx = 0;
        let gameState = "MENU"; // MENU, PLAYING, PAUSED, GAMEOVER
        let score = 0;
        let killCount = 0;
        let normalKillCount = 0; // 正常击杀计数，达到50触发奖励波
        let isBonusWave = false;
        let bonusWaveTimer = 0;
        let bonusSpawnTimer = 0;
        let lastTime = 0;
        let autoShoot = true;
        let gameStartTime = 0;
        let gameDurationSeconds = 0;

        let boss = null;
        let isBossWarning = false;
        let bossWarningTimer = 0;
        let nextBossKillThreshold = 100;
        let bossTypeCycle = 0; // 0: Dreadnought, 1: Cyber Hex, 2: Star Destroyer

        // Controls
        const keys = {};
        let touchActive = false;
        let touchPos = { x: 0, y: 0 };
        let mouseControl = false;

        // Game Objects
        let player;
        let playerBullets = [];
        let enemyBullets = [];
        let enemies = [];
        let powerups = [];
        let particles = [];
        let stars = [];

        // 战场无线电文字缓存（TTS 已移除，这里只保留文字显示）
        let currentRadioText = "";
        // Live In-Game AI Radio Callouts
        function triggerAIRadioChatter(msg) {
            const radioBox = document.getElementById('ai-radio-box');
            const radioText = document.getElementById('ai-radio-text');
            currentRadioText = msg;
            radioText.innerText = \`📡 \${msg}\`;
            radioBox.classList.remove('hidden');

            setTimeout(() => {
                if (currentRadioText === msg) {
                    radioBox.classList.add('hidden');
                }
            }, 6000);
        }

        // Dynamic Resize Logic
        function resizeCanvas() {
            const rect = container.getBoundingClientRect();
            canvas.width = rect.width;
            canvas.height = rect.height;
            initStarfield();
        }
        window.addEventListener('resize', resizeCanvas);

        // --- STARFIELD BACKGROUND ---
        function initStarfield() {
            stars = [];
            for (let i = 0; i < 60; i++) {
                stars.push({
                    x: Math.random() * canvas.width,
                    y: Math.random() * canvas.height,
                    speed: 0.5 + Math.random() * 2,
                    size: Math.random() * 2 + 0.5,
                    color: Math.random() > 0.5 ? '#00ffcc' : '#ff00aa'
                });
            }
        }

        // --- PLAYER CLASS ---
        class Player {
            constructor(preset) {
                this.width = 32;
                this.height = 36;
                this.x = canvas.width / 2;
                this.y = canvas.height - 100;
                this.speed = 350; // pixels per sec
                
                this.preset = preset;
                this.hpMax = preset.hpMax;
                this.hp = preset.hpMax;
                this.shieldMax = preset.shieldMax;
                this.shield = preset.cheater ? preset.shieldMax : 0;
                
                this.fireRate = preset.fireRate;
                this.fireTimer = 0;
                this.bulletLevel = preset.cheater ? 4 : 1;
                
                this.hasWingmen = preset.wingmen;
                this.invulnerableTimer = 0;

                // --- 水母机专属：穿透扫射激光阵列 ---
                this.isJellyfish = !!preset.jellyfish;
                this.lasers = [];
                this.jellyPulse = 0;
                this.rebuildLasers();
            }

            update(dt) {
                if (this.invulnerableTimer > 0) {
                    this.invulnerableTimer -= dt;
                }

                // Keyboard Movement
                let dx = 0;
                let dy = 0;
                if (keys['KeyA'] || keys['ArrowLeft']) dx -= 1;
                if (keys['KeyD'] || keys['ArrowRight']) dx += 1;
                if (keys['KeyW'] || keys['ArrowUp']) dy -= 1;
                if (keys['KeyS'] || keys['ArrowDown']) dy += 1;

                if (dx !== 0 && dy !== 0) {
                    dx *= 0.7071;
                    dy *= 0.7071;
                }

                this.x += dx * this.speed * dt;
                this.y += dy * this.speed * dt;

                // Mouse / Touch Direct Position Interpolation
                if (mouseControl && touchActive) {
                    const targetX = touchPos.x;
                    const targetY = touchPos.y - 30;
                    this.x += (targetX - this.x) * 15 * dt;
                    this.y += (targetY - this.y) * 15 * dt;
                }

                // Screen Bounds
                this.x = Math.max(this.width / 2, Math.min(canvas.width - this.width / 2, this.x));
                this.y = Math.max(this.height / 2, Math.min(canvas.height - this.height / 2, this.y));

                // 水母机：不发射子弹，改为驱动持续扫射的穿透激光阵列
                if (this.isJellyfish) {
                    this.jellyPulse += dt;
                    this.updateLasers(dt);
                    return;
                }

                // Shooting Logic
                this.fireTimer += dt;
                const fireInterval = 1 / this.fireRate;
                const wantingToShoot = (keys['KeyJ'] || keys['Space'] || touchActive || autoShoot);

                if (wantingToShoot && this.fireTimer >= fireInterval) {
                    this.shoot();
                    this.fireTimer = 0;
                }
            }

            shoot() {
                this.spawnVBullets(this.x, this.y - 15, this.bulletLevel);

                if (this.hasWingmen) {
                    this.spawnVBullets(this.x - 30, this.y + 10, Math.min(2, this.bulletLevel));
                    this.spawnVBullets(this.x + 30, this.y + 10, Math.min(2, this.bulletLevel));
                }
            }

            spawnVBullets(originX, originY, level) {
                const bulletCount = 1 + level * 2;
                const angleStep = 0.08;

                for (let i = 0; i < bulletCount; i++) {
                    const indexOffset = i - Math.floor(bulletCount / 2);
                    const angle = indexOffset * angleStep - Math.PI / 2;
                    const offsetY = Math.abs(indexOffset) * 6;

                    playerBullets.push(new PlayerBullet(
                        originX + indexOffset * 4,
                        originY + offsetY,
                        Math.cos(angle) * 600,
                        Math.sin(angle) * 600
                    ));
                }
            }

            takeDamage(amount) {
                if (this.invulnerableTimer > 0) return;

                if (this.shield > 0) {
                    if (this.shield >= amount) {
                        this.shield -= amount;
                        amount = 0;
                    } else {
                        amount -= this.shield;
                        this.shield = 0;
                    }
                }

                this.hp -= amount;
                this.invulnerableTimer = 0.2;

                createExplosion(this.x, this.y, '#00ffcc', 12);

                if (this.hp <= 0) {
                    this.hp = 0;
                    gameOver();
                } else if (this.hp < 30) {
                    triggerAIRadioChatter("警告：装甲严重受损！寻找治疗宝箱！");
                }
                updateHUD();
            }

            draw() {
                ctx.save();
                ctx.translate(this.x, this.y);

                if (this.invulnerableTimer > 0 && Math.floor(Date.now() / 50) % 2 === 0) {
                    ctx.globalAlpha = 0.5;
                }

                if (this.shield > 0) {
                    ctx.strokeStyle = '#00f0ff';
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.arc(0, 0, 26, 0, Math.PI * 2);
                    ctx.shadowColor = '#00f0ff';
                    ctx.shadowBlur = 10;
                    ctx.stroke();
                }

                // 水母机使用独立的生物荧光造型
                if (this.isJellyfish) {
                    this.drawJellyfish();
                    ctx.restore();
                    return;
                }

                ctx.strokeStyle = '#00ffcc';
                ctx.lineWidth = 2;
                ctx.shadowColor = '#00ffcc';
                ctx.shadowBlur = 8;

                ctx.beginPath();
                ctx.moveTo(0, -this.height / 2);
                ctx.lineTo(this.width / 2, this.height / 3);
                ctx.lineTo(this.width / 4, this.height / 2);
                ctx.lineTo(0, this.height / 3);
                ctx.lineTo(-this.width / 4, this.height / 2);
                ctx.lineTo(-this.width / 2, this.height / 3);
                ctx.closePath();
                ctx.stroke();

                ctx.beginPath();
                ctx.moveTo(0, -10);
                ctx.lineTo(5, 5);
                ctx.lineTo(-5, 5);
                ctx.closePath();
                ctx.stroke();

                if (this.hasWingmen) {
                    this.drawWingman(-30, 10);
                    this.drawWingman(30, 10);
                }

                ctx.restore();
            }

            drawWingman(ox, oy) {
                ctx.save();
                ctx.translate(ox, oy);
                ctx.strokeStyle = '#ff00aa';
                ctx.lineWidth = 1.5;
                ctx.shadowColor = '#ff00aa';
                ctx.shadowBlur = 6;

                ctx.beginPath();
                ctx.moveTo(0, -10);
                ctx.lineTo(10, 8);
                ctx.lineTo(0, 4);
                ctx.lineTo(-10, 8);
                ctx.closePath();
                ctx.stroke();
                ctx.restore();
            }

            // ===== 水母机激光系统 =====
            // 火力升级 = 增加激光道数：
            //  Lv1~Lv3 主激光 1~3 道（正前方扇形来回扫射）
            //  Lv4     4 主 + 2 环绕卫星激光（绕机身 360° 旋转）  = 6 道
            //  Lv5     4 主 + 4 环绕 + 2 横向上下扫射              = 10 道多方向全场激光
            rebuildLasers() {
                this.lasers = [];
                if (!this.isJellyfish) return;

                const L = this.bulletLevel;
                const mainCount = Math.min(L, 4);

                // 主激光：都在正前方扇形内来回扫射。
                // 相位偏移必须小 —— 偏移一大，只有第一道能指向正前方，
                // 升级就成了纯观赏（实测过：相位 1.9/3.8 时 Lv3 对 Boss 的 DPS 与 Lv1 完全相同）。
                // 靠不同的扫射频率让它们逐渐错开，而不是靠大相位。
                for (let i = 0; i < mainCount; i++) {
                    this.lasers.push(new LaserBeam({
                        originMode: 'player',
                        baseAngle: -Math.PI / 2,
                        sweepAmp: 0.95 - i * 0.06,
                        sweepSpeed: 1.85 + i * 0.41,
                        phase: i * 0.26,
                        width: 16 - i * 1.6,
                        innerGap: 22,
                        color: '#00f0ff',
                        damage: 4,
                        tick: 0.11
                    }));
                }

                const orbitCount = L >= 5 ? 4 : (L >= 4 ? 2 : 0);
                for (let i = 0; i < orbitCount; i++) {
                    this.lasers.push(new LaserBeam({
                        originMode: 'orbit',
                        orbitRadius: 48,
                        orbitAngle: (i * Math.PI * 2) / orbitCount,
                        orbitSpeed: 2.4,
                        baseAngle: 0,
                        rotSpeed: (i % 2 === 0 ? 1 : -1) * 2.3,
                        phase: i * 1.57,
                        width: 11,
                        color: '#ff00aa',
                        damage: 3,
                        tick: 0.11
                    }));
                }

                if (L >= 5) {
                    for (let i = 0; i < 2; i++) {
                        this.lasers.push(new LaserBeam({
                            originMode: 'player',
                            baseAngle: i === 0 ? 0 : Math.PI,
                            sweepAmp: 0.8,
                            sweepSpeed: 1.3,
                            phase: i * Math.PI,
                            width: 13,
                            innerGap: 22,
                            color: '#a855f7',
                            damage: 3,
                            tick: 0.11
                        }));
                    }
                }
            }

            updateLasers(dt) {
                for (let i = 0; i < this.lasers.length; i++) {
                    this.lasers[i].update(dt, this);
                }
            }

            drawLasers() {
                if (!this.isJellyfish || gameState !== 'PLAYING') return;
                for (let i = 0; i < this.lasers.length; i++) {
                    this.lasers[i].draw();
                }
            }

            // 水母造型：脉动伞盖 + 摆动触须
            drawJellyfish() {
                const p = Math.sin(this.jellyPulse * 2.2);
                const sx = 1 + p * 0.09;
                const sy = 1 - p * 0.09;

                ctx.save();
                ctx.scale(sx, sy);

                // 伞盖：宽扁的穹顶 + 波浪状下缘
                ctx.strokeStyle = '#00f0ff';
                ctx.lineWidth = 2;
                ctx.shadowColor = '#00f0ff';
                ctx.shadowBlur = 12;
                ctx.beginPath();
                ctx.ellipse(0, -2, 18, 13, 0, Math.PI, 0);
                ctx.quadraticCurveTo(14, 7, 9, 3);
                ctx.quadraticCurveTo(4.5, 8, 0, 3);
                ctx.quadraticCurveTo(-4.5, 8, -9, 3);
                ctx.quadraticCurveTo(-14, 7, -18, -2);
                ctx.closePath();
                ctx.stroke();

                // 内伞
                ctx.strokeStyle = '#a855f7';
                ctx.shadowColor = '#a855f7';
                ctx.lineWidth = 1.4;
                ctx.shadowBlur = 8;
                ctx.beginPath();
                ctx.ellipse(0, -2, 10, 7, 0, Math.PI, 0);
                ctx.quadraticCurveTo(4, 4, 0, 2);
                ctx.quadraticCurveTo(-4, 4, -10, -2);
                ctx.closePath();
                ctx.stroke();

                // 核心光点
                ctx.fillStyle = '#e6ffff';
                ctx.shadowColor = '#ffffff';
                ctx.shadowBlur = 10;
                ctx.beginPath();
                ctx.arc(0, -4, 2.2, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();

                // 触须
                ctx.strokeStyle = '#ff00aa';
                ctx.shadowColor = '#ff00aa';
                ctx.shadowBlur = 8;
                ctx.lineWidth = 1.6;
                for (let i = 0; i < 6; i++) {
                    const tx = -15 + i * 6;
                    const seed = i * 1.27;
                    const len = 16 + Math.sin(this.jellyPulse * 2.6 + seed) * 5;
                    const sway = Math.sin(this.jellyPulse * 2.0 + seed) * 3.2;
                    ctx.beginPath();
                    ctx.moveTo(tx, 6);
                    ctx.quadraticCurveTo(tx + sway, 6 + len * 0.55, tx + sway * 1.7, 6 + len);
                    ctx.stroke();
                }
            }
        }

        // --- 水母机穿透扫射激光 ---
        // 点到线段的距离（用于激光的胶囊形命中判定）
        // 线段上离 (px,py) 最近的点。激光命中判定要用它 —— Boss 剪影是个椭圆而不是圆，
        // 得把「光束中心线上离 Boss 最近的那个点」代进椭圆方程才有意义。
        function closestPointOnSegment(px, py, x1, y1, x2, y2) {
            const dx = x2 - x1;
            const dy = y2 - y1;
            const lenSq = dx * dx + dy * dy;
            let t = lenSq > 0 ? ((px - x1) * dx + (py - y1) * dy) / lenSq : 0;
            t = t < 0 ? 0 : (t > 1 ? 1 : t);
            return { x: x1 + t * dx, y: y1 + t * dy };
        }

        function distToSegment(px, py, x1, y1, x2, y2) {
            const c = closestPointOnSegment(px, py, x1, y1, x2, y2);
            return Math.hypot(px - c.x, py - c.y);
        }

        let _laserUid = 0;

        // 一条持续存在、全场穿透的激光束。它不会因击中目标而消失，
        // 而是对每个目标按 tick 间隔持续结算伤害。
        class LaserBeam {
            constructor(cfg = {}) {
                this.uid = ++_laserUid;
                this.originMode = cfg.originMode || 'player'; // player | orbit
                this.baseAngle = cfg.baseAngle !== undefined ? cfg.baseAngle : -Math.PI / 2;
                this.sweepAmp = cfg.sweepAmp || 0;
                this.sweepSpeed = cfg.sweepSpeed || 0;
                this.rotSpeed = cfg.rotSpeed || 0;
                this.phase = cfg.phase || 0;
                this.orbitRadius = cfg.orbitRadius || 0;
                this.orbitAngle = cfg.orbitAngle || 0;
                this.orbitSpeed = cfg.orbitSpeed || 0;
                this.width = cfg.width || 12;
                this.innerGap = cfg.innerGap || 0; // 起始点离机身的距离，避免光束糊住机身
                this.color = cfg.color || '#00f0ff';
                this.damage = cfg.damage !== undefined ? cfg.damage : 3;
                this.tick = cfg.tick || 0.11;

                this.t = Math.random() * 10; // 随机初始相位，多道激光不会同步
                this.x = 0;
                this.y = 0;
                this.angle = this.baseAngle;
                this.prevAngle = this.baseAngle; // 上一帧角度，用于扫射的连续命中判定
                this.length = 1400;
                this.cooldowns = new Map(); // target -> 剩余冷却
            }

            update(dt, player) {
                this.t += dt;
                // 对角线长度就足以覆盖整个画面（光源最远也只可能在一个角上）
                this.length = Math.hypot(canvas.width, canvas.height) * 1.05;

                if (this.originMode === 'orbit') {
                    const oa = this.orbitAngle + this.t * this.orbitSpeed;
                    this.x = player.x + Math.cos(oa) * this.orbitRadius;
                    this.y = player.y + Math.sin(oa) * this.orbitRadius;
                } else {
                    this.x = player.x;
                    this.y = player.y;
                }

                // 正弦来回扫射 + 匀速旋转（卫星激光）
                this.prevAngle = this.angle;
                this.angle = this.baseAngle + this.phase
                    + Math.sin(this.t * this.sweepSpeed) * this.sweepAmp
                    + this.t * this.rotSpeed;

                if (this.cooldowns.size > 0) {
                    for (const [target, remain] of this.cooldowns) {
                        const next = remain - dt;
                        if (next <= 0) this.cooldowns.delete(target);
                        else this.cooldowns.set(target, next);
                    }
                }
            }

            getStart(angle) {
                const a = angle === undefined ? this.angle : angle;
                return {
                    x: this.x + Math.cos(a) * this.innerGap,
                    y: this.y + Math.sin(a) * this.innerGap
                };
            }

            getEnd(angle) {
                const a = angle === undefined ? this.angle : angle;
                return {
                    x: this.x + Math.cos(a) * this.length,
                    y: this.y + Math.sin(a) * this.length
                };
            }

            canHit(target) {
                return !this.cooldowns.has(target);
            }

            markHit(target) {
                this.cooldowns.set(target, this.tick);
            }

            draw() {
                const s = this.getStart();
                const e = this.getEnd();

                // 注意：这里刻意不用 ctx.shadowBlur。
                // 实测（headless 软件渲染，Lv5 十道激光）：给这条 1400px 长的线加 shadowBlur
                // 会让每帧从 17ms 涨到 330ms，而三层 alpha 描边已经足够做出辉光。
                ctx.save();
                ctx.lineCap = 'round';
                ctx.globalCompositeOperation = 'lighter';

                // 外层辉光
                ctx.strokeStyle = this.color;
                ctx.globalAlpha = 0.10;
                ctx.lineWidth = this.width * 2.6;
                ctx.beginPath();
                ctx.moveTo(s.x, s.y);
                ctx.lineTo(e.x, e.y);
                ctx.stroke();

                // 光束本体
                ctx.globalAlpha = 0.34;
                ctx.lineWidth = this.width;
                ctx.beginPath();
                ctx.moveTo(s.x, s.y);
                ctx.lineTo(e.x, e.y);
                ctx.stroke();

                // 高亮核心
                ctx.globalAlpha = 1;
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = Math.max(2, this.width * 0.36);
                ctx.beginPath();
                ctx.moveTo(s.x, s.y);
                ctx.lineTo(e.x, e.y);
                ctx.stroke();

                // 发射口光斑（同样用同心圆叠出光晕，避免 shadowBlur）
                ctx.fillStyle = this.color;
                ctx.globalAlpha = 0.16;
                ctx.beginPath(); ctx.arc(s.x, s.y, this.width * 0.95, 0, Math.PI * 2); ctx.fill();
                ctx.globalAlpha = 0.5;
                ctx.beginPath(); ctx.arc(s.x, s.y, this.width * 0.5, 0, Math.PI * 2); ctx.fill();
                ctx.globalAlpha = 1;
                ctx.fillStyle = '#ffffff';
                ctx.beginPath(); ctx.arc(s.x, s.y, this.width * 0.22, 0, Math.PI * 2); ctx.fill();

                ctx.restore();
            }
        }

        // --- BULLET CLASSES ---
        class PlayerBullet {
            constructor(x, y, vx, vy) {
                this.x = x;
                this.y = y;
                this.vx = vx;
                this.vy = vy;
                this.damage = 1;
                this.radius = 3;
            }

            update(dt) {
                this.x += this.vx * dt;
                this.y += this.vy * dt;
            }

            draw() {
                ctx.save();
                ctx.strokeStyle = '#00ffcc';
                ctx.lineWidth = 2;
                ctx.shadowColor = '#00ffcc';
                ctx.shadowBlur = 6;

                ctx.beginPath();
                ctx.moveTo(this.x, this.y);
                ctx.lineTo(this.x - this.vx * 0.03, this.y - this.vy * 0.03);
                ctx.stroke();
                ctx.restore();
            }
        }

        class EnemyBullet {
            constructor(x, y, vx, vy, type) {
                this.x = x;
                this.y = y;
                this.vx = vx;
                this.vy = vy;
                this.type = type;

                if (type === 'small') {
                    this.damage = 1;
                    this.radius = 3;
                    this.color = '#ffcc00';
                } else if (type === 'medium') {
                    this.damage = 5;
                    this.radius = 6;
                    this.color = '#ff6600';
                } else {
                    this.damage = 10;
                    this.radius = 10;
                    this.color = '#ff0055';
                }
            }

            update(dt) {
                this.x += this.vx * dt;
                this.y += this.vy * dt;
            }

            draw() {
                ctx.save();
                ctx.strokeStyle = this.color;
                ctx.lineWidth = 2;
                ctx.shadowColor = this.color;
                ctx.shadowBlur = 6;

                ctx.beginPath();
                ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
                ctx.stroke();

                if (this.type === 'large') {
                    ctx.beginPath();
                    ctx.moveTo(this.x - this.radius, this.y);
                    ctx.lineTo(this.x + this.radius, this.y);
                    ctx.moveTo(this.x, this.y - this.radius);
                    ctx.lineTo(this.x, this.y + this.radius);
                    ctx.stroke();
                }
                ctx.restore();
            }
        }

        // --- ENEMY CLASSES ---
        class Boss {
            constructor(typeIndex, hpMultiplier = 1) {
                this.typeIndex = typeIndex % 6;
                this.x = canvas.width / 2;
                this.y = -120; // Starts offscreen top
                this.targetY = 130;
                // width/height 在构造末尾按形态的实测剪影赋值，见 drawnHalfWidth。
                this.angle = 0;
                this.shootTimer = 0;
                this.moveTimer = 0;
                this.dx = 120; // Horizontal sweep speed

                // Distinct Boss Configurations (6 Giant Enemy Types)
                if (this.typeIndex === 0) {
                    this.name = "DREADNOUGHT SENTINEL (无畏要塞)";
                    this.maxHp = Math.floor(180 * hpMultiplier);
                    this.color = '#ff0055';
                    this.scoreValue = 8000;
                } else if (this.typeIndex === 1) {
                    this.name = "CYBER HEX CARRIER (六边超空战母)";
                    this.maxHp = Math.floor(250 * hpMultiplier);
                    this.color = '#aa00ff';
                    this.scoreValue = 12000;
                } else if (this.typeIndex === 2) {
                    this.name = "VECTOR STAR DESTROYER (星区歼灭舰)";
                    this.maxHp = Math.floor(320 * hpMultiplier);
                    this.color = '#00f0ff';
                    this.scoreValue = 16000;
                } else if (this.typeIndex === 3) {
                    this.name = "NEON DRAGON DREADWING (霓虹双翼巨龙)";
                    this.maxHp = Math.floor(380 * hpMultiplier);
                    this.color = '#ccff00';
                    this.scoreValue = 20000;
                } else if (this.typeIndex === 4) {
                    this.name = "VOID ECLIPSE LEVIATHAN (虚空日蚀巨兽)";
                    this.maxHp = Math.floor(450 * hpMultiplier);
                    this.color = '#ff00aa';
                    this.scoreValue = 25000;
                } else {
                    this.name = "CHRONO MATRIX CORE (时空矩阵核心)";
                    this.maxHp = Math.floor(520 * hpMultiplier);
                    this.color = '#ff66cc';
                    this.scoreValue = 30000;
                }

                this.hp = this.maxHp;

                // 真实绘制半宽/半高（已含 lineWidth 3 的一半）。六种形态的剪影差了一倍，
                // 拍一个固定值必然有一半对不上：
                //   [0] 八边形 r55 + 旋转炮塔 strokeRect(-75,-12,24,24) → hypot(75,12) ≈ 76（四向相同）
                //   [1] 机身 60 + 环绕节点 85 半径 10                      → 95（四向相同）
                //   [2] 后掠翼 ±80 / 机身上下 55·60                        → 80 × 60
                //   [3] 龙翼 ±85（含扑动）/ 上下 50                         → 85 × 50
                //   [4] 双环 48 / 上下 48·60                               → 48 × 60
                //   [5] 旋转 84 方框的对角 42·√2 ≈ 59.4                     → 59.4（四向相同）
                // ⚠ 这两个数组必须与 draw() 的几何保持一致。测试会拦 ctx 绘制调用实测
                //   每种形态的真实半径并与它比对（\`边界：Boss 绘制半径与声明一致\`），
                //   所以改了 draw() 却忘了改这里，套件会红。
                this.drawnHalfWidth = [78, 97, 82, 87, 50, 61][this.typeIndex];
                this.drawnHalfHeight = [78, 97, 62, 52, 62, 61][this.typeIndex];

                // 碰撞盒 = 剪影的外接盒。这里以前是写死的 140×110（半宽 70 / 半高 55），
                // 六个形态共用，于是两头都错：
                //   画出来打不到 —— 超空战母剪影 96.5 却只按 70 判中（差 26.5），
                //   看不见也能打到 —— 虚空巨兽剪影 49.5 却按 70 判中（多判 20.5）。
                // 三路判定（子弹矩形 / 激光 / 玩家撞机）都读 width/height，所以在这里
                // 统一按形态赋值，让「打得到的」和「看得见的」成为同一个东西。
                this.width = this.drawnHalfWidth * 2;
                this.height = this.drawnHalfHeight * 2;
            }

            update(dt) {
                // Entrance animation
                if (this.y < this.targetY) {
                    this.y += 80 * dt;
                    return;
                }

                this.moveTimer += dt;
                this.x += this.dx * dt;
                // 边界按机身**真实绘制半宽**算，不用固定 ±100。
                // 旧写法 \`x < 100 || x > canvas.width - 100\` 只翻转方向、不夹住坐标，
                // 而 CYBER 形态画到 ±95（环绕节点 85 + 半径 10），100 只留 5px 余量；
                // dt 被 Math.min(..., 0.1) 夹到 0.1 时单帧还要过冲 12px，
                // 于是节点会出屏（实测最严重 7px，连辉光 23.5px）——
                // 而且只在节点转到水平位那一刻出现，所以看着像"有时会消失"。
                // 夹住坐标而不只是翻方向：低帧率下才不会越冲越远。
                const m = Math.min(this.drawnHalfWidth, canvas.width / 2);
                if (this.x < m) { this.x = m; this.dx = Math.abs(this.dx); }
                else if (this.x > canvas.width - m) { this.x = canvas.width - m; this.dx = -Math.abs(this.dx); }

                this.angle += dt * 1.5;
                this.shootTimer += dt;

                // Boss-specific attack logic
                if (this.typeIndex === 0) {
                    // Type 0: Dreadnought - Ring shockwaves & heavy center bursts
                    if (this.shootTimer >= 1.2) {
                        this.shootTimer = 0;
                        this.fireRingPattern(8, 200, 'medium');
                        enemyBullets.push(new EnemyBullet(this.x, this.y + 40, 0, 280, 'large'));
                    }
                } else if (this.typeIndex === 1) {
                    // Type 1: Cyber Hex - Spiral wave bullet storm
                    if (this.shootTimer >= 0.4) {
                        this.shootTimer = 0;
                        const spiralAngle = this.moveTimer * 3;
                        const speed = 210;
                        enemyBullets.push(new EnemyBullet(this.x, this.y + 30, Math.cos(spiralAngle) * speed, Math.sin(spiralAngle) * speed, 'medium'));
                        enemyBullets.push(new EnemyBullet(this.x, this.y + 30, -Math.cos(spiralAngle) * speed, -Math.sin(spiralAngle) * speed, 'medium'));
                    }
                } else if (this.typeIndex === 2) {
                    // Type 2: Star Destroyer - Tri-way laser barrage
                    if (this.shootTimer >= 0.9) {
                        this.shootTimer = 0;
                        const angles = [-0.4, -0.2, 0, 0.2, 0.4];
                        const speed = 250;
                        angles.forEach(a => {
                            enemyBullets.push(new EnemyBullet(this.x, this.y + 40, Math.sin(a) * speed, Math.cos(a) * speed, 'small'));
                        });
                        enemyBullets.push(new EnemyBullet(this.x - 50, this.y + 20, 0, 260, 'medium'));
                        enemyBullets.push(new EnemyBullet(this.x + 50, this.y + 20, 0, 260, 'medium'));
                    }
                } else if (this.typeIndex === 3) {
                    // Type 3: Neon Dragon - Flapping wing pulse + sweeping twin-beams
                    if (this.shootTimer >= 0.55) {
                        this.shootTimer = 0;
                        const sweepAngle = Math.sin(this.moveTimer * 4) * 0.5;
                        const speed = 240;
                        enemyBullets.push(new EnemyBullet(this.x - 60, this.y + 10, Math.sin(sweepAngle - 0.2) * speed, Math.cos(sweepAngle - 0.2) * speed, 'medium'));
                        enemyBullets.push(new EnemyBullet(this.x + 60, this.y + 10, Math.sin(sweepAngle + 0.2) * speed, Math.cos(sweepAngle + 0.2) * speed, 'medium'));
                        if (Math.random() < 0.45) {
                            this.fireRingPattern(6, 180, 'small');
                        }
                    }
                } else if (this.typeIndex === 4) {
                    // Type 4: Void Eclipse Leviathan - Concentric expanding ring explosion + tracking heavy orb
                    if (this.shootTimer >= 0.95) {
                        this.shootTimer = 0;
                        this.fireRingPattern(10, 190, 'small');
                        if (player) {
                            const angleToPlayer = Math.atan2(player.y - this.y, player.x - this.x);
                            const speed = 230;
                            enemyBullets.push(new EnemyBullet(this.x, this.y + 30, Math.cos(angleToPlayer) * speed, Math.sin(angleToPlayer) * speed, 'large'));
                        }
                    }
                } else {
                    // Type 5: Chrono Matrix Core - Multi-stage core rotation burst & quad cross laser
                    if (this.shootTimer >= 0.45) {
                        this.shootTimer = 0;
                        const rot = this.angle * 2;
                        const speed = 220;
                        for (let i = 0; i < 4; i++) {
                            const ca = rot + (i * Math.PI / 2);
                            enemyBullets.push(new EnemyBullet(this.x, this.y, Math.cos(ca) * speed, Math.sin(ca) * speed, 'medium'));
                        }
                        if (Math.floor(this.moveTimer * 2) % 3 === 0) {
                            enemyBullets.push(new EnemyBullet(this.x - 30, this.y + 40, 0, 290, 'small'));
                            enemyBullets.push(new EnemyBullet(this.x + 30, this.y + 40, 0, 290, 'small'));
                        }
                    }
                }
            }

            fireRingPattern(count, speed, bulletType) {
                for (let i = 0; i < count; i++) {
                    const a = (i * Math.PI * 2) / count + this.angle;
                    enemyBullets.push(new EnemyBullet(this.x, this.y, Math.cos(a) * speed, Math.sin(a) * speed, bulletType));
                }
            }

            draw() {
                ctx.save();
                ctx.translate(this.x, this.y);
                ctx.strokeStyle = this.color;
                ctx.lineWidth = 3;
                ctx.shadowColor = this.color;
                ctx.shadowBlur = 15;

                if (this.typeIndex === 0) {
                    // Unique Geometry: Dreadnought Octagon Fortress with dual rotating side turrets
                    ctx.beginPath();
                    const r = 55;
                    for (let i = 0; i < 8; i++) {
                        const a = (i * Math.PI) / 4;
                        const px = Math.cos(a) * r;
                        const py = Math.sin(a) * r;
                        if (i === 0) ctx.moveTo(px, py);
                        else ctx.lineTo(px, py);
                    }
                    ctx.closePath();
                    ctx.stroke();

                    // Inner Core
                    ctx.strokeRect(-20, -20, 40, 40);

                    // Rotating Side Turrets
                    ctx.save();
                    ctx.rotate(this.angle);
                    ctx.strokeRect(-75, -12, 24, 24);
                    ctx.strokeRect(51, -12, 24, 24);
                    ctx.restore();

                } else if (this.typeIndex === 1) {
                    // Unique Geometry: Cyber Hex Carrier with revolving orbital shields
                    ctx.beginPath();
                    ctx.moveTo(0, -65);
                    ctx.lineTo(60, -30);
                    ctx.lineTo(60, 30);
                    ctx.lineTo(0, 65);
                    ctx.lineTo(-60, 30);
                    ctx.lineTo(-60, -30);
                    ctx.closePath();
                    ctx.stroke();

                    // Orbital Energy Nodes
                    for (let i = 0; i < 3; i++) {
                        const oa = this.angle + (i * Math.PI * 2) / 3;
                        const ox = Math.cos(oa) * 85;
                        const oy = Math.sin(oa) * 85;
                        ctx.beginPath();
                        ctx.arc(ox, oy, 10, 0, Math.PI * 2);
                        ctx.stroke();
                    }

                } else if (this.typeIndex === 2) {
                    // Unique Geometry: Vector Star Destroyer with massive swept wings
                    ctx.beginPath();
                    ctx.moveTo(0, 60);
                    ctx.lineTo(80, -20);
                    ctx.lineTo(70, -50);
                    ctx.lineTo(25, -35);
                    ctx.lineTo(0, -55);
                    ctx.lineTo(-25, -35);
                    ctx.lineTo(-70, -50);
                    ctx.lineTo(-80, -20);
                    ctx.closePath();
                    ctx.stroke();

                    // Wing Thruster Vents
                    ctx.beginPath();
                    ctx.moveTo(-40, -10); ctx.lineTo(-40, 20);
                    ctx.moveTo(40, -10); ctx.lineTo(40, 20);
                    ctx.stroke();

                } else if (this.typeIndex === 3) {
                    // Unique Geometry: Neon Dragon Dreadwing with articulated flapping wings
                    const wingFlap = Math.sin(this.moveTimer * 6) * 18;
                    ctx.beginPath();
                    ctx.moveTo(0, 50); // Head
                    ctx.lineTo(30, 0);
                    ctx.lineTo(85, -10 + wingFlap); // Wing R
                    ctx.lineTo(40, -30);
                    ctx.lineTo(0, -50); // Tail
                    ctx.lineTo(-40, -30);
                    ctx.lineTo(-85, -10 + wingFlap); // Wing L
                    ctx.lineTo(-30, 0);
                    ctx.closePath();
                    ctx.stroke();

                    // Dragon Inner Core
                    ctx.beginPath();
                    ctx.arc(0, 0, 16, 0, Math.PI * 2);
                    ctx.stroke();

                } else if (this.typeIndex === 4) {
                    // Unique Geometry: Void Eclipse Leviathan with dual eclipse rings & mandibles
                    ctx.beginPath();
                    ctx.arc(0, 0, 48, 0, Math.PI * 2);
                    ctx.stroke();

                    ctx.beginPath();
                    ctx.arc(0, 0, 30, 0, Math.PI * 2);
                    ctx.stroke();

                    // Mandibles
                    ctx.beginPath();
                    ctx.moveTo(-35, 18); ctx.lineTo(-20, 60); ctx.lineTo(-10, 28);
                    ctx.moveTo(35, 18); ctx.lineTo(20, 60); ctx.lineTo(10, 28);
                    ctx.stroke();

                } else {
                    // Unique Geometry: Chrono Matrix Core with nested counter-rotating squares
                    ctx.save();
                    ctx.rotate(this.angle);
                    ctx.strokeRect(-42, -42, 84, 84);
                    ctx.restore();

                    ctx.save();
                    ctx.rotate(-this.angle * 1.6);
                    ctx.strokeRect(-26, -26, 52, 52);
                    ctx.restore();

                    // Pulsing center sphere
                    ctx.beginPath();
                    ctx.arc(0, 0, 12, 0, Math.PI * 2);
                    ctx.stroke();
                }

                ctx.restore();
            }
        }

        class Enemy {
            constructor(type, subType = null) {
                this.type = type;
                this.x = Math.random() * (canvas.width - 60) + 30;
                this.y = -40;
                this.startX = this.x;
                this.shootTimer = Math.random() * 2;
                this.moveTimer = 0;
                this.angle = 0;

                if (type === 'bonus') {
                    this.subType = 'bonus';
                    this.hp = 1;
                    this.maxHp = 1;
                    this.speed = 150 + Math.random() * 50;
                    this.width = 28;
                    this.height = 28;
                    this.color = '#ffd700';
                    this.scoreValue = 200;
                    this.shootInterval = 9999;
                } else if (type === 'small') {
                    const subTypes = ['dart', 'interceptor', 'drone'];
                    this.subType = subType || subTypes[Math.floor(Math.random() * subTypes.length)];
                    this.hp = 1;
                    this.maxHp = 1;
                    this.width = 24;
                    this.height = 24;

                    if (this.subType === 'dart') {
                        this.speed = 130 + Math.random() * 40;
                        this.color = '#ff3366'; // Pinkish red
                        this.scoreValue = 100;
                        this.shootInterval = 2.5 + Math.random() * 1.5;
                    } else if (this.subType === 'interceptor') {
                        this.speed = 160 + Math.random() * 40;
                        this.color = '#00ff99'; // Neon Cyan/Mint
                        this.scoreValue = 120;
                        this.shootInterval = 2.0 + Math.random() * 1.5;
                    } else { // drone
                        this.speed = 110 + Math.random() * 30;
                        this.color = '#ffff00'; // Vibrant Yellow
                        this.scoreValue = 150;
                        this.shootInterval = 1.8 + Math.random() * 1.2;
                    }
                } else if (type === 'medium') {
                    const subTypes = ['gunship', 'stalker', 'spiral'];
                    this.subType = subType || subTypes[Math.floor(Math.random() * subTypes.length)];
                    this.hp = 5;
                    this.maxHp = 5;
                    this.width = 42;
                    this.height = 38;

                    if (this.subType === 'gunship') {
                        this.speed = 75 + Math.random() * 25;
                        this.color = '#ff9900'; // Bright Orange
                        this.scoreValue = 300;
                        this.shootInterval = 2.0 + Math.random() * 1.5;
                    } else if (this.subType === 'stalker') {
                        this.speed = 90 + Math.random() * 20;
                        this.color = '#00d8ff'; // Electric Blue
                        this.scoreValue = 350;
                        this.shootInterval = 1.8 + Math.random() * 1.2;
                    } else { // spiral
                        this.speed = 65 + Math.random() * 20;
                        this.color = '#a855f7'; // Purple Glow
                        this.scoreValue = 400;
                        this.shootInterval = 1.6 + Math.random() * 1.0;
                    }
                } else { // large
                    const subTypes = ['fortress', 'ion', 'tri_bomber'];
                    this.subType = subType || subTypes[Math.floor(Math.random() * subTypes.length)];
                    this.hp = 12;
                    this.maxHp = 12;
                    this.width = 64;
                    this.height = 58;

                    if (this.subType === 'fortress') {
                        this.speed = 40 + Math.random() * 20;
                        this.color = '#cc00ff'; // Neon Magenta
                        this.scoreValue = 800;
                        this.shootInterval = 1.8 + Math.random() * 1.0;
                    } else if (this.subType === 'ion') {
                        this.speed = 35 + Math.random() * 15;
                        this.color = '#38bdf8'; // Sky Blue Laser
                        this.scoreValue = 1000;
                        this.shootInterval = 1.5 + Math.random() * 1.0;
                    } else { // tri_bomber
                        this.speed = 30 + Math.random() * 15;
                        this.color = '#f43f5e'; // Deep Crimson
                        this.scoreValue = 1200;
                        this.shootInterval = 1.4 + Math.random() * 0.8;
                    }
                }
            }

            update(dt) {
                this.moveTimer += dt;
                this.y += this.speed * dt;

                // Unique Movement Patterns based on subType
                if (this.subType === 'bonus') {
                    this.angle += 4 * dt;
                } else if (this.subType === 'interceptor') {
                    // Fast Zigzag sine wave
                    this.x = this.startX + Math.sin(this.moveTimer * 6) * 60;
                } else if (this.subType === 'stalker') {
                    // Wide sweeping arc
                    this.x = this.startX + Math.cos(this.moveTimer * 3) * 90;
                } else if (this.subType === 'spiral') {
                    // Rotates while descending
                    this.angle += 3 * dt;
                } else if (this.subType === 'ion' || this.subType === 'tri_bomber') {
                    // Slow horizontal swaying
                    this.x = this.startX + Math.sin(this.moveTimer * 1.5) * 40;
                }

                // Keep horizontally in bounds
                this.x = Math.max(30, Math.min(canvas.width - 30, this.x));

                this.shootTimer += dt;
                if (this.shootTimer >= this.shootInterval && this.y > 0 && this.y < canvas.height - 100) {
                    this.shootTimer = 0;
                    this.firePattern();
                }
            }

            firePattern() {
                if (this.type === 'bonus') return;

                const bulletSpeed = 230;

                // --- SMALL TIER PATTERNS ---
                if (this.subType === 'dart') {
                    enemyBullets.push(new EnemyBullet(this.x, this.y + this.height / 2, 0, bulletSpeed, 'small'));
                } else if (this.subType === 'interceptor') {
                    // Aimed bullet towards player location
                    let vx = 0, vy = bulletSpeed;
                    if (player) {
                        const angle = Math.atan2(player.y - this.y, player.x - this.x);
                        vx = Math.cos(angle) * (bulletSpeed + 40);
                        vy = Math.sin(angle) * (bulletSpeed + 40);
                    }
                    enemyBullets.push(new EnemyBullet(this.x, this.y + this.height / 2, vx, vy, 'small'));
                } else if (this.subType === 'drone') {
                    // Fast dual straight shot
                    enemyBullets.push(new EnemyBullet(this.x - 6, this.y + this.height / 2, 0, bulletSpeed + 30, 'small'));
                    enemyBullets.push(new EnemyBullet(this.x + 6, this.y + this.height / 2, 0, bulletSpeed + 30, 'small'));
                }
                
                // --- MEDIUM TIER PATTERNS ---
                else if (this.subType === 'gunship') {
                    const spread = 0.2;
                    enemyBullets.push(new EnemyBullet(this.x - 12, this.y + this.height / 2, -Math.sin(spread) * bulletSpeed, Math.cos(spread) * bulletSpeed, 'medium'));
                    enemyBullets.push(new EnemyBullet(this.x + 12, this.y + this.height / 2, Math.sin(spread) * bulletSpeed, Math.cos(spread) * bulletSpeed, 'medium'));
                } else if (this.subType === 'stalker') {
                    // 3-way fan attack
                    const angles = [-0.25, 0, 0.25];
                    angles.forEach(a => {
                        enemyBullets.push(new EnemyBullet(this.x, this.y + this.height / 2, Math.sin(a) * bulletSpeed, Math.cos(a) * bulletSpeed, 'medium'));
                    });
                } else if (this.subType === 'spiral') {
                    // 4-way rotating cross barrage
                    for (let i = 0; i < 4; i++) {
                        const a = this.angle + (i * Math.PI / 2);
                        enemyBullets.push(new EnemyBullet(this.x, this.y, Math.cos(a) * (bulletSpeed * 0.8), Math.sin(a) * (bulletSpeed * 0.8), 'small'));
                    }
                }

                // --- LARGE TIER PATTERNS ---
                else if (this.subType === 'fortress') {
                    enemyBullets.push(new EnemyBullet(this.x, this.y + this.height / 2, 0, bulletSpeed * 0.9, 'large'));
                    enemyBullets.push(new EnemyBullet(this.x - 22, this.y + this.height / 2, -40, bulletSpeed, 'small'));
                    enemyBullets.push(new EnemyBullet(this.x + 22, this.y + this.height / 2, 40, bulletSpeed, 'small'));
                } else if (this.subType === 'ion') {
                    // Tracking plasma center bullet + twin side bursts
                    let vx = 0, vy = bulletSpeed * 0.85;
                    if (player) {
                        const angle = Math.atan2(player.y - this.y, player.x - this.x);
                        vx = Math.cos(angle) * (bulletSpeed * 0.85);
                        vy = Math.sin(angle) * (bulletSpeed * 0.85);
                    }
                    enemyBullets.push(new EnemyBullet(this.x, this.y + this.height / 2, vx, vy, 'large'));
                    enemyBullets.push(new EnemyBullet(this.x - 20, this.y + 10, -50, bulletSpeed, 'medium'));
                    enemyBullets.push(new EnemyBullet(this.x + 20, this.y + 10, 50, bulletSpeed, 'medium'));
                } else if (this.subType === 'tri_bomber') {
                    // Triple cluster bombs + flank salvo
                    const spread = 0.3;
                    enemyBullets.push(new EnemyBullet(this.x - 25, this.y + this.height / 2, -Math.sin(spread) * bulletSpeed, Math.cos(spread) * bulletSpeed, 'medium'));
                    enemyBullets.push(new EnemyBullet(this.x, this.y + this.height / 2, 0, bulletSpeed, 'large'));
                    enemyBullets.push(new EnemyBullet(this.x + 25, this.y + this.height / 2, Math.sin(spread) * bulletSpeed, Math.cos(spread) * bulletSpeed, 'medium'));
                }
            }

            draw() {
                ctx.save();
                ctx.translate(this.x, this.y);
                ctx.strokeStyle = this.color;
                ctx.lineWidth = 2;
                ctx.shadowColor = this.color;
                ctx.shadowBlur = 10;

                if (this.type === 'bonus') {
                    ctx.rotate(this.angle);
                    const r = 14;
                    ctx.beginPath();
                    for (let i = 0; i < 8; i++) {
                        const a = (i * Math.PI) / 4;
                        const dist = i % 2 === 0 ? r : r * 0.5;
                        const px = Math.cos(a) * dist;
                        const py = Math.sin(a) * dist;
                        if (i === 0) ctx.moveTo(px, py);
                        else ctx.lineTo(px, py);
                    }
                    ctx.closePath();
                    ctx.stroke();
                } 
                // --- SMALL TIER VECTOR MODELS ---
                else if (this.subType === 'dart') {
                    ctx.beginPath();
                    ctx.moveTo(0, 12);
                    ctx.lineTo(-12, -12);
                    ctx.lineTo(0, -6);
                    ctx.lineTo(12, -12);
                    ctx.closePath();
                    ctx.stroke();
                } else if (this.subType === 'interceptor') {
                    ctx.beginPath();
                    ctx.moveTo(0, 14);
                    ctx.lineTo(-8, 0);
                    ctx.lineTo(0, -14);
                    ctx.lineTo(8, 0);
                    ctx.closePath();
                    ctx.moveTo(0, -6);
                    ctx.lineTo(0, 6);
                    ctx.stroke();
                } else if (this.subType === 'drone') {
                    ctx.beginPath();
                    const r = 12;
                    for (let i = 0; i < 6; i++) {
                        const a = (i * Math.PI) / 3;
                        const px = Math.cos(a) * r;
                        const py = Math.sin(a) * r;
                        if (i === 0) ctx.moveTo(px, py);
                        else ctx.lineTo(px, py);
                    }
                    ctx.closePath();
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.arc(0, 0, 4, 0, Math.PI * 2);
                    ctx.stroke();
                }
                // --- MEDIUM TIER VECTOR MODELS ---
                else if (this.subType === 'gunship') {
                    ctx.beginPath();
                    ctx.moveTo(0, 18);
                    ctx.lineTo(-20, 0);
                    ctx.lineTo(-12, -18);
                    ctx.lineTo(12, -18);
                    ctx.lineTo(20, 0);
                    ctx.closePath();
                    ctx.stroke();
                    ctx.strokeRect(-6, -6, 12, 12);
                } else if (this.subType === 'stalker') {
                    ctx.beginPath();
                    ctx.moveTo(0, 20);
                    ctx.lineTo(-22, -10);
                    ctx.lineTo(-14, -18);
                    ctx.lineTo(0, -8);
                    ctx.lineTo(14, -18);
                    ctx.lineTo(22, -10);
                    ctx.closePath();
                    ctx.moveTo(-10, 0); ctx.lineTo(10, 0);
                    ctx.stroke();
                } else if (this.subType === 'spiral') {
                    ctx.rotate(this.angle);
                    ctx.beginPath();
                    for (let i = 0; i < 4; i++) {
                        const a = (i * Math.PI) / 2;
                        ctx.moveTo(0, 0);
                        ctx.lineTo(Math.cos(a) * 20, Math.sin(a) * 20);
                        ctx.lineTo(Math.cos(a + 0.3) * 12, Math.sin(a + 0.3) * 12);
                    }
                    ctx.stroke();
                    ctx.strokeRect(-8, -8, 16, 16);
                }
                // --- LARGE TIER VECTOR MODELS ---
                else if (this.subType === 'fortress') {
                    ctx.beginPath();
                    ctx.moveTo(0, 26);
                    ctx.lineTo(-28, -8);
                    ctx.lineTo(-20, -24);
                    ctx.lineTo(0, -16);
                    ctx.lineTo(20, -24);
                    ctx.lineTo(28, -8);
                    ctx.closePath();
                    ctx.stroke();
                    ctx.strokeRect(-8, -8, 16, 16);
                } else if (this.subType === 'ion') {
                    ctx.beginPath();
                    ctx.arc(0, 0, 24, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(-32, -12); ctx.lineTo(-32, 20); ctx.lineTo(-18, 26); ctx.lineTo(-18, -12);
                    ctx.moveTo(32, -12); ctx.lineTo(32, 20); ctx.lineTo(18, 26); ctx.lineTo(18, -12);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.arc(0, 0, 10, 0, Math.PI * 2);
                    ctx.stroke();
                } else if (this.subType === 'tri_bomber') {
                    ctx.beginPath();
                    ctx.moveTo(0, 30);
                    ctx.lineTo(-32, -22);
                    ctx.lineTo(-18, -28);
                    ctx.lineTo(0, -18);
                    ctx.lineTo(18, -28);
                    ctx.lineTo(32, -22);
                    ctx.closePath();
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.arc(-22, -2, 6, 0, Math.PI * 2);
                    ctx.arc(0, 6, 7, 0, Math.PI * 2);
                    ctx.arc(22, -2, 6, 0, Math.PI * 2);
                    ctx.stroke();
                }

                ctx.restore();
            }
        }

        // --- POWERUP CLASS ---
        class Powerup {
            constructor(x, y, type) {
                this.x = x;
                this.y = y;
                this.type = type; // 'FIRE', 'SHIELD', 'REPAIR'
                this.speed = 90;
                this.radius = 12;
                this.pulse = 0;
                this.isBeingAttracted = false;

                if (type === 'FIRE') {
                    this.color = '#ff00aa';
                    this.label = 'F';
                } else if (type === 'SHIELD') {
                    this.color = '#00f0ff';
                    this.label = 'S';
                } else { // REPAIR
                    this.color = '#00ff66';
                    this.label = '+';
                }
            }

            update(dt, player) {
                this.pulse += dt * 5;

                // 磁力吸附机制：当战机靠近（180px 范围）时，道具自动加速飞向战机
                if (player && player.hp > 0) {
                    const dx = player.x - this.x;
                    const dy = player.y - this.y;
                    const dist = Math.hypot(dx, dy);
                    const magnetRadius = 180;

                    // ⚠ 必须排除 dist === 0：dx/dist 会得到 0/0 = NaN，
                    // 道具坐标被写成 NaN 后会永久卡死在机身上收不到
                    // （NaN 与任何数比较都是 false，连出屏回收都失效）。
                    if (dist > 0.01 && dist < magnetRadius) {
                        this.isBeingAttracted = true;
                        // 距离战机越近，飞向战机的速度越快
                        const pullSpeed = 320 + (1 - dist / magnetRadius) * 380;
                        this.x += (dx / dist) * pullSpeed * dt;
                        this.y += (dy / dist) * pullSpeed * dt;
                        return;
                    }
                }

                this.isBeingAttracted = false;
                this.y += this.speed * dt;
            }

            draw() {
                ctx.save();
                ctx.translate(this.x, this.y);
                ctx.strokeStyle = this.color;
                ctx.fillStyle = this.color;
                ctx.lineWidth = 2;
                ctx.shadowColor = this.color;
                ctx.shadowBlur = this.isBeingAttracted ? 18 : 10;

                const scale = (1 + Math.sin(this.pulse) * 0.1) * (this.isBeingAttracted ? 1.25 : 1.0);
                ctx.scale(scale, scale);

                ctx.beginPath();
                ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
                ctx.stroke();

                ctx.font = 'bold 12px Orbitron';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(this.label, 0, 1);

                ctx.restore();
            }
        }

        // --- PARTICLE SYSTEM ---
        class Particle {
            constructor(x, y, color) {
                this.x = x;
                this.y = y;
                this.color = color;
                const angle = Math.random() * Math.PI * 2;
                const speed = 50 + Math.random() * 200;
                this.vx = Math.cos(angle) * speed;
                this.vy = Math.sin(angle) * speed;
                this.life = 0.4 + Math.random() * 0.4;
                this.maxLife = this.life;
            }

            update(dt) {
                this.x += this.vx * dt;
                this.y += this.vy * dt;
                this.life -= dt;
            }

            draw() {
                ctx.save();
                ctx.strokeStyle = this.color;
                ctx.globalAlpha = Math.max(0, this.life / this.maxLife);
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(this.x, this.y);
                ctx.lineTo(this.x - this.vx * 0.05, this.y - this.vy * 0.05);
                ctx.stroke();
                ctx.restore();
            }
        }

        function createExplosion(x, y, color, count = 15) {
            for (let i = 0; i < count; i++) {
                particles.push(new Particle(x, y, color));
            }
        }

        // --- ENEMY SPAWNER LOGIC ---
        let enemySpawnTimer = 0;

        function startBonusWave(duration = 12, isSuperBonus = false) {
            isBonusWave = true;
            bonusWaveTimer = duration;
            bonusSpawnTimer = 0;
            const bannerText = isSuperBonus ? \`🌟 SUPER BONUS WAVE! 10X SCORE (\${duration}s) 🌟\` : \`⭐ BONUS WAVE! 10X SCORE (\${duration}s) ⭐\`;
            triggerAIRadioChatter(isSuperBonus ? "🌟 斩获巨大敌机！启动 25秒 超级黄金奖励波！" : "⭐ 战术特报：黄金奖励波降临！击落享10倍得分！");
            const banner = document.getElementById('bonus-banner');
            if (banner) {
                banner.innerText = bannerText;
                banner.classList.remove('hidden');
            }
        }

        function endBonusWave() {
            isBonusWave = false;
            triggerAIRadioChatter("📡 奖励波结束，恢复正常战区巡航。");
            const banner = document.getElementById('bonus-banner');
            if (banner) banner.classList.add('hidden');
        }

        function triggerBossWarning() {
            isBossWarning = true;
            bossWarningTimer = 3.5; // 3.5s pre-warning before Boss enters
            triggerAIRadioChatter("⚠️ 警告：检测到高能巨大敌机信号接近中！请做好防御准备！");
            const warningBanner = document.getElementById('boss-warning-banner');
            if (warningBanner) warningBanner.classList.remove('hidden');
        }

        function spawnBoss() {
            isBossWarning = false;
            const warningBanner = document.getElementById('boss-warning-banner');
            if (warningBanner) warningBanner.classList.add('hidden');

            const hpMult = 1 + Math.floor(killCount / 100) * 0.3;
            boss = new Boss(bossTypeCycle, hpMult);
            bossTypeCycle = (bossTypeCycle + 1) % 6; // Cycled through all 6 Boss types

            triggerAIRadioChatter(\`🔴 敌军 \${boss.name} 已降临战区！彻底摧毁它！\`);
            updateHUD();
        }

        function updateSpawns(dt) {
            // Boss Pre-Warning Phase: Do not spawn any regular enemies or normal bonus wave
            if (isBossWarning) {
                bossWarningTimer -= dt;
                if (bossWarningTimer <= 0) {
                    spawnBoss();
                }
                return;
            }

            // Boss Active Phase: Stop all regular enemy and bonus spawns
            if (boss) {
                boss.update(dt);
                return;
            }

            // Check if 100-kill threshold reached for giant enemy boss
            if (killCount >= nextBossKillThreshold) {
                nextBossKillThreshold += 100;
                if (isBonusWave) endBonusWave();
                triggerBossWarning();
                return;
            }

            if (isBonusWave) {
                bonusWaveTimer -= dt;
                const banner = document.getElementById('bonus-banner');
                if (banner) {
                    banner.innerText = \`⭐ BONUS WAVE! 10X 得分 (\${Math.ceil(bonusWaveTimer)}s) ⭐\`;
                }

                bonusSpawnTimer += dt;
                if (bonusSpawnTimer >= 0.08) { // 极高密度爆爽刷新黄金敌机
                    bonusSpawnTimer = 0;
                    const count = Math.floor(Math.random() * 2) + 2;
                    for (let i = 0; i < count; i++) {
                        enemies.push(new Enemy('bonus'));
                    }
                }

                if (bonusWaveTimer <= 0) {
                    endBonusWave();
                }
                return;
            }

            enemySpawnTimer += dt;
            if (enemySpawnTimer >= 1.2) {
                enemySpawnTimer = 0;

                const rand = Math.random();
                let type = 'small';
                if (rand > 0.90) {
                    type = 'large';
                } else if (rand > 0.70) {
                    type = 'medium';
                } else {
                    type = 'small';
                }

                enemies.push(new Enemy(type));
            }
        }

        // --- 击杀结算（子弹与激光共用） ---
        function onBossDefeated() {
            if (!boss) return;
            createExplosion(boss.x, boss.y, boss.color, 80);
            const scoreMultiplier = player.preset.scoreMult;
            score += Math.floor(boss.scoreValue * scoreMultiplier);
            killCount++; // 击杀 Boss 算作正式击杀

            // Drop multiple powerups upon Boss defeat
            rollPowerupDrop(boss.x - 30, boss.y);
            rollPowerupDrop(boss.x + 30, boss.y);
            powerups.push(new Powerup(boss.x, boss.y, 'REPAIR'));

            boss = null;
            updateHUD();

            // Trigger Extended Super Bonus Wave (25 seconds)
            startBonusWave(25, true);
        }

        function onEnemyDefeated(e, eIdx) {
            createExplosion(e.x, e.y, e.color, e.type === 'large' ? 30 : (e.type === 'bonus' ? 20 : 15));

            const scoreMultiplier = isBonusWave ? player.preset.scoreMult * 10 : player.preset.scoreMult;
            score += Math.floor(e.scoreValue * scoreMultiplier);

            // 关键规则调整：奖励波敌机（bonus）不计入 killCount，也不增加 normalKillCount
            if (e.type !== 'bonus') {
                killCount++;
                normalKillCount++;

                if (normalKillCount >= 50 && !boss && !isBossWarning) {
                    normalKillCount = 0;
                    startBonusWave(12, false);
                }

                // Milestone AI Callout
                if (killCount % 25 === 0 && !isBonusWave && !boss) {
                    triggerAIRadioChatter(\`战报: 击落目标已达 \${killCount} 架，杀敌数持续上升！\`);
                }
            }

            rollPowerupDrop(e.x, e.y);
            enemies.splice(eIdx, 1);
            updateHUD();
        }

        // --- 水母机激光命中结算（穿透：命中不消失，只对目标加冷却） ---
        function checkLaserHits() {
            if (!player || !player.lasers || player.lasers.length === 0) return;

            for (let lIdx = 0; lIdx < player.lasers.length; lIdx++) {
                const laser = player.lasers[lIdx];
                const halfW = laser.width / 2;

                // 扫射的激光一帧内能转过很大角度（帧率越低越明显）。
                // 只按当前角度做命中判定，光束会直接"穿过"敌机而不结算，
                // 所以这里在上一帧角度与当前角度之间按角度细分采样。
                const delta = laser.angle - laser.prevAngle;
                const steps = Math.min(6, Math.max(1, Math.ceil(Math.abs(delta) / 0.09)));

                for (let step = 1; step <= steps; step++) {
                    const a = laser.prevAngle + delta * (step / steps);
                    const s = laser.getStart(a);
                    const e = laser.getEnd(a);

                    // 激光 vs Boss
                    if (boss) {
                        // 用「膨胀椭圆」而不是外接圆。剪影本来就不是圆的（巨龙 86.5×52、
                        // 歼灭舰 81.5×61.5），用外接圆会在扁的那一轴上多判 30+px ——
                        // 光束从龙翼上方老远掠过也算命中，正是要修掉的那类毛病。
                        // 取光束中心线上离 Boss 最近的点，代入按激光半宽膨胀过的椭圆方程。
                        // 注意这是近似：椭圆上离一条直线最近的点并不严格等于中心的投影，
                        // 但光束细长、误差在 1px 量级，套件里有实测拦着。
                        const rx = boss.drawnHalfWidth + halfW;
                        const ry = boss.drawnHalfHeight + halfW;
                        const cp = closestPointOnSegment(boss.x, boss.y, s.x, s.y, e.x, e.y);
                        const nx = (cp.x - boss.x) / rx;
                        const ny = (cp.y - boss.y) / ry;
                        if (laser.canHit(boss) && nx * nx + ny * ny < 1) {
                            laser.markHit(boss);
                            boss.hp -= laser.damage;
                            createExplosion(
                                boss.x + (Math.random() - 0.5) * boss.width * 0.6,
                                boss.y + (Math.random() - 0.5) * boss.height * 0.6,
                                laser.color, 2
                            );
                            if (boss.hp <= 0) onBossDefeated();
                            else updateHUD();
                        }
                    }

                    // 激光 vs 敌机（穿透：一发可同时命中多个目标）
                    for (let eIdx = enemies.length - 1; eIdx >= 0; eIdx--) {
                        const en = enemies[eIdx];
                        const enR = Math.max(en.width, en.height) / 2;
                        if (!laser.canHit(en)) continue;
                        if (distToSegment(en.x, en.y, s.x, s.y, e.x, e.y) > enR + halfW) continue;

                        laser.markHit(en);
                        en.hp -= laser.damage;
                        createExplosion(en.x, en.y, laser.color, 2);

                        if (en.hp <= 0) onEnemyDefeated(en, eIdx);
                    }

                    if (enemies.length === 0 && !boss) break;
                }
            }
        }

        // --- COLLISION DETECTION SYSTEM ---
        function checkCollisions() {
            checkLaserHits();

            // Player Bullets vs Boss
            if (boss) {
                for (let bIdx = playerBullets.length - 1; bIdx >= 0; bIdx--) {
                    const b = playerBullets[bIdx];
                    // boss.width/height 就是该形态剪影的外接盒（构造里按形态赋值），
                    // 所以这里是「打得到 = 看得见」的轴对齐矩形判定。
                    if (Math.abs(b.x - boss.x) < boss.width / 2 + b.radius &&
                        Math.abs(b.y - boss.y) < boss.height / 2 + b.radius) {
                        
                        boss.hp -= b.damage;
                        createExplosion(b.x, b.y, '#00ffcc', 4);
                        playerBullets.splice(bIdx, 1);

                        if (boss.hp <= 0) {
                            onBossDefeated();
                            break;
                        } else {
                            updateHUD();
                        }
                    }
                }

                // Player vs Boss Body Collision
                // 系数 1/3 而不是 1/2：撞机判定故意比剪影收得紧一点，避免「擦到翼尖就掉血」。
                // boss.width 现在随形态变，所以这个软化的相对比例对六种形态是一致的。
                if (boss && Math.abs(player.x - boss.x) < (player.width + boss.width) / 3 &&
                    Math.abs(player.y - boss.y) < (player.height + boss.height) / 3) {
                    player.takeDamage(25);
                    createExplosion(player.x, player.y, '#ff0000', 15);
                }
            }

            // Player Bullets vs Enemies
            for (let bIdx = playerBullets.length - 1; bIdx >= 0; bIdx--) {
                const b = playerBullets[bIdx];
                for (let eIdx = enemies.length - 1; eIdx >= 0; eIdx--) {
                    const e = enemies[eIdx];

                    if (Math.abs(b.x - e.x) < e.width / 2 + b.radius &&
                        Math.abs(b.y - e.y) < e.height / 2 + b.radius) {
                        
                        e.hp -= b.damage;
                        createExplosion(b.x, b.y, '#00ffcc', 4);
                        playerBullets.splice(bIdx, 1);

                        if (e.hp <= 0) {
                            onEnemyDefeated(e, eIdx);
                        }
                        break;
                    }
                }
            }

            // Enemy Bullets vs Player
            for (let ebIdx = enemyBullets.length - 1; ebIdx >= 0; ebIdx--) {
                const eb = enemyBullets[ebIdx];
                const dist = Math.hypot(eb.x - player.x, eb.y - player.y);

                if (dist < eb.radius + player.width / 3) {
                    player.takeDamage(eb.damage);
                    enemyBullets.splice(ebIdx, 1);
                }
            }

            // Enemy Ships vs Player
            for (let eIdx = enemies.length - 1; eIdx >= 0; eIdx--) {
                const e = enemies[eIdx];
                if (Math.abs(player.x - e.x) < (player.width + e.width) / 3 &&
                    Math.abs(player.y - e.y) < (player.height + e.height) / 3) {
                    
                    player.takeDamage(15);
                    createExplosion(e.x, e.y, e.color, 20);
                    enemies.splice(eIdx, 1);
                }
            }

            // Powerups vs Player
            for (let pIdx = powerups.length - 1; pIdx >= 0; pIdx--) {
                const p = powerups[pIdx];
                const dist = Math.hypot(p.x - player.x, p.y - player.y);

                if (dist < p.radius + player.width / 2) {
                    applyPowerup(p.type);
                    createExplosion(p.x, p.y, p.color, 10);
                    powerups.splice(pIdx, 1);
                }
            }
        }

        function rollPowerupDrop(x, y) {
            const rand = Math.random();
            if (rand < 0.25) {
                const pTypeRand = Math.random();
                let pType = 'FIRE';
                if (pTypeRand < 0.4) pType = 'FIRE';
                else if (pTypeRand < 0.7) pType = 'SHIELD';
                else pType = 'REPAIR';

                powerups.push(new Powerup(x, y, pType));
            }
        }

        function applyPowerup(type) {
            if (type === 'FIRE') {
                if (player.bulletLevel < 5) {
                    player.bulletLevel++;
                    // 水母机升级 = 增加激光道数
                    if (player.isJellyfish) {
                        player.rebuildLasers();
                        triggerAIRadioChatter(\`激光阵列扩充至 \${player.lasers.length} 道扫射！\`);
                    } else {
                        triggerAIRadioChatter(\`大雁弹幕提升至 Level \${player.bulletLevel}！\`);
                    }
                }
            } else if (type === 'REPAIR') {
                player.hp = Math.min(player.hpMax, player.hp + 25);
                triggerAIRadioChatter("获得生命补给，装甲已修复！");
            } else if (type === 'SHIELD') {
                player.shield = Math.min(player.shieldMax, player.shield + 10);
                triggerAIRadioChatter("能量护盾已充能 +10！");
            }
            updateHUD();
        }

        // --- GAME LOOP ---
        function gameLoop(timestamp) {
            if (gameState !== 'PLAYING') {
                lastTime = timestamp;
                requestAnimationFrame(gameLoop);
                return;
            }

            const dt = Math.min((timestamp - lastTime) / 1000, 0.1);
            lastTime = timestamp;
            gameDurationSeconds += dt;

            ctx.fillStyle = '#050508';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            ctx.fillStyle = '#fff';
            stars.forEach(star => {
                star.y += star.speed;
                if (star.y > canvas.height) {
                    star.y = 0;
                    star.x = Math.random() * canvas.width;
                }
                ctx.fillStyle = star.color;
                ctx.fillRect(star.x, star.y, star.size, star.size);
            });

            updateSpawns(dt);

            player.update(dt);
            player.drawLasers();
            player.draw();

            if (boss) {
                boss.draw();
            }

            playerBullets.forEach((b, i) => {
                b.update(dt);
                b.draw();
                if (b.y < -20 || b.x < -20 || b.x > canvas.width + 20) playerBullets.splice(i, 1);
            });

            enemyBullets.forEach((eb, i) => {
                eb.update(dt);
                eb.draw();
                if (eb.y > canvas.height + 20 || eb.x < -20 || eb.x > canvas.width + 20) enemyBullets.splice(i, 1);
            });

            enemies.forEach((e, i) => {
                e.update(dt);
                e.draw();
                if (e.y > canvas.height + 50) enemies.splice(i, 1);
            });

            powerups.forEach((p, i) => {
                p.update(dt, player);
                p.draw();
                if (p.y > canvas.height + 20) powerups.splice(i, 1);
            });

            particles.forEach((pt, i) => {
                pt.update(dt);
                pt.draw();
                if (pt.life <= 0) particles.splice(i, 1);
            });

            checkCollisions();

            requestAnimationFrame(gameLoop);
        }

        // --- HUD & SCREEN MANAGEMENT ---
        function updateHUD() {
            document.getElementById('hp-text').innerText = \`\${Math.ceil(player.hp)} / \${player.hpMax}\`;
            const hpPercent = Math.max(0, (player.hp / player.hpMax) * 100);
            document.getElementById('hp-bar').style.width = \`\${hpPercent}%\`;

            document.getElementById('shield-text').innerText = \`\${Math.ceil(player.shield)} / \${player.shieldMax}\`;
            const shieldPercent = Math.max(0, (player.shield / player.shieldMax) * 100);
            document.getElementById('shield-bar').style.width = \`\${shieldPercent}%\`;

            document.getElementById('score-text').innerText = score.toString().padStart(6, '0');
            
            const bulletLevelElem = document.getElementById('bullet-level-text');
            if (player.isJellyfish) {
                // 标签刻意保持短：窄屏（390px）下 HUD 三栏会互相挤压，
                // 字符串越短越不容易折行。比标准战机的「弹幕 LEVEL 1 (3发大雁阵)」还短。
                bulletLevelElem.innerText = \`激光 Lv\${player.bulletLevel} · \${player.lasers.length}道穿透\`;
            } else {
                const vBullets = 1 + player.bulletLevel * 2;
                bulletLevelElem.innerText = \`弹幕 LEVEL \${player.bulletLevel} (\${vBullets}发大雁阵)\`;
            }

            const progressElem = document.getElementById('bonus-progress-text');
            if (progressElem) {
                if (boss) {
                    progressElem.innerText = \`🔴 巨大敌机战斗中 (总击杀: \${killCount})\`;
                } else if (isBossWarning) {
                    progressElem.innerText = \`⚠️ 巨大敌机即将来袭!\`;
                } else if (isBonusWave) {
                    progressElem.innerText = '⭐ 10倍黄金奖励波 (不计入击杀数)';
                } else {
                    progressElem.innerText = \`奖励波进度: \${normalKillCount}/50 | 下一次 Boss: \${killCount}/\${nextBossKillThreshold}\`;
                }
            }

            // Boss Health Bar HUD Element
            const bossHpContainer = document.getElementById('boss-hp-container');
            if (boss && boss.hp > 0) {
                bossHpContainer.classList.remove('hidden');
                document.getElementById('boss-name-text').innerText = boss.name;
                document.getElementById('boss-hp-text').innerText = \`\${Math.ceil(boss.hp)} / \${boss.maxHp}\`;
                const bHpPercent = Math.max(0, (boss.hp / boss.maxHp) * 100);
                document.getElementById('boss-hp-bar').style.width = \`\${bHpPercent}%\`;
            } else {
                bossHpContainer.classList.add('hidden');
            }
        }

        function selectShip(idx) {
            selectedShipIdx = idx;
            startGame();
        }

        function startGame() {
            resizeCanvas();
            score = 0;
            killCount = 0;
            normalKillCount = 0;
            isBonusWave = false;
            bonusWaveTimer = 0;
            bonusSpawnTimer = 0;
            boss = null;
            isBossWarning = false;
            bossWarningTimer = 0;
            nextBossKillThreshold = 100;
            bossTypeCycle = 0;

            gameDurationSeconds = 0;
            gameStartTime = performance.now();
            playerBullets = [];
            enemyBullets = [];
            enemies = [];
            powerups = [];
            particles = [];

            const banner = document.getElementById('bonus-banner');
            if (banner) banner.classList.add('hidden');
            const warningBanner = document.getElementById('boss-warning-banner');
            if (warningBanner) warningBanner.classList.add('hidden');
            const bossHpContainer = document.getElementById('boss-hp-container');
            if (bossHpContainer) bossHpContainer.classList.add('hidden');

            const preset = SHIP_PRESETS[selectedShipIdx];
            player = new Player(preset);

            document.getElementById('ship-select-screen').classList.add('hidden');
            document.getElementById('game-over-screen').classList.add('hidden');
            document.getElementById('pause-screen').classList.add('hidden');
            document.getElementById('hud-overlay').classList.remove('hidden');

            gameState = 'PLAYING';
            updateHUD();
            lastTime = performance.now();

            triggerAIRadioChatter(\`战术指挥部: \${preset.name} 接入天空战区，任务开始！\`);
            requestAnimationFrame(gameLoop);
        }

        function togglePause() {
            if (gameState === 'PLAYING') {
                gameState = 'PAUSED';
                document.getElementById('pause-screen').classList.remove('hidden');
            } else if (gameState === 'PAUSED') {
                gameState = 'PLAYING';
                document.getElementById('pause-screen').classList.add('hidden');
                lastTime = performance.now();
                requestAnimationFrame(gameLoop);
            }
        }

        function gameOver() {
            gameState = 'GAMEOVER';
            document.getElementById('hud-overlay').classList.add('hidden');
            document.getElementById('final-score').innerText = score;
            document.getElementById('final-kills').innerText = killCount;
            document.getElementById('game-over-screen').classList.remove('hidden');
        }

        function restartGame() {
            startGame();
        }

        function showShipSelect() {
            gameState = 'MENU';
            document.getElementById('pause-screen').classList.add('hidden');
            document.getElementById('game-over-screen').classList.add('hidden');
            document.getElementById('hud-overlay').classList.add('hidden');
            document.getElementById('ship-select-screen').classList.remove('hidden');
        }

        // --- INPUT EVENT LISTENERS ---
        window.addEventListener('keydown', (e) => {
            keys[e.code] = true;
            if (e.code === 'KeyP') {
                togglePause();
            }
        });

        window.addEventListener('keyup', (e) => {
            keys[e.code] = false;
        });

        function updateTouchPos(e) {
            const rect = canvas.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            touchPos.x = clientX - rect.left;
            touchPos.y = clientY - rect.top;
        }

        window.addEventListener('pointerdown', (e) => {
            if (gameState === 'PLAYING' || gameState === 'PAUSED') {
                if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;

                mouseControl = true;
                touchActive = true;
                updateTouchPos(e);

                if (gameState === 'PAUSED') {
                    togglePause();
                }
            }
        });

        window.addEventListener('pointermove', (e) => {
            if (touchActive) {
                updateTouchPos(e);
            }
        });

        function handlePointerRelease() {
            if (mouseControl && touchActive) {
                touchActive = false;
                if (gameState === 'PLAYING') {
                    togglePause();
                    document.getElementById('pause-tip').innerText = "松开操控 - 游戏已自动暂停（点击屏幕继续）";
                }
            }
        }

        window.addEventListener('pointerup', handlePointerRelease);
        window.addEventListener('pointercancel', handlePointerRelease);

        window.onload = () => {
            resizeCanvas();
        };
    <\/script>
</body>
</html>`;
        // ==== END ST_SHOOTER_SRC ====
