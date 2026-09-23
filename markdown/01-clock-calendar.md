# 01 · 时钟与日历

> 对应代码（⚠ 行号**会漂** —— 下面这几个数是旧轮次实测、之后往 `<style>` 里插过东西就没再跟，
> 跳转请 `grep` 横幅原文，别照抄数字）：HTML `3248–3292`，JS `3655–3965`，CSS `144–525`

---

## 一、时钟卡片

### 结构

```html
<div class="clock-container glass-card tz-collapsed" id="clock-tz-card">
    <div class="clock-display">
        <div class="period-box">
            <span id="am-indicator" class="period-am">午前</span>
            <span id="pm-indicator" class="period-pm">午後</span>
        </div>
        <div id="clock" class="digital-clock" onclick="toggleRetroMode()"
             title="点击切换复古 / 现代模式">00:00:00</div>
    </div>
    <button id="clock-tz-toggle" class="tz-toggle" onclick="toggleTimezoneGrid()">
        <span id="clock-tz-label">本地时间</span> <span class="tz-toggle-icon">▾</span>
    </button>
    <div class="tz-collapse-wrapper">
        <div class="tz-grid" id="clock-tz-grid"></div>
    </div>
</div>
```

### 行为

| 元素 | 行为 |
|---|---|
| 数字时钟 | **点击切换复古模式**（`body.retro-mode`），不弹窗、不跳转 |
| 午前 / 午後 | 12 小时制的指示器，`< 12` 时午前亮、否则午後亮 |
| 时区按钮 | 点击展开 / 折叠时区网格（切换 `#clock-tz-card` 上的 `tz-collapsed` 类） |
| 时区格子 | 点击即切换，选中项加 `.selected` |

### 时间显示格式

**12 小时制**，格式 `HH:MM:SS`：

```js
let h12 = hours % 12;
h12 = h12 ? h12 : 12;               // 0 点显示成 12
const formattedHours = String(h12).padStart(2, '0');
```

`hours` 来自 `getClockTimeParts()`：

- `clockTimezone === 'local'` → 直接用 `new Date()` 的本地 `getHours()`
- 否则用 `Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', ... })`
  + `formatToParts()` 取值。用 `hourCycle: 'h23'` 是为了避开 12 小时制带来的
  `AM/PM` 歧义（`h23` 下 0 点是 `00`，不会变成 `24`）

### 时区列表（`TIMEZONES`，23 项）

| 区域 | 时区 |
|---|---|
| 本地 | `local` |
| 亚洲 | 北京 / 香港 / 台北 / 东京 / 首尔 / 新加坡 / 曼谷 / 新德里 / 迪拜 |
| 欧洲 | 莫斯科 / 伦敦 / 巴黎 / 柏林 |
| 美洲 | 纽约 / 芝加哥 / 丹佛 / 洛杉矶 / 温哥华 / 圣保罗 |
| 大洋洲 | 悉尼 / 奥克兰 / 檀香山 |

时区选择存在 `localStorage.clockTimezone`，页面加载时读回（`try/catch` 兜住隐私模式）。

### 刷新

`setInterval(updateClock, 1000)` —— 启动时先立即调一次，避免第一秒显示 `00:00:00`。

### 字体（重要）

时钟是**唯一不跟随全局字体**的地方。CSS 里：

```css
.clock-container,
.clock-container *:not(.digital-clock) {
    font-family: 'Silkscreen', 'DotGothic16', 'ZCOOL Gaodeng', monospace;
}
```

- 数字 `#clock` 保持 `Share Tech Mono`（晶体管数字字体）
- `:not(.digital-clock)` 是必须的：`.clock-container *` 的优先级 (0,2,0) 会盖掉
  `.digital-clock` 的 (1,0,0)，不排除的话数字也会被换成像素字体

详见 [06-fonts-theme.md](06-fonts-theme.md)。

---

## 二、交互式日历

### 结构

