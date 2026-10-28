        // ---------- 真机预览 ----------
        //
        // 运行时把这段代码当成**一个独立网页**塞进 iframe 渲染，所以预览也必须
        // 用 iframe —— 拿 div 假装是没用的：<style> 的作用域、vw / vh 的参照物、
        // 外链字体能不能加载，全都不一样。这里跑的就是写进卡里的那套包装，
        // 只把宏换成示例值。
        //
        // sandbox 故意**不给 allow-same-origin**：里面跑的脚本碰不到编辑器本体。
        // 脚本本身是放行的 —— 运行时放行，预览就该放行，不然预览会骗人
        function stSbFrameHtml() {
            stSbRuntimeCache = '';      // 节点是新造的，缓存跟着作废
            return '<div class="st-mvu-col-head" style="margin-top:10px">真机预览' +
                    ' <span class="st-hint-inline">跟写进卡里的是同一套包装；宏换成示例值</span>' +
                '</div>' +
                '<div class="st-sb-frame-wrap">' +
                    '<iframe class="st-sb-frame" id="st-sb-frame" title="状态栏真机预览"' +
                        ' sandbox="allow-scripts allow-forms allow-popups"' +
                        ' srcdoc="' + escapeHtml(stSbPreviewDoc(stEditor.card.statusBar)) + '">' +
                    '</iframe>' +
                '</div>' +
                stSbRuntimeReportHtml();
        }

        // 打字时别每敲一下都重载 iframe —— 画布已经给了即时反馈，
        // 预览慢半拍（240ms）反而看得清
        let stSbPreviewTimer = 0;
        function stSbSchedulePreview() {
            if (!document.getElementById('st-sb-frame')) return;
            clearTimeout(stSbPreviewTimer);
            stSbPreviewTimer = setTimeout(stSbPaintPreview, 240);
        }

        function stSbPaintPreview() {
            // 体检那句**先刷**。围栏外的原文（pre / post）改了的时候预览文档是
            // 不变的，要是把它排在「文档没变就返回」后面，这行就永远不更新了 ——
            // 而那恰恰是最需要更新的一行（玩家那边看不看得到，全看它）
            stSbPaintRuntimeNote();
            const f = document.getElementById('st-sb-frame');
            if (!f) return;
            const doc = stSbPreviewDoc(stEditor.card.statusBar);
            if (f.getAttribute('srcdoc') === doc) return;
            f.setAttribute('srcdoc', doc);
        }

        let stSbRuntimeCache = '';
        function stSbPaintRuntimeNote() {
            const r = document.getElementById('st-sb-runtime');
            if (!r) return;
            const html = stSbRuntimeReportHtml();
            if (html === stSbRuntimeCache) return;   // 一样就别动，免得打字时闪
            stSbRuntimeCache = html;
            r.outerHTML = html;
        }

        // 运行时体检：把**现在这份**产物按运行时的规矩验一遍。
        //
        // 编辑器自己吐出来的包装永远合格，真正会踩雷的是围栏外的原文 ——
        // 作者在围栏外面又留了一个 ``` 或一个 <body>，判定就可能被搅乱。
        // 那种情况玩家那边**什么都看不到**，得当面说
        function stSbRuntimeReportHtml() {
            const rt = stSbRuntimeInfo(stSbDocHtml());
            // 文案只有一处拼外壳 —— 三个分支各写一遍整个 div 的话，
            // 「字面量 id 有没有重复」那项静态检查会当成真重复报出来（它只看源码文本）
            let msg;
            if (!rt.live.length) {
                msg = '🚫 <b>玩家那边看不到这个状态栏。</b>运行时要同时满足' +
                    '「' + escapeHtml(ST_SB_RUNTIME_RULE.fence) + '」和「' +
                    escapeHtml(ST_SB_RUNTIME_RULE.body) + '」，现在这段不满足。';
            } else if (rt.live.length > 1) {
                msg = '✅ 运行时会把它渲染成界面。但这段里还有 ' + (rt.live.length - 1) +
                    ' 个代码块也满足那两个条件 —— 玩家那边可能一起冒出来，建议只留一个。';
            } else {
                msg = '✅ 运行时会把它渲染成界面（围栏 + <code>&lt;body&gt;</code> 都齐了）。';
            }
            return '<div class="st-note st-sb-report" id="st-sb-runtime">' + msg + '</div>';
        }

        // 只刷图层上的一行（名字 / 类型标签）
        function stSbRefreshRow(path) {
            const base = String(path).replace(
                /\.(text|path|label|size|color|bold|align|height|gap|count|icon|showLabel|showValue|type|offX|offY|w|h)$/,
                '');
            const r = stResolve(base);
            if (!r) return;
            const b = r.obj[r.key];
            if (!b || !b.id) return;
            const el = document.getElementById(stSbDomId(b.id));
            if (!el) return;
            const nm = el.querySelector('.st-mvu-name');
            if (nm) nm.textContent = stSbBlockTitle(b);
            const tag = el.querySelector('.st-mvu-tag');
            if (tag) tag.textContent = ST_SB_BLOCK_LABEL[b.type] || b.type;
        }

