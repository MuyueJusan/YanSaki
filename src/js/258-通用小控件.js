        // ===== 通用小控件 =====

        // 单行文本
        function stInput(label, path, opts) {
            const o = opts || {};
            const v = stGet(path);
            return '<div class="st-field' + (o.wide ? ' st-wide' : '') + '">' +
                '<label for="st-' + o.id + '">' + escapeHtml(label) +
                    (o.hint ? ' <span class="st-hint-inline">' + escapeHtml(o.hint) + '</span>' : '') +
                '</label>' +
                '<input id="st-' + o.id + '" type="' + (o.type || 'text') + '"' +
                    (o.ph ? ' placeholder="' + escapeHtml(o.ph) + '"' : '') +
                    (o.min !== undefined ? ' min="' + o.min + '"' : '') +
                    (o.max !== undefined ? ' max="' + o.max + '"' : '') +
                    ' value="' + escapeHtml(v == null ? '' : String(v)) + '"' +
                    ' oninput="stSet(\'' + path + '\',this.value)">' +
                '</div>';
        }

        // 关键词标签 —— 世界书的 keys / secondary_keys 用它。
        // 长得像社交软件里的标签：一个词一个圆角矩形，回车落一个、点 × 删一个。
        // 存的仍然是数组（走 XxxText 那套别名），只是编辑手感换成了标签。
        // DOM 上派生两个东西：st-<id>（输入框）、st-<id>-tags（装标签的框）
        function stTags(label, path, opts) {
            const o = opts || {};
            const base = 'st-' + o.id;
            const list = stSplitList(stGet(path));
            const ph = o.ph || '';
            return '<div class="st-field st-wide">' +
                '<label for="' + base + '">' + escapeHtml(label) +
                    (o.hint ? ' <span class="st-hint-inline">' + escapeHtml(o.hint) + '</span>' : '') +
                '</label>' +
                '<div class="st-tags" id="' + base + '-tags"' +
                    ' data-path="' + escapeHtml(path) + '"' +
                    ' data-ph="' + escapeHtml(ph) + '"' +
                    ' onclick="stTagsFocus(\'' + base + '\')">' +
                    list.map((w, i) => stTagHtml(base, i, w)).join('') +
                    '<input id="' + base + '" type="text" class="st-tags-in"' +
                        // 有标签时不挂 placeholder —— 否则它会挤在最后一个标签旁边
                        (list.length || !ph ? '' : ' placeholder="' + escapeHtml(ph) + '"') +
                        ' onkeydown="return stTagsKey(event,\'' + base + '\')"' +
                        ' onpaste="return stTagsPaste(event,\'' + base + '\')"' +
                        ' onblur="stTagsCommit(\'' + base + '\')">' +
                '</div>' +
            '</div>';
        }

        // 多行文本
        function stArea(label, path, opts) {
            const o = opts || {};
            const v = stGet(path);
            return '<div class="st-field st-wide' + (o.tall ? ' st-tall' : '') + '">' +
                '<label for="st-' + o.id + '">' + escapeHtml(label) +
                    (o.hint ? ' <span class="st-hint-inline">' + escapeHtml(o.hint) + '</span>' : '') +
                '</label>' +
                '<textarea id="st-' + o.id + '" rows="' + (o.rows || 4) + '"' +
                    (o.ph ? ' placeholder="' + escapeHtml(o.ph) + '"' : '') +
                    ' oninput="stSet(\'' + path + '\',this.value)">' +
                    escapeHtml(v == null ? '' : String(v)) + '</textarea>' +
                '</div>';
        }

        // 下拉。opts.items 是 [{value, label}] 或 [value,...]（后者用 labels 映射）
        function stSelect(label, path, items, opts) {
            const o = opts || {};
            const cur = String(stGet(path));
            const body = items.map(it => {
                const val = (it && typeof it === 'object') ? String(it.value) : String(it);
                const lab = (it && typeof it === 'object') ? it.label : String(it);
                return '<option value="' + escapeHtml(val) + '"' +
                    (val === cur ? ' selected' : '') + '>' + escapeHtml(lab) + '</option>';
            }).join('');
            return '<div class="st-field' + (o.wide ? ' st-wide' : '') + '">' +
                '<label for="st-' + o.id + '">' + escapeHtml(label) + '</label>' +
                '<select id="st-' + o.id + '" onchange="stSet(\'' + path + '\',this.value)">' +
                    body + '</select></div>';
        }

        // 数字
        function stNum(label, path, min, max, opts) {
            const o = opts || {};
            const v = stGet(path);
            return '<div class="st-field' + (o.wide ? ' st-wide' : '') + '">' +
                '<label for="st-' + o.id + '">' + escapeHtml(label) +
                    (o.hint ? ' <span class="st-hint-inline">' + escapeHtml(o.hint) + '</span>' : '') +
                '</label>' +
                '<input id="st-' + o.id + '" type="number" min="' + min + '" max="' + max + '"' +
                    ' value="' + escapeHtml(v == null ? '' : String(v)) + '"' +
                    ' onchange="stSet(\'' + path + '\',this.value)">' +
                '</div>';
        }

        // 勾选
        function stCheck(label, path, opts) {
            const o = opts || {};
            const v = stGet(path) === true;
            return '<label class="st-check" title="' + escapeHtml(o.title || label) + '">' +
                '<input type="checkbox" id="st-' + o.id + '"' + (v ? ' checked' : '') +
                    ' onchange="stSet(\'' + path + '\',this.checked)">' +
                '<span>' + escapeHtml(label) + '</span></label>';
        }

        // 数组字段的勾选（triggers / placement）。value 直接写进 onclick，
        // 所以只能是数字或简单标识符 —— 实际用到的都是这两种
        function stCheckIn(label, path, value, opts) {
            const o = opts || {};
            const arr = stGet(path);
            const on = Array.isArray(arr) && arr.indexOf(value) >= 0;
            const lit = (typeof value === 'number') ? String(value) : ("'" + String(value) + "'");
            return '<label class="st-check" title="' + escapeHtml(o.title || label) + '">' +
                '<input type="checkbox" id="st-' + o.id + '"' + (on ? ' checked' : '') +
                    ' onchange="stToggleIn(\'' + path + '\',' + lit + ',this.checked)">' +
                '<span>' + escapeHtml(label) + '</span></label>';
        }

        // 三态勾选（null = 跟随世界书全局设置）
        function stTri(label, path, opts) {
            const o = opts || {};
            const raw = stGet(path);
            const state = raw === true ? 'on' : (raw === false ? 'off' : 'inherit');
            const body = [['inherit', '跟随全局'], ['on', '开'], ['off', '关']].map(p =>
                '<option value="' + p[0] + '"' + (state === p[0] ? ' selected' : '') + '>' +
                p[1] + '</option>').join('');
            return '<div class="st-field">' +
                '<label for="st-' + o.id + '" title="' + escapeHtml(o.title || label) + '">' +
                    escapeHtml(label) + '</label>' +
                '<select id="st-' + o.id + '" onchange="stSetTri(\'' + path + '\',this.value)">' +
                    body + '</select></div>';
        }

        function stPaneHead(title, desc) {
            return '<div class="st-pane-head">' +
                '<div class="st-pane-title">' + escapeHtml(title) + '</div>' +
                (desc ? '<div class="st-pane-desc">' + desc + '</div>' : '') +
                '</div>';
        }

