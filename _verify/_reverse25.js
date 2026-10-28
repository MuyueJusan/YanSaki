// _reverse25.js —— 反向测试**第三十一轮**（世界书的搜索与筛选）。
//
// 起点是用户的要求：
//   「为 角色卡编写器 的 世界书 添加世界书搜索与筛选」
//
// 改动落在产品 `saki.html`：
//   ① 状态：`stEditor.bookFind = { q, state, constant, pos, keys }`（**会话级**）；
//   ② `stBookFindMatch()` 一条命中不命中（扫备注 / 关键词 / 次关键词 / 正文 / 组名）；
//   ③ `stBookFindApply()` 只切 `.st-entry-hide` + 改计数，**不重画**；
//   ④ `stPaneBook()` 画筛选栏；`stEntryHtml(e, i, hide)` 多一个参数；
//   ⑤ `stBookSelAll` / `stBookSelInvert` / `stBookSelPaint` 改成**按可见集**算。
//
// 探针（全部打在**产品**，一处最小改动，跑完立刻还原，收尾核 sha1）：
//   R1  计数改报全集                        → 「命中 4 / 共 4 条」而屏幕上是 2 条（**记账层**）
//   R2  「全选」无视筛选、直接选全集        → 一次批量删除会删掉用户没见过的条目（**安全层**）
//   R3  删掉 `.st-entry-hide` 那条 CSS      → class 还在、卡片却照样看得见（**视觉层**）
//
// ⚠ 三针都**故意选窄**：红的条数能一条不落地枚举出来，而「没有预期之外的红」那条
//   才有意义。要是把 `stBookFindMatch` 整个打废，红的是二十多条，
//   那份 `red` 清单抄起来必然出错 —— 而清单错了，「预期该红的都红了」就成了摆设。
//
// ⚠⚠ R3 打的是「class ≠ 看得见」这件事：`.st-entry-hide` 那条 CSS 漏了的话，
//   「被筛掉的卡片只是藏起来，四条都还在 DOM 里」照样绿（它只看 class），
//   「搜「雾港」⇒ 只剩 0 和 1」也照样绿（它只看 class）——
//   **只有 computed display 那条能抓住**。这就是它存在的理由。
//
// ⚠⚠ 套件 `book-verify.js` 的汇总行是**中文**（`N 通过 / M 失败`），
//   跟 `smoke.js` 的 `N passed, M failed` 不是一个格式。
//
// ⚠⚠ **必须用异步 `spawn`** —— 本环境 `spawnSync` / `execFileSync` / `execSync` 一律
//   `EBUSY`（RULES 六之四十六）。
//
// 跑法：
//   node _reverse25.js                 # 基线 + 全部 3 针（4 次套件运行）
//   node _reverse25.js --only R2       # 只跑基线 + 点名的针

'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const DIR = __dirname;
const PAGE = path.join(DIR, '..', 'saki.html');
const SUITE = path.join(DIR, 'book-verify.js');
const BAK = path.join(DIR, '_reverse25.bak');

