// _reverse16.js —— 反向测试**第十九轮**（Vertex AI 收口：照着酒馆改的那一批）。
//
// 这一轮修的东西有个共同形状：**失败被伪装成了别的东西**。
//   · 完整模式「永远过不了就绪检查」→ 用户看到的是「还没填 API Key」，
//     而真正的原因是「apiKey 在完整模式下本来就是空的」
//   · 被安全策略拦 → 用户看到的是「AI 没说话」，而真正的原因是 candidates 不存在
//   · project 拼成空串 → 用户看到的是 404，而真正的原因是「少了项目」
//   · 私钥粘错 → 用户看到的是 `parameter 2 is not of type CryptoType` 这句天书
// ⇒ 所以这一套的重点是逼着每条断言回答「**你是怎么知道它失败了的**」。
//
// 探针（全部打在**产品** `saki.html`，一处最小改动，跑完立刻还原）：
//   R1  `stAiVertexProject` 不派生               → 完整模式 project 永远是空 ⇒ 404
//   R2  `stAiReady` 的 vertex 分支整个跳过        → 完整模式被「没填 Key」拦下
//   R3  不发 `safetySettings`                    → 被默认策略拦，表现是「AI 没说话」
//   R4  Vertex 不拼 `ST_VERTEX_SAFETY`           → 少 5 类阈值（含 JAILBREAK）
//   R5  `nonStreamChat` 不问「为什么是空的」      → 【ai对话】静默空串
//   R6  `stAiChat` 不问「为什么是空的」           → 编写器静默空串（**另一份实现**）
//   R7  掩码时 `apigGather` 读不到那份 JSON      → 打开面板看一眼再保存，密钥就没了
//   R8  掩码时顺手清空 textarea                  → 同上，从**写**的那一侧
//
// ⚠ 注入点在**产品**（`saki.html`），不在套件。每个探针都是**一处**最小改动，
//   跑完立刻还原，收尾核 sha1 —— 不核的话「注入过的产品」会被当成基线。
// ⚠ 每个探针都配了**对照组**（`green`）：那些断言在被注入之后**必须还是绿的**。
//   没有对照组的话，「全红」也能骗过这一关。
// ⚠⚠ 探针点名的断言必须在基线里真的存在（见下面那段存在性闸门）：
//   `red` 里的名字漂了 ⇒「预期该红的都红了」**永远红**；
//   `green` 里的名字漂了 ⇒「对照组一条都没红」**天然成立** —— 对照组被悄悄削弱，
//   而整套照样打 ✅。两边的名单都要查。
// ⚠⚠ **这一轮有两套被测**（`vertex-verify.js` / `apig-verify.js`），所以每个探针
//   自带 `suite` 字段 —— 上面那套 `_reverse15.js` 只有一个 `SUITE` 常量。
// ⚠ 两套的失败项列表符**不一样**（vertex 用 `❌`，apig 用 `·`）⇒ `LIST_MARK` 一次覆盖全部。
// ⚠ 页面语法闸门（`pageParses`）照 `_reverse15.js` 带过来：注入把页面搞成语法错时，
//   套件会「红一大片」，看着像产品彻底坏了，其实打的是语法不是逻辑。
//
// 跑法：node _reverse16.js   （2 个基线 + 8 个探针 = 10 次套件运行）
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const DIR = __dirname;
const PAGE = path.join(DIR, '..', 'saki.html');
const SUITES = {
    vertex: path.join(DIR, 'vertex-verify.js'),
    apig: path.join(DIR, 'apig-verify.js')
};
const BAK = path.join(DIR, '_reverse16.bak');

// ⚠ 上一次没还原干净就拒绝启动 —— 否则会把「注入过的产品」当成基线备份下来
if (fs.existsSync(BAK)) {
    console.log('⚠ 目录里还留着 _reverse16.bak —— 上一次没还原。' +
        '先人工核对 saki.html，再删掉它重跑。');
    process.exit(1);
}

