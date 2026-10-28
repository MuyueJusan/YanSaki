        // ---------- 调整大小：八向把手 ----------
        //
        // 拖动**把手**跟拖动**块**是两套手势，共用一套 pointer 状态会打架，
        // 所以 stSbResizeDown 一进来就把 stSbPtr 清掉。
        //
        // 尺寸写在**块自己的元素**上（画布和产物都是），不是命中框上 —— 这样
        // 两边逐像素一致。命中框靠 `width:fit-content` 缩到跟块一样宽，
        // 把手才落在块的四个角上。
        //
        // ⚠ 拖动时按**内容盒**算，不按 getBoundingClientRect 的边框盒算：
        // 块上可能有 padding（`extra` 里带的、或者高级 HTML 块自带的），
        // 边框盒会跟着盒模型变，内容盒不会。写出去的 `width` 就是内容盒宽度，
        // 所以「起点内容宽 + 位移」才是「可见宽度正好跟着手走」的算法
        let stSbRsz = null;

        function stSbResizeDown(e, id, dir) {
            if (!stSbFreeOn()) return;
            if (e.button !== undefined && e.button !== 0) return;
            // 把手在命中框里面，不拦下来的话这次按下会被命中框当成「拖动挪位置」
            if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
            const b = stSbBlockById(id);
            if (!b) return;
            const handle = e.currentTarget;
            const hit = handle && handle.parentNode;
            const el = stSbCanvasEl(hit, b);
            if (!hit || !el) return;
            stSbPtr = null;                     // 挪位置那套让位
            const k = stSbSizeKeys(b);
            stSbRsz = {
                id: id, dir: String(dir || 'se'), hit: hit, el: el, pid: e.pointerId,
                sx: e.clientX, sy: e.clientY, moved: false,
                g: {
                    x: stSbOffNum(b.offX), y: stSbOffNum(b.offY),
                    w: stSbMeasureEl(el, 'w'),
                    h: stSbMeasureEl(el, 'h'),
                    keys: k,
                    range: axis => stSbSizeRange(b, axis)
                },
                nx: stSbOffNum(b.offX), ny: stSbOffNum(b.offY),
                nw: stSbSizeNum(b[k.w]), nh: k.space ? 0 : stSbSizeNum(b.h)
            };
            try { handle.setPointerCapture(e.pointerId); } catch (err) {}
        }

        function stSbResizeMove(e) {
            const p = stSbRsz;
            if (!p) return;
            const dx = e.clientX - p.sx, dy = e.clientY - p.sy;
            // 把手只有 9px，手抖是常态 —— 不设阈值的话点一下就把块弄歪了
            if (!p.moved && Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
            p.moved = true;
            const b = stSbBlockById(p.id);
            if (!b) return;
            const r = stSbResizeCalc(p.dir, dx, dy, p.g, e.shiftKey ? 8 : 1);
            if (r.x === p.nx && r.y === p.ny && r.w === p.nw && r.h === p.nh) return;
            p.nx = r.x; p.ny = r.y; p.nw = r.w; p.nh = r.h;
            stSbResizePaint(p, b, r);
        }

        // 拖动过程中只动这一个块 + 它那层命中框，**不重画画布** ——
        // 重画会把 pointer capture 弄丢，拖到一半就断了
        function stSbResizePaint(p, b, r) {
            const el = p.el, hit = p.hit;
            if (!el) return;
            if (stSbRszAxis(p.dir, 'w')) el.style.width = r.w ? r.w + 'px' : '';
            if (stSbRszAxis(p.dir, 'h')) el.style.height = r.h ? r.h + 'px' : '';
            // 西 / 北边拖的时候位置跟着走。画布上偏移是挂在**命中框**上的
            if (p.dir.indexOf('w') >= 0) {
                hit.style.position = 'relative';
                hit.style.left = r.x ? r.x + 'px' : '';
            }
            if (p.dir.indexOf('n') >= 0) {
                hit.style.position = 'relative';
                hit.style.top = r.y ? r.y + 'px' : '';
            }
            // 命中框得跟着块一起变宽。初始渲染靠 fit-content，拖动中直接写死 ——
            // 第一次拖的时候块还没有 w，命中框身上也就没有 fit-content
            if (stSbRszAxis(p.dir, 'w') && !stSbIsBox(b)) {
                const cs = getComputedStyle(el);
                const f = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
                hit.style.width = (el.getBoundingClientRect().width + f(cs.marginLeft) +
                    f(cs.marginRight) + 0.01) + 'px';
            }
            const badge = hit.querySelector('.st-sb-badge');
            if (!badge) return;
            const offLab = stSbOffLabel({ offX: r.x, offY: r.y });
            const sizeLab = stSbSizeLabel({ type: b.type, w: r.w, h: r.h });
            hit.classList.toggle('st-sb-off', !!(offLab || sizeLab));
            badge.textContent = (ST_SB_BLOCK_ICON[b.type] || '•') + ' ' +
                (ST_SB_BLOCK_LABEL[b.type] || b.type) +
                (offLab ? ' · ' + offLab : '') + (sizeLab ? ' · ' + sizeLab : '');
        }

        function stSbResizeUp(e) {
            const p = stSbRsz;
            stSbRsz = null;
            if (!p) return;
            try { e.currentTarget.releasePointerCapture(p.pid); } catch (err) {}
            if (!p.moved) return;              // 没真动过 = 就是点了一下把手
            const b = stSbBlockById(p.id);
            if (!b) return;
            // 拖动过程中只改了 DOM，模型还没动 —— 松手这一下才落库
            stSbResizeCommit(b, p, { x: p.nx, y: p.ny, w: p.nw, h: p.nh });
            stSbAfterOff(p.id);
        }

        // 拖完落库。只写**这次动过的那几个轴** —— 拖南边就不该碰宽度：
        // 碰了就会把一个「自适应」的块钉成当前像素宽，白多一条声明
        function stSbResizeCommit(b, p, r) {
            if (!b) return;
            const k = stSbSizeKeys(b);
            if (stSbRszAxis(p.dir, 'w')) b[k.w] = r.w;
            if (stSbRszAxis(p.dir, 'h')) {
                if (k.space) b.height = r.h;
                else b.h = r.h;
            }
            if (p.dir.indexOf('w') >= 0) b.offX = r.x;
            if (p.dir.indexOf('n') >= 0) b.offY = r.y;
        }

        function stSbSizeReset(id) {
            const b = stSbBlockById(id);
            if (!b) return;
            const k = stSbSizeKeys(b);
            const had = stSbSizeNum(b[k.w]) || (k.space ? 0 : stSbSizeNum(b.h));
            if (!had) return;
            b[k.w] = 0;
            if (k.space) b.height = 8;      // 间距块的「默认尺寸」= 新建时那个高度
            else b.h = 0;
            stSbAfterOff(id);
        }

        // 全部尺寸复原。**不碰偏移** —— 「归位」和「尺寸复原」是两件事，
        // 合成一个按钮的话，只想复位位置的人会连调好的大小一起丢掉
        function stSbSizeResetAll() {
            let n = 0;
            (function walk(list) {
                (list || []).forEach(b => {
                    if (!b || typeof b !== 'object') return;
                    const k = stSbSizeKeys(b);
                    if (stSbSizeNum(b[k.w]) || (k.space ? 0 : stSbSizeNum(b.h))) n++;
                    b[k.w] = 0;
                    if (k.space) b.height = 8;
                    else b.h = 0;
                    walk(b.children);
                });
            })(stEditor.card.statusBar.blocks);
            if (!n) { stExportMsg('没有块调过大小。', 'warn'); return; }
            stSbSync();
            stSaveDraft();
            stRerender();
            stExportMsg('⤡ ' + n + ' 个块恢复成自适应了。', 'ok');
        }

