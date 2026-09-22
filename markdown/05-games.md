# 05 · 小游戏

> 对应代码：HTML `5566–5650`（入口 + 弹窗），JS `5954–7479`，CSS `1664–1916`
> （行号为 2026-09-21 第二十四轮实测；改完请用 `_verify/_audit-anchors.js` 复核 README 的两张表）

---

## 一、入口与弹窗

### 入口按钮

```html
<button class="action-btn game-entry-btn" onclick="openCatGame()">
    <span>🐱 小游戏</span>
</button>
```

位于日历卡片下方、页面居中。

### 弹窗（`#gameModal`）

```
.game-card（#gameCard）
├── .game-card-header
│   ├── ＜ 返回菜单（#backMenuBtn）
│   └── 标题（#gameModalTitle）
├── #gameMenuList     游戏选择列表（4 项）
├── #gameViewport     画布 + 虚拟按键（三个猫猫游戏共用）
│   ├── <canvas id="catGameCanvas" width="480" height="260">
│   ├── #touchControls  ◀ ▶（Doodle Jump 用）
│   ├── #dpadControls   ▲ ◀ ▶ ▼（Cat Parade 用）
│   └── #gameControlHint 操作提示文字
└── #gameShooterWrap  战机专用（整页游戏走这条）
    ├── #gameShooterFrameHost   ← iframe 挂在这里（挂载 / 卸载见 stShooterMount）
    └── .game-hint              操作提示
```

⚠ **`#gameViewport` 和 `#gameShooterWrap` 是二选一的关系**，任何时刻只该亮一个。
`stShooterReset()` 负责把后者收掉 —— 「回到菜单」「关弹窗」「切到别的游戏」三条路都要过它。

### 状态切换

| 函数 | 行为 |
|---|---|
| `openCatGame()` | 显示弹窗 + 回到菜单 |
| `closeCatGame()` | 隐藏弹窗 + `cancelAnimationFrame` + **`stShooterReset()`** + `activeGameType = null` |
| `showGameMenu()` | 停掉当前动画，切回菜单，隐藏所有虚拟按键 + **`stShooterReset()`** |
| `launchGame(type)` | 按类型初始化对应游戏（先 `stShooterReset()` 铺底，轮到战机再重新挂） |
| `stShooterMount()` | 建 iframe、`srcdoc = ST_SHOOTER_SRC`、挂进 `#gameShooterFrameHost`、**送焦点** |
| `stShooterUnmount()` | 把 iframe **从 DOM 摘掉**（+ 兜底清空 host） |
| `stShooterReset()` | `stShooterUnmount()` + 收起 `#gameShooterWrap` + 撤掉 `game-card--wide` |
| `stShooterFocus(f)` | `f.focus()` + `f.contentWindow.focus()`（**时机是关键**，见 §八） |

**切游戏 / 关弹窗时必须 `cancelAnimationFrame(gameAnimationId)`** —— 否则旧游戏的循环还在跑，两个 `requestAnimationFrame` 会同时往同一个 canvas 上画。

⚠ **`stShooterReset()` 那三件事必须一起做，所以抽成了一个函数。** 分头写两遍就一定有一遍会漏，
而漏掉的表现是「iframe 留在后台满帧空转」—— **看不见、也不报错**。
（这个项目在「展开键有两个」上已经栽过一次同款跟头。）

---

## 二、四个游戏

| type | 标题 | 玩法 | 操作 | 渲染方式 |
|---|---|---|---|---|
| `runner` | `Cat Runner.exe` | 经典横版跳跃避障 | SPACE / ↑ / 点击画布 | 共用 `#catGameCanvas` |
| `doodle` | `Cat Doodle Jump.exe` | 竖版无限踏板跳跃 | A / D 或 ← / → 或屏幕下方 ◀ ▶ | 共用 `#catGameCanvas` |
| `parade` | `Cat Parade.exe` | 贪吃蛇风猫猫游行 | WASD / 方向键 / 十字键 | 共用 `#catGameCanvas` |
| `shooter` | `Retro Vector Shooter.exe` | 复古线框战机 · 纵向弹幕 | WASD / 方向键 + J / 空格；鼠标或手指按住画面 = 自动开火；P 暂停 | **独立的 iframe**（见 §八） |

