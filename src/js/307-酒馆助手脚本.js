        // ===== 酒馆助手脚本 =====

        // 文件夹里装的是脚本，所以「几个脚本」要连文件夹一起数
        function stThCountScripts(nodes) {
            let n = 0;
            (nodes || []).forEach(x => {
                if (!x) return;
                if (x.kind === 'folder') n += (x.scripts || []).length;
                else n += 1;
            });
            return n;
        }

        // 节点路径 → DOM id。渲染和摘要刷新两处都走它，免得两边算法走岔
        function stThDomId(path) {
            const s = String(path);
            let m = /^card\.thScripts\[(\d+)\]\.scripts\[(\d+)\]$/.exec(s);
            if (m) return 'st-th-' + m[1] + '-' + m[2];
            m = /^card\.thScripts\[(\d+)\]$/.exec(s);
            return 'st-th-' + (m ? m[1] : 'x');
        }

        // 节点所在的那个数组 + 自己的下标
        function stThContainer(path) {
            const m = /^(.*)\[(\d+)\]$/.exec(String(path));
            if (!m) return null;
            const r = stResolve(m[1]);
            if (!r) return null;
            const arr = r.obj[r.key];
            if (!Array.isArray(arr)) return null;
            return { arr: arr, index: Number(m[2]) };
        }

        // 从任意子字段路径回溯到它所属的那个节点（文件夹里的脚本要退两层）
        function stThOwnerPath(p) {
            const s = String(p);
            let m = /^(card\.thScripts\[\d+\]\.scripts\[\d+\])/.exec(s);
            if (m) return m[1];
            m = /^(card\.thScripts\[\d+\])/.exec(s);
            return m ? m[1] : '';
        }

        function stPaneTh() {
            const c = stEditor.card;
            const top = c.thScripts;
            const total = stThCountScripts(top);
            let on = 0;
            top.forEach(x => {
                if (!x) return;
                if (x.kind === 'folder') {
                    // 文件夹关掉等于把里面的脚本一起关掉
                    if (x.enabled !== false) on += x.scripts.filter(s => s.enabled).length;
                } else if (x.enabled) on += 1;
            });
            const extras = stThExtras();
            return stPaneHead('🧩 酒馆助手脚本',
                '对应卡里 <code>data.extensions.tavern_helper.scripts</code> —— ' +
                '<b>酒馆助手（JS-Slash-Runner）</b>的角色卡脚本库。' +
                '本应用只负责<b>写进卡里 / 从卡里读出来</b>，不会执行它们' +
                '（要跑得在装了酒馆助手的 SillyTavern 里）。' +
                '脚本的总开关在扩展自己的设置里，卡里只带脚本本体。') +
                (c.spec === 'v1'
                    ? '<div class="st-note st-warn">当前是 V1。V1 没有 <code>extensions</code>，' +
                      '脚本不会被写进卡里 —— 切到 V2 / V3 再导出。</div>'
                    : '') +
                (top.length
                    ? '<div class="st-note">' + top.length + ' 个顶层节点 · 共 ' + total +
                      ' 个脚本 · 启用 ' + on + ' 个' +
                      (extras.variables
                          ? '<br>这张卡还带了脚本变量（<code>tavern_helper.variables</code>）：' +
                            '本编辑器不改它，导出时原样保留。'
                          : '') +
                      '</div>'
                    : '<div class="st-empty">还没有脚本。点下面的「✚ 添加脚本」。</div>') +
                top.map((n, i) => stThNodeHtml(n, 'card.thScripts[' + i + ']')).join('') +
                '<div class="st-actions">' +
                    '<button class="st-big" type="button" id="st-th-add-btn" onclick="stThAddScript()">' +
                        '✚ 添加脚本</button>' +
                    '<button class="st-big st-plain" type="button" onclick="stThAddFolder()">📁 添加文件夹</button>' +
                    '<button class="st-big st-plain" type="button" onclick="stThImportPick()">' +
                        '📥 导入脚本 JSON</button>' +
                '</div>';
        }

        function stThNodeHtml(n, path) {
            return (n && n.kind === 'folder') ? stThFolderHtml(n, path) : stThScriptHtml(n, path);
        }

        function stThScriptHtml(s, path) {
            const uid = stThDomId(path);
            // 控件小工具自己会补一个 'st-' 前缀（stInput → id="st-<o.id>"），
            // 所以传进去的 id 要先把前缀摘掉，否则会变成 st-st-th-0-content
            const wid = uid.replace(/^st-/, '');
            const nb = (s.buttonEnabled && s.buttons.length) ? s.buttons.length : 0;
            return '<details class="st-entry st-th-script' + (s.enabled ? '' : ' st-entry-off') +
                '" id="' + uid + '">' +
                '<summary>' +
                    '<span class="st-chip' + (s.enabled ? ' st-on' : '') + '">' +
                        (s.enabled ? '启用' : '停用') + '</span>' +
                    '<span class="st-chip"' + (nb ? '' : ' style="display:none"') + '>' +
                        '按钮 ' + nb + '</span>' +
                    '<span class="st-entry-sum">' +
                        (s.name ? escapeHtml(s.name) : '<i>（没写名字）</i>') +
                    '</span>' +
                '</summary>' +
                '<div class="st-entry-body">' +
                    '<div class="st-grid">' +
                        stInput('脚本名 name', path + '.name', {
                            id: wid + '-name', wide: true, ph: '例：好感度面板'
                        }) +
                        stArea('脚本内容 content', path + '.content', {
                            id: wid + '-content', rows: 12, tall: true,
                            ph: "// 跑在酒馆助手的 iframe 里\n// 例：eventOn('MESSAGE_RECEIVED', () => { /* … */ })"
                        }) +
                        stArea('作者备注 info', path + '.info', {
                            id: wid + '-info', rows: 2,
                            ph: '写给用的人看的说明 —— 酒馆助手里点「查看作者备注」能看到'
                        }) +
                        stArea('附加数据 data（JSON）', path + '.dataText', {
                            id: wid + '-data', rows: 3,
                            ph: '{} —— 脚本自己的初始化数据，解析不了就按 {} 写出去'
                        }) +
                    '</div>' +
                    '<div class="st-checks">' +
                        stCheck('启用', path + '.enabled', { id: wid + '-en' }) +
                        stCheck('显示悬浮按钮（button.enabled）', path + '.buttonEnabled',
                            { id: wid + '-bten' }) +
                        stCheck('导出时带上 data', path + '.exportData', { id: wid + '-exd' }) +
                        stCheck('导出时带上按钮', path + '.exportButton', { id: wid + '-exb' }) +
                    '</div>' +
                    stThButtonsHtml(s, path) +
                    '<div class="st-actions">' +
                        '<button class="st-mini" type="button" onclick="stThExportScript(\'' +
                            path + '\')">📤 导出这个脚本</button>' +
                    '</div>' +
                    stThNodeActions(path) +
                '</div>' +
            '</details>';
        }

        function stThButtonsHtml(s, path) {
            const bp = path + '.buttons';
            return '<div class="st-sub">悬浮按钮 buttons（' + s.buttons.length + ' 个）</div>' +
                (s.buttons.length
                    ? s.buttons.map((b, j) =>
                        '<div class="st-th-btn">' +
                            '<input type="text" value="' + escapeHtml(b.name) + '"' +
                                ' placeholder="按钮名"' +
                                ' oninput="stThButton(\'' + bp + '\',' + j + ',\'name\',this.value)">' +
                            '<label class="st-check"><input type="checkbox"' +
                                (b.visible ? ' checked' : '') +
                                ' onchange="stThButton(\'' + bp + '\',' + j +
                                ',\'visible\',this.checked)">' +
                                '<span>可见</span></label>' +
                            '<button class="st-mini st-danger" type="button" onclick="stThDelButton(\'' +
                                bp + '\',' + j + ')">✕</button>' +
                        '</div>').join('')
                    : '<div class="st-note">还没有按钮。按钮是脚本自己往界面里加的悬浮按钮，' +
                      '这里只管导出时带不带。</div>') +
                '<div class="st-actions">' +
                    '<button class="st-mini" type="button" onclick="stThAddButton(\'' + bp + '\')">' +
                        '✚ 加按钮</button>' +
                '</div>';
        }

        function stThFolderHtml(f, path) {
            const uid = stThDomId(path);
            // 同上：小工具会补 'st-' 前缀
            const wid = uid.replace(/^st-/, '');
            const on = f.enabled !== false;
            return '<details class="st-entry st-th-folder' + (on ? '' : ' st-entry-off') +
                '" id="' + uid + '">' +
                '<summary>' +
                    '<span class="st-chip' + (on ? ' st-on' : '') + '">' +
                        (on ? '启用' : '停用') + '</span>' +
                    '<span class="st-chip"' + (f.scripts.length ? '' : ' style="display:none"') + '>' +
                        f.scripts.length + ' 个脚本</span>' +
                    '<span class="st-entry-sum">📁 ' +
                        (f.name ? escapeHtml(f.name) : '<i>（没写名字）</i>') +
                    '</span>' +
                '</summary>' +
                '<div class="st-entry-body">' +
                    '<div class="st-grid">' +
                        stInput('文件夹名 name', path + '.name', { id: wid + '-name', ph: '例：工具' }) +
                        stInput('图标 icon', path + '.icon', {
                            id: wid + '-icon', hint: 'Font Awesome 类名'
                        }) +
                        stInput('颜色 color', path + '.color', {
                            id: wid + '-color', hint: 'CSS 颜色'
                        }) +
                    '</div>' +
                    '<div class="st-checks">' +
                        stCheck('启用（关掉会把里面的脚本一起停掉）', path + '.enabled',
                            { id: wid + '-en' }) +
                    '</div>' +
                    '<div class="st-sub">文件夹里的脚本（' + f.scripts.length + ' 个）</div>' +
                    (f.scripts.length
                        ? f.scripts.map((s, j) =>
                            stThScriptHtml(s, path + '.scripts[' + j + ']')).join('')
                        : '<div class="st-note">这个文件夹还是空的。</div>') +
                    '<div class="st-actions">' +
                        '<button class="st-mini" type="button" onclick="stThAddScript(\'' +
                            path + '.scripts\')">✚ 往文件夹里加脚本</button>' +
                    '</div>' +
                    stThNodeActions(path) +
                '</div>' +
            '</details>';
        }

        function stThNodeActions(path) {
            const c = stThContainer(path);
            const len = c ? c.arr.length : 1;
            const i = c ? c.index : 0;
            const lit = "'" + path + "'";
            return '<div class="st-actions">' +
                '<button class="st-mini" type="button" onclick="stThMoveNode(' + lit + ',-1)"' +
                    (i <= 0 ? ' disabled' : '') + '>↑ 上移</button>' +
                '<button class="st-mini" type="button" onclick="stThMoveNode(' + lit + ',1)"' +
                    (i >= len - 1 ? ' disabled' : '') + '>↓ 下移</button>' +
                '<button class="st-mini" type="button" onclick="stThDupNode(' + lit + ')">⧉ 复制</button>' +
                '<button class="st-mini st-danger" type="button" onclick="stThDelNode(' + lit +
                    ')">✕ 删除</button>' +
            '</div>';
        }

