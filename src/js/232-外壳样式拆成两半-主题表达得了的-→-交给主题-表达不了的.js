        // 外壳样式拆成两半：主题表达得了的 → 交给主题；表达不了的
        // （阴影 / 渐变 / 毛玻璃…）→ 原样拼进 shellExtra，追加在主题后面
        const ST_SB_SHELL_DEFAULT = {
            'margin': '6px0', 'font-size': '13px', 'line-height': '1.6',
            'box-sizing': 'border-box', 'text-align': 'left'
        };
        function stSbSplitShellStyle(st, themeId) {
            const t = ST_SB_THEMES[themeId] || ST_SB_THEMES.dark;
            const extra = [];
            Object.keys(st).forEach(k => {
                const v = String(st[k]);
                if (k === 'width' || k === 'max-width') return;   // 宽度由 sb.width 管
                if (k === 'background' || k === 'background-color') {
                    // 纯色 → 交给主题（主题按它选的）；渐变 / 图片 → 原样留着
                    if (!stSbHexOf(v)) extra.push(k + ':' + v);
                    return;
                }
                if (k === 'border') {
                    const m = /^(\d+px)\s+(solid|dashed|dotted)\s+(.+)$/.exec(v.trim());
                    if (m && stSbHexOf(m[3]) && stSbHexOf(t.border) === stSbHexOf(m[3])) return;
                    extra.push(k + ':' + v);
                    return;
                }
                if (k === 'border-radius') {
                    if (stSbPx(v) === t.radius) return;
                    extra.push(k + ':' + v);
                    return;
                }
                if (k === 'padding') {
                    if (v.trim() === String(t.pad).trim()) return;
                    extra.push(k + ':' + v);
                    return;
                }
                if (k === 'color') {
                    if (stSbHexOf(t.fg) === stSbHexOf(v)) return;
                    extra.push(k + ':' + v);
                    return;
                }
                if (k === 'font-family') {
                    if (v.trim() === String(t.font).trim()) return;
                    extra.push(k + ':' + v);
                    return;
                }
                if (ST_SB_SHELL_DEFAULT[k] !== undefined) {
                    if (v.replace(/\s+/g, '').toLowerCase() === ST_SB_SHELL_DEFAULT[k]) return;
                    extra.push(k + ':' + v);
                    return;
                }
                extra.push(k + ':' + v);   // 认不出来的属性一律保留
            });
            return extra.join(';');
        }

        // 把卡里那段 HTML 拆成 { theme, width, shellExtra, blocks }。
        // 拆不动就 ok:false —— 调用方据此不改卡
        //
        // 找哪一段？**按运行时的规矩找**（`stSbRuntimeInfo`）：围栏代码块 + 含
        // <body>/</body>。围栏外面那些说明文字、别的代码块都不属于界面，
        // 记进 runtime.pre / runtime.post，写回时原样带回去 —— 一个字节都不动
        function stSbParseDoc(html) {
            const raw = String(html == null ? '' : html);
            if (!raw.trim()) return { ok: false, why: '卡里那条正则是空的。' };

            const rt = stSbRuntimeInfo(raw);
            // 运行时认的那一个。没有的话退到「第一个代码块」—— 不是要假装它合格，
            // 而是作者明明写了东西，编辑器得先把它**读进来**才谈得上帮他修。
            // 都不满足才把整段当内容（有人压根没写围栏，直接甩了一段裸 HTML）
            const live = rt.live[0] || null;
            const pick = live || rt.blocks[0] || null;
            const src = stSbStripFence(pick ? pick.code : raw);
            if (!src) return { ok: false, why: '卡里那条正则是空的。' };
            let doc = null;
            try { doc = new DOMParser().parseFromString(src, 'text/html'); } catch (e) { doc = null; }
            if (!doc || !doc.body) return { ok: false, why: '这段 HTML 解析不出 body。' };
            const roots = Array.prototype.slice.call(doc.body.children);
            if (!roots.length) {
                const t = String(doc.body.textContent || '').trim();
                return { ok: false, why: t ? '这段内容只有文字，没有元素。'
                    : '这段 HTML 里没有能解析的东西。' };
            }

            // 运行时是**真 iframe、独立文档** —— `<style>` / `<link>` 写在 <head> 里
            // 是正当写法，而且是最自然的写法。这些东西不在 body 里，但丢掉就是改稿：
            // 捞出来原样留成「高级 HTML」块。只丢编码声明，那个我们自己会写
            const headExtra = Array.prototype.slice.call(doc.head ? doc.head.children : [])
                .filter(el => String(el.tagName).toLowerCase() !== 'meta');

            // 外壳：顶层只有一个 div，而且它像个「盒子」。
            //
            // 判据有三条，满足一条就算：
            //   ① 内联样式里有边框 / 圆角 / 内边距 / 底色 —— 老写法，一眼就是盒子
            //   ② 带 class 且有子元素 —— 样式全写在 <style> 里、靠 class 命中的写法。
            //      运行时是真 iframe，这条路本来就通，不能因为「内联样式里看不出来」
            //      就把它当成普通块
            //   ③ 有几个子元素，而且**它自己认不出是个块**（会退到高级 HTML）——
            //      那就说明它是个容器，不是叶子
            let shell = null, shellStyle = {};
            if (roots.length === 1 && String(roots[0].tagName).toLowerCase() === 'div') {
                const st = stSbStyleMap(roots[0]);
                const visual = !!(st.border || st['border-radius'] || st.padding ||
                    st.background || st['background-color']);
                const kids = roots[0].children.length;
                let asBlock = '';
                if (!visual && kids) {
                    const probe = stSbParseEl(roots[0], stSbThemeOfStyle(st).id, 0);
                    asBlock = probe ? probe.type : '';
                }
                const byClass = kids > 0 && !!stSbSafeCls(roots[0].getAttribute('class'));
                const byShape = kids > 0 && (!asBlock || asBlock === 'html');
                if (visual || byClass || byShape) {
                    shell = roots[0];
                    shellStyle = st;
                }
            }
            const theme = stSbThemeOfStyle(shellStyle);
            const inner = shell ? Array.prototype.slice.call(shell.children) : roots;

            // 「原稿没写、生成器却总会写」的外壳属性 → 关掉。不关的话，
            // 一张本来没有外框的状态栏会被硬套上一个主题盒子：
            // 边框 / 底色 / 内边距 / 字体全冒出来，那就不是「按原样」了
            const shellOff = [];
            if (shell) {
                ST_SB_SHELL_PROPS.forEach(k => {
                    const has = (k === 'background')
                        ? !!(shellStyle.background || shellStyle['background-color'])
                        : !!shellStyle[k];
                    if (!has) shellOff.push(k);
                });
            } else {
                // 连外壳都没有 → 生成器那圈盒子整体关掉，只留一个裸 div
                ST_SB_SHELL_PROPS.forEach(k => shellOff.push(k));
            }

            const blocks = [];
            const stats = {
                raw: 0, styleTags: 0, total: 0, kept: 0, keptDecls: 0, head: 0,
                cls: 0, clsBare: 0
            };
            // head 里的 style / link / script 排在最前面 —— 原稿里它们也确实先出现。
            // 顺序不能反：样式块之间是靠先后定胜负的
            headExtra.forEach(el => {
                const b = stSbParseEl(el, theme.id, 0);
                if (!b) return;
                stats.total++;
                stats.head++;
                if (b.type === 'html') stats.raw++;
                if (String(el.tagName).toLowerCase() === 'style') stats.styleTags++;
                blocks.push(b);
            });
            inner.forEach(el => {
                if (String(el.tagName).toLowerCase() === 'style') stats.styleTags++;
                const b = stSbParseEl(el, theme.id, 0);
                if (!b) return;
                stats.total++;
                if (b.type === 'html') stats.raw++;
                blocks.push(b);
            });
            // 保原样的成绩单：原稿里有多少条「生成器不会产出」的声明被留下来了
            const ks = stSbKeptStats(blocks);
            stats.kept = ks.blocks;
            stats.keptDecls = ks.decls;
            const cs = stSbClsStats(blocks);
            stats.cls = cs.cls;
            stats.clsBare = cs.bare;

            const width = stSbPx(shellStyle.width);
            const out = {
                ok: true,
                theme: theme.id,
                themeExact: theme.exact,
                shell: !!shell,
                shellExtra: shell ? stSbSplitShellStyle(shellStyle, theme.id) : '',
                shellCls: shell ? stSbSafeCls(shell.getAttribute('class')) : '',
                shellOff: shellOff,
                width: (width !== null && width > 0) ? Math.min(1200, width) : 0,
                blocks: blocks,
                stats: stats
            };
            // 解析完立刻再生成一遍，拿产物跟原稿对。结构要是认错了，这里第一个露馅 ——
            // 放在解析里算，调用方拿到的就是带结论的结果
            const genHtml = stSbDocHtmlOf(stStatusBarFromRaw(out));
            out.textOk = stSbVisibleText(genHtml) === stSbVisibleText(src);

            // 自检②：保下来的声明得真的出现在重新生成的 HTML 里。extra 那几层是
            // 追加在 style **末尾**的，所以只要字符串在，浏览器就一定会用最后那条。
            // 这条把「我希望差集是对的」变成「验过了」
            const gen = stSbNormCss(genHtml);
            const missing = [];
            const missingCls = [];
            (function walk(list) {
                (list || []).forEach(b => {
                    if (!b || typeof b !== 'object') return;
                    ST_SB_EXTRA_KEYS.forEach(k => {
                        String(b[k] || '').split(';').forEach(d => {
                            const t = stSbNormCss(d);
                            if (t && gen.indexOf(t) < 0) missing.push(String(d).trim());
                        });
                    });
                    // class 单独验：它不是 CSS 声明，得看 class="…" 在不在产物里
                    ST_SB_CLS_ROLES.forEach(r => {
                        const c = stSbClsOf(b, r);
                        if (c && genHtml.indexOf('class="' + escapeHtml(c) + '"') < 0) {
                            missingCls.push(c + '（' + (ST_SB_CLS_ROLE_NAME[r] || r) + '）');
                        }
                    });
                    walk(b.children);
                });
            })(blocks);
            // 外壳那个 class 也要在产物里（生成器是照主题重画外壳的，最容易漏）
            const shellC = stSbSafeCls(out.shellCls);
            if (shellC && genHtml.indexOf('class="' + escapeHtml(shellC) + '"') < 0) {
                missingCls.push(shellC + '（外壳）');
            }
            out.keepOk = missing.length === 0 && missingCls.length === 0;
            out.keepMiss = missing.concat(missingCls.map(c => 'class ' + c)).slice(0, 5);

            // 运行时判定：这段在游戏里到底会不会被渲染成界面。
            // 不会的话得**当面告诉作者** —— 他多半根本不知道自己的状态栏从来没显示过。
            // 注意 ok 说的是**原稿**合不合格，不是解析成不成功：不合格也照样解析，
            // 而且写回时会被补成合格的包装，等于顺手修好了
            out.runtime = {
                ok: !!live,
                blocks: rt.blocks.length,
                live: rt.live.length,
                why: live ? '' : (rt.blocks.length
                    ? '代码块里没有 <body> / </body>'
                    : '整段没有一个 ``` 代码块'),
                pre: pick ? raw.slice(0, pick.start) : '',
                post: pick ? raw.slice(pick.end) : ''
            };
            return out;
        }

        // 「看得见的文字」—— 宏的两种写法先归一化，否则会误报对不上
        function stSbNormalizeText(s) {
            return String(s == null ? '' : s)
                .replace(/\{\{\s*(?:format_message_variable|get_message_variable|format_var|getvar|get_global_variable)\s*::\s*([^}]+?)\s*\}\}/g, '{{$1}}')
                .replace(/\s+/g, '');
        }

        function stSbVisibleText(html) {
            const src = stSbStripFence(html);
            if (!src) return '';
            let doc = null;
            try { doc = new DOMParser().parseFromString(src, 'text/html'); } catch (e) { return ''; }
            if (!doc || !doc.body) return '';
            const clone = doc.body.cloneNode(true);
            Array.prototype.slice.call(clone.querySelectorAll('style,script')).forEach(n => {
                if (n.parentNode) n.parentNode.removeChild(n);
            });
            return stSbNormalizeText(clone.textContent);
        }

        // 把当前块列表写回那条正则。没接管 / 卡里没这条正则就不动
        //
        // ⚠ 第二个判据是「那条正则现在还认不认得出是本编辑器画的」。只认 sbOwn
        //   不够：接管之后卡里那条又被别人（或另一个工具）换成了手写 HTML 时，
        //   sbOwn 还是 true，下一次随手改个字号就会把人家那段整个覆盖掉。
        //   要覆盖只有一条路 —— 「接管并覆盖」按钮走 force=true。
        function stSbSync(force) {
            if (!stEditor.sbOwn) return false;
            const d = stSbDetect();
            if (!d.regex) return false;
            if (!force && d.state !== 'mine') return false;
            const html = stSbDocHtml();
            if (d.regex.replaceString === html) return false;
            d.regex.replaceString = html;
            return true;
        }

        // 变量树：节点可能挂在根上，也可能挂在某个容器里。
        // 定位一律按 id 而不是路径 —— 路径在增删 / 移动之后就失效了，id 不会
        //
        // ⚠ 和 stSbLocate 同一个坑：「这一层没有子节点」是空列表，不能兜底回根列表，
        //    否则任何节点的 children 一旦是假值就原地转圈。深度上限同理
        function stMvuLocate(id, list, prefix, _d) {
            const d = _d || 0;
            if (d > 40) return null;
            const fromRoot = (list === undefined && prefix === undefined);
            const nodes = fromRoot
                ? ((stEditor.card && stEditor.card.mvu &&
                    Array.isArray(stEditor.card.mvu.nodes)) ? stEditor.card.mvu.nodes : [])
                : (Array.isArray(list) ? list : []);
            const pre = fromRoot ? 'card.mvu.nodes' : String(prefix);
            for (let i = 0; i < nodes.length; i++) {
                const n = nodes[i];
                if (!n || typeof n !== 'object') continue;
                const path = pre + '[' + i + ']';
                if (n.id === id) return { node: n, list: nodes, index: i, path: path };
                const hit = stMvuLocate(id, n.children, path + '.children', d + 1);
                if (hit) return hit;
            }
            return null;
        }

        function stMvuCount(list) {
            let n = 0;
            (list || []).forEach(x => { n += 1 + stMvuCount(x.children); });
            return n;
        }

        function stMvuSelected() {
            const id = stEditor.mvuSel;
            return id ? stMvuLocate(id) : null;
        }

        // 遍历卡里所有酒馆助手脚本（文件夹里的也算）
        function stMvuEachScript(fn) {
            const walk = list => (list || []).forEach(n => {
                if (!n) return;
                if (n.kind === 'folder') walk(n.scripts);
                else fn(n);
            });
            walk(stEditor.card ? stEditor.card.thScripts : []);
        }