// ⚠ 上一次没还原干净就拒绝启动 —— 否则会把「注入过的产品」当成基线备份下来
if (fs.existsSync(BAK)) {
    console.log('⚠ 目录里还留着 _reverse25.bak —— 上一次没还原。' +
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

// ⚠ `book-verify.js` 的汇总行是 **中文**：`185 通过 / 0 失败`
function summaryOf(out) {
    const m = out.match(/(\d+)\s*通过\s*\/\s*(\d+)\s*失败/);
    return m ? { pass: Number(m[1]), fail: Number(m[2]) } : null;
}
// 失败行形状：`  ❌ <名字>  actual=<json>  expect=<…>`
// ⚠ `expect` 传函数时会把**函数源码**整段打出来，所以只能从 `  actual=` 处截断
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
    const tmp = path.join(os.tmpdir(), '_reverse25-pagecheck.js');
    fs.writeFileSync(tmp, blocks.map(m => m[1]).join('\n;\n'), 'utf8');
    const r = await run(process.execPath, ['--check', tmp]);
    try { fs.unlinkSync(tmp); } catch (e) {}
    return {
        ok: r.code === 0,
        err: String(r.out || '').split(/\r?\n/).slice(0, 3).join(' ')
    };
}

// ── 断言名：从套件里**逐字**抄过来（漂一个字符，存在性闸门就会红）──────────────
const N_INFO2 = '搜的时候计数变成「命中 2 / 共 4 条」';
const N_INFO0 = '一条都没命中时计数是 0';
const N_INFO_PLAIN = '没筛的时候计数是「共 4 条」';
const N_HIT = '搜「雾港」⇒ 只剩 0 和 1';
const N_VIS4 = '没筛的时候四条都看得见';
const N_DISPNONE = '被筛掉的卡片 computed display 真的是 none';
const N_DISPCTRL = '对照组：命中的卡片 computed display 不是 none';
const N_DOM4 = '⚠ 被筛掉的卡片只是藏起来，四条都还在 DOM 里';
const N_RESET4 = '点「重置」⇒ 四条全回来';
const N_STATE_OFF = '状态=停用 ⇒ 只剩 2';
const N_ALL_ONLY_VIS = '筛选下点「全选」⇒ 只勾上命中的 0 和 1';
const N_ALL_CTRL = '对照组：被筛掉的 2 / 3 没被勾上';
const N_INV_VIS = '筛选下点「反选」⇒ 看得见的那两条全翻掉，一条不剩';
const N_SELINFO = '已选里有被筛掉的，计数要说明白';
const N_HALF = '对照组：取消筛选后「全选」变回半选态';
const N_NOLEAK = '取消筛选后 2 / 3 还是没被勾上（筛选期间的勾选没有牵连它们）';

const PROBES = [
    {
        id: 'R1',
        why: '计数改报全集 ⇒ 屏幕上是 2 条、却写着「命中 4 / 共 4 条」（记账层）',
        from: "                    ? '命中 ' + hit.length + ' / 共 ' + a.length + ' 条'",
        to: "                    ? '命中 ' + a.length + ' / 共 ' + a.length + ' 条'   /* 注入 R1：计数永远报全集 */",
        // 只有两条断言读这句文案
        red: [N_INFO2, N_INFO0],
        // ⚠ 对照组：**筛本身还在起作用**（可见集没变）、没筛时那句也没被改
        green: [N_HIT, N_VIS4, N_DISPNONE, N_RESET4, N_STATE_OFF, N_INFO_PLAIN]
    },
    {
        id: 'R2',
        why: '「全选」无视筛选、直接选全集 ⇒ 一次批量删除会删掉用户没见过的条目（安全层）',
        from: "            if (on) vis.forEach(id => set.add(id));",
        to: "            if (on) a.forEach(e => set.add(e.id));   /* 注入 R2：全选无视筛选 */",
        // 六条：M7 三条 + M8 三条
        red: [N_ALL_ONLY_VIS, N_ALL_CTRL, N_INV_VIS, N_SELINFO, N_HALF, N_NOLEAK],
        // ⚠ 对照组：筛选本身没坏（可见集照旧），所以「筛出来几条」那批必须还是绿的
        green: [N_HIT, N_VIS4, N_DISPNONE, N_INFO2, N_RESET4, N_STATE_OFF]
    },
    {
        id: 'R3',
        why: '删掉 .st-entry-hide 那条 CSS ⇒ class 还在、卡片却照样看得见（视觉层）',
        from: "        .st-entry-hide { display: none !important; }",
        to: "        /* 注入 R3：隐藏规则被拿掉 */",
        // ⚠ 只有这一条能抓住 —— 另外两条只看 class，照样绿
        red: [N_DISPNONE],
        green: [N_HIT, N_DOM4, N_DISPCTRL]
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
    console.log('== 反向测试：世界书的搜索与筛选 ==');
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
        baseSum ? baseSum.pass + ' 通过 / ' + baseSum.fail + ' 失败' : '');
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

    console.log('\n===== 反向测试（世界书搜索与筛选）：' +
        (bad ? '有 ' + bad + ' 条不达标' : '全部达标') +
        (ONLY ? '  [--only ' + RUN_PROBES.map(p => p.id).join(',') + ']' : '') + ' =====');
    process.exit(bad ? 1 : 0);
})();
