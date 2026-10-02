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
        <!-- 日期偏移徽标：文案由 `updateClockDayOffset()` 写。
             ⚠ 这里**必须留空**，别放占位文字 —— 空文案靠 CSS 的 `:empty` 完全收起。 -->
        <span id="clock-day-offset" class="clock-day-offset"
              title="所选时区的日期与本地日期相差的天数"></span>
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
| 日期偏移徽标 | 时钟右边的小字，显示 `【D+1】` / `【D-1】`；偏移为 0 时**完全收起**（见下） |

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

### 日期偏移徽标（`【D+1】` / `【D-1】`）

世界时间跟本地**不在同一天**时，时钟右边出现一个小字标记：所选时区的日期比本地**晚**一天
显示 `【D+1】`，**早**一天显示 `【D-1】`。本地时间自己**永远不标**（它是基准）。

三个函数，各管一段：

| 函数 | 职责 |
|---|---|
| `getClockDateParts()` | 取**所选时区**当天的 `{year, month, day}`；`local` 走本地字段，否则 `Intl.DateTimeFormat` 的 `formatToParts` |
| `getClockDayOffset()` | 所选时区日期 − **本地**日期，返回整数天（正 = 晚，负 = 早） |
| `updateClockDayOffset()` | 把 `【D±N】` 写到 `#clock-day-offset` 上；偏移 0 时写**空串** |

调用点在 `updateClock()` 里（紧跟时钟文案那次写入），所以：

- 每秒刷新 ⇒ 页面开着跨 00:00 时它**自己翻**；
- `setClockTimezone()` 里会调 `updateClock()` ⇒ 换城市时它跟着换。

⚠⚠ **基准永远是「本地日期」，不是「上一个看过的时区」。** 每帧拿本地重算。
拿上一个时区累加会漂，而且症状很难看：连点几个城市之后徽标开始胡说。

⚠⚠ **整数天差必须靠 `Date.UTC(...)` 折算，不能拿两个 `Date` 直接相减。**
两个日历日期各折成「当天 00:00 的 **UTC** 毫秒」再相减，结果必然是整数天；
直接相减会踩夏令时 —— 切换日那天是 23 或 25 小时，除不尽 `86400000`，
`Math.round` 就会在「其实只差 1 小时」的时候把它算成 1 天。

⚠⚠ **偏移 0 时必须写空串，靠 CSS 的 `.clock-day-offset:empty { display: none }` 收起。**
只清 `textContent` 是不够的：元素本身还在，一个 `margin-left` 会把时钟往左推 ——
而「本地时间」下它**永远是空的**，也就是说是常态，不是边角情况。
同理，**别写「同日」「本地」之类的占位文字**，那会变成一个永久挂着的假标记。

⚠ **文案不硬夹到 ±1。** 按真值输出 `D+N` / `D-N`：地球上时区跨度 26 小时
（UTC+14 ~ UTC-12）⇒ 理论上能到 ±2。本机（UTC+8）配这份城市表只可能是 ±1，
但夹到 ±1 就是撒谎。

⚠ **缓存写在元素自己的 `data-off` 上**（跟日历那个「今日」按钮的 `data-day` 同一个理由）：
这个函数被 `updateClock()` **每秒**调一次，无条件写 `textContent` 等于每秒触发一次样式失效，
而值几乎从不变。

⚠⚠ **它跟日历的「今日」按钮判据**不同源**，别合并：**
徽标取**所选时区**的日期，日历那个按钮取**本地**日期。
混起来就会「时钟说东京是 3 日、日历的今日按钮也变成 3 日」。

配套：
- 断言在 `_verify/smoke.js`（`== 世界时间：日期偏移徽标 ==`，7 条）；
  期望值**现扫城市表**算出，且走一条**跟产品不同的机制**（`timeZoneName: 'longOffset'`
  取偏移分钟数 → 加时间 → 读 UTC 年月日），避免「两条路径读同一个值」。
- 反向测试 `_verify/_reverse23.js`（R1 文案恒空 / R2 方向取负 / R3 删调用点）。

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
            <button class="cal-btn today-btn" id="today-btn" onclick="resetToToday()">今日</button>
            <!-- ⚠ 上面这个「今日」只是**脚本跑起来之前的兜底**：真跑起来时
                 `updateTodayBtn()` 会把它改写成**当前日**（如 `2日` / `31日`）。 -->
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

