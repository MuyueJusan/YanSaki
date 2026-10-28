        // ===== 自由摆放（像素级偏移）=====
        //
        // 生成时写成 `position:relative;left:Xpx;top:Ypx`。
        //
        // 为什么是**相对**定位：绝对定位（`position:absolute`）会脱流 —— 运行时那边
        // 后面的块会整个塌上来，等于把整张排版砸了。相对定位只把这一块自己挪走，
        // 别人一动不动，这才叫「把这块挪几个像素」。
        //
        // 两条都是 0 时**一条声明都不写**。生成物要保持原字节：手写稿逐字节自往返、
        // 以及跟原稿的像素级对照，都建立在「编辑器不乱加东西」上
        const ST_SB_OFF_MAX = 800;

        function stSbOffNum(v) {
            const n = Number(v);
            if (!Number.isFinite(n)) return 0;
            return Math.max(-ST_SB_OFF_MAX, Math.min(ST_SB_OFF_MAX, Math.trunc(n)));
        }

        function stSbOffCss(b) {
            const x = stSbOffNum(b && b.offX);
            const y = stSbOffNum(b && b.offY);
            if (!x && !y) return '';
            return 'position:relative;' +
                (x ? 'left:' + x + 'px;' : '') + (y ? 'top:' + y + 'px;' : '');
        }

        // 徽章上那句「⇱ +8,-4」。没挪过就返回空串
        function stSbOffLabel(b) {
            const x = stSbOffNum(b && b.offX);
            const y = stSbOffNum(b && b.offY);
            if (!x && !y) return '';
            return '⇱ ' + (x > 0 ? '+' : '') + x + ',' + (y > 0 ? '+' : '') + y;
        }

