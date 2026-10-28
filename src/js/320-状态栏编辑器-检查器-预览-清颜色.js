        // 清掉颜色覆盖。要走一趟整页重画 —— 不然那个「跟随主题」按钮不会消失
        //
        // ⚠ 只认「某个块的颜色字段」这一种路径。传错路径时必须原地返回：
        //    早期版本直接把 path 丢给 stSet，于是把「整块的路径」当字段路径传进来时，
        //    stSet 会把那个块对象整个写成 ''，紧接着所有按 id 找块的遍历全部炸掉
        function stSbClearColor(path) {
            if (!stSbColorKeyOf(path)) return;
            stSet(path, '');
            stRerender();
        }

        // 丢掉一层「原样保留的样式」。跟上面同理：path 必须是**块**的路径，
        // key 必须是白名单里的 —— 不然一个拼错的路径就能把别的东西写成 ''
        // class 那几层的 key 写成 `cls:<层名>`，跟 CSS 声明层区分开
        function stSbDropExtra(path, key) {
            const k = String(key);
            const isCls = /^cls:/.test(k);
            if (isCls) {
                if (ST_SB_CLS_ROLES.indexOf(k.slice(4)) < 0) return;
            } else if (ST_SB_KEEP_KEYS.indexOf(k) < 0) return;
            if (!/^card\.statusBar\.blocks\[\d+\](?:\.children\[\d+\])*$/.test(String(path))) return;
            // class 丢掉时**不用**管同一层的 clsOwn（原稿内联里写过哪些属性）：
            // 那份名单只在「这层有 class」时才被查（见 stSbLook），class 一空它
            // 就是死数据。而 class 只可能来自解析，解析时两个字段是同时写的
            stSet(String(path) + '.' + (isCls ? 'clsMap.' + k.slice(4) : k), '');
            stRerender();
        }

        function stSbChildRows(b) {
            const kids = b.children || [];
            if (!kids.length) {
                return '<div class="st-empty">这个分组还是空的 —— 把块拖进来，' +
                    '或者点下面的「加一列」。</div>';
            }
            return kids.map((ch, i) => {
                const lit = "'" + ch.id + "'";
                return '<div class="st-mvu-crow' +
                    (stEditor.sbSel === ch.id ? ' st-mvu-sel' : '') + '">' +
                    '<span class="st-mvu-ico">' + (ST_SB_BLOCK_ICON[ch.type] || '•') + '</span>' +
                    '<button class="st-mvu-clink" type="button" onclick="stSbSelect(' + lit + ')">' +
                        escapeHtml(stSbBlockTitle(ch)) + '</button>' +
                    '<span class="st-mvu-tag">' +
                        escapeHtml(ST_SB_BLOCK_LABEL[ch.type] || ch.type) + '</span>' +
                    '<span class="st-mvu-cbtns">' +
                        '<button class="st-mini" type="button" onclick="stSbMoveBlock(' + lit +
                            ',-1)"' + (i <= 0 ? ' disabled' : '') + '>↑</button>' +
                        '<button class="st-mini" type="button" onclick="stSbMoveBlock(' + lit +
                            ',1)"' + (i >= kids.length - 1 ? ' disabled' : '') + '>↓</button>' +
                        '<button class="st-mini" type="button" onclick="stSbOutdent(' + lit +
                            ')">⇤</button>' +
                        '<button class="st-mini st-danger" type="button" onclick="stSbDelBlock(' +
                            lit + ')">✕</button>' +
                    '</span></div>';
            }).join('');
        }

        function stSbInspectorHtml() {
            const hit = stSbSelected();
            if (!hit) {
                return '<div class="st-empty">左边点一个块，或者直接在画布上点一下 —— ' +
                    '这里就能改它的文字 / 变量 / 样式。画布上<b>双击</b>可以跳过这一步，' +
                    '光标直接落到对应的输入框。</div>';
            }
            const b = hit.block;
            const p = hit.path;
            const wid = stSbDomId(b.id).replace(/^st-/, '');
            const lit = "'" + b.id + "'";
            const box = stSbIsBox(b);
            const typeOpts = ST_SB_BLOCKS.map(t =>
                ({ value: t, label: (ST_SB_BLOCK_ICON[t] || '•') + ' ' + ST_SB_BLOCK_LABEL[t] }));

            // 文字类
            let textField = '';
            if (b.type === 'title' || b.type === 'text') {
                textField = stArea('文字', p + '.text', {
                    id: wid + '-text', rows: 2,
                    ph: b.type === 'title' ? '状态' : '可以直接用宏，比如 {{char}} / {{user}}'
                });
            } else if (b.type === 'html') {
                textField = stArea('HTML 源码（原样写出去，仍然要内联 style）', p + '.text', {
                    id: wid + '-html', rows: 6, ph: '<div style="…">…</div>'
                });
            }

            // 变量类
            let varFields = '';
            if (b.type === 'var' || b.type === 'bar' || b.type === 'dots') {
                varFields = stSbPathField('变量路径', p + '.path', { id: wid + '-path' }) +
                    '<div class="st-grid">' +
                        stInput('显示名', p + '.label', { id: wid + '-label', ph: '例：好感度' }) +
                    '</div>' +
                    '<div class="st-checks">' +
                        stCheck('显示标签', p + '.showLabel', { id: wid + '-sl' }) +
                        stCheck('显示数值', p + '.showValue', { id: wid + '-sv' }) +
                    '</div>';
            }

            // 数值范围 / 尺寸类
            let numFields = '';
            if (b.type === 'bar' || b.type === 'dots') {
                numFields += '<div class="st-grid">' +
                    stInput('最小值', p + '.min', {
                        id: wid + '-min', type: 'number', hint: '可以为负', ph: '0'
                    }) +
                    stInput('最大值', p + '.max', {
                        id: wid + '-max', type: 'number', hint: '可以为负', ph: '100'
                    }) +
                '</div>';
            }
            if (b.type === 'bar') {
                numFields += '<div class="st-grid">' +
                    stInput('条高 px', p + '.height', {
                        id: wid + '-h', type: 'number', hint: '1 ~ 60'
                    }) +
                    stInput('轨道底色', p + '.track', {
                        id: wid + '-track', hint: '留空 = 默认半透明灰', ph: 'rgba(…,.28)'
                    }) +
                '</div>';
            }
            if (b.type === 'dots') {
                numFields += '<div class="st-grid">' +
                    stInput('圆点个数', p + '.count', {
                        id: wid + '-count', type: 'number', hint: '1 ~ 20'
                    }) +
                    stInput('圆点字符', p + '.icon', { id: wid + '-icon', ph: '●' }) +
                '</div>';
            }
            if (b.type === 'space') {
                numFields += '<div class="st-grid">' +
                    stInput('高度 px', p + '.height', {
                        id: wid + '-h', type: 'number', hint: '1 ~ 60'
                    }) +
                '</div>';
            }
            if (b.type === 'row') {
                numFields += '<div class="st-grid">' +
                    stInput('列间距 px', p + '.gap', {
                        id: wid + '-gap', type: 'number', hint: '0 ~ 60'
                    }) +
                '</div>';
            }

            // 样式。哪些字段对哪些块有意义是固定的 —— 比如分割线没有对齐，
            // 进度条的对齐也不参与渲染，就别放出来误导人
            const withSize = ['title', 'text', 'var', 'dots'].indexOf(b.type) >= 0;
            const withAlign = withSize;
            const withColor = ['title', 'text', 'var', 'bar', 'dots', 'divider'].indexOf(b.type) >= 0;
            const withBold = withSize;
            let styleFields = '';
            if (withSize) {
                styleFields += '<div class="st-grid">' +
                    stInput('字号 px', p + '.size', {
                        id: wid + '-size', type: 'number', hint: '8 ~ 40'
                    }) +
                    (withAlign
                        ? stSelect('对齐', p + '.align', ST_SB_ALIGN, { id: wid + '-align' })
                        : '') +
                '</div>';
            }
            if (withColor) {
                styleFields += '<div class="st-grid">' +
                    stSbColorField('颜色', p + '.color', wid + '-color', '留空 = 跟主题') +
                    '</div>';
                // 显示名 / 未点亮那排是各自独立的颜色。不摆出来，解析回来的
                // 那两个颜色就没法改、也没法看出来是哪儿来的
                if (b.type === 'var' || b.type === 'bar' || b.type === 'dots') {
                    styleFields += '<div class="st-grid">' +
                        stSbColorField('显示名颜色', p + '.labelColor', wid + '-lcolor',
                            '留空 = 跟主题') +
                        (b.type === 'dots'
                            ? stSbColorField('未点亮颜色', p + '.emptyColor', wid + '-ecolor',
                                '留空 = 跟主题')
                            : '') +
                        // var 不用这一格：var 的「颜色」本来就是数值的颜色
                        (b.type === 'bar' || b.type === 'dots'
                            ? stSbColorField('数值颜色', p + '.valueColor', wid + '-vcolor',
                                '留空 = 跟主题')
                            : '') +
                        '</div>';
                }
            }
            if (withBold) {
                styleFields += '<div class="st-checks">' +
                    stCheck('加粗', p + '.bold', { id: wid + '-bold' }) + '</div>';
            }

            // 自由摆放。**任何块都能挪** —— 所以不按 type 分，永远摆出来
            const offX = stSbOffNum(b.offX);
            const offY = stSbOffNum(b.offY);
            const offFields = '<div class="st-sub">自由摆放 px' +
                    ' <span class="st-hint-inline">画布上直接拖；方向键 1px、Shift+方向键 10px；' +
                    '按住 Shift 拖 = 吸附 8px 网格</span></div>' +
                '<div class="st-grid">' +
                    stInput('左右 X', p + '.offX', {
                        id: wid + '-offx', type: 'number', hint: '负 = 往左', ph: '0'
                    }) +
                    stInput('上下 Y', p + '.offY', {
                        id: wid + '-offy', type: 'number', hint: '负 = 往上', ph: '0'
                    }) +
                '</div>' +
                (offX || offY
                    ? '<div class="st-actions">' +
                      '<button class="st-mini" type="button" onclick="stSbOffReset(' + lit + ')">' +
                      '⌗ 归位（现在是 ' + (offX > 0 ? '+' : '') + offX + ' , ' +
                      (offY > 0 ? '+' : '') + offY + '）</button></div>'
                    : '<div class="st-hint">相对定位，只挪这一块 —— 后面的块不会跟着塌上来。' +
                      '两条都是 0 时一个字节都不写。</div>');

            // 尺寸。跟偏移一样**任何块都能调**，所以也不按 type 分。
            // 间距块少一格「高」—— 它走上面那个本来就有的「高度」字段，
            // 同一件事开两个入口，改了一个另一个不动，用户会以为坏了
            const szk = stSbSizeKeys(b);
            const szW = stSbSizeNum(b[szk.w]);
            const szH = szk.space ? 0 : stSbSizeNum(b.h);
            const sizeFields = '<div class="st-sub">尺寸 px' +
                    ' <span class="st-hint-inline">选中块之后，画布上四角 / 四边都能拖；' +
                    'Shift 拖 = 吸附 8px 网格</span></div>' +
                '<div class="st-grid">' +
                    stInput('宽 W', p + '.' + szk.w, {
                        id: wid + '-w', type: 'number', hint: '0 = 自适应', ph: '0'
                    }) +
                    (szk.space ? '' : stInput('高 H', p + '.h', {
                        id: wid + '-h', type: 'number', hint: '0 = 自适应', ph: '0'
                    })) +
                '</div>' +
                ((szW || szH)
                    ? '<div class="st-actions">' +
                      '<button class="st-mini" type="button" onclick="stSbSizeReset(' + lit + ')">' +
                      '⤡ 恢复默认尺寸（现在是 ' + (szW ? szW : '自') + ' × ' +
                      (szk.space ? b.height : (szH ? szH : '自')) + '）</button></div>'
                    : '<div class="st-hint">固定像素尺寸。留空或 0 = 不写这条声明，' +
                      '跟着内容 / 容器走 —— 没调过的块在产物里一个字节都不多。</div>');

            // 分组
            let kidsSection = '';
            if (box) {
                kidsSection = '<div class="st-sub">分组里的块</div>' + stSbChildRows(b) +
                    '<div class="st-actions">' +
                        '<button class="st-mini" type="button" onclick="stSbAddBlock(\'var\',' +
                            lit + ')">✚ 加一列</button>' +
                    '</div>';
            }

            // 解析别人的状态栏时保下来的样式。不塞进可编辑输入框 —— 那是原稿原文，
            // 编辑框里改坏了不如直接丢掉重来 —— 但必须让作者**看得见、删得掉**，
            // 否则他会以为这些是编辑器自己长出来的
            const kept = [];
            [['extra', '这个块自己'], ['extraInner', '内部底色层'],
                ['extraFill', '内部高亮层'], ['wrapExtra', '分组里的那一列']]
                .forEach(pair => {
                    const v = String(b[pair[0]] || '').trim();
                    if (v) kept.push({ key: pair[0], name: pair[1], css: v });
                });
            // class 也是原稿的东西，也得看得见、删得掉
            ST_SB_CLS_ROLES.forEach(r => {
                const c = stSbClsOf(b, r);
                if (c) {
                    kept.push({ key: 'cls:' + r, name: 'class 属性 · ' +
                        (ST_SB_CLS_ROLE_NAME[r] || r), css: 'class="' + c + '"' });
                }
            });
            const keptSection = kept.length
                ? '<details class="st-mvu-preview"><summary>原样保留的样式（' +
                  kept.length + ' 层）</summary>' +
                  kept.map(k => '<div class="st-sub">' + escapeHtml(k.name) + '</div>' +
                      '<pre class="st-json">' + escapeHtml(k.css) + '</pre>' +
                      '<div class="st-actions">' +
                      '<button class="st-mini st-danger" type="button" ' +
                      'onclick="stSbDropExtra(\'' + p + '\',\'' + k.key + '\')">' +
                      '✕ 丢掉这一层</button></div>').join('') +
                  '<div class="st-note">这些是原稿里有、编辑器自己画不出来的东西' +
                  '（自定义轨道色、阴影、额外间距、按 class 命中的样式…）。' +
                  '样式声明追加在生成样式的<b>后面</b>，同属性后者胜 —— ' +
                  '所以原稿长什么样，写回卡里还是什么样。' +
                  '丢掉就回到编辑器自己的样子。' +
                  '<br>class 尤其别丢：运行时的界面是个真 iframe，' +
                  '原稿很可能在 <code>&lt;style&gt;</code> 里按 class 定样式，' +
                  'class 一没，那段 CSS 就整个落空 —— 而且不报错，只是样子不对。</div>' +
                  '</details>'
                : '';

            const chain = stSbChain(b.id) || [];
            const groupBtns = '<div class="st-actions">' +
                (box
                    ? '<button class="st-mini" type="button" onclick="stSbUnwrapRow(' + lit +
                        ')">⬓ 解散分组</button>'
                    : '<button class="st-mini" type="button" onclick="stSbWrapRow(' + lit +
                        ')">⬓ 用分组包住</button>') +
                (chain.length > 1
                    ? '<button class="st-mini" type="button" onclick="stSbOutdent(' + lit +
                        ')">⇤ 移出分组</button>'
                    : '') +
                '</div>';

            return '<div class="st-mvu-form">' +
                '<div class="st-grid">' +
                    stSelect('块类型', p + '.type', typeOpts, { id: wid + '-type' }) +
                '</div>' +
                '<div class="st-hint">' + escapeHtml(ST_SB_BLOCK_HINT[b.type] || '') + '</div>' +
                textField +
                varFields +
                numFields +
                styleFields +
                offFields +
                sizeFields +
                keptSection +
                kidsSection +
                groupBtns +
                '<div class="st-actions">' +
                    '<button class="st-mini" type="button" onclick="stSbDupBlock(' + lit +
                        ')">⧉ 复制</button>' +
                    '<button class="st-mini st-danger" type="button" onclick="stSbDelBlock(' +
                        lit + ')">✕ 删除这个块</button>' +
                '</div>' +
                '</div>';
        }

        function stSbPreviewHtml() {
            const sb = stEditor.card.statusBar;
            const pre = String(sb.pre || '');
            const post = String(sb.post || '');
            // 围栏外的原文。运行时只认围栏里那一段，外面这些跟界面无关 ——
            // 但那是作者写的说明文字，得让他看得见、改得动
            let outside = '';
            if (pre || post) {
                outside = '<div class="st-sub">围栏外的原文' +
                        ' <span class="st-hint-inline">运行时只认围栏里那段，这些不参与渲染；' +
                        '写回时原样带着</span></div>' +
                    '<div class="st-field"><label for="st-sb-pre">代码块之前</label>' +
                        '<textarea id="st-sb-pre" rows="2"' +
                            ' oninput="stSet(\'card.statusBar.pre\',this.value)">' +
                            escapeHtml(pre) + '</textarea></div>' +
                    '<div class="st-field"><label for="st-sb-post">代码块之后</label>' +
                        '<textarea id="st-sb-post" rows="2"' +
                            ' oninput="stSet(\'card.statusBar.post\',this.value)">' +
                            escapeHtml(post) + '</textarea></div>';
            }
            return '<details class="st-mvu-preview">' +
                '<summary>写进卡里的替换内容（' +
                    (stEditor.sbOwn ? '画布一改就自动重写' : '接管之后才会写回') + '）</summary>' +
                outside +
                '<div class="st-sub">正则「状态栏界面」的 replaceString</div>' +
                '<pre class="st-json st-mvu-code">' + escapeHtml(stSbDocHtml()) + '</pre>' +
                '<div class="st-note">结构注释（base64）塞在 <code>&lt;body&gt;</code> 里面 ——' +
                    '注释不是元素，运行时不会多渲染，解析时也不会多出块。' +
                    '导出的 PNG / JSON 带着它转一圈回来，还能接着在这里编辑，' +
                    '而不是只剩一坨认不出结构的 HTML。base64 是必须的：' +
                    'JSON 里可能出现 <code>--&gt;</code>，直接塞进注释会被提前截断。</div>' +
                '</details>';
        }

