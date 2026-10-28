        // —— 用户自己攒的预制块（localStorage）——
        // ⚠ 跨卡共用，所以**不进草稿**：换一张卡打开，自己攒的那些还得在。
        //   这是它跟版式模板的第三点区别 —— 模板是产品给的，预制块可以自己攒
        const ST_SB_PF_KEY = 'stSbPrefabs';
        const ST_SB_PF_MAX = 60;                  // 最多留几个
        const ST_SB_PF_ITEM_BYTES = 40 * 1024;    // 单个预制块序列化后的上限
        const ST_SB_PF_TOTAL_BYTES = 160 * 1024;  // 整份上限（localStorage 是 5MB 量级，留足余量）

        let stSbPfCache = null;   // 读一次就留着；写成功之后置空，下次读走新的

        // 预制块 id 要能直接塞进 onclick 的单引号里 —— 一律洗成纯字母数字。
        // ⚠ 别偷懒把 stUuid() 原样存：它带连字符，将来哪天拼进别的属性里
        //   就得再想一遍转义（而且「要不要转义」这种事最容易被下一个人漏掉）
        function stSbPfId(raw, i) {
            const s = stStr(raw).replace(/[^A-Za-z0-9]/g, '');
            return s || ('pf' + Date.now().toString(36) + String(i));
        }

        // 读用户预制块。坏数据一律跳过，绝不让它把渲染炸掉（跟 stAi 那套同一条规矩）。
        // 块本身过一遍 stSbBlockFromRaw —— 那份白名单就是「一个块能有哪些字段」的唯一定义，
        // 存进来时是它、读回来还是它，中间没有第二套口径
        function stSbUserPrefabs() {
            if (stSbPfCache) return stSbPfCache;
            let raw = null;
            try { raw = JSON.parse(localStorage.getItem(ST_SB_PF_KEY) || 'null'); } catch (e) { raw = null; }
            const src = (raw && typeof raw === 'object' && Array.isArray(raw.list)) ? raw.list : [];
            const list = [];
            src.forEach((it, i) => {
                if (list.length >= ST_SB_PF_MAX) return;
                if (!it || typeof it !== 'object' || Array.isArray(it)) return;
                const name = stStr(it.name).trim().slice(0, 24);
                const blocks = Array.isArray(it.blocks) ? it.blocks : [];
                if (!name || !blocks.length) return;
                const clean = [];
                blocks.slice(0, 40).forEach(b => {
                    // ⚠ 先卡「是不是个对象」再交给 stSbBlockFromRaw —— 那个函数对
                    //   垃圾输入是**宽容**的（返回一个空白块），放在草稿解析那儿正合适
                    //   （宁可留个空块也别让整张卡读不出来），但在这儿不行：
                    //   一个「全是垃圾」的预制块会变成一份**装着两个空文字块**的幽灵，
                    //   名字还在列表里，点进去却什么都没有
                    if (!b || typeof b !== 'object' || Array.isArray(b)) return;
                    try { clean.push(stSbBlockFromRaw(b)); } catch (e) {}
                });
                if (!clean.length) return;
                list.push({
                    id: stSbPfId(it.id, i),
                    name: name,
                    icon: stStr(it.icon).trim().slice(0, 4) || '★',
                    hint: stStr(it.hint).slice(0, 200),
                    blocks: clean
                });
            });
            stSbPfCache = list;
            return list;
        }

        // 写回 localStorage。白名单只列「预制块自己」那五样 —— 块里的字段由
        // stSbBlockFromRaw 那份白名单兜着，读回来还会再过一遍
        function stSbPfStore(list) {
            const payload = {
                v: 1,
                list: (list || []).slice(0, ST_SB_PF_MAX).map(it => ({
                    id: stSbPfId(it.id, 0),
                    name: stStr(it.name).trim().slice(0, 24),
                    icon: stStr(it.icon).trim().slice(0, 4),
                    hint: stStr(it.hint).slice(0, 200),
                    blocks: it.blocks
                }))
            };
            let s = '';
            try { s = JSON.stringify(payload); } catch (e) { return { ok: false, why: '序列化失败' }; }
            if (s.length > ST_SB_PF_TOTAL_BYTES) {
                return { ok: false, why: '存的东西太多（' + Math.round(s.length / 1024) +
                    ' KB），先删掉几个' };
            }
            try {
                localStorage.setItem(ST_SB_PF_KEY, s);
            } catch (e) {
                // 配额满 / 隐私模式。⚠ 必须说出去 —— 静默失败的表现是
                // 「点了保存、看着像成功、下次打开没了」，比当场报错难查得多
                return { ok: false, why: '浏览器不给写（localStorage 满了或处于隐私模式）' };
            }
            stSbPfCache = null;
            return { ok: true, why: '' };
        }

        // 变量自己的 min / max 优先（作者在 MVU 页设过 0~5 的条，到这儿不能变成 0~100，
        // 不然永远画不满 —— 跟 stSbAutoPick 同一条理由）
        function stSbPrefabRange(p, label, o) {
            const opt = o || {};
            const lo = Number(p.min);
            const base = Number.isFinite(lo) ? lo
                : (Number.isFinite(Number(opt.min)) ? Number(opt.min) : 0);
            const hi = Number(p.max);
            const top = (Number.isFinite(hi) && hi > base) ? hi
                : (Number.isFinite(Number(opt.max)) ? Number(opt.max) : 100);
            return { path: p.path, label: label, min: base, max: top, auto: true };
        }

        // 绑不上的兜底：路径用预制块写死的那个，范围用预制块声明的那对
        function stSbPrefabFallback(def, o) {
            const opt = o || {};
            const d = stStr(def);
            return {
                path: d,
                label: stStr(opt.label) ||
                    d.replace(/^stat_data\./, '').split('.').pop(),
                min: Number.isFinite(Number(opt.min)) ? Number(opt.min) : 0,
                max: Number.isFinite(Number(opt.max)) ? Number(opt.max) : 100,
                auto: false
            };
        }

        // 预制块绑变量：先在卡里的 MVU 变量树里按**关键词**找（变量名里含关键词就算命中），
        // 找不到就用兜底路径。
        //   opt.num  === true → 只要数值变量（进度条 / 圆点要拿它参与 calc）
        //   opt.used          → 本次插入里已经绑过的路径表，免得两块绑到同一个变量上
        //   opt.label         → 兜底时的显示名（命中时用变量自己的叶子名，那更诚实）
        function stSbPrefabBind(keys, def, opt) {
            const o = opt || {};
            const wantNum = o.num === true;
            const pool = stSbVarPaths().filter(p => wantNum
                ? p.type === 'number'
                : ST_MVU_CONTAINER.indexOf(p.type) < 0);
            const ks = (keys || []).map(k => String(k).toLowerCase()).filter(Boolean);
            const used = o.used || null;
            for (let i = 0; i < pool.length; i++) {
                const p = pool[i];
                if (used && used[p.path]) continue;
                const nm = String(p.name || '').toLowerCase();
                if (!ks.length || !ks.some(k => nm.indexOf(k) >= 0)) continue;
                if (used) used[p.path] = true;
                return stSbPrefabRange(p, stStr(p.name).split('.').pop(), o);
            }
            return stSbPrefabFallback(def, o);
        }

        // 复数版：同一个关键词要填 N 个槽（「好感度.角色A / 角色B / 角色C」那种）。
        // 先把卡里**所有**命中关键词的变量按树序捞出来，有几个用几个，不够的用兜底路径补齐。
        // ⚠ 别写成「循环调 N 次 stSbPrefabBind」—— 那 N 次会按同一个关键词各找一遍，
        //   而 used 表只挡「同一条路径」，于是三个槽全绑到同一个变量上，还不报错
        function stSbPrefabBindMany(keys, defs, opt) {
            const o = opt || {};
            const wantNum = o.num !== false;
            const pool = stSbVarPaths().filter(p => !wantNum || p.type === 'number');
            const ks = (keys || []).map(k => String(k).toLowerCase()).filter(Boolean);
            const hits = pool.filter(p => {
                const nm = String(p.name || '').toLowerCase();
                return ks.some(k => nm.indexOf(k) >= 0);
            });
            return (defs || []).map((def, i) => {
                const h = hits[i];
                if (!h) return stSbPrefabFallback(def, o);
                return stSbPrefabRange(h, stStr(h.name).split('.').pop(), o);
            });
        }

        // 预制块 build 时能用的那套小工具。**每次插入都新建一个** ——
        // 里面的 used 表是「这一次插入里已经绑过的变量」，跨次复用会让第二次插入
        // 全绑到兜底路径上（看着就像「自动绑定坏了」）
        function stSbPrefabApi() {
            const used = {};
            const api = {
                auto: 0,     // 真在卡里找到变量的槽数
                total: 0,    // 需要变量的槽数
                // 块工厂：bind 是 bind / many 的结果，extra 是这块自己的样式。
                // ⚠ 顺序是**先 extra、后 bind** —— 绑到的变量范围必须赢。
                //   反过来写（先 bind 后 extra）时踩过：星级预制块的 extra 里
                //   带了一句 `max: 5`（本来是给「没绑上」那条兜底路准备的），
                //   结果把变量自己的上限也一起盖掉了 —— 卡里 0~100 的好感度
                //   被压成 0~5，值 50 直接顶满，五个星永远全亮。
                //   要固定范围就往 bind 的兜底参数里写，别往 extra 里写
                blk: function (type, bind, extra) {
                    const b = stBlankSbBlock(type);
                    Object.keys(extra || {}).forEach(k => { b[k] = extra[k]; });
                    if (bind) {
                        b.path = stStr(bind.path);
                        b.label = stStr(bind.label);
                        if (bind.min !== undefined) b.min = bind.min;
                        if (bind.max !== undefined) b.max = bind.max;
                    }
                    return b;
                },
                row: function (kids, gap) {
                    const r = stBlankSbBlock('row');
                    r.children = kids || [];
                    if (gap !== undefined) r.gap = gap;
                    return r;
                },
                bind: function (keys, def, o) {
                    const opt = o || {};
                    opt.used = used;
                    const r = stSbPrefabBind(keys, def, opt);
                    api.total += 1;
                    if (r.auto) api.auto += 1;
                    return r;
                },
                many: function (keys, defs, o) {
                    const r = stSbPrefabBindMany(keys, defs, o || {});
                    r.forEach(x => { api.total += 1; if (x.auto) api.auto += 1; });
                    return r;
                },
                // 「随便挑一个还没用过的变量」—— 通用预制块（两列数值）用它
                free: function (num, label) {
                    const pool = stSbVarPaths().filter(p => num ? p.type === 'number'
                        : ST_MVU_CONTAINER.indexOf(p.type) < 0);
                    const hit = pool.filter(p => !used[p.path])[0] || null;
                    api.total += 1;
                    if (hit) {
                        used[hit.path] = true;
                        api.auto += 1;
                        return stSbPrefabRange(hit, stStr(hit.name).split('.').pop(), {});
                    }
                    return { path: '', label: stStr(label), min: 0, max: 100, auto: false };
                }
            };
            return api;
        }

        // 预制块的块列表 → 可插入的副本。走 stSbBlockFromRaw 过一遍白名单（挡坏数据、
        // 挡老版本存的残缺结构），再整棵子树换 id —— 同 id 会让选中 / 拖拽串味（同 stSbDupBlock）
        function stSbCloneBlocks(rawList) {
            const out = [];
            (rawList || []).forEach(raw => {
                // 跟 stSbUserPrefabs 同一条：不是对象就别当块（理由见那边）
                if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
                let copy = null;
                try { copy = stSbBlockFromRaw(JSON.parse(JSON.stringify(raw))); } catch (e) { copy = null; }
                if (!copy) return;
                const reid = n => { n.id = stUuid(); (n.children || []).forEach(reid); };
                reid(copy);
                out.push(copy);
            });
            return out;
        }

        // 加完说一句：几个变量是自动绑上的、几个还是兜底路径。
        // ⚠ 一定要说 —— 兜底路径在画布上**看起来完全正常**（示例值照样画得出来），
        //   用户不会知道它其实还没连上卡里的变量
        function stSbPrefabNote(name, n, api) {
            const t = api ? api.total : 0;
            const a = api ? api.auto : 0;
            let s = '✅ 已加入预制块「' + name + '」（' + n + ' 块）';
            if (t && a === t) s += '，变量都绑到了卡里现成的变量上';
            else if (t && a) s += '，' + a + '/' + t +
                ' 个变量绑上了现成的，其余是默认路径 —— 去 MVU 页建同名的变量就通了';
            else if (t) s += '，卡里还没有这些变量，路径先填了默认值 —— 去 MVU 页建一个同名的就通了';
            stExportMsg(s + '。', (!t || a === t) ? 'ok' : 'warn');
        }

        // 把预制块的块列表插进画布。插哪儿跟块库同一条规矩：
        // 选中分组 → 进那个分组，否则落根上
        function stSbPrefabInsert(blocks, name, api) {
            const c = stEditor.card;
            if (!c || !blocks || !blocks.length) return;
            const list = stSbCloneBlocks(blocks);
            if (!list.length) return;
            const sel = stSbSelected();
            const cid = (sel && stSbIsBox(sel.block)) ? sel.block.id : '';
            const hit = cid ? stSbLocate(cid) : null;
            if (hit && stSbIsBox(hit.block)) {
                Array.prototype.push.apply(hit.block.children, list);
                stEditor.sbOpen[hit.block.id] = true;
            } else {
                Array.prototype.push.apply(c.statusBar.blocks, list);
            }
            stEditor.sbSel = list[0].id;
            stSbSync();
            stSaveDraft();
            stRerender();
            stSbPrefabNote(name, list.length, api);
        }

        function stSbAddPrefab(i) {
            const p = ST_SB_PREFABS[Number(i)];
            if (!p || !stEditor.card) return;
            const api = stSbPrefabApi();
            let blocks = [];
            try { blocks = p.build(api) || []; } catch (e) { blocks = []; }
            if (!blocks.length) return;
            stSbPrefabInsert(blocks, p.name, api);
        }

        function stSbAddUserPrefab(id) {
            if (!stEditor.card) return;
            const it = stSbUserPrefabs().filter(x => x.id === String(id))[0];
            if (!it) return;
            // ⚠ 用户预制块里的路径**不再按关键词重绑** —— 他当初存的就是这一组，
            //   插进去自动改路径反而是「悄悄动了我的东西」
            stSbPrefabInsert(it.blocks, it.name, null);
        }

        // 名字那一格。⚠ 只写状态、**不重绘** —— 重绘会把光标从输入框里踢出去
        // （状态还是得存进 stEditor，否则别的动作一重绘这格就空了）
        function stSbPrefabNameSet(v) {
            stEditor.sbPfName = String(v == null ? '' : v).slice(0, 24);
        }

        // 给自存的预制块挑个图标：拿第一块的类型图标，比一律给个 ★ 有信息量
        function stSbPrefabIconOf(blocks) {
            const b = (blocks || [])[0];
            return (b && ST_SB_BLOCK_ICON[b.type]) || '★';
        }

        // 把画布上选中的那一块（连子树）存成用户预制块。
        // 没选中但画布非空 → 整张画布存进去；画布空 → 当面说一句，不静默
        function stSbPrefabSave() {
            const c = stEditor.card;
            if (!c) return;
            const name = String(stEditor.sbPfName || '').trim();
            const input = document.getElementById('st-sb-pf-name');
            if (!name) {
                stExportMsg('⚠ 先给预制块起个名字，再点「存为预制块」。', 'warn');
                if (input) { try { input.focus(); } catch (e) {} }
                return;
            }
            const sel = stSbSelected();
            let src = null;
            let what = '';
            if (sel) { src = [sel.block]; what = '选中的那块'; }
            else if (c.statusBar.blocks.length) { src = c.statusBar.blocks; what = '整张画布'; }
            if (!src || !src.length) {
                stExportMsg('⚠ 画布是空的，没东西可存 —— 先从块库 / 预制块加几块。', 'warn');
                return;
            }
            const list = stSbUserPrefabs();
            const dup = list.filter(it => it.name === name)[0];
            if (!dup && list.length >= ST_SB_PF_MAX) {
                stExportMsg('⚠ 预制块最多存 ' + ST_SB_PF_MAX + ' 个，先删掉几个。', 'warn');
                return;
            }
            // ⚠ 同名 = 覆盖，先问一句。「改一个已有的预制块」就是「重新存一遍同名」，
            //   不另开一个重命名入口 —— 少一个入口就少一处「到底改了哪个」的歧义
            if (dup && !window.confirm('已经有一个叫「' + name + '」的预制块。\n\n覆盖它吗？')) return;
            const blocks = stSbCloneBlocks(src);
            if (!blocks.length) {
                stExportMsg('⚠ 这块里没有能存下来的内容。', 'warn');
                return;
            }
            let bytes = 0;
            try { bytes = JSON.stringify(blocks).length; } catch (e) { bytes = 0; }
            if (bytes > ST_SB_PF_ITEM_BYTES) {
                stExportMsg('⚠ 这一块太大了（' + Math.round(bytes / 1024) + ' KB），单个预制块最多 ' +
                    Math.round(ST_SB_PF_ITEM_BYTES / 1024) + ' KB。', 'warn');
                return;
            }
            const item = {
                id: dup ? dup.id : ('p' + Date.now().toString(36) +
                    Math.floor(Math.random() * 1e6).toString(36)),
                name: name,
                icon: stSbPrefabIconOf(blocks),
                hint: '自己存的：' + what + '（' + blocks.length + ' 块）',
                blocks: blocks
            };
            const next = dup
                ? list.map(x => (x.id === dup.id ? item : x))
                : list.concat([item]);
            const r = stSbPfStore(next);
            if (!r.ok) {
                stExportMsg('⚠ 没存下来：' + r.why + '。', 'warn');
                return;
            }
            stEditor.sbPfName = '';
            stRerender();
            stExportMsg('✅ 已把' + what + '存成预制块「' + name + '」' +
                (dup ? '（覆盖了原来那个）' : '') + '，就在左边「我的预制块」里。', 'ok');
        }

        function stSbPrefabDel(id) {
            const list = stSbUserPrefabs();
            const it = list.filter(x => x.id === String(id))[0];
            if (!it) return;
            if (!window.confirm('删掉预制块「' + it.name + '」？\n\n' +
                '（只删掉这一份，画布上已经加进去的块不受影响）')) return;
            const r = stSbPfStore(list.filter(x => x.id !== String(id)));
            if (!r.ok) {
                stExportMsg('⚠ 没删掉：' + r.why + '。', 'warn');
                return;
            }
            stRerender();
            stExportMsg('🗑 已删掉预制块「' + it.name + '」。', 'ok');
        }

        // 预制块那一整段（分类 + 我的 + 存为预制块）。放在块库**上面** ——
        // 搭一张状态栏的常见动作是「先要一整组，再补两块」，不是从原子块开始拼
        function stSbPrefabHtml() {
            const groups = {};
            ST_SB_PREFABS.forEach((p, i) => {
                const cat = stStr(p.cat) || '通用';
                (groups[cat] = groups[cat] || []).push(
                    '<button class="st-mini" type="button" title="' + escapeHtml(p.hint || '') + '"' +
                    ' onclick="stSbAddPrefab(' + i + ')">' +
                    escapeHtml((p.icon || '★') + ' ' + p.name) + '</button>');
            });
            let h = '<div class="st-mvu-col-head" style="margin-top:10px">预制块' +
                ' <span class="st-hint-inline">一整组常用块，点一下加进画布</span></div>';
            ST_SB_PREFAB_CATS.forEach(cat => {
                const btns = groups[cat];
                if (!btns || !btns.length) return;
                h += '<div class="st-sb-pf-cat">' + escapeHtml(cat) + '</div>' +
                    '<div class="st-sb-palette">' + btns.join('') + '</div>';
            });
            const mine = stSbUserPrefabs();
            h += '<div class="st-sb-pf-cat">我的预制块' +
                ' <span class="st-hint-inline">存在本机浏览器里，换张卡也在</span></div>';
            h += mine.length
                ? '<div class="st-sb-palette">' + mine.map(it =>
                    '<span class="st-sb-pf-item">' +
                        '<button class="st-mini" type="button" title="' +
                            escapeHtml(it.hint || '') + '"' +
                            ' onclick="stSbAddUserPrefab(\'' + it.id + '\')">' +
                            escapeHtml((it.icon || '★') + ' ' + it.name) + '</button>' +
                        '<button class="st-mini st-danger" type="button" title="删掉这个预制块"' +
                            ' onclick="stSbPrefabDel(\'' + it.id + '\')">✕</button>' +
                    '</span>').join('') + '</div>'
                : '<div class="st-hint">还没有。选中画布上的一块（或者什么都不选 = 整张画布），' +
                    '在下面填个名字就能存成自己的预制块。</div>';
            h += '<div class="st-sb-pf-save">' +
                '<input id="st-sb-pf-name" type="text" maxlength="24"' +
                ' placeholder="新预制块的名字"' +
                ' value="' + escapeHtml(stEditor.sbPfName || '') + '"' +
                ' oninput="stSbPrefabNameSet(this.value)">' +
                '<button class="st-mini" type="button" onclick="stSbPrefabSave()">' +
                    '＋ 存为预制块</button>' +
                '</div>' +
                stSbAiRowHtml();
            return h;
        }

