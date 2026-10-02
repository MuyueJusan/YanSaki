// _reverse23.js —— 反向测试**第二十九轮**（世界时间的日期偏移徽标 `【D+1】` / `【D-1】`）。
//
// 起点是用户的要求：
//   「在世界时间中，如果日期晚一天或者早一天则用小字显示【D+1】或者【D-1】」
//
// 改动落在产品 `saki.html`：
//   ① DOM：时钟 `#clock` 右边新增 `<span id="clock-day-offset">`（**初始必须留空**）；
//   ② 新增 `getClockDateParts()` —— 取**所选时区**当天的年月日；
//   ③ 新增 `getClockDayOffset()` —— 所选时区日期 − **本地**日期，整数天（UTC 折算法）；
//   ④ 新增 `updateClockDayOffset()` —— 把 `【D±N】` 写到徽标上，偏移 0 写空串；
//   ⑤ `updateClock()` 里**加了调用点**（每秒一次 ⇒ 跨 00:00 自己翻）。
//
// 探针（全部打在**产品**，一处最小改动，跑完立刻还原，收尾核 sha1）：
//   R1  `updateClockDayOffset()` 里文案恒为 `''`  → 徽标永远空 = 功能没做
//   R2  `getClockDayOffset()` 的结果取负          → 方向反了（`D+1` 写成 `D-1`）
//   R3  `updateClock()` 里的调用点删掉            → 函数写好了，但**没人调**
//
// ⚠ R1 与 R3 的**红签名相同**（都只有 `N_MATCH` 红），但打的是**不同层**：
//   R1 = 实现层（算了但没写），R3 = 接线层（写了但没接）。
//   RULES 六之四十：「函数写好了」≠「被调用了」—— 覆盖要盯**调用点**，所以这一针必须留。
// ⚠ R2 才是「断言真的在比方向」的那一针：R1/R3 让徽标变**空**，R2 让它变成**反号**。
//   只测「非空」的断言会在 R1/R3 下红、在 R2 下**照样绿** —— 有 R2 才说明它比的是值。
//
// ⚠⚠ **本文件里的断言名全部是写死的字符串**（不含城市名、不含 `【D+1】`）——
//   这是这一轮**特意**这么设计的：某个城市此刻是 `D+1` 还是 `D-1` 取决于**几点钟**
//   （同一个城市上午看是同一天、晚上看就是下一天）⇒ 名字里带动态值的话，
//   「存在性闸门」会在别的时辰**假红**（那是闸门自己坏，不是产品坏）。
//   会变的东西在产品里放 `actual` / `expect`、在套件里用一行 `console.log` 打出来。
//
// ⚠⚠ **`smoke.js` 的汇总行是英文的**（`========== 103 passed, 0 failed ==========`），
//   跟 `apig-verify.js` 那套 `N 通过 / M 失败` **不是一个格式**。照抄会**一条都匹配不上**，
//   而症状是「基线跑完了 ✅」（其实拿到的是 null）。失败行的形状也不同（`❌ <名>  actual=…`）。
//
// ⚠⚠ **必须用异步 `spawn`** —— 本环境 `spawnSync` / `execFileSync` / `execSync` 一律
//   `EBUSY`（RULES 六之四十六）。
//
// 跑法：
//   node _reverse23.js                 # 基线 + 全部 3 针（4 次套件运行，约 2 min）
//   node _reverse23.js --only R2       # 只跑基线 + 点名的针（补针 / 修清单时用）

'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const DIR = __dirname;
const PAGE = path.join(DIR, '..', 'saki.html');
const SUITE = path.join(DIR, 'smoke.js');
const BAK = path.join(DIR, '_reverse23.bak');

// ⚠ 上一次没还原干净就拒绝启动 —— 否则会把「注入过的产品」当成基线备份下来
if (fs.existsSync(BAK)) {
    console.log('⚠ 目录里还留着 _reverse23.bak —— 上一次没还原。' +
        '先人工核对 saki.html，再删掉它重跑。');
    process.exit(1);
}

// ⚠ 原样读，别 replace(/\r/g,'')，否则会把 CRLF 写没
const ORIG = fs.readFileSync(PAGE, 'utf8');
const sha1 = s => crypto.createHash('sha1').update(s, 'utf8').digest('hex');
const H0 = sha1(ORIG);

