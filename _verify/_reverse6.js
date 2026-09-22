// 反向测试「Code 页带不带上第一段」这个新开关。
//
// 断言全绿不算证据 —— 得把 bug 注回去，看它会不会红。
// 四个探针，都是**改产品**（不是改测试）：
//
//   A. 拆掉开关判断（无条件 unshift） → 「开关关着也不带」那组必须红
//   B. 把 unshift 换成 push（排到 Code 自己那条 system 后面）→ 「第 0 条是第一段」必须红
//   C. 空值也照发（去掉 if (seg)）→ 「空的也不产生空消息」必须红
//   D. 不写 localStorage → 「写进了 stCodeUi」必须红
//
// ⚠ 老规矩：**先备份、先检查、最后才写**。改完一律还原 + 核对字节。
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const PAGE = 'G:/saki/saki.html';
const SUITE = path.join(DIR, 'st-code.js');

const PAGE_BAK = fs.readFileSync(PAGE, 'utf8');
const S = x => x.indexOf('\r\n') >= 0;   // 只是提醒：这个文件是 CRLF

function run() {
    const r = spawnSync(process.execPath, [SUITE], { cwd: DIR, encoding: 'utf8', timeout: 300000 });
    return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}

let bad = 0;
const expect = (name, cond, extra) => {
    console.log((cond ? '  ✅ ' : '  ❌ ') + name + (extra ? '   ' + extra : ''));
    if (!cond) bad++;
};

// 只看 I 节里那几条 —— 别的节的失败跟这次探针无关
const I_FAIL = [
    '开关打开：第一段是**第 0 条**',
    '开关打开：第 1 条才是 Code 自己的 system',
    '开关开着但第一段是空的：不产生空消息',
    '开关关着：那段有内容也不发（对照组）',
    '开关写进了 stCodeUi',
    '开关打开：请求体里真的有第一段'
];
const countI = out => I_FAIL.filter(n => out.indexOf('❌ ' + n) >= 0).length;

console.log('== 基线 ==');
const base = run();
const baseSummary = (base.out.match(/(\d+) 通过 \/ (\d+) 失败/) || [])[0] || '(没抓到汇总)';
console.log('  ' + baseSummary);
expect('基线全绿', base.code === 0 && /❌/.test(base.out) === false);
expect('I 节那几条基线都是绿的', countI(base.out) === 0);

// ── 探针 A：拆掉开关判断 —— 变成「无条件带第一段」─────────────────
console.log('\n== 探针 A：拆掉 if (stCode.useFirstSeg)（变成无条件带）==');
const A_OLD = [
    '            if (stCode.useFirstSeg) {',
    '                const seg = stAiFirstSegText();',
    '                // 开了开关但那段是空的 —— **不发空消息**（和 AI 助手那边一致）',
    '                if (seg) out.unshift({ role: \'system\', content: seg });',
    '            }'
].join('\r\n');
const A_NEW = [
    '            {',
    '                const seg = stAiFirstSegText();',
    '                if (seg) out.unshift({ role: \'system\', content: seg });',
    '            }'
].join('\r\n');
if (PAGE_BAK.indexOf(A_OLD) < 0) { console.log('  A NOT FOUND —— 锚点变了'); process.exit(1); }
try {
    fs.writeFileSync(PAGE, PAGE_BAK.replace(A_OLD, A_NEW));
    const r = run();
    expect('退出码非 0', r.code !== 0, '(退出码 ' + r.code + ')');
    expect('「开关关着也不带」红了', r.out.indexOf('❌ 开关关着：那段有内容也不发') >= 0);
} finally { fs.writeFileSync(PAGE, PAGE_BAK); }

// ── 探针 B：unshift → push（排到 Code 自己那条 system 后面）────────
console.log('\n== 探针 B：unshift 改成 push（顺序错了）==');
const B_OLD = 'if (seg) out.unshift({ role: \'system\', content: seg });';
const B_NEW = 'if (seg) out.push({ role: \'system\', content: seg });';
if (PAGE_BAK.indexOf(B_OLD) < 0) { console.log('  B NOT FOUND —— 锚点变了'); process.exit(1); }
try {
    fs.writeFileSync(PAGE, PAGE_BAK.replace(B_OLD, B_NEW));
    const r = run();
    expect('退出码非 0', r.code !== 0, '(退出码 ' + r.code + ')');
    expect('「第 0 条是第一段」红了', r.out.indexOf('❌ 开关打开：第一段是**第 0 条**') >= 0);
    expect('「第 1 条才是 Code 的 system」也红了',
        r.out.indexOf('❌ 开关打开：第 1 条才是 Code 自己的 system') >= 0);
} finally { fs.writeFileSync(PAGE, PAGE_BAK); }

// ── 探针 C：空值也照发 ───────────────────────────────────────────
console.log('\n== 探针 C：去掉 if (seg)（空值也发一条空消息）==');
const C_OLD = 'if (seg) out.unshift({ role: \'system\', content: seg });';
const C_NEW = 'out.unshift({ role: \'system\', content: seg });';
if (PAGE_BAK.indexOf(C_OLD) < 0) { console.log('  C NOT FOUND —— 锚点变了'); process.exit(1); }
try {
    fs.writeFileSync(PAGE, PAGE_BAK.replace(C_OLD, C_NEW));
    const r = run();
    expect('退出码非 0', r.code !== 0, '(退出码 ' + r.code + ')');
    expect('「空的不产生空消息」红了',
        r.out.indexOf('❌ 开关开着但第一段是空的：不产生空消息') >= 0);
} finally { fs.writeFileSync(PAGE, PAGE_BAK); }

// ── 探针 D：开关不落盘 ───────────────────────────────────────────
console.log('\n== 探针 D：stCodeSaveUi 里不写 useFirstSeg ==');
const D_OLD = '                    useFirstSeg: stCode.useFirstSeg,\r\n';
const D_NEW = '';
if (PAGE_BAK.indexOf(D_OLD) < 0) { console.log('  D NOT FOUND —— 锚点变了'); process.exit(1); }
try {
    fs.writeFileSync(PAGE, PAGE_BAK.replace(D_OLD, D_NEW));
    const r = run();
    expect('退出码非 0', r.code !== 0, '(退出码 ' + r.code + ')');
    expect('「写进了 stCodeUi」红了', r.out.indexOf('❌ 开关写进了 stCodeUi') >= 0);
} finally { fs.writeFileSync(PAGE, PAGE_BAK); }

// ── 还原核对 ─────────────────────────────────────────────────────
console.log('\n== 还原 ==');
expect('saki.html 与备份字节一致', fs.readFileSync(PAGE, 'utf8') === PAGE_BAK);
const after = run();
// ⚠ 判据是「**汇总行**一致 + 退出码 0」，不是「逐字一致」——
//   这个套件每行都带一行 `[1.2s]` 之类的耗时，逐字比较**必然**失败，
//   而且失败信息只告诉你「不一样」，指向的是「耗时变了」这种毫无意义的差异。
//   真正要证的是「产品被改回去了 ⇒ 结论回到了基线」，所以就比结论。
const sumOf = out => (out.match(/=====.*?=====/) || ['(没抓到汇总)'])[0];
expect('还原后**汇总结论**与基线一致', sumOf(after.out) === sumOf(base.out),
    '\n     基线: ' + sumOf(base.out) + '\n     还原: ' + sumOf(after.out));
expect('还原后退出码是 0', after.code === 0, '(退出码 ' + after.code + ')');

console.log(bad ? ('\n❌ ' + bad + ' 条没达到预期') : '\n✅ 四个探针都达到预期');
process.exit(bad ? 1 : 0);
