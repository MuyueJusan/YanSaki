        // ---------- 接管 / 写回 ----------

        // state='mine' 是「卡里那条带着本编辑器的结构注释」，能读回来。
        // 读回来会覆盖画布，所以画布非空时先问一句；想反过来就走 stSbOverwrite
        function stSbTakeOver() {
            const d = stSbDetect();
            if (d.state === 'none') {
                stExportMsg('卡里还没有「状态栏界面」这条正则 —— 先去 MVU 页把 MVU 装上。', 'warn');
                return;
            }
            if (d.state === 'mine') {
                const n = stSbCount(stEditor.card.statusBar.blocks);
                if (n && !window.confirm('卡里那条正则带着结构注释，能读回来。\n\n' +
                    '接管会用它覆盖画布上现在的 ' + n + ' 个块。\n\n' +
                    '想反过来（用画布覆盖卡里）就点取消，再点「用画布覆盖」。')) return;
                if (!stSbAdopt()) {
                    stExportMsg('⚠ 卡里那条正则的结构读不回来，没能接管。', 'warn');
                    return;
                }
                stEditor.sbOwn = true;
                stEditor.sbSel = '';
                stEditor.sbOpen = {};
                stSbSync();
                stSaveDraft();
                stRerender();
                stExportMsg('✅ 已接管，画布换成卡里那份了。', 'ok');
                return;
            }
            // foreign：卡里那条是别人手写的，结构读不回来。接管 = 用画布覆盖它
            const n = stSbCount(stEditor.card.statusBar.blocks);
            if (!window.confirm('卡里已经有一条「状态栏界面」正则，但不是本编辑器画的。\n\n' +
                '接管会用画布上的内容覆盖它原有的 HTML —— 如果你在那边手写过宏或布局，' +
                '会一起丢掉。\n\n' +
                '想保留原有的元素，先点取消，改点「🔍 解析卡里现有的状态栏」。\n\n确定要覆盖吗？')) return;
            if (!n) stEditor.card.statusBar.blocks = stSbDefaultBlocks();
            stEditor.sbOwn = true;
            stEditor.sbParse = null;
            stSbSync(true);          // 明确覆盖：跳过「还认得出是本编辑器画的」这道闸
            stSaveDraft();
            stRerender();
            stExportMsg('✅ 已接管并覆盖卡里原有的状态栏。', 'ok');
        }

        function stSbOverwrite() {
            stEditor.sbOwn = true;
            const did = stSbSync(true);
            stSaveDraft();
            stRerender();
            stExportMsg(did ? '✅ 已用画布覆盖卡里那条正则。'
                : '画布和卡里已经一致，没有要改的。', did ? 'ok' : 'warn');
        }

        // 卡里那条是手写的 → 试着拆成可编辑的块再接管。
        // 拆不动的原样留成「高级 HTML」块；一段都拆不出来就什么都不做
        function stSbParseFromCard() {
            const d = stSbDetect();
            if (d.state === 'none') {
                stExportMsg('卡里还没有「状态栏界面」这条正则 —— 先去 MVU 页把 MVU 装上。', 'warn');
                return;
            }
            // 自带结构注释的（本编辑器画的）不用解析，直接读回就行
            if (d.state === 'mine') { stSbTakeOver(); return; }

            const src = String(d.regex.replaceString || '');
            const r = stSbParseDoc(src);
            if (!r.ok) {
                stExportMsg('⚠ 解析不了：' + r.why + ' 想保留它只能用「直接覆盖」。', 'warn');
                return;
            }
            if (!r.blocks.length) {
                stExportMsg('⚠ 那段 HTML 里没解析出任何能编辑的块。', 'warn');
                return;
            }

            const tmp = stStatusBarFromRaw({
                theme: r.theme, width: r.width, shellExtra: r.shellExtra,
                shellCls: r.shellCls,
                shellOff: r.shellOff, blocks: r.blocks,
                // 围栏代码块**外面**的原文（说明文字 / 别的代码块）。运行时只认围栏里
                // 那一段，外面这些跟界面无关 —— 但那是作者写的东西，一个字节都不能动
                pre: r.runtime.pre, post: r.runtime.post
            });
            const total = stSbCount(tmp.blocks);
            const n0 = stSbCount(stEditor.card.statusBar.blocks);
            const themeName = (ST_SB_THEMES[r.theme] || {}).name || r.theme;
            const textOk = r.textOk;

            const notes = ['· 认出 ' + total + ' 个块（' + r.blocks.length + ' 个顶层）'];
            notes.push(r.stats.raw
                ? '· 其中 ' + r.stats.raw + ' 个认不出来 → 原样保留成「高级 HTML」'
                : '· 全部都认出来了');
            notes.push('· 外壳认作「' + themeName + '」主题' +
                (r.themeExact ? '（底色一致）' : '（底色不同，按明暗挑的）'));
            if (!r.shell) {
                notes.push('· 原稿没有外壳 → 不套主题盒子（边框 / 底色 / 内边距都关掉），' +
                    '只按原样排块');
            }
            if (r.stats.keptDecls) {
                notes.push('· 原稿里有 ' + r.stats.keptDecls + ' 条编辑器画不出来的样式' +
                    '（' + r.stats.kept + ' 个块，比如自定义轨道色 / 阴影 / 间距）' +
                    '→ 原样保住了，写回卡里还是原样');
            } else {
                notes.push('· 原稿的样式都在编辑器能表达的范围里');
            }
            if (r.keepOk === false) {
                notes.push('⚠ 有 ' + r.keepMiss.length + ' 条保留的样式没写进产物：' +
                    r.keepMiss.join(' / '));
            }
            if (r.shellExtra) {
                notes.push('· 外壳还有主题表达不了的样式（阴影 / 渐变等）→ 原样保留');
            }
            if (r.shellCls) {
                notes.push('· 外壳带 class（' + r.shellCls + '）→ 原样保留。' +
                    '运行时是真 iframe，原稿 <style> 里按这个 class 写的规则照常生效');
            }
            if (r.stats.styleTags) {
                notes.push('· 卡里带了 ' + r.stats.styleTags + ' 个 <style> → 原样保留成「高级 HTML」' +
                    (r.stats.head ? '（其中 ' + r.stats.head + ' 个在 <head> 里）' : ''));
            }
            if (r.stats.cls) {
                notes.push('· 原稿有 ' + r.stats.cls + ' 层挂着 class → 全部原样带回产物' +
                    (r.stats.clsBare
                        ? '。其中 ' + r.stats.clsBare + ' 层自己没写内联样式，' +
                          '长相完全由那段 CSS 说了算 —— 编辑器对这几层一条内联都不写，' +
                          '免得把 CSS 盖掉'
                        : '') +
                    '。运行时是真 iframe，按 class 写的规则照常生效');
            }
            notes.push(textOk ? '· 文字内容对得上'
                : '⚠ 文字内容和原稿对不上，接管后请对着原稿核一遍');
            // 运行时判定 —— 这条最要紧。不满足条件的话玩家那边**什么都没显示过**，
            // 作者八成一直在纳闷；写回时会被补成合格包装，等于顺手修好了
            if (r.runtime.ok) {
                if (r.runtime.live > 1) {
                    notes.push('· 这段里有 ' + r.runtime.live +
                        ' 个代码块都满足运行时的渲染条件，玩家那边可能一起冒出来');
                }
            } else {
                notes.push('🚫 这段**不满足运行时的渲染条件**（' + r.runtime.why + '）——' +
                    '也就是说玩家那边从来没显示过它，只会看到源码。' +
                    '接管后写回的是合格包装，等于顺手修好了');
            }

            const head = '卡里那条「状态栏界面」不是本编辑器画的，试着把它拆成可编辑的块：';
            const tail = (n0 ? '画布上现在的 ' + n0 + ' 个块会被替换。\n\n' : '') +
                '接管后会立刻用解析结果重写卡里那条正则 ——\n' +
                '原来的 HTML 只在**本次会话**内可以还原。\n\n确定吗？';
            if (!window.confirm(head + '\n\n' + notes.join('\n') + '\n\n' + tail)) return;

            stSbParseBackup = { html: src };
            stEditor.card.statusBar = tmp;
            stEditor.sbOwn = true;
            stEditor.sbSel = '';
            stEditor.sbOpen = {};
            stEditor.sbParse = {
                total: total, raw: r.stats.raw, theme: r.theme, themeExact: r.themeExact,
                extra: !!r.shellExtra, styleTags: r.stats.styleTags, textOk: textOk,
                kept: r.stats.kept, keptDecls: r.stats.keptDecls, keepOk: r.keepOk,
                noShell: !r.shell, shellCls: r.shellCls,
                // 运行时判定 + 围栏外原文的规模（原文已经进了 statusBar.pre/post）
                runtimeOk: r.runtime.ok, runtimeWhy: r.runtime.why,
                runtimeLive: r.runtime.live, head: r.stats.head,
                cls: r.stats.cls, clsBare: r.stats.clsBare,
                pre: r.runtime.pre, post: r.runtime.post
            };
            stSbSync(true);            // 明确覆盖：跳过「还认得出是本编辑器画的」那道闸
            stSaveDraft();
            stRerender();
            stExportMsg('✅ 解析出 ' + total + ' 个块' +
                (r.stats.raw ? '（' + r.stats.raw + ' 个原样保留）' : '') +
                '，卡里那条已经换成解析后的版本，可以直接改了。', 'ok');
        }

        // 把卡里那条换回解析**之前**的 HTML。本次会话内有效
        function stSbRestoreParsed() {
            if (!stSbParseBackup) return;
            const d = stSbDetect();
            if (!d.regex) {
                stExportMsg('卡里没有「状态栏界面」这条正则，没地方还原。', 'warn');
                return;
            }
            if (!window.confirm('把卡里那条正则换回解析之前的 HTML？\n\n' +
                '画布上解析出来的块会全部清掉，得重新解析一遍。')) return;
            d.regex.replaceString = stSbParseBackup.html;
            stSbParseBackup = null;
            stEditor.sbOwn = false;
            stEditor.sbParse = null;
            stEditor.sbSel = '';
            stEditor.card.statusBar = stBlankStatusBar();
            stSaveDraft();
            stRerender();
            stExportMsg('↩ 已还原卡里原来的 HTML，画布清空了 —— 可以重新解析。', 'ok');
        }

        function stSbWriteBack() {
            if (!stEditor.sbOwn) {
                stExportMsg('还没接管这张卡的状态栏，写不回去。', 'warn');
                return;
            }
            const d = stSbDetect();
            if (!d.regex) {
                stExportMsg('卡里没有「状态栏界面」这条正则，没有落脚点。', 'warn');
                return;
            }
            if (d.state !== 'mine') {
                stExportMsg('卡里那条正则已经不是本编辑器画的了 —— 直接写回会覆盖别人的内容，' +
                    '先点「接管并覆盖」。', 'warn');
                stRerender();
                return;
            }
            const html = stSbDocHtml();
            if (d.regex.replaceString === html) {
                stExportMsg('画布和卡里已经一致，不用写。', 'warn');
                return;
            }
            d.regex.replaceString = html;
            stSaveDraft();
            stRerender();
            stExportMsg('✅ 已写回卡里那条正则。', 'ok');
        }

