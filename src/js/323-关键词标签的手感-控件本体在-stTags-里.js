        // ===== 关键词标签的手感（控件本体在 stTags() 里）=====
        // 下面这几个都从 DOM 上读 data-path，改完统一 stSet 回去 ——
        // 模型始终是唯一事实来源，画出来的标签永远是模型的投影：
        // 万一写失败，标签当场不出现，而不是界面骗你说加上了

        function stTagHtml(base, i, word) {
            return '<span class="st-tag"><span>' + escapeHtml(word) + '</span>' +
                '<button type="button" class="st-tag-x" title="删掉「' + escapeHtml(word) + '」"' +
                    ' onclick="stTagsDel(\'' + base + '\',' + i + ')">×</button></span>';
        }

        // 重画标签。**只换标签节点，输入框原地留着** —— 整块重画一次光标就飞了，
        // 而这些词正是在输入框里一个字一个字敲出来的
        function stTagsPaint(base) {
            const box = document.getElementById(base + '-tags');
            const inp = document.getElementById(base);
            if (!box || !inp) return;
            const list = stSplitList(stGet(box.dataset.path));
            Array.prototype.forEach.call(box.querySelectorAll('.st-tag'), n => n.remove());
            // beforebegin 逐个插在输入框前面 ⇒ 顺序天然就是对的
            list.forEach((w, i) => inp.insertAdjacentHTML('beforebegin', stTagHtml(base, i, w)));
            inp.placeholder = list.length ? '' : (box.dataset.ph || '');
        }

        function stTagsFocus(base) {
            const inp = document.getElementById(base);
            if (inp) inp.focus();
        }

        // 落词。粘进来的一整串会按换行 / 逗号切成好几个；已经在列表里的不再加 ——
        // 否则重复词会静默堆起来，而重复的关键词对世界书匹配没有任何好处
        function stTagsCommit(base) {
            const box = document.getElementById(base + '-tags');
            const inp = document.getElementById(base);
            if (!box || !inp) return;
            const words = stSplitList(inp.value);
            inp.value = '';
            if (!words.length) return;
            const list = stSplitList(stGet(box.dataset.path));
            let added = false;
            words.forEach(w => { if (list.indexOf(w) < 0) { list.push(w); added = true; } });
            if (added) stSet(box.dataset.path, list.join('\n'));
            stTagsPaint(base);
        }

        // 粘贴。⚠⚠ 必须自己拦：`<input type="text">` 的 value 会被浏览器按 HTML 规范
        // **抹掉 `\r` / `\n`**（单行输入的 value sanitization），所以粘一行清单进来
        // 会静默粘成「ab」这种连体词 —— 旧版那句「一行一个」的提示其实从来没成立过。
        // 只有**含分隔符**的才接管；粘一个普通单词仍然让浏览器自己插，别抢原生手感
        function stTagsPaste(ev, base) {
            const dt = ev.clipboardData || window.clipboardData;
            if (!dt) return true;
            const text = String(dt.getData('text') || '');
            if (!text || !/[\n,，]/.test(text)) return true;
            const box = document.getElementById(base + '-tags');
            if (!box) return true;
            ev.preventDefault();
            const list = stSplitList(stGet(box.dataset.path));
            let added = false;
            stSplitList(text).forEach(w => {
                if (list.indexOf(w) < 0) { list.push(w); added = true; }
            });
            if (added) stSet(box.dataset.path, list.join('\n'));
            stTagsPaint(base);
            const inp = document.getElementById(base);
            if (inp) { inp.value = ''; inp.focus(); }
            return false;
        }

        function stTagsDel(base, i) {
            const box = document.getElementById(base + '-tags');
            if (!box) return;
            const list = stSplitList(stGet(box.dataset.path));
            if (i < 0 || i >= list.length) return;
            list.splice(i, 1);
            stSet(box.dataset.path, list.join('\n'));
            stTagsPaint(base);
            stTagsFocus(base);
        }

        // 回车落一个词。逗号也落 —— 旧版就是按 [\n,，] 切的，粘一串进来的手感得留着。
        // 输入框空着按退格 = 删掉最后一个（社交软件的常见手感）
        function stTagsKey(ev, base) {
            // ⚠ 中文输入法组字中的回车是「选字」，不是「落词」。
            // 不挡掉的话，打「你好」按回车上屏会把半个词落成标签
            if (ev.isComposing || ev.keyCode === 229) return true;
            if (ev.key === 'Enter' || ev.key === ',' || ev.key === '，') {
                ev.preventDefault();
                stTagsCommit(base);
                return false;
            }
            if (ev.key === 'Backspace' && ev.target.value === '') {
                const box = document.getElementById(base + '-tags');
                if (!box) return true;
                const list = stSplitList(stGet(box.dataset.path));
                if (list.length) {
                    ev.preventDefault();
                    stTagsDel(base, list.length - 1);
                    return false;
                }
            }
            return true;
        }

        function stGet(path) {
            const text = stListText(path);
            if (text !== undefined) return text;
            const r = stResolve(path);
            if (!r) return '';
            const v = r.obj[r.key];
            return (v === undefined || v === null) ? '' : v;
        }

        // 「留空 = 不设」的数字字段。判断必须按字段名来，不能看当前值的类型 ——
        // 一旦填过一次就变成 number，再清空就会被 Number('') 悄悄吃成 0
        const ST_NULLABLE_NUM = ['sticky', 'cooldown', 'delay', 'scanDepth', 'minDepth', 'maxDepth'];

        // 状态栏块里那几个「必须有界」的数字。敲空 / 敲 0 会让字号归零、
        // 条高归零，画布上一片空白，看着像坏了 —— 所以按字段名夹住。
        // 同样不能走下面那套「夹到 >= 0」：这里的下限是各自的下限，不是 0
        const ST_SB_NUM_RANGE = {
            size: [8, 40], height: [1, 60], count: [1, 20], gap: [0, 60]
        };

        function stSet(path, value) {
            // 规格是枚举，写死白名单，免得坏草稿 / 手抖写出 chara_card_v9
            if (path === 'card.spec') {
                if (ST_SPEC_LIST.indexOf(String(value)) < 0) return;
                stEditor.card.spec = String(value);
                stAfterSet(path);
                return;
            }
            if (stSetListText(path, value)) { stAfterSet(path); return; }
            const r = stResolve(path);
            if (!r) return;
            const leaf = String(path).slice(String(path).lastIndexOf('.') + 1);
            // MVU 变量和状态栏进度条的 min / max 是**可以负**的
            // （好感度 -100~100 这种），不能走下面那套「夹到 >= 0」的 nullable 逻辑 ——
            // 夹了之后负区间直接塌成 0，进度条画出来永远是满的
            const isRange = (leaf === 'min' || leaf === 'max') &&
                /^card\.(mvu\.nodes|statusBar\.blocks)/.test(String(path));
            if (isRange) {
                if (value === '' || value === null || value === undefined) r.obj[r.key] = null;
                else {
                    const n = Number(value);
                    r.obj[r.key] = Number.isFinite(n) ? Math.trunc(n) : null;
                }
                stAfterSet(path);
                return;
            }
            // 自由摆放的偏移：**可以负**（往左上挪），而且留空 = 回 0 而不是 null ——
            // 它是个实实在在的数字字段，不像 min / max 那样有「不设」这个状态
            const isOff = (leaf === 'offX' || leaf === 'offY') &&
                /^card\.statusBar\.blocks/.test(String(path));
            if (isOff) {
                const n = Number(value);
                r.obj[r.key] = (value === '' || value === null || value === undefined ||
                    !Number.isFinite(n)) ? 0 : stSbOffNum(n);
                stAfterSet(path);
                return;
            }
            // 状态栏块的显式尺寸。0 / 留空 = 自适应（不写这条声明），
            // 所以不能走下面那套「空值就不动」的 nullable 逻辑
            const isSz = (leaf === 'w' || leaf === 'h') &&
                /^card\.statusBar\.blocks/.test(String(path));
            if (isSz) {
                r.obj[r.key] = stSbSizeNum(value);
                stAfterSet(path);
                return;
            }
            // 状态栏块的尺寸类字段（字号 / 条高 / 圆点数 / 列间距）
            if (/^card\.statusBar\.blocks/.test(String(path)) && ST_SB_NUM_RANGE[leaf]) {
                const rg = ST_SB_NUM_RANGE[leaf];
                const n = Number(value);
                if (value !== '' && value !== null && value !== undefined && Number.isFinite(n)) {
                    r.obj[r.key] = Math.max(rg[0], Math.min(rg[1], Math.trunc(n)));
                }
                stAfterSet(path);
                return;
            }
            if (ST_NULLABLE_NUM.indexOf(leaf) >= 0) {
                if (value === '' || value === null || value === undefined) r.obj[r.key] = null;
                else {
                    const n = Number(value);
                    r.obj[r.key] = Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : null;
                }
                stAfterSet(path);
                return;
            }
            const cur = r.obj[r.key];
            let v;
            if (typeof cur === 'boolean') {
                v = (value === true || value === 'true');
            } else if (typeof cur === 'number') {
                const n = Number(value);
                v = Number.isFinite(n) ? Math.trunc(n) : cur;
            } else if (cur === null) {
                // 三态数字（sticky / cooldown / delay / scanDepth）：留空 = 不设
                if (value === '' || value === null || value === undefined) v = null;
                else {
                    const n = Number(value);
                    v = Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : null;
                }
            } else if (Array.isArray(cur)) {
                return;   // 数组字段一律走 stToggleIn
            } else if (typeof cur === 'object') {
                // 对象字段（一个块对象 / 一个变量节点 / statusBar 本身）不能被标量顶掉。
                // 顶掉了这一层就整个变成字符串，之后所有「按 id 找块」的遍历都会崩 ——
                // 曾经真的踩过：stSbClearColor 收到整块的路径，把块写成了 ''
                return;
            } else {
                v = String(value == null ? '' : value);
            }
            r.obj[r.key] = v;
            stAfterSet(path);
        }

        // 三态下拉：跟随全局 / 开 / 关
        function stSetTri(path, state) {
            const r = stResolve(path);
            if (!r) return;
            r.obj[r.key] = (state === 'inherit') ? null : (state === 'on');
            stAfterSet(path);
        }

        // 数组字段的勾选（triggers / placement）
        function stToggleIn(path, value, on) {
            const r = stResolve(path);
            if (!r || !Array.isArray(r.obj[r.key])) return;
            const arr = r.obj[r.key];
            const at = arr.indexOf(value);
            if (on && at < 0) arr.push(value);
            else if (!on && at >= 0) arr.splice(at, 1);
            if (arr.length && typeof arr[0] === 'number') arr.sort((a, b) => a - b);
            stAfterSet(path);
        }

        function stSetList(path, i, value) {
            const r = stResolve(path);
            if (!r || !Array.isArray(r.obj[r.key])) return;
            const arr = r.obj[r.key];
            // 越界不写。直接 arr[99] = 'x' 会把数组撑成 100 个空洞，
            // 导出时全变成 null —— 删到一半的槽位最容易踩这个
            if (i < 0 || i >= arr.length) return;
            arr[i] = String(value == null ? '' : value);
            stAfterSet(path);
        }

        function stSetGreeting(i, value) {
            const a = stEditor.card.alternateGreetings;
            if (i < 0 || i >= a.length) return;
            a[i] = String(value == null ? '' : value);
            stAfterSet('card.alternateGreetings[' + i + ']');
        }

        let stSaveTimer = null;
        function stScheduleSave() {
            if (stSaveTimer) clearTimeout(stSaveTimer);
            stSaveTimer = setTimeout(() => { stSaveTimer = null; stSaveDraft(); }, 400);
        }

        // 改完一个字段之后的收尾。默认只存不重画 —— 重画会把光标顶掉。
        // 只有「会让别的控件显隐变化」的那几个字段才重画
        // 改名字要顺手刷一下顶栏与折叠卡片上的摘要 —— 那是「我正在编哪张卡」的唯一提示，
        // 但都跟当前页无关，纯改文字不会动光标
        function stRefreshNameChrome() {
            const c = stEditor.card;
            const sub = document.getElementById('st-topbar-sub');
            if (sub) {
                sub.textContent = (String(c.name || '').trim() || '（未命名）') + ' · ' +
                    ST_SPEC_LABEL[c.spec] +
                    (stEditor.srcName ? ' · 来源 ' + stEditor.srcName : '');
            }
            renderStCard();
        }

        function stAfterSet(path) {
            stEditor.dirty = true;
            stScheduleSave();
            const p = String(path);
            // 条目备注 / 关键词 / 启用：只刷新那一行的摘要
            let m = /^card\.bookEntries\[(\d+)\]\.(comment|keysText|enabled)$/.exec(p);
            if (m) { stRefreshEntrySummary(Number(m[1])); return; }
            // 正则脚本名 / 生效范围：同样只刷摘要
            m = /^card\.regex\[(\d+)\]\.(scriptName|placement)$/.exec(p);
            if (m) { stRefreshRegexSummary(Number(m[1])); return; }
            // 酒馆助手脚本：名字 / 开关 / 按钮数变了就刷那一行的摘要
            if (/^card\.thScripts/.test(p)) { stRefreshThSummary(p); return; }
            // MVU：结构是唯一事实来源，任何改动都要同步进 Zod / initvar。
            // 改类型要整页重画（检查器的字段跟着类型变），其余只刷大纲上的那一行 ——
            // 名字是在输入框里一个字一个字敲的，重画会把光标顶掉
            if (/^card\.mvu\.nodes/.test(p)) {
                stMvuSync();
                if (/\.type$/.test(p)) { stRerender(); return; }
                if (/\.name$/.test(p)) stMvuRefreshRow(p);
                return;
            }
            // 状态栏：块列表是唯一事实来源，任何改动都要重画那条正则里的 HTML。
            // 但**不能**整页重画 —— 字号 / 间距是在输入框里一个字一个字敲的，
            // 重画会把光标顶掉、也会让画布闪。改成只重画面布 + 那一行的摘要
            if (/^card\.statusBar/.test(p)) {
                stSbSync();
                // 换类型 → 检查器的字段整组换掉，必须整页重画
                if (/\.type$/.test(p)) { stRerender(); return; }
                // 颜色变了 → 旁边那个「跟随主题」按钮要跟着出现 / 消失
                if (/\.(?:color|labelColor|emptyColor|valueColor)$/.test(p)) stSbRefreshColorBtn(p);
                stSbPaintCanvas();
                stSbRefreshRow(p);
                return;
            }
            // 名字 → 顶栏 + 卡片摘要
            if (p === 'card.name') { stRefreshNameChrome(); return; }
            // 换规格 → 各页的提示和结构预览都要变
            if (p === 'card.spec') { stRerender(); return; }
            // 换条目位置 → @D 才有的深度 / 角色要跟着显隐
            if (/\.position$/.test(p)) { stRerender(); return; }
        }

        function stRefreshEntrySummary(i) {
            const d = document.getElementById('st-entry-' + i);
            const e = stEditor.card.bookEntries[i];
            if (!d || !e) return;
            const sum = d.querySelector('.st-entry-sum');
            if (sum) {
                const keys = e.keys.join('、');
                sum.innerHTML = (e.comment ? escapeHtml(e.comment) : '<i>（没写备注）</i>') +
                    (keys ? ' · ' + escapeHtml(keys.slice(0, 40)) : '');
            }
            d.classList.toggle('st-entry-off', !e.enabled);
            const chip = d.querySelector('summary .st-chip');
            if (chip) {
                chip.textContent = e.enabled ? '启用' : '停用';
                chip.classList.toggle('st-on', !!e.enabled);
            }
        }

        function stRefreshRegexSummary(i) {
            const d = document.getElementById('st-regex-' + i);
            const r = stEditor.card.regex[i];
            if (!d || !r) return;
            const chips = d.querySelectorAll('summary .st-chip');
            if (chips[0]) {
                chips[0].textContent = r.disabled ? '停用' : '启用';
                chips[0].classList.toggle('st-on', !r.disabled);
            }
            if (chips[1]) {
                chips[1].textContent = r.placement.map(v => ST_REGEX_PLACEMENT[v] || v).join('/') || '没选范围';
            }
            const sum = d.querySelector('.st-entry-sum');
            if (sum) {
                sum.innerHTML = (r.scriptName ? escapeHtml(r.scriptName) : '<i>（没写名字）</i>') +
                    (r.findRegex ? ' · ' + escapeHtml(r.findRegex.slice(0, 40)) : '');
            }
            d.classList.toggle('st-entry-off', !!r.disabled);
        }

        // 酒馆助手脚本那一行的摘要。只改文字，不重画 —— 脚本内容是在 textarea 里
        // 一个字一个字敲的，重画一次光标就飞了
        function stRefreshThSummary(path) {
            const owner = stThOwnerPath(path);
            if (!owner) return;
            const el = document.getElementById(stThDomId(owner));
            if (!el) return;
            const r = stResolve(owner);
            const n = r ? r.obj[r.key] : null;
            if (!n) return;
            const isFolder = n.kind === 'folder';
            const on = isFolder ? (n.enabled !== false) : !!n.enabled;
            const chips = el.querySelectorAll('summary .st-chip');
            if (chips[0]) {
                chips[0].textContent = on ? '启用' : '停用';
                chips[0].classList.toggle('st-on', on);
            }
            if (chips[1]) {
                const num = isFolder ? n.scripts.length
                    : ((n.buttonEnabled && n.buttons.length) ? n.buttons.length : 0);
                chips[1].textContent = isFolder ? (num + ' 个脚本') : ('按钮 ' + num);
                chips[1].style.display = num ? '' : 'none';
            }
            const sum = el.querySelector('.st-entry-sum');
            if (sum) {
                sum.innerHTML = (isFolder ? '📁 ' : '') +
                    (n.name ? escapeHtml(n.name) : '<i>（没写名字）</i>');
            }
            el.classList.toggle('st-entry-off', !on);
        }

        // 只刷 MVU 大纲上的一行（名字 / 类型标签）。名字是一个字一个字敲出来的，
        // 整页重画会把光标顶掉
        function stMvuRefreshRow(path) {
            const base = String(path).replace(/\.(name|desc|value|int|min|max|type)$/, '');
            const r = stResolve(base);
            if (!r) return;
            const n = r.obj[r.key];
            if (!n || !n.id) return;
            const el = document.getElementById(stMvuDomId(n.id));
            if (!el) return;
            const span = el.querySelector('.st-mvu-name');
            if (span) span.innerHTML = n.name ? escapeHtml(n.name) : '<i>未命名</i>';
            const tag = el.querySelector('.st-mvu-tag');
            if (tag) tag.textContent = ST_MVU_TYPE_LABEL[n.type] || n.type;
        }

        // 重画但保住现场：展开的条目、滚动位置、焦点与光标
        // 画布自己的滚动位置。stRerender 会把 #st-sb-canvas 整个换掉，
        // 而 #st-panes 的 scrollTop 保住的是外层 —— 画布内部滚动会归零。
        // 表现就是「拖完一个块，画布跳回顶部」，迭代微调时非常难受
        let stSbScroll = { top: 0, left: 0 };

        function stRerender() {
            const panes = document.getElementById('st-panes');
            const scrollTop = panes ? panes.scrollTop : 0;
            const cv = document.getElementById('st-sb-canvas');
            if (cv) stSbScroll = { top: cv.scrollTop, left: cv.scrollLeft };
            const openIds = [];
            document.querySelectorAll('#st-panes .st-entry').forEach(d => {
                if (d.open && d.id) openIds.push(d.id);
            });
            const a = document.activeElement;
            const focusId = (a && a.id && document.getElementById(a.id) === a) ? a.id : '';
            let selStart = null, selEnd = null;
            if (focusId) {
                try {
                    if (typeof a.selectionStart === 'number') {
                        selStart = a.selectionStart;
                        selEnd = a.selectionEnd;
                    }
                } catch (e) {}
            }

            renderStEditor();

            openIds.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.open = true;
            });
            if (panes) panes.scrollTop = scrollTop;
            const cv2 = document.getElementById('st-sb-canvas');
            if (cv2) {
                cv2.scrollTop = stSbScroll.top;
                cv2.scrollLeft = stSbScroll.left;
            }
            if (focusId) {
                const el = document.getElementById(focusId);
                if (el) {
                    try {
                        el.focus();
                        if (selStart !== null && typeof el.setSelectionRange === 'function') {
                            el.setSelectionRange(selStart, selEnd);
                        }
                    } catch (e) {}
                }
            }
        }