```html
<div class="calendar-container glass-card collapsed" id="calendar-card">
    <div class="calendar-header">
        <button class="cal-btn" onclick="handlePrev()">＜</button>
        <div class="header-title-box">
            <span id="title-year"  class="clickable-title" onclick="switchMode('year')">2026年</span>
            <span id="title-month" class="clickable-title" onclick="switchMode('month')">09月</span>
            <button class="cal-btn today-btn" onclick="resetToToday()">今日</button>
        </div>
        <div style="display: flex; gap: 6px;">
            <button class="cal-btn" onclick="handleNext()">＞</button>
            <button class="cal-btn toggle-btn" onclick="toggleCalendar()" title="展开/折叠日历">
                <span class="toggle-icon">▲</span>
            </button>
        </div>
    </div>
    <div class="calendar-collapse-wrapper">
        <div class="calendar-collapse-inner">
            <div class="calendar-body" id="calendar-body">
                <!-- JS 动态渲染 -->
            </div>
        </div>
    </div>
</div>
```

**默认折叠**（`collapsed` 类）。展开 / 折叠由最右边那个 **▲ 按钮**（`toggleCalendar()`）控制。

> 注意：点年份 / 月份标题调的是 `switchMode()`（切视图），**不是**展开日历。视图切换函数里会顺手展开卡片，所以第一次点标题也能看到内容。

### 三种视图

状态变量（`3769–3771`）：

```js
let currentMode = 'day';                    // 'day' | 'month' | 'year'
let viewYear  = new Date().getFullYear();
let viewMonth = new Date().getMonth();
```

| 视图 | 渲染函数 | 内容 |
|---|---|---|
| `day` | `renderDaysView()` | 月历格子，今天高亮 |
| `month` | `renderMonthsView()` | 12 个月份格子 |
| `year` | `renderYearsView()` | 9 年一屏 |

### 视图切换

点年份 / 月份标题调 `switchMode(target)`：

```js
function switchMode(targetMode) {
    updateCalendarView(() => {
        currentMode = (currentMode === targetMode) ? 'day' : targetMode;
    });
}
```

**点同一个标题两次会回到日视图**（`currentMode === targetMode ? 'day' : targetMode`）。

### 翻页步长

`handlePrev()` / `handleNext()` 按当前视图决定步长：

| 视图 | 上一页 / 下一页 |
|---|---|
| `day` | `viewMonth ± 1`（跨年自动进位 / 借位） |
| `month` | `viewYear ± 1` |
| `year` | `viewYear ± 9`（一屏 9 年） |

### 切换动画

所有视图切换都走 `updateCalendarView(callback)`：

1. 若卡片折叠 → 先展开
2. 给 `#calendar-body` 加 `.fade-out`
3. `setTimeout(200ms)` → 执行 callback → `renderCalendar()` → 移除 `.fade-out`

这 200 ms 就是 CSS 淡出动画的时长，改 CSS 动画时长时记得同步。

### 今日高亮

`renderDaysView()` 里比较 `viewYear === realYear && viewMonth === realMonth && day === realDate`。

`resetToToday()` 把三个状态一次性还原并把 `currentMode` 强制设回 `'day'`。

---

## 三、复古模式

`toggleRetroMode()` 只是 `document.body.classList.toggle('retro-mode')`，**不持久化**（刷新即恢复现代模式）。

复古模式影响整个应用，不只是时钟：

| 区域 | 变化 |
|---|---|
| 时钟数字 | 绿色 CRT 荧光色 |
| 标题 | 换 `DotGothic16`（CSS 1888 起） |
| 所有毛玻璃卡片 | 变白底黑框（Win95 风格） |
| 酒馆面板 | 独立覆盖（CSS 2190 起） |
| 编写器浮层 | 独立覆盖（CSS 3026 起） |
| 选项卡选中态 | **深蓝底白字**（不是白底黑字，Win95 选中态） |

编写器和酒馆面板的复古覆盖是**分开写的**，新增组件时别忘了补。

---

## 四、相关 CSS 锚点

| 行号 | 选择器 |
|---|---|
| 144 | `.clock-container` |
| 162 | `.tz-toggle`（时区切换开关） |
| 209 | `.tz-cell` / `.tz-grid` |
| 274 | `.digital-clock` |
| 289 | `.calendar-container` |
| 3237 | 复古皮肤下避开窗口标题栏的 `.glass-card` padding 调整 |
