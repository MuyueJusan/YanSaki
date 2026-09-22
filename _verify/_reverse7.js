// 反向测试「skill 自报进度」（host.progress）。
//
// 断言全绿不算证据 —— 得把 bug 注回去，看它会不会红。
// 四个探针，都是**改产品**（不是改测试）：
//
//   A. 父页面不查权限（onProg 里去掉 allowed 判断）
//      → 「没申请 progress 的那句被丢掉」必须红
//        ⚠ 这条是**安全面**：不查 = 任何 skill 都能往用户界面上写东西
//   B. 去掉节流窗口（只留次数上限）
//      → 「同一 tick 里连发的第二条会被丢」必须红
//        ⚠ 这条正是节流存在的理由：狂刷能让父页面重画几十万次
//   C. finish 里不撤进度（去掉 stCodeProgressClear）
//      → 「返回之后进度那句话被撤掉了」必须红
//   D. 把 progress 从能力表里拿掉
//      → 「progress 进了能力表」+「两边是一份」必须红
//        ⚠ 这条守的是「manifest 申请 progress 会被判成没有这个能力」
//
// ⚠ 老规矩：**先备份、先检查、最后才写**。改完一律还原 + 核对字节。
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const PAGE = 'G:/saki/saki.html';
const SUITE = path.join(DIR, 'st-code.js');

const PAGE_BAK = fs.readFileSync(PAGE, 'utf8');

function run() {
    const r = spawnSync(process.execPath, [SUITE], { cwd: DIR, encoding: 'utf8', timeout: 300000 });
    return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}

let bad = 0;
const expect = (name, cond, extra) => {
    console.log((cond ? '  ✅ ' : '  ❌ ') + name + (extra ? '   ' + extra : ''));
    if (!cond) bad++;
};

console.log('== 基线 ==');
const base = run();
const baseSummary = (base.out.match(/(\d+) 通过 \/ (\d+) 失败/) || [])[0] || '(没抓到汇总)';
console.log('  ' + baseSummary);
expect('基线全绿', base.code === 0 && /❌/.test(base.out) === false);

const has = (out, name) => out.indexOf('❌ ' + name) >= 0;

// ── 探针 A：父页面不查权限 ──────────────────────────────────────
// ⚠ 这是安全面的那一层。去掉之后任何工具型 skill（哪怕一个能力都没申请）
//   都能往用户的界面上写任意文字，而**所有别的断言照样全绿**
console.log('\n== 探针 A：onProg 里不查 progress 权限 ==');
const A_OLD = "                    if (allowed.indexOf('progress') < 0) return;\r\n";
if (PAGE_BAK.indexOf(A_OLD) < 0) { console.log('  A NOT FOUND —— 锚点变了'); process.exit(1); }
try {
    fs.writeFileSync(PAGE, PAGE_BAK.replace(A_OLD, ''));
    const r = run();
    expect('退出码非 0', r.code !== 0, '(退出码 ' + r.code + ')');
    expect('「没申请 progress 的那句被丢掉」红了',
        has(r.out, '它那句进度被丢掉，一条都没显示'));
} finally { fs.writeFileSync(PAGE, PAGE_BAK); }

// ── 探针 B：去掉节流窗口 ────────────────────────────────────────
// ⚠ 只留 ST_CODE_PROG_MAX（次数上限）的话，300 条里前 200 条会**全过**。
//   「少于 300」那条断言照样绿 —— 只有「同一 tick 的连续两条」那条抓得住。
//   这正是「新增一条断言必须配对照组」的实例
console.log('\n== 探针 B：去掉节流窗口（只留次数上限）==');
const B_OLD = "                    if (now - progLast < ST_CODE_PROG_MS) return;\r\n";
if (PAGE_BAK.indexOf(B_OLD) < 0) { console.log('  B NOT FOUND —— 锚点变了'); process.exit(1); }
try {
    fs.writeFileSync(PAGE, PAGE_BAK.replace(B_OLD, ''));
    const r = run();
    expect('退出码非 0', r.code !== 0, '(退出码 ' + r.code + ')');
    expect('「同一 tick 里连发的第二条会被丢」红了',
        has(r.out, '同一 tick 里连发的第二条会被丢（节流真的在生效）'));
    // ⚠ 而且**只该**红那一条 —— 上限那条还在守，说明两道闸是**分得开**的
    expect('次数上限那条仍然绿（两道闸互不代替）',
        !has(r.out, '狂刷会被节流 + 次数上限挡住（不是 300 条全过）'));
} finally { fs.writeFileSync(PAGE, PAGE_BAK); }

