        // ==========================================================================
        // Code（Agent）页
        //   一个能「动手改卡」的会话：模型可以调工具去读卡、写字段、增删世界书条目。
        //   ⚠ 它**不受「第一段」影响，也不加第一段** —— 那一条只属于 AI 对话和
        //     AI 助手那三个面板。这里发出去的就是标准的 system + messages + tools。
        // ==========================================================================

        const ST_CODE_SESS_KEY = 'stCodeSessions';
        const ST_CODE_UI_KEY = 'stCodeUi';
        const ST_CODE_SKILL_KEY = 'stCodeSkills';
        const ST_CODE_MAX_MSGS = 400;    // 单个会话最多留多少条消息
        const ST_CODE_MAX_SESS = 40;     // 最多留多少个历史会话
        const ST_CODE_TOOL_CHARS = 12000; // 单次工具结果喂给模型的上限

        // 「读整份文档」那一类工具的单独上限，比 ST_CODE_TOOL_CHARS 高一截。
        // ⚠ 这些工具的结果**注定会被写回**（状态栏 HTML、Zod 源码、整张卡都轻松过 12000）。
        //   用同一个数去截，模型就会「读一半 → 写回一半 → 后半段没了」，而且全程不报错。
        //   所以宁可多给预算，也不能给它一截断的原文
        const ST_CODE_READ_CHARS = 32000;

        // 截断标记。**必须是常量**：write_text / write_doc 拿它当闸门 ——
        // 模型把截断后的文本原样写回来 = 静默删掉后半段。两边各写一份字面量的话，
        // 改了一处另一处就开始放行，而且不报错
        const ST_CODE_CUT_MARK = '…（结果太长，已截断）';

        // 哪些工具算「只读」。两个用处：
        //   ① 只读**不占 th.steps** —— 「低」档才 8 步，读卡 + 读状态栏 + 读 Zod
        //      就用掉 3 步，真正要改的那一下反而没预算了；
        //   ② 用 ST_CODE_READ_CHARS 而不是 ST_CODE_TOOL_CHARS。
        // ⚠ 清单要和 ST_CODE_TOOLS 里的名字对得上 —— 拼错一个不会报错，只是那条工具
        //   悄悄退回「吃步数 + 12000 截断」的老行为。套件里有一条**推导式**断言兜底：
        //   凡是名字以 `read_` / `list_` 开头的工具都必须在这里（以后加读工具忘登记会被抓到）
        const ST_CODE_READ_TOOLS = [
            'read_card', 'read_doc', 'read_regex', 'read_th',
            'read_skill', 'list_world_entries', 'read_world_entry', 'list_skills'
        ];
        // 只读不吃步数，但不能不限 —— 否则模型可以一直 read_card 转圈。
        // 单独给一个总上限，超了就停
        const ST_CODE_READ_STEPS_MAX = 40;

        // read_doc 分段读时，一次最多给这么多正文。比 ST_CODE_READ_CHARS 少留一点，
        // 是为了放「你读的是第 N–M 字」「接着读 from=…」那两行 —— 不留余量的话
        // 刚切好的正文又被外面那层硬截断削一刀，分页就白分了
        const ST_CODE_DOC_CHUNK = ST_CODE_READ_CHARS - 600;

        // fetch_url 一次最多回给模型多少字。比 ST_CODE_TOOL_CHARS 小 ——
        // 这个数直接决定「拉一个网页烧掉多少上下文」，给太松等于让模型一句话把窗口填满
        const ST_CODE_FETCH_CHARS = 8000;
        // 一次网络请求最多接受多大的响应体（字节）。没有这条的话，
        // 一个指向大文件的链接会把整个响应读进内存再截断
        const ST_CODE_FETCH_BYTES = 2 * 1024 * 1024;
        // 单个 skill 正文上限。⚠ 落盘走的是 IndexedDB（见下面 stCodeSkillWrite），
        // 这个数已经不是「localStorage 配额」定的了，而是「一次塞给模型多少」定的
        const ST_CODE_SKILL_CHARS = 40000;

