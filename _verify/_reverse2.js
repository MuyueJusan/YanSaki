// 反向测试（第二轮）：把两处缺陷注回**产品**，确认对应的断言真的会红。
//
//   缺陷 A：stCodeIsReadTool 退回「只看静态名单」—— 纯算 skill 又开始吃改卡步数
//   缺陷 B：导入警告的 writers 恒为空 —— 能改卡的 skill 装进来时不再提醒
//
// ⚠ **自包含**：注入 → 跑 `st-code.js` → 断言**恰好那几条**变红（外加对照组仍绿）
//   → 还原 → 核对字节 + 汇总。
//
// ⚠ 以前这个脚本是「注入，然后自己手动 `--restore`」。2026-09-20 重跑反向测试时实测：
//   跑完 `saki.html` 的哈希已经变了 —— 也就是**忘了还原就把坏产品留在盘上**，
//   而它只打印一句「跑完用 --restore 还原」，不会有任何别的提示。
//   现在改成跟 `_reverse5/6/7.js` 一个套路；`--restore` 只作为**逃生口**保留
//   （脚本被硬杀、`finally` 没跑成时用）。
//
// 用法：node _reverse2.js            自包含跑一遍
//       node _reverse2.js --restore  逃生口：把产品从 `_reverse2.bak` 救回来
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const PAGE = 'G:/saki/saki.html';
const SUITE = path.join(DIR, 'st-code.js');
const BAK = path.join(DIR, '_reverse2.bak');

const PAGE_BAK = fs.readFileSync(PAGE, 'utf8');

// ⚠ 文件是 CRLF —— 多行锚点必须用 \r\n 拼，否则 indexOf 永远 -1（不报错，只是找不到）
const J = a => a.join('\r\n');

function run() {
    const r = spawnSync(process.execPath, [SUITE], { cwd: DIR, encoding: 'utf8', timeout: 300000 });
    return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}

let bad = 0;
const expect = (name, cond, extra) => {
    console.log((cond ? '  ✅ ' : '  ❌ ') + name + (extra ? '   ' + extra : ''));
    if (!cond) bad++;
};

// ⚠ 判据用**子串**找「带 ❌ 的那一行」，不写死整条标签 ——
//   标签是给人看的契约，改一个标点就会让这条探针假红（而它看起来像产品坏了）。
const failedWith = (out, sub) =>
    out.split('\n').some(l => l.indexOf('❌') >= 0 && l.indexOf(sub) >= 0);
const passedWith = (out, sub) =>
    out.split('\n').some(l => l.indexOf('✅') >= 0 && l.indexOf(sub) >= 0);

// ── 逃生口 ───────────────────────────────────────────────────────
if (process.argv.indexOf('--restore') >= 0) {
    if (!fs.existsSync(BAK)) { console.log('没有备份，没法还原'); process.exit(1); }
    fs.writeFileSync(PAGE, fs.readFileSync(BAK));
    fs.unlinkSync(BAK);
    console.log('已还原（并删掉 _reverse2.bak）');
    process.exit(0);
}

// ⚠ 注入前先确认「上一次没有没还原的注入」—— 这个 .bak 的存在本身就是信号
if (fs.existsSync(BAK)) {
    console.log('⚠ 目录里还留着 _reverse2.bak —— 说明上一次注入**没还原**。');
    console.log('  先跑 `node _reverse2.js --restore` 把产品救回来，再重跑本脚本。');
    process.exit(1);
}

// ── 基线 ─────────────────────────────────────────────────────────
console.log('== 基线 ==');
const base = run();
const sumOf = out => (out.match(/=====.*?=====/) || ['(没抓到汇总)'])[0];
console.log('  ' + sumOf(base.out));
expect('基线全绿', base.code === 0 && base.out.indexOf('❌') < 0);