// ⚠ 原样读，别 replace(/\r/g,'')，否则会把 CRLF 写没
const ORIG = fs.readFileSync(PAGE, 'utf8');
const sha1 = s => crypto.createHash('sha1').update(s, 'utf8').digest('hex');
const H0 = sha1(ORIG);

let bad = 0;
const expect = (name, cond, extra) => {
    console.log((cond ? '  ✅ ' : '  ❌ ') + name + (extra ? '   ' + extra : ''));
    if (!cond) bad++;
};
const nm = s => String(s).trim();

function runSuite(which) {
    const r = spawnSync(process.execPath, [SUITES[which]], {
        cwd: DIR, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 900000
    });
    return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}
// 汇总行用来确认「确实跑完了」—— 提前退出的话它会缺
function summaryOf(out) {
    const m = out.match(/(\d+)\s*通过\s*\/\s*(\d+)\s*失败/);
    return m ? { pass: Number(m[1]), fail: Number(m[2]) } : null;
}
// 失败项那一列。⚠ 列表符各家套件不一样（`-` / `·` / `❌`）—— 照抄别家的写法会
//   **一条都匹配不上**，而且表现为「对照组没红 ✅」，看着像过了。这里一次覆盖全部已知符号
const LIST_MARK = /^\s*(?:[-·×✗❌*]+)?\s*/;
function failsOf(out) {
    const i = out.lastIndexOf('失败项：');
    if (i < 0) return [];
    return out.slice(i).split(/\r?\n/).slice(1)
        .map(s => s.replace(LIST_MARK, '')).map(nm).filter(Boolean);
}
// 基线里**真的绿过**的断言名。
// ⚠⚠ 一律 `nm()`（trim）之后再比：`check()` 打的是 `  ✅ ` + 名字，而**名字自己
//   可能带前导空格**，那个正则的 `\s+` 会把名字自己的空格一起吃掉。
function passesOf(out) {
    return (out.match(/^\s*✅\s+(.*)$/gm) || [])
        .map(s => nm(s.replace(/^\s*✅\s*/, '')));
}
const hit = (list, x) => list.indexOf(nm(x)) >= 0;

// ⚠ 注入片段必须**把整块包住**（含收尾的 `}`）。少包一行就会在产品里留下语法残渣，
//   而它的表现是「**整个内联脚本解析失败**」—— 套件红一大片（看着像产品彻底坏了），
//   其实是**这一针打的是语法、不是逻辑**。这个闸门就是用来分开这两种情况的。
//   （写临时文件走 os.tmpdir()，**不进仓库** —— 免得搅乱 run-all 的清单对账）
function pageParses() {
    const html = fs.readFileSync(PAGE, 'utf8');
    const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
    if (!blocks.length) return { ok: false, err: '一个内联 <script> 都没抽到' };
    const tmp = path.join(os.tmpdir(), '_reverse16-pagecheck.js');
    fs.writeFileSync(tmp, blocks.map(m => m[1]).join('\n;\n'), 'utf8');
    const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
    try { fs.unlinkSync(tmp); } catch (e) {}
    return {
        ok: r.status === 0,
        err: String(r.stderr || '').split(/\r?\n/).slice(0, 3).join(' ')
    };
}

