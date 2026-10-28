        // ==========================================================================
        // 编写器 · AI 助手
        //
        // 跟【AI 对话】的配置是**两套东西**，靠 stAi.mode 二选一：
        //   · follow（默认）—— 直接借 **API 全局配置**（apiGlobal）那套
        //     provider / key / model，用户在全局面板改一次这边跟着变，不用重复填。
        //     ⚠ 借的是 apiGlobal，**不是【AI 对话】那套** —— 后者能切成「独立配置」，
        //       指向它的话编写器就会莫名其妙跟着对话跑
        //   · own —— 自己存一套（localStorage 键 stAiCfg），跟全局那套互不干扰
        //
        // ⚠ 配置**一律不进角色卡**。stAi 存在自己的 localStorage 键里，
        // 草稿（stCardDraft）和导出的 JSON 里都不会出现 API Key 的影子。
        //
        // 协议支持三种形状：
        //   · openai   —— /chat/completions（绝大多数服务商）
        //   · anthropic—— /messages（只有 Anthropic 自己）
        //   · gemini   —— generateContent（Google AI Studio 原生 / Vertex AI 两条路）
        // ⚠ 预设表（AI_PROVIDERS）里带 proto，这里的下拉直接读它
        // ==========================================================================

        const ST_AI_CFG_KEY = 'stAiCfg';
        const ST_AI_UI_KEY = 'stAiUiCfg';

        // ⚠ **不再单独维护一份** —— 指向上面那张全站唯一的 AI_PROVIDERS。
        //   留着这个名字是因为编写器里有 5 处引用它；改成一个 const 别名而不是
        //   把那些引用全改掉，是为了让这次改动的爆炸半径尽量小。
        const ST_AI_PROVIDERS = AI_PROVIDERS;

        // 协议显示名。加协议时**这里和 stAiRequest / stAiSseText / stAiFullText
        // 三处必须一起改** —— 只加这里就是「下拉里能选、发出去就 400」
        const ST_AI_PROTO_LABEL = {
            openai: 'OpenAI 兼容',
            anthropic: 'Anthropic',
            gemini: 'Gemini / Vertex 原生'
        };

        const ST_AI_DEFAULTS = {
            mode: 'follow',          // 'follow' = 借 API 全局配置那套；'own' = 自己一套
            provider: 'openai',
            proto: '',               // '' = 跟着服务商预设走
            baseUrl: '',             // 只有 provider = custom 时才用
            apiKey: '',
            model: '',
            models: [],              // 拉取到的模型列表（缓存，方便下次直接选）
            temperature: 0.8,
            maxTokens: 4096,
            stream: true,
            // 「第一段」：用户自己写、**一定排在发给模型最前面**的那一段。
            // 跟随模式下这一格不生效（现读 apiGlobal.firstSeg），只有独立配置才用它
            firstSeg: '',
            // —— Google Vertex AI（只在独立模式 + provider=vertex 时用到）——
            // 跟随模式下现读 apiGlobal，这几格跟 firstSeg 一样不生效
            authMode: 'key',         // 'key' = 快速模式；'sa' = 完整模式（Service Account）
            project: '',
            location: 'global',
            saJson: ''
        };

        // 扩写「要求」的预设。每一条都是一句写给模型的指令，可以多选叠加
        const ST_AI_REQ_PRESETS = [
            { id: 'detail', label: '详细化', text: '把每个设定点都展开写透：补具体细节、数字、例子、感官描写，篇幅至少是原素材的三倍。' },
            { id: 'yaml', label: 'YAML 化', text: 'content 用 YAML 组织（键: 值、列表、嵌套），缩进两个空格、不要用 Tab，字段名用英文小写下划线，值用中文。' },
            { id: 'struct', label: '结构化', text: 'content 按「概览 / 细节 / 交互 / 备注」四段组织，每段用一行小标题开头。' },
            { id: 'tighten', label: '精简', text: '只保留信息量最大的部分，删掉形容词堆砌和重复表述，每条正文控制在 120 字以内。' },
            { id: 'flavor', label: '润色语气', text: '不改变事实的前提下润色措辞，让文字更有画面感和代入感。' },
            { id: 'rule', label: '补规则', text: '补充可执行的判定规则：触发条件、数值变化、边界情况、失败后果。' },
            { id: 'rel', label: '补关系', text: '补充角色之间的关系、称呼方式、亲疏程度随剧情变化的走向。' },
            { id: 'place', label: '补场景', text: '补充地点、时间、天气、光线、气味等环境要素。' },
            { id: 'secret', label: '埋暗线', text: '为每条埋一条不直说的暗线，用「（伏笔：…）」标注在末尾。' },
            { id: 'keys', label: '优化关键词', text: '给每条配 3~6 个精准触发词，必须是会真实出现在对话里的具体名词，不要用「的」「我」「很」这类泛词。' },
            { id: 'dedup', label: '去重合并', text: '与已有条目重复的内容一律合并，不要换句话再说一遍同一件事。' },
            { id: 'zh', label: '中文输出', text: '除字段名之外全部用简体中文，不要夹英文句子或英文单词。' },
            { id: 'quote', label: '带示例台词', text: '每条正文末尾附 1~2 句该设定下角色会说的示例台词。' },
            { id: 'num', label: '带数值', text: '凡是能量化的都给出具体数值区间（好感度、体力、金钱、时间等）。' }
        ];

        // 氛围预设。'auto' 是「不指定」——让模型自己从素材里判断
        const ST_AI_MOOD_PRESETS = [
            { id: 'auto', label: '不指定' },
            { id: 'daily', label: '日常温馨' },
            { id: 'heal', label: '治愈温柔' },
            { id: 'tense', label: '紧张悬疑' },
            { id: 'dark', label: '黑暗沉重' },
            { id: 'funny', label: '搞笑轻松' },
            { id: 'romance', label: '浪漫暧昧' },
            { id: 'epic', label: '史诗壮阔' },
            { id: 'scifi', label: '赛博科幻' },
            { id: 'ancient', label: '古风仙侠' },
            { id: 'gothic', label: '哥特诡秘' },
            { id: 'slice', label: '青春校园' },
            { id: 'war', label: '战场残酷' },
            { id: 'mystery', label: '推理解谜' }
        ];

        // content 的写法格式
        const ST_AI_FORMAT_PRESETS = [
            { id: 'plain', label: '纯文本', text: '自然段落，不要任何标记符号，不要小标题。' },
            { id: 'yaml', label: 'YAML', text: 'YAML 结构，缩进两个空格，不要用 Tab，不要注释。' },
            { id: 'json', label: 'JSON', text: '严格合法的 JSON 对象（作为字符串放进 content），不要注释、不要尾逗号。' },
            { id: 'md', label: 'Markdown', text: 'Markdown，小标题用 ###，要点用 - 开头。' },
            { id: 'list', label: '分点列表', text: '每条一行，用「· 」开头，一行只说一个信息点。' },
            { id: 'script', label: '剧本对话', text: '「角色名：台词」的剧本体，动作与神态放圆括号里。' },
            { id: 'kv', label: '键值对', text: '「键：值」逐行排列，键用中文，值尽量短。' }
        ];

        let stAi = Object.assign({}, ST_AI_DEFAULTS);

        function stAiProviderOf(v) {
            return ST_AI_PROVIDERS.find(p => p.value === v) ||
                ST_AI_PROVIDERS[ST_AI_PROVIDERS.length - 1];
        }

        function stAiNum(v, dflt, min, max) {
            const n = Number(v);
            if (!Number.isFinite(n)) return dflt;
            return Math.max(min, Math.min(max, n));
        }

        function stAiJoin(base, path) {
            const b = String(base == null ? '' : base).replace(/\/+$/, '');
            const p = String(path == null ? '' : path);
            if (!b) return p;
            return b + (p.charAt(0) === '/' ? p : '/' + p);
        }

        // 只给服务商看「协议」这件事。
        // ⚠ 顺序要紧：Gemini 的 **OpenAI 兼容层** baseUrl 是
        //   `https://generativelanguage.googleapis.com/v1beta/openai` —— 它同时含
        //   `generativelanguage` 和 `openai`。先判 gemini 就会把兼容层错认成原生协议，
        //   发出去的是 OpenAI 形状的 body、打到 generateContent 上，直接 400。
        //   所以**先排掉 /openai 结尾**，再认 Google 那两个原生域名。
        function stAiGuessProto(baseUrl, provider) {
            const s = (String(baseUrl || '') + ' ' + String(provider || '')).toLowerCase();
            if (/anthropic|claude/.test(s)) return 'anthropic';
            if (/\/openai\b/.test(s)) return 'openai';
            if (/generativelanguage|aiplatform|vertex/.test(s)) return 'gemini';
            return 'openai';
        }

        // 取协议：**服务商预设里写了就用它**，只有没写的（比如自定义）才按 URL 猜。
        // ⚠ 曾经这里一律猜 —— 于是新加的 gemini / vertex 会被猜成 openai，
        //   界面显示对了、请求形状却是错的，只有真发一次才看得出来
        function stAiProtoOf(provider, baseUrl) {
            const p = AI_PROVIDERS.find(x => x.value === provider);
            if (p && p.proto) return p.proto;
            return stAiGuessProto(baseUrl, provider);
        }

        // 从 localStorage 读回来。坏数据一律退回默认值，绝不让它把渲染炸掉
        function stAiLoad() {
            try {
                const raw = JSON.parse(localStorage.getItem(ST_AI_CFG_KEY) || 'null');
                if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
                    const o = Object.assign({}, ST_AI_DEFAULTS, raw);
                    o.mode = (o.mode === 'own') ? 'own' : 'follow';
                    o.provider = ST_AI_PROVIDERS.some(p => p.value === o.provider)
                        ? o.provider : ST_AI_DEFAULTS.provider;
                    o.proto = (o.proto === 'openai' || o.proto === 'anthropic' || o.proto === 'gemini')
                        ? o.proto : '';
                    o.baseUrl = String(o.baseUrl || '');
                    o.apiKey = String(o.apiKey || '');
                    o.model = String(o.model || '');
                    o.models = Array.isArray(o.models)
                        ? o.models.map(String).filter(Boolean).slice(0, 500) : [];
                    o.temperature = stAiNum(o.temperature, ST_AI_DEFAULTS.temperature, 0, 2);
                    o.maxTokens = Math.trunc(stAiNum(o.maxTokens, ST_AI_DEFAULTS.maxTokens, 64, 32000));
                    o.stream = o.stream !== false;
                    o.authMode = (o.authMode === 'sa') ? 'sa' : 'key';
                    o.project = String(o.project || '');
                    o.location = String(o.location || '').trim() || 'global';
                    o.saJson = String(o.saJson || '');
                    stAi = o;
                }
            } catch (e) { stAi = Object.assign({}, ST_AI_DEFAULTS); }
        }

        // 返回有没有落盘。跟 stSaveDraft 一样**保证不抛** —— 隐私模式下
        // localStorage 会直接抛，那也不该让「填个 key」看起来像失败了
        function stAiSave() {
            try { localStorage.setItem(ST_AI_CFG_KEY, JSON.stringify(stAi)); return true; }
            catch (e) { return false; }
        }

        // 只存「参数」。**用白名单，不用黑名单** —— 黑名单会漏：
        // 曾经写成 `if (k === 'running') return;`，而实际字段名是 `exRunning`，
        // 于是生成到一半刷新页面，`exRunning: true` 被存下来，
        // 再打开面板就永远是「⏳ 生成中…」且按钮按不动。
        // 白名单的另一个好处：以后加新的运行时态字段，默认就是**不存**
        const ST_AI_UI_KEEP = [
            'exOpen', 'exReq', 'exReqFree', 'exSource', 'exFree', 'exKeepBook',
            'exCount', 'exMood', 'exMoodFree', 'exFormat', 'exDepth',
            'grOpen', 'grCount', 'grMood', 'grMoodFree', 'grLen', 'grExtra',
            'grIncOff', 'grTarget', 'grShowInject',
            'enOpenId', 'enReq', 'enReqFree', 'enMood', 'enMoodFree', 'enFormat',
            'enRef', 'enRefScope', 'enKeepMeta'
        ];

        function stAiSaveUi() {
            try {
                const o = {};
                ST_AI_UI_KEEP.forEach(k => {
                    if (k in stAiUi) o[k] = stAiUi[k];
                });
                localStorage.setItem(ST_AI_UI_KEY, JSON.stringify(o));
                return true;
            } catch (e) { return false; }
        }

        function stAiLoadUi() {
            try {
                const raw = JSON.parse(localStorage.getItem(ST_AI_UI_KEY) || 'null');
                if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
                    // 同样按白名单读 —— 旧版本可能把 exRunning / exErr 存了进去，
                    // 读到 `exRunning: true` 就是一个永远转圈的面板
                    ST_AI_UI_KEEP.forEach(k => {
                        if (raw[k] !== undefined && raw[k] !== null) stAiUi[k] = raw[k];
                    });
                }
            } catch (e) {}
        }

        // 跟随模式：现读 **API 全局配置**（不是【ai对话】）。
        // **不复制** —— 用户在全局面板改完，这边下次点生成就是新的，
        // 不需要「同步一下」这种按钮。
        // ⚠ 指向 apiGlobal 而不是 aiConfig：后者是「生效值」，会跟着【ai对话】的
        //   「独立配置」一起变 —— 那就等于编写器又悄悄跟回了对话
        // Vertex 那几格：跟随模式现读 apiGlobal，独立模式读 stAi。
        // 抽出来是因为 stAiFollowCfg / stAiCfg / 界面回填三处都要读它 ——
        // 抄三份的结局是「改了一处，另两处还读着老字段」
        function stAiVertexFields(src) {
            const s = src || {};
            return {
                authMode: (s.authMode === 'sa') ? 'sa' : 'key',
                project: String(s.project || ''),
                location: String(s.location || '').trim() || 'global',
                saJson: String(s.saJson || '')
            };
        }

        function stAiFollowCfg() {
            const base = String(apiGlobal.baseUrl || '').replace(/\/+$/, '');
            return Object.assign({
                mode: 'follow',
                provider: apiGlobal.provider || 'custom',
                providerLabel: (AI_PROVIDERS.find(p => p.value === apiGlobal.provider) || {}).label || 'API 全局配置',
                baseUrl: base,
                apiKey: String(apiGlobal.apiKey || ''),
                model: String(apiGlobal.model || ''),
                temperature: stAiNum(apiGlobal.temperature, 0.7, 0, 2),
                maxTokens: Math.trunc(stAiNum(apiGlobal.maxTokens, 4096, 64, 32000)),
                stream: apiGlobal.stream !== false,
                proto: stAiProtoOf(apiGlobal.provider, base),
                firstSeg: String(apiGlobal.firstSeg || '')
            }, stAiVertexFields(apiGlobal));
        }

        function stAiCfg() {
            if (stAi.mode !== 'own') return stAiFollowCfg();
            const p = stAiProviderOf(stAi.provider);
            const base = String(p.custom ? stAi.baseUrl : (p.baseUrl || '')).replace(/\/+$/, '');
            return Object.assign({
                mode: 'own',
                provider: stAi.provider,
                providerLabel: p.label,
                baseUrl: base,
                apiKey: String(stAi.apiKey || ''),
                model: String(stAi.model || ''),
                temperature: stAiNum(stAi.temperature, 0.8, 0, 2),
                maxTokens: Math.trunc(stAiNum(stAi.maxTokens, 4096, 64, 32000)),
                stream: stAi.stream !== false,
                // ⚠ 必须走 stAiProtoOf：它管「预设里写了就用它、没写才按 URL 猜」。
                //   直接写 `stAi.proto || p.proto || 'openai'` 会让**自定义**永远拿到
                //   openai —— 那条分支把 URL 整条跳过了（实测过，见预设表里的注释）
                proto: stAi.proto || stAiProtoOf(stAi.provider, base),
                firstSeg: String(stAi.firstSeg || '')
            }, stAiVertexFields(stAi));
        }

