        // ===== 作者注释（Author's Note）=====
        // ST 的 setFloatingPrompt()：按「每 N 条用户消息插一次」决定这一轮要不要插注释。
        // 只有这一轮要插的时候，世界书的 ↑AT / ↓AT 才会跟着一起插
        // （wi.js:5268 那个 if (shouldWIAddPrompt) 就是这道门）
        function anInterval() {
            const v = Number(aiConfig.tavernAnInterval);
            return Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : AN_DEFAULT_INTERVAL;
        }

        function anShouldInsert() {
            const interval = anInterval();
            // ST 数的是用户消息条数
            let lastMessageNumber = chatHistory.filter(m => m && m.role === 'user').length;
            // interval 为 1 时无条件插入（ST 原样的短路）
            if (interval === 1) lastMessageNumber = 1;
            if (lastMessageNumber <= 0 || interval <= 0) return false;
            const messagesTillInsertion = lastMessageNumber >= interval
                ? (lastMessageNumber % interval)
                : (interval - lastMessageNumber);
            return messagesTillInsertion === 0;
        }

        function anDepth() {
            const v = Number(aiConfig.tavernAnDepth);
            return Number.isFinite(v) ? Math.max(0, Math.min(WI_MAX_INJECTION_DEPTH, Math.trunc(v))) : AN_DEFAULT_DEPTH;
        }

        function anRole() {
            const v = Number(aiConfig.tavernAnRole);
            return (v === 1 || v === 2) ? v : AN_DEFAULT_ROLE;
        }

        function anPosition() {
            const v = Number(aiConfig.tavernAnPosition);
            return (v === 0 || v === 2) ? v : AN_POS.inChat;
        }

        // ST world-info.js:5269-5270 的拼法，连「只去掉一层首尾换行」这个怪癖一起照抄：
        //   `${ANTopEntries.join('\n')}\n${originalAN}\n${ANBottomEntries.join('\n')}`
        //     .replace(/(^\n)|(\n$)/g, '')
        // 注意 ↑AT / ↓AT 用的都是升序（ST 入桶时是 unshift），所以这里按数组顺序 join
        function anBlockText(wi) {
            if (!anShouldInsert()) return '';
            const top = wi.anTop.map(e => e.content).join('\n');
            const bottom = wi.anBottom.map(e => e.content).join('\n');
            const an = String(aiConfig.tavernAnText || '');
            let raw = (top + '\n' + an + '\n' + bottom).replace(/(^\n)|(\n$)/g, '');

            // 人设位置是「作者注释上方 / 下方」时，人设会搭着注释一起注入。
            // ST 的调用顺序是 setFloatingPrompt(script.js:4619) → 世界书包 ↑AT/↓AT
            // (wi.js:5271) → addPersonaDescriptionExtensionPrompt(script.js:4684)，
            // 人设是<b>最后</b>才包上去的，所以它套在 ↑AT/↓AT 的<b>外面</b>，
            // 而且这一步 ST 没有再 replace 一次首尾换行：
            //   上方 → `${persona}\n${↑AT}\n${AN}\n${↓AT}`
            //   下方 → `${↑AT}\n${AN}\n${↓AT}\n${persona}`
            // 用 raw 而不是展开过宏的文本，免得跟注释一起被展开两遍
            const persona = personaRaw();
            if (persona) {
                const pPos = personaPosition();
                if (pPos === PERSONA_POS.topAn) raw = persona + '\n' + raw;
                else if (pPos === PERSONA_POS.bottomAn) raw = raw + '\n' + persona;
            }
            return applyCardMacros(raw);
        }