const PROBES = [
    {
        id: 'R1', suite: 'vertex',
        why: '`stAiVertexProject` 不派生 → 完整模式 project 永远是空 ⇒ /v1/projects//locations/…',
        // ⚠⚠ 这一针打的是**本轮修的硬 bug**：第一版要求用户**手填**项目 ID，
        //   不填就拼出 `/v1/projects//locations/global/...`，服务端回 404，
        //   而报错里完全看不出是「少了项目」。酒馆是 `getProjectIdFromServiceAccount()`
        //   —— 从密钥 JSON 的 `project_id` 取，界面上根本没有这一格。
        from: "            const typed = String((cfg && cfg.project) || '').trim();\r\n" +
              "            if (typed) return typed;\r\n" +
              "            const sa = stAiSaParse((cfg && cfg.saJson) || '');\r\n" +
              "            return sa.ok ? String(sa.projectId || '').trim() : '';",
        to:   "            // 注入：不派生，只认手填的那个\r\n" +
              "            return String((cfg && cfg.project) || '').trim();",
        red: [
            '⚠ 完整模式：project 从 SA JSON 自动派生',
            // ⚠ 这两条**看起来该绿、其实该红** —— 它们的 cfg **都没有手填 project**
            //   （`saOk` 只有 `saJson`、H2 那条也只有 `apiKey:''` + `saJson`），
            //   前提正是「JSON 能提供项目」。断了派生 ⇒ 它们改红在「缺项目」上，
            //   是**合法连带红**（第一版把它们列进了 green ⇒ 闸门当场拦下）。
            //   ⚠ 判据：连带红必须一条不落地写进 red，不能因为「不是我直接打的」就放过。
            '完整模式配齐 → 通过',
            '⚠⚠ 完整模式（apiKey 空 + SA JSON 齐）→ 通过（别被「没填 Key」拦下）'
        ],
        // 对照组：**手填优先**那条与「缺项目要报错」那条都不该受影响
        //   —— 前者走 `typed` 那一支、后者本来就该报错，注入没动它们的前提
        green: [
            '⚠ 完整模式：手填的 project 优先于 JSON 里的',
            '完整模式缺 project → 报错'
        ]
    },
    {
        id: 'R2', suite: 'vertex',
        why: '`stAiReady` 的 vertex 分支整个跳过 → 完整模式被「没填 API Key」拦下',
        // ⚠⚠ 这是本轮**最硬的 bug**：完整模式鉴权走 Service Account 换的 token，
        //   `apiKey` **本来就是空的** ⇒ 通用那条「没填 Key」检查会把它拦下，
        //   于是完整模式**永远跑不起来**。而当时 `stAiReady` 一条断言都没有，
        //   所以这个 bug 在 105 条全绿的套件里**完全隐身**（H2 段就是为此补的）。
        //   ⚠ 把条件换成 `false` 而不是删掉整块：保持语法完整，这一针只打逻辑
        from: "            if (stAiIsVertex(cfg)) {",
        to:   "            if (false) {   // 注入：vertex 分支整个跳过",
        red: [
            '⚠⚠ 完整模式（apiKey 空 + SA JSON 齐）→ 通过（别被「没填 Key」拦下）',
            '⚠ 完整模式缺 SA JSON → 明说是 Service Account',
            '⚠ 完整模式：JSON 里没 project_id 也没手填 → 明说缺项目'
        ],
        // 对照组：非 vertex 的那几条走的**本来就不是**这个分支
        green: [
            '（对照）快速模式缺 Key → 照样报错',
            '（对照）快速模式配齐 → 通过',
            '（对照）缺模型名 → 报错',
            '快速模式缺 Key → 报错',
            '快速模式配齐 → 通过',
            '本地地址可以不填 Key'
        ]
    },
    {
        id: 'R3', suite: 'vertex',
        why: '不发 `safetySettings` → 被默认策略拦，表现是「AI 没说话」',
        // ⚠⚠ 酒馆两个模式都发 safetySettings、阈值全是 `OFF`；第一版我一个都没发。
        //   后果不是「报错」，而是**更容易被拦 + 拦了看不出来**：candidates 根本不存在，
        //   前端拿到空串 —— 用户只会以为「模型没理我」。
        from: "            body.safetySettings = stAiGeminiSafety(cfg);",
        to:   "            /* 注入：不发 safetySettings */",
        red: [
            '⚠ 请求体带 safetySettings（不发就会被默认策略拦）',
            '⚠ 阈值全是 OFF（照抄酒馆，不是 BLOCK_NONE）',
            // ⚠ 这两条一开始**不在名单里**（我以为它们读的是另一个字段）—— 实测会一起红：
            //   `safety` 与 `safetyVertex` 都是从**请求体**取的，删掉那一行两份都没了。
            //   反向测试的闸门「没有预期之外的红」当场把它拦下 ⇒ 名单补全。
            '⚠ Vertex 比 AI Studio 多 5 类（含 JAILBREAK）',
            '⚠ Vertex 那份里有 HARM_CATEGORY_JAILBREAK'
        ],
        // 对照组：请求体别的部分、以及取文逻辑都不该受影响
        green: [
            'system 抽进 systemInstruction',
            'contents 三条（system 不在里面）',
            'assistant 映射成 model',
            '⚠ 只有 system 时 contents 仍非空',
            '取文只挑有 text 的 part',
            '被安全拦截时取文不炸'
        ]
    },
    {
        id: 'R4', suite: 'vertex',
        why: 'Vertex 不拼 `ST_VERTEX_SAFETY` → 少 5 类阈值（含 JAILBREAK）',
        from: "ST_GEMINI_SAFETY.concat(stAiIsVertex(cfg) ? ST_VERTEX_SAFETY : [])",
        to:   "ST_GEMINI_SAFETY.slice()",
        red: [
            '⚠ Vertex 比 AI Studio 多 5 类（含 JAILBREAK）',
            '⚠ Vertex 那份里有 HARM_CATEGORY_JAILBREAK'
        ],
        // 对照组：**AI Studio 那份**本来就只该有 5 条 —— 它绿着正说明
        // 这一针只打到了「Vertex 多出来那 5 类」，没把基础那份弄坏
        green: [
            '⚠ 请求体带 safetySettings（不发就会被默认策略拦）',
            '⚠ 阈值全是 OFF（照抄酒馆，不是 BLOCK_NONE）'
        ]
    },
    {
        id: 'R5', suite: 'apig',
        why: '`nonStreamChat` 不问「为什么是空的」→ 【ai对话】静默返回空串',
        // ⚠⚠ 空串是个**合法**返回值 ⇒ 「被安全策略拦了」和「真的回了空」
        //   在调用方看来**一模一样**。不追问原因，用户看到的就是「AI 没说话」。
        //   ⚠ 这一针打在**接线**上：`stAiWhyEmpty` 本身照旧返回正确的原因，
        //     只是没人去问它 —— 所以只断言函数返回值的套件**抓不到**这种情况。
        from: "            if (!full) {\r\n" +
              "                const why = stAiWhyEmpty(plan.proto, data);\r\n" +
              "                if (why) throw new Error(why);\r\n" +
              "            }",
        to:   "            if (!full) { const why = ''; if (why) throw new Error(why); }   // 注入：不追问",
        red: [
            '⚠ gemini 被安全策略拦 → 报出 blockReason（不是静默空串）',
            '⚠ gemini finishReason=SAFETY → 报出来',
            '⚠ OpenAI content_filter → 报出来'
        ],
        // 对照组：**真的**空回复本来就不该抛错；编写器那条路是**另一份实现**，
        // 它绿着正说明这一针只打到了【ai对话】这一份
        green: [
            '（对照）正常 STOP 但内容为空 → 不抛错，照常返回',
            '⚠ stAiChat 那条路也要问原因（两份实现，别只改一份）'
        ]
    },
    {
        id: 'R6', suite: 'apig',
        why: '`stAiChat` 不问「为什么是空的」→ 编写器静默返回空串（**另一份实现**）',
        // ⚠⚠ 同一个坑有**两份实现**（`stAiChat` 给编写器/Code 页，`nonStreamChat` 给
        //   【ai对话】）。R5 打其中一份、R6 打另一份 —— 只改一处的日子就是这样被抓住的。
        from: "                // ⚠ 正文为空时**追问原因**再返回 —— 空串是合法返回值，所以「被拦了」\r\n" +
              "                //   和「真的空回复」在调用方看来一模一样（见 stAiWhyEmpty）\r\n" +
              "                if (!full) {\r\n" +
              "                    const why = stAiWhyEmpty(plan.proto, data);\r\n" +
              "                    if (why) throw new Error(why);\r\n" +
              "                }",
        to:   "                // 注入：不再追问原因\r\n" +
              "                if (!full) {\r\n" +
              "                    const why = '';\r\n" +
              "                    if (why) throw new Error(why);\r\n" +
              "                }",
        red: [
            '⚠ stAiChat 那条路也要问原因（两份实现，别只改一份）'
        ],
        // 对照组：【ai对话】那一份（R5 的目标）不该被动 —— 它绿着正说明两份是**独立**的，
        // 这一针确实只打到了 stAiChat
        green: [
            '⚠ gemini 被安全策略拦 → 报出 blockReason（不是静默空串）',
            '（对照）正常 STOP 但内容为空 → 不抛错，照常返回'
        ]
    },
    {
        id: 'R7', suite: 'vertex',
        why: '掩码时 `apigGather` 读不到那份 JSON → 打开面板看一眼再保存，密钥就没了',
        // ⚠⚠ 掩码只是把 textarea **藏起来**（`hidden`），value 一直留着 ——
        //   这正是它安全的原因。要是哪天改成「掩码时 value 也清掉」，
        //   用户打开面板看一眼、直接点保存，密钥就**静默**没了：不报错、界面也正常，
        //   直到下次发消息才「怎么突然没权限了」。
        from: "                saJson: document.getElementById('apig-sa').value",
        to:   "                saJson: (document.getElementById('apig-sa').hidden ? '' : document.getElementById('apig-sa').value)   // 注入",
        red: [
            '⚠⚠ 掩码态下 apigGather 仍拿得到那份 JSON'
        ],
        // 对照组：掩码**显示**那几条不该受影响 —— 它绿着正说明红的不是「掩码坏了」，
        // 而是「掩码把值弄丢了」
        green: [
            '⚠ 存过之后进掩码态（不把私钥摊在屏幕上）',
            '⚠ 掩码时 textarea 藏起来',
            '⚠ 掩码条只说「存的是哪一份」（client_email · project_id）',
            '「换一份」把 textarea 显出来'
        ]
    },
    {
        id: 'R8', suite: 'vertex',
        why: '掩码时顺手清空 textarea → 同一个危险的**另一侧**（写的那一侧）',
        from: "                box.hidden = false;\r\n" +
              "                ta.hidden = true;",
        to:   "                box.hidden = false;\r\n" +
              "                ta.hidden = true;\r\n" +
              "                ta.value = '';   // 注入：掩码时顺手清掉",
        red: [
            '⚠⚠ 掩码态下 apigGather 仍拿得到那份 JSON',
            '⚠ 「换一份」**不清空**已有内容（改主意直接保存不会丢）'
        ],
        // 对照组：掩码**外观**那几条照旧 —— 说明这一针打的是「值被清了」，
        // 不是「掩码不显示了」
        green: [
            '⚠ 存过之后进掩码态（不把私钥摊在屏幕上）',
            '掩码条真的是 flex 显示',
            '⚠ 掩码时 textarea 藏起来',
            '「换一份」把 textarea 显出来'
        ]
    }
];

