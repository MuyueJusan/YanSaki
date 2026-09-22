// _reverse9.js —— 反向测试 `_audit-anchors.js`（那个核对 README 行号表的**只读**工具）。
//
// 为什么单独一个文件：**检查本身也要反向测试。** `_audit-anchors.js` 报「两张表的行号全部对得上」
// 只说明「**这次**没红」，不说明「它**会**红」。而且本项目的铁律是「反向测试要**定期重跑**」——
// 手工注入没人会重做，所以固化成脚本（跟 `_reverse8.js` 一个套路）。
//
// ⚠ 注入点在**文档**（`markdown/README.md` 的行号表），**不在产品** —— 这个工具读的就是文档。
//   所以探针改 README 的一个行号，跑完立刻写回原文，收尾核 sha1。
//
//   探针 A：§2 把 `#st-card` 的行号 5202 改成 5203  → **恰好 1 行红**、报出真值、exit **1**
//   探针 B：§3 把「日历容器」的行号 289 改成 290    → **恰好 1 行红**、报「最近的上一个横幅在 289」、exit **1**
//   探针 C：§3 把「日历容器」的行号 289 改成 274    → **0 行红**（274 确实是横幅「数字时钟」）
//                                                     但**软提示 ⚠** 必须响、exit 仍是 **0**
//
// ⚠ 探针 C 是「**盲区**」测试：它证明**硬判据抓不到「漂到了另一个横幅上」**，而软提示抓得到 ——
//   同时证明软提示**没有偷偷变成硬失败**（exit 仍 0）。⚠ 软的变硬是回归，硬的被软化也是回归。
// ⚠ 判据按**行首空白**区分「结果行」和「汇总行」：结果行是 `  ❌ …` / `     ⚠ …`（有缩进），
//   汇总行 `❌ N 行对不上…` / `⚠ N 行…` 顶格。不区分的话汇总行会被数进去。
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = __dirname;
const README = path.join(DIR, '..', 'markdown', 'README.md');
const AUDIT = path.join(DIR, '_audit-anchors.js');
const BAK = path.join(DIR, '_reverse9.bak');

// ⚠ 上一次没还原干净就拒绝启动 —— 否则会把「注入过的 README」当成基线备份下来。
if (fs.existsSync(BAK)) {
    console.log('⚠ 目录里还留着 _reverse9.bak —— 上一次没还原。先人工核对 markdown/README.md，再删掉它重跑。');
    process.exit(1);
}

const ORIG = fs.readFileSync(README, 'utf8');   // ⚠ 原样读，**别** replace(/\r/g,'')，否则会把 CRLF 写没
const sha1 = s => crypto.createHash('sha1').update(s, 'utf8').digest('hex');

function runAudit() {
    const r = spawnSync(process.execPath, [AUDIT], {
        cwd: DIR, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 60000
    });
    return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}

let bad = 0;
const expect = (name, cond, extra) => {
    console.log((cond ? '  ✅ ' : '  ❌ ') + name + (extra ? '   ' + extra : ''));
    if (!cond) bad++;
};
// ⚠ 结果行有缩进、汇总行顶格 —— 只数带缩进的，否则汇总行会被算成一条。
const hardFail = out => out.split('\n').filter(l => /^\s+❌/.test(l));
const softWarn = out => out.split('\n').filter(l => /^\s+⚠/.test(l));

// 单行锚点（README 里每处只出现一次；避开多行锚点就不用跟 CRLF 搏斗）
const A_FROM = '| 5202 | SillyTavern 角色卡编写器（折叠入口卡片） |';
const A_TO = '| 5203 | SillyTavern 角色卡编写器（折叠入口卡片） |';
const B_FROM = '| 289 | 日历容器 |';
const B_TO = '| 290 | 日历容器 |';
const C_TO = '| 274 | 日历容器 |';

// 锚点在**进 try 之前**检查：锚点变了要立刻停，别拿一个「什么都没注入」的跑批当结果。
for (const [nm, s] of [['A', A_FROM], ['B/C', B_FROM]]) {
    if (ORIG.indexOf(s) < 0) {
        console.log('⚠ 探针 ' + nm + ' 的锚点在 README 里找不到：' + s);
        console.log('  ⇒ 先 `grep` 那个锚点，**别急着改探针** —— 表本身可能已经变了。');
        process.exit(1);
    }
}

