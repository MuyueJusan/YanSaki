// 跑 `_verify/` 里的**全部**套件，并且**不允许静默少走**。
//
// 为什么要有这个脚本：以前是用
//     for f in *.js; do node "$f" | grep -E "[0-9]+ (通过|passed)" | tail -1; done
// 收汇总行 —— 而汇总行**有两种格式**：
//     · `N 通过 / N 失败`   （sb-verify4~7 / st-ai / st-code / sb-keep-compare）
//     · `N passed, N failed`（sb-verify / 2 / 3 / smoke）
// grep 只匹配一种，另一种的套件就打印**一行空白**。空白看起来像「没报错」，
// 实际是「压根没看它们的结果」：实测静默少了 4 套、**272 条**。
//
// 所以这里把三件事变成**硬错误**：
//   ① 每个套件都必须产出一行**能解析**的汇总（空白 = 错）
//   ② 清单要跟**目录对账** —— 多出没分类的 `.js` 就报错
//      （枚举本身不完整时不会红，只会少走；和「选项卡清单是字面量数组」同族）
//   ③ 任何 `failed > 0` 就报错
//
// ⚠ **这里不写死「期望总数」。** 写死的话，每次加断言都要改它，迟早退化成
// 「永远在报的检查」—— 那种检查只会被无视（见 `04-card-editor.md` 里那条）。
// 要抓的是「**少走了几套**」，不是「数字变了」。数字只**打印**出来，
// 方便跟 `README.md` 里的「共 N 条」对照。
//
// 用法：
//   node run-all.js                 # 全部
//   node run-all.js st-code.js      # 只跑指定的几个（会大声提示这是部分结果）
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const NODE = process.execPath;              // 用当前这个 node，别写死路径
const TIMEOUT_MS = 4 * 60 * 1000;           // 单套上限。慢的是走 CDP 的那几套

// 15 套回归测试。**顺序就是打印顺序**：静态检查放最前（最快、也最先能拦住东西）。
const SUITES = [
    'check.js',
    'sb-verify.js', 'sb-verify2.js', 'sb-verify3.js', 'sb-verify4.js',
    'sb-verify5.js', 'sb-verify6.js', 'sb-verify7.js', 'sb-verify8.js',
    'sb-verify9.js',
    'game-verify.js',
    'st-ai.js', 'st-code.js', 'sb-keep-compare.js', 'smoke.js'
];

// 目录里的其他 `.js` —— 不是回归测试，但**必须显式列出来**。
// ⚠ 故意不写成「不在 SUITES 里的都跳过」：那样新加一个套件忘了登记就永远不会被发现。
const NOT_A_SUITE = [
    'blk0.js',            // extract.js 的生成物 —— ⚠ **平时不该在目录里**（生成物不留仓库，见 README §7）。
                          //   列在这里只是为了「跑过 extract.js 之后它不算未分类」；
                          //   留着过期的生成物才是坑：检查会**对着旧代码给答案**。
    'extract.js',         // 从 saki.html 抽出内联 <script> 写到 blk0.js（**临时分析用**，产物用完就删）
    'run-all.js',         // 就是本文件（跑全部套件的 runner）
    'sb-diag.js', 'sb-diag3.js', 'sb-diag5.js', 'sb-diag-class.js',  // 一次性诊断
    'sb-shot-color.js', 'sb-zoom.js', 'sb-zoom5.js'                  // 一次性截图 / 探针
];

// ⚠ 以 `_` 开头的一律当作临时脚本（如 `_reverse2.js` 那种反向测试注入器），跳过。
const isScratch = f => f.charAt(0) === '_';

// 两种汇总格式，合成一个正则，靠捕获组区分。
const RE_SUMMARY = /(\d+)\s*通过\s*\/\s*(\d+)\s*失败|(\d+)\s*passed,\s*(\d+)\s*failed/g;

function summariesIn(text) {
    const out = [];
    let m;
    RE_SUMMARY.lastIndex = 0;
    while ((m = RE_SUMMARY.exec(text)) !== null) {
        if (m[1] !== undefined) out.push({ pass: +m[1], fail: +m[2], form: 'zh' });
        else out.push({ pass: +m[3], fail: +m[4], form: 'en' });
    }
    return out;
}

