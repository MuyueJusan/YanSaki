        // ---------- 显式尺寸 ----------
        //
        // 跟偏移是**同一套规矩**：0 = 不写。区别只有一个 —— 偏移能是负数，
        // 尺寸不能；而「0」在两个字段里都读作「没设过」，所以一条声明都不产出。
        //
        // 上限给到 2000 是因为状态栏的宽度可以到 1200（shell 那档），块再宽一点
        // 也说得过去；下限 8 是「还能看出这是个块」。真正的护栏是拖动时的夹紧，
        // 这里只是别让坏草稿把页面撑爆
        const ST_SB_SIZE_MIN = 8;
        const ST_SB_SIZE_MAX = 2000;

        function stSbSizeNum(v) {
            const n = Number(v);
            if (!Number.isFinite(n)) return 0;
            const t = Math.trunc(n);
            if (t <= 0) return 0;                    // 0 / 负数 = 不写，跟着内容走
            // 注意下限是 1 不是 ST_SB_SIZE_MIN：手写稿里真有 `height:1px` 这种东西，
            // 读进来夹到 8 就等于把人家改样了。8 只是**拖动**时的地板（见
            // stSbSizeRange）—— 手是抖的，值不是
            return Math.min(ST_SB_SIZE_MAX, t);
        }

        // 尺寸存在哪两个字段上。只有间距块是例外 —— 见 stBlankSbBlock 里的注释
        function stSbSizeKeys(b) {
            const space = !!(b && b.type === 'space');
            return { w: 'w', h: space ? 'height' : 'h', space: space };
        }

        // 拖动 / 输入时这一档的夹紧范围。间距块的高走它自己的 height 那一档
        function stSbSizeRange(b, axis) {
            const k = stSbSizeKeys(b);
            if (axis === 'h' && k.space) {
                const rg = ST_SB_NUM_RANGE.height;
                return [rg[0], rg[1]];
            }
            return [ST_SB_SIZE_MIN, ST_SB_SIZE_MAX];
        }

        function stSbSizeCss(b) {
            if (!b) return '';
            const k = stSbSizeKeys(b);
            const w = stSbSizeNum(b[k.w]);
            // 间距块的高度由它自己那一支写（`height:Npx`），这里不能再来一遍
            const h = k.space ? 0 : stSbSizeNum(b.h);
            if (!w && !h) return '';
            return (w ? 'width:' + w + 'px;' : '') + (h ? 'height:' + h + 'px;' : '');
        }

        // 徽章上那句「⤡ 220×40」。没调过就返回空串
        function stSbSizeLabel(b) {
            if (!b) return '';
            const k = stSbSizeKeys(b);
            const w = stSbSizeNum(b[k.w]);
            const h = k.space ? 0 : stSbSizeNum(b.h);
            if (!w && !h) return '';
            return '⤡ ' + (w ? w : '自') + '×' + (h ? h : '自');
        }

        // 八向把手。四个角 + 四条边 —— 跟绘图软件一致，不用解释
        const ST_SB_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

        function stSbRszAxis(dir, axis) {
            const s = String(dir || '');
            if (axis === 'w') return s.indexOf('e') >= 0 || s.indexOf('w') >= 0;
            return s.indexOf('n') >= 0 || s.indexOf('s') >= 0;
        }

        // 拖动位移 → 新的 { x, y, w, h }。
        //
        // g 是起点：x / y 是偏移，w / h 是**内容盒**尺寸（见 stSbResizeDown 的注释）。
        // 规则两条：
        //   · 东 / 南边拖 → 左上角不动，只长
        //   · 西 / 北边拖 → 右下角不动，位置跟着走（x / y 从**夹紧之后**的 w / h
        //     反推，所以拖到下限时位置会自己停住，不会把块拖到反方向去）
        function stSbResizeCalc(dir, dx, dy, g, snap) {
            const k = g.keys || { w: 'w', h: 'h', space: false };
            let w = g.w, h = g.h, x = g.x, y = g.y;
            const cl = (v, axis) => {
                const rg = g.range ? g.range(axis) : [ST_SB_SIZE_MIN, ST_SB_SIZE_MAX];
                return Math.max(rg[0], Math.min(rg[1], Math.round(v)));
            };
            if (stSbRszAxis(dir, 'w')) w = cl(stSbSnapTo(g.w + (dir.indexOf('w') >= 0 ? -dx : dx), snap), 'w');
            if (stSbRszAxis(dir, 'h')) h = cl(stSbSnapTo(g.h + (dir.indexOf('n') >= 0 ? -dy : dy), snap), 'h');
            if (dir.indexOf('w') >= 0) x = stSbOffNum(g.x + (g.w - w));
            if (dir.indexOf('n') >= 0) y = stSbOffNum(g.y + (g.h - h));
            return { x: x, y: y, w: w, h: h, keys: k };
        }

        // 从原稿元素上读回显式尺寸。
        //
        // **只认 px** —— 百分比 / `calc()` / `vw` 那些是作者自己的排版手法
        // （「占一半宽」跟「200px 宽」不是一回事），翻译成固定 px 就变了意思，
        // 一律留给 extra 原样带走。
        //
        // ⚠ 还得跟「生成器在没设尺寸时会写成什么样」比一遍（base）。分割线就是
        // 反例：它自己的样式里那句 `height:1px` 是**生成器写的**，直接读成
        // 「用户把它设成 1px 高」的话，下一轮生成就会多出一条 `height:1px`，
        // 差集还会把原来那条当成「原稿独有的声明」抄进 extra —— 产物当场脏掉。
        // 生成器已经会写的一律不认，剩下的才是用户自己设的
        //
        // 不用管 content-box / border-box 的差别：读到什么就写回什么
        // （`width:200px` 原样出去），两种盒模型下都逐字不变。
        // 真正会被盒模型影响的是画布上那把把手 —— 见 stSbResizeDown
        function stSbReadSize(b, el, base) {
            const st = stSbStyleMap(el);
            const bs = base || { width: '', height: '' };
            const px = (v, bv) => {
                const m = /^(-?\d+(?:\.\d+)?)px$/.exec(String(v == null ? '' : v).trim());
                if (!m) return 0;
                if (stSbNormCss(v) === stSbNormCss(bv)) return 0;
                return stSbSizeNum(m[1]);
            };
            const k = stSbSizeKeys(b);
            return { w: px(st.width, bs.width), h: k.space ? 0 : px(st.height, bs.height) };
        }

        // 「这个块在 w / h 都是 0 的时候，生成器会给最外层写什么宽高」。
        // 拿来当 stSbReadSize 的基准 —— 同一条判据，别处用的是 stSbOwnMaps
        function stSbSizeBaseline(b, themeId) {
            const probe = {};
            Object.keys(b || {}).forEach(k => { probe[k] = b[k]; });
            probe.w = 0;
            probe.h = 0;
            try {
                const doc = new DOMParser().parseFromString(
                    '<body>' + stSbBlockHtml(probe, false, themeId) + '</body>', 'text/html');
                const el = doc.body.firstElementChild;
                if (!el) return { width: '', height: '' };
                const st = stSbStyleMap(el);
                return {
                    width: String(st.width == null ? '' : st.width),
                    height: String(st.height == null ? '' : st.height)
                };
            } catch (e) { return { width: '', height: '' }; }
        }

        // style 属性：空的就整个不写。有些层本来就可能一条声明都没有，
        // 留个 style="" 出去会改变产物的字节（自往返那一关过不去）
        function stSbStyleAttr(css) {
            const s = String(css == null ? '' : css);
            return s ? ' style="' + s + '"' : '';
        }

        function stSbBlockHtml(b, sample, theme, noOff) {
            const t = ST_SB_THEMES[theme] || ST_SB_THEMES.dark;
            const col = String(b.color || '').trim();
            const fg = col || t.fg;
            const dim = col || t.dim;
            const accent = col || t.accent;
            const align = b.align || 'left';
            const bold = b.bold ? 'font-weight:bold;' : '';
            // 显示名 / 未点亮那排的颜色。跟着主题走是默认，作者挑过就按他的来
            const lcol = String(b.labelColor || '').trim() || dim;
            const ecol = String(b.emptyColor || '').trim() || col || t.border;
            const vcol = String(b.valueColor || '').trim();
            const fs = 'font-size:' + b.size + 'px;';
            const m0 = 'margin:3px 0;';
            // 原稿元素上的 class。**必须留着** —— 运行时的界面是个真 iframe，
            // 作者完全可以在 <style> 里按 class 定样式；class 一丢，那段 CSS 全落空
            const cls = stSbClassAttr(b);
            // 解析别人的状态栏时留下的「生成器不会产出」的声明。追加在最后 ——
            // 同属性后者胜，所以它盖得住上面这些，原稿的样子就保下来了
            const ex = stSbSafeCss(b.extra);
            const exIn = stSbSafeCss(b.extraInner);
            const exFill = stSbSafeCss(b.extraFill);
            // 自由摆放的偏移。noOff 只在**画布**上用：画布把偏移挂在自己的命中框上
            // （块外面那层），块本身再写一遍就成了挪两次。真机预览和写进卡里那份
            // 照常写 —— 它们没有命中框
            const off = noOff ? '' : stSbOffCss(b);
            // 显式尺寸。**不受 noOff 影响** —— 偏移在画布上挂命中框，尺寸得挂在块
            // 自己身上（命中框是 auto 宽，写它身上块不会跟着变），所以两边都写。
            // 画布那边另外给命中框补一句 width:fit-content，让轮廓贴着块
            const sz = stSbSizeCss(b);
            // 画布上的文字块：宏也换成示例值。不然画布上是一串
            // {{format_message_variable::stat_data.日期}}，看不出实际长什么样 ——
            // 接管别人的卡时这一点尤其明显，他们的文字块里到处是宏。
            // 写进卡里那份（sample=false）当然还是原样的宏
            const bodyText = sample ? stSbSampleText(b.text) : b.text;

            if (b.type === 'title') {
                // pre-wrap 是为了让解析出来的标题里那些换行（原稿的 <br>）还立得住。
                // 带 class 的标题：字号 / 加粗 / 颜色 / 对齐 / 间距全交给那段 CSS，
                // 只有确实有换行时才补一句 pre-wrap
                const look = stSbLook(b, 'outer',
                    'font-size:' + (b.size + 2) + 'px;font-weight:bold;color:' +
                    accent + ';text-align:' + align + ';margin:0 0 6px;line-height:1.4;') +
                    (stSbPreWrap(b) ? 'white-space:pre-wrap;' : '');
                return '<div' + cls + stSbStyleAttr(off + look + ex + sz) + '>' +
                    escapeHtml(bodyText) + '</div>';
            }
            if (b.type === 'text') {
                const look = stSbLook(b, 'outer',
                        fs + bold + 'color:' + fg + ';text-align:' + align + ';' + m0) +
                    (stSbPreWrap(b) ? 'white-space:pre-wrap;' : '') +
                    stSbLook(b, 'outer', 'line-height:1.6;');
                return '<div' + cls + stSbStyleAttr(off + look + ex + sz) + '>' +
                    escapeHtml(bodyText) + '</div>';
            }
            if (b.type === 'divider') {
                // 设了显式高度就别再写生成器那句 height:1px —— 同属性写两遍，
                // 后面那句虽然会赢，产物里白多一条
                const base = stSbSizeNum(b.h) ? '' : 'height:1px;';
                return '<div' + cls + stSbStyleAttr(off + stSbLook(b, 'outer',
                    base + 'background:' + (col || t.border) + ';margin:7px 0;') + ex + sz) +
                    '></div>';
            }
            if (b.type === 'space') {
                return '<div' + cls + ' style="' + off + 'height:' + b.height + 'px;' + ex +
                    sz + '"></div>';
            }
            if (b.type === 'html') {
                // 高级块：原样写出去（用户自己负责合法性）。
                // 只有挪过位置或调过尺寸时才多套一层壳 —— 都没动就是一个字节都不加
                const raw = String(b.text || '');
                return (off || sz) ? '<div style="' + off + sz + '">' + raw + '</div>' : raw;
            }
            if (b.type === 'var') {
                const label = (b.showLabel && b.label)
                    ? '<span' + stSbCls(b, 'label') +
                      stSbStyleAttr(stSbLook(b, 'label', 'color:' + lcol)) + '>' +
                      escapeHtml(b.label) + '</span>' : '';
                const val = b.showValue
                    ? '<span' + stSbCls(b, 'value') +
                      stSbStyleAttr(stSbLook(b, 'value', 'color:' + fg + ';font-weight:bold')) +
                      '>' + stSbVal(b, sample, false) + '</span>' : '';
                return '<div' + cls + ' style="' + off +
                    'display:flex;justify-content:space-between;align-items:baseline;' +
                    'gap:8px;' + stSbLook(b, 'outer', fs + bold + m0 + 'text-align:' + align + ';') +
                    ex + sz + '">' + label + val + '</div>';
            }
            if (b.type === 'bar') {
                const lo = Number.isFinite(Number(b.min)) ? Number(b.min) : 0;
                const hi = Number.isFinite(Number(b.max)) ? Number(b.max) : 100;
                const span = (hi - lo) || 1;
                const rv = stSbVal(b, sample, true);
                const rad = Math.round(b.height / 2);
                const track = stSbSafeVal(b.track) || ST_SB_BAR_TRACK_DEFAULT;
                // 先 width:0% 再 calc()。宏取不回来时（路径不存在、或值是字符串）
                // calc 会变成语法错误，浏览器丢掉这条声明 → 落到前面的 0%，而不是炸版
                const w = 'width:0%;width:calc((' + rv + ' - ' + lo + ') / ' + span + ' * 100%)';
                const head = (b.showLabel && b.label) || b.showValue
                    ? '<div style="display:flex;justify-content:space-between;font-size:' +
                      Math.max(9, b.size - 2) + 'px;color:' + lcol + ';margin-bottom:3px">' +
                      '<span' + stSbCls(b, 'label') + '>' +
                      (b.showLabel && b.label ? escapeHtml(b.label) : '') + '</span>' +
                      '<span' + stSbCls(b, 'value') +
                      stSbStyleAttr(stSbLook(b, 'value', vcol ? 'color:' + vcol : '')) + '>' +
                      (b.showValue ? stSbVal(b, sample, false) : '') + '</span>' +
                      '</div>'
                    : '';
                return '<div' + cls + stSbStyleAttr(off + stSbLook(b, 'outer', m0) + ex + sz) + '>' + head +
                    '<div' + stSbCls(b, 'inner') + ' style="height:' + b.height +
                    'px;background:' + track +
                    ';border-radius:' + rad + 'px;overflow:hidden;' + exIn + '">' +
                    '<div' + stSbCls(b, 'fill') + ' style="height:100%;' + w +
                    ';background:' + accent +
                    ';border-radius:' + rad + 'px;' + exFill + '"></div></div></div>';
            }
            if (b.type === 'dots') {
                const n = Math.max(1, Math.min(20, Number(b.count) || 5));
                const icon = String(b.icon || '●');
                const lo = Number.isFinite(Number(b.min)) ? Number(b.min) : 0;
                const hi = Number.isFinite(Number(b.max)) ? Number(b.max) : n;
                const span = (hi - lo) || 1;
                const step = Math.max(10, b.size + 4);      // 每个圆点的推进宽度
                const rv = stSbVal(b, sample, true);
                const full = new Array(n + 1).join(icon);
                // 底层一排空点，上层一排亮点用 overflow:hidden 裁掉多余部分 ——
                // 纯 CSS 就能表达「点亮 N 个」，不需要脚本
                const w = 'width:0px;width:calc((' + rv + ' - ' + lo + ') / ' + span +
                    ' * ' + (n * step) + 'px);max-width:100%';
                const label = (b.showLabel && b.label)
                    ? '<span' + stSbCls(b, 'label') +
                      stSbStyleAttr(stSbLook(b, 'label',
                          'color:' + lcol + ';font-size:' + b.size + 'px')) +
                      '>' + escapeHtml(b.label) + '</span>' : '';
                const val = b.showValue
                    ? '<span' + stSbCls(b, 'value') +
                      stSbStyleAttr(stSbLook(b, 'value',
                          'color:' + (vcol || fg) + ';font-weight:bold;font-size:' +
                          b.size + 'px')) +
                      '>' + stSbVal(b, sample, false) + '</span>' : '';
                const just = align === 'center' ? 'center' : (align === 'right' ? 'flex-end' : 'flex-start');
                return '<div' + cls + ' style="' + off +
                    'display:flex;align-items:center;gap:8px;' +
                    stSbLook(b, 'outer', m0 + 'font-size:' + b.size + 'px;') +
                    'justify-content:' + just + ';' + ex + sz + '">' + label +
                    '<span' + stSbCls(b, 'inner') +
                    ' style="position:relative;display:inline-block;line-height:1;' +
                    'letter-spacing:' + (step - b.size) + 'px;white-space:nowrap;' + exIn + '">' +
                    '<span' + stSbCls(b, 'empty') +
                    stSbStyleAttr(stSbLook(b, 'empty', 'color:' + ecol)) + '>' +
                    escapeHtml(full) + '</span>' +
                    '<span' + stSbCls(b, 'fill') +
                    ' style="position:absolute;left:0;top:0;overflow:hidden;' + w +
                    ';' + stSbLook(b, 'fill', 'color:' + accent + ';') + exFill + '">' +
                    escapeHtml(full) + '</span></span>' +
                    val + '</div>';
            }
            if (b.type === 'row') {
                const gap = Number.isFinite(Number(b.gap)) ? Number(b.gap) : 8;
                const kids = (b.children || []).map(k =>
                    '<div' + stSbCls(k, 'wrap') + ' style="flex:1 1 0;min-width:0;' +
                    stSbSafeCss(k.wrapExtra) + '">' +
                    stSbBlockHtml(k, sample, theme, noOff) + '</div>').join('');
                if (!kids) return '';
                return '<div' + cls + ' style="' + off +
                    'display:flex;gap:' + gap + 'px;align-items:center;' +
                    stSbLook(b, 'outer', m0) + ex + sz + '">' + kids + '</div>';
            }
            return '';
        }

        // 外壳附加样式：解析别人的状态栏时，那些「6 套主题表达不了」的声明
        // （阴影 / 渐变 / 毛玻璃…）原样留在这里，追加在主题样式**之后** ——
        // 同属性后者胜，所以它能盖住主题，而主题仍然决定块内部的默认色
        function stSbShellExtraCss(sb) {
            return stSbSafeCss(sb && sb.shellExtra);
        }

        // 外壳上「生成器总会写」的属性。解析别人的卡时，原稿没写的那些要能关掉 ——
        // 否则一张本来没有外框的状态栏会被硬套上一个主题盒子（边框 / 底色 / 内边距
        // 全冒出来），那就不是「按原样」了。关掉哪个由 sb.shellOff 说了算
        const ST_SB_SHELL_PROPS = [
            'border', 'border-radius', 'padding', 'margin', 'background', 'color',
            'font-size', 'line-height', 'font-family', 'box-sizing', 'text-align'
        ];

        function stSbShellOpen(sb) {
            const t = ST_SB_THEMES[sb.theme] || ST_SB_THEMES.dark;
            const off = Array.isArray(sb.shellOff) ? sb.shellOff : [];
            const on = k => off.indexOf(k) < 0;
            const parts = [];
            if (on('border')) parts.push('border:1px solid ' + t.border);
            if (on('border-radius')) parts.push('border-radius:' + t.radius + 'px');
            if (on('padding')) parts.push('padding:' + t.pad);
            if (on('margin')) parts.push('margin:6px 0');
            if (on('background')) parts.push('background:' + t.bg);
            if (on('color')) parts.push('color:' + t.fg);
            if (on('font-size')) parts.push('font-size:13px');
            if (on('line-height')) parts.push('line-height:1.6');
            if (on('font-family')) parts.push('font-family:' + t.font);
            if (on('box-sizing')) parts.push('box-sizing:border-box');
            if (on('text-align')) parts.push('text-align:left');
            const w = Number(sb.width);
            if (Number.isFinite(w) && w > 0) {
                parts.push('width:' + Math.min(1200, Math.trunc(w)) + 'px');
                parts.push('max-width:100%');
            }
            return '<div' + stSbShellClsAttr(sb) + ' style="' +
                parts.join(';') + ';' + stSbShellExtraCss(sb) + '">';
        }

        // 外壳元素上的 class。运行时是真 iframe，`<style>` 照常生效 ——
        // 「<style>.hp-panel{…}</style>」这种最外层的 class 恰恰是最要紧的一个：
        // 丢了它，整张状态栏的底色 / 边框 / 内边距全没了
        function stSbShellClsAttr(sb) {
            const c = stSbSafeCls(sb && sb.shellCls);
            return c ? ' class="' + escapeHtml(c) + '"' : '';
        }

        // sample=true 是画布预览（宏换成示例值），false 是真正写进卡里的
        function stSbBodyHtml(sb, sample) {
            return stSbShellOpen(sb) +
                (sb.blocks || []).map(b => stSbBlockHtml(b, sample, sb.theme)).join('') +
                '</div>';
        }

        // 写进卡里的那段。结构 base64 塞在注释里 —— 导出的 PNG / JSON
        // 转一圈回来还能接着编辑，而不是只剩一坨认不出结构的 HTML
        //
        // 形状必须**严格满足运行时的判定**：``` 围栏 + 含 <body></body>。
        // 少了任何一条，酒馆助手就不认它是界面，玩家那边只会看到一坨源码。
        // 围栏外的原文（pre / post）原样拼回去
        function stSbDocHtmlOf(sb) {
            const pre = String((sb && sb.pre) || '');
            const post = String((sb && sb.post) || '');
            return pre + stSbFencedDoc(stSbMarkOf(sb) + stSbBodyHtml(sb, false)) + post;
        }

        // 结构注释。`stSbDetect` 靠它认出「这段是本编辑器画的」，`stSbAdopt` 靠它把
        // 块列表读回来。位置在 <body> **里面** —— 注释不是元素，运行时不会多渲染，
        // 解析时也不会多出块，对「围栏 + <body></body>」那两条判定毫无影响。
        // base64 是必须的：JSON 里可能出现 `-->`，直接塞进注释会被提前截断
        function stSbMarkOf(sb) {
            return '<!--' + ST_SB_MARK + ':' + stSbB64Enc(JSON.stringify(sb)) + '-->\n';
        }

        // 把 body 包成一段「运行时认得出」的文档。真机预览也用这个 ——
        // 编辑器里看到的和写进卡里的必须是同一套包装
        function stSbFencedDoc(bodyHtml) {
            return '```html\n<!doctype html><html><head><meta charset="utf-8"></head><body>\n' +
                bodyHtml + '\n</body></html>\n```';
        }

        function stSbDocHtml() {
            return stSbDocHtmlOf(stEditor.card.statusBar);
        }

        // 真机预览用的整篇文档：宏换成示例值，且**不带结构注释**（那是给编辑器读的，
        // 对运行时毫无意义）。包装和写进卡里的完全一致 —— 预览里什么样，玩的时候就是什么样
        function stSbPreviewDoc(sb) {
            return '<!doctype html><html><head><meta charset="utf-8"></head><body>\n' +
                stSbBodyHtml(sb, true) + '\n</body></html>';
        }

        function stSbB64Enc(str) {
            const bytes = new TextEncoder().encode(str);
            let bin = '';
            for (let i = 0; i < bytes.length; i += 0x8000) {
                bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
            }
            return btoa(bin);
        }

        function stSbB64Dec(b64) {
            try {
                const bin = atob(String(b64).replace(/\s+/g, ''));
                const arr = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                return new TextDecoder().decode(arr);
            } catch (e) { return ''; }
        }

        // 状态栏那条正则（MVU 五件套里的 sbShow）
        function stSbRegex() {
            const c = stEditor.card;
            if (!c) return null;
            for (let i = 0; i < c.regex.length; i++) {
                if (stMvuRegexKind(c.regex[i]) === 'sbShow') return c.regex[i];
            }
            return null;
        }

        // 'none'（卡里没这条正则 → MVU 还没装）/ 'mine'（本编辑器画的，能读回块列表）
        // / 'foreign'（有但不是本编辑器画的 → 不接管，要覆盖得用户点头）
        function stSbDetect() {
            const r = stSbRegex();
            if (!r) return { regex: null, state: 'none' };
            const s = String(r.replaceString || '');
            return { regex: r, state: s.indexOf(ST_SB_MARK + ':') >= 0 ? 'mine' : 'foreign' };
        }

        // 从卡里那条正则反推回块列表。读不回来就返回 false —— 调用方据此不接管
        function stSbAdopt() {
            const d = stSbDetect();
            if (d.state !== 'mine' || !stEditor.card) return false;
            const s = String(d.regex.replaceString || '');
            const at = s.indexOf(ST_SB_MARK + ':');
            const end = s.indexOf('-->', at);
            if (at < 0 || end < 0) return false;
            const json = stSbB64Dec(s.slice(at + ST_SB_MARK.length + 1, end).trim());
            if (!json) return false;
            let raw = null;
            try { raw = JSON.parse(json); } catch (e) { return false; }
            stEditor.card.statusBar = stStatusBarFromRaw(raw);
            return true;
        }

