// _reverse20.js —— 反向测试**第二十五轮**（Code 页 / Agent 的 Gemini · Vertex 工具调用）。
//
// 这一轮给 Code 页补上了第三种协议的工具调用（此前是**明说「不支持」**）。
// 新加了几十条断言，`st-code.js` 一次就 756/0 全绿 —— ⚠ **这正是最该怀疑的时候**：
// 新写的断言很可能「天生为真」（形状没了照样绿 / 取数一坏就崩掉整套）。
// 这一套的任务是**把每条关键断言都打红一次**，证明它真的在盯着东西。
//
// 探针（全部打在**产品** `saki.html`，一处最小改动，跑完立刻还原）：
//   R1  `functionDeclarations` 键名写错（Gemini 的声明整份消失）
//   R2  `functionResponse.response` 从对象改成字符串（Google 直接 400）
//   R3  不保留模型的原始 parts（`thoughtSignature` 丢掉 ⇒ Gemini 3 函数调用 400）
//   R4  tool 结果的 id 用**本地句柄**而不是模型给的 `mid`
//   R5  思考片段（`thought:true`）混进正文
//   R6  `stCodeFetch` 不去补 `needsToken` 那个 Authorization（Vertex 完整模式 401）
//
// ⚠⚠ **R1 的第一版是坏的**，记下来免得下次再踩：原来是「把 `functionDeclarations`
//   整行删掉」，而套件里有一句 `plan.body.tools[0].functionDeclarations.length` ——
//   在 **Node 侧**求值，`undefined.length` 直接抛 ⇒ **整套崩掉、连汇总行都没有** ⇒
//   反向测试拿不到「红了几条」，那一针等于白跑（RULES 六之六十六）。
//   修法是**两边都改**：① 套件的新断言一律走 `at()` / `arr()` 兜底（该红不该崩）；
//   ② 探针改成「改键名」而不是「删结构」，让产品仍然是合法 JSON。
// ⚠⚠ 反过来也有个坑：光套 `arr()` 会让 `[].every()` / `[].some()` 那类断言
//   **天生为真**（RULES 六之三十九）⇒ 套件里数组类判据一律**数出来跟期望比**。
//
// ⚠ 注入点在**产品**，不在套件。每个探针都是**一处**最小改动，跑完立刻还原，
//   收尾核 sha1 —— 不核的话「注入过的产品」会被当成基线。
// ⚠ 每个探针都配了**对照组**（`green`）：那些断言在被注入之后**必须还是绿的**。
//   没有对照组的话，「全红」也能骗过这一关。
// ⚠⚠ 探针点名的断言必须在基线里真的存在（见下面那段存在性闸门）：
//   `red` 里的名字漂了 ⇒「预期该红的都红了」**永远红**；
//   `green` 里的名字漂了 ⇒「对照组一条都没红」**天然成立**。两边的名单都要查。
// ⚠⚠ **必须用异步 `spawn`** —— 这个环境里 `spawnSync` / `execFileSync` / `execSync`
//   一律返回 `EBUSY`（见 RULES 六之四十六）。用同步 API 的话整套会**假红**。
//
// 跑法：
//   node _reverse20.js                 # 全部 6 针（1 个基线 + 6 次套件运行）
//   node _reverse20.js --only R3,R6    # 只跑基线 + 点名的针（补针 / 修清单时用）
//   ⚠ **别照抄任何耗时数字**，它会随套件规模漂，而且漂了不会有人提醒。
//     `st-code.js` 要起 Chrome，单次本来就比别的套件慢 —— 一律
//     `run_in_background: true`，否则前台会被工具超时打断（输出走 `tail` 就更看不到东西）。
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const DIR = __dirname;
const PAGE = path.join(DIR, '..', 'saki.html');
const SUITE = path.join(DIR, 'st-code.js');
const BAK = path.join(DIR, '_reverse20.bak');

