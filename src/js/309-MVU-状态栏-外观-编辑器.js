        // ===== MVU 状态栏（外观）编辑器 =====
        // 「像编辑 PPT 一样」：左边图层、中间画布、右边属性。
        // 画布上点一下选中、拖一下换位置；拖到某个「一行多列」的中间就并进那一组。
        // 改完不用点保存 —— 块列表是唯一事实来源，stSbSync() 会立刻重写卡里那条
        // 「状态栏界面」正则的 replaceString。
        //
        // ⚠ 画布是**真渲染**（直接调 stSbBlockHtml），不是示意图 —— 所见即所得。
        //   唯一的差别是变量值用示例数据，否则画布上只会是一串 {{...}}。
        //   每个块外面套一层「命中框」，只加轮廓，不碰块自己的内联样式。

        // 拖拽的瞬时状态。不放进 stEditor —— 它不该被写进草稿
        let stSbDragId = null;
        let stSbDropAt = null;
        // 解析接管时留一份原稿，**本次会话内**能还原。不进草稿 ——
        // 那是几百行 HTML，塞进 localStorage 只会把草稿挤爆
        let stSbParseBackup = null;

        function stSbBlockById(id) {
            const hit = stSbLocate(String(id));
            return hit ? hit.block : null;
        }

        function stSbDomId(id) {
            return 'st-sb-n-' + String(id).replace(/[^A-Za-z0-9_-]/g, '').slice(-16);
        }

        function stSbIsBox(b) {
            return !!b && ST_SB_CONTAINER.indexOf(b.type) >= 0;
        }

        // 这个节点（含整棵子树）里有没有某个 id。拖拽时用它挡「拖进自己的子树」——
        // 挡不住的话块会被摘下来再插回自己里面，等于整棵子树消失
        function stSbHasBlock(node, id) {
            if (!node) return false;
            if (String(node.id) === String(id)) return true;
            return (node.children || []).some(k => stSbHasBlock(k, id));
        }

        // 图层与画布上显示的名字。块本身没有 name 字段，只能按类型推
        function stSbBlockTitle(b) {
            if (!b) return '';
            const t = b.type;
            if (t === 'title' || t === 'text') {
                const s = String(b.text || '').trim();
                return s ? (s.length > 20 ? s.slice(0, 20) + '…' : s) : '（空文字）';
            }
            if (t === 'html') return '高级 HTML';
            if (t === 'divider') return '分割线';
            if (t === 'space') return '间距 ' + b.height + 'px';
            if (t === 'row') return '一行 ' + (b.children || []).length + ' 列';
            const nm = String(b.label || '').trim() ||
                String(b.path || '').replace(/^stat_data\./, '').split('.').pop();
            return nm || '未选变量';
        }

        // 画布上已经用过的变量路径 —— 自动挑变量时避开重复
        function stSbUsedPaths() {
            const used = {};
            const walk = list => (list || []).forEach(b => {
                if (b.path) used[b.path] = true;
                walk(b.children);
            });
            walk(stEditor.card ? stEditor.card.statusBar.blocks : []);
            return used;
        }

        // 新块的默认变量：进度条 / 圆点优先挑没被用过的数值变量，并把变量自己的
        // min / max 一起带上 —— 不然作者在 MVU 页设的 0~5 到这里会变成 0~100，
        // 条永远画不满
        function stSbAutoPick(type) {
            const wantNum = (type === 'bar' || type === 'dots');
            const pool = stSbVarPaths().filter(p =>
                wantNum ? p.type === 'number' : ST_MVU_CONTAINER.indexOf(p.type) < 0);
            const used = stSbUsedPaths();
            const pick = pool.filter(p => !used[p.path])[0] || pool[0] || null;
            if (!pick) return null;
            const lo = Number(pick.min);
            const hi = Number(pick.max);
            return {
                path: pick.path,
                label: String(pick.name).split('.').pop(),
                min: Number.isFinite(lo) ? lo : 0,
                max: Number.isFinite(hi) ? hi : (type === 'dots' ? 5 : 100)
            };
        }

