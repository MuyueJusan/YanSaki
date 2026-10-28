        // ===== 用户人设描述（personaDescription）=====
        // ST 的 power_user.persona_description：一段「用户是谁」的说明。
        // 有五种去处（personas.js:88），这里只是取值 / 定位，拼装逻辑在
        // anBlockText（夹作者注释）和 buildRequestPlan（提示词内 / 对话内）
        //
        // 正文取「🎭 用户人设」里的<b>你的昵称</b> —— 酒馆模式下用户身份只有这一个
        // 输入项（见 syncUserMacroUI 的锁定逻辑），人设描述就跟着它走。
        // 位置 / 深度 / 角色仍然是独立设置，各管各的
        function personaRaw() {
            return String(aiConfig.userName || '').trim();
        }

        function personaText() {
            return applyCardMacros(personaRaw());
        }

        function personaPosition() {
            const v = Number(aiConfig.tavernPersonaPosition);
            return PERSONA_POS_LIST.indexOf(v) >= 0 ? v : PERSONA_POS.inPrompt;
        }

        function personaDepth() {
            const v = Number(aiConfig.tavernPersonaDepth);
            return Number.isFinite(v)
                ? Math.max(0, Math.min(WI_MAX_INJECTION_DEPTH, Math.trunc(v)))
                : PERSONA_DEFAULT_DEPTH;
        }

        function personaRole() {
            const v = Number(aiConfig.tavernPersonaRole);
            return (v === 1 || v === 2) ? v : PERSONA_DEFAULT_ROLE;
        }

        // 人设这一轮是不是搭着作者注释走（位置 2 / 3）。
        // ST 里这种位置只在 shouldWIAddPrompt 为真时才写进去（script.js:3213），
        // 所以注释不插的轮次，人设也跟着一起消失 —— 照抄
        function personaRidesAn() {
            const p = personaPosition();
            return !!personaRaw() && anShouldInsert() &&
                (p === PERSONA_POS.topAn || p === PERSONA_POS.bottomAn);
        }

