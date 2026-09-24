// _reverse17.js —— 反向测试**第二十轮**（Google Vertex 的「列模型」+ 完整模式下 Key 藏不住）。
//
// 这一轮的起点是用户的**实测反馈**：
//   「还是有问题，我已经开放代理，但是却还是显示【列模型失败】，
//     以及在 vertex 的完整模式下，key 已经用不到了吧」
// 两句话正好各指一个真 bug，而**两个都躲过了 147 条全绿的套件**：
//   · 「Key 用不到了」→ `syncApigAuthUI` 里 `keyF.hidden = true` 逻辑一直是对的，
//     但 `.ai-field { display: flex }` 会盖掉 `hidden` 自带的 `display:none`
//     ⇒ **属性设上了、屏幕上还在**。而套件当时只断言元素存在、从没断言「它真的看不见」。
//   · 「列模型失败」→ 三个叠在一起的问题（见 R2 / R3 / R4）。
// ⇒ 这一套的重点：**「设了一个标志位」和「用户看到的效果」是两件事**，
//   以及**「失败」必须说得出是哪一步、并且不许伪装成成功**。
//
// 探针（全部打在**产品** `saki.html`，一处最小改动，跑完立刻还原）：
//   R1  删掉全局 `[hidden] { display: none }` 兜底 → 完整模式下 Key 那一格又冒出来
//   R2  `stAiModelIds` 不认 `publisherModels`     → URL 对了也拿回空列表（看着像没权限）
//   R3  列模型退回「单条 + v1」那个坏形状          → 试都不试别的路径
//   R4  `apigFetchModels` 不退回内置候选           → 只丢一句「获取失败」，用户不知道改什么
//   R5  `apigFetchModels` 又要求先有模型           → 按钮被「请填模型名」拦下，功能等于废掉
//
// ⚠ 注入点在**产品**（`saki.html`），不在套件。每个探针都是**一处**最小改动，
//   跑完立刻还原，收尾核 sha1 —— 不核的话「注入过的产品」会被当成基线。
// ⚠ 每个探针都配了**对照组**（`green`）：那些断言在被注入之后**必须还是绿的**。
//   没有对照组的话，「全红」也能骗过这一关。
// ⚠⚠ 探针点名的断言必须在基线里真的存在（见下面那段存在性闸门）：
//   `red` 里的名字漂了 ⇒「预期该红的都红了」**永远红**；
//   `green` 里的名字漂了 ⇒「对照组一条都没红」**天然成立** —— 对照组被悄悄削弱，
//   而整套照样打 ✅。两边的名单都要查。
// ⚠⚠ **这一轮两套被测**（`vertex-verify.js` / `apig-verify.js`），所以每个探针自带
//   `suite` 字段。⚠ 跑错套件 = 拿「没红」当「达标」（六之四十二）。
// ⚠ 两套的失败项列表符**不一样**（vertex 用 `❌`，apig 用 `·`）⇒ `LIST_MARK` 一次覆盖全部。
// ⚠ 页面语法闸门（`pageParses`）照 `_reverse15/16` 带过来：注入把页面搞成语法错时，
//   套件会「红一大片」，看着像产品彻底坏了，其实打的是语法不是逻辑。
//
// 跑法：node _reverse17.js   （2 个基线 + 5 个探针 = 7 次套件运行）
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
const BAK = path.join(DIR, '_reverse17.bak');

