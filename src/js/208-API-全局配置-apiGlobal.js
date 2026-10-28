        // ==========================================================================
        // API 全局配置（apiGlobal）
        //
        // 动机：【ai对话】与【角色卡编写器】原先各自存一份 API 配置，两边都要填一遍 Key。
        // 现在抽出一份**全局**配置当唯一真相源：
        //   · 主页的【🔌 API 全局配置】按钮改它（键 apiGlobalCfg）
        //   · 【ai对话】默认「跟随全局」；想分开也能切「独立配置」（自己那份存在 aiConfig.own）
        //   · 【角色卡编写器】的「跟随」一律指向它（**不再指向 AI 对话**）
        //
        // ⚠ 关键设计：`aiConfig` 顶层的 API 字段仍然是**生效值**。
        //   全站 40 多个读点（aiConfig.apiKey / aiConfig.model …）一行都不用改 ——
        //   只在「载入时」和「全局配置保存后」调一次 aiApplyEffective() 把生效值刷进去。
        //   要是在每个读点都改成「按来源取」，漏一处就是一处静默的旧值。
        //
        // ⚠ 真相源与生效值必须分清，否则会出现「改了、刷新后又变回去」：
        //   跟随全局 ⇒ 真相源 = apiGlobal；独立 ⇒ 真相源 = aiConfig.own。
        //   aiConfig 顶层永远是**算出来的**，不是用户直接写的。
        // ==========================================================================
        const API_GLOBAL_KEY = 'apiGlobalCfg';

        // 全局配置管的字段。**白名单** —— 加字段就要同时改这里，
        // 免得 apiGlobalPick 静默漏抄（漏抄 = 切来源时那一格不跟着走）
        // ⚠ 后四个是 Google Vertex AI 专用（快速模式只用 authMode；完整模式还要
        //   project / location / saJson）。它们跟其他字段一样参与「跟随 / 独立」，
        //   否则会出现「全局面板配好了 Vertex，【ai对话】一跟随就退回 OpenAI」
        const API_GLOBAL_FIELDS = [
            'provider', 'baseUrl', 'apiKey', 'model',
            'temperature', 'maxTokens', 'stream', 'firstSeg',
            'authMode', 'project', 'location', 'saJson'
        ];

        const API_GLOBAL_DEFAULTS = {
            provider: 'openai',
            baseUrl: 'https://api.openai.com/v1',
            apiKey: '',
            model: '',
            models: [],              // 「获取模型」拉到的列表（缓存，方便下次直接选）
            temperature: 0.7,
            maxTokens: 1024,
            stream: true,
            firstSeg: '',
            // —— Google Vertex AI ——
            // 'key' = 快速模式（Express，只填 API Key）；'sa' = 完整模式（Service Account JSON）
            authMode: 'key',
            project: '',
            location: 'global',      // Vertex 的默认区域就是 global（端点不带地区前缀）
            saJson: ''               // 完整模式用的 Service Account 密钥 JSON 原文
        };

        let apiGlobal = Object.assign({}, API_GLOBAL_DEFAULTS);

        // 把生效值里的那几个字段抄出来（用来播种 / 同步 own 快照）
        function apiGlobalPick(src) {
            const o = {};
            API_GLOBAL_FIELDS.forEach(k => { o[k] = src[k]; });
            return o;
        }

        // 归一化。坏数据一律退回默认值，绝不让它把渲染炸掉
        function apiGlobalNormalize(raw) {
            const o = Object.assign({}, API_GLOBAL_DEFAULTS, raw || {});
            const known = AI_PROVIDERS.some(p => p.value === o.provider);
            o.provider = known ? o.provider : 'openai';
            o.baseUrl = String(o.baseUrl || '');
            // 服务商预设里自带 baseUrl，缺了就补上（只有自定义服务商才是空的）
            if (!o.baseUrl) {
                o.baseUrl = (AI_PROVIDERS.find(p => p.value === o.provider) || {}).baseUrl || '';
            }
            o.baseUrl = o.baseUrl.replace(/\/+$/, '');
            o.apiKey = String(o.apiKey || '');
            o.model = String(o.model || '');
            o.models = Array.isArray(o.models)
                ? o.models.map(String).filter(Boolean).slice(0, 500) : [];
            const t = Number(o.temperature);
            o.temperature = Number.isFinite(t) ? Math.max(0, Math.min(2, t)) : 0.7;
            const m = Number(o.maxTokens);
            o.maxTokens = Number.isFinite(m)
                ? Math.max(64, Math.min(32000, Math.trunc(m))) : 1024;
            o.stream = o.stream !== false;
            o.firstSeg = String(o.firstSeg || '');
            // Vertex 那几格。authMode 只认两个值，写坏了一律退回「快速模式」
            // —— 退回完整模式会让用户在没填 JSON 的情况下直接发不出请求
            o.authMode = (o.authMode === 'sa') ? 'sa' : 'key';
            o.project = String(o.project || '');
            o.location = String(o.location || '').trim() || 'global';
            o.saJson = String(o.saJson || '');
            return o;
        }

        // 载入。返回 true = 是**第一次**（没有 apiGlobalCfg，刚从现有 aiChatConfig 播种）
        function apiGlobalLoad() {
            let raw = null;
            try { raw = JSON.parse(localStorage.getItem(API_GLOBAL_KEY) || 'null'); } catch (e) {}
            if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
                apiGlobal = apiGlobalNormalize(raw);
                return false;
            }
            // 播种：把用户现在这份配置的 API 字段 + 第一段直接搬进全局 ——
            // 外观和效果跟升级前一模一样，只是从此全局成了唯一可改的地方
            apiGlobal = apiGlobalNormalize(apiGlobalPick(aiConfig));
            return true;
        }

        function apiGlobalPersist() {
            try { localStorage.setItem(API_GLOBAL_KEY, JSON.stringify(apiGlobal)); return true; }
            catch (e) { return false; }
        }

        // 把「真相源」刷进 aiConfig 顶层的生效值。
        // ⚠ 只有这几个字段会被覆盖 —— systemPrompt / 酒馆模式那一大堆仍归 aiConfig 自己管
        function aiApplyEffective() {
            const src = (aiConfig.followGlobal === false) ? (aiConfig.own || {}) : apiGlobal;
            API_GLOBAL_FIELDS.forEach(k => { if (src[k] !== undefined) aiConfig[k] = src[k]; });
        }

        // 用户**真的在【ai对话】里改了**这几个字段 ⇒ 独立模式下同步进 own 快照。
        // ⚠ 不能放进 aiPersist 无条件跑：切来源时会把用户先前那份独立配置悄悄冲掉
        function aiSyncOwnFromEffective() {
            if (aiConfig.followGlobal === false) aiConfig.own = apiGlobalPick(aiConfig);
        }

        // 保存 aiConfig 的唯一入口。原先 5 处直接写 'aiChatConfig' 的地方都走这里
        function aiPersist() {
            try { localStorage.setItem('aiChatConfig', JSON.stringify(aiConfig)); } catch (e) {}
        }

        // 点「保存 / 应用」：把输入框读出来的对象接回 aiConfig。
        // ⚠ 跟随模式下输入框是**只读镜像**，镜像值不该反灌成真相源 —— 刷一次生效值盖掉；
        //   独立模式下才把用户真正填的东西写进 own 快照
        function aiCommitInputs(cfg) {
            aiConfig = cfg;
            if (aiConfig.followGlobal !== false) aiApplyEffective();
            aiSyncOwnFromEffective();
            aiPersist();
        }

