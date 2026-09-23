# 06 · 字体与主题

> 对应代码（⚠ 行号**会漂** —— 下面这几个数是旧轮次实测、之后往 `<style>` 里插过东西就没再跟，
> 跳转请 `grep` 横幅原文，别照抄数字）：CSS `1–78`（字体）、`1888–2190`（复古覆盖）、`3026–3130`（浮层复古）

---

## 一、字体栈总览

### 两种字体来源

| 来源 | 字体 | 用途 |
|---|---|---|
| **本地文件** | `Fusion Pixel 12px Proportional JA` | **全局基座**（时钟除外） |
| Google Fonts CDN | `Silkscreen` / `DotGothic16` / `ZCOOL Gaodeng` | 后备（离线时兜底） |
| Google Fonts CDN | `Share Tech Mono` | **时钟数字专用** |

CDN 引入（`<head>` 第 7–10 行）：

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DotGothic16&family=Share+Tech+Mono&family=Silkscreen&family=ZCOOL+Gaodeng&display=swap" rel="stylesheet">
```

### `@font-face`

```css
@font-face {
    font-family: 'Fusion Pixel 12px Proportional JA';
    src: url('./fonts/fusion-pixel-12px-proportional-ja.ttf') format('truetype');
    font-style: normal;
    font-weight: 100 900;
    font-display: swap;
}
```

**两个必须这么写的点**：

1. **CSS 里的 URL 必须用正斜杠。** 写 `'.\fonts\...'` 会被吃掉 —— 反斜杠在 CSS 里是转义符，`\f` 是换页符。
2. **`font-weight: 100 900` 是必须的。** 这字体只有一款，不声明范围的话 `font-weight: bold` 会让浏览器**合成伪粗体** —— 像素字被糊一层，12 px 下基本就毁了。

`font-display: swap` —— 字体没加载完先用后备字体渲染，加载完再换（避免首屏空白）。

### 全局基座

```css
* {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
    font-family: 'Fusion Pixel 12px Proportional JA', 'Silkscreen', 'DotGothic16', 'ZCOOL Gaodeng', monospace;
    user-select: none;
}
```

### 时钟例外

```css
.clock-container,
.clock-container *:not(.digital-clock) {
    font-family: 'Silkscreen', 'DotGothic16', 'ZCOOL Gaodeng', monospace;
}
```

时钟整卡保持**原有字体栈**（需求是「除时钟外」才换字）：

- 数字 `#clock` 仍是 `Share Tech Mono`（晶体管数字字体）
- 午前 / 午後 / 时区标签保持旧栈

> **`:not(.digital-clock)` 是必须的。** `.clock-container *` 的优先级是 (0,2,0)，会盖掉
> `.digital-clock` 的 (1,0,0)。不排除的话数字也会被换成像素字体。

### 其余四处单独的 `font-family`

| 选择器 | 位置 |
|---|---|
| `.ai-macro-preview code` / `.ai-hint code` | 宏预览里的代码 |
| `.ai-tv-preview` | 酒馆的「实际提示词结构」预览 |
| `body.retro-mode .title` | 复古模式标题 |
| `.st-json` | 编写器的 JSON 预览 |

这四处原本是 `'Share Tech Mono', monospace`，现在都换成了像素字体。

---

## 二、fusion-pixel 的五个语言变体 ⚠️

解压目录 `fusion-pixel-font-12px-proportional-ttf-v2026.09.01/` 里有 **5 个语言变体**：

| 文件 | 语言 |
|---|---|
| `fusion-pixel-12px-proportional-ja.ttf` | **日文（当前在用）** |
| `fusion-pixel-12px-proportional-zh_hans.ttf` | 简体中文 |
| `fusion-pixel-12px-proportional-zh_hant.ttf` | 繁体中文 |
| `fusion-pixel-12px-proportional-ko.ttf` | 韩文 |
| `fusion-pixel-12px-proportional-latin.ttf` | 仅拉丁 |

### 现状与影响

页面是 `lang="zh-CN"` 简体中文界面，但用的是 **`ja`（日文）** 变体。

实测结论（解析 TTF 的 cmap 与 glyf 表）：

- **覆盖完全相同** —— 三个变体都是 **36 558** 个字形；对页面里 1 038 个汉字，`ja` 也是 **0 缺字**。缺的 28 个字符全是 emoji（🐱🃏🎭…），那部分正常回退到系统 emoji 字体，显示正常
- **但字形不同** —— 逐字比 `glyf` 轮廓，**184 / 1 038 个字的写法不一样**

差的是这些字（部分）：

