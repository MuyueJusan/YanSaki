        // ---------- 主题 / 版式 ----------

        function stSbSetTheme(id) {
            if (ST_SB_THEME_IDS.indexOf(String(id)) < 0) return;
            stEditor.card.statusBar.theme = String(id);
            stSbSync();
            stSaveDraft();
            stRerender();
        }

        function stSbApplyTemplate(i) {
            const t = ST_SB_TEMPLATES[Number(i)];
            if (!t) return;
            const c = stEditor.card;
            const n = stSbCount(c.statusBar.blocks);
            if (n && !window.confirm('画布上现在有 ' + n + ' 个块。\n\n' +
                '套用版式「' + t.name + '」会把它们整套换掉，确定吗？')) return;
            c.statusBar.blocks = stSbTplBlocks(t.id);
            c.statusBar.theme = t.theme;
            stEditor.sbSel = '';
            stEditor.sbOpen = {};
            stSbSync();
            stSaveDraft();
            stRerender();
        }