// ── 探针 C：finish 里不撤进度 ───────────────────────────────────
console.log('\n== 探针 C：finish 里不撤掉那句进度 ==');
const C_OLD = "                    stCodeProgressClear(id);\r\n";
if (PAGE_BAK.indexOf(C_OLD) < 0) { console.log('  C NOT FOUND —— 锚点变了'); process.exit(1); }
try {
    fs.writeFileSync(PAGE, PAGE_BAK.replace(C_OLD, ''));
    const r = run();
    expect('退出码非 0', r.code !== 0, '(退出码 ' + r.code + ')');
    expect('「返回之后进度那句话被撤掉了」红了',
        has(r.out, '返回之后进度那句话被撤掉了（不留在界面上）'));
} finally { fs.writeFileSync(PAGE, PAGE_BAK); }

// ── 探针 D：progress 从 ST_CODE_SANDBOX_PERM 里拿掉 ─────────────
// ⚠ 这条守的是**导入那一关**：manifest 写了 "perm":["progress"] 会被判成
//   「这里还没有这个能力」—— 功能明明写好了，用户却装不进去，
//   而报错文案会把责任推给 skill 的作者
// ⚠ 锚点选的是 `ST_CODE_SANDBOX_PERM` 那一行，**不是** `ST_CODE_PERM_TOOLS` 里那行
//   —— 两个常量里都有 `'progress'`，改错一个的话红的是「两边是一份」，
//   而「进了能力表」照样绿（它查的是另一个常量）。第一次就写错了，这里留个记性
console.log('\n== 探针 D：progress 不在 ST_CODE_SANDBOX_PERM 里 ==');
const D_OLD = "const ST_CODE_SANDBOX_PERM = ['card.read', 'card.write', 'progress'];\r\n";
if (PAGE_BAK.indexOf(D_OLD) < 0) { console.log('  D NOT FOUND —— 锚点变了'); process.exit(1); }
try {
    fs.writeFileSync(PAGE, PAGE_BAK.replace(D_OLD,
        "const ST_CODE_SANDBOX_PERM = ['card.read', 'card.write'];\r\n"));
    const r = run();
    expect('退出码非 0', r.code !== 0, '(退出码 ' + r.code + ')');
    expect('「progress 进了能力表」红了',
        has(r.out, 'progress 进了能力表（不然 manifest 那一关会把它判成「没有这个能力」）'));
    expect('「两边是一份」也红了',
        has(r.out, '能力表和 ST_CODE_SANDBOX_PERM 是一份（不漏登记、不多登记）'));
} finally { fs.writeFileSync(PAGE, PAGE_BAK); }

// ── 还原核对 ─────────────────────────────────────────────────────
console.log('\n== 还原 ==');
expect('saki.html 与备份字节一致', fs.readFileSync(PAGE, 'utf8') === PAGE_BAK);
const after = run();
// ⚠ 判据是「**汇总行**一致 + 退出码 0」，不是「逐字一致」——
//   这个套件每行都带耗时，逐字比较必然失败，指向的是毫无意义的差异
const sumOf = out => (out.match(/=====.*?=====/) || ['(没抓到汇总)'])[0];
expect('还原后**汇总结论**与基线一致', sumOf(after.out) === sumOf(base.out),
    '\n     基线: ' + sumOf(base.out) + '\n     还原: ' + sumOf(after.out));
expect('还原后退出码是 0', after.code === 0, '(退出码 ' + after.code + ')');

console.log(bad ? ('\n❌ ' + bad + ' 条没达到预期') : '\n✅ 四个探针都达到预期');
process.exit(bad ? 1 : 0);