fs.writeFileSync(BAK, '注入进行中；正常收尾会删掉它。\n');
let code = 0;
try {
    // ── 探针 A：§2 行号改错一格 ⇒ 硬红 ────────────────────────────
    console.log('== 探针 A · §2 行号 5202 → 5203 ==');
    fs.writeFileSync(README, ORIG.split(A_FROM).join(A_TO));
    {
        const r = runAudit();
        const hf = hardFail(r.out);
        expect('A · 恰好 1 行红', hf.length === 1, '实得 ' + hf.length);
        expect('A · 报出真值「实际 5202」', /实际 5202/.test(hf[0] || ''), hf[0] ? hf[0].trim() : '（没有红行）');
        expect('A · exit code = 1', r.code === 1, '实得 ' + r.code);
        expect('A · 对照组：§2 别的行仍绿', r.out.indexOf('✅ 4912') >= 0 && r.out.indexOf('✅ 5276') >= 0);
        expect('A · 对照组：§3 完全不受影响', r.out.indexOf('✅ 41') >= 0 && r.out.indexOf('✅ 289') >= 0);
    }
    fs.writeFileSync(README, ORIG);

    // ── 探针 B：§3 行号改错一格 ⇒ 硬红，且报出真值 ────────────────
    console.log('\n== 探针 B · §3 行号 289 → 290 ==');
    fs.writeFileSync(README, ORIG.split(B_FROM).join(B_TO));
    {
        const r = runAudit();
        const hf = hardFail(r.out);
        expect('B · 恰好 1 行红', hf.length === 1, '实得 ' + hf.length);
        expect('B · 报「最近的上一个横幅在 289」', /横幅在 289/.test(hf[0] || ''), hf[0] ? hf[0].trim() : '（没有红行）');
        expect('B · exit code = 1', r.code === 1, '实得 ' + r.code);
        expect('B · 对照组：§3 别的行仍绿', r.out.indexOf('✅ 274') >= 0 && r.out.indexOf('✅ 3571') >= 0);
    }
    fs.writeFileSync(README, ORIG);

    // ── 探针 C：§3 行号指到**另一个横幅** ⇒ 硬判据抓不到，只有软提示响 ──
    console.log('\n== 探针 C · §3 行号 289 → 274（指到另一个横幅「数字时钟」）==');
    fs.writeFileSync(README, ORIG.split(B_FROM).join(C_TO));
    {
        const r = runAudit();
        const hf = hardFail(r.out);
        const sw = softWarn(r.out);
        expect('C · 硬判据 **0 行红**（274 确实是横幅 ⇒ 它看不见这个错）', hf.length === 0, '实得 ' + hf.length);
        expect('C · 软提示**恰好 1 条**', sw.length === 1, '实得 ' + sw.length);
        expect('C · 软提示指向 274', /274/.test(sw[0] || ''), sw[0] ? sw[0].trim() : '（没有软提示）');
        expect('C · exit code 仍是 **0**（软提示没偷偷变硬）', r.code === 0, '实得 ' + r.code);
    }
    fs.writeFileSync(README, ORIG);
} finally {
    // ⚠ 不管上面怎么结束，都写回原文 —— 然后**核 sha1**，别只是「以为还原了」。
    fs.writeFileSync(README, ORIG);
    const after = fs.readFileSync(README, 'utf8');
    const same = after === ORIG;
    console.log('\n== 收尾 ==');
    expect('README 逐字节还原', same, 'sha1 ' + sha1(after).slice(0, 8) + ' vs 原文 ' + sha1(ORIG).slice(0, 8));
    if (fs.existsSync(BAK)) fs.unlinkSync(BAK);
    code = bad;
}

console.log('\n========== ' + (code ? '❌ ' + code + ' 条没通过' : '✅ 全部通过（探针 A / B / C）') + ' ==========');
process.exitCode = code ? 1 : 0;
