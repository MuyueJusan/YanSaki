// 反向测试新的 `check.js`。九个探针：
//
//   A. 造一份垃圾 `blk0.js`（生成物平时不在目录里 —— 自己造、自己删）→ 检查结果**必须不变**
//      （证明它读的是 `saki.html`，不是那份可能过时的生成物）
//   B. 拆掉 `stCodeTasksHtml` 里 `t.text` 的 `escapeHtml` → 转义闸门**必须红**
//   C. 新加一个构建函数（不在白名单里）→ 转义闸门**必须红**
//   D. 注入语法错 → `SYNTAX` **必须红**
//   E. 删掉 `stSbChain` 的声明（引用还在）→ `UNDECLARED` **必须红**，且 `SYNTAX` 仍干净
//   F. 删掉 `ST_CODE_MAX_SESS` 的声明 → `UNDECLARED` **必须红**（证明 `ST_` 前缀也在扫）
//   G. 注入 `window.stZzProbeOnly`（属性访问）→ 必须**仍绿**
//   H. 注入 `'stZzStringOnly'`（字符串字面量）→ 必须**仍绿**
//   I. 注入裸引用 `stZzBareMissing` → **必须红**
//
// ⚠ G / H / I 是一组，缺一不可：H 证明「字符串里的不算引用」、I 证明「裸引用算」、
//    G 证明「属性访问不算」。少了任何一条，涂串器或属性过滤的 bug 都是**静默的** ——
//    要么永远绿，要么开始误报。
// ⚠ E 是这份检查**存在的原因**：未声明标识符的调用是**运行时**错误，语法完全合法，
//    所以 `SYNTAX` 抓不到它，页面加载也不报错 —— 直到用户真走到那条支路。
//
// ⚠ 老规矩：**先备份、先检查、最后才写**。改完一律还原 + 核对字节。
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const PAGE = 'G:/saki/saki.html';
const BLK = path.join(DIR, 'blk0.js');
const CHECK = path.join(DIR, 'check.js');

const PAGE_BAK = fs.readFileSync(PAGE, 'utf8');
// ⚠ `blk0.js` 平时**不在目录里**（生成物不留仓库）—— 探针 A 自己造一份，`finally` 里无条件删。

function runCheck() {
    const r = spawnSync(process.execPath, [CHECK], { cwd: DIR, encoding: 'utf8', timeout: 120000 });
    return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}

let bad = 0;
const expect = (name, cond, extra) => {
    console.log((cond ? '  ✅ ' : '  ❌ ') + name + (extra ? '   ' + extra : ''));
    if (!cond) bad++;
};

const base = runCheck();
console.log('== 基线 ==');
console.log('  ' + base.out.split('\n').filter(l => l).slice(-1)[0]);
expect('基线是绿的', base.code === 0 && base.out.indexOf('ESCAPE-GATE: (none)') >= 0);

// ── 探针 A：生成物过时 / 坏掉，检查结果不许变 ────────────────────
// `blk0.js` 平时不在目录里，所以这里**自己造一份**、验完无条件删掉。
// ⚠ 原来写的是「备份存在才还原」—— 文件本来不在时，这个探针会**把垃圾留在目录里**，
//   而且自己一个字都不说；下一次整跑就会卡在「清单对账」那一关，看起来像套件坏了。
console.log('\n== 探针 A：造一份垃圾 blk0.js，检查结果必须不变 ==');
const declaredIn = out => (out.match(/declared functions: (\d+)/) || [])[1];
try {
    fs.writeFileSync(BLK, '// 这不是真的代码\nthis is not valid javascript at all (((\n');
    const r = runCheck();
    expect('退出码仍是 0', r.code === 0, '(退出码 ' + r.code + ')');
    // ⚠ 不写死数字：函数数量每加一个东西就会变，写死等于给自己攒一笔「红」的账。
    //   跟基线**比**才是这条要验的东西。
    expect('declared functions 与基线一致',
        declaredIn(r.out) === declaredIn(base.out),
        '(' + declaredIn(r.out) + ' vs 基线 ' + declaredIn(base.out) + ')');
    expect('MISSING 仍是 (none)', r.out.indexOf('MISSING: (none)') >= 0);
    expect('输出与基线**逐字一致**', r.out === base.out);
} finally {
    try { fs.unlinkSync(BLK); } catch (e) {}   // 无条件清掉自己造的那份
}

