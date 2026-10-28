        // ==========================================================================
        // 编写器 · 人设生成器
        //
        // 写一句设定，让 AI 按一份**模板**逐项填好，生成一整份人设。
        //
        // 三个设计决定：
        // ① 模板**可改、存浏览器本地**（localStorage 键 stPersonaTpl），**不写进卡** ——
        //    跟 AI 配置同一条理由：它是用户自己的偏好，不是角色卡的一部分。
        // ② 生成结果**不自动进卡**。先在预览格里给你看、可以手改，点「写入」才进角色描述 ——
        //    「生成的东西必须先能反悔」，跟「AI 生成预制块」同一条规矩。
        // ③ 写入前如果角色描述非空，**弹 confirm**。覆盖别人手写的内容是这一族里最不可逆的
        //    动作，不能静默做；追加那条路不用问（它不破坏已有内容）。
        // ==========================================================================

        const ST_PERSONA_TPL_KEY = 'stPersonaTpl';
        const ST_PERSONA_REQ_MAX = 2000;
        const ST_PERSONA_TPL_MAX = 8000;
        const ST_PERSONA_OUT_MAX = 20000;
        // 「参考素材」（世界书条目）的总字符预算。跟上面三条不是一回事：
        // 那三条限的是**用户自己敲的字**，这条限的是**从书里搬来的正文** ——
        // 勾 30 条 2000 字的条目就是 6 万字，直接把这轮上下文吃光。
        // 超了不报错，是**少喂几条并说出来**（见 stPersonaLoreResolve 的 truncated）
        const ST_PERSONA_LORE_MAX = 12000;

        // 默认模板。**逐字照用户给的那一份**，半角 / 全角冒号混用是原文如此 ——
        // 别「顺手统一」成一种：它是给人看的填空稿，用户自己写的那份才是准的。
        // ⚠ 这份常量同时也是「恢复默认模板」的目标，改它等于改默认值。
        const ST_PERSONA_TPL_DEFAULT = [
            '基本信息:',
            '姓名:',
            '年龄:',
            '性别:',
            '身高:',
            '身份:',
            '背景故事:',
            '外貌:',
            '发型:',
            '眼睛:',
            '肤色:',
            '脸型:',
            '体型:',
            '三围：',
            '气味：',
            '衣着风格:',
            '校园/工作的日常装：',
            '- 风格：',
            '- 标志性穿着：',
            '- 配饰习惯：',
            '休闲装:',
            '- 风格：',
            '- 标志性穿着：',
            '- 配饰习惯：',
            '居家服:',
            '- 风格：',
            '- 标志性穿着：',
            '- 配饰习惯：',
            '泳装：',
            '内衣：',
            '性格:',
            '核心特质:',
            '恋爱特质:',
            '生活习惯:',
            '情绪表现:',
            '愤怒时:',
            '高兴时:',
            '缺点弱点:',
            '喜好厌恶:',
            '喜欢:',
            '讨厌:',
            '补充：'
        ].join('\n');

        // 懒加载：只有「没读过」才去读 localStorage。
        // 空串 = 没自定义过 ⇒ 用默认（所以清空模板 = 回到默认，不是「用空模板」）
        function stPersonaTpl() {
            if (typeof stEditor.personaTpl !== 'string') {
                let v = null;
                try { v = localStorage.getItem(ST_PERSONA_TPL_KEY); } catch (e) {}
                stEditor.personaTpl = (typeof v === 'string' && v.trim())
                    ? v : ST_PERSONA_TPL_DEFAULT;
            }
            // ⚠ 内存里是空串时也要**回落默认**。用户把框清空 → stPersonaTplSet 把键删了，
            //   但内存里留下一个 ''；如果这里原样返回它，面板上会同时出现三种互相矛盾的说法：
            //   标签写「（默认）」（它问的是 localStorage）、框里是空的、点生成又报「模板是空的」。
            //   回落之后三者一致 —— 这也正是 hint 承诺的那句「清空 = 回到默认模板」。
            return stEditor.personaTpl.trim() ? stEditor.personaTpl : ST_PERSONA_TPL_DEFAULT;
        }

        // 「现在用的是不是默认模板」要**问 localStorage**，不能拿当前值跟常量比 ——
        // 用户把自定义模板改得跟默认一模一样时，前者说「已自定义」、后者说「默认」，
        // 而「恢复默认」按下去的效果一样，两种说法都没错，但**显示要跟存储一致**
        function stPersonaTplIsDefault() {
            try {
                const v = localStorage.getItem(ST_PERSONA_TPL_KEY);
                return !(typeof v === 'string' && v.trim());
            } catch (e) { return true; }
        }

        function stPersonaReqSet(v) {
            stEditor.personaReq = String(v == null ? '' : v).slice(0, ST_PERSONA_REQ_MAX);
        }

        // 「要不要把这张卡的名字当人物姓名」。默认开。
        // ⚠ 判据写成 `!== false` 而不是 `=== true` —— 没这个键的旧状态也按「开」算。
        //   写成 `=== true` 的话，升级上来的用户会突然发现卡名不再喂给 AI 了：
        //   一个**静默的行为变化**，而面板上那个勾选框照样显示「勾着」。
        function stPersonaNameUse() {
            return stEditor.personaNameUse !== false;
        }

        function stPersonaNameUseSet(v) {
            stEditor.personaNameUse = v !== false;
        }

        function stPersonaOutSet(v) {
            stEditor.personaOut = String(v == null ? '' : v).slice(0, ST_PERSONA_OUT_MAX);
        }

        function stPersonaTplSet(v) {
            const s = String(v == null ? '' : v).slice(0, ST_PERSONA_TPL_MAX);
            stEditor.personaTpl = s;
            // ⚠ 清空时**删键**而不是存空串 —— 存了空串，「是不是默认」就再也分不出来，
            //   下次打开会显示一份空模板，而 AI 那边等于没模板可用
            try {
                if (!s.trim()) localStorage.removeItem(ST_PERSONA_TPL_KEY);
                else localStorage.setItem(ST_PERSONA_TPL_KEY, s);
            } catch (e) {}
        }

        function stPersonaTplReset() {
            stEditor.personaTpl = ST_PERSONA_TPL_DEFAULT;
            try { localStorage.removeItem(ST_PERSONA_TPL_KEY); } catch (e) {}
            stRerender();
            stExportMsg('✅ 模板已恢复默认（' + stPersonaLabels(ST_PERSONA_TPL_DEFAULT).length +
                ' 项）。', 'ok', 'persona');
        }

        // 折叠态写进 DOM 的**唯一**一处 —— 跟 stSyncTabsCollapsed 同一个理由：
        // 容器上的 class 和展开键上的箭头分两处写，漏掉任何一处的症状都是「状态不对」。
        //
        // ⚠ 这里**不调 stRerender()**：重绘会把整个 pane 重建，新元素一出生就带着最终样式，
        //   `grid-template-rows` 的过渡**没有起点**，动画直接跳掉（看起来像根本没做折叠）。
        //   只改 class，让浏览器自己补间；状态照样记在 stEditor 里，下次重绘能还原。
        function stSyncPersonaTplOpen() {
            const on = stEditor.personaTplOpen === true;
            const box = document.getElementById('st-persona-tpl-fold');
            if (box) box.classList.toggle('st-fold-open', on);
            const btn = document.getElementById('st-persona-tpl-toggle');
            if (btn) btn.setAttribute('aria-expanded', on ? 'true' : 'false');
        }

        function stPersonaTplToggle() {
            stEditor.personaTplOpen = !(stEditor.personaTplOpen === true);
            stSyncPersonaTplOpen();
        }

        // 从模板里数出「有哪些字段」——只认**以冒号结尾**的行（模板是空稿，值还没填）。
        // 两个用途：① 面板上显示「N 项」；② 生成完拿它数「模型漏了几项」
        function stPersonaLabels(tpl) {
            const out = [];
            String(tpl || '').split('\n').forEach(line => {
                const m = line.match(/^[\s\-]*([^:：\n]{1,12})[:：]\s*$/);
                if (!m) return;
                const k = m[1].trim();
                if (k && out.indexOf(k) < 0) out.push(k);
            });
            return out;
        }

        function stPersonaSysPrompt() {
            return [
                '你是角色卡「人设」写手。用户会给你一个设定或要求，你按**用户给的模板**逐项填好，',
                '输出一整份人设。',
                '',
                '## 硬规则',
                '1. **只输出填好的人设本身**。不要解释、不要寒暄、不要 ``` 围栏、不要重复模板以外的标题。',
                '2. **严格照模板的结构和顺序**：模板里每一行都要保留，内容接在原来的冒号后面。',
                '   形如 `姓名:` 的行 → `姓名: 艾莉丝`；以 `- ` 开头的子项**保持缩进和顺序**。',
                '3. 模板里**没有**的字段不要自己加。用户没提到的细节你来补，但要**跟用户给的设定一致**。',
                '4. 每一格都要写实：外貌 / 衣着那几项给具体的颜色、材质、款式，',
                '   别写「普通」「随意」「看情况」这种空话；身高 / 三围这类数值给具体数字，别写「未知」。',
                '5. 用中文。语气克制，不要对用户说话、不要加点评。',
                '6. 整份长度控制在 1200 字以内。'
            ].join('\n');
        }