// 先跑一遍**没注入**的两个套件，拿到基线（也顺便确认它们现在是绿的）
const base = {};
for (const which of ['vertex', 'apig']) {
    console.log('== 基线（未注入）· ' + which + ' ==');
    const r = runSuite(which);
    const s = summaryOf(r.out);
    base[which] = { pass: passesOf(r.out), summary: s };
    expect(which + '：套件能跑完（有汇总行）', !!s, JSON.stringify(s));
    expect(which + '：基线是绿的（0 失败）', !!s && s.fail === 0, JSON.stringify(s));
    console.log('     基线 ' + (s ? s.pass : '?') + ' 条绿（这一套的断言总数）');
    // ⚠ 基线里一条 ✅ 都没有 ⇒ 下面的「名字还在不在」全部无从谈起，
    //   而且 `red` 会一条都匹配不上还打 ✅。直接拦掉
    expect(which + '：基线里能抽到断言名', base[which].pass.length > 0, base[which].pass.length);
}

// 先把所有探针点名的断言核一遍存在性 —— 这步**不需要跑套件**，纯离线。
console.log('\n== 探针点名的断言，在对应套件的基线里都在吗 ==');
let stale = 0;
for (const p of PROBES) {
    const pool = base[p.suite].pass;
    const miss = p.red.concat(p.green).filter(x => !hit(pool, x));
    expect(p.id + '（' + p.suite + '）点名的 ' + (p.red.length + p.green.length) + ' 条都在',
        miss.length === 0, miss.length ? '找不到：' + miss.join(' / ') : '');
    stale += miss.length;
}
if (stale) {
    console.log('\n⚠ 有 ' + stale + ' 条探针期望对不上基线 —— 后面的整跑没有意义，先修期望。');
    process.exit(1);
}

