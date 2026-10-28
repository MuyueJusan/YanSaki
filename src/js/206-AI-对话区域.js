        // ==========================================================================
        // AI 对话区域
        // ==========================================================================
        // ==========================================================================
        // 服务商表 —— **全站唯一一张**
        //
        // ⚠ 这里曾经有两张：本表（7 个，给【api全局配置】用）与编写器那份
        //   `ST_AI_PROVIDERS`（13 个）。同一个概念维护两份的必然结局是「加了一边忘了另一边」，
        //   所以现在 `ST_AI_PROVIDERS` 直接指向本表（见下方 const ST_AI_PROVIDERS = AI_PROVIDERS）。
        //
        // 字段：
        //   value    —— 存进 localStorage 的稳定 id（**改名会让老配置丢服务商**，别动）
        //   label    —— 下拉里显示的名字
        //   baseUrl  —— OpenAI 兼容的根路径（末尾**不带** /，拼接统一走 stAiJoin）
        //   proto    —— 'openai' | 'anthropic' | 'gemini'
        //   group    —— 下拉分组（optgroup）
        //   custom   —— true 才让用户自己填 Base URL
        //   vertex   —— 需要 project / location / 认证模式那一组额外字段
        //
        // ⚠ 顺序有意义：`custom` **必须留最后** —— stAiProviderOf 找不到时回落到
        //   `AI_PROVIDERS[length - 1]`，那一项正好是「自定义」，语义上最合理
        // ==========================================================================
        const AI_PROVIDERS = [
            // ── 海外 ───────────────────────────────────────────────────────────
            { value: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', proto: 'openai', group: '海外' },
            { value: 'anthropic', label: 'Anthropic Claude', baseUrl: 'https://api.anthropic.com/v1', proto: 'anthropic', group: '海外' },
            { value: 'xai', label: 'xAI Grok', baseUrl: 'https://api.x.ai/v1', proto: 'openai', group: '海外' },
            { value: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', proto: 'openai', group: '海外' },
            { value: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', proto: 'openai', group: '海外' },
            { value: 'together', label: 'Together AI', baseUrl: 'https://api.together.xyz/v1', proto: 'openai', group: '海外' },
            { value: 'fireworks', label: 'Fireworks AI', baseUrl: 'https://api.fireworks.ai/inference/v1', proto: 'openai', group: '海外' },
            { value: 'perplexity', label: 'Perplexity', baseUrl: 'https://api.perplexity.ai', proto: 'openai', group: '海外' },
            { value: 'cerebras', label: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1', proto: 'openai', group: '海外' },
            { value: 'nvidia', label: 'NVIDIA NIM', baseUrl: 'https://integrate.api.nvidia.com/v1', proto: 'openai', group: '海外' },
            { value: 'openrouter', label: 'OpenRouter（聚合）', baseUrl: 'https://openrouter.ai/api/v1', proto: 'openai', group: '海外' },

            // ── 国产 ───────────────────────────────────────────────────────────
            { value: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', proto: 'openai', group: '国产' },
            { value: 'moonshot', label: 'Moonshot / Kimi', baseUrl: 'https://api.moonshot.cn/v1', proto: 'openai', group: '国产' },
            { value: 'glm', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', proto: 'openai', group: '国产' },
            { value: 'qwen', label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', proto: 'openai', group: '国产' },
            { value: 'siliconflow', label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', proto: 'openai', group: '国产' },
            { value: 'minimax', label: 'MiniMax', baseUrl: 'https://api.minimaxi.com/v1', proto: 'openai', group: '国产' },
            { value: 'ark', label: '火山方舟 / 豆包', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', proto: 'openai', group: '国产' },
            { value: 'hunyuan', label: '腾讯混元', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', proto: 'openai', group: '国产' },
            { value: 'qianfan', label: '百度千帆 / 文心', baseUrl: 'https://qianfan.baidubce.com/v2', proto: 'openai', group: '国产' },
            { value: 'spark', label: '讯飞星火', baseUrl: 'https://spark-api-open.xf-yun.com/v1', proto: 'openai', group: '国产' },
            { value: 'stepfun', label: '阶跃星辰', baseUrl: 'https://api.stepfun.com/v1', proto: 'openai', group: '国产' },
            { value: 'lingyi', label: '零一万物 Yi', baseUrl: 'https://api.lingyiwanwu.com/v1', proto: 'openai', group: '国产' },

            // ── 国产 · 海外渠道 ────────────────────────────────────────────────
            // ⚠ 这些跟上面同名的**不是同一个端点**，API Key 也不通用（国内站申请的
            //   Key 拿去打海外端点会 401）。别把两者当成「同一个服务商换个名字」。
            { value: 'moonshot-intl', label: 'Moonshot / Kimi（国际站）', baseUrl: 'https://api.moonshot.ai/v1', proto: 'openai', group: '国产 · 海外渠道' },
            { value: 'glm-intl', label: '智谱 GLM / Z.ai（国际站）', baseUrl: 'https://api.z.ai/api/paas/v4', proto: 'openai', group: '国产 · 海外渠道' },
            { value: 'qwen-intl', label: '通义千问（新加坡）', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', proto: 'openai', group: '国产 · 海外渠道' },
            { value: 'qwen-us', label: '通义千问（美国 · 弗吉尼亚）', baseUrl: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1', proto: 'openai', group: '国产 · 海外渠道' },
            { value: 'qwen-hk', label: '通义千问（中国香港）', baseUrl: 'https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1', proto: 'openai', group: '国产 · 海外渠道' },
            { value: 'siliconflow-intl', label: '硅基流动（国际站）', baseUrl: 'https://api.siliconflow.com/v1', proto: 'openai', group: '国产 · 海外渠道' },
            { value: 'minimax-intl', label: 'MiniMax（国际站）', baseUrl: 'https://api.minimax.io/v1', proto: 'openai', group: '国产 · 海外渠道' },

            // ── Google ─────────────────────────────────────────────────────────
            // 三条路各有取舍，界面上会分别提示：
            //   · 兼容层 —— 最省事，但拿不到 Gemini 独有的字段（安全设置 / extra_content）
            //   · 原生   —— AI Studio 的 Key，走 generateContent，浏览器直连最稳
            //   · Vertex —— 企业级；快速模式只要 Key，完整模式要 Service Account JSON
            { value: 'gemini', label: 'Google Gemini（OpenAI 兼容层）', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', proto: 'openai', group: 'Google' },
            { value: 'gemini-native', label: 'Google Gemini（原生协议）', baseUrl: 'https://generativelanguage.googleapis.com', proto: 'gemini', group: 'Google' },
            { value: 'vertex', label: 'Google Vertex AI', baseUrl: 'https://aiplatform.googleapis.com', proto: 'gemini', group: 'Google', vertex: true },

            // ── 本地 ───────────────────────────────────────────────────────────
            { value: 'ollama', label: 'Ollama', baseUrl: 'http://localhost:11434/v1', proto: 'openai', group: '本地' },
            { value: 'lmstudio', label: 'LM Studio', baseUrl: 'http://localhost:1234/v1', proto: 'openai', group: '本地' },
            { value: 'vllm', label: 'vLLM', baseUrl: 'http://localhost:8000/v1', proto: 'openai', group: '本地' },

            // ⚠ 必须留在最后（见文件头注释）
            // ⚠ proto 故意留空：自定义 = 用户自己粘 Base URL，协议**只能按 URL 猜**。
            //   写死 'openai' 的后果实测过：粘 Anthropic 的域名 ⇒ 界面显示对了、
            //   请求按 OpenAI 形状发出去 ⇒ 400，而且**只有真发一次才看得出来**。
            { value: 'custom', label: '自定义（按 Base URL 猜协议）', baseUrl: '', proto: '', group: '其他', custom: true }
        ];

        // 下拉分组顺序。表里没列到的 group 会被追加到末尾（新增分组忘了加这里也不会丢项）
        const AI_PROVIDER_GROUPS = ['海外', '国产', '国产 · 海外渠道', 'Google', '本地', '其他'];

