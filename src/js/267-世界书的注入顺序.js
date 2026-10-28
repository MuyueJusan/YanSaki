        // ===== 世界书的注入顺序 =====
        // 「按世界书当时的深度和开放关闭状态」具体是什么，就落在这个函数里：
        //   · enabled === false 的条目跳过（除非显式要求包含）
        //   · position = Outlet 的跳过（运行时它也不插入正文）
        //   · 先按位置分组（↑Char → ↓Char → ↑AT → ↓AT → @D → ↑EM → ↓EM）
        //   · @D 组内按 depth 从大到小 —— depth 是「插到倒数第几条消息之前」，
        //     数字越大离最后一条越远，所以排得越靠前
        //   · 同位置同深度再按 order，最后按原始下标，保证稳定
        function stAiInjectList(opts) {
            const o = opts || {};
            const incOff = !!o.includeDisabled;
            const rank = p => (p === WI_POS.beforeChar ? 0
                : p === WI_POS.afterChar ? 1
                : p === WI_POS.anTop ? 2
                : p === WI_POS.anBottom ? 3
                : p === WI_POS.atDepth ? 4
                : p === WI_POS.emTop ? 5
                : p === WI_POS.emBottom ? 6 : 9);
            const rows = [];
            (stEditor.card.bookEntries || []).forEach((e, i) => {
                if (!incOff && !e.enabled) return;
                if (e.position === WI_POS.outlet) return;
                if (!String(e.content || '').trim()) return;
                rows.push({ e: e, i: i, rank: rank(e.position) });
            });
            rows.sort((a, b) => {
                if (a.rank !== b.rank) return a.rank - b.rank;
                if (a.e.position === WI_POS.atDepth && a.e.depth !== b.e.depth) {
                    return b.e.depth - a.e.depth;
                }
                if (a.e.order !== b.e.order) return a.e.order - b.e.order;
                return a.i - b.i;
            });
            return rows;
        }

        function stAiInjectText(rows) {
            return (rows || []).map((r, n) => {
                const e = r.e;
                const head = '[' + (n + 1) + '] ' + (WI_POS_LABEL[e.position] || '?') +
                    (e.position === WI_POS.atDepth ? ' 深度 ' + e.depth : '') +
                    ' · 顺序 ' + e.order +
                    (e.constant ? ' · 常驻' : ' · 关键词触发：' + (e.keys.join('、') || '（没写关键词）')) +
                    (e.enabled ? '' : ' · ⚠ 已停用');
                return head + '\n' + String(e.content || '').trim();
            }).join('\n\n');
        }