// ⚠ 上一次没还原干净就拒绝启动 —— 否则会把「注入过的产品」当成基线备份下来
if (fs.existsSync(BAK)) {
    console.log('⚠ 目录里还留着 _reverse20.bak —— 上一次没还原。' +
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

// 异步跑一个命令，返回 { code, out }
function run(cmd, args, opts) {
    return new Promise(resolve => {
        const o = opts || {};
        let so = '', se = '';
        let done = false;
        const c = spawn(cmd, args, { cwd: o.cwd });
        const timer = o.timeout ? setTimeout(() => {
            if (done) return; done = true;
            try { c.kill(); } catch (e) {}
            resolve({ code: null, out: so + se, timedOut: true });
        }, o.timeout) : null;
        c.stdout.on('data', d => { so += d; });
        c.stderr.on('data', d => { se += d; });
        c.on('close', code => {
            if (done) return; done = true;
            if (timer) clearTimeout(timer);
            resolve({ code, out: so + se });
        });
        c.on('error', e => {
            if (done) return; done = true;
            if (timer) clearTimeout(timer);
            resolve({ code: 1, out: so + se + '\n起不了子进程：' + e.code });
        });
    });
}

async function runSuite() {
    const r = await run(process.execPath, [SUITE], { cwd: DIR, timeout: 900000 });
    return r.out;
}
// 汇总行用来确认「确实跑完了」—— 提前退出的话它会缺
function summaryOf(out) {
    const m = out.match(/(\d+)\s*通过\s*\/\s*(\d+)\s*失败/);
    return m ? { pass: Number(m[1]), fail: Number(m[2]) } : null;
}
// 失败项那一列。⚠ 列表符各家套件不一样（`-` / `·` / `❌`）—— 照抄别家的写法会
//   **一条都匹配不上**，而且表现为「对照组没红 ✅」，看着像过了
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

// ⚠ 注入片段必须**把整块包住**。少包一行就会在产品里留下语法残渣，
//   而它的表现是「**整个内联脚本解析失败**」—— 套件红一大片（看着像产品彻底坏了），
//   其实是**这一针打的是语法、不是逻辑**。这个闸门就是用来分开这两种情况的。
async function pageParses() {
    const html = fs.readFileSync(PAGE, 'utf8');
    const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
    if (!blocks.length) return { ok: false, err: '一个内联 <script> 都没抽到' };
    const tmp = path.join(os.tmpdir(), '_reverse20-pagecheck.js');
    fs.writeFileSync(tmp, blocks.map(m => m[1]).join('\n;\n'), 'utf8');
    const r = await run(process.execPath, ['--check', tmp]);
    try { fs.unlinkSync(tmp); } catch (e) {}
    return {
        ok: r.code === 0,
        err: String(r.out || '').split(/\r?\n/).slice(0, 3).join(' ')
    };
}

const PROBES = [
    {
        id: 'R1',
        why: 'functionDeclarations 键名写错（Gemini 的声明整份消失）',
        // ⚠ 改**键名**而不是删结构：删了会让 Node 侧 `undefined.length` 抛异常 ⇒ 整套崩
        from: "                    functionDeclarations: defs.map(t => ({",
        to: "                    function_declarations: defs.map(t => ({",
        red: [
            'Gemini 的 tools 是 functionDeclarations 形状',
            'Gemini 的声明数量和工具表一致',
            'Gemini 的声明带 parameters',
            '真实工具表的每个声明都留住了 parameters.type 和 description',
            '⚠ 发的是 functionDeclarations 形状'
        ],
        // ⚠ 对照组：**别的形状**和**别的字段**都不该受影响 ——
        //   它们绿着才说明上面那几条红的是「声明形状」，不是「整个 tools 都没了」
        green: [
            'Gemini 走 :generateContent（工具调用一律非流式）',
            'Gemini 带 toolConfig AUTO',
            'Gemini 仍然带 safetySettings（漏发 = 交给 Google 默认拦截）',
            'OpenAI 的 tools 是 type:function 形状',
            'Anthropic 的 tools 是 input_schema 形状',
            '⚠ 第二轮把 functionResponse 发回去了'
        ]
    },
    {
        id: 'R2',
        why: 'functionResponse.response 从对象改成字符串（Google 直接 400）',
        from: "                                response: { result: String(r.text == null ? '' : r.text) }",
        to: "                                response: String(r.text == null ? '' : r.text)",
        red: [
            'Gemini：functionResponse.response 是**对象**（给字符串直接 400）',
            'Gemini：结果文本放在 response.result 里',
            '⚠ functionResponse.response 是对象，且带回了真实的工具结果'
        ],
        // ⚠ 对照组：名字 / 角色 / id 这些**别的字段**都还在 ⇒ 必须还是绿的。
        //   少了它们，「response 形状坏了」和「整个 functionResponse 都没了」分不开
        green: [
            'Gemini：tool 结果走 role:user',
            'Gemini：tool 结果用 functionResponse',
            'Gemini：contents 里没有 role:system',
            '⚠ 第二轮把 functionResponse 发回去了',
            '⚠ functionResponse 里带上了模型给的 id（fc_0）'
        ]
    },
    {
        id: 'R3',
        why: '不保留模型原始 parts（thoughtSignature 丢掉 ⇒ Gemini 3 函数调用 400）',
        from: "                        if (Array.isArray(m.gemParts) && m.gemParts.length) {",
        to: "                        if (false && Array.isArray(m.gemParts) && m.gemParts.length) {",
        red: [
            'Gemini：有原始 parts 就整份原样回发（签名必须待在它那个 Part 里）',
            'Gemini：原样回发时签名还在',
            '⚠ 第二轮把第一轮的原始 parts 原样带上（thoughtSignature 不能丢）'
        ],
        // ⚠ 对照组：**重拼**出来的那份仍然有 functionCall / 名字 / id ⇒ 这些都该绿。
        //   它们绿着恰好证明上面那条 F2 断言的分辨力 —— 光看「有没有 functionCall」
        //   是**分辨不出**「原样回发」和「重拼一遍」的（RULES 六之二十六）
        green: [
            'Gemini：assistant 变成 role:model',
            'Gemini：工具调用是 parts 里的 functionCall',
            'Gemini：assistant 回发时也带那个 id',
            'Gemini：tool 结果用 functionResponse',
            '⚠ 第二轮把 functionResponse 发回去了',
            '⚠ functionResponse.response 是对象，且带回了真实的工具结果'
        ]
    },
    {
        id: 'R4',
        why: 'tool 结果的 id 用本地句柄，而不是模型给的 mid',
        from: "                            if (r.mid) fr.id = String(r.mid);",
        to: "                            fr.id = String(r.id);   /* 注入：用本地句柄当 id */",
        red: [
            'Gemini：模型没给过 id 时不回传 id',
            'Gemini：模型给过 id 就原样回传'
        ],
        // ⚠ 对照组：⚠ F2 那条 `fc_0` **在注入后照样绿** —— 因为模型给过 id 时
        //   本地句柄**就等于**那个 id（`stCodeParseReply` 是 `id: mid || stUuid()`）。
        //   所以它分辨不出这一针，别把它当判据（RULES 六之二十六）
        green: [
            'Gemini：tool 结果走 role:user',
            'Gemini：tool 结果用 functionResponse',
            'Gemini：结果文本放在 response.result 里',
            '⚠ 第二轮把 functionResponse 发回去了',
            '⚠ functionResponse 里带上了模型给的 id（fc_0）'
        ]
    },
    {
        id: 'R5',
        why: '思考片段（thought:true）混进正文',
        from: "                    if (p.thought === true) return;",
        to: "                    if (false && p.thought === true) return;",
        red: [
            'Gemini：思考片段不进正文'
        ],
        // ⚠ 对照组：parts **照样留着**（签名在那）⇒ 这条必须绿。
        //   它绿着才说明红的是「正文被污染」，不是「整个 parts 都没了」
        green: [
            'Gemini：但思考片段仍留在 parts 里',
            'Gemini：拼出正文',
            'Gemini：取到 functionCall',
            'Gemini：原始 parts 整份留下来（签名回传要用）'
        ]
    },
    {
        id: 'R6',
        why: 'stCodeFetch 不去补 needsToken 那个 Authorization（Vertex 完整模式 401）',
        from: "            if (plan && plan.needsToken) await stAiPlanAuth(plan, cfg || stAiCfg());",
        to: "            if (false && plan && plan.needsToken) await stAiPlanAuth(plan, cfg || stAiCfg());",
        red: [
            'stCodeFetch 在 needsToken 时补上 Authorization（完整模式的 Bearer）'
        ],
        // ⚠ 对照组：**标了 needsToken** 那两条是 stCodeRequest 的事，跟这里无关 ⇒ 必须绿；
        //   「不需要 token 时不加 Authorization」也该绿（这一针只砍了「补」的那一半）
        green: [
            'Gemini 在 SA 模式下标 needsToken（token 由 stCodeFetch 异步补）',
            'Gemini 在 SA 模式下**不**放 x-goog-api-key（那会顶掉 Bearer）',
            '（对照）不需要 token 时不会凭空加 Authorization',
            '补头用的桩已还原（后续段落不受影响）'
        ]
    }
];

// ⚠ 可选：`node _reverse20.js --only R6` —— 只跑**基线 + 点名的探针**。
//   ⚠ 基线**仍然要跑**：存在性闸门要拿基线里真的绿过的名字来核对，不能省。
//   ⚠ 唯一性闸门与存在性闸门**仍然检查全部探针**（它们不花时间），
//     这样「某针的 `from` 漂了」不会因为「这一轮没跑它」而被静默放过。
const ONLY = (() => {
    const i = process.argv.indexOf('--only');
    if (i < 0) return null;
    const ids = process.argv.slice(i + 1).join(',').split(',').map(s => s.trim()).filter(Boolean);
    return ids.length ? ids : null;
})();
const RUN_PROBES = ONLY ? PROBES.filter(p => ONLY.indexOf(p.id) >= 0) : PROBES;
if (ONLY && !RUN_PROBES.length) {
    console.log('⚠ --only 点名的探针一个都不存在：' + ONLY.join(', '));
    console.log('  现有的：' + PROBES.map(p => p.id).join(', '));
    process.exit(1);
}

(async () => {
    console.log('== 反向测试：Code 页的 Gemini / Vertex 工具调用 ==');
    console.log('基线 sha1 = ' + H0.slice(0, 12) + ' …\n');

    // ── ⓪ 每个探针的注入点必须**唯一**（不唯一就是打歪了，而且打歪了也会「有红」）──
    console.log('== 注入点唯一性 ==');
    for (const p of PROBES) {
        const n = ORIG.split(p.from).length - 1;
        expect(p.id + ' 注入点在产品里恰好出现 1 次', n === 1, '出现 ' + n + ' 次');
    }

    // ── ① 基线：先把「本来该绿的」拿下来 ──
    console.log('\n== 基线（未注入）==');
    const baseOut = await runSuite();
    const baseSum = summaryOf(baseOut);
    const basePasses = passesOf(baseOut);
    expect('基线跑完了（有汇总行）', !!baseSum, baseSum ? JSON.stringify(baseSum) : '缺汇总行');
    expect('基线全绿（0 失败）', !!baseSum && baseSum.fail === 0,
        baseSum ? baseSum.pass + ' 通过 / ' + baseSum.fail + ' 失败' : '');
    console.log('  基线绿了 ' + basePasses.length + ' 条');

    // ── ② 存在性闸门：探针点名的断言必须在基线里真的出现过 ──
    console.log('\n== 存在性闸门（名单漂了的话，两边的判定都会失真）==');
    for (const p of PROBES) {
        for (const name of p.red) {
            expect(p.id + ' red 里的名字在基线里存在：' + name, hit(basePasses, name));
        }
        for (const name of p.green) {
            expect(p.id + ' green 里的名字在基线里存在：' + name, hit(basePasses, name));
        }
    }

    // ── ③ 逐针注入（`--only` 时只跑点名的那些）──
    for (const p of RUN_PROBES) {
        console.log('\n== ' + p.id + ' · ' + p.why + ' ==');
        fs.writeFileSync(PAGE, ORIG.replace(p.from, p.to), 'utf8');

        const parse = await pageParses();
        expect(p.id + ' 注入后页面仍能解析（打的是逻辑，不是语法）', parse.ok, parse.ok ? '' : parse.err);

        const out = await runSuite();
        const sum = summaryOf(out);
        expect(p.id + ' 注入后套件跑完了', !!sum, sum ? JSON.stringify(sum) : '缺汇总行');

        const reds = failsOf(out);
        // ① 预期该红的**都**红了
        for (const name of p.red) {
            expect(p.id + ' 预期该红：' + name, hit(reds, name));
        }
        // ② 对照组**一条都没红**
        const greenBroke = p.green.filter(name => hit(reds, name));
        expect(p.id + ' 对照组一条都没红', greenBroke.length === 0,
            greenBroke.length ? '红了：' + greenBroke.join(' / ') : '');
        // ③ 没有预期之外的红（免得「红了一片」被当成达标）
        const unexpected = reds.filter(x => !hit(p.red, x));
        expect(p.id + ' 没有预期之外的红', unexpected.length === 0,
            unexpected.length ? unexpected.slice(0, 4).join(' / ') : '');

        // 立刻还原
        fs.writeFileSync(PAGE, ORIG, 'utf8');
    }

    // ── ④ 收尾：产品必须逐字节回到基线 ──
    console.log('\n== 收尾 ==');
    const H1 = sha1(fs.readFileSync(PAGE, 'utf8'));
    expect('产品已逐字节还原', H1 === H0, H1.slice(0, 12) + ' vs ' + H0.slice(0, 12));

    console.log('\n===== 反向测试（Code 页 Gemini / Vertex 工具调用）：' +
        (bad ? '有 ' + bad + ' 条不达标' : '全部达标') +
        (ONLY ? '  [--only ' + RUN_PROBES.map(p => p.id).join(',') + ']' : '') + ' =====');
    process.exit(bad ? 1 : 0);
})();