```
你 今 令 以 入 天 很 才 与 之 亲 亮 具 冷 准 初 判 包 化 反 取 台 商 器
处 复 外 娘 孩 将 少 差 底 延 弯 径 后 微 念 所 批 拉
```

都是常用字。日文汉字和简体字形在「令」「今」「具」「真」这类字上差别明显。

### 想换成简体字形

```bash
copy "fusion-pixel-font-12px-proportional-ttf-v2026.09.01\fusion-pixel-12px-proportional-zh_hans.ttf" fonts\
```

然后把 `@font-face` 的 `src` 改一行，并把 `font-family` 名里的 `JA` 改成 `SC`（或保持原名不改也行，只是名字对不上）：

```css
src: url('./fonts/fusion-pixel-12px-proportional-zh_hans.ttf') format('truetype');
```

### 加载方式

**`file://` 直接双击打开也能加载** —— 7 MB 本地 ttf，不需要 `--allow-file-access-from-files`，也不用起本地服务。`http://` 当然也可以。

---

## 三、复古模式（Win95 皮肤）

`toggleRetroMode()` 只是 `document.body.classList.toggle('retro-mode')`。

**不持久化** —— 刷新即恢复现代模式。

### 全局变化

| 元素 | 现代 | 复古 |
|---|---|---|
| 页面背景 | 流动渐变（`--color-1` … `--color-5`） | `#008080` 青绿 + 20 px 网格线 |
| 文字 | 白色 + 阴影 | 黑色 + 无阴影 |
| 标题 | 像素字体 | `#ffff00` 黄色 + 黑阴影 + `letter-spacing: 4px` |
| `.glass-card` | 毛玻璃 + 圆角 | `#c0c0c0` 灰 + 方角 + Win95 立体边框 |
| 卡片标题栏 | 无 | 伪元素 `content: " System Window"` |
| 按钮 | 圆角 + 阴影 | Win95 立体边框 |
| 时钟数字 | 浅色 | 绿色 CRT 荧光 + 发光 |

### Win95 立体边框的写法

```css
border: 2px solid;
border-color: #ffffff #808080 #808080 #ffffff;   /* 上左亮、下右暗 */
box-shadow: 2px 2px 0px #000000;
border-radius: 0;
```

### 各子系统的独立覆盖

复古覆盖**按子系统分开写**，不在一处：

| 行号 | 覆盖范围 |
|---|---|
| **217 / 309** | **API 全局配置弹窗** + **【ai对话】的「配置来源」**（第十八轮加的）。⚠ 这两块在 `<style>` **很靠前**的位置，**不在主复古块里** —— 找它要 `grep "retro-mode .apig"` |
| 2131 | 全局（body / 卡片 / 按钮 / 标题） |
| 2433 | 酒馆模式面板 |
| 3910 | 编写器浮层 |
| 5043 | Code 页（`.st-code-*`） |
| 5380 | 手机比例下的入口菜单（照 Win98 / Win2000 的下拉菜单） |
| 5505 | 「问一下」弹窗 |

⚠ **上面这串行号会漂，而且没有任何工具管它们**（`_audit-anchors.js` 只读 README §2/§3）。
要定位请 `grep` 横幅原文或选择器，**别照抄数字**。2026-09-23 实测这张表**整张都漂了**
（上一版写的 1888 / 2190 / 3026 / 5032 全对不上）。

**新增组件时别忘了补复古覆盖**，否则会出现「白底黑框的页面里插了一块浅蓝毛玻璃」。

### 手机菜单在复古下（Win98 / Win2000 下拉菜单）

`body.retro-mode .mobile-nav-*` 一整套，比别处多两条规矩：

| 元素 | 复古 |
|---|---|
| `#mobile-nav-btn`（左上角那个按钮） | `#c0c0c0` 灰 + 圆角归零 + **凸起**立体边框 |
| `#mobile-nav-name`（「正在编哪张卡」，在面板内、编写器下面） | `#c0c0c0` 灰 + **凹陷**边框（状态栏那种只读质感） |
| `.mobile-nav-box`（菜单框） | `#c0c0c0` 灰 + **凸起**立体边框 |
| `.mobile-nav-item`（两个入口） | **自己没有底色**（Win98 菜单项是平的）+ 圆角归零 |
| `.mobile-nav-item:hover` | **海军蓝底白字**（`#000080` / `#ffffff`） |

- ⚠ **边框 / 底色不能挂在 `.mobile-nav-panel` / `.mobile-nav-inner` 上** —— 那两个是折叠动画的
  容器（`grid-template-rows: 0fr`），收起来时高度是 0，而 `border` 与 `padding` **不进**那条账
  ⇒ 菜单关着也会在左上角留一道灰条。所以另起一个 `.mobile-nav-box` 当画框。
