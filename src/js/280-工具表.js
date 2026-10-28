        // —— 工具表 ——
        // 描述里把「什么时候该用」写清楚，比只写「这个工具干什么」有用得多：
        // 模型靠这几句话决定要不要动手
        const ST_CODE_TOOLS = [
            {
                name: 'read_card',
                desc: '读角色卡。不传 path 返回整张卡的 JSON；传了 path 只返回那一个字段。' +
                    '改卡之前一律先读一遍。',
                schema: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: '字段名，例如 description / firstMes / tags。留空 = 整张卡' }
                    }
                }
            },
            {
                name: 'write_text',
                desc: '改写角色卡里的一个文本字段（整段替换）。只能写白名单里的字段。',
                schema: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: '字段名，例如 description / firstMes / systemPrompt' },
                        value: { type: 'string', description: '新的完整内容（不是摘要，是整段）' }
                    },
                    required: ['path', 'value']
                }
            },
            {
                name: 'write_list',
                desc: '改写角色卡里的一个数组字段（标签 / 备选开场白 / 群聊开场白 / 来源）。',
                schema: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: '字段名：' + ST_CODE_LIST_PATHS.join(' / ') },
                        mode: { type: 'string', enum: ['replace', 'append', 'remove'], description: '默认 replace' },
                        items: { type: 'array', items: { type: 'string' }, description: '要写入的条目' }
                    },
                    required: ['path', 'items']
                }
            },
            {
                name: 'list_world_entries',
                desc: '列出世界书里所有条目（编号 / id / 备注 / 关键词 / 启用状态 / 正文开头）。' +
                    '要动某一条之前先用它找到 id。',
                schema: { type: 'object', properties: {} }
            },
            {
                name: 'read_world_entry',
                desc: '读一条世界书条目的完整内容。',
                schema: {
                    type: 'object',
                    properties: { id: { type: 'string', description: '条目 id（也可以用备注名）' } },
                    required: ['id']
                }
            },
            {
                name: 'add_world_entry',
                desc: '在世界书末尾新增一条条目。',
                schema: {
                    type: 'object',
                    properties: {
                        comment: { type: 'string', description: '备注名' },
                        content: { type: 'string', description: '正文' },
                        keys: { type: 'array', items: { type: 'string' }, description: '主关键词' },
                        secondaryKeys: { type: 'array', items: { type: 'string' }, description: '次关键词' },
                        constant: { type: 'boolean', description: '常驻（不看关键词，永远注入）' },
                        position: { type: 'number', description: '注入位置 0~7，默认 0' },
                        depth: { type: 'number', description: '@D 位置时的深度，默认 4' },
                        order: { type: 'number', description: '同位置时的排序，默认 100' },
                        enabled: { type: 'boolean', description: '默认 true' }
                    },
                    required: ['content']
                }
            },
            {
                name: 'update_world_entry',
                desc: '改一条已有的世界书条目。只传要改的字段，没传的保持原样。',
                schema: {
                    type: 'object',
                    properties: {
                        id: { type: 'string', description: '条目 id（也可以用备注名）' },
                        comment: { type: 'string' },
                        content: { type: 'string' },
                        keys: { type: 'array', items: { type: 'string' } },
                        secondaryKeys: { type: 'array', items: { type: 'string' } },
                        constant: { type: 'boolean' },
                        position: { type: 'number' },
                        depth: { type: 'number' },
                        order: { type: 'number' },
                        enabled: { type: 'boolean' }
                    },
                    required: ['id']
                }
            },
            {
                name: 'delete_world_entry',
                desc: '删掉一条世界书条目。删掉的会进回收站，用户能撤回。',
                schema: {
                    type: 'object',
                    properties: { id: { type: 'string', description: '条目 id（也可以用备注名）' } },
                    required: ['id']
                }
            },
            {
                name: 'list_skills',
                desc: '列出用户导入的 skill。做事之前先看一眼有没有对口的 skill。',
                schema: { type: 'object', properties: {} }
            },
            {
                name: 'read_skill',
                desc: '读一个 skill 的完整正文（相当于把那份说明装进脑子）。' +
                    '名字可以用 list_skills 给的，也可以只给一部分。',
                schema: {
                    type: 'object',
                    properties: { name: { type: 'string', description: 'skill 名字' } },
                    required: ['name']
                }
            },
            {
                // ⚠ 措辞很重要：这是**浏览器代你去访问**，不是你自己能上网。
                //   不写清楚的话，模型会以为自己可以随便逛，然后反复去拉同一个地址
                name: 'fetch_url',
                desc: '让用户的浏览器替你去访问一个公网地址，把正文取回来给你看。' +
                    '**你自己没有网络** —— 这条工具是「请用户那边代取」。' +
                    '只能取 http / https 的公网地址；本机与内网地址会被拒绝。' +
                    '适合读文档、读 SKILL.md、读一个 raw 文件。' +
                    '**别用它去逛网页或反复试探** —— 每次调用都会真的发一次请求，' +
                    '而且结果会占掉你的上下文。一次取不到就换思路，不要连续重试同一个地址。',
                schema: {
                    type: 'object',
                    properties: {
                        url: { type: 'string', description: '完整地址，http:// 或 https:// 开头' },
                        note: { type: 'string', description: '一句话说明你要它干什么（可选，给用户看的）' }
                    },
                    required: ['url']
                }
            },
            {
                // ⚠ 是**整表替换**，不是增量。让模型「加一条」的话它得先记得自己列过什么，
                //   而它记不住（上下文会被裁、会话可能被切）。整表替换把「当前计划」
                //   变成一次幂等的写操作：传什么就是什么，不依赖它之前说过什么
                name: 'set_tasks',
                desc: '把你的工作计划写下来给用户看（界面上会显示成一张清单）。' +
                    '**整表替换**：每次传完整清单，不是只传变化的那一条。' +
                    'status 用 pending / doing / done。事情超过两三步就该用它。',
                schema: {
                    type: 'object',
                    properties: {
                        tasks: {
                            type: 'array',
                            description: '完整的任务清单，按执行顺序',
                            items: {
                                type: 'object',
                                properties: {
                                    text: { type: 'string', description: '一句话说清这一步做什么' },
                                    status: { type: 'string', enum: ['pending', 'doing', 'done'] }
                                },
                                required: ['text']
                            }
                        }
                    },
                    required: ['tasks']
                }
            },
            {
                name: 'remember',
                desc: '把用户的一条**长期要求**记下来，以后每次对话都会看到。' +
                    '只在用户明确说「记住…」、或反复强调同一件事时用；' +
                    '只是这一轮的要求**不要记** —— 记多了会把真正重要的那条挤掉。',
                schema: {
                    type: 'object',
                    properties: {
                        text: { type: 'string', description: '一句话，写「以后要怎么做」，而不是「用户刚才说了什么」' }
                    },
                    required: ['text']
                }
            },
            {
                name: 'read_doc',
                desc: '读「状态栏」或「MVU 变量框架」的**全文**。这两样不是卡上的普通字段：' +
                    '状态栏 HTML 存在「状态栏界面」那条正则的 replaceString 里，' +
                    'MVU 的变量结构是某条酒馆助手脚本里的 Zod 源码。' +
                    '这个工具直接把**能编辑的那份文本**给你 —— 状态栏给 body 里的 HTML，' +
                    'MVU 给 Zod 源码。改完用 write_doc 写回去。' +
                    '⚠ 太长读不完时会带一个「已截断」标记 —— 那就用 from 接着往后读，' +
                    '**千万别把带标记的那段写回去**（会把后半段删掉）。' +
                    '⚠ 读普通字段用 read_card；读正则/脚本用 read_regex / read_th。',
                schema: {
                    type: 'object',
                    properties: {
                        kind: { type: 'string', enum: ['statusbar', 'mvu'],
                            description: 'statusbar = 状态栏外观；mvu = MVU 变量结构（Zod）' },
                        from: { type: 'integer',
                            description: '从第几个字开始读（0 起）。省略 = 从头。内容太长被截断时用它接着读' }
                    },
                    required: ['kind']
                }
            },
            {
                name: 'write_doc',
                desc: '把「状态栏」或「MVU」的全文写回去。**整份替换**（这两样是「一份」不是「一列」）。' +
                    '状态栏传 body 里的 HTML（不用带 ``` 围栏，围栏和围栏外的说明文字会自动保留）；' +
                    'MVU 传完整的 Zod 源码。' +
                    '⚠ 解析不了会**报错并原样退回**，不会把卡写坏；' +
                    '⚠ 卡里那套不是编辑器画的（别人手写的）时会被拒绝，要让用户先接管。',
                schema: {
                    type: 'object',
                    properties: {
                        kind: { type: 'string', enum: ['statusbar', 'mvu'] },
                        text: { type: 'string',
                            description: 'statusbar：<body> 里的那段 HTML。mvu：完整的 Zod 源码（含 registerMvuSchema(...)）' }
                    },
                    required: ['kind', 'text']
                }
            },
            {
                name: 'read_regex',
                desc: '读卡里的**正则脚本**。不传 id 给一份清单（名字 / 开关 / 命中片段），' +
                    '传 id（或名字）给那一条的完整内容。' +
                    '⚠ 其中「状态栏界面」那条就是**状态栏本身**，别用 write_regex 改它 —— 用 write_doc。',
                schema: {
                    type: 'object',
                    properties: {
                        id: { type: 'string', description: '正则的 id 或 scriptName。不传就列清单' }
                    }
                }
            },
            {
                name: 'write_regex',
                desc: '增 / 改 / 删一条正则脚本。mode=add 时新建（至少给 scriptName 和 findRegex）；' +
                    'mode=update 按 id 改，**只改你传了的字段**；mode=delete 按 id 删。' +
                    '⚠ MVU 装的那几条正则（对AI隐藏变量 / 变量更新美化 / 对AI隐藏状态栏 / 状态栏界面）' +
                    '会被拒绝 —— 它们是编辑器生成的，改了下一次写回就覆盖掉。',
                schema: {
                    type: 'object',
                    properties: {
                        mode: { type: 'string', enum: ['add', 'update', 'delete'] },
                        id: { type: 'string', description: 'update / delete 必给：id 或 scriptName' },
                        scriptName: { type: 'string', description: '这条正则叫什么' },
                        findRegex: { type: 'string', description: '匹配用的正则表达式（含 / 与 flags 的那种写法）' },
                        replaceString: { type: 'string', description: '替换成什么' },
                        trimStrings: { type: 'array', items: { type: 'string' },
                            description: '替换前要从匹配结果里剪掉的字符串' },
                        placement: { type: 'array', items: { type: 'number' },
                            description: '1 = 用户输入，2 = AI 输出，两个都管就 [1,2]' },
                        disabled: { type: 'boolean', description: '关掉这条' },
                        markdownOnly: { type: 'boolean', description: '只在显示时生效' },
                        promptOnly: { type: 'boolean', description: '只在发给 AI 前生效' },
                        runOnEdit: { type: 'boolean', description: '编辑消息时也跑' }
                    },
                    required: ['mode']
                }
            },
            {
                name: 'read_th',
                desc: '读卡里的**酒馆助手脚本**（JS-Slash-Runner）。不传 id 给清单（名字 / 开关 / 正文长度），' +
                    '传 id（或名字）给正文。' +
                    '⚠ 其中写着 `registerMvuSchema` 的那条是 **MVU 的变量结构**，' +
                    '写着 `MagVarUpdate` 的那条是 MVU 核心 —— 都别用 write_th 改，用 write_doc。',
                schema: {
                    type: 'object',
                    properties: {
                        id: { type: 'string', description: '脚本的 id 或 name。不传就列清单' }
                    }
                }
            },
            {
                name: 'write_th',
                desc: '增 / 改 / 删一个酒馆助手脚本。mode=add 时新建（至少给 name）；' +
                    'mode=update 按 id 改，**只改你传了的字段**；mode=delete 按 id 删。' +
                    '⚠ MVU 核心脚本（MagVarUpdate）和变量结构脚本（registerMvuSchema）会被拒绝改写。',
                schema: {
                    type: 'object',
                    properties: {
                        mode: { type: 'string', enum: ['add', 'update', 'delete'] },
                        id: { type: 'string', description: 'update / delete 必给：id 或 name' },
                        name: { type: 'string', description: '脚本名字' },
                        content: { type: 'string', description: '脚本正文（JS 代码）' },
                        info: { type: 'string', description: '一段说明，给自己看的' },
                        enabled: { type: 'boolean', description: '开不开' }
                    },
                    required: ['mode']
                }
            }
        ];

        // 静态工具 + 工具型 skill = **唯一一张工具表**。
        // ⚠ 发给模型的那份和执行时校验的那份必须都从这儿来 —— 分成两处写的那天
        //   一定会出现「模型看得见、但调不动」（或者反过来：调得到、但模型不知道有）
        function stCodeToolDefs() {
            const out = ST_CODE_TOOLS.slice();
            stCode.skills.forEach(sk => {
                if (sk.kind !== 'tool' || !sk.tool || !sk.tool.name) return;
                out.push({ name: sk.tool.name, desc: sk.tool.desc, schema: sk.tool.params, skill: sk.name });
            });
            return out;
        }

        // Gemini 的 `parameters` 是 **OpenAPI 3 的一个子集**，不是完整 JSON Schema：
        // `additionalProperties` / `$schema` / `$ref` / `oneOf` 这类它不认，发了就是
        // 400 INVALID_ARGUMENT —— 而那个报错**不会**点名「是 schema 写错了」，
        // 用户只会以为 Key 或模型名不对。⇒ 过一道白名单，只留它认的那些键。
        //
        // ⚠ 白名单**天生会漏**（RULES：过滤一律白名单，但白名单自己也会漏）——
        //   所以这里只做「删掉不认的键」，**不改结构、不改类型**：模型在三种协议下
        //   看到的参数形状一致。真被漏掉的约束由工具自己在运行时兜（stCodeTool 的
        //   入参校验那一层），不靠 schema。
        const ST_GEMINI_SCHEMA_KEYS = [
            'type', 'description', 'enum', 'items', 'properties', 'required',
            'nullable', 'minimum', 'maximum',
            'minItems', 'maxItems', 'minLength', 'maxLength', 'pattern'
        ];
        function stCodeGeminiSchema(v) {
            // 元组写法（items 是数组）Gemini 不支持，取第一个当元素类型
            const src = Array.isArray(v) ? (v[0] || {}) : v;
            if (!src || typeof src !== 'object') return { type: 'string' };
            const out = {};
            ST_GEMINI_SCHEMA_KEYS.forEach(k => { if (src[k] !== undefined) out[k] = src[k]; });
            if (out.properties && typeof out.properties === 'object' && !Array.isArray(out.properties)) {
                const props = {};
                Object.keys(out.properties).forEach(k => { props[k] = stCodeGeminiSchema(out.properties[k]); });
                out.properties = props;
            }
            if (out.items) out.items = stCodeGeminiSchema(out.items);
            if (!out.type) out.type = out.properties ? 'object' : 'string';
            return out;
        }

        // 同一张表转成三套协议要的形状
        function stCodeToolsFor(proto) {
            const defs = stCodeToolDefs();
            if (proto === 'anthropic') {
                return defs.map(t => ({
                    name: t.name, description: t.desc, input_schema: t.schema
                }));
            }
            if (proto === 'gemini') {
                // ⚠ 比 OpenAI 少一层 `type:'function'` 包装，多一层 `functionDeclarations`：
                //   tools: [ { functionDeclarations: [ {name, description, parameters} ] } ]
                return [{
                    functionDeclarations: defs.map(t => ({
                        name: t.name,
                        description: t.desc,
                        parameters: stCodeGeminiSchema(t.schema)
                    }))
                }];
            }
            return defs.map(t => ({
                type: 'function',
                function: { name: t.name, description: t.desc, parameters: t.schema }
            }));
        }

