        // ===== 世界书多选管理 =====
        //
        // 选中状态按**条目 id** 记，不按下标 —— 下标在增删 / 上下移动之后就失效了，
        // 会出现「勾了第 3 条，删掉第 1 条之后第 3 条自己变成了第 2 条」这种事。
        // （MVU / 状态栏那两个选择器也是同一条理由，见 stEditor 里 mvuSel / sbSel 的注释。）
        //
        // ⚠ 它是**会话级界面状态**，跟 extractSel / personaReq 同类：不落盘、不进卡、
        //   也不会出现在任何导出的 JSON 里。落盘的话下次打开会莫名其妙勾着一堆条目。

        // 还活着的选中 id 集合。⚠ 删条目 / 换卡之后残留的 id **不算选中** ——
        // 不筛掉的话「已选 N 条」会数出一个根本点不到的条目，批量删除还会删错东西
        function stBookSelIds() {
            const raw = Array.isArray(stEditor.bookSel) ? stEditor.bookSel : [];
            const a = (stEditor.card && Array.isArray(stEditor.card.bookEntries))
                ? stEditor.card.bookEntries : [];
            const alive = new Set();
            a.forEach(e => alive.add(e.id));
            return new Set(raw.filter(id => alive.has(id)));
        }

        // 选中的条目下标（升序）
        function stBookSelIdx() {
            const set = stBookSelIds();
            const a = (stEditor.card && Array.isArray(stEditor.card.bookEntries))
                ? stEditor.card.bookEntries : [];
            const out = [];
            a.forEach((e, i) => { if (set.has(e.id)) out.push(i); });
            return out;
        }

        // 把集合写回 stEditor.bookSel（顺手把死 id 清掉）
        function stBookSelPut(set) {
            stEditor.bookSel = Array.from(set);
        }

        function stBookSelClear() { stEditor.bookSel = []; }

        function stBookSelToggle(box) {
            const id = box.getAttribute('data-id');
            if (!id) return;
            const set = stBookSelIds();
            if (box.checked) set.add(id); else set.delete(id);
            stBookSelPut(set);
            stBookSelPaint();
        }

        // ⚠⚠ 筛选生效时，「全选」只选**看得见的那些**。
        //   全选把看不见的也勾上的话，接下来一次「批量删除」就会删掉
        //   用户根本没在屏幕上见过的条目 —— 而确认框只报个数，救不回来。
        //   筛选关掉时 vis === 全集，行为跟以前一模一样。
        function stBookSelAll(on) {
            const a = stEditor.card ? stEditor.card.bookEntries : [];
            const vis = stBookFindIdx(a).map(i => a[i].id);
            const set = stBookSelIds();
            if (on) vis.forEach(id => set.add(id));
            else vis.forEach(id => set.delete(id));
            stBookSelPut(set);
            stBookSelPaint();
        }

        // 反选同理：只在可见集里翻，看不见的那些保持原样
        function stBookSelInvert() {
            const a = stEditor.card ? stEditor.card.bookEntries : [];
            const vis = stBookFindIdx(a).map(i => a[i].id);
            const set = stBookSelIds();
            vis.forEach(id => { if (set.has(id)) set.delete(id); else set.add(id); });
            stBookSelPut(set);
            stBookSelPaint();
        }

        // 只重画「勾选框 + 那一行计数 + 按钮禁用态」，**不整页重画**。
        // ⚠ 条目卡片里有输入框（备注 / 正文 / 关键词标签），整页重画会把正在编辑的
        //   那个节点换掉 —— 光标飞、滚动跳。所以这里只改勾选状态，不碰卡片本身
        function stBookSelPaint() {
            const a = (stEditor.card && Array.isArray(stEditor.card.bookEntries))
                ? stEditor.card.bookEntries : [];
            const set = stBookSelIds();
            document.querySelectorAll('#st-panes .st-sel-box').forEach(box => {
                box.checked = set.has(box.getAttribute('data-id'));
            });
            // ⚠ 分母用**可见集**：「全选」的勾选态只描述屏幕上这一批。
            //   用全集算的话，筛出 2 条、全勾上之后「全选」还是半选态，看着像没勾全
            const vis = stBookFindIdx(a).map(i => a[i].id);
            const visSel = vis.filter(id => set.has(id)).length;
            const all = document.getElementById('st-sel-all');
            if (all) {
                all.checked = vis.length > 0 && visSel === vis.length;
                // ⚠ indeterminate 只能靠 JS 设，没有对应的 HTML 属性 ——
                //   光靠渲染出来的字符串是设不出来的，必须在这里补
                all.indeterminate = visSel > 0 && visSel < vis.length;
            }
            const info = document.getElementById('st-sel-info');
            if (info) {
                // ⚠ 没筛选时**保持原来那句一字不差**（「已选 N / M 条」）——
                //   好几句断言盯着这个格式，改它等于让它们假红
                let txt = '已选 ' + set.size + ' / ' + a.length + ' 条';
                if (stBookFindActive()) {
                    const hiddenSel = set.size - visSel;
                    txt += '（命中 ' + vis.length + ' 条' +
                        (hiddenSel > 0 ? '，另有 ' + hiddenSel + ' 条已选被筛掉' : '') + '）';
                }
                info.textContent = txt;
            }
            document.querySelectorAll('#st-book-batch .st-need-sel').forEach(b => {
                b.disabled = set.size === 0;
            });
        }

        // 批量改一个布尔字段。走的是和单条编辑同一条路：改完 stSaveDraft + stRerender，
        // 所以摘要上那两枚「启用 / 常驻」小标签会跟着变，草稿也立刻落盘
        function stBookBatch(kind) {
            const idx = stBookSelIdx();
            if (!idx.length) return;
            const label = { on: '启用', off: '停用', constOn: '设为常驻', constOff: '取消常驻' }[kind] || kind;
            const a = stEditor.card.bookEntries;
            idx.forEach(i => {
                const e = a[i];
                if (!e) return;
                if (kind === 'on') e.enabled = true;
                else if (kind === 'off') e.enabled = false;
                else if (kind === 'constOn') e.constant = true;
                else if (kind === 'constOff') e.constant = false;
            });
            stSaveDraft();
            stRerender();
            stBookSelPaint();
            stExportMsg('✅ 已把选中的 ' + idx.length + ' 条' + label + '。', 'ok');
        }

        // 批量删除。⚠ 从**后往前**删 —— 从前往后删的话，删掉第 2 条之后原来第 5 条
        // 就变成了第 4 条，后面记着的下标全部错位，删掉的就不是用户勾的那些了
        function stBookBatchDel() {
            const idx = stBookSelIdx();
            if (!idx.length) return;
            const n = idx.length;
            if (!window.confirm('确定删除选中的 ' + n + ' 条世界书条目？删了就没了，没有撤销。')) return;
            const a = stEditor.card.bookEntries;
            for (let k = idx.length - 1; k >= 0; k--) a.splice(idx[k], 1);
            stBookSelClear();
            stSaveDraft();
            stRerender();
            stExportMsg('🗑 已删除 ' + n + ' 条世界书条目。', 'warn');
        }

        // 选中条目 → **独立世界书** JSON。⚠ 形状跟卡内的 character_book **不是一回事**：
        //   · 顶层 entries 是**以 uid 字符串为键的对象**，不是数组 —— SillyTavern 的
        //     world-info.js 里到处是 `data.entries[uid]` / `Object.values(data.entries)`
        //   · 字段用 ST 世界书自己的名字：key / keysecondary / uid / disable / position(数字)
        //     （卡内那份是 keys / secondary_keys / id / enabled / position 字符串）
        //   · ST 导入时会跑 addMissingWorldInfoFields()，按它自己的模板把缺的字段补上，
        //     所以这里**只写我们真有的**，不编造默认值 —— 少写是安全的，写错才是灾难
        function stEntryToWiJson(e, uid) {
            return {
                uid: uid,
                key: e.keys.slice(),
                keysecondary: e.secondaryKeys.slice(),
                comment: e.comment,
                content: stEntryContentRaw(e),
                constant: !!e.constant,
                selective: !!e.selective,
                selectiveLogic: e.selectiveLogic,
                order: e.order,
                position: e.position,
                disable: !e.enabled,
                depth: e.depth,
                role: e.role,
                probability: e.probability,
                useProbability: !!e.useProbability,
                caseSensitive: e.caseSensitive,
                matchWholeWords: e.matchWholeWords,
                useGroupScoring: e.useGroupScoring,
                excludeRecursion: !!e.excludeRecursion,
                preventRecursion: !!e.preventRecursion,
                delayUntilRecursion: e.delayUntilRecursion,
                scanDepth: e.scanDepth,
                group: e.group,
                groupWeight: e.groupWeight,
                groupOverride: !!e.groupOverride,
                triggers: e.triggers.slice(),
                sticky: e.sticky == null ? 0 : e.sticky,
                cooldown: e.cooldown == null ? 0 : e.cooldown,
                delay: e.delay == null ? 0 : e.delay,
                outletName: e.outletName,
                characterFilter: {
                    isExclude: !!e.characterFilter.isExclude,
                    names: e.characterFilter.names.slice(),
                    tags: e.characterFilter.tags.slice()
                },
                matchPersonaDescription: !!e.matchPersonaDescription,
                matchCharacterDescription: !!e.matchCharacterDescription,
                matchCharacterPersonality: !!e.matchCharacterPersonality,
                matchCharacterDepthPrompt: !!e.matchCharacterDepthPrompt,
                matchScenario: !!e.matchScenario,
                matchCreatorNotes: !!e.matchCreatorNotes,
                useRegex: !!e.useRegex,
                vectorized: false,
                addMemo: true,
                displayIndex: uid,
                extensions: {}
            };
        }

        function stBookToStandaloneJson(list) {
            const c = stEditor.card;
            const entries = {};
            list.forEach((e, i) => { entries[String(i)] = stEntryToWiJson(e, i); });
            return {
                name: c.bookName || (c.name ? c.name + ' 的世界书' : '世界书'),
                description: c.bookDescription || '',
                entries: entries
            };
        }

        function stBookExportSel() {
            const idx = stBookSelIdx();
            if (!idx.length) return;
            const all = stEditor.card.bookEntries;
            const picked = idx.map(i => all[i]);
            try {
                const text = JSON.stringify(stBookToStandaloneJson(picked), null, 2);
                const base = stSafeFileName(stEditor.card.bookName ||
                    (stEditor.card.name ? stEditor.card.name + ' 的世界书' : '世界书'));
                const part = picked.length === all.length ? '' : '（选中 ' + picked.length + ' 条）';
                const name = base + part + '.json';
                stDownload(name, new Blob([text], { type: 'application/json' }));
                stEditor.lastExport = '世界书 · ' + name + ' · ' + text.length + ' 字符';
                stSaveDraft();
                stExportNote();
                stExportMsg('✅ 已导出世界书 ' + name + '（' + picked.length + ' 条 · ' +
                    text.length + ' 字符）。', 'ok');
            } catch (e) {
                stExportMsg('❌ 导出失败：' + (e && e.message ? e.message : e), 'bad');
            }
        }

        // 搜索与筛选那一栏。⚠ 每个选项的文字自带维度名（「状态：启用」），
        // 这样不用额外加 <label>，窄屏下也不会因为 label 换行而错位
        function stBookFindBar(entries) {
            const f = stBookFind();
            const act = stBookFindActive(f);
            const opt = (key, v, label) => '<option value="' + escapeHtml(String(v)) + '"' +
                (String(f[key]) === String(v) ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
            return '<div class="st-find" id="st-book-find">' +
                '<div class="st-find-row">' +
                    '<input class="st-find-q" type="search" id="st-find-q" autocomplete="off"' +
                        ' placeholder="搜备注 / 关键词 / 正文…"' +
                        ' value="' + escapeHtml(f.q) + '"' +
                        ' oninput="stBookFindSet(\'q\', this.value)">' +
                    '<span class="st-find-info" id="st-find-info">共 ' + entries.length + ' 条</span>' +
                    '<button class="st-mini" type="button" id="st-find-reset"' +
                        (act ? '' : ' disabled') +
                        ' onclick="stBookFindReset()">重置</button>' +
                '</div>' +
                '<div class="st-find-row">' +
                    '<select id="st-find-state" title="按启用状态筛选"' +
                        ' onchange="stBookFindSet(\'state\', this.value)">' +
                        opt('state', 'all', '状态：全部') + opt('state', 'on', '状态：启用') +
                        opt('state', 'off', '状态：停用') +
                    '</select>' +
                    '<select id="st-find-const" title="按是否常驻筛选"' +
                        ' onchange="stBookFindSet(\'constant\', this.value)">' +
                        opt('constant', 'all', '常驻：全部') + opt('constant', 'yes', '常驻：只常驻') +
                        opt('constant', 'no', '常驻：非常驻') +
                    '</select>' +
                    '<select id="st-find-keys" title="按有没有关键词筛选"' +
                        ' onchange="stBookFindSet(\'keys\', this.value)">' +
                        opt('keys', 'all', '关键词：全部') + opt('keys', 'has', '关键词：有') +
                        opt('keys', 'none', '关键词：无') +
                    '</select>' +
                    '<select id="st-find-pos" title="按插入位置筛选"' +
                        ' onchange="stBookFindSet(\'pos\', this.value)">' +
                        opt('pos', 'all', '位置：全部') +
                        WI_POS_ORDER.map(v =>
                            opt('pos', String(v), '位置：' + (WI_POS_LABEL[v] || '?'))).join('') +
                    '</select>' +
                '</div>' +
            '</div>';
        }

        // 批量操作那一栏。**一条都没选时按钮只是 disabled，不隐藏** ——
        // 藏起来的话用户根本不知道有这些功能
        function stBookBatchBar(entries) {
            const n = stBookSelIds().size;
            const all = entries.length > 0 && n === entries.length;
            const dis = n ? '' : ' disabled';
            return '<div class="st-batch" id="st-book-batch">' +
                '<div class="st-batch-row">' +
                    '<label class="st-check st-batch-all">' +
                        '<input type="checkbox" id="st-sel-all"' + (all ? ' checked' : '') +
                            ' onchange="stBookSelAll(this.checked)">' +
                        '<span>全选</span>' +
                    '</label>' +
                    '<button class="st-mini" type="button" onclick="stBookSelInvert()">反选</button>' +
                    '<span class="st-batch-info" id="st-sel-info">已选 ' + n + ' / ' +
                        entries.length + ' 条</span>' +
                '</div>' +
                '<div class="st-batch-row">' +
                    '<button class="st-mini st-need-sel" type="button"' + dis +
                        ' onclick="stBookBatch(\'on\')">启用</button>' +
                    '<button class="st-mini st-need-sel" type="button"' + dis +
                        ' onclick="stBookBatch(\'off\')">停用</button>' +
                    '<button class="st-mini st-need-sel" type="button"' + dis +
                        ' onclick="stBookBatch(\'constOn\')">设为常驻</button>' +
                    '<button class="st-mini st-need-sel" type="button"' + dis +
                        ' onclick="stBookBatch(\'constOff\')">取消常驻</button>' +
                    '<button class="st-mini st-need-sel" type="button"' + dis +
                        ' onclick="stBookExportSel()">📤 导出为世界书</button>' +
                    '<button class="st-mini st-danger st-need-sel" type="button"' + dis +
                        ' onclick="stBookBatchDel()">✕ 删除</button>' +
                '</div>' +
            '</div>';
        }

        function stAddGreeting() {
            stEditor.card.alternateGreetings.push('');
            stSaveDraft();
            stRerender();
        }

        function stDelGreeting(i) {
            const a = stEditor.card.alternateGreetings;
            if (i < 0 || i >= a.length) return;
            a.splice(i, 1);
            stSaveDraft();
            stRerender();
        }

        function stMoveGreeting(i, d) {
            const a = stEditor.card.alternateGreetings;
            const j = i + d;
            if (i < 0 || i >= a.length || j < 0 || j >= a.length) return;
            const t = a[i]; a[i] = a[j]; a[j] = t;
            stSaveDraft();
            stRerender();
        }

        function stAddListItem(path) {
            const r = stResolve(path);
            if (!r || !Array.isArray(r.obj[r.key])) return;
            r.obj[r.key].push('');
            stSaveDraft();
            stRerender();
        }

        function stDelListItem(path, i) {
            const r = stResolve(path);
            if (!r || !Array.isArray(r.obj[r.key])) return;
            if (i < 0 || i >= r.obj[r.key].length) return;
            r.obj[r.key].splice(i, 1);
            stSaveDraft();
            stRerender();
        }

        function stAddRegex() {
            stEditor.card.regex.push(stBlankRegex());
            stSaveDraft();
            stRerender();
        }

        function stDelRegex(i) {
            const a = stEditor.card.regex;
            if (i < 0 || i >= a.length) return;
            a.splice(i, 1);
            stSaveDraft();
            stRerender();
        }

        function stMoveRegex(i, d) {
            const a = stEditor.card.regex;
            const j = i + d;
            if (i < 0 || i >= a.length || j < 0 || j >= a.length) return;
            const t = a[i]; a[i] = a[j]; a[j] = t;
            stSaveDraft();
            stRerender();
        }

        function stDupRegex(i) {
            const a = stEditor.card.regex;
            const src = a[i];
            if (!src) return;
            const copy = stRegexFromRaw(stRegexToRaw(src));
            copy.id = stUuid();
            a.splice(i + 1, 0, copy);
            stSaveDraft();
            stRerender();
        }

