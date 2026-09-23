// _reverse15.js —— 反向测试 `vertex-verify.js`（第十八轮「服务商扩充 + Vertex AI」那一套）。
//
// 为什么必须有：`vertex-verify.js` 报「104 通过 / 0 失败」只说明**这次**没红，
// ⚠ 那个数字**会漂**（每加一段断言就变），以实际跑出来为准 —— 别拿它当判据。
// 不说明它**会**红。一个永远为真的断言会让整套看着很绿、其实什么都没验。
//
// 这一轮的东西有个共同形状：**「协议」在界面上看不出来**。
// 服务商选对了、模型名填对了、Key 也填了 —— 发出去的**形状**对不对，
// 只有请求本身知道。所以这一套的重点是逼着每条断言回答
// 「你怎么知道发出去的是 Gemini 形状，而不是 OpenAI 形状」。
//
//   探针 R1：预设表里 custom 写回 `proto:'openai'` → resolver 整条跳过 URL
//   探针 R2：`stAiEnsureProto` 空转                → 半成品 cfg 一律按 openai 发
//   探针 R3：`stAiProtoOf` 不看预设表（一律猜）    → 空 Base URL 时判不出协议
//   探针 R4：Vertex 快速模式的路径也带 projects    → Express 那条路直接 404
//   探针 R5：完整模式不标 `needsToken`             → 不换 token、还塞个空 Key
//   探针 R6：`stAiGeminiBody` 不补首条 user        → 400 INVALID_ARGUMENT
//   探针 R7：吞掉 importKey 的错误                 → 报的是「parameter 2 is not…」
//   探针 R8：`stAiGeminiHost` 忽略 location        → 区域端点全变成 global
//
// ⚠ 注入点在**产品**（`saki.html`），不在套件。每个探针都是**一处**最小改动，
//   跑完立刻还原，收尾核 sha1 —— 不核的话「注入过的产品」会被当成基线。
// ⚠ 每个探针都配了**对照组**（`green`）：那些断言在被注入之后**必须还是绿的**。
//   没有对照组的话，「全红」也能骗过这一关。
// ⚠⚠ 探针点名的断言必须在基线里真的存在（见下面那段存在性闸门）：
//   `red` 里的名字漂了 ⇒「预期该红的都红了」**永远红**；
//   `green` 里的名字漂了 ⇒「对照组一条都没红」**天然成立** —— 对照组被悄悄削弱，
//   而整套照样打 ✅。两边的名单都要查。
//   ⚠ 这一套的失败项列表符是 `❌`（`vertex-verify.js` 的 `fails.forEach` 前缀），
//     **不是** `_reverse14.js` 那套的 `·` —— 照抄就会一条都匹配不上。
//     所以这里一次覆盖全部已知符号（见 `LIST_MARK`）。
//
// 跑法：node _reverse15.js   （基线 + 8 个探针 = 9 次整跑）
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const DIR = __dirname;
const PAGE = path.join(DIR, '..', 'saki.html');
const SUITE = path.join(DIR, 'vertex-verify.js');
const BAK = path.join(DIR, '_reverse15.bak');

