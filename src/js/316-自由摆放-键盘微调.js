        // ---------- 自由摆放：键盘微调 ----------
        //
        // 「只挪几个像素」用鼠标是做不到的（手一抖就是 3px 起），方向键才是正解。
        // 1px 一档，Shift 十档 —— 跟绘图软件一致，不用解释
        const ST_SB_NUDGE = {
            ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]
        };

        function stSbNudgeKey(e, id) {
            const d = ST_SB_NUDGE[e.key];
            if (!d) {
                if (e.key === 'Escape') { e.preventDefault(); stSbSelect('', true); }
                return;
            }
            e.preventDefault();      // 否则方向键会把画布滚走（Alt+← 还会触发后退）
            e.stopPropagation();
            const step = e.shiftKey ? 10 : 1;
            // 按住 Alt = 改尺寸。跟挪位置共用一套档位 ——
            // 「只挪几个像素」和「只改几个像素」本来就是同一个诉求
            if (e.altKey) { stSbSizeStep(id, d[0] * step, d[1] * step); return; }
            stSbNudge(id, d[0] * step, d[1] * step);
        }

        // 方向键改尺寸：左右动宽、上下动高。
        //
        // 一次按键**只碰一个轴** —— 按一下右键就把高度也钉死的话，
        // 一个本来跟着内容走的块会凭空定住
        function stSbSizeStep(id, dw, dh) {
            const b = stSbBlockById(id);
            if (!b) return;
            const k = stSbSizeKeys(b);
            const axis = dw ? 'w' : 'h';
            const delta = dw || dh;
            let cur = (axis === 'w') ? stSbSizeNum(b[k.w])
                : (k.space ? stSbSizeNum(b.height) : stSbSizeNum(b.h));
            if (!cur) {
                // 还没设过尺寸 → 从画布上量当前的实际大小当起点。
                // 不量的话第一次按键会从 0 跳到 8，块当场缩成一条
                const el = stSbCanvasEl(stSbCanvasHitOf(b), b);
                if (!el) return;
                cur = Math.round(stSbMeasureEl(el, axis));
            }
            const rg = stSbSizeRange(b, axis);
            const nv = Math.max(rg[0], Math.min(rg[1], cur + delta));
            if (axis === 'w') b[k.w] = nv;
            else if (k.space) b.height = nv;
            else b.h = nv;
            stSbAfterOff(id);
        }

        function stSbNudge(id, dx, dy) {
            const b = stSbBlockById(id);
            if (!b) return;
            const x = stSbOffNum(b.offX), y = stSbOffNum(b.offY);
            const nx = stSbOffNum(x + dx), ny = stSbOffNum(y + dy);
            if (nx === x && ny === y) return;
            b.offX = nx;
            b.offY = ny;
            stSbAfterOff(id);
        }

        function stSbOffReset(id) {
            const b = stSbBlockById(id);
            if (!b) return;
            if (!stSbOffNum(b.offX) && !stSbOffNum(b.offY)) return;
            b.offX = 0;
            b.offY = 0;
            stSbAfterOff(id);
        }

        // 全部归位。挪歪了想一键回到干净状态时用 —— 一个个点太累
        function stSbOffResetAll() {
            let n = 0;
            (function walk(list) {
                (list || []).forEach(b => {
                    if (!b || typeof b !== 'object') return;
                    if (stSbOffNum(b.offX) || stSbOffNum(b.offY)) { n++; }
                    b.offX = 0;
                    b.offY = 0;
                    walk(b.children);
                });
            })(stEditor.card.statusBar.blocks);
            if (!n) { stExportMsg('没有块挪过位置。', 'warn'); return; }
            stSbSync();
            stSaveDraft();
            stRerender();
            stExportMsg('⌗ ' + n + ' 个块归位了。', 'ok');
        }

