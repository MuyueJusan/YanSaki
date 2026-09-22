// 反向测试 `run-all.js`：证明它的两道闸门**真的会红**，而不是摆设。
//
//   探针 A：目录里多出一个没分类的 .js  → 对账必须报错（抓「枚举不完整」）
//   探针 B：一个套件不产出汇总行        → 必须标 NO-SUMMARY（抓「静默少走」）
//
// ⚠ 跟 `_reverse2.js` 一个套路：**先备份、先检查、最后才写**。
// 改的是 runner 自己，不是产品。
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const RUN = path.join(DIR, 'run-all.js');
const BAK = fs.readFileSync(RUN, 'utf8');

function run(args) {
    const r = spawnSync(process.execPath, [RUN].concat(args || []), {
        cwd: DIR, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000
    });
    return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}

let bad = 0;
const expect = (name, cond, extra) => {
    console.log((cond ? '  ✅ ' : '  ❌ ') + name + (extra ? '   ' + extra : ''));
    if (!cond) bad++;
};

// ── 探针 A：没分类的 .js ────────────────────────────────────────
console.log('== 探针 A：目录里多一个没登记的 .js ==');
const Z = path.join(DIR, 'zz-new.js');
fs.writeFileSync(Z, '// 临时：模拟「新加了一个 .js 但没登记」\n');
try {
    const r = run([]);
    expect('退出码非 0', r.code !== 0, '(退出码 ' + r.code + ')');
    expect('指名道姓点出是哪个文件', r.out.indexOf('zz-new.js') >= 0);
    expect('告诉人该往哪写（SUITES / NOT_A_SUITE）', r.out.indexOf('NOT_A_SUITE') >= 0);
    expect('而且**没有**开始跑套件（在跑之前就拦住）', r.out.indexOf('逐套运行') < 0);
} finally { fs.unlinkSync(Z); }

// ── 探针 B：套件不产出汇总行 ────────────────────────────────────
console.log('\n== 探针 B：一个套件不打印「通过 / 失败」汇总 ==');
// 造一个**故意不打汇总**的临时套件，登记进 SUITES 的**最前面**，再只跑它 ——
// 于是走的正是「跑到了、但解析不出汇总」这条路。
// ⚠ 必须**前插**（保留其余条目），否则它会被挤成「未分类」，先撞上对账那道闸门。
//
// ⚠⚠ 2026-09-20 重跑反向测试时抓到：原来的锚点是
//     `const SUITES = [\n    'sb-verify.js',`
//   —— 而 `check.js` 后来被加到了 SUITES 最前面，这个锚点**早就失效了**。
//   失效的后果不是「红」，是 `process.exit(1)`：后面**两条断言从来没跑到**，
//   整条探针等于摆设，而它每天打印的只是「NOT FOUND」。
//   所以锚点换成 `const SUITES = [` —— 它**不会因为「清单里加了一项」而失效**。
const ZS = path.join(DIR, 'zz-nosummary.js');
const A_OLD = 'const SUITES = [';
const A_NEW = "const SUITES = [\n    'zz-nosummary.js',";
// ⚠ 锚点检查放在 try **外面**：`process.exit()` 不跑 `finally`，
//   写在里面会把临时文件和改过的 runner 一起留在盘上。
if (BAK.indexOf(A_OLD) < 0) { console.log('  B NOT FOUND —— 锚点变了，先看 run-all.js'); process.exit(1); }
fs.writeFileSync(ZS, "// 临时：故意不打印「N 通过 / M 失败」汇总行\nconsole.log('我故意不打印汇总行');\n");
try {
    fs.writeFileSync(RUN, BAK.replace(A_OLD, A_NEW));
    const r = run(['zz-nosummary.js']);
    expect('退出码非 0', r.code !== 0, '(退出码 ' + r.code + ')');
    expect('标成 NO-SUMMARY', r.out.indexOf('NO-SUMMARY') >= 0);
    expect('说明白是「没有可解析的汇总行」', r.out.indexOf('没有可解析的汇总行') >= 0);
    expect('合计里把它算成没通过', r.out.indexOf('没通过') >= 0);
} finally {
    fs.writeFileSync(RUN, BAK);
    try { fs.unlinkSync(ZS); } catch (e) {}
}

// ── 还原核对 ───────────────────────────────────────────────────
console.log('\n== 还原 ==');
const now = fs.readFileSync(RUN, 'utf8');
expect('run-all.js 与备份字节一致', now === BAK);
const r = run(['st-code.js']);
// ⚠ 原来这里写死 `622 通过 / 0 失败` —— 那个数早就漂了（现在是 670）。
//   写死数字的断言每次加断言都会来收一次「红」的账，所以改成**从输出里现取**：
//   要证的是「还原后能正常跑、且全绿」，不是「条数等于某个数」。
const m = r.out.match(/(\d+) 通过 \/ 0 失败/);
expect('还原后能正常跑（st-code.js 全绿）', r.code === 0 && !!m && +m[1] > 0,
    '(' + (m ? m[1] : '?') + ' 通过 / 退出码 ' + r.code + ')');

console.log(bad ? ('\n❌ ' + bad + ' 条没达到预期') : '\n✅ 两道闸门都真的会红');
process.exit(bad ? 1 : 0);
