// 一次性探针：**run-all 会不会把一条真红盖成绿？**
//
// 背景（CHANGELOG 里记的「没查到底」那条）：同一份产品、同一套 `st-code.js`，
//   · `run-all.js` 报 `663 通过 / 0 失败`
//   · 单跑报 `661 通过 / 2 失败`
// 两个 runner 是**各自 spawn 一个 node 进程**（`run-all.js` 第 99 行），
// 所以「前面套件留下状态」这条最直觉的解释**不成立** —— 每个套件都是新进程、新页面。
//
// 那就只剩两种可能：
//   ① **不是环境串味，是那次跑的文件跟这次不一样**（中间态 / 还原时机）
//   ② 真有**时序**差异：run-all 跑的时候机器更忙，某条竞态恰好往另一边倒
//
// 这个探针只问一件事：**把 bug 注回去，run-all 还会不会报绿。**
//   · run-all 也红 → 那个 663/0 是**文件状态**问题（当时的 saki.html 里有那一行）
//   · run-all 绿   → run-all 会盖红，比原 bug 更坏，得继续查
//
// ⚠ 老规矩：先备份、先检查、最后才写；`finally` 里一定还原 + 核对字节。
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const PAGE = 'G:/saki/saki.html';
const BAK = fs.readFileSync(PAGE, 'utf8');

// finish() 里那一行（探针 C 用的同一个锚点）
const C_OLD = '                    stCodeProgressClear(id);\r\n';

const runOne = file => {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [path.join(DIR, file)], {
        cwd: DIR, encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024
    });
    return { code: r.status, out: String(r.stdout || '') + String(r.stderr || ''), ms: Date.now() - t0 };
};

// 只抓「汇总行」和「❌ 的条目名」——逐字比较没意义（每行带耗时）
const summaryOf = out => (out.match(/=====.*?=====/) || ['(没抓到汇总)'])[0];
const redsOf = out => (out.match(/❌ [^\n]+/g) || []).map(s => s.replace(/\s+/g, ' ').trim());
const stCodeLineOf = out => {
    const m = out.match(/st-code\.js\s+([\d\s]+通过 \/ \d+ 失败)/);
    return m ? m[1].replace(/\s+/g, ' ') : '(没抓到 st-code.js 那一行)';
};

console.log('== 基线（未注入）==');
const b1 = runOne('st-code.js');
console.log('  单跑 st-code.js : ' + summaryOf(b1.out) + '   退出码 ' + b1.code + '   ' + (b1.ms / 1000).toFixed(1) + 's');

if (BAK.indexOf(C_OLD) < 0) {
    console.log('\n❌ 锚点不在 —— 产品里没有 finish() 那行 stCodeProgressClear(id);');
    process.exit(1);
}

let single, all;
try {
    console.log('\n== 注入 bug：finish() 里不撤进度 ==');
    fs.writeFileSync(PAGE, BAK.replace(C_OLD, ''));
    console.log('  已注入（产品临时被改）');

    single = runOne('st-code.js');
    console.log('\n  单跑 st-code.js : ' + summaryOf(single.out) + '   退出码 ' + single.code +
        '   ' + (single.ms / 1000).toFixed(1) + 's');
    redsOf(single.out).forEach(s => console.log('      ' + s));

    console.log('\n  整跑 run-all.js（约 3 分钟）…');
    all = runOne('run-all.js');
    console.log('  run-all 里 st-code.js 那一行 : ' + stCodeLineOf(all.out));
    console.log('  run-all 总汇总              : ' +
        (all.out.match(/\d+ 套，共 \*\*\d+ 通过 \/ \d+ 失败\*\*/) || ['(没抓到)'])[0]);
    console.log('  run-all 退出码              : ' + all.code);
    // ⚠ 关键：run-all 的输出里有没有那两条红
    const allReds = redsOf(all.out).filter(s => /进度|prog/.test(s));
    console.log('  run-all 输出里跟进度有关的红 : ' + (allReds.length ? allReds.join(' | ') : '（一条都没有）'));
} finally {
    fs.writeFileSync(PAGE, BAK);
}

console.log('\n== 还原核对 ==');
console.log('  saki.html 与备份字节一致: ' + (fs.readFileSync(PAGE, 'utf8') === BAK ? '✅' : '❌'));

console.log('\n== 结论 ==');
const singleRed = /2 失败/.test(summaryOf(single.out));
const allRed = /FAILED|❌/.test(stCodeLineOf(all.out) + (all.code === 0 ? '' : '❌'));
if (singleRed && allRed) console.log('  ✅ 两边都红 → run-all 没有盖红；那个 663/0 是**文件状态**问题');
else if (singleRed && !allRed) console.log('  ❌ run-all 把真红盖成绿了 —— 继续查（这是比原 bug 更坏的一类）');
else console.log('  ⚠ 单跑没红 —— 注入没生效或断言本身没在守，先查这个');