前三个游戏进入时先放一段开场（`phase: 'POST'`），再切到 `PLAY`。
`shooter` 是**整页游戏**，不走那套 `phase` 状态机，它自己有 `MENU / PLAYING / PAUSED / GAMEOVER`。

---

## 三、Cat Runner

### 状态（`runnerState`）

```js
{
  phase, postStep, postTimer, phaseTimer, transitionFlashTimer,
  score, highScore, speed, frameCount, nextSpawnFrame,
  cat: { x, y, width, height, vy, gravity, jumpPower, isGrounded, legFrame,
         jump(), update(), draw() },
  obstacles: []
}
```

### 参数

| 参数 | 值 |
|---|---|
| 重力 | `0.6` |
| 起跳力 | `-9.5` |
| 地面 | `y = 210` |
| 初始速度 | `2` |
| 首次生成障碍 | 第 `50` 帧 |

### 猫的绘制（`drawPixelCat`）

猫是**像素画**，用 `ctx.fillRect` 逐块画，不是贴图。

```js
drawPixelCat(x, y, isFacingLeft = false, furColor = '#444444', eyeColor = '#66ccff')
```

- `isFacingLeft` —— 水平翻转（用 `ctx.scale(-1, 1)`）
- `furColor` / `eyeColor` —— 毛色与眼睛颜色
- 腿的动画：`frameCount % 6 === 0` 时切一次 `legFrame`，两帧交替
- 跳跃中不画腿，改画两个爪子

### 随机配色（`getRandomCatColors`）

`NATURAL_FUR_COLORS` / `NATURAL_EYE_COLORS` —— 只从「自然的」毛色和眼睛颜色里挑，不会出现荧光绿猫。

---

## 四、Cat Doodle Jump

### 状态（`doodleState`）

```js
{ phase, postStep, postTimer, phaseTimer, transitionFlashTimer,
  score, highScore, … }
```

### 操作

| 输入 | 效果 |
|---|---|
| A / ← | 向左 |
| D / → | 向右 |
| `#btnLeft` / `#btnRight` | 触屏左右 |

`touchMoveState = { left: false, right: false }` 记录虚拟按键的按住状态。

`resetDoodleWorld()` 重置踏板世界（死了之后重开）。

---

## 五、Cat Parade（猫猫游行）

### 状态（`paradeState`）

```js
{
  phase, postStep, postTimer, phaseTimer, transitionFlashTimer,
  score, highScore,
  moveTimer, speedInterval: 18,     // 移动帧率：隔 18 帧走一格
  dir:     { x: 1, y: 0 },          // 当前方向
  nextDir: { x: 1, y: 0 },          // 下一次移动将改变的方向
  cats: [{ x: 5, y: 5, fur, eye }], // 猫队列，[0] 是主角
  wildCat: null
}
```

### 网格

```js
const GRID_SIZE = 24;                  // 一格 24px
const PARADE_CATCH_RADIUS = 1;         // 收集野生猫咪的判定半径（格）
```

画布 480×260 → **20 × 10 格**。

### 玩法

- 主角猫按 `dir` 方向每 18 帧走一格
- 地图上有野生猫（`wildCat`），走到 `PARADE_CATCH_RADIUS` 格内就收集，变成队列的一员
- 队列跟着主角的轨迹走
- `setParadeDirection(targetDir)` 设方向，**写进 `nextDir`**，到下一格才真正转向（防止一帧内连转两次导致自杀）

### 触屏

`handleParadeTouchPress(action)` —— 点画布也能转向。

---

## 六、共用机制

### 像素猫（`drawPixelCat`）

三个游戏共用一个画猫函数。参数：

| 参数 | 默认 | 说明 |
|---|---|---|
| `x`, `y` | —— | 左上角坐标 |
| `isFacingLeft` | `false` | 是否水平翻转 |
| `furColor` | `#444444` | 毛色 |
| `eyeColor` | `#66ccff` | 眼睛颜色 |

