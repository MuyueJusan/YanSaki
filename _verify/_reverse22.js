// _reverse22.js —— 反向测试**第二十八轮**（日历「今日」按钮改成**显示当前日**）。
//
// 起点是用户的要求：
//   「修改主页的日历部分，将【今日】改为显示当前日（比如今天是1日就显示1日），
//     并保留原有的回到当前日的功能」
//
// 改动落在产品 `saki.html`：
//   ① 新增 `updateTodayBtn()` —— 把按钮文案写成 `<本地日>日`，缓存挂在元素自己的
//      `data-day` 上（跨日才写 DOM，因为 `updateClock()` 每秒会来调它一次）；
//   ② `resetToToday()` **一个字没改** —— 那是用户明确要求「保留」的那一半。
//
// 探针（全部打在**产品**，一处最小改动，跑完立刻还原，收尾核 sha1）：
//   R1  `updateTodayBtn()` 永不写文案          → 按钮还是「今日」，等于功能没做
//   R2  `resetToToday()` 的回调直接 return     → 「回到当前日」这一半被打破
//
// ⚠ R1 / R2 正好对应用户要求的**两半**，缺哪一半都该被抓到：
//   R1 = 「显示当前日」没兑现；R2 = 「保留回到当前日」没兑现。
//
// ⚠⚠ **断言名里的「今天」必须现算，不能写死日期**：写死的话明天就假红，而假红久了
//   没人看（RULES 六之三十六 / 六之四十八）。本文件里所有名字都是**运行时拼出来**的
//   ⇒ 它跟今天是几号无关，跑在哪天都成立。
//
// ⚠⚠ **`smoke.js` 的汇总行是英文的**（`========== 96 passed, 0 failed ==========`），
//   跟 `apig-verify.js` 那套 `N 通过 / M 失败` **不是一个格式**。照抄 `_reverse21.js` 的
//   解析正则会**一条都匹配不上**，而症状是「基线跑完了 ✅」（其实拿到的是 null）——
//   所以这里另写一套解析，且**失败行的取法也不同**（smoke 是 `❌ <名>  actual=…`）。
//
// ⚠⚠ **必须用异步 `spawn`** —— 本环境 `spawnSync` / `execFileSync` / `execSync` 一律
//   `EBUSY`（RULES 六之四十六）。用同步 API 的话整套会**假红**。
//
// ⚠ 注入片段必须**把整块包住**。少包一行就会在产品里留下语法残渣，表现是
//   「**整个内联脚本解析失败**」—— 套件红一大片（看着像产品彻底坏了），
//   其实是**这一针打的是语法、不是逻辑**。下面的 `pageParses()` 闸门就是用来分开这两种情况的。
//
// 跑法：
//   node _reverse22.js                 # 基线 + 全部 2 针（3 次套件运行，约 1.5 min）
//   node _reverse22.js --only R2       # 只跑基线 + 点名的针（补针 / 修清单时用）

'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const DIR = __dirname;
const PAGE = path.join(DIR, '..', 'saki.html');
const SUITE = path.join(DIR, 'smoke.js');
const BAK = path.join(DIR, '_reverse22.bak');

// ⚠ 上一次没还原干净就拒绝启动 —— 否则会把「注入过的产品」当成基线备份下来
if (fs.existsSync(BAK)) {
    console.log('⚠ 目录里还留着 _reverse22.bak —— 上一次没还原。' +
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

// ⚠⚠ `smoke.js` 的汇总行是 **`========== 96 passed, 0 failed ==========`**（英文），
//   跟 `apig-verify.js` 的 `N 通过 / M 失败` 不是一个格式 —— 抄错正则的后果是
//   `summaryOf` 永远返回 null，而 null 会被读成「缺汇总行」⇒ 看起来像套件崩了。
function summaryOf(out) {
    const m = out.match(/(\d+)\s+passed,\s*(\d+)\s+failed/);
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
    const tmp = path.join(os.tmpdir(), '_reverse22-pagecheck.js');
    fs.writeFileSync(tmp, blocks.map(m => m[1]).join('\n;\n'), 'utf8');
    const r = await run(process.execPath, ['--check', tmp]);
    try { fs.unlinkSync(tmp); } catch (e) {}
    return {
        ok: r.code === 0,
        err: String(r.out || '').split(/\r?\n/).slice(0, 3).join(' ')
    };
}

// ── 断言名：**全部现算**（今天几号 / 这个月是几月）⇒ 本文件与日期无关 ──────────
const pad2 = n => String(n).padStart(2, '0');
const NOW = new Date();
const DAY = NOW.getDate();                                    // 今天几号
const M0 = pad2(NOW.getMonth() + 1) + '月';                    // 当前月（DOM 里的写法，如 `10月`）
const M1 = pad2(((NOW.getMonth() + 11) % 12) + 1) + '月';      // 上一个月
const N_DAY = '按钮上显示的是当前日（' + DAY + '日）';
const N_KEEP = '对照组：翻月之后按钮上的日子没变（仍是 ' + DAY + '日）';
const N_MODE = '前提：日历处于「日」视图';
const N_PREV = '对照组：点 ＜ 之后确实离开了当前月（' + M0 + ' → ' + M1 + '）';
const N_BACK = '点「今日」回到当前月（' + M0 + '）';

const PROBES = [
    {
        id: 'R1',
        why: 'updateTodayBtn() 永不写文案 ⇒ 按钮还是「今日」（用户要的「显示当前日」没兑现）',
        from: "            const d = String(new Date().getDate());",
        to: "            const d = String(new Date().getDate()); if (true) return;   /* 注入 R1：永不写文案 */",
        // ⚠ 两条一起红：N_KEEP 比的是「按钮上是不是今天那个日子」，文案没写出来它自然也红。
        //   这不是重复 —— 它红的是**另一条断言**，正好说明这两条都真的盯着同一个承诺。
        red: [N_DAY, N_KEEP],
        // ⚠ 对照组：**注入点没碰**的那几条必须还是绿的 —— 它们绿着才说明红的是
        //   「文案没写出来」，而不是「日历整个坏了」。
        green: [N_MODE, N_PREV, N_BACK]
    },
    {
        id: 'R2',
        why: 'resetToToday() 的回调直接 return ⇒ 「保留回到当前日」这一半被打破',
        from: "        function resetToToday() {\n" +
              "            updateCalendarView(() => {\n" +
              "                const now = new Date();",
        to: "        function resetToToday() {\n" +
            "            updateCalendarView(() => {\n" +
            "                if (true) return;   /* 注入 R2：不再回到今天 */\n" +
            "                const now = new Date();",
        red: [N_BACK],
        // ⚠ 对照组：文案那一半完全没被碰 ⇒ 必须全绿。它们绿着才说明红的是
        //   「回不去今天」，而不是「按钮上的日子也不对了」。
        green: [N_MODE, N_DAY, N_PREV, N_KEEP]
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
    console.log('== 反向测试：日历「今日」按钮显示当前日 + 点它回到今天 ==');
    console.log('基线 sha1 = ' + H0.slice(0, 12) + ' …   今天是 ' + M0 + DAY + '日\n');

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

    console.log('\n===== 反向测试（日历「今日」按钮）：' +
        (bad ? '有 ' + bad + ' 条不达标' : '全部达标') +
        (ONLY ? '  [--only ' + RUN_PROBES.map(p => p.id).join(',') + ']' : '') + ' =====');
    process.exit(bad ? 1 : 0);
})();