// ⚠⚠ 产品是 **CRLF**。探针的 `from` 用普通 `\n` 写（好读），在这里统一转 ——
//   忘了这一步的表现是「注入点在产品里出现 0 次」，而那会被下面的**唯一性闸门**抓住。
const crlf = s => s.split('\n').join('\r\n');

let bad = 0;
const expect = (name, cond, extra) => {
    console.log((cond ? '  ✅ ' : '  ❌ ') + name + (extra ? '   ' + extra : ''));
    if (!cond) bad++;
};
const nm = s => String(s).trim();

function run(cmd, args, opts) {
    return new Promise(resolve => {
        let so = '', se = '', done = false, timer = null;
        const c = spawn(cmd, args, Object.assign({ stdio: ['ignore', 'pipe', 'pipe'] }, opts || {}));
        if (opts && opts.timeout) timer = setTimeout(() => {
            if (done) return;
            done = true;
            try { c.kill(); } catch (e) {}
            resolve({ code: null, out: so + se + '\n（超时 ' + (opts.timeout / 1000) + 's）' });
        }, opts.timeout);
        c.stdout.on('data', d => { so += d; });
        c.stderr.on('data', d => { se += d; });
        c.on('close', code => {
            if (done) return;
            done = true;
            if (timer) clearTimeout(timer);
            resolve({ code, out: so + se });
        });
        c.on('error', e => {
            if (done) return;
            done = true;
            if (timer) clearTimeout(timer);
            resolve({ code: 1, out: so + se + '\n起不了子进程：' + e.code });
        });
    });
}

async function runSuite() {
    const r = await run(process.execPath, [SUITE], { cwd: DIR, timeout: 900000 });
    return r.out;
}

// ⚠⚠ `smoke.js` 的汇总行是 **英文**（`103 passed, 0 failed`），跟 `apig-verify.js` 的
//   `N 通过 / M 失败` 不是一个格式 —— 抄错正则的后果是 `summaryOf` 永远返回 null，
//   而 null 会被读成「缺汇总行」⇒ 看起来像套件崩了。
function summaryOf(out) {
    const m = out.match(/(\d+)\s+passed,\s*(\d+)\s*failed/);
    return m ? { pass: Number(m[1]), fail: Number(m[2]) } : null;
}
// 失败项。smoke.js 的形状是 `  ❌ <名字>  actual=<json>  expect=<…>` ——
// ⚠ `expect` 那一段在传函数时会把**函数源码**整段打出来，所以不能按行尾切，
//   只能从 `  actual=` 处截断。
function failsOf(out) {
    return (out.match(/^\s*❌\s+(.*)$/gm) || []).map(s => {
        let t = nm(s.replace(/^\s*❌\s*/, ''));
        const i = t.indexOf('  actual=');
        return nm(i >= 0 ? t.slice(0, i) : t);
    }).filter(Boolean);
}
function passesOf(out) {
    return (out.match(/^\s*✅\s+(.*)$/gm) || [])
        .map(s => nm(s.replace(/^\s*✅\s*/, '')));
}
const hit = (list, x) => list.indexOf(nm(x)) >= 0;

// ⚠ 注入片段必须**把整块包住**。少包一行就会在产品里留下语法残渣，而它的表现是
//   「**整个内联脚本解析失败**」—— 套件红一大片（看着像产品彻底坏了），
//   其实是**这一针打的是语法、不是逻辑**。这个闸门就是用来分开这两种情况的。
async function pageParses() {
    const html = fs.readFileSync(PAGE, 'utf8');
    const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
    if (!blocks.length) return { ok: false, err: '一个内联 <script> 都没抽到' };
    const tmp = path.join(os.tmpdir(), '_reverse23-pagecheck.js');
    fs.writeFileSync(tmp, blocks.map(m => m[1]).join('\n;\n'), 'utf8');
    const r = await run(process.execPath, ['--check', tmp]);
    try { fs.unlinkSync(tmp); } catch (e) {}
    return {
        ok: r.code === 0,
        err: String(r.out || '').split(/\r?\n/).slice(0, 3).join(' ')
    };
}