// ⚠ 上一次没还原干净就拒绝启动 —— 否则会把「注入过的产品」当成基线备份下来
if (fs.existsSync(BAK)) {
    console.log('⚠ 目录里还留着 _reverse15.bak —— 上一次没还原。' +
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

function runSuite() {
    const r = spawnSync(process.execPath, [SUITE], {
        cwd: DIR, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 600000
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
//   其实是**这一针打的是语法、不是逻辑**。这个闸门就是用来分开这两种情况的：
//   把内联 <script> 抽出来交给 `node --check`，语法不通就别往下比红绿了。
//   （写临时文件走 os.tmpdir()，**不进仓库** —— 免得搅乱 run-all 的清单对账）
function pageParses() {
    const html = fs.readFileSync(PAGE, 'utf8');
    const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
    if (!blocks.length) return { ok: false, err: '一个内联 <script> 都没抽到' };
    const tmp = path.join(os.tmpdir(), '_reverse15-pagecheck.js');
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
        id: 'R1',
        why: '预设表里 custom 写回 proto:\'openai\' → resolver 整条跳过 URL',
        // ⚠⚠ 这一针打的就是**本轮真犯过的错**：我给合并后的表里 custom 那条写了
        //   `proto: 'openai'`（想当然「自定义 = OpenAI 兼容」），于是
        //   「自定义 + 粘 Anthropic 域名」按 OpenAI 形状发出去 —— 界面显示全对、
        //   只有真发一次才看得出来。而当时所有断言**照样全绿**，因为它们测的是
        //   「猜」那一步（stAiGuessProto），真正决定形状的是「决议」那一步（stAiProtoOf）。
        from: "{ value: 'custom', label: '自定义（按 Base URL 猜协议）', baseUrl: '', proto: '', group: '其他', custom: true }",
        to:   "{ value: 'custom', label: '自定义（按 Base URL 猜协议）', baseUrl: '', proto: 'openai', group: '其他', custom: true }",
        red: [
            '⚠ 只有 custom 允许不写死 proto（它是「按 URL 猜」）',
            '⚠⚠ resolver：自定义 + aiplatform → gemini',
            '⚠⚠ resolver：自定义 + Anthropic 域名 → anthropic',
            '⚠ 自定义半成品按 URL 补成 anthropic'
        ],
        // 对照组：**「猜」那一步和别的服务商**都没被动 —— 它们绿着正好说明
        // 红的是「决议跳过了 URL」，不是「猜坏了」
        green: [
            '自定义 + aiplatform 域名 → gemini',
            '⚠ 自定义 + 兼容层域名 → openai',
            '自定义 + 普通域名 → openai',
            '⚠⚠ resolver：自定义 + 兼容层 → openai',
            'resolver：自定义 + 普通域名 → openai',
            'Vertex → gemini',
            'Anthropic → anthropic',
            '⚠ vertex 半成品补成 gemini'
        ]
    },
    {
        id: 'R2',
        why: '`stAiEnsureProto` 空转 → 半成品 cfg 一律按 openai 发',
        // 全局面板的 `apigGather()` 返回的对象里**没有 proto**（协议是推导出来的）。
        // 这一步没了的话：AI Studio / Vertex 都按 openai 形状发 —— 拿 Bearer 打 Google、
        // URL 里也没有模型名。⚠ 而「快速模式 URL 里不出现 projects/」那条**照样绿**
        //   （openai 形状的 URL 里当然没有 projects/）—— 那正是对照组存在的意义
        from: "            if (cfg && !cfg.proto) cfg.proto = stAiProtoOf(cfg.provider, cfg.baseUrl);",
        to:   "            /* 注入：不补 proto */",
        red: [
            '⚠ vertex 半成品补成 gemini',
            '⚠ gemini 原生半成品补成 gemini',
            '⚠ 自定义半成品按 URL 补成 anthropic',
            '⚠ 补完之后是 Vertex 快速模式的 URL 形状（publishers/google/models，不带 projects）',
            '⚠ 完整模式的 URL 带 projects / locations',
            '⚠ 完整模式要标 needsToken（调用方才知道去换 token）',
            '⚠ 补完之后带的是 x-goog-api-key（不是 Bearer）',
            '（对照）补完之后**不**带 Authorization',
            // ⚠ 连带红：这条查的是「完整模式不带 API Key」，而 openai 形状**带**
            //   Authorization ⇒ 一起红。一条不落地写进 red，否则「没有预期之外的红」会拦下
            '（对照）完整模式的 plan 里也**不**带 Authorization（token 还没换）'
        ],
        green: [
            '补之前 proto 是空的（对照组：证明这一步真的做了事）',
            '（对照）快速模式的 URL 里**不**出现 projects/',
            // ⚠ 这两条在两种实现下都绿：openai 形状**本来**就没有 x-goog-api-key 这个头。
            //   它们证明的是「注入面只到鉴权头，没把整条 plan 弄没」
            '⚠ 完整模式的 plan 里**不**带 x-goog-api-key（Key 那一栏本来是空的）'
        ]
    },
    {
        id: 'R3',
        why: '`stAiProtoOf` 不看预设表（一律猜）→ 空 Base URL 时判不出协议',
        // ⚠⚠ 这一针**第一次跑的时候是「无可观测效果」的** —— 也就是说预设表里那个
        //   `proto` 字段当时**没人看着**：所有预设的 baseUrl 里都带关键词，
        //   光靠猜也能猜对。为此专门补了三条「空 Base URL」的断言（只有表能答）。
        //   ⇒ 「一条注入无可观测效果」= 套件缺一条断言，这条规矩是真的会发生的
        from: "            const p = AI_PROVIDERS.find(x => x.value === provider);\r\n" +
              "            if (p && p.proto) return p.proto;\r\n" +
              "            return stAiGuessProto(baseUrl, provider);",
        to:   "            return stAiGuessProto(baseUrl, provider);   // 注入：不看预设表",
        red: [
            // ⚠⚠ 只有这一条是真的「只有表能答」—— 另两条（vertex / anthropic）**光靠名字
            //   也猜得对**，所以它们必须留在 green 里。这是本针第一次跑时发现的：
            //   我原来给三条都写了「只有表能答」，一注入才发现只有一条站得住
            '⚠⚠ 空 Base URL：gemini 原生仍判成 gemini（值里没关键词 ⇒ **只有表能答**）'
        ],
        // 对照组：**带关键词的 URL** 光靠猜也对 —— 它们绿着正说明这一针只打到了
        // 「表」那一步，没把「猜」弄坏
        green: [
            'AI Studio 原生 → gemini',
            'Vertex → gemini',
            'Anthropic → anthropic',
            '⚠ Gemini 兼容层 → openai（不能误判成 gemini）',
            'DeepSeek → openai',
            '⚠⚠ resolver：自定义 + aiplatform → gemini',
            '⚠⚠ resolver：自定义 + Anthropic 域名 → anthropic',
            '空 Base URL：vertex 仍判成 gemini（值里带 vertex，猜也能猜到）',
            '空 Base URL：anthropic 仍判成 anthropic（值里带 anthropic，猜也能猜到）'
        ]
    },
    {
        id: 'R4',
        why: 'Vertex 快速模式的路径也带 projects → Express 那条路直接 404',
        // 快速模式（Express）的路径是 `/v1/publishers/google/models/{m}:{action}`，
        // **不带** projects —— 它压根不知道 project 是什么。带上去了服务端只会 404，
        // 而且报的是「模型不存在」，看着像模型名写错了
        from: "            return '/v1/publishers/google/models/' + m + ':' + action;",
        to:   "            return '/v1/projects/' + String(cfg.project || '') + '/locations/' +\r\n" +
              "                String(cfg.location || 'global') + '/publishers/google/models/' + m + ':' + action;   // 注入",
        red: [
            '⚠ 补完之后是 Vertex 快速模式的 URL 形状（publishers/google/models，不带 projects）',
            '（对照）快速模式的 URL 里**不**出现 projects/',
            'Vertex 快速模式 URL（无 projects 段）',
            'Vertex 快速模式流式'
        ],
        // 对照组：**完整模式那几条**（本来就该带 projects）和 AI Studio 没被动
        green: [
            '⚠ 完整模式的 URL 带 projects / locations',
            '⚠ location=global 时端点**不带地区前缀**',
            '列模型 URL（快速模式）',
            '列模型 URL（完整模式）',
            'AI Studio 原生 URL'
        ]
    },
    {
        id: 'R5',
        why: '完整模式不标 `needsToken` → 不换 token、还塞个空 Key',
        // `stAiRequest` 保持**同步**（套件直接取返回值），所以换 token 只能在调用方做，
        // 靠 `plan.needsToken` 这个标记传话。标记丢了的话：请求既没有 token，
        // 又带着一个空的 `x-goog-api-key` —— 服务端报含糊的 401，
        // 看着像「Key 填错了」，其实是模式选错了
        from: "                const needsToken = stAiIsVertex(cfg) && (cfg.authMode === 'sa');",
        to:   "                const needsToken = false;   // 注入：完整模式也不标",
        red: [
            '⚠ 完整模式要标 needsToken（调用方才知道去换 token）',
            '⚠ 完整模式的 plan 里**不**带 x-goog-api-key（Key 那一栏本来是空的）'
        ],
        // 对照组：**快速模式那几条**没被动（它本来就 needsToken=false、
        // 本来就该带 x-goog-api-key）—— 绿着正说明红的是「完整模式那一支」
        green: [
            'gemini plan 标了 needsToken=false',
            'gemini plan 带 x-goog-api-key',
            'gemini 快速模式**不**带 Authorization',
            '（对照）完整模式的 plan 里也**不**带 Authorization（token 还没换）'
        ]
    },
    {
        id: 'R6',
        why: '`stAiGeminiBody` 不补首条 user → 400 INVALID_ARGUMENT',
        // Gemini 要求 contents **非空**且**第一条必须是 user**。不满足时服务端报
        // 400 INVALID_ARGUMENT，看着像「请求体写错了」而不是「少了条消息」。
        // ⚠ 这一针只拆**首条是 assistant** 那条补丁：只有 system 时那条（contents 为空）
        //   还在，所以「只有 system 时补的第一条是 user」必须还是绿的
        from: "            if (contents[0].role !== 'user') contents.unshift({ role: 'user', parts: [{ text: '（继续）' }] });",
        to:   "            /* 注入：不补首条 user */",
        red: [
            '⚠ 首条是 assistant 时补一条 user 在前面'
        ],
        green: [
            '⚠ 只有 system 时 contents 仍非空',
            '⚠ 只有 system 时补的第一条是 user',
            'system 抽进 systemInstruction',
            'contents 三条（system 不在里面）',
            'assistant 映射成 model',
            'user 保持 user'
        ]
    },
    {
        id: 'R7',
        why: '吞掉 importKey 的错误 → 报的是「parameter 2 is not of type CryptoKey」',
        // ⚠⚠ 这一针**第一次跑的时候也是「无可观测效果」的** —— 因为套件当时只查
        //   「抛没抛」（`sa.threw`）。把 importKey 的错误吞掉，后面
        //   `subtle.sign(key = null)` 照样会抛，`threw` 还是 true。
        //   ⇒ 补了一条「报的错要说清是**私钥**」之后它才咬得动。
        //   这正是「反向测试反过来找套件的洞」那一类收获
        // ⚠⚠ 注入片段必须**把整块包住**（含 catch 的收尾 `}`）——
        //   第一次写的时候只包了两行、漏了那个 `}`，替换后产品里留了个孤立的 `}`，
        //   **整个内联脚本解析失败**，套件红成一片（看着像产品彻底坏了）。
        //   所以下面加了一道「注入后页面还解析得动吗」的闸门（见 pageParses）
        from: "            } catch (e) {\r\n" +
              "                throw new Error('私钥读不出来（private_key 不是 PKCS#8 PEM？）：' + ((e && e.message) || e));\r\n" +
              "            }",
        to:   "            } catch (e) { key = null; }   // 注入：吞掉私钥错误",
        red: [
            '⚠ 报的错要说清是**私钥**读不出来（不能是后面某步顺带炸的）'
        ],
        // 对照组：**「抛没抛」那条**还是绿的 —— 它绿着正说明这一针不是「不抛了」，
        // 而是「抛的是另一件事」，也就是那条断言太弱
        green: [
            '假私钥必须抛错（不能静默成功）'
        ]
    },
    {
        id: 'R8',
        why: '`stAiGeminiHost` 忽略 location → 区域端点全变成 global',
        // Vertex 的区域端点形如 `https://us-central1-aiplatform.googleapis.com`，
        // 只有 `global` 才不带前缀。忽略 location 的话，配了 us-central1 的请求会打到
        // global 端点 —— 项目没开 global 就 404，开了也可能取到另一个区域的数据
        from: "            const loc = String((cfg && cfg.location) || 'global').trim() || 'global';\r\n" +
              "            return loc === 'global'\r\n" +
              "                ? 'https://aiplatform.googleapis.com'\r\n" +
              "                : 'https://' + loc + '-aiplatform.googleapis.com';",
        to:   "            return 'https://aiplatform.googleapis.com';   // 注入：忽略 location",
        red: [
            'Vertex 完整模式 URL（带 projects/locations）',
            '列模型 URL（完整模式）',
            '⚠ 完整模式的 URL 带 projects / locations'
        ],
        // 对照组：**global 那一条**（本来就不带前缀）和快速模式没被动
        green: [
            '⚠ location=global 时端点**不带地区前缀**',
            'Vertex 快速模式 URL（无 projects 段）',
            'Vertex 快速模式流式',
            '列模型 URL（快速模式）',
            'AI Studio 原生 URL'
        ]
    }
];

// 先跑一遍**没注入**的，拿到基线（也顺便确认套件本身现在是绿的）
console.log('== 基线（未注入）==');
const base = runSuite();
const bs = summaryOf(base.out);
const basePass = passesOf(base.out);
expect('套件能跑完（有汇总行）', !!bs, JSON.stringify(bs));
expect('基线是绿的（0 失败）', !!bs && bs.fail === 0, JSON.stringify(bs));
console.log('     基线 ' + (bs ? bs.pass : '?') + ' 条绿（这一套的断言总数）');

// ⚠ 基线里一条 ✅ 都没有 ⇒ 下面的「名字还在不在」全部无从谈起，
//   而且 `red` 会一条都匹配不上还打 ✅。直接拦掉
expect('基线里能抽到断言名（否则后面的存在性检查是空转）', basePass.length > 0, basePass.length);

// 先把所有探针点名的断言核一遍存在性 —— 这步**不需要跑套件**，纯离线。
console.log('\n== 探针点名的断言，在基线里都在吗 ==');
let stale = 0;
for (const p of PROBES) {
    const miss = p.red.concat(p.green).filter(x => !hit(basePass, x));
    expect(p.id + ' 点名的 ' + (p.red.length + p.green.length) + ' 条断言都在基线里',
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
        r = syn.ok ? runSuite() : { code: 1, out: '' };
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

console.log('\n===== 反向测试（服务商扩充 + Vertex AI）：' + (bad ? bad + ' 项不达标' : '全部达标') + ' =====');
process.exit(bad ? 1 : 0);
