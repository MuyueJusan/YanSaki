        // ---------- 自由摆放：指针拖动 ----------
        //
        // 为什么不用 HTML5 拖放来做这件事：那套 API 只给「拖到哪个元素上」，
        // **拿不到位移**。像素级摆放必须要 dx / dy，只能用指针事件自己算。
        //
        // 两种手势共存的办法：自由摆放开着时把 draggable 关掉（原生拖放让位），
        // 关掉时 onpointerdown 直接返回（指针让位）。互不打架，各自都能测
        let stSbPtr = null;

        // 光标相对起点的位移 → 新的偏移。snap = 吸附粒度（按住 Shift 走 8px 网格）
        function stSbSnapTo(v, snap) {
            const s = Math.max(1, Number(snap) || 1);
            return Math.round(v / s) * s;
        }

        // 量一个元素当前的内容盒尺寸。
        //
        // 按**内容盒**而不是 `getBoundingClientRect` 的边框盒：块上可能有 padding
        // （extra 里带的、或者高级 HTML 块自带的），边框盒会跟着盒模型变，
        // 内容盒不会。写出去的 `width` 就是内容盒宽度，所以量内容盒才对得上
        function stSbMeasureEl(el, axis) {
            if (!el) return 0;
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            const f = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
            if (axis === 'w') {
                return r.width - f(cs.paddingLeft) - f(cs.paddingRight) -
                    f(cs.borderLeftWidth) - f(cs.borderRightWidth);
            }
            return r.height - f(cs.paddingTop) - f(cs.paddingBottom) -
                f(cs.borderTopWidth) - f(cs.borderBottomWidth);
        }

        function stSbCanvasHitOf(b) {
            if (!b || !b.id) return null;
            return document.querySelector('#st-sb-canvas [data-sb="' + b.id + '"]');
        }

        function stSbPtrDown(e, id) {
            if (!stSbFreeOn()) return;
            if (e.button !== undefined && e.button !== 0) return;   // 只认左键
            const b = stSbBlockById(id);
            if (!b) return;
            stSbPtr = {
                id: id, el: e.currentTarget, pid: e.pointerId,
                sx: e.clientX, sy: e.clientY,
                x0: stSbOffNum(b.offX), y0: stSbOffNum(b.offY),
                nx: stSbOffNum(b.offX), ny: stSbOffNum(b.offY),
                moved: false
            };
            // 捕获指针：手滑出画布也能接着拖。**不** preventDefault ——
            // 拦了会把随后的 click / dblclick 一起掐掉（选中和双击改字就废了）
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
        }

        function stSbPtrMove(e) {
            const p = stSbPtr;
            if (!p) return;
            const dx = e.clientX - p.sx;
            const dy = e.clientY - p.sy;
            // 3px 以内还算「点了一下」—— 不设阈值的话手一抖就把块挪歪，
            // 而且选中 / 双击都会变得很难点
            if (!p.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
            p.moved = true;
            const snap = e.shiftKey ? 8 : 1;
            const nx = stSbOffNum(stSbSnapTo(p.x0 + dx, snap));
            const ny = stSbOffNum(stSbSnapTo(p.y0 + dy, snap));
            if (nx === p.nx && ny === p.ny) return;
            p.nx = nx;
            p.ny = ny;
            const b = stSbBlockById(p.id);
            if (!b) return;
            b.offX = nx;
            b.offY = ny;
            // 拖动过程中只动这一个元素 —— 重画画布会把 pointer capture 弄丢，
            // 拖到一半就断了
            stSbPtrPaint(p.el, b, nx, ny);
        }

        function stSbPtrPaint(el, b, x, y) {
            if (!el) return;
            el.style.position = 'relative';
            el.style.left = x ? x + 'px' : '';
            el.style.top = y ? y + 'px' : '';
            const badge = el.querySelector('.st-sb-badge');
            if (!badge) return;
            const lab = stSbOffLabel({ offX: x, offY: y });
            el.classList.toggle('st-sb-off', !!lab);
            badge.textContent = (ST_SB_BLOCK_ICON[b.type] || '•') + ' ' +
                (ST_SB_BLOCK_LABEL[b.type] || b.type) + (lab ? ' · ' + lab : '');
        }

        function stSbPtrUp(e) {
            const p = stSbPtr;
            stSbPtr = null;
            if (!p) return;
            try { p.el.releasePointerCapture(p.pid); } catch (err) {}
            if (!p.moved) return;      // 没真动过 = 就是一次点击，交给 click 处理
            stSbAfterOff(p.id);
        }

        // 挪完 / 调完大小之后的收尾：写回卡里那条正则 + 存草稿 + 重画画布 +
        // 刷属性面板那几格
        function stSbAfterOff(id) {
            const b = stSbBlockById(id);
            if (!b) return;
            stSbSync();
            stSaveDraft();
            stSbPaintCanvas();
            stSbRefreshOffFields(b);
            stSbRefreshSizeFields(b);
        }

        // 只刷属性面板里 X / Y 那两格。**不整页重画** —— 重画会把画布的滚动
        // 位置和刚拖完的手感一起丢掉，而且输入框是在里面敲数字的
        function stSbRefreshOffFields(b) {
            if (!b) return;
            const wid = stSbDomId(b.id).replace(/^st-/, '');
            [['-offx', 'offX'], ['-offy', 'offY']].forEach(pair => {
                const el = document.getElementById('st-' + wid + pair[0]);
                if (el && document.activeElement !== el) {
                    el.value = String(stSbOffNum(b[pair[1]]));
                }
            });
        }

        // 尺寸那两格同理。间距块没有「高 H」这一格（它走上面那个「高度」），
        // 所以按字段名找，找不到就跳过
        function stSbRefreshSizeFields(b) {
            if (!b) return;
            const k = stSbSizeKeys(b);
            const wid = stSbDomId(b.id).replace(/^st-/, '');
            [['-w', k.w], ['-h', 'h']].forEach(pair => {
                const el = document.getElementById('st-' + wid + pair[0]);
                if (!el || document.activeElement === el) return;
                if (pair[1] === 'height') return;      // 那一格归 stSbRefreshRow 管
                el.value = String(stSbSizeNum(b[pair[1]]));
            });
        }