// ── 探针 B：拆掉一处 escapeHtml ─────────────────────────────────
console.log('\n== 探针 B：拆掉 stCodeTasksHtml 里 t.text 的 escapeHtml ==');
const B_OLD = "'<span>' + escapeHtml(t.text) + '</span></li>';";
const B_NEW = "'<span>' + t.text + '</span></li>';";
if (PAGE_BAK.indexOf(B_OLD) < 0) { console.log('  B NOT FOUND —— 锚点变了'); process.exit(1); }
try {
    fs.writeFileSync(PAGE, PAGE_BAK.replace(B_OLD, B_NEW));
    const r = runCheck();
    expect('退出码非 0', r.code !== 0, '(退出码 ' + r.code + ')');
    expect('ESCAPE-GATE 报了出来', r.out.indexOf('ESCAPE-GATE: 1 处') >= 0);
    expect('点名是 stCodeTasksHtml', r.out.indexOf('stCodeTasksHtml') >= 0);
    expect('把多的那个标识符打出来了', r.out.indexOf('t.text') >= 0);
} finally { fs.writeFileSync(PAGE, PAGE_BAK); }

// ── 探针 C：新加一个不在白名单里的构建函数 ──────────────────────
console.log('\n== 探针 C：新加一个构建函数（不在白名单里）==');
const C_OLD = '        function stCodeBarHtml() {';
const C_NEW = '        function stCodeProbeHtml() {\n' +
    "            return '<div>' + stCode.step + '</div>';\n" +
    '        }\n\n' + C_OLD;
if (PAGE_BAK.indexOf(C_OLD) < 0) { console.log('  C NOT FOUND —— 锚点变了'); process.exit(1); }
try {
    fs.writeFileSync(PAGE, PAGE_BAK.replace(C_OLD, C_NEW));
    const r = runCheck();
    expect('退出码非 0', r.code !== 0, '(退出码 ' + r.code + ')');
    expect('ESCAPE-GATE 报了出来', r.out.indexOf('ESCAPE-GATE: 1 处') >= 0);
    expect('点名是新函数 stCodeProbeHtml', r.out.indexOf('stCodeProbeHtml') >= 0);
} finally { fs.writeFileSync(PAGE, PAGE_BAK); }

// ── 探针 D：注入语法错 → SYNTAX 那条必须红 ───────────────────────
console.log('\n== 探针 D：注入一个语法错 ==');
const D_OLD = '        function stCodeEmptyHtml() {';
const D_NEW = '        function stCodeEmptyHtml( {';   // 少了右括号
if (PAGE_BAK.indexOf(D_OLD) < 0) { console.log('  D NOT FOUND —— 锚点变了'); process.exit(1); }
try {
    fs.writeFileSync(PAGE, PAGE_BAK.replace(D_OLD, D_NEW));
    const r = runCheck();
    expect('退出码非 0', r.code !== 0, '(退出码 ' + r.code + ')');
    expect('SYNTAX 报了出来', r.out.indexOf('SYNTAX: 1 处') >= 0);
} finally { fs.writeFileSync(PAGE, PAGE_BAK); }

// ── 探针 E：删掉函数**声明**、引用还在 → UNDECLARED 必须红 ────────
// 把函数名改掉 = 声明没了，调用点还在。这正是手写清单原本要抓的那类坑，
// 也正是 `SYNTAX` **抓不到**的：调用一个未声明的标识符语法完全合法。
console.log('\n== 探针 E：stSbChain 改名（声明没了，引用还在）==');
const E_OLD = 'function stSbChain(id, list, prefix, _d) {';
const E_NEW = 'function zzProbeRenamedChain(id, list, prefix, _d) {';
if (PAGE_BAK.indexOf(E_OLD) < 0) { console.log('  E NOT FOUND —— 锚点变了'); process.exit(1); }
try {
    fs.writeFileSync(PAGE, PAGE_BAK.replace(E_OLD, E_NEW));
    const r = runCheck();
    expect('退出码非 0', r.code !== 0, '(退出码 ' + r.code + ')');
    expect('UNDECLARED 报了出来', r.out.indexOf('UNDECLARED: 1 处') >= 0);
    expect('点名是 stSbChain', r.out.indexOf('stSbChain ×') >= 0);
    expect('对照：SYNTAX 仍是干净的', r.out.indexOf('SYNTAX: (none)') >= 0,
        '（这就是这条闸门存在的理由）');
} finally { fs.writeFileSync(PAGE, PAGE_BAK); }

