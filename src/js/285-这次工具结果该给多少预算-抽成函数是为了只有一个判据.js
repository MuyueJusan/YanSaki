        // 这次工具结果该给多少预算。抽成函数是为了**只有一个判据** ——
        // 套件里直接断言它，不用为了验「只读给宽预算」去造一份 40000 字的结果
        function stCodeToolCap(name) {
            return ST_CODE_READ_TOOLS.indexOf(name) >= 0 ? ST_CODE_READ_CHARS : ST_CODE_TOOL_CHARS;
        }

        // 这个工具算不算「只读」—— 只读的**不占改卡次数**（另有连读上限兜着）。
        // ⚠ 工具型 skill 要看**权限**：没申请 card.write 的**碰不到卡**，所以它就是只读的。
        //   不这么判的话，一句「用骰子工具帮我算个随机数」会吃掉一次改卡预算 ——
        //   而那个工具根本改不了卡，用户只会觉得「怎么才问两句就不动了」。
        //   system 里写的是「read_* 这类只读工具不算在里面」，这里得跟它对得上。
        // ⚠ 反过来是**故意保守**的：申请了 card.write 的 skill 一律按改卡算，
        //   哪怕它这一次只读 —— 猜错方向的代价不对称
        function stCodeIsReadTool(name) {
            if (ST_CODE_READ_TOOLS.indexOf(name) >= 0) return true;
            const sk = stCode.skills.filter(s => s.kind === 'tool' && s.tool &&
                s.tool.name === name)[0];
            return !!(sk && stCodeSkillPermsOf(sk).indexOf('card.write') < 0);
        }

        // 外面再包一层：工具自己炸了不能把整个 Agent 循环带下去，
        // 而是要把「炸了」这件事当成一次工具结果喂回给模型，让它自己决定下一步
        // ⚠ 这里是 **async** 的 —— fetch_url 要真的发请求。调用方必须 await，
        //   漏了 await 不会报错，只会把 `{}` 当成工具结果喂回去（见下面的 for...of）
        async function stCodeTool(name, args) {
            const a = args && typeof args === 'object' ? args : {};
            // ⚠ 用 stCodeToolDefs() 而不是 ST_CODE_TOOLS —— 工具型 skill 不在静态表里，
            //   拿静态表判的话模型永远「调用了一个不存在的工具」
            if (!stCodeToolDefs().some(t => t.name === name)) {
                return { ok: false, text: '没有这个工具：' + name + '。可用工具：' +
                    stCodeToolDefs().map(t => t.name).join(' / ') };
            }
            try {
                const r = await stCodeToolRun(name, a);
                let text = String(r.text == null ? '' : r.text);
                // 读整份文档的那几个给更宽的预算 —— 它们的输出是要被写回去的
                const cap = stCodeToolCap(name);
                if (text.length > cap) {
                    text = text.slice(0, cap) + '\n' + ST_CODE_CUT_MARK;
                }
                return { ok: r.ok !== false, text: text, touched: r.touched || '' };
            } catch (e) {
                return { ok: false, text: '工具执行出错：' + ((e && e.message) || e) };
            }
        }