### 帧循环

每个游戏一个 `*Loop()` 函数（`runnerLoop` / `doodleLoop` / `paradeLoop`），内部 `requestAnimationFrame` 递归。

统一的结构：

```js
if (activeGameType !== 'runner') return;      // 切走了就退出
if (gameAnimationId) cancelAnimationFrame(gameAnimationId);
// …更新状态…
// …绘制…
gameAnimationId = requestAnimationFrame(runnerLoop);
```

### 最高分

`highScore` 在**内存里**（`runnerState.highScore` 等），**不持久化** —— 刷新页面就归零。

显示在画布右上角：`HI: {highScore}`。

更新逻辑：`if (!isDemo && s.score > s.highScore) s.highScore = s.score;`（`isDemo` 时不记分）。

### 键盘

`keysPressed` 是一个全局对象，`keydown` / `keyup` 维护。

**要过滤修饰键**：

```js
if (['Alt', 'Control', 'Meta', 'Shift', 'Tab', 'CapsLock'].includes(e.key)) return;
```

否则按一下 Shift 就会触发跳跃。

**要 `preventDefault()`**：

```js
if (e.code === 'Space' || e.code === 'ArrowUp') e.preventDefault();
```

否则空格会滚动页面、方向键会滚动容器。

### 触屏按键（`bindTouchButtonEvents`）

启动时统一绑定，给每个 `.touch-btn` / `.dpad-btn` 挂 `touchstart` / `touchend` / `mousedown` / `mouseup`，同时更新 `keysPressed` 和 `touchMoveState`。

**用 `touchstart` 而不是 `click`** —— 游戏按键要「按住持续生效」，`click` 只有抬起才触发。

---

## 七、相关 CSS

| 行号 | 选择器 |
|---|---|
| 1664 | `.modal-overlay` / `.game-card` |
| 1747 | `.game-menu-list` / `.game-item-btn` |
| 1796 | `.game-viewport` / `#catGameCanvas` |
| 1814 | `.touch-controls` / `.touch-btn` |
| 1824 | `.dpad-controls` / `.dpad-btn` |
| 1890 | `.game-card.game-card--wide` / `.game-shooter-wrap` / `#gameShooterFrame` |

复古模式下弹窗也跟着变 Win95 风格（CSS 1917 段）。

---

## 八、Retro Vector Shooter（整页游戏，用 iframe 内嵌）

### 它为什么不是「第四个 canvas 游戏」

原文件 `G:\retro_vector_space_shooter (1).html` 是一份**完整的独立网页**：
自带 Tailwind（CDN）+ Google Fonts + 自己的选机页 / HUD / 暂停页 / 结算页 + 3 种 Boss。
把它改写成在 480×260 那块 `#catGameCanvas` 上跑，等于重写一遍 —— 而且会丢掉 Boss 的线框画法。

所以走 **iframe**：`iframe` 是**独立文档**，它的 `id` / `class` / 全局变量**一个都不会漏到主页上来**，
代价只是要自己管好挂载与卸载。

### 内联，不是外链

`saki.html` 是**单文件**应用 —— 实测它对外**零个**本地相对引用（只有 Google Fonts 和 Discord 两个远程 URL）。
加一个 `games/shooter.html` 就等于把它从「双击就能跑的单文件」变成「要一起拷贝的目录」，
跟这个项目的立身之本冲突。所以整份源码**内联**成常量 `ST_SHOOTER_SRC`
（在 `<script>` 的**最末尾**，`26384 ~ 28737`，放在末尾是为了不打乱上面所有行号锚点）。

生成 / 校验都走 `_verify/_mk-shooter-embed.js`（三档：干跑 / `--go` / `--verify`）。
**五条转义规则**（每条挡一个解析器坑）：