// ── ① 清单跟目录对账 ───────────────────────────────────────────
const onDisk = fs.readdirSync(DIR).filter(f => f.endsWith('.js')).sort();
const known = new Set(SUITES.concat(NOT_A_SUITE));
const unclassified = onDisk.filter(f => !known.has(f) && !isScratch(f));

console.log('== 清单对账 ==');
// ⚠ 三个数都从**磁盘**上数：`NOT_A_SUITE` 里允许有「平时不存在」的条目（比如生成物
//   `blk0.js`），直接用数组长度会让这行加法对不上 —— 而一行对不上的数字比没有它更糟：
//   下一个人会去查一个根本不存在的差异。
const onDiskSet = new Set(onDisk);
console.log('  目录里 ' + onDisk.length + ' 个 .js：套件 ' + SUITES.length +
    ' + 非套件 ' + NOT_A_SUITE.filter(f => onDiskSet.has(f)).length +
    ' + 临时 ' + onDisk.filter(isScratch).length);
if (unclassified.length) {
    console.log('\n❌ 有 ' + unclassified.length + ' 个 .js 没分类：' + unclassified.join(', '));
    console.log('   新加的是套件就写进 SUITES，是工具 / 探针就写进 NOT_A_SUITE ——');
    console.log('   ⚠ 别图省事改成「不在 SUITES 里的都跳过」：那样新套件忘了登记永远不会被发现。');
    process.exit(1);
}
console.log('  ✓ 全部有归属（没有「没登记就静默跳过」的空间）');

// 只跑指定的几个（显式传参），会大声提示这是部分结果
const picked = process.argv.slice(2).filter(a => !a.startsWith('-'));
const runList = picked.length ? picked : SUITES;
const missing = runList.filter(f => SUITES.indexOf(f) < 0);
if (missing.length) {
    console.log('\n❌ 这些不在套件清单里：' + missing.join(', '));
    process.exit(1);
}

console.log('\n== 逐套运行 ==');
const rows = [];
let bad = 0;

for (const file of runList) {
    const t0 = Date.now();
    const r = spawnSync(NODE, [file], {
        cwd: DIR, encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024
    });
    const ms = Date.now() - t0;
    // 两路都搜 —— 有的套件把收尾信息打到 stderr
    const text = String(r.stdout || '') + String(r.stderr || '');
    const found = summariesIn(text);
    const s = found.length ? found[found.length - 1] : null;   // 取**最后**一条

    let status, note = '';
    if (r.error && r.error.code === 'ETIMEDOUT') { status = 'TIMEOUT'; note = '超过 ' + (TIMEOUT_MS / 1000) + 's'; }
    else if (!s) { status = 'NO-SUMMARY'; note = '没有可解析的汇总行' + (r.status ? '（退出码 ' + r.status + '）' : ''); }
    else if (s.fail > 0) { status = 'FAILED'; note = s.fail + ' 条失败'; }
    else { status = 'OK'; }

    if (status !== 'OK') bad++;
    rows.push({ file, s, status, note, ms, form: s ? s.form : '' });
    const mark = status === 'OK' ? '✅' : '❌';
    console.log('  ' + mark + ' ' + file.padEnd(20) +
        (s ? String(s.pass).padStart(5) + ' 通过 / ' + s.fail + ' 失败' : '      —        ') +
        '  [' + (s ? s.form : '无') + '] ' + (ms / 1000).toFixed(1) + 's' +
        (note ? '  ← ' + note : ''));
}

// ── ② 合计 ────────────────────────────────────────────────────
const totalPass = rows.reduce((a, r) => a + (r.s ? r.s.pass : 0), 0);
const totalFail = rows.reduce((a, r) => a + (r.s ? r.s.fail : 0), 0);

console.log('\n== 合计 ==');
if (picked.length) {
    console.log('  ⚠ **这是部分结果**（只跑了 ' + runList.length + ' 套，共 ' + SUITES.length + ' 套）——');
    console.log('    别拿这个总数去对 README。要对照就整跑一遍。');
}
console.log('  ' + runList.length + ' 套，共 **' + totalPass + ' 通过 / ' + totalFail + ' 失败**');
console.log('  （对照 `markdown/README.md` 里的「共 N 条」；这里故意不写死期望值，见文件头）');

if (bad) {
    console.log('\n❌ 有 ' + bad + ' 套没通过：' +
        rows.filter(r => r.status !== 'OK').map(r => r.file + '(' + r.status + ')').join(', '));
    process.exit(1);
}
console.log('\n✅ 全部通过');
