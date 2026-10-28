// _reverse24.js —— 反向测试**第三十轮**（人设生成器的「参考素材 / 世界书」）。
//
// 起点是用户的要求：
//   「请为 角色生成器 添加 能够选择当前世界书某一条目(某些条目)来进行角色生成，
//     或者额外导入世界书来生成角色」
//
// 改动落在产品 `saki.html`：
//   ① 状态：`personaLore`（额外导入的那本，**不进卡**）/ `personaPick`（'card:<id>' / 'imp:<id>'）
//      / `personaPickOpen`；
//   ② `stPersonaLoreSources()` 把「本卡世界书」和「导入的那本」并成同构的两路；
//   ③ `stPersonaLoreResolve()` 把勾选解析成 { items, missing, dropped, truncated, chars }；
//   ④ `stPersonaLoreBlock()` 折成提示词里的一段，`stPersonaUserPrompt()` 在
//      「要求」和「模板」之间插进去；
//   ⑤ 面板：折叠块 + 勾选列表 + 导入按钮；`stPersonaRun()` 把「喂了几条 / 几条没进去」报出来。
//
// 探针（全部打在**产品**，一处最小改动，跑完立刻还原，收尾核 sha1）：
//   R1  提示词里不再插参考素材                → 选了等于没选（**拼装层**）
//   R2  导入时顺手 push 进 card.bookEntries   → 把「只喂生成」变成「偷偷改卡」（**语义层**）
//   R3  折叠头改报 `personaPick.length`       → 「已选 3 条」而实际只喂 1 条（**记账层**）
//
// ⚠ 三针的红签名**互不相同**，这是故意的：它们打的是三个不同的承诺。
// ⚠ R2 只有**一条**红（「卡内世界书一条都没多」）。这不是探针弱，而是这个承诺
//   本来就只有一个断言盯着 —— 也正因如此，那一针才有意义：它证明那条断言不是摆设。
// ⚠ R3 打的是「懒清理」的差：条目被删之后 `personaPick` 里还留着那个键，
//   报数组长度就会多报。这条断言不写的话，这个差**永远看不见**。
//
// ⚠⚠ 套件 `persona-verify.js` 的汇总行是**中文**（`N 通过 / M 失败`），
//   跟 `smoke.js` 的 `N passed, M failed` **不是一个格式**。照抄会一条都匹配不上，
//   而症状是「基线跑完了 ✅」（其实拿到的是 null）。
//
// ⚠⚠ **必须用异步 `spawn`** —— 本环境 `spawnSync` / `execFileSync` / `execSync` 一律
//   `EBUSY`（RULES 六之四十六）。
//
// 跑法：
//   node _reverse24.js                 # 基线 + 全部 3 针（4 次套件运行）
//   node _reverse24.js --only R2       # 只跑基线 + 点名的针（补针 / 修清单时用）

'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const DIR = __dirname;
const PAGE = path.join(DIR, '..', 'saki.html');
const SUITE = path.join(DIR, 'persona-verify.js');
const BAK = path.join(DIR, '_reverse24.bak');