// ── 断言名：**全部写死**（这一轮特意不拼动态值，理由见文件头）─────────────────
const N_BADGE = '前提：时钟卡片里有那个日期徽标元素';
const N_GATE = '前提：城市表里至少有一个时区此刻跨了天';
const N_LOCAL = '对照组：本地时间下徽标为空（基准不标自己）';
const N_MATCH = '跨天的时区：徽标与独立算法一致（含方向）';
const N_GEO = '跨天的时区：徽标在时钟右边（不是压在上面 / 飘到别处）';
const N_BACK = '对照组：切回本地时间后徽标又变空';
const N_CELLS = '前提：时区网格里有格子';
const N_CLEAN = '时区格子上没有多余的 D+ / D- 标记';

const PROBES = [
    {
        id: 'R1',
        why: 'updateClockDayOffset() 里文案恒为空 ⇒ 徽标永远不写 = 用户要的功能没做',
        from: "            const text = off === 0 ? '' : '【D' + (off > 0 ? '+' : '') + off + '】';",
        to: "            const text = '';   /* 注入 R1：徽标永远不写文案 */",
        // ⚠ N_GEO 也红：文案为空 ⇒ CSS 的 `:empty` 把徽标 `display:none` ⇒ rect 全 0。
        //   这不是「重复」，而是**同一个承诺的另一面**：没显示出来，就谈不上「在时钟旁边」。
        red: [N_MATCH, N_GEO],
        // ⚠ 对照组：注入点没碰的那几条必须还是绿的 —— 它们绿着才说明红的是
        //   「徽标没写出来」，而不是「时钟 / 时区网格整个坏了」。
        green: [N_BADGE, N_GATE, N_LOCAL, N_BACK, N_CELLS, N_CLEAN]
    },
    {
        id: 'R2',
        why: 'getClockDayOffset() 的结果取负 ⇒ 方向反了（该写 D+1 的地方写成 D-1）',
        from: "            const off = getClockDayOffset();",
        to: "            const off = -getClockDayOffset();   /* 注入 R2：方向反了 */",
        // ⚠ 这一针的徽标**不是空的、是反号的** ⇒ 它才是「断言真的在比方向」的证据。
        //   只断言「徽标非空」的写法在这一针下**照样绿**。
        // ⚠ N_GEO 在这一针下**保持绿** —— 反号了但照样显示在时钟右边 ⇒ 它量的确实是「位置」，
        //   不是「有没有字」。这正是它跟 N_MATCH 分工的地方。
        red: [N_MATCH],
        green: [N_BADGE, N_GATE, N_LOCAL, N_GEO, N_BACK, N_CELLS, N_CLEAN]
    },
    {
        id: 'R3',
        why: 'updateClock() 里的调用点删掉 ⇒ 函数写好了但没人调（接线层）',
        from: "            updateClockDayOffset();",
        to: "            /* 注入 R3：函数还在，但没人调它 */",
        // ⚠ 红签名与 R1 相同（N_MATCH + N_GEO），但这是**故意的**：R1 打实现层、R3 打接线层。
        //   RULES 六之四十：「函数写好了」≠「被调用了」。
        red: [N_MATCH, N_GEO],
        green: [N_BADGE, N_GATE, N_LOCAL, N_BACK, N_CELLS, N_CLEAN]
    }
];

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
    console.log('== 反向测试：世界时间的日期偏移徽标（【D+1】/【D-1】）==');
    console.log('基线 sha1 = ' + H0.slice(0, 12) + ' …   现在 ' + new Date().toTimeString().slice(0, 8) + '\n');

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
        baseSum ? baseSum.pass + ' passed / ' + baseSum.fail + ' failed' : '');
    console.log('  基线绿了 ' + basePasses.length + ' 条');

    // ── ② 存在性闸门：探针点名的断言必须在基线里真的出现过 ──
    // ⚠⚠ 名单漂了的话两边都会失真：`red` 里的名字漂了 ⇒「预期该红的都红了」**永远红**；
    //   `green` 里的名字漂了 ⇒「对照组一条都没红」**天然成立**。所以两边的名单都要查。
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

    console.log('\n===== 反向测试（日期偏移徽标）：' +
        (bad ? '有 ' + bad + ' 条不达标' : '全部达标') +
        (ONLY ? '  [--only ' + RUN_PROBES.map(p => p.id).join(',') + ']' : '') + ' =====');
    process.exit(bad ? 1 : 0);
})();
