        // ===== MVU 变量框架 =====
        // 「像编辑 PPT 一样」：左边是变量大纲（层级缩进），右边是选中项的检查器。
        // Zod / initvar / 更新规则三份产物全部由结构生成，用户不用碰代码

        const ST_MVU_PRESETS = [
            { name: '好感度', type: 'number', min: 0, max: 100, value: '0', desc: '对<user>的好感程度' },
            { name: '金钱', type: 'number', min: 0, value: '0', desc: '持有的货币数量' },
            { name: '好感阶段', type: 'enum', options: ['陌生', '熟悉', '朋友', '恋人'], value: '陌生' },
            { name: '世界', type: 'object', children: [
                { name: '当前时间', type: 'string', value: '未知', desc: '格式 YYYY-MM-DD HH:mm' },
                { name: '当前地点', type: 'string', value: '未知' }
            ] },
            { name: '主角', type: 'object', children: [
                { name: '姓名', type: 'string', value: '' },
                { name: '状态', type: 'string', value: '正常' }
            ] },
            { name: '背包', type: 'record', desc: '键是物品名', children: [
                { name: '描述', type: 'string', value: '' },
                { name: '数量', type: 'number', min: 0, int: true, value: '1' }
            ] }
        ];

        function stMvuPresetNode(spec) {
            const n = stBlankMvuNode(spec.type);
            n.name = spec.name;
            if (spec.desc) n.desc = spec.desc;
            if (spec.value !== undefined) n.value = spec.value;
            if (spec.int) n.int = true;
            if (spec.min !== undefined && spec.min !== null) n.min = spec.min;
            if (spec.max !== undefined && spec.max !== null) n.max = spec.max;
            if (spec.options) n.options = spec.options.slice();
            (spec.children || []).forEach(k => n.children.push(stMvuPresetNode(k)));
            return n;
        }

        function stMvuDomId(id) {
            return 'st-mvu-n-' + String(id).replace(/[^A-Za-z0-9_-]/g, '').slice(-16);
        }

        // 把一个节点加到某容器里。containerId 为空 = 加到根上
        function stMvuAddNode(containerId, spec) {
            const c = stEditor.card;
            if (!c) return;
            const node = spec ? stMvuPresetNode(spec) : stBlankMvuNode();
            if (containerId) {
                const hit = stMvuLocate(containerId);
                if (!hit) return;
                hit.node.children.push(node);
                stEditor.mvuOpen[containerId] = true;
            } else {
                c.mvu.nodes.push(node);
            }
            stEditor.mvuSel = node.id;
            stMvuSync();
            stSaveDraft();
            stRerender();
        }

        function stMvuQuickAdd(i) {
            const spec = ST_MVU_PRESETS[Number(i)];
            if (spec) stMvuAddNode('', spec);
        }

        function stMvuSelect(id) {
            stEditor.mvuSel = String(id);
            stRerender();
        }

        function stMvuToggleOpen(id) {
            const k = String(id);
            stEditor.mvuOpen[k] = stEditor.mvuOpen[k] === false;
            stRerender();
        }

        function stMvuDelNode(id) {
            const hit = stMvuLocate(id);
            if (!hit) return;
            hit.list.splice(hit.index, 1);
            // 选中的就是它 / 是它的后代 → 清掉选中，否则检查器会指向空气
            if (stEditor.mvuSel === id || !stMvuLocate(stEditor.mvuSel)) stEditor.mvuSel = '';
            stMvuSync();
            stSaveDraft();
            stRerender();
        }

        function stMvuMoveNode(id, d) {
            const hit = stMvuLocate(id);
            if (!hit) return;
            const j = hit.index + d;
            if (j < 0 || j >= hit.list.length) return;
            const t = hit.list[hit.index];
            hit.list[hit.index] = hit.list[j];
            hit.list[j] = t;
            stMvuSync();
            stSaveDraft();
            stRerender();
        }

        function stMvuDupNode(id) {
            const hit = stMvuLocate(id);
            if (!hit) return;
            let copy = null;
            try { copy = stMvuNodeFromRaw(JSON.parse(JSON.stringify(hit.node))); } catch (e) { copy = null; }
            if (!copy) return;
            // 复制出来的整棵子树都要换 id —— 同 id 会让选中 / 展开串味
            const reid = n => { n.id = stUuid(); n.children.forEach(reid); };
            reid(copy);
            hit.list.splice(hit.index + 1, 0, copy);
            stEditor.mvuSel = copy.id;
            stMvuSync();
            stSaveDraft();
            stRerender();
        }

        function stMvuInstallClick() {
            const did = stMvuInstall();
            // 里面有「⚠」说明发生了需要用户知道的事（比如没接管），
            // 这时候不该顶着一个 ✅ 让人以为一切顺利
            const warned = did.some(x => String(x).indexOf('⚠') === 0);
            stExportMsg(did.length
                ? (warned ? '' : '✅ 已添加：') + did.join('、')
                : '这张卡的 MVU 组件已经是齐的，没有要补的。',
                warned ? 'warn' : 'ok');
            stRerender();
        }

        function stMvuRemoveClick() {
            const d = stMvuDetect();
            if (!d.hasAny) { stExportMsg('这张卡里没找到 MVU 组件。', 'warn'); return; }
            if (!confirm('确定要移除这张卡的 MVU 吗？\n\n' +
                '会删掉：MVU / Zod 两个脚本、四条 MVU 世界书条目、五条 MVU 正则，' +
                '以及开场白里的状态栏占位符。\n\n' +
                '变量结构本身会留着（还在草稿里），随时可以再加回来。')) return;
            const did = stMvuRemove();
            stExportMsg(did.length ? '已移除：' + did.join('、') : '没有可移除的组件。',
                did.length ? 'ok' : 'warn');
            stRerender();
        }

        function stPaneMvu() {
            const c = stEditor.card;
            const d = stMvuDetect();
            const total = stMvuCount(c.mvu.nodes);
            const roots = c.mvu.nodes.length;
            return stPaneHead('🧮 MVU 变量框架',
                '酒馆助手的 <b>MVU（Magical Variable Update）</b>：让 AI 在回复末尾输出结构化命令，' +
                '由框架校验后改写楼层的 <code>stat_data</code>。' +
                '在左边搭变量结构，<b>Zod / initvar / 更新规则会跟着自动生成</b>，不用手写代码。' +
                '本应用只负责写进卡里，不会执行脚本。') +
                stMvuStatusHtml(d) +
                (total
                    ? '<div class="st-note">共 ' + total + ' 个变量 · ' + roots + ' 个顶层' +
                      (stEditor.mvuOwn
                          ? '　·　<b>结构改动会自动同步</b>到 Zod 与 initvar'
                          : '　·　结构改动<b>不会</b>回写（这张卡的 MVU 不是本编辑器建的' +
                            (d.zodScript && stMvuZodParsed().state !== 'ok'
                                ? '，而且卡里的 Zod 写法认不出来、读不回变量树'
                                : '') +
                            '。改完点上面的按钮接管）') +
                      '</div>'
                    : '') +
                '<div class="st-mvu-presets">' +
                    '<span class="st-mvu-presets-label">常用变量：</span>' +
                    ST_MVU_PRESETS.map((p, i) =>
                        '<button class="st-mini" type="button" onclick="stMvuQuickAdd(' + i + ')">' +
                        escapeHtml(ST_MVU_TYPE_ICON[p.type] || '•') + ' ' + escapeHtml(p.name) +
                        '</button>').join('') +
                '</div>' +
                '<div class="st-mvu-split">' +
                    '<div class="st-mvu-outline">' +
                        '<div class="st-mvu-col-head">变量大纲</div>' +
                        (c.mvu.nodes.length
                            ? stMvuOutlineRows(c.mvu.nodes, 0)
                            : '<div class="st-empty">还没有变量。<br>用上面的「常用变量」快速起个头。</div>') +
                        '<div class="st-actions">' +
                            '<button class="st-mini" type="button" id="st-mvu-add-root" ' +
                                'onclick="stMvuAddNode(\'\')">✚ 添加变量</button>' +
                        '</div>' +
                    '</div>' +
                    '<div class="st-mvu-insp">' +
                        '<div class="st-mvu-col-head">变量设置</div>' +
                        stMvuInspectorHtml() +
                    '</div>' +
                '</div>' +
                stMvuPreviewHtml();
        }

        function stMvuStatusHtml(d) {
            const bits = [
                ['MVU 脚本', !!d.mvuScript], ['Zod 脚本', !!d.zodScript],
                ['[InitVar]', !!d.initvar], ['变量列表', !!d.varlist],
                ['更新规则', !!d.rules], ['输出格式', !!d.format],
                ['状态栏占位符', d.placeholder]
            ];
            const rx = d.regex.hide + d.regex.beautify + d.regex.sbHide + d.regex.sbShow;
            bits.push(['正则 ' + rx + '/5', rx >= 5]);
            const chips = bits.map(b =>
                '<span class="st-mvu-chip' + (b[1] ? ' st-on' : '') + '">' +
                (b[1] ? '✓ ' : '✕ ') + escapeHtml(b[0]) + '</span>').join('');
            const missing = bits.filter(b => !b[1]).length;
            // 组件齐了但没接管 —— 这时按钮的活是「接管」，不是「补齐」
            const canTakeOver = !stEditor.mvuOwn && !!d.zodScript;
            const complete = d.hasCore && !missing;

            // 按钮只在这里拼一次 —— 各分支都复用同一份，免得同一个 id
            // 在源码里出现两遍（静态检查会当成重复 id）
            const installBtn = '<button class="st-big st-mvu-install" type="button" id="st-mvu-install" ' +
                'onclick="stMvuInstallClick()">' +
                (complete ? '🔗 接管这张卡的 MVU'
                    : (d.hasAny ? '⚡ 补齐缺失的组件' : '⚡ 一键添加 MVU')) + '</button>';
            const removeBtn = '<button class="st-big st-plain st-mvu-remove" type="button" ' +
                'onclick="stMvuRemoveClick()">🗑 移除 MVU</button>';

            let state, btns;
            if (complete) {
                state = '这张卡已经装好 MVU 了，7 类组件齐全。' +
                    (stEditor.mvuOwn
                        ? '下面的结构改动会自动同步进 Zod 与 initvar。'
                        : '卡里的 Zod 写法认不出来，<b>没有接管</b> —— ' +
                          '结构改动不会写回这张卡。点「接管」并确认后才会覆盖它。');
                btns = (canTakeOver ? installBtn : '') + removeBtn;
            } else if (d.hasAny) {
                state = '这张卡有 MVU 的一部分组件，还缺 ' + missing + ' 类。' +
                    '点「补齐」会把缺的加上，已有的不动。';
                btns = installBtn + removeBtn;
            } else {
                state = '这张卡还没有 MVU。点下面这个按钮，会一次加好：' +
                    '<b>2 个脚本</b>（MVU 本体 + Zod 结构）、<b>4 条世界书</b>' +
                    '（[InitVar] / 变量列表 / 更新规则 / 输出格式）、<b>5 条正则</b>' +
                    '（隐藏 + 美化变量更新、状态栏占位符），以及<b>开场白末尾的状态栏占位符</b>。';
                btns = installBtn;
            }
            return '<div class="st-mvu-status' + (d.hasAny ? ' st-on' : '') + '">' +
                '<div class="st-mvu-chips">' + chips + '</div>' +
                '<div class="st-mvu-state">' + state + '</div>' +
                '<div class="st-actions">' + btns + '</div>' +
                '</div>';
        }

        function stMvuOutlineRows(list, depth) {
            const out = [];
            (list || []).forEach(n => {
                const sel = stEditor.mvuSel === n.id;
                const kids = stMvuNamed(n.children);
                const isBox = ST_MVU_CONTAINER.indexOf(n.type) >= 0;
                const open = stEditor.mvuOpen[n.id] !== false;
                out.push('<div class="st-mvu-row' + (sel ? ' st-mvu-sel' : '') + '"' +
                    ' id="' + stMvuDomId(n.id) + '"' +
                    ' style="padding-left:' + (8 + depth * 14) + 'px"' +
                    ' onclick="stMvuSelect(\'' + n.id + '\')">' +
                    (isBox && kids.length
                        ? '<span class="st-mvu-tw" onclick="event.stopPropagation();' +
                          'stMvuToggleOpen(\'' + n.id + '\')">' + (open ? '▾' : '▸') + '</span>'
                        : '<span class="st-mvu-tw st-mvu-tw-x"></span>') +
                    '<span class="st-mvu-ico">' + (ST_MVU_TYPE_ICON[n.type] || '•') + '</span>' +
                    '<span class="st-mvu-name">' +
                        (n.name ? escapeHtml(n.name) : '<i>未命名</i>') + '</span>' +
                    '<span class="st-mvu-tag">' +
                        escapeHtml(ST_MVU_TYPE_LABEL[n.type] || n.type) + '</span>' +
                    (isBox && kids.length ? '<span class="st-mvu-n">' + kids.length + '</span>' : '') +
                    '</div>');
                if (isBox && kids.length && open) out.push(stMvuOutlineRows(n.children, depth + 1));
            });
            return out.join('');
        }

        function stMvuInspectorHtml() {
            const hit = stMvuSelected();
            if (!hit) {
                return '<div class="st-empty">左边点一个变量，这里就能改它的设置。</div>';
            }
            const n = hit.node;
            const p = hit.path;
            const isBox = ST_MVU_CONTAINER.indexOf(n.type) >= 0;
            const wid = stMvuDomId(n.id).replace(/^st-/, '');
            const lit = "'" + n.id + "'";

            const typeOpts = ST_MVU_TYPES.map(t =>
                ({ value: t, label: ST_MVU_TYPE_ICON[t] + ' ' + ST_MVU_TYPE_LABEL[t] }));

            // 标量才有默认值；容器 / 动态表的初始值靠子字段或留空
            let valueField = '';
            if (n.type === 'boolean') {
                valueField = stSelect('默认值', p + '.value',
                    [{ value: '', label: '（不设）' }, { value: 'false', label: 'false' },
                        { value: 'true', label: 'true' }],
                    { id: wid + '-val' });
            } else if (n.type === 'enum') {
                valueField = n.options.length
                    ? stSelect('默认值', p + '.value',
                        [{ value: '', label: '（取第一个）' }].concat(
                            n.options.map(o => ({ value: o, label: o }))),
                        { id: wid + '-val' })
                    : '';
            } else if (n.type === 'string') {
                valueField = stInput('默认值', p + '.value',
                    { id: wid + '-val', ph: '留空 = 不设初始值' });
            } else if (n.type === 'number') {
                valueField = stInput('默认值', p + '.value',
                    { id: wid + '-val', type: 'number', ph: '留空 = 不设初始值' });
            }

            let numFields = '';
            if (n.type === 'number') {
                numFields = stCheck('整数（.int()）', p + '.int', { id: wid + '-int' }) +
                    stInput('下限', p + '.min', {
                        id: wid + '-min', type: 'number',
                        hint: '留空 = 不限（可以为负）', ph: '不限'
                    }) +
                    stInput('上限', p + '.max', {
                        id: wid + '-max', type: 'number',
                        hint: '留空 = 不限（可以为负）', ph: '不限'
                    });
            }

            let enumFields = '';
            if (n.type === 'enum') {
                enumFields = '<div class="st-field st-wide"><label>可选值</label>' +
                    (n.options.length
                        ? n.options.map((o, i) =>
                            '<div class="st-mvu-opt">' +
                            '<input type="text" value="' + escapeHtml(o) + '"' +
                                ' oninput="stSetList(\'' + p + '.options\',' + i + ',this.value)">' +
                            '<button class="st-mini st-danger" type="button"' +
                                ' onclick="stDelListItem(\'' + p + '.options\',' + i + ')">✕</button>' +
                            '</div>').join('')
                        : '<div class="st-empty">还没有可选值。</div>') +
                    '<div class="st-actions"><button class="st-mini" type="button"' +
                        ' onclick="stAddListItem(\'' + p + '.options\')">✚ 添加可选值</button></div>' +
                    '</div>';
            }

            const kids = isBox
                ? '<div class="st-sub">子字段</div>' + stMvuChildRows(n) +
                  '<div class="st-actions">' +
                      '<button class="st-mini" type="button" onclick="stMvuAddNode(' + lit + ')">' +
                          '✚ 添加子字段</button>' +
                  '</div>'
                : '';

            return '<div class="st-mvu-form">' +
                '<div class="st-grid">' +
                    stInput('变量名', p + '.name', {
                        id: wid + '-name', wide: true,
                        ph: n.type === 'record' ? '例：背包（键由剧情产生）' : '例：好感度'
                    }) +
                    stSelect('类型', p + '.type', typeOpts, { id: wid + '-type' }) +
                '</div>' +
                '<div class="st-hint">' + escapeHtml(ST_MVU_TYPE_HINT[n.type] || '') + '</div>' +
                '<div class="st-grid">' + valueField + '</div>' +
                '<div class="st-grid">' + numFields + '</div>' +
                enumFields +
                stArea('说明（写进 .describe()，也是更新规则的 value）', p + '.desc', {
                    id: wid + '-desc', rows: 2,
                    ph: '给 AI 看的一句话。例：对<user>的好感程度，0 陌生 / 100 依恋'
                }) +
                kids +
                '<div class="st-actions">' +
                    '<button class="st-mini" type="button" onclick="stMvuDupNode(' + lit +
                        ')">⧉ 复制</button>' +
                    '<button class="st-mini st-danger" type="button" onclick="stMvuDelNode(' + lit +
                        ')">✕ 删除这个变量</button>' +
                '</div>' +
                '</div>';
        }

        function stMvuChildRows(n) {
            if (!n.children.length) return '<div class="st-empty">还没有子字段。</div>';
            return n.children.map((ch, i) => {
                const lit = "'" + ch.id + "'";
                return '<div class="st-mvu-crow' +
                    (stEditor.mvuSel === ch.id ? ' st-mvu-sel' : '') + '">' +
                    '<span class="st-mvu-ico">' + (ST_MVU_TYPE_ICON[ch.type] || '•') + '</span>' +
                    '<button class="st-mvu-clink" type="button" onclick="stMvuSelect(' + lit + ')">' +
                        (ch.name ? escapeHtml(ch.name) : '<i>未命名</i>') + '</button>' +
                    '<span class="st-mvu-tag">' +
                        escapeHtml(ST_MVU_TYPE_LABEL[ch.type] || ch.type) + '</span>' +
                    '<span class="st-mvu-cbtns">' +
                        '<button class="st-mini" type="button" onclick="stMvuMoveNode(' + lit + ',-1)"' +
                            (i <= 0 ? ' disabled' : '') + '>↑</button>' +
                        '<button class="st-mini" type="button" onclick="stMvuMoveNode(' + lit + ',1)"' +
                            (i >= n.children.length - 1 ? ' disabled' : '') + '>↓</button>' +
                        '<button class="st-mini st-danger" type="button" onclick="stMvuDelNode(' +
                            lit + ')">✕</button>' +
                    '</span></div>';
            }).join('');
        }

        function stMvuPreviewHtml() {
            const esc = s => escapeHtml(String(s));
            return '<details class="st-mvu-preview">' +
                '<summary>生成的内容（' +
                    (stEditor.mvuOwn ? '改结构会自动重写' : '装好 MVU 后会自动写进卡里') + '）</summary>' +
                '<div class="st-sub">Zod 脚本（变量结构校验）</div>' +
                '<pre class="st-json st-mvu-code">' + esc(stMvuZodCode()) + '</pre>' +
                '<div class="st-sub">[InitVar] 条目内容（初始值 YAML）</div>' +
                '<pre class="st-json st-mvu-code">' + esc(stMvuInitVarYaml() || '（还没有变量）') + '</pre>' +
                '<div class="st-sub">[mvu_update]变量更新规则</div>' +
                '<pre class="st-json st-mvu-code">' + esc(stMvuRulesYaml()) + '</pre>' +
                '</details>';
        }

