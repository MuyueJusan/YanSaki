        // ================= 反过来：把卡里那段 HTML 拆回块列表 =================
        //
        // 作者手上已经有一条手写的「状态栏界面」时，不该逼他推倒重来。
        // 这里尽量把那段 HTML 拆成可编辑的块；**拆不动的地方原样留成
        // 「高级 HTML」块** —— 宁可留一块看不懂的，也不能悄悄丢掉：
        // 丢了他也看不出来，等发现时原稿已经没了。
        //
        // 所有识别都只看**内联 style 的形状**，不做真正的 CSS 计算：
        // 我们只求认出自己（和常见写法）生成的那几种结构，认不出就退到高级块。

        // ===== 运行时到底怎么认这段东西 =====
        //
        // 这是整页的**准绳**：酒馆助手怎么认，编辑器就怎么认。
        //
        // 官方判定「这个代码块会被渲染成前端界面」的条件（缺一不可）：
        //   ① 代码放在 ``` 围栏里
        //   ② 代码里同时有 <body> 和 </body>
        // 满足之后，酒馆助手把它当成**一个独立网页**塞进 <iframe> 里渲染 ——
        // 也就是说 <style> / <script> / 外链资源全都是可用的，vw / vh 以 iframe 为准
        // （只有 min-height:*vh 被官方特判成以视口为准，免得 iframe 高度失控）。
        //
        // ⚠ 这两条以前理解错了。早期笔记写的是「沙盒 iframe 会剥掉 head 样式，
        //   所以只能内联 style」—— 真相是真 iframe、独立文档，<style> 照常生效。
        //   真正要守的只有上面那两条；不满足的话，玩家那边**什么都看不到**，
        //   只会看到一坨源码。所以编辑器必须按同一套规则解析、也按同一套规则产出。
        const ST_SB_RUNTIME_RULE = {
            fence: '代码要放在 ``` 代码块里',
            body: '代码里要同时有 <body> 和 </body>'
        };

        // 把一段文本里的围栏代码块找出来（``` 或 ~~~，三个以上）。
        // 未闭合的围栏按 markdown 的规矩**延续到文末** —— 那种在酒馆里同样会变成代码块，
        // 所以也算数
        function stSbFences(text) {
            const s = String(text == null ? '' : text);
            const lines = s.split(/\r?\n/);
            const starts = [];
            let off = 0;
            lines.forEach(l => { starts.push(off); off += l.length + 1; });
            const out = [];
            let open = null;
            for (let i = 0; i < lines.length; i++) {
                const m = /^ {0,3}(`{3,}|~{3,})\s*([A-Za-z0-9_+.-]*)\s*$/.exec(lines[i]);
                if (!m) continue;
                if (!open) {
                    open = { ch: m[1].charAt(0), len: m[1].length, lang: m[2] || '', line: i };
                    continue;
                }
                // 闭合行必须是同一种字符、不短于开头那串，且后面没别的东西
                if (m[1].charAt(0) !== open.ch || m[1].length < open.len) continue;
                out.push({
                    lang: open.lang,
                    code: s.slice(starts[open.line] + lines[open.line].length + 1, starts[i]),
                    start: starts[open.line],
                    end: starts[i] + lines[i].length
                });
                open = null;
            }
            if (open) {
                out.push({
                    lang: open.lang,
                    code: s.slice(starts[open.line] + lines[open.line].length + 1),
                    start: starts[open.line],
                    end: s.length,
                    unclosed: true
                });
            }
            return out;
        }

        // 按运行时的规则挑出「会被渲染成界面」的代码块。
        // live 可能不止一个（一张卡里塞了好几段界面）—— 编辑器只管第一个，
        // 其余的写回时原样带着，不动
        function stSbRuntimeInfo(text) {
            const s = String(text == null ? '' : text);
            const blocks = stSbFences(s);
            const live = blocks.filter(b =>
                /<body[\s>]/i.test(b.code) && /<\/body\s*>/i.test(b.code));
            return { text: s, blocks: blocks, live: live };
        }

        // 卡里那段通常是 ```html 围栏包着的整篇文档，先把围栏剥掉
        function stSbStripFence(s) {
            const t = String(s == null ? '' : s).trim();
            const m = /^```[a-zA-Z]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/.exec(t);
            if (m) return m[1].trim();
            return t.replace(/^```[a-zA-Z]*[ \t]*\r?\n?/, '').replace(/\r?\n?```\s*$/, '').trim();
        }

        // 把一个元素的 style 属性拆成 { 属性: 值 }（属性名统一小写）
        function stSbStyleMap(el) {
            const out = {};
            if (!el || !el.getAttribute) return out;
            const s = el.getAttribute('style');
            if (!s) return out;
            String(s).split(';').forEach(part => {
                const i = part.indexOf(':');
                if (i < 0) return;
                const k = part.slice(0, i).trim().toLowerCase();
                const v = part.slice(i + 1).trim();
                if (k && v) out[k] = v;
            });
            return out;
        }

        // 一段 HTML 里所有 MVU 取值宏的路径。MVU 的宏有两代
        // （{{format_message_variable::stat_data.X}} 与更老的 {{getvar::X}}），都认
        function stSbMacroPaths(str) {
            const out = [];
            const re = /\{\{\s*(?:format_message_variable|get_message_variable|format_var|getvar|get_global_variable)\s*::\s*([^}]+?)\s*\}\}/g;
            let m;
            while ((m = re.exec(String(str == null ? '' : str)))) {
                const p = m[1].trim();
                if (p && out.indexOf(p) < 0) out.push(p);
            }
            return out;
        }

        // "13px" → 13。认不出来返回 null —— 「0」和「没写」是两回事
        function stSbPx(v) {
            const m = /^(-?\d+(?:\.\d+)?)px$/.exec(String(v == null ? '' : v).trim());
            return m ? Number(m[1]) : null;
        }

        // #rgb / #rrggbb / rgb() / rgba() → [r,g,b]；认不出来返回 null
        function stSbColorOf(v) {
            const s = String(v == null ? '' : v).trim().toLowerCase();
            let m = /^#([0-9a-f]{3})$/.exec(s);
            if (m) return m[1].split('').map(x => parseInt(x + x, 16));
            m = /^#([0-9a-f]{6})$/.exec(s);
            if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
            m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s);
            if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
            return null;
        }

        // 统一成 #rrggbb 再比 —— 作者可能写 rgb(20,28,44)，主题里却是 #141c2c
        function stSbHexOf(v) {
            const c = stSbColorOf(v);
            if (!c) return '';
            return '#' + c.map(x =>
                ('0' + Math.max(0, Math.min(255, Math.round(x))).toString(16)).slice(-2)).join('');
        }

        function stSbIsDarkColor(v) {
            const c = stSbColorOf(v);
            if (!c) return true;
            return (c[0] * 299 + c[1] * 587 + c[2] * 114) / 1000 < 128;
        }

        // 外壳最接近哪套主题。主题决定的是**块内部**的默认色（正文 / 次要 / 强调），
        // 所以主要看底色：颜色一样直接给 10 分，只是明暗一致给 4 分
        function stSbThemeOfStyle(st) {
            const bg = String(st.background || st['background-color'] || '');
            const fg = String(st.color || '');
            const rad = stSbPx(st['border-radius']);
            const fam = String(st['font-family'] || '').trim();
            let best = 'dark', bestScore = -1, exact = false;
            ST_SB_THEME_IDS.forEach(id => {
                const t = ST_SB_THEMES[id];
                let score = 0;
                const sameBg = !!(bg && stSbHexOf(bg) && stSbHexOf(bg) === stSbHexOf(t.bg));
                if (sameBg) score += 10;
                else if (bg && stSbIsDarkColor(bg) === stSbIsDarkColor(t.bg)) score += 4;
                if (fg && stSbHexOf(fg) === stSbHexOf(t.fg)) score += 3;
                if (rad !== null && rad === t.radius) score += 2;
                if (fam && fam === String(t.font).trim()) score += 2;
                if (score > bestScore) { bestScore = score; best = id; exact = sameBg; }
            });
            return { id: best, exact: exact };
        }

        // 颜色本来就是主题那一套的话就**不写进块**，继续跟着主题走 ——
        // 这样作者换主题时整块会一起变，而不是被一堆硬编码颜色钉死
        function stSbThemeColorOr(themeId, value) {
            const hex = stSbHexOf(value);
            if (!hex) return '';
            const t = ST_SB_THEMES[themeId] || ST_SB_THEMES.dark;
            const same = ['fg', 'dim', 'accent', 'border'].some(k => stSbHexOf(t[k]) === hex);
            return same ? '' : hex;
        }

        // 只取元素**自己的**直接文字，不含后代的 —— 用来区分
        // 「这个 div 自己就是一行字」和「它只是个壳」
        function stSbOwnText(el) {
            let s = '';
            Array.prototype.slice.call((el && el.childNodes) || []).forEach(n => {
                if (n.nodeType === 3) s += n.nodeValue;
            });
            return s.replace(/\s+/g, ' ').trim();
        }

        function stSbTextOf(el) {
            return String((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
        }

        // 这段文字是不是「一整个宏」。「今天是 {{…}}」这种嵌在句子里的不算 ——
        // 那应该留给文字块原样保留，而不是被拆成变量块、把前后的话丢掉
        function stSbMacroOnly(el) {
            const t = String((el && el.textContent) || '').trim();
            return /^\{\{[\s\S]*?\}\}$/.test(t) ? (stSbMacroPaths(t)[0] || '') : '';
        }

        // 进度条的「轨道」：overflow:hidden 的容器，里面那层宽度是 calc()
        function stSbIsTrack(el) {
            const st = stSbStyleMap(el);
            if (!/hidden/.test(String(st.overflow || ''))) return false;
            const inner = el.firstElementChild;
            if (!inner) return false;
            return /calc\(/.test(String(stSbStyleMap(inner).width || ''));
        }

        // 圆点的亮点层：span[position:relative] 的最后一个子 span，
        // overflow:hidden + 宽度 calc() —— 纯 CSS 裁出「点亮 N 个」的那层
        function stSbDotOverlay(el) {
            const kids = Array.prototype.slice.call(el.children);
            if (kids.length < 2) return null;
            if (!/relative/.test(String(stSbStyleMap(el).position || ''))) return null;
            const ov = kids[kids.length - 1];
            const ost = stSbStyleMap(ov);
            if (!/hidden/.test(String(ost.overflow || ''))) return null;
            return /calc\(/.test(String(ost.width || '')) ? ov : null;
        }

        // 往下找（最多两层）：轨道 / 亮点层通常裹在一个 wrapper 里。
        //
        // ⚠ 只在「这条路是独苗」时才往下钻：一层里挂着好几个元素时，随便往下
        //   认一层，就会把**整块**误认成里面某个小结构 —— 比如一个靠 class 定样式的
        //   面板，里面某一行恰好是个圆点行，整张面板就会被读成一个圆点块，
        //   其余内容当场全丢。这种情况必须一路退回高级 HTML 块，宁可认不出
        function stSbFindDeep(el, test, depth) {
            if (depth > 2) return null;
            const kids = Array.prototype.slice.call(el.children);
            const only = kids.length === 1 && !stSbOwnText(el);
            for (let i = 0; i < kids.length; i++) {
                const got = test(kids[i]);
                if (got) return { el: kids[i], got: got };
                if (!only) continue;
                const sub = stSbFindDeep(kids[i], test, depth + 1);
                if (sub) return sub;
            }
            return null;
        }

        // calc(({{…}} - <下限>) / <跨度> * N) → { min, max }。
        // 宏那一段用 .*?\}\} 咬住，免得路径里万一有减号把后面的数字吃错
        function stSbParseCalc(v) {
            const m = /calc\(\s*\(\s*[\s\S]*?\}\}\s*-\s*(-?\d+(?:\.\d+)?)\s*\)\s*\/\s*(-?\d+(?:\.\d+)?)/
                .exec(String(v == null ? '' : v));
            if (!m) return null;
            const lo = Number(m[1]), span = Number(m[2]);
            if (!Number.isFinite(lo) || !Number.isFinite(span) || span === 0) return null;
            return { min: lo, max: lo + span };
        }

        // 「只是个占位壳」：只有一个子元素、自己没有文字、样式也只有**伸缩布局**属性。
        // 我们的「一行多列」就是靠这种壳把每列撑开的 —— 必须拆开，别多套一层。
        //
        // ⚠ 判定要收紧：`<table style="width:100%">` 这种也只有一个子元素、也没文字，
        //    但它是有意义的容器，拆开就把表格拆散了。所以：
        //    ① 只认 div / span；② 白名单里**不含 width / height** ——
        //    那是有意义的尺寸，不是布局占位
        const ST_SB_WRAPPER_KEYS = ['flex', 'flex-grow', 'flex-basis', 'flex-shrink',
            'min-width', 'max-width', 'display', 'overflow', 'box-sizing'];
        function stSbIsBareWrapper(el, st) {
            if (el.children.length !== 1) return false;
            if (stSbOwnText(el)) return false;
            const tag = String(el.tagName).toLowerCase();
            if (tag !== 'div' && tag !== 'span') return false;
            const keys = Object.keys(st);
            if (!keys.length) return true;       // 光秃秃一个 <div> 包着一个子元素
            return keys.every(k => ST_SB_WRAPPER_KEYS.indexOf(k) >= 0);
        }

        // 「纯定位壳」：这一层除了**相对定位的偏移**之外什么都没有。
        //
        // 谁会产生这种壳：生成器给「挪过位置的高级 HTML 块」套的那一层
        // （`<div style="position:relative;left:8px">…原样的 HTML…</div>`）。
        // 高级块的内容就是原样的 HTML，偏移只能套在它外面。
        //
        // 拆壳时必须**把偏移交给里面的块**：不拆的话下次生成会再套一层，
        // 偏移越套越多（8px → 16px → 24px…）；拆了但丢掉偏移，作者摆好的位置
        // 在解析这一步就没了。两条都不能接受
        //
        // 只认 `position:relative` + left / top，且**必须有真的偏移值** ——
        // `position:absolute` 那种脱流写法不能当成偏移收进来（会把排版砸了），
        // 光一个 `position:relative` 没有 left/top 的壳也不必拆（拆了是白丢信息）
        const ST_SB_OFF_ONLY_KEYS = ['position', 'left', 'top'];
        function stSbOffOnlyWrapper(el, st) {
            const tag = String(el.tagName || '').toLowerCase();
            if (tag !== 'div' && tag !== 'span') return null;
            if (String(st.position || '').trim().toLowerCase() !== 'relative') return null;
            const keys = Object.keys(st);
            if (!keys.length || !keys.every(k => ST_SB_OFF_ONLY_KEYS.indexOf(k) >= 0)) return null;
            const off = stSbReadOffset(el);
            return (off.x || off.y) ? off : null;
        }

        // 带子元素的文字块：只有「没有样式的行内标签」才能安全地压成纯文本，
        // 否则那些标签（和它们的颜色 / 字号）会被抹掉 —— 那就别压，留成高级块
        const ST_SB_INLINE_TAGS = ['b', 'i', 'u', 's', 'em', 'strong', 'span', 'br',
            'code', 'small', 'mark', 'sub', 'sup'];
        function stSbPlainTextOk(el) {
            return Array.prototype.slice.call(el.children).every(k => {
                if (ST_SB_INLINE_TAGS.indexOf(String(k.tagName).toLowerCase()) < 0) return false;
                if (k.getAttribute('style')) return false;
                return stSbPlainTextOk(k);
            });
        }

        // 取文字，但把 <br> 还原成换行。生成物是 white-space:pre-wrap，换行能
        // 原样渲染回去 —— 直接用 textContent 的话 <br> 会被**悄悄吃掉**，
        // 那就成了「静默丢内容」，正是这套解析最不能干的事。
        // 其余空白照旧压成一个空格（HTML 本来也是这么渲染的）
        function stSbTextKeepBreaks(el) {
            if (!el) return '';
            const clone = el.cloneNode(true);
            Array.prototype.slice.call(clone.querySelectorAll('br')).forEach(br => {
                if (br.parentNode) {
                    br.parentNode.replaceChild(document.createTextNode('\u0000'), br);
                }
            });
            return String(clone.textContent || '')
                .replace(/\s+/g, ' ').replace(/\u0000/g, '\n').trim();
        }

