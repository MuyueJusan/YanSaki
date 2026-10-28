        // —— 从链接导入 ——

        function stCodeSkillUrlSet(v) {
            // ⚠ 只写状态、不重画 —— 一个字一个字敲，重画会把光标顶掉
            stCode.skillUrl = String(v == null ? '' : v);
        }

        async function stCodeImportUrl() {
            if (stCode.skillBusy) return;
            const raw = String(stCode.skillUrl || '').trim();
            if (!raw) {
                stCode.skillErr = '先贴一个地址。';
                stCode.skillMsg = '';
                stCodeRepaint();
                return;
            }
            stCode.skillBusy = true;
            stCode.skillErr = '';
            stCode.skillMsg = '正在取…';
            stCodeRepaint();
            let r;
            try {
                r = await stCodeUrlToSkills(raw);
            } catch (e) {
                stCode.skillBusy = false;
                stCode.skillErr = String((e && e.message) || e);
                stCode.skillMsg = '';
                stCodeRepaint();
                return;
            }
            stCode.skillBusy = false;
            if (!r.found.length) {
                stCode.skillErr = (r.errs && r.errs.length)
                    ? ('取回来了，但装不了：\n· ' + r.errs.join('\n· '))
                    : '取回来了，但里面没有能用的 skill（名字解析不出来）。';
                stCode.skillMsg = '';
                stCodeRepaint();
                return;
            }
            stCode.skillMsg = r.note || '';
            await stCodeSkillsApply(r.found, 0, '从链接 ', r.errs);
        }

        function stCodeSkillDrop(name) {
            const key = String(name || '');
            stCode.skills = stCode.skills.filter(s => s.name !== key);
            stCodeSaveSkills();
            stCodeRepaint();
            stCodeFlash('已移除 skill：' + key);
        }

        function stCodeSkillClear() {
            if (!stCode.skills.length) return;
            if (!window.confirm('清空全部 ' + stCode.skills.length +
                ' 个 skill？（只是从本机浏览器里删掉，磁盘上的文件不动）')) return;
            stCode.skills = [];
            stCodeSaveSkills();
            stCodeRepaint();
        }

