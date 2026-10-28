        // —— 任务清单（set_tasks 工具画的）——
        // 只换清单那一块。⚠ **不能 stCodeRepaint()** —— 那会重建整个 pane，
        //   而模型跑工具的时候用户可能正在输入框里打字，一重建字就没了
        function stCodeTasksRefresh() {
            const el = document.getElementById('st-code-tasks');
            if (el) el.innerHTML = stCodeTasksHtml();
        }

        function stCodeTasksHtml() {
            const list = (stCodeSession().tasks || []);
            if (!list.length) return '';
            const done = list.filter(x => x.status === 'done').length;
            // 默认**展开** —— 它是「正在进行中」的东西，藏起来就没意义了。
            // ⚠ 判据写成 !== false（不是真值判断）：open 里没这个键时要当展开
            const open = stCode.open.tasks !== false;
            return '<details class="st-code-tasks"' + (open ? ' open' : '') +
                ' ontoggle="stCodeMenuToggle(\'tasks\', this.open)">' +
                '<summary>📋 计划 <b>' + done + '/' + list.length + '</b>' +
                    (done === list.length ? ' · 全部完成' : '') + '</summary>' +
                '<ol>' + list.map(t => {
                    const st = ST_CODE_TASK_ST.filter(x => x.id === t.status)[0] || ST_CODE_TASK_ST[0];
                    return '<li class="st-tk-' + st.id + '"><span>' + st.ico + '</span>' +
                        '<span>' + escapeHtml(t.text) + '</span></li>';
                }).join('') + '</ol></details>';
        }