// 备份写在这里：基线跑完、任何注入之前。崩了也能靠它救。
fs.writeFileSync(BAK, PAGE_BAK);
try {
    // ── 探针 A：stCodeIsReadTool 退回只看静态名单 ──────────────────
    console.log('\n== 探针 A：stCodeIsReadTool 退回「只看静态名单」==');
    const A_OLD = J([
        "            if (ST_CODE_READ_TOOLS.indexOf(name) >= 0) return true;",
        "            const sk = stCode.skills.filter(s => s.kind === 'tool' && s.tool &&",
        "                s.tool.name === name)[0];",
        "            return !!(sk && stCodeSkillPermsOf(sk).indexOf('card.write') < 0);"
    ]);
    const A_NEW = "            return ST_CODE_READ_TOOLS.indexOf(name) >= 0;";
    if (PAGE_BAK.indexOf(A_OLD) < 0) { console.log('  A NOT FOUND —— 锚点变了，先看产品里那段还在不在'); process.exit(1); }
    try {
        fs.writeFileSync(PAGE, PAGE_BAK.replace(A_OLD, A_NEW));
        const r = run();
        expect('退出码非 0', r.code !== 0, '(退出码 ' + r.code + ')');
        expect('「没申请 card.write 的 skill 算只读」红了', failedWith(r.out, '算只读'));
        expect('「连调 6 次纯算 skill 之后还能改卡」红了', failedWith(r.out, '还能改卡'));
        // 对照组：申请了 card.write 的本来就不在静态名单里 ⇒ 这条**必须还是绿的**
        expect('对照组：申请了 card.write 的「不算只读」仍是绿的',
            passedWith(r.out, '不算只读'), '（没有对照组，上面两条可能是恒真的）');
    } finally { fs.writeFileSync(PAGE, PAGE_BAK); }

    // ── 探针 B：导入警告的 writers 恒为空 ──────────────────────────
    console.log('\n== 探针 B：导入警告的 writers 恒为空 ==');
    const B_OLD = J([
        "            const writers = found.filter(sk => sk.kind === 'tool' && sk.tool &&",
        "                stCodeSkillPermsOf(sk).indexOf('card.write') >= 0);"
    ]);
    const B_NEW = "            const writers = [];";
    if (PAGE_BAK.indexOf(B_OLD) < 0) { console.log('  B NOT FOUND —— 锚点变了，先看产品里那段还在不在'); process.exit(1); }
    try {
        fs.writeFileSync(PAGE, PAGE_BAK.replace(B_OLD, B_NEW));
        const r = run();
        expect('退出码非 0', r.code !== 0, '(退出码 ' + r.code + ')');
        expect('「导入时当场说清它要改卡」红了', failedWith(r.out, '当场就说清它要改卡'));
        expect('「顶部闪一下那句也带警告」红了', failedWith(r.out, '顶部闪一下'));
        expect('对照组：perm 仍然存进了 skill（没在导入路上丢掉）',
            passedWith(r.out, 'perm 存进了 skill'), '（这条跟 writers 无关，不该被带红）');
    } finally { fs.writeFileSync(PAGE, PAGE_BAK); }

    // ── 还原核对 ──────────────────────────────────────────────────
    console.log('\n== 还原 ==');
    expect('saki.html 与备份**字节一致**', fs.readFileSync(PAGE, 'utf8') === PAGE_BAK);
    const after = run();
    expect('还原后**汇总结论**与基线一致', sumOf(after.out) === sumOf(base.out),
        '\n     基线: ' + sumOf(base.out) + '\n     还原: ' + sumOf(after.out));
    expect('还原后退出码是 0', after.code === 0, '(退出码 ' + after.code + ')');
} finally {
    // 走到这儿就说明还原路径已经走完了（或异常了）—— 备份没用了，删掉。
    // ⚠ 必须**无条件**删：留着它，下一次运行会以为「上次没还原」而拒绝启动。
    try { if (fs.existsSync(BAK)) fs.unlinkSync(BAK); } catch (e) {}
}

console.log(bad ? ('\n❌ ' + bad + ' 条没达到预期') : '\n✅ 两个探针都达到预期（含各自的对照组）');
process.exit(bad ? 1 : 0);
