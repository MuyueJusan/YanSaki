        // 切换复古模式逻辑（点击时钟触发）
        function toggleRetroMode() {
            document.body.classList.toggle('retro-mode');
        }

        // 时钟逻辑
        let clockTimezone = 'local';
        try { clockTimezone = localStorage.getItem('clockTimezone') || 'local'; } catch (e) {}

        // 获取当前时区的时/分/秒
        function getClockTimeParts() {
            if (clockTimezone === 'local') {
                const now = new Date();
                return {
                    hours: now.getHours(),
                    minutes: String(now.getMinutes()).padStart(2, '0'),
                    seconds: String(now.getSeconds()).padStart(2, '0')
                };
            }
            const parts = new Intl.DateTimeFormat('en-US', {
                timeZone: clockTimezone,
                hourCycle: 'h23',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            }).formatToParts(new Date());
            const get = (t) => (parts.find(p => p.type === t) || {}).value || '00';
            return {
                hours: parseInt(get('hour'), 10),
                minutes: get('minute'),
                seconds: get('second')
            };
        }

        // 所选时区**当天是几号**（本地时区直接走本地字段）。
        // ⚠ 跟 `getClockTimeParts()` 分开写：那个只取时/分/秒，这个要完整年月日。
        //   两者都走 `Intl.DateTimeFormat`，但**取的字段不同**，合并不了。
        function getClockDateParts() {
            if (clockTimezone === 'local') {
                const now = new Date();
                return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
            }
            const parts = new Intl.DateTimeFormat('en-US', {
                timeZone: clockTimezone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            }).formatToParts(new Date());
            const get = (t) => (parts.find(p => p.type === t) || {}).value || '0';
            return {
                year: parseInt(get('year'), 10),
                month: parseInt(get('month'), 10) - 1,
                day: parseInt(get('day'), 10)
            };
        }

        // 世界时间的日期偏移：所选时区比**本地**晚几天（正）/ 早几天（负）。
        // ⚠ 基准永远是**本地**日期，每帧拿本地重算 —— 不要「拿上一个时区累加」，那样会漂。
        // ⚠⚠ 把两个日历日期各折成「当天 00:00 的 **UTC** 毫秒」再相减：
        //   这样得到的必然是**整数天差**。直接拿两个 `Date` 相减会踩夏令时 ——
        //   切换日那天的间隔是 23 或 25 小时，除不尽 86400000，`Math.round` 就会在
        //   「只差 1 小时」的时候把它算成 1 天。
        // ⚠ 理论上限：地球上时区跨度 26 小时（UTC+14 ~ UTC-12）⇒ |偏移| 最大到 2。
        //   本机（UTC+8）配这份城市表只可能是 ±1，但**按真值输出**，别硬夹到 ±1（那是撒谎）。
        function getClockDayOffset() {
            const tz = getClockDateParts();
            const now = new Date();
            const tzMid = Date.UTC(tz.year, tz.month, tz.day);
            const localMid = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
            return Math.round((tzMid - localMid) / 86400000);
        }

        // 把日期偏移写到时钟旁边那个小徽标上（`【D+1】` / `【D-1】`）。
        // ⚠ 偏移为 0 时写**空字符串**，靠 CSS 的 `:empty` 完全收起 ——
        //   别写「同日」「本地」之类的占位，那会变成永久挂着的假标记。
        // ⚠ 缓存写在**元素自己的 `data-off`** 上，跟 `updateTodayBtn()` 同一个理由：
        //   这个函数被 `updateClock()` 每秒调一次，无条件写 `textContent`
        //   等于每秒触发一次样式失效（而且值几乎从不变）。
        function updateClockDayOffset() {
            const el = document.getElementById('clock-day-offset');
            if (!el) return;
            const off = getClockDayOffset();
            const text = off === 0 ? '' : '【D' + (off > 0 ? '+' : '') + off + '】';
            if (el.dataset.off === text) return;
            el.dataset.off = text;
            el.textContent = text;
        }

        function updateClock() {
            const { hours, minutes, seconds } = getClockTimeParts();

            const amIndicator = document.getElementById('am-indicator');
            const pmIndicator = document.getElementById('pm-indicator');

            if (hours < 12) {
                amIndicator.className = 'period-am active';
                pmIndicator.className = 'period-pm inactive';
            } else {
                amIndicator.className = 'period-am inactive';
                pmIndicator.className = 'period-pm active';
            }

            let h12 = hours % 12;
            h12 = h12 ? h12 : 12;
            const formattedHours = String(h12).padStart(2, '0');

            document.getElementById('clock').textContent = `${formattedHours}:${minutes}:${seconds}`;

            // 世界时间的日期偏移徽标（`【D+1】` / `【D-1】`）—— 跨 00:00 时它会自己翻。
            // ⚠ 它跟下面 `updateTodayBtn()` **不同源**：这个取**所选时区**的日期，
            //   那个取**本地**日期。切换时区时 `setClockTimezone()` 会调到 `updateClock()`，
            //   所以徽标跟着走；而日历那个「今日」按钮**不该**跟着时区变。
            updateClockDayOffset();

            // 顺带刷新日历那个「今日」按钮上的日子 —— 页面开着过夜时，跨过 00:00 它得自己翻到新的一天。
            // ⚠ 它取的是**本地**日期，跟上面这行 `getClockTimeParts()`（跟时区选择器走）**不同源**，
            //   别把两者合并（理由写在 `updateTodayBtn()` 上方）。
            updateTodayBtn();
        }

        // 时区列表（value 为 IANA 时区名，'local' 表示本地时间）
        const TIMEZONES = [
            { value: 'local', label: '本地时间' },
            { value: 'Asia/Shanghai', label: '北京' },
            { value: 'Asia/Hong_Kong', label: '香港' },
            { value: 'Asia/Taipei', label: '台北' },
            { value: 'Asia/Tokyo', label: '东京' },
            { value: 'Asia/Seoul', label: '首尔' },
            { value: 'Asia/Singapore', label: '新加坡' },
            { value: 'Asia/Bangkok', label: '曼谷' },
            { value: 'Asia/Kolkata', label: '新德里' },
            { value: 'Asia/Dubai', label: '迪拜' },
            { value: 'Europe/Moscow', label: '莫斯科' },
            { value: 'Europe/London', label: '伦敦' },
            { value: 'Europe/Paris', label: '巴黎' },
            { value: 'Europe/Berlin', label: '柏林' },
            { value: 'America/New_York', label: '纽约' },
            { value: 'America/Chicago', label: '芝加哥' },
            { value: 'America/Denver', label: '丹佛' },
            { value: 'America/Los_Angeles', label: '洛杉矶' },
            { value: 'America/Vancouver', label: '温哥华' },
            { value: 'America/Sao_Paulo', label: '圣保罗' },
            { value: 'Australia/Sydney', label: '悉尼' },
            { value: 'Pacific/Auckland', label: '奥克兰' },
            { value: 'Pacific/Honolulu', label: '檀香山' }
        ];

        function setClockTimezone(value) {
            clockTimezone = value;
            try { localStorage.setItem('clockTimezone', value); } catch (e) {}
            renderTimezoneButtons();
            updateClock();
        }

        function renderTimezoneButtons() {
            // 切换按钮上的文字显示当前选中的时区
            const labelEl = document.getElementById('clock-tz-label');
            if (labelEl) {
                const cur = TIMEZONES.find(t => t.value === clockTimezone);
                labelEl.textContent = cur ? cur.label : '本地时间';
            }
            const grid = document.getElementById('clock-tz-grid');
            if (!grid) return;
            grid.innerHTML = '';
            TIMEZONES.forEach(tz => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'tz-cell' + (tz.value === clockTimezone ? ' selected' : '');
                btn.textContent = tz.label;
                btn.addEventListener('click', () => setClockTimezone(tz.value));
                grid.appendChild(btn);
            });
        }

        function toggleTimezoneGrid() {
            const card = document.getElementById('clock-tz-card');
            if (card) card.classList.toggle('tz-collapsed');
        }

        // 日历状态
        let currentMode = 'day'; 
        let viewYear = new Date().getFullYear();
        let viewMonth = new Date().getMonth();

        function toggleCalendar() {
            const card = document.getElementById('calendar-card');
            card.classList.toggle('collapsed');
        }

        function updateCalendarView(actionCallback) {
            const card = document.getElementById('calendar-card');
            if (card.classList.contains('collapsed')) {
                card.classList.remove('collapsed');
            }

            const body = document.getElementById('calendar-body');
            body.classList.add('fade-out');

            setTimeout(() => {
                if (actionCallback) actionCallback();
                renderCalendar();
                body.classList.remove('fade-out');
            }, 200);
        }

        function switchMode(targetMode) {
            updateCalendarView(() => {
                currentMode = (currentMode === targetMode) ? 'day' : targetMode;
            });
        }

        function renderCalendar() {
            document.getElementById('title-year').textContent = `${viewYear}年`;
            document.getElementById('title-month').textContent = `${String(viewMonth + 1).padStart(2, '0')}月`;
            // 头部那一排标签一起刷新：年份 / 月份跟着 `viewYear` `viewMonth` 走，
            // 而「今日」按钮上的日子**永远是真的今天**（跟浏览到哪个月无关）。
            updateTodayBtn();

            const body = document.getElementById('calendar-body');
            body.innerHTML = '';

            if (currentMode === 'day') renderDaysView(body);
            else if (currentMode === 'month') renderMonthsView(body);
            else if (currentMode === 'year') renderYearsView(body);
        }

        function renderDaysView(container) {
            const grid = document.createElement('div');
            grid.className = 'days-grid';

            const weekdays = [
                { name: '日', class: 'sun' }, { name: '月', class: '' },
                { name: '火', class: '' }, { name: '水', class: '' },
                { name: '木', class: '' }, { name: '金', class: '' },
                { name: '土', class: 'sat' }
            ];

            weekdays.forEach(w => {
                const tag = document.createElement('div');
                tag.className = `weekday-tag ${w.class}`.trim();
                tag.textContent = w.name;
                grid.appendChild(tag);
            });

            const realNow = new Date();
            const realYear = realNow.getFullYear();
            const realMonth = realNow.getMonth();
            const realDate = realNow.getDate();

            const firstDayOfMonth = new Date(viewYear, viewMonth, 1);
            const lastDayOfMonth = new Date(viewYear, viewMonth + 1, 0);

            const startWeekday = firstDayOfMonth.getDay(); 
            const totalDays = lastDayOfMonth.getDate();

            const prevMonthLastDay = new Date(viewYear, viewMonth, 0).getDate();
            for (let i = startWeekday - 1; i >= 0; i--) {
                const cell = document.createElement('div');
                cell.className = 'day-cell other-month';
                cell.textContent = prevMonthLastDay - i;
                grid.appendChild(cell);
            }

            for (let day = 1; day <= totalDays; day++) {
                const cell = document.createElement('div');
                cell.className = 'day-cell current-month';
                cell.textContent = day;
                if (viewYear === realYear && viewMonth === realMonth && day === realDate) {
                    cell.classList.add('today');
                }
                grid.appendChild(cell);
            }

            const currentTotalCells = grid.children.length - 7;
            const nextMonthDays = (currentTotalCells % 7 === 0) ? 0 : 7 - (currentTotalCells % 7);
            for (let i = 1; i <= nextMonthDays; i++) {
                const cell = document.createElement('div');
                cell.className = 'day-cell other-month';
                cell.textContent = i;
                grid.appendChild(cell);
            }

            container.appendChild(grid);
        }

        function renderMonthsView(container) {
            const grid = document.createElement('div');
            grid.className = 'months-grid';

            for (let m = 0; m < 12; m++) {
                const cell = document.createElement('div');
                cell.className = 'month-cell';
                if (m === viewMonth) cell.classList.add('selected');
                cell.textContent = `${String(m + 1).padStart(2, '0')}月`;
                cell.onclick = () => {
                    updateCalendarView(() => {
                        viewMonth = m;
                        currentMode = 'day';
                    });
                };
                grid.appendChild(cell);
            }

            container.appendChild(grid);
        }

        function renderYearsView(container) {
            const grid = document.createElement('div');
            grid.className = 'years-grid';

            const startYear = viewYear - 4;

            for (let i = 0; i < 9; i++) {
                const y = startYear + i;
                const cell = document.createElement('div');
                cell.className = 'year-cell';
                if (y === viewYear) cell.classList.add('selected');
                cell.textContent = `${y}年`;
                cell.onclick = () => {
                    updateCalendarView(() => {
                        viewYear = y;
                        currentMode = 'month';
                    });
                };
                grid.appendChild(cell);
            }

            container.appendChild(grid);
        }

        function handlePrev() {
            updateCalendarView(() => {
                if (currentMode === 'day') {
                    viewMonth--;
                    if (viewMonth < 0) {
                        viewMonth = 11;
                        viewYear--;
                    }
                } else if (currentMode === 'month') {
                    viewYear--;
                } else if (currentMode === 'year') {
                    viewYear -= 9;
                }
            });
        }

        function handleNext() {
            updateCalendarView(() => {
                if (currentMode === 'day') {
                    viewMonth++;
                    if (viewMonth > 11) {
                        viewMonth = 0;
                        viewYear++;
                    }
                } else if (currentMode === 'month') {
                    viewYear++;
                } else if (currentMode === 'year') {
                    viewYear += 9;
                }
            });
        }

        // 「今日」按钮上显示的是**当前日**（`2日` / `31日`），点它仍然回到今天。
        // ⚠⚠ 日期必须取**本地** `new Date().getDate()` —— 与 `resetToToday()` **同源**。
        //   **不要**图省事用 `getClockTimeParts()`：那个是跟着**时区选择器**走的
        //   （时钟可以切成东京 / 纽约时间），而日历的「今天」永远是本地的今天。
        //   两处判据不同源 ⇒ 症状是「按钮写着 3 日、点下去跳到 2 日」这种自相矛盾。
        // ⚠ 缓存写在**元素自己的 `data-day` 上**，而不是模块级 `let`：`updateClock()` 每秒都会来调
        //   它一次（为了页面开着过夜时能自动翻到新的一天），不做缓存就是每秒动一次 DOM。
        //   而 `updateClock()` 还有一处调用点在 `setClockTimezone()` 里 —— 用外层 `let` 的话，
        //   哪天有人把它挪到脚本求值期就会撞 TDZ（`ReferenceError`，而且症状离现场很远）；
        //   挂在元素上没有这个顺序依赖。
        function updateTodayBtn() {
            const el = document.getElementById('today-btn');
            if (!el) return;
            const d = String(new Date().getDate());
            if (el.dataset.day === d) return;
            el.dataset.day = d;
            el.textContent = d + '日';
        }

        function resetToToday() {
            updateCalendarView(() => {
                const now = new Date();
                viewYear = now.getFullYear();
                viewMonth = now.getMonth();
                currentMode = 'day';
            });
        }

