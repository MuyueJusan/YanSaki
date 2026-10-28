        // ===== 生成结果预览 =====

        function stAiEntryPreviewHtml(list) {
            return list.map((e, i) =>
                '<div class="st-ai-card">' +
                    '<div class="st-ai-card-head">' +
                        '<b>#' + (i + 1) + '</b>' +
                        '<span>' + escapeHtml(e.comment || '（没写备注）') + '</span>' +
                        '<span class="st-ai-kv">' + escapeHtml(WI_POS_LABEL[e.position] || '?') +
                            (e.position === WI_POS.atDepth ? ' 深度 ' + e.depth : '') +
                            ' · 顺序 ' + e.order +
                            (e.constant ? ' · 常驻' : '') +
                            (e.enabled ? '' : ' · 已停用') +
                        '</span>' +
                    '</div>' +
                    (e.keys.length
                        ? '<div class="st-ai-kv">关键词：' + escapeHtml(e.keys.join('、')) + '</div>'
                        : '<div class="st-ai-kv">关键词：（空）</div>') +
                    (e.secondaryKeys.length
                        ? '<div class="st-ai-kv">次关键词：' + escapeHtml(e.secondaryKeys.join('、')) + '</div>'
                        : '') +
                    '<div class="st-ai-card-body">' + escapeHtml(e.content) + '</div>' +
                '</div>'
            ).join('');
        }

        function stAiGreetPreviewHtml(list) {
            return list.map((g, i) =>
                '<div class="st-ai-card">' +
                    '<div class="st-ai-card-head">' +
                        '<b>#' + (i + 1) + '</b>' +
                        '<span class="st-ai-kv">' + String(g).length + ' 字</span>' +
                    '</div>' +
                    '<div class="st-ai-card-body">' + escapeHtml(g) + '</div>' +
                '</div>'
            ).join('');
        }

        // 复制原始回复。headless / 非安全上下文里 navigator.clipboard 可能没有，
        // 退回 textarea + execCommand 那条老路
        function stAiCopyRaw(which) {
            const key = which === 'gr' ? 'grRaw' : (which === 'en' ? 'enRaw' : 'exRaw');
            const msgKey = which === 'gr' ? 'grMsg' : (which === 'en' ? 'enMsg' : 'exMsg');
            const text = String(stAiUi[key] || '');
            if (!text) return;
            const done = ok => {
                stAiUi[msgKey] = ok ? '已复制原始回复（' + text.length + ' 字符）' : '复制失败，请手动选中';
                // 单条改写那份消息也要认领到条目上，否则它会在所有条目的面板里同时冒出来
                if (which === 'en') stAiUi.enMsgId = stAiUi.enRunId;
                stAiRepaint();
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
                return;
            }
            try {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                const ok = document.execCommand('copy');
                ta.remove();
                done(ok);
            } catch (e) { done(false); }
        }

