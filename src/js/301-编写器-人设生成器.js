        // ==========================================================================
        // 编写器 · 人设生成器
        //
        // 写一句设定，让 AI 按一份**模板**逐项填好，生成一整份人设。
        //
        // 三个设计决定：
        // ① 模板**可改、可存多份、存浏览器本地**，**不写进卡** ——
        //    跟 AI 配置同一条理由：它是用户自己的偏好，不是角色卡的一部分。
        //    第三十六轮起从「一份」变成「一套」：内置一份 + 用户自己命名的多份，下拉切换。
        // ② 生成结果**不自动进卡**。先在预览格里给你看、可以手改，点「写入」才进角色描述 ——
        //    「生成的东西必须先能反悔」，跟「AI 生成预制块」同一条规矩。
        // ③ 写入前如果角色描述非空，**弹 confirm**。覆盖别人手写的内容是这一族里最不可逆的
        //    动作，不能静默做；追加那条路不用问（它不破坏已有内容）。
        // ==========================================================================

        // —— 模板库（第三十六轮；第三十七轮扩成「四份内置」）——
        // 存储布局：
        //   stPersonaTplDefOv   —— 内置模板的**改动**，JSON `{ id: body }`（没这个键 = 一份都没改过）
        //   stPersonaTpls       —— 自定义模板库，JSON `[{id,name,body}]`
        //   stPersonaTplId      —— 当前选中的 id（`'builtin'` / `'builtin:1'`… / 某个自定义 id）
        //   stPersonaTplDefault —— ⚠ 第三十六轮的单份覆盖键，**只当迁移来源**
        //   stPersonaTpl        —— ⚠ 更旧的单模板键，**只当迁移来源**
        //
        // ⚠ 为什么内置模板**也能改**：在它还是「唯一的那份模板」的年代，用户改完是要留着的。
        //   一升级就把它锁成只读，等于把老用户手上的自定义模板判死。所以它可改、改动落盘，
        //   只是**名字固定、删不掉**；「恢复默认模板」= 清掉这份改动。
        const ST_PERSONA_TPL_KEY = 'stPersonaTpl';
        const ST_PERSONA_TPL_DEF_KEY = 'stPersonaTplDefault';
        const ST_PERSONA_TPL_DEF_OV_KEY = 'stPersonaTplDefOv';
        const ST_PERSONA_TPLS_KEY = 'stPersonaTpls';
        const ST_PERSONA_TPL_ID_KEY = 'stPersonaTplId';
        // ⚠ 内置模板的**身份**（`ST_PERSONA_TPL_BUILTIN` / `_NAME`）和**四份模板的正文**
        //   都在 `300b` 那个模块里 —— 它在拼装顺序上排在本模块前面，这里直接用。
        // 名字长度 / 模板份数上限。超了**说出来**，不静默丢（六之三十五）
        const ST_PERSONA_TPL_NAME_MAX = 20;
        const ST_PERSONA_TPL_LIB_MAX = 20;
        const ST_PERSONA_REQ_MAX = 2000;
        const ST_PERSONA_TPL_MAX = 8000;
        const ST_PERSONA_OUT_MAX = 20000;
        // 「参考素材」（世界书条目）的总字符预算。跟上面三条不是一回事：
        // 那三条限的是**用户自己敲的字**，这条限的是**从书里搬来的正文** ——
        // 勾 30 条 2000 字的条目就是 6 万字，直接把这轮上下文吃光。
        // 超了不报错，是**少喂几条并说出来**（见 stPersonaLoreResolve 的 truncated）
        const ST_PERSONA_LORE_MAX = 12000;

        // 四份内置模板的正文和清单在 `300b`（`ST_PERSONA_TPLS_BUILTIN`）——
        // 这个模块只管**逻辑**：选中哪份、改了什么、怎么存、怎么迁移。

        // —— localStorage 小工具 ——
        // 一律 try/catch：隐私模式 / 配额满的时候这几个 API 会**抛**，
        // 抛到渲染路径上就是「整个编写器打不开」
        function stPersonaLsGet(k) {
            try { return localStorage.getItem(k); } catch (e) { return null; }
        }
        function stPersonaLsSet(k, v) {
            try { localStorage.setItem(k, v); return true; } catch (e) { return false; }
        }

        // 新模板的 id。**必须唯一**：撞了之后两份模板会共用一个 id，
        // 切换 / 删除 / 改名全部作用到错的那一份上
        function stPersonaTplNewId(arr) {
            let id = '';
            do {
                id = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            } while ((arr || []).some(t => t.id === id));
            return id;
        }

        // 起名字撞车时自动加后缀：迁移时可能已经有「我的模板」了
        function stPersonaTplFreeName(arr, base) {
            let name = base;
            let n = 2;
            while ((arr || []).some(t => t.name === name)) {
                name = base + ' ' + n;
                n++;
            }
            return name.slice(0, ST_PERSONA_TPL_NAME_MAX);
        }

        function stPersonaTplLibSave(arr) {
            stEditor.personaTpls = arr;
            stPersonaLsSet(ST_PERSONA_TPLS_KEY, JSON.stringify(arr));
        }

        // 自定义模板库。**懒加载 + 一次性迁移**：
        // 老版本只有一个 `stPersonaTpl` 字符串，第一次跑新代码时把它收成一份叫
        // 「我的模板」的模板并选中 —— 老用户手上的自定义内容不能丢。
        // ⚠ 老键**不删**：万一回退到旧版本，内容还在（删了就是单向的门）。
        function stPersonaTplLib() {
            if (Array.isArray(stEditor.personaTpls)) return stEditor.personaTpls;
            const raw = stPersonaLsGet(ST_PERSONA_TPLS_KEY);
            let arr = null;
            if (typeof raw === 'string') {
                try {
                    const p = JSON.parse(raw);
                    if (Array.isArray(p)) arr = p;
                } catch (e) {}
            }
            // ⚠ 「键不存在」才算没迁移过 —— 空数组是用户把模板都删光了，
            //   这时候再拿老键迁移一次，删掉的模板会**自己长回来**
            const migrated = arr === null;
            // 形状校验：坏条目**丢掉**，不是整库清空（一条手改坏不该毁掉另外九条）
            arr = (arr || []).map(it => ({
                id: String((it && it.id) || ''),
                name: String((it && it.name) || '').slice(0, ST_PERSONA_TPL_NAME_MAX),
                body: String((it && it.body) || '').slice(0, ST_PERSONA_TPL_MAX)
            })).filter(it => it.id && it.name);
            if (migrated) {
                const old = stPersonaLsGet(ST_PERSONA_TPL_KEY);
                // 跟默认一字不差的「自定义」没有信息量，不迁移
                if (typeof old === 'string' && old.trim() && old !== ST_PERSONA_TPL_DEFAULT) {
                    const id = stPersonaTplNewId(arr);
                    arr.push({
                        id: id,
                        name: stPersonaTplFreeName(arr, '我的模板'),
                        body: old.slice(0, ST_PERSONA_TPL_MAX)
                    });
                    stPersonaTplLibSave(arr);
                    stPersonaLsSet(ST_PERSONA_TPL_ID_KEY, id);
                }
            }
            stEditor.personaTpls = arr;
            return arr;
        }

        // —— 内置模板的「改动」（覆盖）——
        // 四份内置模板都能改，改动存成**一张表** `{ 'builtin': body, 'builtin:1': body }`，
        // 不是「每份一个键」：键名是要背下来的东西，加一份模板就要多记一个。
        // ⚠ 第三十六轮那个单份键 `stPersonaTplDefault` 只当**迁移来源**：读到就搬进表里的
        //   `'builtin'`，旧键**不删**（回退旧版本时内容还在）。
        // ⚠ 判「迁移过没有」看的是**新键在不在**，不是表里有没有 `'builtin'` ——
        //   后者会让用户「恢复默认」之后，下次打开又从旧键里搬回来（删不掉）。
        function stPersonaTplOv() {
            if (stEditor.personaTplOv && typeof stEditor.personaTplOv === 'object') {
                return stEditor.personaTplOv;
            }
            const raw = stPersonaLsGet(ST_PERSONA_TPL_DEF_OV_KEY);
            const map = {};
            let hadNew = false;
            if (typeof raw === 'string') {
                hadNew = true;
                try {
                    const p = JSON.parse(raw);
                    if (p && typeof p === 'object' && !Array.isArray(p)) {
                        Object.keys(p).forEach(k => {
                            if (typeof p[k] === 'string' && p[k].trim()) map[k] = p[k];
                        });
                    }
                } catch (e) {}
            }
            if (!hadNew) {
                const old = stPersonaLsGet(ST_PERSONA_TPL_DEF_KEY);
                if (typeof old === 'string' && old.trim() &&
                    old.trim() !== stPersonaTplBuiltinBody(ST_PERSONA_TPL_BUILTIN)) {
                    map[ST_PERSONA_TPL_BUILTIN] = old;
                    stPersonaTplOvSave(map);
                }
            }
            stEditor.personaTplOv = map;
            return map;
        }

        function stPersonaTplOvSave(map) {
            stEditor.personaTplOv = map;
            stPersonaLsSet(ST_PERSONA_TPL_DEF_OV_KEY, JSON.stringify(map));
        }

        // 内置模板里 id 匹配的那一份（**出厂定义**，不含改动）。没有 = 不是内置
        function stPersonaTplBuiltin(id) {
            const s = String(id == null ? '' : id);
            return ST_PERSONA_TPLS_BUILTIN.filter(b => b.id === s)[0] || null;
        }

        // 内置模板的**出厂正文**（不看覆盖）。没这份就返回 null
        function stPersonaTplBuiltinBody(id) {
            const b = stPersonaTplBuiltin(id);
            return b ? b.body : null;
        }

        // 这个名字是不是被**内置模板**占了（四份都算）—— 自定义模板不许重名，
        // 内置的更不能（不然下拉里两个「精简人设」，一个删不掉、一个能删）
        function stPersonaTplBuiltinNameTaken(name) {
            const n = String(name == null ? '' : name).trim();
            return ST_PERSONA_TPLS_BUILTIN.some(b => b.name === n);
        }

        // 当前选中的模板 id。**要校验**：id 指向的模板不在了（被删 / 库被手改过 /
        // 内置那份被改过 id）就回落第一份内置 —— 否则面板会显示一份空模板，
        // 而用户以为那是「默认」
        function stPersonaTplId() {
            const lib = stPersonaTplLib();
            let id = stPersonaLsGet(ST_PERSONA_TPL_ID_KEY);
            if (typeof id !== 'string' || !id) id = ST_PERSONA_TPL_BUILTIN;
            if (!stPersonaTplBuiltin(id) && !lib.some(t => t.id === id)) {
                id = ST_PERSONA_TPL_BUILTIN;
            }
            return id;
        }

        // 切到某个 id。传进来的 id 不存在时**回落第一份内置**，并把真正生效的那个返回
        function stPersonaTplIdSet(id) {
            const s = String(id == null ? '' : id);
            const ok = !!stPersonaTplBuiltin(s) || stPersonaTplLib().some(t => t.id === s);
            const real = ok ? s : ST_PERSONA_TPL_BUILTIN;
            stPersonaLsSet(ST_PERSONA_TPL_ID_KEY, real);
            return real;
        }

        // 某个 id 是不是内置的（四份里的一份）。不传 = 当前选中的
        function stPersonaTplIsBuiltin(id) {
            return !!stPersonaTplBuiltin(id == null ? stPersonaTplId() : id);
        }

        // 按 id 取那一份（内置 / 自定义都认），统一形状 `{ id, name, body, builtin }`。
        // ⚠ 内置那份返回的是**副本**，别拿它当「能直接改的库条目」——
        //   改内置要走 `stPersonaTplOv()`，改库条目走 `stPersonaTplLib()`
        function stPersonaTplFind(id) {
            const s = String(id == null ? '' : id);
            const b = stPersonaTplBuiltin(s);
            if (b) return { id: b.id, name: b.name, body: stPersonaTplBody(b.id), builtin: true };
            const t = stPersonaTplLib().filter(x => x.id === s)[0];
            return t ? { id: t.id, name: t.name, body: t.body, builtin: false } : null;
        }

        // 某个 id 的模板名字。不传 = 当前选中的那份
        function stPersonaTplName(id) {
            const t = stPersonaTplFind(id == null ? stPersonaTplId() : id);
            return t ? t.name : ST_PERSONA_TPL_BUILTIN_NAME;
        }

        // 给下拉用的清单：**内置的全排前面**（顺序 = `300b` 那个数组的顺序），
        // 第一份是历史那份「默认模板」—— 没选过的人落在它上面
        function stPersonaTplList() {
            return ST_PERSONA_TPLS_BUILTIN.map(b => ({ id: b.id, name: b.name, builtin: true }))
                .concat(stPersonaTplLib().map(t => ({ id: t.id, name: t.name, builtin: false })));
        }

        // 某个 id 的模板正文（直接从存储算，不碰内存工作副本）。
        // 内置那份 = 覆盖值，没有覆盖就是出厂正文
        function stPersonaTplBody(id) {
            const s = String(id == null ? '' : id);
            const b = stPersonaTplBuiltin(s);
            if (b) {
                const ov = stPersonaTplOv()[s];
                return (typeof ov === 'string' && ov.trim()) ? ov : b.body;
            }
            const t = stPersonaTplLib().filter(x => x.id === s)[0];
            return t ? t.body : ST_PERSONA_TPL_DEFAULT;
        }

        // 懒加载：只有「没读过」才去读存储。
        // 内置那份：空串 = 没改过 ⇒ 用默认（所以清空模板 = 回到默认，不是「用空模板」）
        function stPersonaTpl() {
            const id = stPersonaTplId();
            if (typeof stEditor.personaTpl !== 'string') {
                stEditor.personaTpl = stPersonaTplBody(id);
            }
            // ⚠ 内置那份在内存里是空串时也要**回落它自己的出厂正文**。用户把框清空 →
            //   覆盖键删了，但内存里留下一个 ''；原样返回它，面板上会同时出现三种互相矛盾
            //   的说法：标签说「没改过」、框里是空的、点生成又报「模板是空的」。
            //   回落之后三者一致 —— 这也正是 hint 承诺的那句「清空 = 恢复这份内置内容」。
            if (stPersonaTplBuiltin(id)) {
                return stEditor.personaTpl.trim() ? stEditor.personaTpl : stPersonaTplBody(id);
            }
            // ⚠ 自定义那份**空就是空**：那是用户自己存的模板，空着要在生成时报错，
            //   不能悄悄换成默认模板（换了就永远看不到「模板是空的」那句）
            return stEditor.personaTpl;
        }

        // 「选中的这份内置模板**没被改过**」—— 面板上「· 已改」那个标记靠它。
        // 自定义那份永远 false（它本来就不是「内置」）。
        // ⚠ 判据问**存储**（有没有覆盖），不拿当前内容跟常量比：用户把模板改得跟出厂
        //   一模一样时，两种说法都没错，但**显示要跟存储一致**
        function stPersonaTplIsDefault() {
            const id = stPersonaTplId();
            if (!stPersonaTplBuiltin(id)) return false;
            const ov = stPersonaTplOv()[id];
            return !(typeof ov === 'string' && ov.trim());
        }

        // 「模板名字」输入框的草稿。**会话级、不落盘**：它只在「另存为 / 改名」那一刻被读。
        // 空着 = 跟着当前模板的名字走（所以切换模板时不用额外清）
        function stPersonaTplNameDraft() {
            const d = String(stEditor.personaTplName == null ? '' : stEditor.personaTplName).trim();
            return (d || stPersonaTplName()).slice(0, ST_PERSONA_TPL_NAME_MAX);
        }

        function stPersonaTplNameSet(v) {
            stEditor.personaTplName = String(v == null ? '' : v).slice(0, ST_PERSONA_TPL_NAME_MAX);
        }

        function stPersonaReqSet(v) {
            stEditor.personaReq = String(v == null ? '' : v).slice(0, ST_PERSONA_REQ_MAX);
        }

        // 「要不要把这张卡的名字当人物姓名」。默认开。
        // ⚠ 判据写成 `!== false` 而不是 `=== true` —— 没这个键的旧状态也按「开」算。
        //   写成 `=== true` 的话，升级上来的用户会突然发现卡名不再喂给 AI 了：
        //   一个**静默的行为变化**，而面板上那个勾选框照样显示「勾着」。
        function stPersonaNameUse() {
            return stEditor.personaNameUse !== false;
        }

        function stPersonaNameUseSet(v) {
            stEditor.personaNameUse = v !== false;
        }

        function stPersonaOutSet(v) {
            stEditor.personaOut = String(v == null ? '' : v).slice(0, ST_PERSONA_OUT_MAX);
        }

        function stPersonaTplSet(v) {
            const s = String(v == null ? '' : v).slice(0, ST_PERSONA_TPL_MAX);
            stEditor.personaTpl = s;
            const id = stPersonaTplId();
            if (stPersonaTplBuiltin(id)) {
                // ⚠ 清空时**删掉这个 id 的覆盖**而不是存空串 —— 存了空串，
                //   「是不是改过」就再也分不出来，下次打开会显示一份空模板，
                //   而 AI 那边等于没模板可用
                const map = stPersonaTplOv();
                if (!s.trim()) {
                    if (!(id in map)) return;
                    delete map[id];
                } else {
                    if (map[id] === s) return;
                    map[id] = s;
                }
                stPersonaTplOvSave(map);
                return;
            }
            // 自定义模板：**边改边存**。跟老版本「改了就留着」一致 ——
            //   多一步「保存」只会让用户丢东西（切走 / 刷新之前忘了点）
            const lib = stPersonaTplLib();
            const t = lib.filter(x => x.id === id)[0];
            if (!t || t.body === s) return;
            t.body = s;
            stPersonaTplLibSave(lib);
        }

        // 切模板。**先把当前这份存好**（自定义的是边改边存，所以这里不用补），
        // 再把工作副本换成目标那份
        function stPersonaTplPick(id) {
            const real = stPersonaTplIdSet(id);
            stEditor.personaTpl = stPersonaTplBody(real);
            stEditor.personaTplName = '';
            stRerender();
            stExportMsg('✅ 已切到模板「' + stPersonaTplName(real) + '」（' +
                stPersonaLabels(stPersonaTpl()).length + ' 项）。', 'ok', 'persona');
        }

        // 把当前内容存成**新的一份**，名字取「模板名字」那一格
        function stPersonaTplSaveAs() {
            const body = String(stPersonaTpl() || '');
            if (!body.trim()) {
                stExportMsg('⚠ 模板是空的 —— 写点东西再存。', 'warn', 'persona');
                return;
            }
            const name = stPersonaTplNameDraft();
            // ⚠ 内置的**四份**名字都不能占用（第三十七轮起内置不止一份）——
            //   不然下拉里会出现两个「精简人设」，一个是内置的、一个是自己的
            if (!name || stPersonaTplBuiltinNameTaken(name)) {
                stExportMsg('⚠ 先给这份模板起个名字（「模板名字」那一格），别用内置模板的名字。',
                    'warn', 'persona');
                const el = document.getElementById('st-persona-tpl-name');
                if (el) { try { el.focus(); el.select(); } catch (e) {} }
                return;
            }
            const lib = stPersonaTplLib();
            if (lib.length >= ST_PERSONA_TPL_LIB_MAX) {
                stExportMsg('⚠ 模板最多存 ' + ST_PERSONA_TPL_LIB_MAX +
                    ' 份（现在满了）—— 先删掉一份再存。', 'warn', 'persona');
                return;
            }
            if (lib.some(t => t.name === name)) {
                stExportMsg('⚠ 已经有一份叫「' + name + '」的模板了 —— 换个名字，' +
                    '或者先删掉那份。', 'warn', 'persona');
                return;
            }
            const id = stPersonaTplNewId(lib);
            lib.push({ id: id, name: name, body: body.slice(0, ST_PERSONA_TPL_MAX) });
            stPersonaTplLibSave(lib);
            stPersonaTplIdSet(id);
            stEditor.personaTplName = '';
            stRerender();
            stExportMsg('✅ 已存成新模板「' + name + '」（' +
                stPersonaLabels(body).length + ' 项）—— 以后在「当前模板」里切换。', 'ok', 'persona');
        }

        // 改当前这份的名字。内置四份的名字都是固定的（它们是「出厂」那几份）
        function stPersonaTplRename() {
            const id = stPersonaTplId();
            if (stPersonaTplBuiltin(id)) {
                stExportMsg('⚠ 内置模板的名字固定是「' + stPersonaTplName(id) +
                    '」—— 想改名，先「另存为新模板」。', 'warn', 'persona');
                return;
            }
            const name = stPersonaTplNameDraft();
            if (!name || stPersonaTplBuiltinNameTaken(name)) {
                stExportMsg('⚠ 名字不能是空的，也不能用内置模板的名字。', 'warn', 'persona');
                const el = document.getElementById('st-persona-tpl-name');
                if (el) { try { el.focus(); el.select(); } catch (e) {} }
                return;
            }
            const lib = stPersonaTplLib();
            // ⚠ 改的必须是**库里那条**，不是 `stPersonaTplFind` 给的副本 ——
            //   第三十七轮把 `stPersonaTplFind` 改成「内置 / 自定义统一返回 `{id,name,body,builtin}`」，
            //   于是它给自定义那份也返回一个新对象：改副本的名字，库里那条纹丝不动，
            //   而且 `stPersonaTplLibSave` 照样把**旧的**写回去 —— 改名**静默失效**，
            //   界面不报错、下次打开还是老名字（套件的「改名生效」那条抓到的就是这个）
            const entry = lib.filter(x => x.id === id)[0];
            if (!entry) return;
            if (lib.some(x => x.id !== id && x.name === name)) {
                stExportMsg('⚠ 已经有一份叫「' + name + '」的模板了 —— 换个名字。', 'warn', 'persona');
                return;
            }
            entry.name = name;
            stPersonaTplLibSave(lib);
            stEditor.personaTplName = '';
            stRerender();
            stExportMsg('✅ 模板改名为「' + name + '」。', 'ok', 'persona');
        }

        // 删掉当前这份。内置四份都删不掉；删的正是选中的那份 ⇒ 回到第一份内置
        function stPersonaTplDrop() {
            const id = stPersonaTplId();
            if (stPersonaTplBuiltin(id)) {
                stExportMsg('⚠ 内置模板删不掉 —— 想清掉改动点「恢复默认模板」。', 'warn', 'persona');
                return;
            }
            const t = stPersonaTplFind(id);
            if (!t) return;
            // 删模板是**不可逆**的（内容跟着没了），跟「覆盖角色描述」同一档，必须问一句
            if (!window.confirm('删掉模板「' + t.name + '」？\n\n' +
                '这份内容会一起没，删了找不回来。')) return;
            const lib = stPersonaTplLib().filter(x => x.id !== id);
            stPersonaTplLibSave(lib);
            stPersonaTplIdSet(ST_PERSONA_TPL_BUILTIN);
            stEditor.personaTpl = stPersonaTplBody(ST_PERSONA_TPL_BUILTIN);
            stEditor.personaTplName = '';
            stRerender();
            stExportMsg('✅ 已删掉模板「' + t.name + '」，回到「' +
                ST_PERSONA_TPL_BUILTIN_NAME + '」。', 'ok', 'persona');
        }

        // 「恢复默认模板」—— 把**当前这份内置**的改动清掉，回到它的出厂正文。
        // 选中的是自定义模板时，先回到第一份内置（老语义：这个按钮就是「回到出厂」）。
        // ⚠ 只清**这一份**的覆盖，不是清整张表 —— 用户改了「精简人设」之后点这个按钮，
        //   不该把「fate人设」的改动也一起清掉
        function stPersonaTplReset() {
            const id = stPersonaTplIdSet(stPersonaTplIsBuiltin()
                ? stPersonaTplId() : ST_PERSONA_TPL_BUILTIN);
            const map = stPersonaTplOv();
            if (id in map) {
                delete map[id];
                stPersonaTplOvSave(map);
            }
            stEditor.personaTpl = stPersonaTplBody(id);
            stEditor.personaTplName = '';
            stRerender();
            stExportMsg('✅ 模板「' + stPersonaTplName(id) + '」已恢复默认内容（' +
                stPersonaLabels(stEditor.personaTpl).length + ' 项）。', 'ok', 'persona');
        }

        // 折叠态写进 DOM 的**唯一**一处 —— 跟 stSyncTabsCollapsed 同一个理由：
        // 容器上的 class 和展开键上的箭头分两处写，漏掉任何一处的症状都是「状态不对」。
        //
        // ⚠ 这里**不调 stRerender()**：重绘会把整个 pane 重建，新元素一出生就带着最终样式，
        //   `grid-template-rows` 的过渡**没有起点**，动画直接跳掉（看起来像根本没做折叠）。
        //   只改 class，让浏览器自己补间；状态照样记在 stEditor 里，下次重绘能还原。
        function stSyncPersonaTplOpen() {
            const on = stEditor.personaTplOpen === true;
            const box = document.getElementById('st-persona-tpl-fold');
            if (box) box.classList.toggle('st-fold-open', on);
            const btn = document.getElementById('st-persona-tpl-toggle');
            if (btn) btn.setAttribute('aria-expanded', on ? 'true' : 'false');
        }

        function stPersonaTplToggle() {
            stEditor.personaTplOpen = !(stEditor.personaTplOpen === true);
            stSyncPersonaTplOpen();
        }

        // 从模板里数出「有哪些字段」——只认**以冒号结尾**的行（模板是空稿，值还没填）。
        // 两个用途：① 面板上显示「N 项」；② 生成完拿它数「模型漏了几项」
        function stPersonaLabels(tpl) {
            const out = [];
            String(tpl || '').split('\n').forEach(line => {
                const m = line.match(/^[\s\-]*([^:：\n]{1,12})[:：]\s*$/);
                if (!m) return;
                const k = m[1].trim();
                if (k && out.indexOf(k) < 0) out.push(k);
            });
            return out;
        }

        function stPersonaSysPrompt() {
            return [
                '你是角色卡「人设」写手。用户会给你一个设定或要求，你按**用户给的模板**逐项填好，',
                '输出一整份人设。',
                '',
                '## 硬规则',
                '1. **只输出填好的人设本身**。不要解释、不要寒暄、不要 ``` 围栏、不要重复模板以外的标题。',
                '2. **严格照模板的结构和顺序**：模板里每一行都要保留，内容接在原来的冒号后面。',
                '   形如 `姓名:` 的行 → `姓名: 艾莉丝`；以 `- ` 开头的子项**保持缩进和顺序**。',
                '3. 模板里**没有**的字段不要自己加。用户没提到的细节你来补，但要**跟用户给的设定一致**。',
                '4. 每一格都要写实：外貌 / 衣着那几项给具体的颜色、材质、款式，',
                '   别写「普通」「随意」「看情况」这种空话；身高 / 三围这类数值给具体数字，别写「未知」。',
                '5. 用中文。语气克制，不要对用户说话、不要加点评。',
                '6. 整份长度控制在 1200 字以内。'
            ].join('\n');
        }

