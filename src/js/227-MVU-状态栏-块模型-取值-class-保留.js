        // 只改 DOM 的话重绘一次「生成中…」就没了
        function stSbAiRowHtml() {
            const busy = stEditor.sbPfAiBusy === true;
            return '<div class="st-sb-pf-cat">让 AI 生成' +
                ' <span class="st-hint-inline">写一句你要什么，它拼好一组存进「我的预制块」</span></div>' +
                '<div class="st-sb-pf-save">' +
                '<input id="st-sb-pf-ai" type="text" maxlength="' + ST_SB_AI_DESC_MAX + '"' +
                ' placeholder="例如：生命值和魔力，两条进度条"' +
                ' value="' + escapeHtml(stEditor.sbPfAiDesc || '') + '"' +
                ' oninput="stSbAiDescSet(this.value)">' +
                '<button class="st-mini" id="st-sb-pf-ai-btn" type="button"' +
                (busy ? ' disabled' : '') +
                ' onclick="stSbAiPrefabRun()">' + (busy ? '⏳ 生成中…' : '✨ 生成') + '</button>' +
                '</div>';
        }

        function stBlankSbBlock(type) {
            const t = ST_SB_BLOCKS.indexOf(type) >= 0 ? type : 'text';
            return {
                id: stUuid(),
                type: t,
                text: '',          // title / text / html
                path: '',          // var / bar / dots：变量路径，含 stat_data. 前缀
                label: '',         // var / bar / dots：左边的显示名
                showLabel: true,
                showValue: true,
                min: 0,
                max: t === 'dots' ? 5 : 100,   // 圆点默认 0..5，跟 count 对齐才直观
                count: 5,          // dots：圆点个数
                icon: '●',         // dots：圆点字符
                size: 13,          // 字号 px
                color: '',         // 覆盖颜色，空 = 跟主题
                // 下面两个是「解析别人的状态栏」逼出来的：显示名那排和圆点里
                // **没点亮**那排，颜色是各自独立的。不单独存的话，解析一张手写卡
                // 就会把作者挑的那两个颜色换成主题的
                labelColor: '',    // var / bar / dots：显示名的颜色，空 = 跟主题的次要色
                emptyColor: '',    // dots：没点亮那排的颜色，空 = 跟主题的边框色
                // bar / dots：右边那个**数值**的颜色。var 不用它 —— var 的
                // color 本来就是数值的颜色。bar 的 color 是填充色、dots 的
                // color 是点亮色，所以这两个的数值色得单独存
                valueColor: '',
                bold: false,
                align: 'left',
                height: 8,         // bar 条高 / space 高度 px
                gap: 8,            // row 列间距 px
                track: '',         // bar：轨道底色，空 = 默认那层半透明灰
                // 下面三个是「解析别人的状态栏」时用来**保原样**的。存的全是
                // 原稿里有、生成器不会产出的声明，写出去时追加在最后 ——
                // 同属性后者胜，所以它们盖得住生成器那一层，原稿的样子就保下来了。
                //   extra      → 块最外层元素
                //   extraInner → 内部那层「底」（bar 的轨道 / dots 装圆点的那层）
                //   extraFill  → 内部那层「亮」（bar 的填充 / dots 的亮点层）
                //   wrapExtra  → 在分组里时，外面那层「列」容器
                extra: '',
                extraInner: '',
                extraFill: '',
                wrapExtra: '',
                // 原稿元素上的 class。运行时的界面是**真 iframe、独立文档**，
                // `<style>` 照常生效，所以「<style>.hp-k{}</style> + <span class="hp-k">」
                // 是完全正当的写法 —— class 一丢那段 CSS 就落空，而且不报错，只是样子不对。
                //
                // 按**层**存，因为生成器每层都写固定结构，只有 class 是它画不出来的：
                //   outer → 块最外层            label → 显示名那排
                //   value → 数值那排            inner → 「底」（bar 轨道 / dots 装圆点层）
                //   fill  → 「亮」（bar 填充 / dots 亮点层）
                //   empty → dots 里没点亮那排   wrap  → 在分组里时外面那层「列」容器
                clsMap: {
                    outer: '', label: '', value: '',
                    inner: '', fill: '', empty: '', wrap: ''
                },
                // 原稿在**这一层**的内联 style 里真正写过哪些属性名。
                //
                // 生成器要写的外观声明，凡是这份名单里没有的，一律**不写** ——
                // 那条长相归 class（或者归浏览器默认），生成器一写内联就把它盖住了，
                // 而且不报错，只是样子不对。
                //
                // 记到「属性」这一档、而不是「层」这一档：手写稿里一层常常是
                // 字号自己写、颜色靠 class（`style="font-size:13px"` 挂在
                // `<span class="hp-v">` 上），按层判就整层都放过，颜色当场被盖
                clsOwn: {
                    outer: [], label: [], value: [],
                    inner: [], fill: [], empty: [], wrap: []
                },
                // 自由摆放的偏移（px，可以为负）。生成时写成
                // `position:relative;left:Xpx;top:Ypx`。
                //
                // 用**相对**定位而不是绝对定位：绝对定位会脱流，运行时那边后面的块
                // 会整个塌上来 —— 那就不是「把这块挪一点」，而是把整张排版砸了。
                // 相对定位只挪自己，别人一动不动。
                //
                // 两个都是 0 时**一条声明都不写** —— 生成物保持原字节，
                // 「跟手写稿逐字节 / 逐像素对照」那两关才立得住
                offX: 0,
                offY: 0,
                // 显式尺寸（px）。0 = 不写，跟着内容 / 容器走。
                //
                // 跟偏移同一条铁律：**两个都是 0 时一条声明都不写**。没调过大小的块
                // 在产物里必须一个字节都不多 —— 上面那两关同样靠它撑着
                //
                // ⚠ 间距块（space）的「高」不走 h，走它本来就有的 height 字段：
                // 那一格面板上一直有（叫「高度」），再开一个 h 就是同一件事两个入口，
                // 改了一个另一个不动，用户会以为坏了
                w: 0,
                h: 0,
                children: []
            };
        }

        function stBlankStatusBar() {
            return {
                theme: 'dark', width: 0, shellExtra: '', shellCls: '', shellOff: [], blocks: [],
                // 卡里那条正则里、**围栏代码块之外**的文字。运行时只认围栏里的那一段，
                // 外面的都是给读者看的说明，跟界面无关 —— 写回时原样带回去，一个字节不动
                pre: '', post: ''
            };
        }

        function stSbBlockFromRaw(raw) {
            const b = stBlankSbBlock();
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return b;
            const num = (v, d) => (v === null || v === undefined || v === '' ||
                !Number.isFinite(Number(v))) ? d : Math.trunc(Number(v));
            const clamp = (v, lo, hi, d) => Math.max(lo, Math.min(hi, num(v, d)));
            b.id = stStr(raw.id) || b.id;
            b.type = ST_SB_BLOCKS.indexOf(stStr(raw.type)) >= 0 ? stStr(raw.type) : 'text';
            b.text = stStr(raw.text);
            b.path = stStr(raw.path);
            b.label = stStr(raw.label);
            b.showLabel = raw.showLabel !== false;
            b.showValue = raw.showValue !== false;
            b.min = num(raw.min, 0);           // 范围可以为负，所以不能套「夹到 >= 0」那套
            b.max = num(raw.max, b.type === 'dots' ? 5 : 100);
            b.count = clamp(raw.count, 1, 20, 5);
            b.icon = stStr(raw.icon) || '●';
            b.size = clamp(raw.size, 8, 40, 13);
            b.color = stStr(raw.color);
            b.labelColor = stStr(raw.labelColor).slice(0, 40);
            b.emptyColor = stStr(raw.emptyColor).slice(0, 40);
            b.valueColor = stStr(raw.valueColor).slice(0, 40);
            b.bold = raw.bold === true;
            b.align = ['left', 'center', 'right'].indexOf(stStr(raw.align)) >= 0
                ? stStr(raw.align) : 'left';
            b.height = clamp(raw.height, 1, 60, 8);
            b.gap = clamp(raw.gap, 0, 60, 8);
            // 自由摆放的偏移。**可以为负**，所以不能套「夹到 >= 0」那套 ——
            // 走 ST_SB_OFF_MAX 这一档对称的
            b.offX = stSbOffNum(raw.offX);
            b.offY = stSbOffNum(raw.offY);
            b.w = stSbSizeNum(raw.w);
            b.h = stSbSizeNum(raw.h);
            // 保原样用的字段。封个长度顶，免得坏草稿把页面撑死
            b.track = stStr(raw.track).slice(0, 200);
            b.extra = stStr(raw.extra).slice(0, 600);
            b.extraInner = stStr(raw.extraInner).slice(0, 600);
            b.extraFill = stStr(raw.extraFill).slice(0, 600);
            b.wrapExtra = stStr(raw.wrapExtra).slice(0, 600);
            const cm = (raw.clsMap && typeof raw.clsMap === 'object' && !Array.isArray(raw.clsMap))
                ? raw.clsMap : {};
            ST_SB_CLS_ROLES.forEach(r => { b.clsMap[r] = stSbSafeCls(cm[r]); });
            const co = (raw.clsOwn && typeof raw.clsOwn === 'object' && !Array.isArray(raw.clsOwn))
                ? raw.clsOwn : {};
            ST_SB_CLS_ROLES.forEach(r => {
                const list = Array.isArray(co[r]) ? co[r] : [];
                b.clsOwn[r] = list
                    .map(x => String(x == null ? '' : x).trim().toLowerCase())
                    .filter(x => /^[a-z][a-z0-9-]*$/.test(x))
                    .filter((x, i, a) => a.indexOf(x) === i).slice(0, 60);
            });
            b.children = Array.isArray(raw.children) ? raw.children.map(stSbBlockFromRaw) : [];
            return b;
        }

        function stStatusBarFromRaw(raw) {
            const sb = stBlankStatusBar();
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return sb;
            sb.theme = ST_SB_THEME_IDS.indexOf(stStr(raw.theme)) >= 0 ? stStr(raw.theme) : 'dark';
            const w = Number(raw.width);
            sb.width = (Number.isFinite(w) && w > 0) ? Math.min(1200, Math.trunc(w)) : 0;
            // 外壳附加样式：解析别人的状态栏时留下来的那些「主题表达不了」的声明
            // （阴影 / 渐变 / 模糊…）。长度封个顶，免得坏草稿把页面撑死
            sb.shellExtra = stStr(raw.shellExtra).slice(0, 2000);
            sb.shellCls = stSbSafeCls(raw.shellCls);
            // 关掉的外壳属性：原稿没写、生成器就不该补的那几个。
            // 白名单过滤 —— 坏草稿塞进来的怪名字一律丢掉
            sb.shellOff = Array.isArray(raw.shellOff)
                ? raw.shellOff.map(stStr).filter(k => ST_SB_SHELL_PROPS.indexOf(k) >= 0)
                    .filter((k, i, a) => a.indexOf(k) === i)
                : [];
            sb.blocks = Array.isArray(raw.blocks) ? raw.blocks.map(stSbBlockFromRaw) : [];
            // 围栏外的原文。封个长度顶（正常就是几句说明，几 KB 已经离谱了）
            sb.pre = stStr(raw.pre).slice(0, 4000);
            sb.post = stStr(raw.post).slice(0, 4000);
            return sb;
        }

        // 块可能挂在根上，也可能挂在某个 row 里。定位一律按 id 不按路径。
        //
        // ⚠ 这里「递归下去但这一层没有子块」必须当成**空列表**，绝不能兜底回根列表。
        //    早先写成 `list || 根列表` 时，只要有任何一个块的 children 是假值
        //    （坏草稿、或某个块被别的东西顶成了标量），递归就会原地转圈 → 爆栈。
        //    所以用「一个参数都不带」来识别「从根找起」，并且额外加一道深度上限：
        //    真出现环也只是找不到，不会把页面打死。
        function stSbLocate(id, list, prefix, _d) {
            const d = _d || 0;
            if (d > 40) return null;
            const fromRoot = (list === undefined && prefix === undefined);
            const blocks = fromRoot
                ? ((stEditor.card && stEditor.card.statusBar &&
                    Array.isArray(stEditor.card.statusBar.blocks))
                    ? stEditor.card.statusBar.blocks : [])
                : (Array.isArray(list) ? list : []);
            const pre = fromRoot ? 'card.statusBar.blocks' : String(prefix);
            for (let i = 0; i < blocks.length; i++) {
                const b = blocks[i];
                if (!b || typeof b !== 'object') continue;   // 坏条目直接跳过
                if (b.id === id) return { block: b, list: blocks, index: i, path: pre + '[' + i + ']' };
                const hit = stSbLocate(id, b.children, pre + '[' + i + '].children', d + 1);
                if (hit) return hit;
            }
            return null;
        }

        function stSbCount(list) {
            let n = 0;
            (list || []).forEach(x => { n += 1 + stSbCount(x.children); });
            return n;
        }

        function stSbSelected() {
            const id = stEditor.sbSel;
            return id ? stSbLocate(id) : null;
        }

        // 卡里 MVU 变量树能当显示源的那些路径（含容器，容器可以整块显示）
        function stSbVarPaths() {
            const out = [];
            const walk = (list, pre) => (list || []).forEach(n => {
                if (!n) return;
                const nm = String(n.name || '').trim();
                const p = nm ? (pre ? pre + '.' + nm : nm) : pre;
                // min / max / value 一并带上 —— 自动生成块时要用变量自己的范围，
                // 不然进度条只会拿到 0..100，而作者明明在变量里设过 0..5
                if (nm) out.push({
                    path: 'stat_data.' + p, name: p, type: n.type,
                    min: n.min, max: n.max, value: n.value
                });
                if (n.children && n.children.length) walk(n.children, p || pre);
            });
            walk(stEditor.card ? stEditor.card.mvu.nodes : [], '');
            return out;
        }

        // 装 MVU 时给状态栏一个像样的起点：树里的数值变量排成进度条，
        // 其他标量排成数值行。树是空的就退回「简约数值行」模板 ——
        // 总比丢一个空壳过去、让用户对着一片空白强
        function stSbDefaultBlocks() {
            const paths = stSbVarPaths();
            const nums = paths.filter(p => p.type === 'number').slice(0, 4);
            const others = paths.filter(p => p.type !== 'number' &&
                ST_MVU_CONTAINER.indexOf(p.type) < 0).slice(0, 4);
            if (!nums.length && !others.length) return stSbTplBlocks('simple');
            const mk = (type, o) => {
                const b = stBlankSbBlock(type);
                Object.keys(o || {}).forEach(k => { b[k] = o[k]; });
                return b;
            };
            const out = [mk('title', { text: '状态' })];
            nums.forEach(p => {
                const lo = Number.isFinite(Number(p.min)) ? Number(p.min) : 0;
                const hi = Number(p.max);
                out.push(mk('bar', {
                    path: p.path, label: p.name, min: lo,
                    max: (Number.isFinite(hi) && hi > lo) ? hi : 100
                }));
            });
            others.forEach(p => out.push(mk('var', { path: p.path, label: p.name })));
            return out;
        }

        // 画布预览用的示例值。没有对应变量时返回空串，由 stSbVal 兜底
        function stSbSampleOf(path) {
            const key = String(path || '').replace(/^stat_data\./, '');
            if (!key) return '';
            let hit = null;
            (function walk(list, pre) {
                (list || []).forEach(n => {
                    if (hit || !n) return;
                    const nm = String(n.name || '').trim();
                    const p = nm ? (pre ? pre + '.' + nm : nm) : pre;
                    if (nm && p === key) { hit = n; return; }
                    walk(n.children, p || pre);
                });
            })(stEditor.card ? stEditor.card.mvu.nodes : [], '');
            if (!hit) return '';
            if (hit.type === 'number') {
                if (String(hit.value).trim() !== '' && Number.isFinite(Number(hit.value))) {
                    return String(Math.trunc(Number(hit.value)));
                }
                const lo = Number.isFinite(Number(hit.min)) ? Number(hit.min) : 0;
                const hi = Number.isFinite(Number(hit.max)) ? Number(hit.max) : 100;
                return String(Math.round((lo + hi) / 2));
            }
            if (hit.type === 'boolean') return hit.value === 'false' ? 'false' : 'true';
            if (hit.type === 'enum') return hit.options[0] || hit.value || '示例';
            if (ST_MVU_CONTAINER.indexOf(hit.type) >= 0) return '{…}';
            return String(hit.value || '').trim() || '示例文字';
        }

        // 一个块要显示的变量内容。
        //   sample=false → 返回**宏**（写进卡里，显示时才替换成当前楼层的值）
        //   sample=true  → 返回**示例值**（画布预览用，否则画布上是一串 {{...}}）
        // 返回值已经是可以直接塞进 HTML 的文本，调用方不要再 escape
        function stSbVal(b, sample, raw) {
            const p = String(b.path || '').trim();
            if (!p) return sample ? '<i>未选变量</i>' : '';
            if (!sample) {
                return '{{' + (raw ? 'get' : 'format') + '_message_variable::' + p + '}}';
            }
            let v = stSbSampleOf(p);
            if (v === '') {
                // 树里没有这个变量（还没搭结构 / 路径手写错了）：
                // 进度条和圆点给个范围中点，不然画布上一片空白，看不出效果
                if (raw) {
                    const lo = Number(b.min) || 0;
                    const hi = Number(b.max) || 100;
                    v = String(Math.round((lo + hi) / 2));
                } else v = '—';
            }
            return escapeHtml(v);
        }

        // 文字块里的宏换成示例值（只给画布用）。变量树里没有的路径给个「—」，
        // 跟 stSbVal 的处理保持一致
        function stSbSampleText(text) {
            return String(text == null ? '' : text).replace(
                /\{\{\s*(?:format_message_variable|get_message_variable|format_var|getvar|get_global_variable)\s*::\s*([^}]+?)\s*\}\}/g,
                (all, p) => {
                    const v = stSbSampleOf(String(p).trim());
                    return v === '' ? '—' : v;
                });
        }

        // 单个 CSS **值**的清洗（不像 stSbSafeCss 那样带分号）。用在会被原样
        // 拼进 style 的值上 —— 轨道底色就是这么来的：解析别人的卡时它是原稿原文，
        // 万一带个引号就能把属性提前闭掉
        function stSbSafeVal(raw) {
            return String(raw == null ? '' : raw)
                .replace(/[<>{};'"]/g, ' ').replace(/\s+/g, ' ').trim();
        }

        // 原样保留的样式声明：过一遍基本清洗（去注释、去能拼坏属性或标签的字符），
        // 再补一个分号。存的是原文，只有写进 HTML 的时候才清洗
        function stSbSafeCss(raw) {
            const s = String(raw == null ? '' : raw).trim();
            if (!s) return '';
            let out = s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/[<>{}]/g, ' ')
                .replace(/\s+/g, ' ').trim();
            if (!out) return '';
            if (out.charAt(out.length - 1) !== ';') out += ';';
            return escapeHtml(out) + ' ';
        }

        // bar 轨道的默认底色。解析时见到它就当成「没自定义」，免得每次自往返
        // 都往 extraInner 里塞一条我们自己写出来的声明
        const ST_SB_BAR_TRACK_DEFAULT = 'rgba(128,150,180,.28)';

        // 原稿元素上的 class，原样带进产物。
        //
        // 为什么非得留：运行时的界面是**真 iframe、独立文档**，`<style>` 照常生效，
        // 所以「`<style>.hp{...}</style>` + `<div class="hp">`」是完全正当的写法。
        // class 一丢，那段 CSS 就整个落空 —— 而且不会报错，只是样子不对。
        // 生成器自己从不写 class，所以这里记下的一定是原稿的
        function stSbSafeCls(raw) {
            return String(raw == null ? '' : raw)
                .replace(/[<>"'`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
        }

        function stSbClassAttr(b) {
            return stSbCls(b, 'outer');
        }

        // class 按「层」存。这七层就是生成器会产出的全部元素 —— 原稿的 class
        // 挂在哪一层，就记到哪一层，写回时照原样贴回去
        const ST_SB_CLS_ROLES = ['outer', 'label', 'value', 'inner', 'fill', 'empty', 'wrap'];
        const ST_SB_CLS_ROLE_NAME = {
            outer: '这个块自己', label: '显示名那排', value: '数值那排',
            inner: '内部底色层', fill: '内部高亮层', empty: '未点亮那排',
            wrap: '分组里的那一列'
        };

        function stSbClsOf(b, role) {
            return stSbSafeCls(b && b.clsMap && b.clsMap[role]);
        }

        // 生成 ` class="…"` 那半截。空字符串 = 这层本来就没 class
        function stSbCls(b, role) {
            const c = stSbClsOf(b, role);
            return c ? ' class="' + escapeHtml(c) + '"' : '';
        }

        // 把某个源元素上的 class —— 连同它内联里写过哪些属性 —— 记到块的某一层
        function stSbKeepCls(b, role, el) {
            if (!b || !el || !el.getAttribute) return;
            b.clsMap[role] = stSbSafeCls(el.getAttribute('class'));
            b.clsOwn[role] = Object.keys(stSbStyleMap(el));
        }

        // 这一层带 class 吗
        function stSbHasCls(b, role) {
            return !!stSbClsOf(b, role);
        }

        // 原稿在这一层的内联里写过哪些属性（小写属性名）
        function stSbOwnProps(b, role) {
            const o = b && b.clsOwn && b.clsOwn[role];
            return Array.isArray(o) ? o : [];
        }

        // 这一层是不是「光靠 class」：有 class，自己一条内联声明都没有
        function stSbBare(b, role) {
            return stSbHasCls(b, role) && !stSbOwnProps(b, role).length;
        }

        // 外观性声明：这层带 class 时，**只写原稿自己内联写过的那几条**。
        //
        // 内联永远赢过 class。生成器照主题写一串内联上去，作者 <style> 里按
        // class 定的那几条就全白写了 —— 而且不报错，只是样子不对。所以这里
        // 逐条声明过一遍：属性名不在原稿内联名单里的，删掉。
        //
        // 不带 class 的层原样返回（生成物一直是这么写的，动它会动到字节）。
        // 结构性的那几条（flex 布局、position / overflow、calc 宽度…）不走
        // 这里 —— 那些是这个块能不能画出来的前提，得照写
        function stSbLook(b, role, css) {
            const s = String(css == null ? '' : css);
            if (!stSbHasCls(b, role)) return s;
            const own = stSbOwnProps(b, role);
            const kept = s.split(';').filter(d => {
                const i = d.indexOf(':');
                if (i < 0) return false;
                return own.indexOf(d.slice(0, i).trim().toLowerCase()) >= 0;
            }).join(';');
            // 末尾补回分号：调用方常常把这截拼在中间（后面还接别的声明）
            return kept ? kept + ';' : '';
        }

        // 这个块的文字里有没有换行（原稿的 <br> 还原出来的）
        function stSbNeedsPre(b) {
            return /\n/.test(String((b && b.text) || ''));
        }

        // 标题 / 文字块要不要写 white-space:pre-wrap。
        //
        // 不带 class 的层照旧无条件写 —— 生成物一直是这么写的，改了会动到字节。
        // 带 class 的层就得收敛：原稿没写过换行、CSS 里也没提 white-space 时，
        // 它的默认是 normal，我们插一句 pre-wrap 就是凭空改样子（多余的空格
        // 不再合并、行尾空格也露出来）。但只要文字里确实有换行，这句就非写
        // 不可 —— 不写，那个换行会被浏览器压成一个空格，那是真丢内容
        function stSbPreWrap(b) {
            if (!stSbHasCls(b, 'outer')) return true;
            if (stSbNeedsPre(b)) return true;
            return stSbOwnProps(b, 'outer').indexOf('white-space') >= 0;
        }

