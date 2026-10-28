        // ---------- 界面 ----------

        function stPaneSb() {
            const c = stEditor.card;
            const sb = c.statusBar;
            const d = stSbDetect();
            const n = stSbCount(sb.blocks);

            return stPaneHead('🎨 MVU 状态栏外观',
                '这里画的就是聊天里那块状态栏。它在卡里只是<b>一条正则</b> —— ' +
                '「状态栏界面」的替换内容，所以这里改完，卡里那条正则的 HTML 会跟着重写。' +
                '左边是图层，中间是画布（<b>点一下选中、双击改字、拖一下换位置</b>，' +
                '拖到「一行多列」的中间就并进那一组），右边是属性。') +
                '<div class="st-note">替换产物里<b>仍然全走内联 style</b> —— 理由是优先级直观、' +
                '跟主题共存时一眼能看出谁盖谁。<b>不是</b>因为沙盒限制：合格的产物会被酒馆' +
                '当成独立网页塞进 iframe，<code>&lt;style&gt;</code> / <code>&lt;script&gt;</code> ' +
                '照样生效（所以别人手写稿里的 class 和 &lt;style&gt; 也一律原样保留）。' +
                '进度条 / 圆点走 <code>{{get_message_variable::…}}</code>（裸值，才能参与 CSS 的 ' +
                '<code>calc()</code>），其余显示走 ' +
                '<code>{{format_message_variable::…}}</code>。</div>' +
                stSbStatusHtml(d, n) +
                '<div class="st-sb-top">' +
                    '<div class="st-sb-panel">' +
                        '<div class="st-mvu-col-head">版式模板（点一下整套换掉）</div>' +
                        '<div class="st-sb-tpls">' +
                            ST_SB_TEMPLATES.map((t, i) =>
                                '<button class="st-mini" type="button" onclick="stSbApplyTemplate(' +
                                i + ')">' + escapeHtml(t.name) + '</button>').join('') +
                        '</div>' +
                    '</div>' +
                    '<div class="st-sb-panel">' +
                        '<div class="st-mvu-col-head">主题（外壳的颜色 / 圆角 / 字体）</div>' +
                        '<div class="st-sb-themes">' +
                            ST_SB_THEME_IDS.map(id => {
                                const t = ST_SB_THEMES[id];
                                return '<button class="st-sb-theme' +
                                    (sb.theme === id ? ' st-on' : '') + '" type="button"' +
                                    ' onclick="stSbSetTheme(\'' + id + '\')">' +
                                    '<span class="st-sb-sw" style="background:' + t.bg +
                                    ';border-color:' + t.border + '"></span>' +
                                    escapeHtml(t.name) + '</button>';
                            }).join('') +
                        '</div>' +
                        '<div class="st-grid" style="margin-top:8px">' +
                            stInput('宽度 px', 'card.statusBar.width', {
                                id: 'sb-width', type: 'number',
                                hint: '0 / 留空 = 自适应', ph: '0'
                            }) +
                        '</div>' +
                        stSbShellField(sb) +
                        stSbShellExtraField(sb) +
                    '</div>' +
                '</div>' +
                '<div class="st-sb-split">' +
                    '<div class="st-sb-layers">' +
                        '<div class="st-mvu-col-head">图层</div>' +
                        (sb.blocks.length
                            ? stSbLayerRows(sb.blocks, 0)
                            : '<div class="st-empty">画布还是空的。<br>从下面的预制块 / 块库点一个开始。</div>') +
                        stSbPrefabHtml() +
                        '<div class="st-mvu-col-head" style="margin-top:10px">' +
                            '块库（点一下加进画布；选中分组时加进分组）</div>' +
                        '<div class="st-sb-palette">' +
                            ST_SB_BLOCKS.map(t =>
                                '<button class="st-mini" type="button" title="' +
                                    escapeHtml(ST_SB_BLOCK_HINT[t] || '') + '"' +
                                    ' onclick="stSbAddBlock(\'' + t + '\')">' +
                                    escapeHtml((ST_SB_BLOCK_ICON[t] || '•') + ' ' +
                                        ST_SB_BLOCK_LABEL[t]) + '</button>').join('') +
                        '</div>' +
                    '</div>' +
                    '<div class="st-sb-canvas-wrap">' +
                        '<div class="st-mvu-col-head">画布' +
                            ' <span class="st-hint-inline">' + (stSbFreeOn()
                                ? '自由摆放 · 拖着块随手挪、拖四角改大小（按住 Shift 吸附 8px 网格）'
                                : '结构排序 · 拖着块换顺序（落点显示插入线）') + '</span>' +
                        '</div>' +
                        '<div class="st-actions st-sb-cvbar">' +
                            '<button class="st-mini' + (stSbFreeOn() ? ' st-on' : '') + '"' +
                                ' type="button" onclick="stSbFreeSet(' + (stSbFreeOn() ? 'false' : 'true') + ')">' +
                                (stSbFreeOn() ? '⇱ 自由摆放：开' : '⇱ 自由摆放：关') + '</button>' +
                            '<button class="st-mini" type="button" onclick="stSbOffResetAll()">' +
                                '⌗ 全部归位</button>' +
                            '<button class="st-mini" type="button" onclick="stSbSizeResetAll()">' +
                                '⤡ 尺寸复原</button>' +
                            '<span class="st-hint-inline">' + (stSbFreeOn()
                                ? '关掉它才是「拖着换顺序」'
                                : '开着它才能像素级挪位置、拖把手改大小') + '</span>' +
                        '</div>' +
                        '<div class="st-sb-canvas" id="st-sb-canvas">' + stSbCanvasHtml() + '</div>' +
                        stSbFrameHtml() +
                    '</div>' +
                    '<div class="st-sb-insp">' +
                        '<div class="st-mvu-col-head">属性</div>' +
                        stSbInspectorHtml() +
                    '</div>' +
                '</div>' +
                stSbPreviewHtml();
        }

        // 外壳附加样式。解析别人的状态栏时，主题表达不了的声明（阴影 / 渐变 /
        // 毛玻璃…）会留在这里，追加在主题样式后面 —— 同属性后者胜，所以它盖住主题，
        // 而主题仍然管着块内部的默认色。没有就不显示这一格，免得平白多个空框
        function stSbShellExtraField(sb) {
            const v = String(sb.shellExtra || '').trim();
            const c = stSbSafeCls(sb.shellCls);
            if (!v && !c) return '';
            // 外壳的 class 单独一格 —— 它往往就是整张状态栏的主样式
            const clsField = c
                ? '<div class="st-field" style="margin-top:8px">' +
                    '<label for="st-sb-shell-cls">外壳 class' +
                        ' <span class="st-hint-inline">原稿最外层那个 class，写回时照原样贴回去</span>' +
                    '</label>' +
                    '<input id="st-sb-shell-cls" type="text" value="' + escapeHtml(c) + '"' +
                        ' oninput="stSet(\'card.statusBar.shellCls\',this.value)">' +
                  '</div>'
                : '';
            const extraField = v
                ? '<div class="st-field st-wide" style="margin-top:8px">' +
                    '<label for="st-sb-shell-extra">外壳附加样式' +
                        ' <span class="st-hint-inline">接管时从卡里读来的，追加在主题之后</span>' +
                    '</label>' +
                    '<textarea id="st-sb-shell-extra" rows="2"' +
                        ' oninput="stSet(\'card.statusBar.shellExtra\',this.value)">' +
                        escapeHtml(v) + '</textarea>' +
                  '</div>'
                : '';
            return clsField + extraField +
                '<div class="st-actions" style="margin-top:6px">' +
                    '<button class="st-mini" type="button" onclick="stSbClearShellExtra()">' +
                        '🧹 按主题重画外壳（丢掉这些）</button>' +
                '</div>';
        }

        // 外壳那个盒子的开关。解析一张**本来没有外框**的状态栏时，生成器不该
        // 自作主张给它套上主题的边框 / 底色 / 内边距 —— 那就不是「按原样」了。
        // 关掉之后外壳只剩一个裸 div，样子回到原稿
        function stSbShellOff(sb) {
            const off = Array.isArray(sb.shellOff) ? sb.shellOff : [];
            return off.length >= ST_SB_SHELL_PROPS.length;
        }

        function stSbShellField(sb) {
            const off = stSbShellOff(sb);
            return '<div class="st-actions" style="margin-top:8px">' +
                '<button class="st-mini" type="button" onclick="stSbShellToggle()">' +
                    (off ? '▣ 套用主题外框' : '▢ 不套主题外框（只剩一个裸 div）') +
                '</button>' +
                '</div>' +
                '<div class="st-hint">' +
                (off ? '外壳不带边框 / 底色 / 内边距 —— 解析一张本来没有外框的状态栏时就是这样。' +
                    '想让它跟着主题走，点上面的按钮。'
                    : '外壳会带上主题的边框 / 底色 / 内边距 / 字体。' +
                      '原稿没有这些时，解析会自动把它关掉。') +
                '</div>';
        }

        function stSbShellToggle() {
            const sb = stEditor.card.statusBar;
            sb.shellOff = stSbShellOff(sb) ? [] : ST_SB_SHELL_PROPS.slice();
            stAfterSet('card.statusBar.shellOff');
            stRerender();
        }

        // 丢掉外壳附加样式 / 外壳 class，外壳回到纯主题的样子
        function stSbClearShellExtra() {
            stSet('card.statusBar.shellExtra', '');
            stSet('card.statusBar.shellCls', '');
            stRerender();
            stExportMsg('已按主题重画外壳。', 'ok');
        }

        function stSbStatusHtml(d, n) {
            const theme = ST_SB_THEMES[stEditor.card.statusBar.theme] || ST_SB_THEMES.dark;
            const bits = [
                ['状态栏正则', d.state !== 'none'],
                ['已接管', !!stEditor.sbOwn],
                ['块 ' + n + ' 个', n > 0],
                ['主题 ' + theme.name, true]
            ];
            const chips = bits.map(b =>
                '<span class="st-mvu-chip' + (b[1] ? ' st-on' : '') + '">' +
                (b[1] ? '✓ ' : '✕ ') + escapeHtml(b[0]) + '</span>').join('');

            const takeBtn = '<button class="st-big st-mvu-install" type="button" id="st-sb-take" ' +
                'onclick="stSbTakeOver()">' +
                (d.state === 'foreign' ? '🔗 接管并覆盖卡里的状态栏' : '🔗 读回卡里的结构') + '</button>';

            let state, btns;
            if (d.state === 'none') {
                state = '卡里还没有「状态栏界面」这条正则 —— 说明这张卡还没装 MVU。' +
                    '去 MVU 页点「一键添加 MVU」，那条正则会连带一个能编辑的起点一起建出来。';
                btns = '<button class="st-big" type="button" onclick="stSwitchTab(\'mvu\')">' +
                    '🧮 去 MVU 页</button>';
            } else if (d.state === 'foreign') {
                state = '卡里已经有一条「状态栏界面」正则，但<b>不是本编辑器画的</b> —— ' +
                    '没有结构注释，读不回块列表。可以点<b>「解析」</b>试着把它拆开：' +
                    '标题 / 文字 / 变量 / 进度条 / 圆点 / 分割线 / 一行多列都认，' +
                    '认不出来的<b>原样保留成「高级 HTML」块</b>，不会丢内容。' +
                    '不想解析、直接用画布上的东西顶掉它，就点「直接覆盖」。';
                btns = '<button class="st-big st-mvu-install" type="button" id="st-sb-parse" ' +
                        'onclick="stSbParseFromCard()">🔍 解析卡里现有的状态栏</button>' +
                    '<button class="st-big st-plain" type="button" ' +
                        'onclick="stSbTakeOver()">⇧ 直接覆盖（不解析）</button>';
            } else if (!stEditor.sbOwn) {
                state = '卡里这条正则带着结构注释，能读回来，只是还没接管。' +
                    '「读回卡里的结构」= 用卡里那份覆盖画布；「用画布覆盖」= 反过来。' +
                    '不管走哪边，接管之后画布上的改动才会写回卡里。';
                btns = takeBtn +
                    '<button class="st-big st-plain" type="button" onclick="stSbOverwrite()">' +
                    '⇧ 用画布覆盖卡里</button>';
            } else {
                state = '已接管。画布上任何改动都会立刻重写卡里那条正则。';
                btns = '<button class="st-big st-plain" type="button" id="st-sb-write" ' +
                    'onclick="stSbWriteBack()">↻ 立即写回</button>';
            }
            return '<div class="st-mvu-status' + (d.state !== 'none' ? ' st-on' : '') + '">' +
                '<div class="st-mvu-chips">' + chips + '</div>' +
                '<div class="st-mvu-state">' + state + '</div>' +
                '<div class="st-actions">' + btns + '</div>' +
                '</div>' +
                stSbParseReportHtml();
        }

        // 解析接管之后把「认出了什么、丢了什么」摆在明面上 ——
        // 这类自动解析最怕用户以为全认出来了，其实有一半是原样贴回去的
        function stSbParseReportHtml() {
            const r = stEditor.sbParse;
            if (!r) return '';
            const themeName = (ST_SB_THEMES[r.theme] || {}).name || r.theme;
            const bits = ['认出 ' + r.total + ' 个块'];
            if (r.raw) bits.push(r.raw + ' 个原样保留成高级 HTML');
            if (r.keptDecls) bits.push('原样保住 ' + r.keptDecls + ' 条自定义样式');
            if (r.noShell) bits.push('原稿没有外壳，没套主题盒子');
            if (r.extra) bits.push('外壳带附加样式');
            if (r.styleTags) bits.push(r.styleTags + ' 个 <style> 原样保留');
            if (r.shellCls) bits.push('外壳 class 保住了');
            if (r.cls) {
                bits.push(r.cls + ' 层 class 保住了' +
                    (r.clsBare ? '（其中 ' + r.clsBare + ' 层完全交给 CSS）' : ''));
            }
            if (r.head) bits.push('其中 ' + r.head + ' 个在 <head> 里，也捞出来了');
            if (r.pre || r.post) {
                bits.push('围栏外的原文原样带着（前 ' + String(r.pre || '').length +
                    ' / 后 ' + String(r.post || '').length + ' 字）');
            }
            return '<div class="st-note st-sb-report">🔍 上次解析：' + escapeHtml(bits.join(' · ')) +
                '；外壳认作「' + escapeHtml(themeName) + '」主题' +
                (r.themeExact ? '（底色一致）' : '（底色不同，按明暗挑的）') + '。' +
                (r.textOk ? '文字内容对得上。'
                    : '<b>⚠ 文字内容和原稿对不上</b> —— 对着原稿核一遍。') +
                (r.keepOk === false ? '<b>⚠ 有几条保下来的样式没写进产物。</b>' : '') +
                (r.runtimeOk === false
                    ? '<br><b>🚫 原稿不满足运行时的渲染条件（' + escapeHtml(r.runtimeWhy || '') +
                      '）—— 玩家那边本来看不到它。</b>写回的是合格包装，已经顺手修好了。'
                    : '') +
                (stSbParseBackup
                    ? ' <button class="st-mini" type="button" onclick="stSbRestoreParsed()">' +
                      '↩ 还原解析前的 HTML</button>'
                    : '') +
                '</div>';
        }

        // 图层树。样式复用 MVU 大纲那一套（.st-mvu-row 等），复古皮肤也跟着有了
        function stSbLayerRows(list, depth) {
            const out = [];
            (list || []).forEach(b => {
                const sel = stEditor.sbSel === b.id;
                const box = stSbIsBox(b);
                const kids = b.children || [];
                const open = stEditor.sbOpen[b.id] !== false;
                const lit = "'" + b.id + "'";
                out.push('<div class="st-mvu-row' + (sel ? ' st-mvu-sel' : '') + '"' +
                    ' id="' + stSbDomId(b.id) + '"' +
                    ' style="padding-left:' + (8 + depth * 14) + 'px"' +
                    ' onclick="stSbSelect(' + lit + ')">' +
                    (box && kids.length
                        ? '<span class="st-mvu-tw" onclick="event.stopPropagation();' +
                          'stSbToggleOpen(' + lit + ')">' + (open ? '▾' : '▸') + '</span>'
                        : '<span class="st-mvu-tw st-mvu-tw-x"></span>') +
                    '<span class="st-mvu-ico">' + (ST_SB_BLOCK_ICON[b.type] || '•') + '</span>' +
                    '<span class="st-mvu-name">' + escapeHtml(stSbBlockTitle(b)) + '</span>' +
                    '<span class="st-mvu-tag">' +
                        escapeHtml(ST_SB_BLOCK_LABEL[b.type] || b.type) + '</span>' +
                    '</div>');
                if (box && kids.length && open) out.push(stSbLayerRows(kids, depth + 1));
            });
            return out.join('');
        }

        // 变量路径：input + datalist。一个控件既能下拉选也能手填，
        // 也不会出现「下拉显示旧值、输入框显示新值」那种两处不同步
        function stSbPathField(label, path, opts) {
            const o = opts || {};
            const v = String(stGet(path) || '');
            const dl = o.id + '-dl';
            const items = stSbVarPaths().map(p => {
                const nm = String(p.name).split('.').pop();
                return '<option value="' + escapeHtml(p.path) + '">' +
                    escapeHtml(nm + '（' + (ST_MVU_TYPE_LABEL[p.type] || p.type) + '）') +
                    '</option>';
            }).join('');
            return '<div class="st-field st-wide">' +
                '<label for="st-' + o.id + '">' + escapeHtml(label) +
                    ' <span class="st-hint-inline">下拉选，或直接手填</span></label>' +
                '<input id="st-' + o.id + '" list="' + dl + '" placeholder="stat_data.好感度"' +
                    ' value="' + escapeHtml(v) + '"' +
                    ' oninput="stSet(\'' + path + '\',this.value)">' +
                '<datalist id="' + dl + '">' + items + '</datalist>' +
                (items ? '' : '<div class="st-hint">变量树里还没有变量，路径只能手填。' +
                    '先去 MVU 页搭好结构，这里就能下拉选了。</div>') +
                '</div>';
        }

        function stSbColorField(label, path, id, hint) {
            const v = String(stGet(path) || '').trim();
            return '<div class="st-field">' +
                '<label for="st-' + id + '">' + escapeHtml(label) +
                    (hint ? ' <span class="st-hint-inline">' + escapeHtml(hint) + '</span>' : '') +
                '</label>' +
                '<div class="st-sb-color">' +
                    '<input type="color" id="st-' + id + '" value="' +
                        escapeHtml(/^#[0-9a-fA-F]{6}$/.test(v) ? v : '#3b7dd8') + '"' +
                        ' oninput="stSet(\'' + path + '\',this.value)">' +
                    (v
                        ? '<button class="st-mini" type="button" onclick="stSbClearColor(\'' +
                          path + '\')">跟随主题</button>'
                        : '<span class="st-hint-inline">跟随主题</span>') +
                '</div></div>';
        }

        // 颜色字段的路径 → 输入框 id 后缀。三个颜色字段共用一套刷新逻辑
        const ST_SB_COLOR_SUFFIX = {
            color: 'color', labelColor: 'lcolor', emptyColor: 'ecolor', valueColor: 'vcolor'
        };

        function stSbColorKeyOf(path) {
            const m = /^card\.statusBar\.blocks\[\d+\](?:\.children\[\d+\])*\.(color|labelColor|emptyColor|valueColor)$/
                .exec(String(path));
            return m ? m[1] : '';
        }

        // 颜色改了要立刻把「跟随主题」按钮补上 / 撤掉。
        // 只动颜色输入框旁边那一小格 —— **不能**整块重画属性面板：
        // input[type=color] 在部分浏览器里是边拖边触发 input 的，
        // 把输入框元素换掉，取色器会当场断掉
        function stSbRefreshColorBtn(path) {
            const key = stSbColorKeyOf(path);
            if (!key) return;
            const hit = stSbSelected();
            if (!hit) return;
            const wid = stSbDomId(hit.block.id).replace(/^st-/, '');
            const input = document.getElementById('st-' + wid + '-' + ST_SB_COLOR_SUFFIX[key]);
            const box = input && input.parentNode;
            if (!box || !box.classList || !box.classList.contains('st-sb-color')) return;
            const v = String(stGet(path) || '').trim();
            // 输入框自己也要跟上（比如颜色是被程序改的、或者草稿重放）。
            // 但**正在被操作的那个**绝对不能碰 —— 用户还在取色器里拖着呢
            const want = /^#[0-9a-fA-F]{6}$/.test(v) ? v : '#3b7dd8';
            if (input && document.activeElement !== input && input.value !== want) {
                input.value = want;
            }
            const old = box.querySelector('button, .st-hint-inline');
            if (old && old.parentNode) old.parentNode.removeChild(old);
            const fresh = document.createElement(v ? 'button' : 'span');
            if (v) {
                fresh.className = 'st-mini';
                fresh.type = 'button';
                fresh.setAttribute('onclick', 'stSbClearColor(\'' + path + '\')');
                fresh.textContent = '跟随主题';
            } else {
                fresh.className = 'st-hint-inline';
                fresh.textContent = '跟随主题';
            }
            box.appendChild(fresh);
        }

