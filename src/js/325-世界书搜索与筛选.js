        // ===== 世界书搜索与筛选 =====
        //
        // ⚠⚠ 这个功能**只改显示，不改数据**：
        //   · 不重排 `bookEntries`、不改下标 —— 卡片是按 index 寻址的
        //     （`st-entry-<i>`、`stDupEntry(i)`、`stMoveEntry(i)`、`stDelEntry(i)`），
        //     筛完重排会让这些操作作用到**另一条**上，而且不会有任何报错。
        //   · 不删 DOM 节点 —— 被筛掉的卡片只是加了 `.st-entry-hide`。
        //     卡片里有输入框，重建节点会让正在编辑的那条丢光标、丢展开状态。
        //
        // ⚠ 状态是**会话级**的（`stEditor.bookFind`），跟 bookSel 同类：不落盘、不进卡。

        const ST_BOOK_FIND_DEF = { q: '', state: 'all', constant: 'all', pos: 'all', keys: 'all' };

        // 读归一化之后的筛选条件。⚠ 老草稿 / 新卡里可能没有这个字段，
        //   直接 `stEditor.bookFind.q` 会在那种时候抛异常 —— 一律走这里
        function stBookFind() {
            const raw = (stEditor && stEditor.bookFind) || {};
            const out = {};
            for (const k in ST_BOOK_FIND_DEF) {
                out[k] = (typeof raw[k] === 'string') ? raw[k] : ST_BOOK_FIND_DEF[k];
            }
            return out;
        }

        function stBookFindActive(f) {
            f = f || stBookFind();
            return !!(f.q || f.state !== 'all' || f.constant !== 'all' ||
                f.pos !== 'all' || f.keys !== 'all');
        }

        // 一条条目命中不命中。⚠ 关键词**不只看 keys**：
        //   用户搜「雾港」时心里想的是「哪条跟雾港有关」，正文里提到也算
        function stBookFindMatch(e, f) {
            if (!e) return false;
            f = f || stBookFind();
            if (f.state === 'on' && !e.enabled) return false;
            if (f.state === 'off' && e.enabled) return false;
            if (f.constant === 'yes' && !e.constant) return false;
            if (f.constant === 'no' && e.constant) return false;
            if (f.pos !== 'all' && String(e.position) !== f.pos) return false;
            const nk = Array.isArray(e.keys) ? e.keys.length : 0;
            if (f.keys === 'has' && nk === 0) return false;
            if (f.keys === 'none' && nk > 0) return false;
            const q = String(f.q || '').trim().toLowerCase();
            if (q) {
                const hay = [
                    e.comment || '',
                    Array.isArray(e.keys) ? e.keys.join(' ') : '',
                    Array.isArray(e.secondaryKeys) ? e.secondaryKeys.join(' ') : '',
                    e.content || '',
                    e.group || ''
                ].join('\n').toLowerCase();
                if (hay.indexOf(q) < 0) return false;
            }
            return true;
        }

        // 命中的**原始下标**（升序）。⚠ 返回的是下标，不是筛完之后的序号 ——
        //   调用方拿它去 `bookEntries[i]` 才是同一条
        function stBookFindIdx(entries) {
            const a = entries || ((stEditor.card && Array.isArray(stEditor.card.bookEntries))
                ? stEditor.card.bookEntries : []);
            const f = stBookFind();
            const out = [];
            a.forEach((e, i) => { if (stBookFindMatch(e, f)) out.push(i); });
            return out;
        }

        // 改一个筛选条件。⚠ **不重画整页**：搜索框每敲一个字都重画的话，
        //   正在编辑的卡片会被换掉（光标飞、展开状态丢）
        function stBookFindSet(key, val) {
            if (!(key in ST_BOOK_FIND_DEF)) return;
            const f = stBookFind();
            f[key] = String(val);
            stEditor.bookFind = f;
            stBookFindApply();
        }

        function stBookFindReset() {
            stEditor.bookFind = Object.assign({}, ST_BOOK_FIND_DEF);
            // ⚠ 控件自己的值也要退回去 —— 只改状态不重画的话，
            //   输入框和下拉框还显示着旧的筛选条件，看起来像「点了没反应」
            const q = document.getElementById('st-find-q');
            if (q) q.value = '';
            [['state', 'st-find-state'], ['constant', 'st-find-const'],
             ['pos', 'st-find-pos'], ['keys', 'st-find-keys']].forEach(pair => {
                const el = document.getElementById(pair[1]);
                if (el) el.value = 'all';
            });
            stBookFindApply();
        }

        // 只切隐藏类 + 改计数，不碰卡片本身
        function stBookFindApply() {
            const a = (stEditor.card && Array.isArray(stEditor.card.bookEntries))
                ? stEditor.card.bookEntries : [];
            const hit = new Set(stBookFindIdx(a));
            document.querySelectorAll('#st-panes .st-entry').forEach(d => {
                const m = /^st-entry-(\d+)$/.exec(d.id || '');
                if (!m) return;
                d.classList.toggle('st-entry-hide', !hit.has(Number(m[1])));
            });
            stBookFindPaint();
        }

        // 改「命中 N / 共 M 条」、「重置」的可用态、以及空态那块
        function stBookFindPaint() {
            const a = (stEditor.card && Array.isArray(stEditor.card.bookEntries))
                ? stEditor.card.bookEntries : [];
            const f = stBookFind();
            const act = stBookFindActive(f);
            const hit = stBookFindIdx(a);
            const info = document.getElementById('st-find-info');
            if (info) {
                info.textContent = act
                    ? '命中 ' + hit.length + ' / 共 ' + a.length + ' 条'
                    : '共 ' + a.length + ' 条';
            }
            const rb = document.getElementById('st-find-reset');
            if (rb) rb.disabled = !act;
            const emp = document.getElementById('st-book-find-empty');
            if (emp) emp.hidden = !(act && a.length > 0 && hit.length === 0);
            // 「全选」的勾选态 / 半选态跟着**可见集**变，不能还按全集算
            stBookSelPaint();
        }