for (const p of PROBES) {
    console.log('\n== ' + p.id + '：' + p.why + ' ==');
    const cnt = ORIG.split(p.from).length - 1;
    expect('注入点在产品里唯一（命中 ' + cnt + ' 次）', cnt === 1, cnt);
    if (cnt !== 1) { bad++; continue; }

    fs.writeFileSync(BAK, ORIG, 'utf8');
    fs.writeFileSync(PAGE, ORIG.replace(p.from, p.to), 'utf8');
    // ⚠ 先确认页面还解析得动（见 pageParses 的注释）—— 语法坏了就别比红绿
    const syn = pageParses();
    expect('注入后页面仍能解析（否则这一针打的是语法不是逻辑）', syn.ok, syn.ok ? '' : syn.err);
    let r;
    try {
        r = syn.ok ? runSuite(p.suite) : { code: 1, out: '' };
    } finally {
        fs.writeFileSync(PAGE, ORIG, 'utf8');   // 无论跑成什么样都先还原
    }
    expect('还原后产品与基线逐字节一致', sha1(fs.readFileSync(PAGE, 'utf8')) === H0);
    if (!syn.ok) continue;                      // 语法都坏了，下面的红绿比对没有意义

    const s = summaryOf(r.out);
    const got = failsOf(r.out);

    expect('注入后套件跑完了（有汇总行）', !!s, JSON.stringify(s));
    expect('  退出码是 1', r.code === 1, r.code);
    expect('  确实红了（失败数 > 0）', !!s && s.fail > 0, s && s.fail);

    const missRed = p.red.filter(x => !hit(got, x));
    expect('预期该红的都红了（' + p.red.length + ' 条）', missRed.length === 0, missRed);
    const badGreen = p.green.filter(x => hit(got, x));
    expect('对照组一条都没红（' + p.green.length + ' 条）', badGreen.length === 0, badGreen);
    expect('没有预期之外的红（恰好这几条）', got.length === p.red.length,
        '实际 ' + got.length + ' 条' + (got.length === p.red.length ? '' : '：' + got.join(' / ')));
}

// 收尾：备份文件必须删掉，且产品没被动过
if (fs.existsSync(BAK)) fs.unlinkSync(BAK);
console.log('\n== 收尾 ==');
expect('没留下 .bak', !fs.existsSync(BAK));
expect('saki.html 与基线逐字节一致', sha1(fs.readFileSync(PAGE, 'utf8')) === H0);

console.log('\n===== 反向测试（Vertex AI 收口）：' + (bad ? bad + ' 项不达标' : '全部达标') + ' =====');
process.exit(bad ? 1 : 0);
