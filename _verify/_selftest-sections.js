// _selftest-sections.js —— `_audit-sections.js` 的**反向测试**（自包含：备份 → 注入 → 断言 → 还原 → 核字节）。
//
// ⚠ 为什么必须有这个：`_audit-sections.js` 报「0 撞号」时，**那可能只是因为它从来没抓到过任何东西**。
//   本项目铁律：**绿 ≠ 验证过了，只等于「这次没红」** —— 一个从没红过的检查等于没检查。
//   所以这里要同时证明**两件相反的事**：
//     A. 真的撞号时它**必须红**（否则它是个摆设）；
//     B. **跨父节的同号重复它不能红** —— 这条是给第一版那个 bug 立的碑：
//        第一版按「同一文件、同一层」比，结果日报 / CHANGELOG 里每个 `## 第 N 段` 各自的
//        `### ①…⑧` 全被判成撞号 ⇒ **一个文件报 27 处假撞号、全库 24 处**。
//        「判据范围定错」也是一种失败形态，而且它长得像「工具很严格」。
//
// 用法：node _selftest-sections.js
// 退出码：0 = 三项全部符合预期且文件逐字节还原；1 = 有不符合的。
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const DIR = path.join(__dirname, '..', 'markdown');
const TARGET = '04-card-editor.md';
const FILE = path.join(DIR, TARGET);
const AUDIT = path.join(__dirname, '_audit-sections.js');

const sha1 = b => crypto.createHash('sha1').update(b).digest('hex');

// ⚠ 用 spawnSync 而不是 execFileSync —— 后者在退出码非 0 时**抛异常**，
//   而「非 0」正是这里要观察的东西。
function runAudit() {
    const r = cp.spawnSync(process.execPath, [AUDIT, TARGET], { encoding: 'utf8' });
    return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

const backup = fs.readFileSync(FILE);
const before = sha1(backup);
console.log('原文件 sha1: ' + before + '  （' + backup.length + ' 字节）');

let fail = 0, checks = 0;
const verdict = (ok, name, detail) => {
    checks++;
    console.log('  ' + (ok ? '✅' : '❌') + ' ' + name + (detail ? '  —— ' + detail : ''));
    if (!ok) fail++;
};

// ---------- C. 基线：不动文件，必须绿 ----------
console.log('\n== C. 基线（未注入）==');
{
    const r = runAudit();
    verdict(r.code === 0, '退出码 0（无撞号）', '实际 ' + r.code);
    verdict(!/❌ 撞号/.test(r.out), '输出里没有 ❌ 撞号');
}

// ---------- A. 注入一个真撞号，必须红 ----------
console.log('\n== A. 注入 `## 二十、`（与文件里已有的 `## 二十、` 同号）==');
{
    // 追加在文件末尾 —— 根层（parentLine = 0），跟已有的 `## 二十、` 同一个父节
    fs.writeFileSync(FILE, Buffer.concat([backup, Buffer.from('\n## 二十、注入的撞号节\n', 'utf8')]));
    const r = runAudit();
    verdict(r.code === 1, '退出码 1', '实际 ' + r.code);
    verdict(/❌ 撞号/.test(r.out), '输出里出现「❌ 撞号」');
    verdict(/二十/.test(r.out), '指出的是「二十」这一号');
    verdict(/共 2 处/.test(r.out), '报的是「共 2 处」');
    if (process.env.SELFTEST_VERBOSE) console.log(r.out);
}

// ---------- B. 注入「跨父节重复」，**不能**红 ----------
console.log('\n== B. 注入两个不同父节下的 `### ①`（跨父节重复，**不该红**）==');
{
    const block = '\n## 注入测试父节甲\n### ① 甲一\n\n## 注入测试父节乙\n### ① 乙一\n';
    fs.writeFileSync(FILE, Buffer.concat([backup, Buffer.from(block, 'utf8')]));
    const r = runAudit();
    verdict(r.code === 0, '退出码 0（跨父节重复不算撞号）', '实际 ' + r.code);
    verdict(!/❌ 撞号/.test(r.out), '输出里没有 ❌ 撞号');
    if (r.code !== 0 && process.env.SELFTEST_VERBOSE) console.log(r.out);
}

// ---------- D. 注入「跳号」，软提示要响，但**退出码仍须为 0** ----------
console.log('\n== D. 注入跳号（`1.` `3.` `5.`，**只该打软提示、不该改退出码**）==');
{
    // ⚠ 这一项钉的是「软提示不计入失败」这条**行为断言** —— 它在 README 里写着了，
    //   而没被测过的断言跟没写一样。父节必须有 ≥3 个编号子节，软提示才会启动。
    const block = '\n## 注入测试父节丙\n### 1. 甲\n### 3. 乙\n### 5. 丙\n';
    fs.writeFileSync(FILE, Buffer.concat([backup, Buffer.from(block, 'utf8')]));
    const r = runAudit();
    verdict(r.code === 0, '退出码仍是 0（软提示不计入失败）', '实际 ' + r.code);
    verdict(!/❌ 撞号/.test(r.out), '输出里没有 ❌ 撞号');
    verdict(/⚠/.test(r.out), '输出里出现 ⚠ 软提示');
    verdict(/缺 2、4/.test(r.out), '软提示指出了缺的号（2、4）');
    if (process.env.SELFTEST_VERBOSE) console.log(r.out);
}

// ---------- 还原 + 核字节 ----------
console.log('\n== 还原 ==');
fs.writeFileSync(FILE, backup);
const after = sha1(fs.readFileSync(FILE));
verdict(after === before, '逐字节还原（sha1 一致）', after === before ? '' : '还原后 ' + after);

// 顺手确认「没有留下备份文件」
const stray = fs.readdirSync(DIR).filter(f => /\.bak$|~$/.test(f));
verdict(stray.length === 0, '没有残留备份文件', stray.join(', '));

// ⚠ 别在这里写死「三项 / 四项」—— 加了测试就过期（本项目的经典坑）。
//   数出来：`checks` 是 verdict() 自己数的。
console.log('\n' + (fail
    ? '❌ ' + fail + '/' + checks + ' 项不符合预期'
    : '✅ ' + checks + ' 项全部符合预期（基线绿 / 真撞号红 / 跨父节重复不红 / 跳号只打软提示），文件已逐字节还原'));
process.exit(fail ? 1 : 0);