| 规则 | 不转义会怎样 |
|---|---|
| `\` → `\\` | `/\d+/` **静默**变成 `/d+/` —— 游戏能开，正则全废 |
| `` ` `` → `` \` `` | 模板字面量被提前闭合，语法错误 |
| `${` → `\${` | 当成插值，报错或执行到不存在的东西 |
| `</script` → `<\/script` | 外层 `<script>` 被**提前掐断**，页面从这儿往后全废 |
| `<!--` → `<\!--` | HTML 词法器进 script-data-escaped 态，此后 `</script` **不再算结束标签** |

⚠ 前四条里 `\/` `\!` 都是 JS 的 NonEscapeCharacter（求值回 `/` `!`），
所以**运行时拿到的字符串跟原文一字不差** —— 这正是 `--verify` 要证的事（逐字节 sha1 比对）。
⚠ 文件里存 **CRLF**（跟 `saki.html` 其余部分统一），但 JS 规范要求模板字面量把 `<CR><LF>`
**规范化成 `<LF>`**，所以运行时那份是纯 LF。两边都对，别把「运行时没有 `\r`」当 bug。

### 挂载

```js
f.srcdoc = ST_SHOOTER_SRC;          // 不用 src：内容就在本文件里，不额外发请求
f.addEventListener('load', () => stShooterFocus(f));
host.appendChild(f);
stShooterFocus(f);                  // ⚠ 挂上去**立刻**送焦点，不能只等 load
```

### 卸载 —— 必须摘 DOM，不能只是藏起来

那个游戏的 `gameLoop` 长这样：

```js
function gameLoop(timestamp) {
    if (gameState !== 'PLAYING') {
        lastTime = timestamp;
        requestAnimationFrame(gameLoop);   // ⚠ 非 PLAYING 态照样 requeue
        return;
    }
    …
}
```

它靠这个在选机页 / 暂停页继续画星空 —— 代价是**循环一旦启动就永不停止**。
只把 iframe 藏起来的话，关掉弹窗之后它还在后台满帧跑，
而且**页面上什么都看不见、控制台也不报错**。

唯一可靠的停法是**把 iframe 从 DOM 里摘掉**（文档销毁 ⇒ 循环随之消失）。

### 焦点（键盘能不能用）

游戏的键盘监听挂在**它自己那个 window** 上。所以焦点必须真的进到 iframe 里，
否则按 WASD **一点反应都没有**，而游戏画面**看不出任何异常**（好好地显示着，就是不动）。

⚠ **时机是关键：挂上去（导航还没开始）就送。** 实测（2026-09-21 · headless Chrome）：
只把聚焦放在 `load` 里送的话，父页面 `activeElement` 还是 `BODY`、子文档 `document.hasFocus()`
还是 `false`；而且那个页面里有一条 `@import` 拉 Google Fonts，`load` 会被拖后好几秒，
期间游戏已经在跑了（`readyState` 是 `interactive`），键盘却一个键都不响应。

⚠ **套件分不出「元素 `focus()`」和「`contentWindow.focus()`」的差别** ——
`_reverse12.js` 的 R4 试过：只留后者、把前者拿掉时 87 条**全绿**（因为时机对了）。
所以 `game-verify.js` 守的是「焦点进没进去」这个**行为**，不是「用了哪个 API」这个实现细节。

### 画面尺寸

弹幕游戏挤在 `.game-card` 默认的 `max-width: 520px` 里没法玩，
所以 `launchGame('shooter')` 会给卡片加 `.game-card--wide`（`max-width: 960px`），
iframe 高度 `72vh` / `min-height: 320px` / `max-height: 680px`。
`stShooterReset()` 负责把这个类撤掉（否则玩完战机再玩别的，卡片会一直是宽的）。

### 已知依赖 / 没做的事

- **依赖 `cdn.tailwindcss.com`** —— 它是 iframe 里 `<head>` 的**阻塞脚本**，拉不下来游戏脚本就不执行
  （`game-verify.js` D 段第一条断言就是它，等不到会明说「多半是 CDN 没拉下来」）。
  这是原文件就有的依赖，没有去掉（去掉 = 重写整套 UI）。
- 原文件里的 Boss 血量、奖励波、AI 无线电那些**照搬**，没有改动游戏逻辑。
- 没有做「把游戏内分数记进主页」—— 两边是独立文档，要通信得再开一条 postMessage 通道。
