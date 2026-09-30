// _reverse21.js —— 反向测试**第二十六轮**（Vertex 完整模式下切走服务商，Key 那一格必须回来）。
//
// 起点是用户的实测反馈：
//   「在 google vertex ai 的完整模式下切换到其他服务商时，要重新显示 key 项目，
//     key 项目仅在 google vertex ai 的完整模式时被隐藏并忽略」
//
// 真 bug 在 `syncApigAuthUI()`：隐藏 Key 那一格的判据**少了一半** ——
//   旧：`keyF.hidden = (mode === 'sa')`      ← 只看 authMode
//   新：`keyF.hidden = vertexSa`             ← 「真的是 Vertex」**且** 完整模式
// `authMode` 是全局那一个下拉，**切服务商时不会重置**（它跟着 vertex-box 一起被藏），
// 所以「Vertex 完整模式 → 切到 OpenAI」之后 Key 那一格**再也不出现**，
// 而 `apigReadyCheck` 又拦着「请先填写 API Key」⇒ 用户被锁在门外。
//
// ⚠⚠ **为什么 147+ 条全绿的套件没抓到它** —— 这一套最想留下的教训：
//   `apig-verify.js` 里**早就有**一条「（对照）非 Vertex：API Key 那一格显示」，
//   看着正好覆盖这个场景。但它的前置是**先切回 'key' 再切服务商**，
//   而用户是**在 'sa' 状态下直接切走**的 ⇒ **前置状态不同 ⇒ 它一路绿着放走了 bug**。
//   （RULES 六之二十六：「对照组必须真的不同」；六之四十八：过时断言是永真断言的镜像）
//   同一轮里还有一条「对照②：非 Vertex + 残留 authMode=sa ⇒ Key 显示」，
//   但它盯的是**【ai对话】面板**（`ai-key-field`），不是全局面板（`apig-key-field`）
//   —— 「同一个坑只修踩过的那一处 = 把坑留给隔壁」。
//
// 探针（全部打在**产品** `saki.html`，一处最小改动，跑完立刻还原）：
//   R1  `keyF.hidden` 退回 `(mode === 'sa')`              → 切走服务商后 Key 不回来
//   R2  `apigReadyCheck` 的判据退回「只看下拉框」          → 自定义 + aiplatform 被当普通服务商
//   R3  `syncApigAuthUI` 的 vertexSa 退回「只看下拉框」    → 自定义 + aiplatform 时藏不起来
//
// ⚠ R2 / R3 是**成对的**：Key 那一格的显隐与「要不要 Key」必须用**同一个**判据。
//   判据不一致会做出「格子藏起来了、却还要求你填」—— 那正是用户报的锁死形态，
//   所以这两针各自都要能被单独打红。
// ⚠ 注入点在**产品**，不在套件。每个探针都是**一处**最小改动，跑完立刻还原，
//   收尾核 sha1 —— 不核的话「注入过的产品」会被当成基线。
// ⚠ 每个探针都配了**对照组**（`green`）：那些断言在被注入之后**必须还是绿的**。
//   没有对照组的话，「全红」也能骗过这一关。
// ⚠⚠ 探针点名的断言必须在基线里真的存在（见下面那段存在性闸门）：
//   `red` 里的名字漂了 ⇒「预期该红的都红了」**永远红**；
//   `green` 里的名字漂了 ⇒「对照组一条都没红」**天然成立**。两边的名单都要查。
// ⚠⚠ **必须用异步 `spawn`** —— 这个环境里 `spawnSync` / `execFileSync` / `execSync`
//   一律返回 `EBUSY`（见 RULES 六之四十六）。用同步 API 的话整套会**假红**。
//   ⚠ 老 `_reverse17.js` 打的就是这一块，但它写的是同步 API ⇒ **在本环境一行都跑不起来**，
//     所以这一轮另开一份而不是去改它。
//
// 跑法：
//   node _reverse21.js                 # 全部 3 针（1 个基线 + 3 次套件运行）
//   node _reverse21.js --only R2       # 只跑基线 + 点名的针（补针 / 修清单时用）
//   ⚠ **别照抄任何耗时数字**，它会随套件规模漂，而且漂了不会有人提醒。
//     `apig-verify.js` 要起 Chrome —— 一律 `run_in_background: true`，
//     否则前台会被工具超时打断（输出走 `tail` 就更看不到东西）。
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const DIR = __dirname;
const PAGE = path.join(DIR, '..', 'saki.html');
const SUITE = path.join(DIR, 'apig-verify.js');
const BAK = path.join(DIR, '_reverse21.bak');

// ⚠ 上一次没还原干净就拒绝启动 —— 否则会把「注入过的产品」当成基线备份下来
if (fs.existsSync(BAK)) {
    console.log('⚠ 目录里还留着 _reverse21.bak —— 上一次没还原。' +
        '先人工核对 saki.html，再删掉它重跑。');
    process.exit(1);
}

// ⚠ 原样读，别 replace(/\r/g,'')，否则会把 CRLF 写没
const ORIG = fs.readFileSync(PAGE, 'utf8');
const sha1 = s => crypto.createHash('sha1').update(s, 'utf8').digest('hex');
const H0 = sha1(ORIG);

