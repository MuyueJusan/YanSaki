        // ===== 提示词预设（对齐 SillyTavern 的 Chat Completion 预设）=====
        // ST 的 PromptManager：INJECTION_POSITION.RELATIVE=0 表示「留在 prompt_order
        // 给的位置」，ABSOLUTE=1 表示「从顺序流里摘出来，按 injection_depth 在对话里注入」
        const PM_INJECTION = { relative: 0, absolute: 1 };
        const PM_INJECTION_NAME = { 0: '相对位置（留在顺序里）', 1: '对话内注入（按深度）' };
        const PM_DEFAULT_DEPTH = 4;
        const PM_DEFAULT_ORDER = 100;
        const PM_GENERATION_TYPE = 'normal';

        // marker 槽：内容由应用填，预设里只放一个占位（ST 的 prompt.marker === true）。
        // 名字对着 ST 的 chatCompletionDefaultPrompts 抄
        const PM_MARKERS = {
            main: '主提示词',
            worldInfoBefore: '世界书（角色定义之前）',
            worldInfoAfter: '世界书（角色定义之后）',
            charDescription: '角色描述',
            charPersonality: '角色性格',
            scenario: '场景',
            personaDescription: '用户人设描述',
            dialogueExamples: '示例对话',
            chatHistory: '聊天记录',
        };
        // 内容 100% 由应用填、用户改不了的槽
        const PM_APP_FILLED = ['worldInfoBefore', 'worldInfoAfter', 'charDescription',
            'charPersonality', 'scenario', 'personaDescription', 'dialogueExamples', 'chatHistory'];
        // 内容可以在预设里写，但角色卡自带字段会覆盖它（ST 的 systemPromptOverride /
        // jailbreakPromptOverride）。所以这两个槽既不是「应用填」也不是「纯预设内容」
        const PM_CARD_OVERRIDABLE = ['main', 'jailbreak'];
        // marker 槽在预览里用什么配色
        const PM_MARKER_KIND = {
            main: 'main',
            worldInfoBefore: 'wi', worldInfoAfter: 'wi',
            charDescription: 'char', charPersonality: 'char', scenario: 'char',
            personaDescription: 'char',
            jailbreak: 'post',
            dialogueExamples: 'example', chatHistory: 'chat',
        };

        // 内置默认预设 —— 与 ST 的 default/content/presets/openai/Default.json 逐字一致。
        // 改这里就等于改「默认行为」，所以只读；用户一编辑就 fork 成副本
        const BUILTIN_PRESETS = [{
            id: 'builtin-default',
            name: 'SillyTavern 默认',
            builtin: true,
            prompts: [
                { identifier: 'main', name: 'Main Prompt', system_prompt: true, role: 'system',
                  content: 'Write {{char}}\'s next reply in a fictional chat between {{char}} and {{user}}.' },
                { identifier: 'nsfw', name: 'Auxiliary Prompt', system_prompt: true, role: 'system', content: '' },
                { identifier: 'dialogueExamples', name: 'Chat Examples', system_prompt: true, marker: true },
                { identifier: 'jailbreak', name: 'Post-History Instructions', system_prompt: true, role: 'system', content: '' },
                { identifier: 'chatHistory', name: 'Chat History', system_prompt: true, marker: true },
                { identifier: 'worldInfoAfter', name: 'World Info (after)', system_prompt: true, marker: true },
                { identifier: 'worldInfoBefore', name: 'World Info (before)', system_prompt: true, marker: true },
                { identifier: 'enhanceDefinitions', name: 'Enhance Definitions', system_prompt: true, role: 'system', marker: false,
                  content: 'If you have more knowledge of {{char}}, add to the character\'s lore and personality to enhance them but keep the Character Sheet\'s definitions absolute.' },
                { identifier: 'charDescription', name: 'Char Description', system_prompt: true, marker: true },
                { identifier: 'charPersonality', name: 'Char Personality', system_prompt: true, marker: true },
                { identifier: 'scenario', name: 'Scenario', system_prompt: true, marker: true },
                { identifier: 'personaDescription', name: 'Persona Description', system_prompt: true, marker: true },
            ],
            // ST 的 prompt_order 是「按角色 id」存的，100000 是「没有角色」那份。
            // 注意：Default.json 里 character_id=100000 那份<b>漏了</b> personaDescription
            // （100001 群聊那份才有），但 ST 代码里的 promptManagerDefaultPromptOrder
            // （PromptManager.js:2087）是带上它的，共 12 项。这里按代码那份来 ——
            // 不然用户人设描述在默认预设下永远没有落脚点
            order: [
                { identifier: 'main', enabled: true },
                { identifier: 'worldInfoBefore', enabled: true },
                { identifier: 'personaDescription', enabled: true },
                { identifier: 'charDescription', enabled: true },
                { identifier: 'charPersonality', enabled: true },
                { identifier: 'scenario', enabled: true },
                { identifier: 'enhanceDefinitions', enabled: false },
                { identifier: 'nsfw', enabled: true },
                { identifier: 'worldInfoAfter', enabled: true },
                { identifier: 'dialogueExamples', enabled: true },
                { identifier: 'chatHistory', enabled: true },
                { identifier: 'jailbreak', enabled: true },
            ],
        }];