// ⚠ 上一次没还原干净就拒绝启动 —— 否则会把「注入过的产品」当成基线备份下来
if (fs.existsSync(BAK)) {
    console.log('⚠ 目录里还留着 _reverse24.bak —— 上一次没还原。' +
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

// ⚠ `persona-verify.js` 的汇总行是 **中文**：`305 通过 / 0 失败`
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
    const tmp = path.join(os.tmpdir(), '_reverse24-pagecheck.js');
    fs.writeFileSync(tmp, blocks.map(m => m[1]).join('\n;\n'), 'utf8');
    const r = await run(process.execPath, ['--check', tmp]);
    try { fs.unlinkSync(tmp); } catch (e) {}
    return {
        ok: r.code === 0,
        err: String(r.out || '').split(/\r?\n/).slice(0, 3).join(' ')
    };
}

// ── 断言名：从套件里**逐字**抄过来（漂一个字符，存在性闸门就会红）──────────────
const N_FOLD = '参考素材的折叠块在';
const N_HINT0 = '收起时折叠头就报「未选」';
const N_HINT1 = '勾一条 ⇒ 折叠头的计数跟着变（不重绘也要变）';
const N_KEY = '勾一条 ⇒ 状态里记的是带 card: 前缀的键';
const N_IN1 = '勾中的条目正文进了提示词';
const N_CTRL1 = '（对照）没勾的那条**不在**提示词里';
const N_IN2 = '再勾一条 ⇒ 两条都在提示词里';
const N_DROP = '正文为空的条目算进 dropped（不硬塞空文本）';
const N_HEAD = '而且提示词里只多了 2 个小标题（空那条没生成标题）';
const N_REPORT = '生成结果的提示里报了「参考素材 2 条」';
const N_WHY = '并且点名了那 1 条为什么没进去（正文为空）';
const N_HINTDEL = '删掉一条已勾的条目 ⇒ 折叠头只数能喂进去的（不数数组长度）';
const N_IMPORT = '导入之后那本书进了会话状态';
const N_IMPN = '导入的条目数对';
const N_NOCARD = '⚠ 卡内世界书**一条都没多**（导入不写卡）';
const N_TWOSRC = '导入之后列表里变成两个来源';
const N_IMKEY = '导入条目的勾选键带 imp: 前缀';
const N_IMIN = '导入条目的正文也进了提示词';
const N_IMCTRL = '（对照）导入书里**没勾**的那条不在提示词里';
const N_DROPBOOK = '移除导入的书 ⇒ 会话状态清空';

const PROBES = [
    {
        id: 'R1',
        why: '提示词里不再插参考素材 ⇒ 勾了等于没勾（拼装层）',
        from: "            const lore = stPersonaLoreBlock();",
        to: "            const lore = '';   /* 注入 R1：参考素材不进提示词 */",
        // 四条都跟「提示词里有没有那段」直接相关：
        //   · 单条 / 两条 —— 正文不见了
        //   · 小标题数 —— 从 2 变成 0（这条不是重复，是另一个口径：按结构数而不是按子串找）
        //   · 导入的那条 —— 两个来源走同一条路，所以它一起红
        red: [N_IN1, N_IN2, N_HEAD, N_IMIN],
        // ⚠ 对照组必须还是绿的：它们绿着才说明红的是「没插进去」，
        //   而不是「勾选 / 导入 / 记账 整个坏了」
        green: [N_FOLD, N_HINT1, N_KEY, N_CTRL1, N_DROP, N_REPORT, N_IMPORT,
            N_NOCARD, N_IMKEY, N_IMCTRL, N_DROPBOOK]
    },
    {
        id: 'R2',
        why: '导入时顺手 push 进 card.bookEntries ⇒ 「只喂生成」变成了「偷偷改卡」（语义层）',
        from: "                stEditor.personaLore = { name: book.name, entries: book.entries };",
        to: "                stEditor.personaLore = { name: book.name, entries: book.entries };\n" +
            "                if (!Array.isArray(stEditor.card.bookEntries)) stEditor.card.bookEntries = [];\n" +
            "                stEditor.card.bookEntries = stEditor.card.bookEntries.concat(book.entries);   /* 注入 R2：导入顺手写进卡 */",
        // 只有这一条红 —— 这个承诺本来就只有一个断言盯着
        red: [N_NOCARD],
        green: [N_IMPORT, N_IMPN, N_TWOSRC, N_IMIN, N_IN1, N_DROPBOOK, N_KEY]
    },
    {
        id: 'R3',
        why: '折叠头改报 personaPick.length ⇒ 显示「已选 3 条」而实际只喂 1 条（记账层）',
        from: "            const n = r.items.length;",
        to: "            const n = (stEditor.personaPick || []).length;   /* 注入 R3：报数组长度 */",
        // 条目被删之后数组里还留着那个键 ⇒ 报长度就多报。只有「删完之后」那条能抓住
        red: [N_HINTDEL],
        green: [N_HINT0, N_HINT1, N_IN1, N_DROP, N_CTRL1, N_KEY]
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
    console.log('== 反向测试：人设生成器的参考素材（世界书）==');
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

    console.log('\n===== 反向测试（参考素材 / 世界书）：' +
        (bad ? '有 ' + bad + ' 条不达标' : '全部达标') +
        (ONLY ? '  [--only ' + RUN_PROBES.map(p => p.id).join(',') + ']' : '') + ' =====');
    process.exit(bad ? 1 : 0);
})();
