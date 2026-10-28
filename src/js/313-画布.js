        // ---------- 画布 ----------

        // 自由摆放开关。开着的时候，块上的鼠标拖动 = 像素级挪位置（HTML5 拖放让位）；
        // 关着的时候是原来的结构排序：落点只能是「某块前 / 某块后 / 某个分组里面」。
        //
        // 默认**开着** —— 「像编辑 ppt 一样」的默认动作就是把东西拖到想放的地方，
        // 而不是让编辑器猜「你想插到第几行」。结构排序仍然一键可回
        function stSbFreeOn() {
            return stEditor.sbFree !== false;
        }

        function stSbFreeSet(on) {
            stEditor.sbFree = !!on;
            stSbDragId = '';
            stSaveDraft();
            stRerender();
        }

        function stSbCanvasBlockHtml(b, theme) {
            const sel = stEditor.sbSel === b.id;
            const free = stSbFreeOn();
            const offLab = stSbOffLabel(b);
            const sizeLab = stSbSizeLabel(b);
            const cls = 'st-sb-hit' + (sel ? ' st-sb-on' : '') +
                (offLab || sizeLab ? ' st-sb-off' : '') +
                (free && sel ? ' st-sb-hh' : '') +
                (stSbDragId === b.id ? ' st-sb-drag' : '');
            const lit = "'" + b.id + "'";
            // 偏移挂在**命中框**上，块自己那份由 stSbBlockHtml 的 noOff 关掉 ——
            // 两边都写就成了挪两次
            const off = stSbOffCss(b);
            // 自由摆放时把 draggable 关掉，免得浏览器原生的拖放把指针事件截走。
            // 内联的那几个 ondrag* 留着：关掉模式之后它们照常干活
            const attrs = ' data-sb="' + b.id + '" draggable="' + (free ? 'false' : 'true') + '"' +
                ' onpointerdown="stSbPtrDown(event,' + lit + ')"' +
                ' onpointermove="stSbPtrMove(event)"' +
                ' onpointerup="stSbPtrUp(event)"' +
                ' onpointercancel="stSbPtrUp(event)"' +
                ' onkeydown="stSbNudgeKey(event,' + lit + ')"' +
                ' ondragstart="stSbDragStart(event,' + lit + ')"' +
                ' ondragover="stSbDragOver(event,' + lit + ')"' +
                ' ondragleave="stSbDragLeave(event)"' +
                ' ondrop="stSbDrop(event,' + lit + ')"' +
                ' ondragend="stSbDragEnd(event)"' +
                ' onclick="event.stopPropagation();stSbSelect(' + lit + ',true)"' +
                ' ondblclick="event.stopPropagation();stSbDblClick(' + lit + ')"';
            const badge = '<span class="st-sb-badge">' +
                escapeHtml((ST_SB_BLOCK_ICON[b.type] || '•') + ' ' +
                    (ST_SB_BLOCK_LABEL[b.type] || b.type) +
                    (offLab ? ' · ' + offLab : '') +
                    (sizeLab ? ' · ' + sizeLab : '')) + '</span>';
            // 八向把手**只在选中的那一块**上渲染：八个 9px 的小方块铺满画布
            // 会把排版整个糊掉，而拖动只需要作用在当前这一块上
            const handles = (free && sel)
                ? ST_SB_HANDLES.map(d =>
                    '<span class="st-sb-h" data-h="' + d + '"' +
                    ' title="拖动改大小（Shift 吸附 8px）"' +
                    ' onpointerdown="stSbResizeDown(event,' + lit + ',\'' + d + '\')"' +
                    ' onpointermove="stSbResizeMove(event)"' +
                    ' onpointerup="stSbResizeUp(event)"' +
                    ' onpointercancel="stSbResizeUp(event)"' +
                    ' onclick="event.stopPropagation()"></span>').join('')
                : '';
            if (stSbIsBox(b)) {
                // 分组：外壳的 flex 得在这里自己写一遍（stSbBlockHtml 那一支
                // 会把子块包成不带命中框的 div，用不了）。分组自己就是命中框，
                // 所以尺寸直接写在这一层 —— 跟产物那边写在自己身上是同一个位置
                const gap = Number.isFinite(Number(b.gap)) ? Number(b.gap) : 8;
                const kids = (b.children || []).map(k =>
                    '<div class="st-sb-col">' + stSbCanvasBlockHtml(k, theme) + '</div>').join('');
                return '<div class="' + cls + '"' + attrs +
                    ' style="' + off + stSbSizeCss(b) + 'display:flex;gap:' + gap +
                    'px;align-items:center;margin:3px 0">' +
                    badge + (kids || '<div class="st-sb-slot">空分组 —— 把块拖进来</div>') +
                    handles + '</div>';
            }
            // 画布上的块自己**不写**偏移（noOff=true），偏移在命中框那一层。
            // 尺寸则相反：块自己写着（stSbBlockHtml 里那份），命中框靠 fit-content
            // 缩到跟块一样宽 —— 不然定过宽的块，选中轮廓会一直拉到整栏那么长
            const fit = stSbSizeNum(b.w) ? 'width:fit-content;' : '';
            const hitCss = off + fit;
            const hitStyle = hitCss ? ' style="' + hitCss + '"' : '';
            return '<div class="' + cls + '"' + attrs + hitStyle + '>' + badge +
                stSbBlockHtml(b, true, theme, true) + handles + '</div>';
        }

        // 画布里「块自己的那个元素」。
        //   · 分组：命中框就是块本身
        //   · 别的：命中框里紧跟着徽章的那个 —— 不写 children[1]，那种按位置数的
        //     写法等哪天往徽章前面加个东西就悄悄错了
        function stSbCanvasEl(hit, b) {
            if (!hit) return null;
            if (stSbIsBox(b)) return hit;
            return hit.querySelector(':scope > .st-sb-badge + *');
        }

        function stSbCanvasHtml() {
            const sb = stEditor.card.statusBar;
            const free = stSbFreeOn();
            const body = (sb.blocks || []).map(b => stSbCanvasBlockHtml(b, sb.theme)).join('');
            // 点画布空白处 = 取消选中。块自己的 onclick 里 stopPropagation，不会误触
            // tabindex + 空格键不滚动：方向键微调要有地方接事件
            return '<div class="st-sb-stage' + (free ? ' st-sb-free' : '') + '"' +
                    ' tabindex="0" onclick="stSbSelect(\'\',true)">' +
                '<div class="st-sb-slide">' +
                    '<div class="st-sb-slide-tag">聊天里的样子（变量用的是示例值）</div>' +
                    stSbShellOpen(sb) +
                    (body || '<div class="st-sb-blank">画布是空的 —— ' +
                        '从左边预制块 / 块库点一个，或者先套一个版式模板</div>') +
                    '</div>' +
                    '<div class="st-sb-dropend" ondragover="stSbDragOverEnd(event)"' +
                        ' ondrop="stSbDropEnd(event)">' + (free
                            ? '自由摆放：直接拖块挪位置；选中之后拖四角 / 四边改大小；' +
                              '方向键 1px、Shift+方向键 10px、Alt+方向键改尺寸'
                            : '拖到这里 = 放到最后') + '</div>' +
                '</div>' +
            '</div>';
        }

        // 只重画布，不整页重画。stAfterSet 在打字时会调它 ——
        // 整页重画会把光标顶掉，也会让画布闪
        function stSbPaintCanvas() {
            const el = document.getElementById('st-sb-canvas');
            if (!el) return;
            // 换 innerHTML 会把画布自己的滚动位置丢掉。挪一个块就跳回顶部，
            // 迭代微调的时候很难受
            const top = el.scrollTop, left = el.scrollLeft;
            el.innerHTML = stSbCanvasHtml();
            el.scrollTop = top;
            el.scrollLeft = left;
            stSbSchedulePreview();
        }

