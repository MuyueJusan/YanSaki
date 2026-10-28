        // ===== 世界书：SillyTavern 的常量（照抄，名字保持一致好对照源码）=====
        const WI_LOGIC = { AND_ANY: 0, NOT_ALL: 1, NOT_ANY: 2, AND_ALL: 3 };
        const WI_DEFAULT_DEPTH = 4;             // ST DEFAULT_DEPTH
        const WI_DEFAULT_ORDER = 100;           // ST newWorldInfoEntryDefinition.order
        const WI_DEFAULT_WEIGHT = 100;          // ST DEFAULT_WEIGHT
        const WI_MAX_SCAN_DEPTH = 1000;         // ST MAX_SCAN_DEPTH
        const WI_MAX_INJECTION_DEPTH = 10000;   // ST MAX_INJECTION_DEPTH
        const WI_KNOWN_DECORATORS = ['@@activate', '@@dont_activate'];
        const WI_GENERATION_TRIGGERS = ['normal', 'continue', 'impersonate', 'swipe', 'regenerate', 'quiet'];
        // 本应用只有「普通生成」一种触发方式，所以 triggers 过滤器只会放行 normal
        const WI_GENERATION_TYPE = 'normal';
        const WI_SCAN_STATE = { NONE: 0, INITIAL: 1, RECURSION: 2, MIN_ACTIVATIONS: 3 };

        // 上面那个 BUILTIN_PRESETS 是照着 ST 的 JSON 手抄的原始数据，字段不全
        // （没有 injectionTrigger 之类）。就地过一遍 normalizePromptSlot 补全，
        // 免得后面拼装时读到 undefined。
        // 放在这里而不是紧跟字面量，是因为 normalizePromptSlot 要用到上面那些 WI 常量
        BUILTIN_PRESETS.forEach(function (p) {
            p.prompts = p.prompts.map(function (x, i) { return normalizePromptSlot(x, i); });
            p.order = p.order
                .filter(function (o) { return o && o.identifier; })
                .map(function (o) { return { identifier: String(o.identifier), enabled: o.enabled !== false }; });
        });

        // 选中的预设 id 指向不存在的东西时（预设被删了、导入的配置坏了）退回内置默认，
        // 顺手把配置改回去，免得一直挂着一个无效 id
        (function ensureActivePresetId() {
            const id = String(aiConfig.tavernPresetId || '');
            const known = BUILTIN_PRESETS.some(function (p) { return p.id === id; }) ||
                (aiConfig.tavernPresets || []).some(function (p) { return p.id === id; });
            if (!known) aiConfig.tavernPresetId = BUILTIN_PRESETS[0].id;
        })();

        function tavernEnabled() {
            // 只有世界书、没有角色卡也应该能用（世界书本来就是独立可用的）
            return aiConfig.tavernEnabled === true && (!!aiConfig.tavernCard || !!getLoreBook());
        }

        function getLoreBook() {
            return aiConfig.tavernLore || null;
        }

        function persistTavern() {
            try {
                aiPersist();
                return true;
            } catch (e) {
                // 卡太大时 localStorage 会爆配额
                setTavernStatus('⚠️ 保存失败（可能超出浏览器存储上限）：' + e.message, 'err');
                return false;
            }
        }

        function setTavernStatus(msg, kind) {
            const el = document.getElementById('ai-tavern-status');
            if (!el) return;
            el.textContent = msg || '';
            el.className = 'ai-tavern-status' + (kind ? ' ' + kind : '');
        }

        // 世界书 JSON 顶层的 scan_depth / recursive_scanning 是「书里声明的」设置。
        // SillyTavern 导入世界书时并不会采纳它们（那些是全局设置，不属于书），
        // 所以这里也不自动套用，只在面板上显示出来，要用请自己去全局设置里改。
        // 这个函数保留成空壳，是为了让调用点继续显式表达「这里本可以采纳、但我们选择不采纳」
        function adoptBookSettings(book) {
            return book ? wiBookDeclaredNote(book) : '';
        }

        // 把书里声明的、但 ST 不会自动采纳的设置写成一句提示
        function wiBookDeclaredNote(book) {
            if (!book) return '';
            const bits = [];
            if (book.declaredScanDepth != null) bits.push('扫描深度 ' + book.declaredScanDepth);
            if (book.declaredRecursive) bits.push('递归扫描');
            if (book.declaredTokenBudget != null && book.declaredTokenBudget > 0) {
                bits.push('token 预算 ' + book.declaredTokenBudget);
            }
            return bits.length ? bits.join(' / ') : '';
        }

        // 角色卡 / 世界书内容里的宏：无条件展开。
        // 这些是真正发给模型的内容，漏出 {{char}} 字面量就是 bug。
        function applyCardMacros(text) {
            if (!text) return text;
            const ctx = getMacroContext();
            const addr = (ctx.enabled && ctx.address) ? ctx.address : '你';
            return String(text).split('{{char}}').join(ctx.charName).split('{{user}}').join(addr);
        }

