        // —— 工具型 skill（kind:'tool'）——
        // ⚠ 两种 skill **并存**，不是替换：
        //   · kind:'knowledge'（默认，.md）—— 正文注入 system，模型照着做（现有行为，一点没变）
        //   · kind:'tool'（.js + manifest）—— 注册成一个工具，模型**直接调**
        //   导入时自动判别：源码里有 /*!MANIFEST*/ 的算工具，其余算知识
        const ST_CODE_SKILL_KINDS = ['knowledge', 'tool'];
        // manifest 写在代码**最前面的注释**里。⚠ 用注释而不是另配一个 json：
        //   一个文件就能带走全部信息，从链接 / 文件夹导入时不用管「两个文件配不配得上」
        // ⚠ 收尾的 `!` 必须**吃在 `*/` 外面**：写成 `([\s\S]*?)\*\/` 的话
        //   `/*!MANIFEST {…}!*/` 会把那个 `!` 一起塞进捕获组，JSON.parse 当场炸
        //   （报的是「Unexpected non-whitespace character」，完全看不出是哪儿的问题）。
        //   `!` 是可选的 —— 别人写 `/*!MANIFEST {…}*/` 也认
        const ST_CODE_MANIFEST_RX = /^\s*\/\*!\s*MANIFEST\s*([\s\S]*?)\s*!?\*\//;
        // 工具名的硬要求，两套协议都是这一条：^[a-zA-Z0-9_-]{1,64}$
        // ⚠ 中文名 / 带点的名字两套都不收，而且**报的错很难懂**（OpenAI 只说 invalid），
        //   所以必须在这里就拦住并说人话
        const ST_CODE_TOOLNAME_RX = /^[A-Za-z0-9_-]{1,64}$/;
        // 沙盒里跑一次的超时。⚠ 不给的话一个 `while(true)` 会把整个 Agent 循环挂死 ——
        //   页面**不报错**，用户只看到「正在思考…」永远转下去
        const ST_CODE_SANDBOX_MS = 5000;
        // 单次返回值上限（它也是喂给模型的东西）
        const ST_CODE_SANDBOX_OUT = 8000;
        // 宿主允许暴露给沙盒的能力。**按危险程度分两层**，manifest 里声明哪层就只给哪层。
        //   · card.read  —— 只读：读卡 / 读状态栏 / 读正则 / 读脚本 / 读世界书
        //   · card.write —— 改卡：改字段、增删世界书、改状态栏、改正则脚本
        //   ⚠ 写那一层是**真会改用户的卡**的，所以它不是「装了就有」：导入时面板上会明写
        //     「能改卡」，用户点「装」= 明确同意。权限在**导入那一刻**定死，运行时不会临时给
        //     —— 否则「申请」就成了摆设
        //   ⚠ 它和「真的改卡」那个安全开关是**两回事，两个都得过**：开关是模型这一轮的
        //     总闸（关着的时候连模型自己都不许写），权限是「这个 skill 有没有资格碰卡」。
        //     底下走的是**同一个 stCodeToolRun**，所以白名单 / 回收站 / 开关全都照旧生效
        //   ⚠ **不给 fetch_url**：它是唯一出网的通道，给了就等于把 CSP 断网的意义抹掉一半
        //     —— skill 能把刚读到的卡内容拼进 URL 发出去，而地址闸门挡的是「访问内网」，
        //     挡不住「把私密角色设定发到公网」
        //   ⚠ **不给 set_tasks / remember**：那是给模型管会话用的，skill 用不上，
        //     给了只会污染会话状态（任务清单 / 项目记忆都是会话级的东西）
        const ST_CODE_SANDBOX_PERM = ['card.read', 'card.write', 'progress'];
        // 能力 → 允许调用的**内置工具**。⚠ 这张表是「沙盒能碰什么」的唯一答案，
        //   往里面加东西之前先问：它会改卡吗？它出网吗？
        //   表里**只有内置工具名** —— 所以沙盒调不到别的工具型 skill（不会递归）
        //   ⚠ `progress` **故意映射到空数组** —— 它不是一个内置工具，而是一条独立的
        //     单向消息通道（`__prog`）。它必须出现在这张表里，是因为
        //     `stCodePermOfTool` / `stCodePermToolNames` 都从这张表的键取「这里有哪些
        //     能力」。写成「不在表里」的话，`stCodeManifestOf` 那关就会把申请了
        //     `progress` 的 manifest 判成「这里还没有这个能力」，用户拿到一个
        //     说不通的报错（明明刚加的功能）
        const ST_CODE_PERM_TOOLS = {
            'card.read': ['read_card', 'read_doc', 'read_regex', 'read_th',
                'list_world_entries', 'read_world_entry'],
            'card.write': ['write_text', 'write_list', 'add_world_entry', 'update_world_entry',
                'delete_world_entry', 'write_doc', 'write_regex', 'write_th'],
            'progress': []
        };
        // 一次 run 里最多几次宿主调用。⚠ 不给上限的话 `while (1) { await host.call(...) }`
        //   能在这 5 秒里把卡读上千遍 —— 沙盒超时掐得掉**沙盒**，掐不掉父页面正在跑的活
        const ST_CODE_SANDBOX_RPC_MAX = 20;
        // 单次宿主调用的超时。⚠ 要比总超时短一点，好让 skill 有机会 catch 到
        //   「这次调用失败了」然后自己决定怎么办，而不是整段一起被掐
        const ST_CODE_SANDBOX_RPC_MS = 4000;

