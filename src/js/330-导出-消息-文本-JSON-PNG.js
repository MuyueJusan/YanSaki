        // ===== 导出 =====

        // 提示只落一处：顶栏下方那条常驻状态条。它不属于任何一页，
        // 所以任何选项卡下、内容区滚到哪儿都看得见；导出页不再重复一遍同样的字
        // scope：'' = 常驻条；'persona' = 人设生成器页内那一格（贴着「生成」按钮）。
        //
        // ⚠ 为什么需要它：常驻条（`#st-status`）在**整个浮层最上面**，眼睛盯着
        //   「✨ 生成人设」按钮的时候根本看不到 —— 点了没反应，看着像坏了。
        //   AI 助手页早就是这个思路（它有自己的 `#st-ai-cfg-status` + `stAiSetStatus`），
        //   这里只是让生成器跟上。
        function stExportMsg(text, kind, scope) {
            stEditor.msg = {
                text: text || '',
                kind: (kind === 'ok' ? '' : (kind || '')),
                scope: scope || ''
            };
            stPaintMsg();
        }

        // 一条消息**只出现在一个地方**：
        //   · 人设页开着 ⇒ 进 `#st-persona-msg`（贴着按钮），常驻条留空；
        //   · 人设页没开（切到别的选项卡了）⇒ 退回常驻条，消息不丢。
        // ⚠ 这条「不同时出现」是要断言的 —— 两边都写的话，用户会看到同一句话两遍。
        function stPaintMsg() {
            const m = stEditor.msg || { text: '', kind: '', scope: '' };
            const inPane = m.scope === 'persona';

            const pm = document.getElementById('st-persona-msg');
            if (pm) {
                const show = inPane && !!m.text;
                pm.className = 'st-ai-status' +
                    (m.kind === 'bad' ? ' st-bad' : (m.kind === 'warn' ? ' st-warn' : ' st-ok'));
                pm.textContent = show ? m.text : '';
                pm.style.display = show ? '' : 'none';
            }

            const bar = document.getElementById('st-status');
            if (!bar) return;
            // ⚠ 页内格**在的时候**才把常驻条让出去；不在就退回常驻条
            const show = !!m.text && !(inPane && pm);
            bar.className = 'st-status' + (m.kind === 'bad' ? ' st-bad' : (m.kind === 'warn' ? ' st-warn' : ''));
            bar.textContent = show ? m.text : '';
            bar.style.display = show ? '' : 'none';
        }

        function stExportNote() {
            const el = document.getElementById('st-export-note');
            if (el) {
                el.textContent = stEditor.lastExport
                    ? '上次导出：' + stEditor.lastExport
                    : '这个会话里还没导出过。';
            }
        }

        function stExportJson() {
            try {
                const json = stCardToStJson();
                const text = JSON.stringify(json, null, 2);
                const name = stSafeFileName(stEditor.card.name) + '.json';
                stDownload(name, new Blob([text], { type: 'application/json' }));
                stEditor.lastExport = 'JSON · ' + name + ' · ' + text.length + ' 字符';
                stSaveDraft();
                stExportNote();
                stExportMsg('✅ 已导出 ' + name + '（' + text.length + ' 字符）。', 'ok');
            } catch (e) {
                stExportMsg('❌ 导出失败：' + (e && e.message ? e.message : e), 'bad');
            }
        }

        async function stExportPng() {
            const c = stEditor.card;
            const btn = document.getElementById('st-png-btn');
            if (btn) { btn.disabled = true; btn.textContent = '正在生成…'; }
            stExportMsg('');
            try {
                const text = JSON.stringify(stCardToStJson());
                // V3 写 ccv3、V1/V2 写 chara —— 和 ST 的 writeCharacterCardToPng 一致
                const keyword = c.spec === 'v3' ? 'ccv3' : 'chara';
                const base = await stAvatarPngBytes();
                const out = stInjectCardChunk(base, keyword, text);
                const name = stSafeFileName(c.name) + '.png';
                stDownload(name, new Blob([out], { type: 'image/png' }));
                stEditor.lastExport = 'PNG · ' + name + ' · ' + keyword + ' 数据块 · ' +
                    Math.round(out.length / 1024) + ' KB';
                stSaveDraft();
                stExportNote();
                stExportMsg('✅ 已导出 ' + name + '（' + keyword + ' 数据块，' +
                    Math.round(out.length / 1024) + ' KB）。' +
                    '用 SillyTavern 的「导入角色卡」直接读；本应用的酒馆模式也能读。', 'ok');
            } catch (e) {
                stExportMsg('❌ 导出失败：' + (e && e.message ? e.message : e), 'bad');
            }
            if (btn) { btn.disabled = false; btn.textContent = '🖼 导出 PNG 角色卡'; }
        }

