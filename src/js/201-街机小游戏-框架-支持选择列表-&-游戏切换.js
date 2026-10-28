        // ==========================================================================
        // 街机小游戏 框架 (支持选择列表 & 游戏切换)
        // ==========================================================================
        let activeGameType = null; // 'runner' | 'doodle' | 'parade'
        let gameCanvas, ctx;
        let gameAnimationId;

        let keysPressed = {};
        let touchMoveState = { left: false, right: false };

        function openCatGame() {
            const modal = document.getElementById('gameModal');
            modal.classList.add('active');
            showGameMenu();
        }

        function closeCatGame() {
            const modal = document.getElementById('gameModal');
            modal.classList.remove('active');
            if (gameAnimationId) cancelAnimationFrame(gameAnimationId);
            stShooterReset();
            activeGameType = null;
        }

        function showGameMenu() {
            if (gameAnimationId) cancelAnimationFrame(gameAnimationId);
            activeGameType = null;

            stShooterReset();
            document.getElementById('gameMenuList').style.display = 'flex';
            document.getElementById('gameViewport').style.display = 'none';
            document.getElementById('touchControls').style.display = 'none';
            document.getElementById('dpadControls').style.display = 'none';
            document.getElementById('backMenuBtn').style.display = 'none';
            document.getElementById('gameModalTitle').textContent = "Arcade Select.exe";
        }

        function launchGame(type) {
            activeGameType = type;
            document.getElementById('gameMenuList').style.display = 'none';
            document.getElementById('gameViewport').style.display = 'flex';
            document.getElementById('backMenuBtn').style.display = 'inline-block';
            // 先按「不是战机」铺好，下面真轮到它的时候再改
            stShooterReset();

            gameCanvas = document.getElementById('catGameCanvas');
            ctx = gameCanvas.getContext('2d');

            if (type === 'runner') {
                document.getElementById('touchControls').style.display = 'none';
                document.getElementById('dpadControls').style.display = 'none';
                document.getElementById('gameModalTitle').textContent = "Cat Runner.exe";
                document.getElementById('gameControlHint').textContent = "SPACE / UP / TOUCH TO JUMP";
                initRunnerGame();
            } else if (type === 'doodle') {
                document.getElementById('touchControls').style.display = 'flex';
                document.getElementById('dpadControls').style.display = 'none';
                document.getElementById('gameModalTitle').textContent = "Cat Doodle Jump.exe";
                document.getElementById('gameControlHint').textContent = "KEY A/D or LEFT/RIGHT | TOUCH BUTTONS BELOW";
                initDoodleGame();
            } else if (type === 'parade') {
                document.getElementById('touchControls').style.display = 'none';
                document.getElementById('dpadControls').style.display = 'grid';
                document.getElementById('gameModalTitle').textContent = "Cat Parade.exe";
                document.getElementById('gameControlHint').textContent = "WASD / ARROW KEYS / DPAD TO MOVE";
                initParadeGame();
            } else if (type === 'shooter') {
                // 整页游戏：不用那块 480×260 的画布，换成 iframe
                document.getElementById('gameViewport').style.display = 'none';
                document.getElementById('touchControls').style.display = 'none';
                document.getElementById('dpadControls').style.display = 'none';
                document.getElementById('gameShooterWrap').style.display = 'flex';
                document.getElementById('gameCard').classList.add('game-card--wide');
                document.getElementById('gameModalTitle').textContent = "Retro Vector Shooter.exe";
                stShooterMount();
            }
        }

