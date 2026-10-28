        // —— 同步：结构是唯一事实来源 ——
        // 只有当「本编辑器接管了这张卡的 MVU」时才回写。
        // 否则一打开别人的卡，就会把人家手写的 Zod / initvar 换成我们的格式
        function stMvuSync() {
            if (!stEditor.mvuOwn) return false;
            const c = stEditor.card;
            if (!c || !stMvuCount(c.mvu.nodes)) return false;
            const d = stMvuDetect();
            let touched = false;
            if (d.zodScript) {
                const code = stMvuZodCode();
                if (d.zodScript.content !== code) { d.zodScript.content = code; touched = true; }
            }
            if (d.initvar) {
                const y = stMvuInitVarYaml();
                if (d.initvar.content !== y) { d.initvar.content = y; touched = true; }
            }
            return touched;
        }

        // 卡里 Zod 的可读性：'none'（没有）/ 'ok'（读得回来，带 nodes）/
        // 'unparsed'（有但认不出）。接管与否**只看这一件事** ——
        // 读得回来才谈得上「编辑当前 MVU」，读不回来就只能不碰。
        function stMvuZodParsed() {
            const d = stMvuDetect();
            if (!d.zodScript) return { state: 'none' };
            const parsed = stMvuParseZod(d.zodScript.content);
            // ⚠ 空数组 ≠ 解析失败。stMvuParseZod 只在**语法读不下去**时返回 null，
            //   一个真的空的 z.object({}) 会老老实实返回 []。这里必须靠 null 判失败 ——
            //   早先写成 !parsed.length 的话，本编辑器自己给空树生成的那份 Zod
            //   （z.object({\n})）会被判成「认不出来」，于是刚装完 MVU 再点一次
            //   「一键添加」就弹「没有接管」的警告，还会把 mvuOwn 关掉
            if (!parsed) return { state: 'unparsed' };
            return { state: 'ok', nodes: parsed };
        }

        // 把卡里已有的 Zod 反推回变量树（只在树为空时填，绝不覆盖已有内容）
        function stMvuAdopt() {
            const c = stEditor.card;
            if (!c || stMvuCount(c.mvu.nodes)) return;
            const z = stMvuZodParsed();
            if (z.state !== 'ok') return;
            c.mvu.nodes = z.nodes.map(stMvuNodeFromRaw);
        }

        // 导入 / 从酒馆模式载入一张卡之后调用：重判 mvuOwn 并尝试接管已有的 MVU 结构。
        // 两个必须做的理由：
        //   ① mvuOwn 会带着**上一张卡**的值过来 —— 上一张是自己的卡（true），
        //      导入一张别人的 MVU 卡后仍是 true，随手改一下结构就覆盖了原作者的东西
        //   ② 选中态 / 展开态是按节点 id 记的，换了卡 id 全变了，不清会指向幽灵节点
        function stMvuAfterLoad() {
            stEditor.mvuOwn = false;
            stEditor.mvuSel = null;
            stEditor.mvuOpen = {};
            stEditor.sbOwn = false;
            stEditor.sbSel = '';
            stEditor.sbOpen = {};
            if (!stEditor.card) return;
            stMvuAdopt();
            // 卡里自带 MVU 且结构读得回来 → 接管，切到「MVU」页就能直接改
            if (stMvuZodParsed().state === 'ok') stEditor.mvuOwn = true;
            // 状态栏同理：只有能从正则里读回块列表才接管
            if (stSbAdopt()) stEditor.sbOwn = true;
        }