// ── 探针 F：`ST_` 前缀的常量漏声明也要抓得到 ────────────────────
console.log('\n== 探针 F：ST_CODE_MAX_SESS 改名（引用还在）==');
const F_OLD = 'const ST_CODE_MAX_SESS = 40;';
const F_NEW = 'const ST_CODE_MAX_SESS_RENAMED = 40;';
if (PAGE_BAK.indexOf(F_OLD) < 0) { console.log('  F NOT FOUND —— 锚点变了'); process.exit(1); }
try {
    fs.writeFileSync(PAGE, PAGE_BAK.replace(F_OLD, F_NEW));
    const r = runCheck();
    expect('退出码非 0', r.code !== 0, '(退出码 ' + r.code + ')');
    expect('UNDECLARED 报了出来', r.out.indexOf('UNDECLARED: 1 处') >= 0);
    expect('点名是 ST_CODE_MAX_SESS', r.out.indexOf('ST_CODE_MAX_SESS ×') >= 0);
} finally { fs.writeFileSync(PAGE, PAGE_BAK); }

// ── 探针 G / H / I：三种**不该**被当成引用的形态 ────────────────
// 三条都插在同一个锚点前面（每次从干净的 PAGE_BAK 出发）。
const P_OLD = '        function stCodeEmptyHtml() {';

// G：属性访问不算引用
console.log('\n== 探针 G：注入 window.stZzProbeOnly（属性访问，不该红）==');
if (PAGE_BAK.indexOf(P_OLD) < 0) { console.log('  G NOT FOUND —— 锚点变了'); process.exit(1); }
try {
    fs.writeFileSync(PAGE, PAGE_BAK.replace(P_OLD,
        '        const zzProbeAttr = window.stZzProbeOnly;\n' + P_OLD));
    const r = runCheck();
    expect('退出码仍是 0', r.code === 0, '(退出码 ' + r.code + ')');
    expect('UNDECLARED 仍是 (none)', r.out.indexOf('UNDECLARED: (none)') >= 0);
    expect('没把 stZzProbeOnly 当成引用', r.out.indexOf('stZzProbeOnly') < 0);
} finally { fs.writeFileSync(PAGE, PAGE_BAK); }

// H：字符串字面量里的名字不算引用
console.log('\n== 探针 H：注入字符串 "stZzStringOnly"（不该红）==');
try {
    fs.writeFileSync(PAGE, PAGE_BAK.replace(P_OLD,
        "        const zzProbeStr = 'stZzStringOnly';\n" + P_OLD));
    const r = runCheck();
    expect('退出码仍是 0', r.code === 0, '(退出码 ' + r.code + ')');
    expect('UNDECLARED 仍是 (none)', r.out.indexOf('UNDECLARED: (none)') >= 0);
    expect('没把字符串里的名字当成引用', r.out.indexOf('stZzStringOnly') < 0);
} finally { fs.writeFileSync(PAGE, PAGE_BAK); }

// I：裸引用**必须**红（证明这条闸门不是永远绿 —— 与 G / H 配对）
console.log('\n== 探针 I：注入裸引用 stZzBareMissing（必须红）==');
try {
    fs.writeFileSync(PAGE, PAGE_BAK.replace(P_OLD,
        '        const zzProbeBare = stZzBareMissing;\n' + P_OLD));
    const r = runCheck();
    expect('退出码非 0', r.code !== 0, '(退出码 ' + r.code + ')');
    expect('UNDECLARED 报了出来', r.out.indexOf('UNDECLARED: 1 处') >= 0);
    expect('点名是 stZzBareMissing', r.out.indexOf('stZzBareMissing ×') >= 0);
    expect('对照：SYNTAX 仍是干净的', r.out.indexOf('SYNTAX: (none)') >= 0);
} finally { fs.writeFileSync(PAGE, PAGE_BAK); }

// ── 还原核对 ───────────────────────────────────────────────────
console.log('\n== 还原 ==');
expect('saki.html 与备份字节一致', fs.readFileSync(PAGE, 'utf8') === PAGE_BAK);
const after = runCheck();
expect('还原后输出与基线逐字一致', after.out === base.out && after.code === 0);

console.log(bad ? ('\n❌ ' + bad + ' 条没达到预期') : '\n✅ 九个探针都达到预期');
process.exit(bad ? 1 : 0);
