        // ===== 保原样：把「原稿有、生成器不产出」的声明差出来 =====
        //
        // 做法是**把块生成一遍再读回来**，拿生成器的产物当基准去比。这样解析器
        // 和生成器永远共用一套判据 —— 以后改了生成器（加条 border、换个默认色），
        // 这里不用跟着改，差集自动就对得上。
        //
        // 只比属性名和值，不真算 CSS。同名但值不一样 → 原稿盖过我们，算差异。
        // 比较前把空白全去掉、统一小写，免得 `margin:3px 0` 和 `margin: 3px  0`
        // 这种只是写法不同的被当成两回事，白白塞进 extra

        function stSbNormCss(v) {
            return String(v == null ? '' : v).replace(/\s+/g, '').toLowerCase();
        }

        // 生成器在「这个块」上会写出哪些声明。三层对应块的三层元素：
        //   outer → 最外层      inner → 「底」那层      fill → 「亮」那层
        // bar / dots 才有后两层，其余块它们保持 null
        function stSbOwnMaps(b, themeId) {
            const out = { outer: {}, inner: null, fill: null };
            let el = null;
            try {
                const doc = new DOMParser().parseFromString(
                    '<body>' + stSbBlockHtml(b, false, themeId) + '</body>', 'text/html');
                el = doc.body.firstElementChild;
            } catch (e) { el = null; }
            if (!el) return out;
            out.outer = stSbStyleMap(el);
            if (b.type === 'bar') {
                const t = stSbFindDeep(el, stSbIsTrack, 0);
                if (t) {
                    out.inner = stSbStyleMap(t.el);
                    out.fill = t.el.firstElementChild
                        ? stSbStyleMap(t.el.firstElementChild) : null;
                }
            } else if (b.type === 'dots') {
                const d = stSbFindDeep(el, stSbDotOverlay, 0);
                if (d) {
                    out.inner = d.got.parentNode ? stSbStyleMap(d.got.parentNode) : null;
                    out.fill = stSbStyleMap(d.got);
                }
            }
            return out;
        }

        // 原稿有、生成器没写（或者写得不一样）的声明 → 一串 CSS。
        // 生成器已经写了的那些**不记** —— 记了就是同一属性写两遍，
        // 之后用户在面板上改字号 / 颜色就改不动了（后面那条压着前面那条）
        function stSbExtraOf(actual, own) {
            const out = [];
            Object.keys(actual || {}).forEach(k => {
                const v = String(actual[k]);
                if (own && own[k] !== undefined && stSbNormCss(own[k]) === stSbNormCss(v)) return;
                out.push(k + ':' + v);
            });
            return out.join(';');
        }

        // 从原稿元素上读回「自由摆放」的偏移。
        //
        // 只在 `position:relative` 时才认 —— 这是生成器写偏移时用的那一种。
        // 别的定位方式一律不认，留给 extra 原样带走：
        //   · `static` + `left:8px` —— left 对静态元素**根本不起作用**，
        //     读成偏移就等于我们凭空给它加一句 position:relative，把原本无效的
        //     left 变成有效的，样子当场变了
        //   · `absolute` / `fixed` —— 那是脱流的写法，翻译成相对偏移会砸掉排版
        function stSbReadOffset(el) {
            const st = stSbStyleMap(el);
            if (String(st.position || '').trim().toLowerCase() !== 'relative') {
                return { x: 0, y: 0 };
            }
            const px = v => {
                const m = /^(-?\d+(?:\.\d+)?)px$/.exec(String(v == null ? '' : v).trim());
                return m ? stSbOffNum(m[1]) : 0;
            };
            return { x: px(st.left), y: px(st.top) };
        }

        // 把差异记到块上。三个元素没有就传 null —— 没传的那层不记，
        // 省得把生成器自己的样式当成差异又抄一遍
        function stSbKeepStyle(b, themeId, outerEl, innerEl, fillEl) {
            if (!b) return b;
            // class 先记 —— 生成器给这一层写什么，取决于原稿内联里写过什么
            // （见 stSbLook）。顺序反了，基准就还是「照主题全写一遍」的那份，
            // 差集算出来会把生成器本来就不该写的声明当成差异抄进 extra
            stSbKeepCls(b, 'outer', outerEl);
            stSbKeepCls(b, 'inner', innerEl);
            stSbKeepCls(b, 'fill', fillEl);
            // 偏移同理，也得排在 stSbOwnMaps 前面：先把 left / top 收进正经字段，
            // 生成器的基准里才会有那两条，差集才不会把它们又当成「原稿独有的声明」
            // 抄进 extra —— 抄了就是同一属性写两遍
            const off = stSbReadOffset(outerEl);
            b.offX = off.x;
            b.offY = off.y;
            // 尺寸同理，也排在 stSbOwnMaps 前面：先把 px 的 width / height 收进正经
            // 字段，生成器的基准里才会有那两条，差集才不会把它们又抄进 extra。
            // 百分比 / calc 那些读不进来的，仍旧走 extra 原样带走
            const sz = stSbReadSize(b, outerEl, stSbSizeBaseline(b, themeId));
            b.w = sz.w;
            b.h = sz.h;
            const own = stSbOwnMaps(b, themeId);
            if (outerEl) b.extra = stSbExtraOf(stSbStyleMap(outerEl), own.outer);
            if (innerEl && own.inner) {
                b.extraInner = stSbExtraOf(stSbStyleMap(innerEl), own.inner);
            }
            if (fillEl && own.fill) {
                b.extraFill = stSbExtraOf(stSbStyleMap(fillEl), own.fill);
            }
            // 文字 / 标题块里**确实有换行**时，white-space 不能进 extra。原稿的
            // <br> 被我们换成了换行，靠的就是生成器那句 pre-wrap；要是让原稿的
            // normal 盖上去，换行当场就没了 —— 那才是真的丢内容。
            // 没有换行的时候就不拦了：原稿写了 nowrap / pre，那是它的样子，得留
            if (stSbNeedsPre(b)) {
                b.extra = String(b.extra || '').split(';')
                    .filter(d => !/^\s*white-space\s*:/i.test(d)).join(';');
            }
            return b;
        }

        // 生成器给分组里每一列套的那层壳
        const ST_SB_COL_STYLE = { flex: '1 1 0', 'min-width': '0' };

        // 解析时保住了多少：带附加样式的块数 + 声明条数。这个数会写进解析报告 ——
        // 大于 0 就说明原稿里有生成器表达不了的东西，而它们**没被抹掉**
        const ST_SB_EXTRA_KEYS = ['extra', 'extraInner', 'extraFill', 'wrapExtra'];
        // 能「丢掉」的保留项。cls 不在上面那组里 —— 它存的是 class 名不是 CSS
        // 声明，自检的方式不一样（见 stSbParseDoc）
        const ST_SB_KEEP_KEYS = ST_SB_EXTRA_KEYS.concat(['cls']);
        function stSbKeptStats(blocks) {
            let nb = 0, nd = 0;
            (function walk(list) {
                (list || []).forEach(b => {
                    if (!b || typeof b !== 'object') return;
                    let n = 0;
                    ST_SB_EXTRA_KEYS.forEach(k => {
                        const s = String(b[k] || '').trim();
                        if (!s) return;
                        n += s.split(';').filter(x => x.trim()).length;
                    });
                    ST_SB_CLS_ROLES.forEach(r => { if (stSbClsOf(b, r)) n++; });
                    if (n) { nb++; nd += n; }
                    walk(b.children);
                });
            })(blocks);
            return { blocks: nb, decls: nd };
        }

        // 原稿里有多少层是**靠 class 定长相**的，其中多少层「一条内联都没写」。
        // 后一类是关键：那一层的长相完全由作者那段 CSS 说了算，生成器对它一句
        // 内联都不能写 —— 报告里把它数出来，用户一眼就知道自己的 <style> 有没有
        // 被认出来（被认出来了才谈得上「不写内联」）
        function stSbClsStats(blocks) {
            let cls = 0, bare = 0;
            (function walk(list) {
                (list || []).forEach(b => {
                    if (!b || typeof b !== 'object') return;
                    ST_SB_CLS_ROLES.forEach(r => {
                        if (!stSbHasCls(b, r)) return;
                        cls++;
                        if (stSbBare(b, r)) bare++;
                    });
                    walk(b.children);
                });
            })(blocks);
            return { cls: cls, bare: bare };
        }

        function stSbRawBlock(el) {
            const b = stBlankSbBlock('html');
            b.text = String(el.outerHTML || '');
            return b;
        }

        // 把一个元素翻译成一个块。themeId 用来判断「这个颜色是不是主题自带的」。
        //
        // 每条分支都尽量把「原稿有、生成器不产出」的声明记进 extra / extraInner /
        // extraFill —— 这是「按原样解析」的关键：块结构认得出来、**但外观不能被抹平**。
        // 传哪几个元素给 stSbKeepStyle 就是在说「原稿这几个元素分别对应生成物的哪一层」
        function stSbParseEl(el, themeId, depth) {
            if (!el || depth > 8) return null;
            const tag = String(el.tagName || '').toLowerCase();
            // 这些东西本编辑器不会生成，但**不能丢** —— 原样留成高级块
            if (tag === 'style' || tag === 'script' || tag === 'link' || tag === 'meta') {
                return stSbRawBlock(el);
            }
            const st = stSbStyleMap(el);
            const kids = Array.prototype.slice.call(el.children);
            const txt = stSbTextOf(el);

            // 1) 光壳：直接拆开，别多套一层
            if (stSbIsBareWrapper(el, st)) return stSbParseEl(kids[0], themeId, depth + 1);

            // 1) 自己就是进度条的轨道。这个元素身兼二职（外壳 + 轨道），
            //    差异只能算在轨道那层 —— 算到外壳上会多出一堆 height / overflow
            if (stSbIsTrack(el)) {
                return stSbKeepStyle(stSbParseBar(el, el, themeId), themeId,
                    null, el, el.firstElementChild);
            }

            // 2) 自己就是「一行多列」：display:flex，且每个子元素都带 flex 伸缩
            if (/flex/.test(String(st.display || '')) && kids.length >= 2 &&
                kids.every(k => {
                    const kst = stSbStyleMap(k);
                    return /\S/.test(String(kst.flex || '')) ||
                        /\S/.test(String(kst['flex-grow'] || ''));
                })) {
                return stSbKeepStyle(stSbParseRow(el, themeId, depth), themeId, el, null, null);
            }

            // 3) 裹着一条轨道（进度条带表头那种）
            const track = stSbFindDeep(el, stSbIsTrack, 0);
            if (track) {
                return stSbKeepStyle(stSbParseBar(el, track.el, themeId), themeId,
                    el, track.el, track.el.firstElementChild);
            }

            // 4) 圆点
            const dots = stSbFindDeep(el, stSbDotOverlay, 0);
            if (dots) {
                return stSbKeepStyle(stSbParseDots(el, dots.got, themeId), themeId,
                    el, dots.got.parentNode, dots.got);
            }

            // 5) 变量行：自己没文字，且有一个「整段就是一个宏」的直接子元素
            const macroSpan = stSbOwnText(el) ? null : kids.filter(k => stSbMacroOnly(k))[0];
            if (macroSpan) {
                return stSbKeepStyle(stSbParseVar(el, macroSpan, themeId), themeId, el, null, null);
            }

            // 6) 分割线 / 间距：空的薄元素
            if (!kids.length && !txt) {
                const h = stSbPx(st.height);
                const bg = st.background || st['background-color'] || '';
                const bt = String(st['border-top'] || '');
                const btCol = /(#[0-9a-fA-F]{3,6}|rgba?\([^)]*\))\s*$/.exec(bt);
                if (tag === 'hr' || (bg && (h === null || h <= 2))) {
                    const b = stBlankSbBlock('divider');
                    b.color = stSbThemeColorOr(themeId, bg || (btCol ? btCol[1] : ''));
                    return stSbKeepStyle(b, themeId, el, null, null);
                }
                if (h !== null && !bg) {
                    const b = stBlankSbBlock('space');
                    b.height = Math.max(1, Math.min(60, h));
                    return stSbKeepStyle(b, themeId, el, null, null);
                }
                if (bt) {
                    const b = stBlankSbBlock('divider');
                    b.color = stSbThemeColorOr(themeId, btCol ? btCol[1] : '');
                    return stSbKeepStyle(b, themeId, el, null, null);
                }
            }

            // 7) 有文字 → 标题 / 文字（带样式的行内标签压不了，退到高级块）
            if (txt && stSbPlainTextOk(el)) {
                return stSbKeepStyle(stSbParseText(el, themeId), themeId, el, null, null);
            }

            // 8) 纯定位壳：拆掉，偏移交给里面的块。
            //
            //    排在兜底这一步而不是最前面，是因为「这一层是不是纯定位壳」不能
            //    压过结构识别 —— 裹着一条轨道的定位壳要在第 3 步被认成进度条
            //    （偏移由 stSbKeepStyle 从外层元素读走），只有**什么结构都不像**
            //    的那种才需要在这儿拆。生成器给挪过位置的高级 HTML 块套的就是
            //    这一种：内容原样、偏移套在外面
            //
            //    不拆的后果很具体：高级块的 text 存的就是 el.outerHTML，壳也跟着
            //    进去；下次生成再套一层 —— 偏移越套越多（8px → 16px → 24px…）
            if (kids.length === 1 && !stSbOwnText(el)) {
                const off = stSbOffOnlyWrapper(el, st);
                if (off) {
                    const inner = stSbParseEl(kids[0], themeId, depth + 1);
                    if (inner) {
                        inner.offX = stSbOffNum(inner.offX + off.x);
                        inner.offY = stSbOffNum(inner.offY + off.y);
                        return inner;
                    }
                }
            }

            // 9) 兜底：原样保留
            return stSbRawBlock(el);
        }

        function stSbParseRow(el, themeId, depth) {
            const b = stBlankSbBlock('row');
            const g = stSbPx(stSbStyleMap(el).gap);
            if (g !== null) b.gap = Math.max(0, Math.min(60, g));
            b.children = Array.prototype.slice.call(el.children).map(k => {
                const child = stSbParseEl(k, themeId, depth + 1);
                if (!child) return null;
                // 列容器（生成器套的 flex:1 1 0;min-width:0 那个壳）上的差异也要留着 ——
                // 作者可能给某一列单独定了宽度。只在它确实是个光壳时记，
                // 否则那层已经被 stSbParseEl 自己收进 extra 了，再记一遍就重了
                const kst = stSbStyleMap(k);
                if (stSbIsBareWrapper(k, kst)) {
                    const ex = stSbExtraOf(kst, ST_SB_COL_STYLE);
                    if (ex) child.wrapExtra = ex;
                    stSbKeepCls(child, 'wrap', k);
                }
                return child;
            }).filter(Boolean);
            return b;
        }

        function stSbParseBar(el, track, themeId) {
            const b = stBlankSbBlock('bar');
            const tst = stSbStyleMap(track);
            const h = stSbPx(tst.height);
            if (h !== null) b.height = Math.max(1, Math.min(60, h));
            // 轨道底色跟默认那层不一样 → 当成作者自定义，收进 track 字段。
            // 存字段而不是塞 extraInner，是为了他在面板上看得见、改得动
            const tbg = String(tst.background || tst['background-color'] || '').trim();
            if (tbg && stSbNormCss(tbg) !== stSbNormCss(ST_SB_BAR_TRACK_DEFAULT)) {
                b.track = tbg.slice(0, 200);
            }
            const inner = track.firstElementChild;
            const ist = inner ? stSbStyleMap(inner) : {};
            const rng = stSbParseCalc(ist.width);
            if (rng) { b.min = rng.min; b.max = rng.max; }
            b.color = stSbThemeColorOr(themeId, ist.background || ist['background-color']);
            const paths = stSbMacroPaths(el.innerHTML || '');
            if (paths.length) b.path = paths[0];
            // 表头（显示名 + 数值）在轨道**上面**那一层里
            const head = Array.prototype.slice.call(el.children).filter(k => k !== track)[0];
            if (head) {
                const spans = Array.prototype.slice.call(head.children);
                const ms = spans.filter(s => stSbMacroOnly(s))[0] || null;
                b.label = spans.filter(s => s !== ms).map(stSbTextOf)
                    .filter(Boolean).join(' ').slice(0, 40);
                b.showLabel = !!b.label;
                b.showValue = !!ms;
                const hst = stSbStyleMap(head);
                const fs = stSbPx(hst['font-size']);
                // 我们生成表头用的是 size-2，这里反推回去
                if (fs !== null) b.size = Math.max(8, Math.min(40, fs + 2));
                b.labelColor = stSbThemeColorOr(themeId, hst.color);
                // 表头里的数值是单独一个 span，颜色可以跟显示名不一样
                if (ms) {
                    const vc = stSbThemeColorOr(themeId, stSbStyleMap(ms).color);
                    if (vc && vc !== b.labelColor) b.valueColor = vc;
                }
                // 生成器给「显示名」和「数值」各留了一个 span，class 就往这两层记
                stSbKeepCls(b, 'label', spans.filter(s => s !== ms && stSbTextOf(s))[0]);
                stSbKeepCls(b, 'value', ms);
            }
            return b;
        }

        function stSbParseDots(el, overlay, themeId) {
            const b = stBlankSbBlock('dots');
            const base = overlay.parentNode;
            const full = String((base && base.firstElementChild
                ? base.firstElementChild.textContent : '') || '');
            if (full.length) {
                // 底排那串字符就是 count 个 icon
                b.count = Math.max(1, Math.min(20, full.length));
                b.icon = full.charAt(0);
            }
            const ost = stSbStyleMap(overlay);
            const rng = stSbParseCalc(ost.width);
            if (rng) { b.min = rng.min; b.max = rng.max; }
            b.color = stSbThemeColorOr(themeId, ost.color);
            const paths = stSbMacroPaths(el.innerHTML || '');
            if (paths.length) b.path = paths[0];
            const fs = stSbPx(ost['font-size']) || stSbPx(stSbStyleMap(el)['font-size']);
            if (fs !== null) b.size = Math.max(8, Math.min(40, fs));
            const kids = Array.prototype.slice.call(el.children);
            const ri = kids.indexOf(base);
            if (ri >= 0) {
                const lbls = kids.slice(0, ri);
                b.label = lbls.map(stSbTextOf).filter(Boolean).join(' ').slice(0, 40);
                b.showLabel = !!b.label;
                b.showValue = kids.slice(ri + 1).map(stSbTextOf).some(Boolean);
                // 显示名那排的颜色是独立的
                const lb = lbls.filter(s => stSbTextOf(s))[0];
                if (lb) b.labelColor = stSbThemeColorOr(themeId, stSbStyleMap(lb).color);
                // 数值那排也是
                const vb = kids.slice(ri + 1).filter(s => stSbTextOf(s))[0];
                if (vb) b.valueColor = stSbThemeColorOr(themeId, stSbStyleMap(vb).color);
                stSbKeepCls(b, 'label', lb);
                stSbKeepCls(b, 'value', vb);
            }
            // 圆点里「没点亮」那排的颜色也是独立的 —— 不读回来就会被主题的边框色顶掉
            if (base && base.firstElementChild) {
                b.emptyColor = stSbThemeColorOr(themeId,
                    stSbStyleMap(base.firstElementChild).color);
                stSbKeepCls(b, 'empty', base.firstElementChild);
            }
            const jc = stSbStyleMap(el)['justify-content'];
            if (jc === 'center') b.align = 'center';
            else if (jc === 'flex-end') b.align = 'right';
            return b;
        }

        function stSbParseVar(el, macroSpan, themeId) {
            const b = stBlankSbBlock('var');
            b.path = stSbMacroOnly(macroSpan);
            const others = Array.prototype.slice.call(el.children).filter(s => s !== macroSpan);
            b.label = others.map(stSbTextOf).filter(Boolean).join(' ').slice(0, 40);
            b.showLabel = !!b.label;
            b.showValue = true;
            const st = stSbStyleMap(el);
            const fs = stSbPx(st['font-size']);
            if (fs !== null) b.size = Math.max(8, Math.min(40, fs));
            const ta = st['text-align'];
            if (ta === 'center' || ta === 'right' || ta === 'left') b.align = ta;
            b.color = stSbThemeColorOr(themeId, stSbStyleMap(macroSpan).color);
            // 显示名那排的颜色跟数值是分开的，也要读回来
            const lb = others.filter(s => stSbTextOf(s))[0];
            if (lb) b.labelColor = stSbThemeColorOr(themeId, stSbStyleMap(lb).color);
            stSbKeepCls(b, 'label', lb);
            stSbKeepCls(b, 'value', macroSpan);
            return b;
        }

        function stSbParseText(el, themeId) {
            const st = stSbStyleMap(el);
            const fs = stSbPx(st['font-size']);
            const bold = /bold|[6-9]00/.test(String(st['font-weight'] || ''));
            const pre = /pre/.test(String(st['white-space'] || ''));
            // 加粗 + 没有 pre-wrap → 标题（作者手写的那种，一眼就认得出）。
            // 我们生成的标题**带** pre-wrap（为了保住里面的 <br>），所以还得看
            // 生成器的另一处签名：margin:0 0 6px + line-height:1.4。
            // 少了这一条，自己生成的标题会被认成「加粗的文字块」，
            // 字号再反推 -2 就整个缩水一圈
            const titleSig = /0 0 6px/.test(String(st.margin || '')) &&
                /^1\.4/.test(String(st['line-height'] || '').trim());
            const b = stBlankSbBlock(bold && (titleSig || !pre) ? 'title' : 'text');
            b.text = stSbTextKeepBreaks(el);
            if (fs !== null) {
                b.size = Math.max(8, Math.min(40, b.type === 'title' ? fs - 2 : fs));
            }
            b.bold = bold;
            const ta = st['text-align'];
            if (ta === 'center' || ta === 'right' || ta === 'left') b.align = ta;
            b.color = stSbThemeColorOr(themeId, st.color);
            return b;
        }

