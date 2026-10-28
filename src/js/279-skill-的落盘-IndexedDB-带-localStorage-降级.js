        // ===== skill 的落盘：IndexedDB，带 localStorage 降级 =====
        // 当前实际在用的后端（'idb' / 'ls'）。⚠ **必须记住** —— 不记的话会出现
        // 「写走 IndexedDB、读走 localStorage」这种半截状态，表现是「导入成功、
        // 刷新就没了」，而且两边都不报错
        let stCodeSkillBackend = '';
        let stCodeSkillWhy = '';   // 降级 / 失败的原因，用来拼给用户看的那句话

        // 打开库。⚠ 有些环境（隐私模式 / 被策略禁掉）既不 onsuccess 也不 onerror，
        //   会一直挂着 —— 所以自己加超时，超时就当「没有 IndexedDB」
        function stCodeIdbOpen() {
            return new Promise((res, rej) => {
                let req;
                try {
                    if (typeof indexedDB === 'undefined' || !indexedDB) {
                        rej(new Error('这个环境没有 IndexedDB')); return;
                    }
                    req = indexedDB.open(ST_CODE_IDB_NAME, 1);
                } catch (e) { rej(e); return; }
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains(ST_CODE_IDB_STORE)) {
                        db.createObjectStore(ST_CODE_IDB_STORE);
                    }
                };
                req.onsuccess = () => res(req.result);
                req.onerror = () => rej(req.error || new Error('打不开'));
                req.onblocked = () => rej(new Error('被另一个标签页占着'));
                setTimeout(() => rej(new Error('打开超时')), ST_CODE_IDB_MS);
            });
        }

        // 一次 kv 操作。⚠ 每次开完就 close —— 长连接占着库会让「另一个标签页想升级版本」
        //   永远 blocked，那种卡住是没有任何提示的
        function stCodeIdbOp(mode, fn) {
            return stCodeIdbOpen().then(db => new Promise((res, rej) => {
                let tx, out;
                const done = () => { try { db.close(); } catch (e) {} };
                try {
                    tx = db.transaction(ST_CODE_IDB_STORE, mode);
                    const r = fn(tx.objectStore(ST_CODE_IDB_STORE));
                    if (r) r.onsuccess = () => { out = r.result; };
                } catch (e) { done(); rej(e); return; }
                tx.oncomplete = () => { done(); res(out); };
                tx.onerror = () => { done(); rej(tx.error || new Error('事务失败')); };
                tx.onabort = () => { done(); rej(tx.error || new Error('事务中断')); };
            }));
        }

        function stCodeSkillReadLs() {
            try {
                const k = JSON.parse(localStorage.getItem(ST_CODE_SKILL_KEY) || 'null');
                return (k && Array.isArray(k.list)) ? k.list : null;
            } catch (e) { return null; }
        }

        // 把落盘的原始数据收进内存。字段要和 stCodeSkillFromText 产出的**形状一致**，
        // 老数据缺什么就补什么（这里少补一个，后面某处 .length 就会炸）
        function stCodeSkillAdopt(list) {
            if (!Array.isArray(list)) return;
            stCode.skills = list
                .filter(x => x && typeof x === 'object' && x.name)
                .map(x => ({
                    name: String(x.name),
                    desc: String(x.desc || ''),
                    body: String(x.body || ''),
                    file: String(x.file || ''),
                    // 触发词。老数据没有这个字段 → 空数组，匹配时退回用 name 兜底
                    triggers: Array.isArray(x.triggers)
                        ? x.triggers.map(t => String(t)).filter(t => t) : [],
                    // 老数据没有 kind → 一律当「知识」（那时候只有这一种）。
                    // ⚠ tool 丢了的话它会退回成知识型：正文被当说明书塞进 system，
                    //   工具表里却没有它 —— 模型能看见说明书、找不到工具
                    kind: ST_CODE_SKILL_KINDS.indexOf(x.kind) >= 0 ? x.kind : 'knowledge',
                    tool: (x.kind === 'tool' && x.tool && typeof x.tool === 'object')
                        ? { name: String(x.tool.name || ''),
                            desc: String(x.tool.desc || ''),
                            params: (x.tool.params && typeof x.tool.params === 'object')
                                ? x.tool.params : { type: 'object', properties: {} },
                            perm: Array.isArray(x.tool.perm) ? x.tool.perm.map(p => String(p)) : [] }
                        : null
                }));
        }

        function stCodeSkillClearLs() {
            try {
                localStorage.removeItem(ST_CODE_SKILL_KEY);
                localStorage.removeItem(ST_CODE_SKILL_LS_DIRTY);
            } catch (e) {}
        }

        // 写 localStorage 这条降级路。⚠ 顺手打上「降级标记」—— 见 ST_CODE_SKILL_LS_DIRTY
        function stCodeSkillWriteLs(payload) {
            stCodeSkillBackend = 'ls';
            try {
                localStorage.setItem(ST_CODE_SKILL_KEY, JSON.stringify(payload));
                localStorage.setItem(ST_CODE_SKILL_LS_DIRTY, '1');
                return true;
            } catch (e) {
                stCodeSkillWhy = 'localStorage 配额满了';
                return false;
            }
        }

        // 写 skill 列表。**只写一处** —— 后端由 stCodeSkillBackend 决定，不两边都写。
        // 两边都写迟早会分叉，而分叉之后没人知道该信哪边
        function stCodeSkillWrite(payload) {
            if (stCodeSkillBackend === 'ls') return Promise.resolve(stCodeSkillWriteLs(payload));
            return stCodeIdbOp('readwrite', s => s.put(payload, 'skills'))
                .then(() => {
                    stCodeSkillBackend = 'idb';
                    stCodeSkillClearLs();   // 迁过来了，老键留着只会误导下一次读取
                    return true;
                })
                .catch(e => {
                    stCodeSkillWhy = 'IndexedDB ' + ((e && e.message) || e);
                    return stCodeSkillWriteLs(payload);
                });
        }

        // 启动时读一次（真正的实现，只被 stCodeSkillsLoad 包着调）
        function stCodeSkillsLoadOnce() {
            let dirty = false;
            try { dirty = localStorage.getItem(ST_CODE_SKILL_LS_DIRTY) === '1'; } catch (e) {}
            // ⚠ 上一次降级写过 localStorage → 那份才是新的，以它为准迁进 IndexedDB。
            //   顺序不能反：**先写成功再清老键**。反过来的话写失败就等于把用户的
            //   skill 全删了，而且是静默的
            const migrate = () => {
                const old = stCodeSkillReadLs();
                if (!old) return Promise.resolve(false);
                return stCodeSkillWrite({ v: 1, list: old }).then(ok => {
                    if (ok) stCodeSkillAdopt(old);
                    return ok;
                });
            };
            if (dirty) {
                return migrate().catch(() => false);
            }
            return stCodeIdbOp('readonly', s => s.get('skills'))
                .then(v => {
                    stCodeSkillBackend = 'idb';
                    if (v && Array.isArray(v.list)) {
                        stCodeSkillAdopt(v.list);
                        stCodeSkillClearLs();
                        return true;
                    }
                    return migrate();   // IndexedDB 还是空的 → 把老数据搬过来
                })
                .catch(e => {
                    stCodeSkillWhy = 'IndexedDB ' + ((e && e.message) || e);
                    stCodeSkillBackend = 'ls';
                    const old = stCodeSkillReadLs();
                    if (old) stCodeSkillAdopt(old);
                    return false;
                });
        }

        // 「没存进去」统一一句话 —— 两处（导入的收尾提示 / 异步失败回调）必须是同一句，
        // 否则用户会以为是两个不同的问题
        function stCodeSkillFailText() {
            return '⚠ skill 没能存进本机（' + (stCodeSkillWhy || '浏览器不给存') +
                '）—— 这次导入的刷新后会丢。';
        }

        // 所有 skill 存储操作排成**一条链**。
        // ⚠ 不排的话「启动时那次读」和「导入时那次写」会互相插队：读回来的旧列表
        //   可能盖掉刚导入的那份，而两边都不报错 —— 表现是「导入成功、刷新就没了」
        let stCodeSkillQ = Promise.resolve();
        function stCodeSkillChain(fn) {
            const next = stCodeSkillQ.then(fn, fn);
            stCodeSkillQ = next.then(() => {}, () => {});
            return next;
        }

        let stCodeSkillsLoaded = false;
        let stCodeSkillsLoading = null;

        // 读一次（每个页面生命周期只读一次）。**返回 Promise<boolean>**（是否读到东西）。
        // ⚠ 记忆化：打开编辑器 / 开始发消息两个入口都会调它，不能各读一次 ——
        //   第二次读回来的会盖掉第一次之后导入的东西
        function stCodeSkillsLoad() {
            if (stCodeSkillsLoaded) return Promise.resolve(false);
            if (stCodeSkillsLoading) return stCodeSkillsLoading;
            stCodeSkillsLoading = stCodeSkillChain(() => stCodeSkillsLoadOnce())
                .then(changed => { stCodeSkillsLoaded = true; stCodeSkillsLoading = null; return changed; },
                    () => { stCodeSkillsLoaded = true; stCodeSkillsLoading = null; return false; });
            return stCodeSkillsLoading;
        }

        // 存 skill 列表。**返回 Promise<boolean>** —— IndexedDB 是异步的。
        // 内存里的 stCode.skills 已经是真相了，所以大多数调用点不用等它；
        // 想让提示里带上「存不下」的原因（导入那条路），await 一下
        function stCodeSaveSkills() {
            // ⚠ **先拍快照**再去排队。排队会先跑完「启动时那次读」，而读回来的
            //   旧列表会把调用方刚设好的 stCode.skills 盖掉 —— 快照保证写下去的是新的
            const payload = { v: 1, list: stCode.skills };
            return stCodeSkillChain(() => stCodeSkillWrite(payload))
                .then(ok => {
                    // 写成功之后把内存**按快照对齐**：中间那次启动读可能已经把它盖旧了
                    if (ok) stCodeSkillAdopt(payload.list);
                    // 失败要**主动说** —— 否则用户看到「导入 1 个」然后就没了，
                    // 刷新之后才发现什么都没剩下
                    else { stCode.skillErr = stCodeSkillFailText(); stCodeRepaint(); }
                    return ok;
                })
                .catch(() => { stCode.skillErr = stCodeSkillFailText(); stCodeRepaint(); return false; });
        }

        // 项目记忆存**原文**不存 JSON —— 它本来就是一段人写的字，
        // 包一层 JSON 只会让「打开 devtools 看一眼」变得麻烦
        function stCodeSaveMemo() {
            try {
                localStorage.setItem(ST_CODE_MEMO_KEY, String(stCode.memo || ''));
                return true;
            } catch (e) { return false; }
        }

        function stCodeLoad() {
            try {
                const ui = JSON.parse(localStorage.getItem(ST_CODE_UI_KEY) || 'null');
                if (ui && typeof ui === 'object' && !Array.isArray(ui)) {
                    if (ST_CODE_THINK.some(t => t.id === ui.think)) stCode.think = ui.think;
                    if (ui.view === 'card' || ui.view === 'agent') stCode.view = ui.view;
                    if (ui.open && typeof ui.open === 'object' && !Array.isArray(ui.open)) stCode.open = ui.open;
                    if (typeof ui.autoApply === 'boolean') stCode.autoApply = ui.autoApply;
                    // 老配置里没这个字段 —— 缺省就是 false（Code 页的老行为）
                    if (typeof ui.useFirstSeg === 'boolean') stCode.useFirstSeg = ui.useFirstSeg;
                    if (typeof ui.sessionId === 'string') stCode.sessionId = ui.sessionId;
                }
            } catch (e) {}
            try {
                const s = JSON.parse(localStorage.getItem(ST_CODE_SESS_KEY) || 'null');
                if (s && Array.isArray(s.list)) {
                    stCode.sessions = s.list
                        .filter(x => x && typeof x === 'object' && Array.isArray(x.msgs))
                        .map(x => ({
                            id: String(x.id || stUuid()),
                            title: String(x.title || '未命名会话'),
                            ts: Number(x.ts) || Date.now(),
                            msgs: x.msgs.filter(m => m && typeof m === 'object' && m.role),
                            // 老会话里没有这两个字段 —— 一律补成空数组。
                            // ⚠ 读回来的会话必须和 stCodeNewSession 建出来的**形状一致**，
                            //   否则「刷新前能用、刷新后某个按钮报错」这种最难查
                            tasks: Array.isArray(x.tasks) ? x.tasks : [],
                            autoSkills: Array.isArray(x.autoSkills) ? x.autoSkills : []
                        }));
                }
            } catch (e) {}
            // ⚠ skill **不在这里读** —— 它住在 IndexedDB 里，只能异步读（见
            //   stCodeSkillsLoad）。在这里塞一个同步版本就会变成「两边都读、
            //   谁后跑谁说了算」那种最难查的竞态
            try {
                const m = localStorage.getItem(ST_CODE_MEMO_KEY);
                if (typeof m === 'string') stCode.memo = m.slice(0, ST_CODE_MEMO_CHARS);
            } catch (e) {}
        }

        // 当前会话。没有就现开一个 —— 打开 Code 页永远该有个能打字的地方
        function stCodeSession() {
            let s = stCode.sessions.filter(x => x.id === stCode.sessionId)[0];
            if (!s) s = stCodeNewSession(false);
            return s;
        }

        function stCodeNewSession(paint) {
            // ⚠ 这里的字段要和 stCodeLoad 里读回来的**完全一致**（含 tasks / autoSkills）——
            //   少一个字段的话，「新建的会话」和「刷新后读回来的会话」就是两种形状，
            //   后面某处 `.length` 会只在其中一种上炸
            const s = {
                id: stUuid(), title: '新会话', ts: Date.now(), msgs: [],
                tasks: [],        // 模型列的清单（见 set_tasks 工具）
                autoSkills: []    // 本会话已经自动加载过正文的 skill 名字
            };
            stCode.sessions.unshift(s);
            if (stCode.sessions.length > ST_CODE_MAX_SESS) stCode.sessions.length = ST_CODE_MAX_SESS;
            stCode.sessionId = s.id;
            stCode.trash = [];
            stCode.err = '';
            stCodeSaveSessions();
            stCodeSaveUi();
            if (paint !== false) stCodeRepaint();
            return s;
        }

        // 会话标题取第一条用户消息的头 24 个字。空会话保持「新会话」
        function stCodeTitleOf(s) {
            const first = (s.msgs || []).filter(m => m.role === 'user')[0];
            const t = String((first && first.content) || '').replace(/\s+/g, ' ').trim();
            if (!t) return '新会话';
            return t.length > 24 ? t.slice(0, 24) + '…' : t;
        }