- ⚠ **基类的 `.mobile-nav-name` 只有一条 `border-top`（分隔线，非复古时用）**，
  复古覆盖必须写成完整的 `border: 2px solid` + 四角色 —— 只写 `border-color` 的话，
  那条 1px 的分隔线会留在 Win98 方框外面，看着像画歪了。
- ⚠ **「凸起 / 凹陷」就是同一组 `border-color` 反着写**（`#fff #808080 #808080 #fff` ⇄
  `#808080 #fff #fff #808080`），没有第三种方向。
- ⚠ 量 hover 的时候注意：按钮上挂着 `transition: background 0.3s`，过渡中途 Chrome 给的字符串是
  `rgba(192, 192, 192, 1)` —— **跟 `rgb(192, 192, 192)` 是同一个颜色、不同的字符串**。
  `smoke.js` 因此改成按数值比，不是比字符串。

### 编写器在复古下的特例

| 元素 | 复古配色 |
|---|---|
| 选项卡（未选中） | 白底黑字 |
| 选项卡（**选中**） | **深蓝底白字**（Win95 选中态，不是白底黑字） |
| `#st-status` | 白底黑字 |

### 放大模式的冲突

```css
body.retro-mode .ai-container.ai-maximized {
    /* 避开窗口标题栏（.glass-card 的 padding-top: 26px） */
}
```

复古模式给所有 `.glass-card` 加了 `padding-top: 26px`（给伪元素标题栏让位），放大模式下要单独修正。

---

## 四、字体验证的三个陷阱 ⚠️

判断「字体到底有没有生效」时踩过两个坑，都是**测量方法本身错了**：

### 陷阱 1：`document.fonts.check()` 不测字形覆盖

```js
document.fonts.check('12px "Share Tech Mono"', '的')   // → true
```

Chrome 里对「纯拉丁字体 + 中文」也返回 `true`。它**只能用来判断字体加载没加载**，不能用来判断某个字符有没有字形。

（一度因此得出「1 076 / 1 178 个字缺字」的错误结论。）

### 陷阱 2：宽度法区分不了 CJK 字体

「新字体量一次、旧栈量一次，宽度不同就是在用新字体」—— 这个办法**对拉丁有效，对 CJK 完全失效**：

> CJK 是全角方块字，任何 CJK 字体的**推进宽度都一样**（20 px 字号下都是 20 px）。

（一度因此得出「1 080 / 1 178 个字没换字体」的错误结论。）

另外块级元素 `getBoundingClientRect()` 量的是**容器宽**不是文字宽，要改用 `Range`。

### 陷阱 3：canvas 测量前必须等字体加载

```js
await document.fonts.load('12px "Fusion Pixel 12px Proportional JA"');
```

不加载的话 `ctx.font` 会**静默回退**，量出来全是后备字体的宽度。

（这就是那个假的「1 076 缺字」的来源。）

### 正确的做法：离线解析 TTF 比轮廓

`_verify/diag_glyphdiff.py` —— 零浏览器参与，快且决定性：

1. 读 `cmap` 表 → 字符 → glyph id
2. 读 `loca` + `glyf` 表 → 轮廓字节
3. 复合字形要递归展开
4. 逐字比字节

### 可用的诊断脚本

| 脚本 | 用途 |
|---|---|
| `diag_font.js` | 协议（`file://` / `http://`）+ computed style |
| `diag_fontdense.js` | 密集小字号截图（编写器 / 聊天区 / 复古） |
| `diag_fontpixel.js` | canvas 逐字比像素（确认 CJK 真由新字体渲染） |
| `diag_glyphdiff.py` | 离线轮廓比对（决定性） |

---

## 五、页面配色变量

```css
:root {
    --color-1: #79d2b3;   /* 薄荷绿 */
    --color-2: #79d2ca;
    --color-3: #79c4d2;
    --color-4: #79aed2;
    --color-5: #7998d2;   /* 蓝紫 */
}
```

背景是这五个颜色的 400% 尺寸渐变，`gradientShift` 15 s 无限循环。

放大模式宽度：

```css
--ai-max-width-pct: 85vw;      /* 窄窗口时按这个比例 */
--ai-max-width-max: 640px;     /* 桌面上实际上限 */
```

改放大模式的宽度就调这两个数。

---

## 六、其他全局设置

```css
* {
    user-select: none;      /* 全局禁止选中文字 */
}
```

**副作用**：聊天记录、角色卡正文、JSON 预览都选不中，想复制要手动 `user-select: text`。

如果以后要让某块可选，加：

```css
.ai-messages, .st-json, .ai-tv-text {
    user-select: text;
}
```