// ⚠⚠ 产品是 **CRLF**。探针的 `from` 用普通 `\n` 写（好读），在这里统一转 ——
//   忘了这一步的表现是「注入点在产品里出现 0 次」，而那是**唯一性闸门**抓得住的，
//   所以它不会静默（六之二十八：CRLF 下 `$`/多行匹配静默失败是同一个家族）。
const crlf = s => s.split('\n').join('\r\n');

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
    const tmp = path.join(os.tmpdir(), '_reverse21-pagecheck.js');
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
        why: 'Key 那一格的隐藏判据退回「只看 authMode」（用户报的那个 bug 原样）',
        from: "            if (keyF) keyF.hidden = vertexSa;",
        to: "            if (keyF) keyF.hidden = (mode === 'sa');   /* 注入：判据退回只看 authMode */",
        red: [
            '⚠⚠ 完整模式下切走服务商：Key 那一格**必须回来**（用户报的就是这条）'
        ],
        // ⚠ 对照组：**Vertex 侧**那几条必须还是绿的 —— 它们绿着才说明红的
        //   是「切走之后不回来」，而不是「Key 那一格整个不工作了」。
        //   ⚠ 「（对照）非 Vertex：API Key 那一格显示」也在这里：它的前置是
        //     先切回 'key' 再切服务商 ⇒ **本来就不会被这一针打到**（这正是它漏掉 bug 的原因，
        //     写进 green 是为了把这件事**记在案上**，而不是让它悄悄过去）
        green: [
            '（前提）Vertex 完整模式：Key 那一格藏住',
            '⚠⚠ 完整模式下切走：authMode 仍停在 sa（前提成立，否则这条测不到东西）',
            '（对照）此时整块 Vertex 区域是藏住的',
            '⚠⚠ 完整模式：API Key 那一格**真的**藏住了（computed display = none）',
            '（对照）快速模式：API Key 那一格**显示**（证明上一条不是「永远 none」）',
            '（对照）非 Vertex：API Key 那一格显示'
        ]
    },
    {
        id: 'R2',
        why: 'apigReadyCheck 的 Vertex 判据退回「只看服务商下拉框」',
        from: "            //     「格子藏起来了、却还要求你填」——正是用户报的那个锁死形态\n" +
              "            if (stAiIsVertex(cfg)) {",
        to: "            //     「格子藏起来了、却还要求你填」——正是用户报的那个锁死形态\n" +
            "            if ((AI_PROVIDERS.find(x => x.value === cfg.provider) || {}).vertex) {   /* 注入：只看下拉框 */",
        red: [
            '⚠⚠ 同一份配置 apigReadyCheck 也**放行**（校验与发送必须是同一套判据）'
        ],
        // ⚠ 对照组：`stAiIsVertex` / `stAiNeedsKey` 这两条**没被这一针碰**
        //   ⇒ 必须还是绿的。它们绿着才说明红的是「apigReadyCheck 的判据」，
        //   而不是「这一整块配置本来就不成立」
        green: [
            '⚠ 前置：自定义 + aiplatform 域名 被判成 Vertex（判据真的看 baseUrl）',
            '⚠⚠ 自定义 + aiplatform + 完整模式：**不需要** Key（只看下拉框的写法会拦着要）',
            '⚠⚠ fetchModels 走真实路径：这种配置下**必须**要 Key（旧写法会不带 Key 就发出去）',
            '⚠ 而且真的一个请求都没发出去'
        ]
    },
    {
        id: 'R3',
        why: 'syncApigAuthUI 的 vertexSa 退回「只看服务商下拉框」',
        from: "            const vertexSa = !!(stAiIsVertex({\n" +
              "                provider: (document.getElementById('apig-provider') || {}).value || '',\n" +
              "                baseUrl: (document.getElementById('apig-base-url') || {}).value || ''\n" +
              "            }) && (mode === 'sa'));",
        to: "            const vertexSa = !!((AI_PROVIDERS.find(x => x.value === " +
            "((document.getElementById('apig-provider') || {}).value || '')) || {}).vertex && " +
            "(mode === 'sa'));   /* 注入：只看下拉框 */",
        red: [
            '⚠⚠ 自定义 + aiplatform + 完整模式：Key 那一格**也**藏起来（判据看 baseUrl，不只下拉框）'
        ],
        // ⚠ 对照组：**真 Vertex** 的那两条只看下拉框也能判对 ⇒ 必须还是绿的。
        //   它们绿着才说明红的只有「自定义 + aiplatform」那一条
        green: [
            '（前提）Vertex 完整模式：Key 那一格藏住',
            '⚠⚠ 完整模式下切走服务商：Key 那一格**必须回来**（用户报的就是这条）',
            '⚠ 前置：自定义 + aiplatform 时 authMode 是 sa'
        ]
    }
];

// ⚠ 可选：`node _reverse21.js --only R2` —— 只跑**基线 + 点名的探针**。
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
    console.log('== 反向测试：Vertex 完整模式下切走服务商，Key 那一格必须回来 ==');
    console.log('基线 sha1 = ' + H0.slice(0, 12) + ' …\n');

    // ── ⓪ 每个探针的注入点必须**唯一**（不唯一就是打歪了，而且打歪了也会「有红」）──
    console.log('== 注入点唯一性 ==');
    for (const p of PROBES) {
        const n = ORIG.split(crlf(p.from)).length - 1;
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
        fs.writeFileSync(PAGE, ORIG.replace(crlf(p.from), crlf(p.to)), 'utf8');

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

    console.log('\n===== 反向测试（Vertex 完整模式切走服务商 · Key 显隐）：' +
        (bad ? '有 ' + bad + ' 条不达标' : '全部达标') +
        (ONLY ? '  [--only ' + RUN_PROBES.map(p => p.id).join(',') + ']' : '') + ' =====');
    process.exit(bad ? 1 : 0);
})();