// ⚠ 上一次没还原干净就拒绝启动 —— 否则会把「注入过的产品」当成基线备份下来
if (fs.existsSync(BAK)) {
    console.log('⚠ 目录里还留着 _reverse17.bak —— 上一次没还原。' +
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
function pageParses() {
    const html = fs.readFileSync(PAGE, 'utf8');
    const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
    if (!blocks.length) return { ok: false, err: '一个内联 <script> 都没抽到' };
    const tmp = path.join(os.tmpdir(), '_reverse17-pagecheck.js');
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
        id: 'R1', suite: 'apig',
        why: '删掉全局 `[hidden]` 兜底 → 完整模式下「API Key」那一格又冒出来',
        // ⚠⚠ 这一针打的是**用户一眼看出来的那个 bug**：
        //   `syncApigAuthUI` 里 `keyF.hidden = (mode === 'sa')` 一直是对的，
        //   但 `.ai-field { display: flex }` 与 `hidden` 属性自带的 `display:none`
        //   **同权重**，后者输 ⇒ 属性设上了、屏幕上照样显示。
        //   ⇒ 所以 G3 那几条断言的是 **computed display**，不是 `el.hidden`。
        //     把断言换成 `el.hidden === true` 的话，这一针**照样全绿**（属性确实设了）。
        from: "        [hidden] { display: none !important; }",
        to:   "        /* 注入：删掉全局 [hidden] 兜底 */",
        red: [
            '⚠⚠ 完整模式：API Key 那一格**真的**藏住了（computed display = none）',
            '快速模式：project 那格藏住（只有完整模式才要项目 ID）',
            '快速模式：Service Account 那格藏住',
            '非 Vertex：整块 Vertex 区域藏住'
        ],
        // 对照组：「显示出来」那几条**本来就该绿** —— 它们绿着正说明这一针打的是
        //   「藏不住」，不是「CSS 整个坏了」
        green: [
            '完整模式：project 那格显示出来',
            '完整模式：location 那格显示出来',
            '完整模式：Service Account 那格显示出来',
            '（对照）快速模式：API Key 那一格**显示**（证明上一条不是「永远 none」）',
            '⚠ 两种模式：location 都显示（快速模式下它也真的生效，不是摆设）',
            '（对照）非 Vertex：API Key 那一格显示'
        ]
    },
    {
        id: 'R2', suite: 'vertex',
        why: '`stAiModelIds` 不认 `publisherModels` → URL 对了也拿回空列表',
        // ⚠⚠ Vertex 回的字段叫 `publisherModels`（不是 `data` / `models`）——
        //   少了这一支，路径蒙对了也会得到空列表，报出来是「返回里没有模型」，
        //   看着像「这个账号没权限」。这是**三个叠在一起的问题**里的第三个。
        from: "            } else if (data && Array.isArray(data.publisherModels)) {\r\n" +
              "                data.publisherModels.forEach(m => push(m && (m.name || m.id)));\r\n" +
              "            }",
        to:   "            }   // 注入：不认 publisherModels",
        red: [
            '⚠⚠ 列模型解析：认 publisherModels，剥掉 publishers/google/models/ 前缀并去重'
        ],
        // 对照组：URL 那几条、以及 stAiGeminiModel（**另一个函数**）剥前缀那几条
        //   —— 它们绿着正说明这一针只打到了「响应字段名」，没打到「路径」或「剥前缀」
        green: [
            '⚠ 列模型候选：第一条是 v1beta1（v1 那条没有 list 方法）',
            '⚠ 列模型候选：完整模式 3 条（v1beta1 无 project / v1beta1 带 project / v1 垫底）',
            '剥 models/ 前缀',
            '剥 google/ 前缀',
            '剥 publishers/google/models/ 前缀'
        ]
    },
    {
        id: 'R3', suite: 'vertex',
        why: '列模型退回「单条 + v1」那个坏形状 → 试都不试别的路径',
        // ⚠⚠ 官方 REST 目录里 v1 的 `projects.locations.publishers.models` **没有 `list`**
        //   （只有 computeTokens / countTokens / embedContent / generateContent / predict /
        //     rawPredict / stream*），真正有 `list` 的是 **v1beta1 的 `publishers.models`**。
        //   第一版就是按 v1 那条拼的 ⇒ 一次都没成功过。
        //   ⚠ 这一针把整段替换成「只返回一条」，而不是删掉某一行 ——
        //     要模拟的正是「**只有一条候选**」这个状态。
        from: "            const out = [];\r\n" +
              "            // ① v1beta1 · publisher models（不需要 project，也是唯一确认有 list 的那条）\r\n" +
              "            out.push(host + '/v1beta1/publishers/google/models');\r\n" +
              "            if (proj) {\r\n" +
              "                // ② v1beta1 · 带 project（有些项目/区域只认这条）\r\n" +
              "                out.push(host + '/v1beta1/projects/' + proj + '/locations/' + loc +\r\n" +
              "                    '/publishers/google/models');\r\n" +
              "                // ③ v1 · 带 project（老形状，留着兜底）\r\n" +
              "                out.push(host + '/v1/projects/' + proj + '/locations/' + loc +\r\n" +
              "                    '/publishers/google/models');\r\n" +
              "            }\r\n" +
              "            return out;",
        to:   "            // 注入：退回「单条 v1」那个坏形状\r\n" +
              "            return [host + '/v1/projects/' + proj + '/locations/' + loc +\r\n" +
              "                '/publishers/google/models'];",
        red: [
            '⚠ 列模型候选：第一条是 v1beta1（v1 那条没有 list 方法）',
            '⚠ 列模型候选：完整模式 3 条（v1beta1 无 project / v1beta1 带 project / v1 垫底）',
            '⚠ 列模型候选：v1 那条只能垫底'
        ],
        // 对照组：兼容壳（永远等于第一条）与另外两种配置 —— 它们绿着正说明这一针
        //   打的是「候选表的内容」，不是「这个函数整个坏了」
        green: [
            '（兼容壳）stAiGeminiModelsUrl 就是候选表的第一条',
            '⚠ 列模型候选：快速模式只有 1 条（没有 project 就拼不出带 project 的路径）',
            '⚠ 列模型候选：AI Studio 只有一条（不做多路径尝试）'
        ]
    },
    {
        id: 'R4', suite: 'apig',
        why: '`apigFetchModels` 不退回内置候选 → 只丢一句「获取失败」，用户不知道改什么',
        // ⚠⚠ 用户报的就是这个症状：「我已经开放代理，却还是显示【列模型失败】」——
        //   而旧文案只有一个「失败」，完全没告诉他「这不挡对话、模型名可以直接手输」。
        //   ⇒ 修法不是「让它成功」，而是**退回内置候选 + 把原因说出来**。
        from: "                } catch (e) {\r\n" +
              "                    // ⚠⚠ Google 那边列模型**经常不可用**（v1 那条资源没有 list 方法 /\r\n" +
              "                    //    该账号没这个权限 / 形状又变了），而**列不出来根本不该挡路** ——\r\n" +
              "                    //    模型框本来就能手输，酒馆（SillyTavern）连列都不列。\r\n" +
              "                    //    ⇒ 退回内置候选。但**必须把失败原因说出来**，绝不能把失败\r\n" +
              "                    //      伪装成成功（RULES 六之二十七）。\r\n" +
              "                    if (cfg.proto !== 'gemini') throw e;\r\n" +
              "                    list = ST_GEMINI_MODEL_HINTS.slice();\r\n" +
              "                    why = (e && e.message) || String(e);\r\n" +
              "                }",
        to:   "                } catch (e) { throw e; }   // 注入：不退回内置候选",
        red: [
            '⚠ 列不出来时退回内置候选（datalist 里真的有东西可选）',
            '⚠ 状态里**明说**是「列不出来」，不是装作成功',
            '⚠⚠ 还要说清「不影响对话」（否则用户会一直以为自己配错了）'
        ],
        // 对照组：请求**确实发出去了**（3 条候选都试过）、以及「失败就是 warn 不是 ok」
        //   —— 后者绿着说明这一针改的是**文案**，不是「失败被伪装成成功」
        green: [
            '⚠ 模型名留空也能点「获取模型列表」（不该被「请填模型名」拦下）',
            '⚠ Vertex 列模型逐条试候选路径（这里 3 条全 401）',
            '⚠ 状态是 warn 而不是 ok（失败不许伪装成成功）'
        ]
    },
    {
        id: 'R5', suite: 'apig',
        why: '`apigFetchModels` 又要求先有模型 → 按钮被「请填模型名」拦下，功能等于废掉',
        // ⚠⚠ 「获取模型列表」**本来就是为了挑模型**，要求先有模型是死循环。
        //   编写器那边（`stAiReady`）一直带着 `needModel:false`，全局面板这边**漏了**
        //   ⇒ Vertex 下必须先手打一个模型名才能点这个按钮。
        //   ⚠ 这一针的连带红**很多**（早退 ⇒ 后面整段都不跑）—— 但那是**合法连带**：
        //     它们的前提正是「请求发出去了」。一条不落地写进 red，不能因为「不是我直接打的」放过。
        from: "            // ⚠ 拉模型**不能要求先有模型**（`needModel:false`）—— 这一步就是为了挑模型\r\n" +
              "            const bad = apigReadyCheck(cfg, { needModel: false });",
        to:   "            const bad = apigReadyCheck(cfg);   // 注入：又要求先有模型",
        red: [
            '⚠ 模型名留空也能点「获取模型列表」（不该被「请填模型名」拦下）',
            '⚠ Vertex 列模型逐条试候选路径（这里 3 条全 401）',
            '⚠ 列不出来时退回内置候选（datalist 里真的有东西可选）',
            '⚠ 状态里**明说**是「列不出来」，不是装作成功',
            '⚠⚠ 还要说清「不影响对话」（否则用户会一直以为自己配错了）'
        ],
        // 对照组：被拦住时状态**照样是 warn**（说明这一针改的是「拦不拦」，
        //   不是「失败被伪装成成功」）
        green: [
            '⚠ 状态是 warn 而不是 ok（失败不许伪装成成功）'
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

console.log('\n===== 反向测试（Vertex 列模型 + 完整模式 Key）：' + (bad ? bad + ' 项不达标' : '全部达标') + ' =====');
process.exit(bad ? 1 : 0);
