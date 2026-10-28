        // ==========================================================================
        // SillyTavern 风格 {{user}} 宏
        //   {{user}} → 由「昵称 + 称呼方式」计算出的称呼
        //   {{char}} → AI 角色名
        // ==========================================================================
        function escapeHtml(str) {
            return String(str).replace(/[&<>"']/g, c => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
            }[c]));
        }

        // 根据昵称与称呼方式算出最终称呼（纯函数）
        function buildUserAddress(m) {
            const name = (m.userName || '').trim();
            if (!name) return '';
            if (m.addressStyle === 'prefix') return (m.addressAffix || '') + name;
            if (m.addressStyle === 'suffix') return name + (m.addressAffix || '');
            if (m.addressStyle === 'custom') return (m.addressTemplate || '{{user}}').split('{{user}}').join(name);
            return name;
        }

        function readUserMacroInputs() {
            return {
                userMacroEnabled: document.getElementById('ai-user-macro').checked,
                userName: document.getElementById('ai-user-name').value.trim(),
                charName: document.getElementById('ai-char-name').value.trim(),
                addressStyle: document.getElementById('ai-address-style').value,
                addressAffix: document.getElementById('ai-address-affix').value.trim(),
                addressTemplate: document.getElementById('ai-address-template').value,
                addressInject: document.getElementById('ai-address-inject').checked
            };
        }

        // 只回写宏相关字段，避免顺手把未保存的 API Key / 模型一起落盘
        function persistUserMacro() {
            Object.assign(aiConfig, readUserMacroInputs());
            aiPersist();
        }

        // 把 aiConfig 里的宏字段回填到控件上。
        // includeName = false 时不碰昵称输入框（那是用户正在打字的地方，
        // 程序化赋值会顶掉光标位置）
        function fillUserMacroInputs(includeName) {
            const g = id => document.getElementById(id);
            g('ai-user-macro').checked = aiConfig.userMacroEnabled !== false;
            if (includeName !== false) g('ai-user-name').value = aiConfig.userName || '';
            g('ai-char-name').value = aiConfig.charName || '';
            g('ai-address-style').value = aiConfig.addressStyle || 'plain';
            g('ai-address-affix').value = aiConfig.addressAffix || '';
            g('ai-address-template').value = aiConfig.addressTemplate || '';
            g('ai-address-inject').checked = aiConfig.addressInject !== false;
        }

        // 酒馆模式下「用户人设」里只剩昵称有用：
        //   · 称呼修饰 / 称呼模板 / 自动注入称呼 —— 都是普通模式的 {{user}} 宏玩法，
        //     而酒馆模式根本不发系统提示词，自动注入那条无处可去
        //   · AI 角色名 —— 酒馆模式下 {{char}} 取角色卡的名字（getMacroContext 已经这么做了）
        // 所以进酒馆模式时把这些输入项清成「直接称呼昵称」的等价状态，并锁住不给改。
        // 昵称本身不动 —— 它是那个例外，人设描述也取自它
        const USER_MACRO_LOCK_IDS = ['ai-char-name', 'ai-address-style',
            'ai-address-affix', 'ai-address-template', 'ai-address-inject'];

        // 返回有没有真的改动，好决定要不要落盘
        function tavernLockUserMacro() {
            const next = {
                // 昵称要靠宏开关才会展开，所以这里只能锁成「开」，不能清成「关」
                userMacroEnabled: true,
                charName: '',
                addressStyle: 'plain',
                addressAffix: '',
                addressTemplate: '',
                addressInject: false
            };
            let changed = false;
            Object.keys(next).forEach(k => {
                if (aiConfig[k] !== next[k]) { aiConfig[k] = next[k]; changed = true; }
            });
            return changed;
        }

        // 按酒馆模式开关，把上面那几个控件锁住 / 解锁
        function applyUserMacroLock() {
            const locked = tavernEnabled();
            const group = document.getElementById('ai-user-macro-group');
            if (group) group.classList.toggle('ai-macro-locked', locked);
            USER_MACRO_LOCK_IDS.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.disabled = locked;
            });
            const toggle = document.getElementById('ai-user-macro');
            if (toggle) toggle.disabled = locked;
            const hint = document.getElementById('ai-macro-locked-hint');
            if (hint) hint.style.display = locked ? '' : 'none';
        }

        // 发送时使用的宏上下文（以 aiConfig 为准）
        function getMacroContext() {
            const card = aiConfig.tavernCard;
            const tavernName = (tavernEnabled() && card && card.name) ? String(card.name).trim() : '';
            return {
                enabled: aiConfig.userMacroEnabled !== false,
                address: buildUserAddress(aiConfig),
                // 酒馆模式下 {{char}} 应该是角色卡里的名字，而不是设置里那个
                charName: tavernName || ((aiConfig.charName || '').trim() || 'Saki')
            };
        }

        // 展开文本中的宏；未启用时原样返回
        function applyUserMacros(text) {
            if (!text) return text;
            const ctx = getMacroContext();
            if (!ctx.enabled) return text;
            return text
                .split('{{user}}').join(ctx.address || '主人')
                .split('{{char}}').join(ctx.charName);
        }

        // 组装最终系统提示词：宏替换 + 可选注入称呼指令
        function buildSystemPrompt() {
            const raw = aiConfig.systemPrompt || '';
            const ctx = getMacroContext();
            let sys = applyUserMacros(raw);
            if (ctx.enabled && aiConfig.addressInject !== false && ctx.address && raw.indexOf('{{user}}') < 0) {
                sys = (sys ? sys + '\n\n' : '') + `（请用「${ctx.address}」来称呼我。）`;
            }
            return sys;
        }

        function syncUserMacroUI() {
            // 酒馆模式：用户身份只留昵称 —— 把其余的宏玩法清空并锁住。
            // 放在这里而不是只放在 onTavernToggle，是因为「刷新时酒馆模式本来就是开的」
            // 这条路也要走一遍，否则会把上次存的旧值原样留着
            if (tavernEnabled()) {
                const changed = tavernLockUserMacro();
                fillUserMacroInputs(false);
                if (changed) persistUserMacro();
            }
            applyUserMacroLock();

            // 昵称变了的话，「用户人设描述」面板与预览里的那一行要跟着换
            refreshPersonaMirror();

            const m = readUserMacroInputs();

            // 按称呼方式显隐「修饰词 / 模板」输入框
            const affixField = document.getElementById('ai-address-affix-field');
            const tplField = document.getElementById('ai-address-template-field');
            const affixLabel = document.getElementById('ai-address-affix-label');
            const affixInput = document.getElementById('ai-address-affix');
            const showAffix = (m.addressStyle === 'prefix' || m.addressStyle === 'suffix');
            affixField.style.display = showAffix ? '' : 'none';
            tplField.style.display = (m.addressStyle === 'custom') ? '' : 'none';
            if (showAffix) {
                const isPrefix = (m.addressStyle === 'prefix');
                affixLabel.textContent = isPrefix ? '前缀修饰词' : '后缀修饰词';
                affixInput.placeholder = isPrefix ? '小' : '酱';
            }

            // 关闭宏时整块置灰
            document.getElementById('ai-macro-body').classList.toggle('ai-macro-off', !m.userMacroEnabled);

            // 实时预览
            const preview = document.getElementById('ai-macro-preview');
            if (!m.userMacroEnabled) {
                preview.innerHTML = '已关闭 · 提示词中的 <code>{{user}}</code> / <code>{{char}}</code> 会原样发送给模型。';
                return;
            }
            const address = buildUserAddress(m);
            // {{char}} 走 getMacroContext，酒馆模式下它会自动取角色卡的名字
            const ctx = getMacroContext();
            preview.innerHTML = address
                ? `AI 将称呼你为：<b>${escapeHtml(address)}</b>　·　AI 角色名：<b>${escapeHtml(ctx.charName)}</b>` +
                  (tavernEnabled() ? '（酒馆模式取角色卡名）' : '')
                : '请先填写你的昵称，否则 <code>{{user}}</code> 会展开为「主人」。';
        }

        function onUserMacroFieldChange() {
            persistUserMacro();
            syncUserMacroUI();
        }

        function insertAiMacro(macro) {
            const ta = document.getElementById('ai-system-prompt');
            const start = (typeof ta.selectionStart === 'number') ? ta.selectionStart : ta.value.length;
            const end = (typeof ta.selectionEnd === 'number') ? ta.selectionEnd : ta.value.length;
            ta.value = ta.value.slice(0, start) + macro + ta.value.slice(end);
            ta.selectionStart = ta.selectionEnd = start + macro.length;
            ta.focus();
            // 这里是程序化赋值，不会触发 oninput —— 得手动同步一次预设状态
            onSystemPromptInput();
        }