### 头部那个按钮：**显示当前日** + 点它回到今天

按钮文案**不是**写死的「今日」（2026-10-02 改）—— `updateTodayBtn()` 把它写成 `<本地日>日`
（`2日` / `31日`）。它由两个地方驱动，**两处都要在**：

| 调用点 | 管什么 |
|---|---|
| `renderCalendar()` 里 | 初始化 + 每次翻页 / 切视图时刷新 |
| `updateClock()` 里 | 页面开着过夜、跨过 00:00 时自己翻到新的一天（那个 tick 每秒一次） |

⚠⚠ **日期取本地 `new Date().getDate()`，与 `resetToToday()` 同源。**
**别**图省事改用 `getClockTimeParts()` —— 那个跟着**时区选择器**走（时钟可以切成东京 / 纽约时间），
而日历的「今天」永远是本地的今天。两处判据不同源的症状是
**「按钮写着 3 日、点下去跳到 2 日」**这种自相矛盾。

⚠ 跨日缓存写在**元素自己的 `data-day`** 上，不用模块级 `let`：`updateClock()` 每秒都会来调它，
不缓存就是每秒动一次 DOM；而 `updateClock()` 在 `setClockTimezone()` 里还有一处调用点，
用外层 `let` 的话哪天被挪到脚本求值期就会撞 TDZ（`ReferenceError`，症状离现场很远）。

⚠ 按钮文案**不跟着浏览的月份走** —— 翻到 9 月时它照样显示今天那个日子。
`smoke.js` 里有一条专门盯这件事（配「点 ＜ 之后确实离开了当前月」作对照组）。
反向测试：`_verify/_reverse22.js`（R1 = 文案永不写；R2 = `resetToToday` 不再回到今天）。

---

## 三、复古模式

`toggleRetroMode()` 只是 `document.body.classList.toggle('retro-mode')`，**不持久化**（刷新即恢复现代模式）。

复古模式影响整个应用，不只是时钟：

| 区域 | 变化 |
|---|---|
| 时钟数字 | 绿色 CRT 荧光色 |
| 日期偏移徽标 | 跟着时钟变绿（**单独一条覆盖**：白字压在灰底卡片上会糊成一片） |
| 标题 | 换 `DotGothic16`（CSS 1888 起） |
| 所有毛玻璃卡片 | 变白底黑框（Win95 风格） |
| 酒馆面板 | 独立覆盖（CSS 2190 起） |
| 编写器浮层 | 独立覆盖（CSS 3026 起） |
| 选项卡选中态 | **深蓝底白字**（不是白底黑字，Win95 选中态） |

编写器和酒馆面板的复古覆盖是**分开写的**，新增组件时别忘了补。
⚠ 时钟卡片里**每个**可见元素都要单独补一条 `body.retro-mode …` ——
新加 `.clock-day-offset` 时就是这样：不补的话现代模式看着没问题，
一切复古它就变成白字白底，而且**没有任何断言会红**（断言只看文案，不看颜色）。

---

## 四、相关 CSS 锚点

⚠ **下表是 `saki.html` 的绝对行号**（`grep -n` 出来的），会随改动**静默漂** ——
用之前先核一遍，一条命令就能重取：

```bash
for s in .clock-container .tz-toggle .tz-grid .tz-cell .digital-clock \
         .clock-day-offset .calendar-container; do
  printf '%-22s %s\n' "$s" "$(grep -n -F "$s {" saki.html | head -1 | cut -d: -f1)"
done
```

| 行号 | 选择器 |
|---|---|
| 439 | `.glass-card` |
| 452 | `.clock-container` |
| 470 | `.tz-toggle`（时区切换开关） |
| 517 | `.tz-grid` |
| 525 | `.tz-cell` |
| 582 | `.digital-clock` |
| 603 | `.clock-day-offset`（日期偏移徽标） |
| 615 | `.clock-day-offset:empty`（**空文案时彻底收起**，别删） |
| 618 | `.calendar-container` |
| 2335 | `body.retro-mode .clock-day-offset`（复古皮肤） |
| 2279 | 复古皮肤下避开窗口标题栏的 `.glass-card` padding 调整 |
