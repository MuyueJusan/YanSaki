// 一次性：清掉 CDP / 探针留下的临时 profile 目录。
// 用法：node _purge-tmp.js         —— **默认只数不删**（安全默认）
//       node _purge-tmp.js --go    —— 先数、再删、删完再数
//
// ⚠ **默认不删**是故意的：一个会删东西的脚本，不该把「删」设成默认动作。
// ⚠ 只删「本仓库自己造出来的」那些前缀，且必须是 os.tmpdir() 下的**目录**。
//    绝不递归删 tmpdir 本身、也绝不按通配符乱扫 —— 那里还住着别人的东西。
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const GO = process.argv.includes('--go');
const DRY = !GO;
const ROOT = os.tmpdir();

// 前缀白名单：全部来自本仓库的 fs.mkdtempSync(path.join(os.tmpdir(), 'xxx-'))
//
// ⚠⚠ **这份清单是手写的，所以它一定会漏 —— 下面那道「未收录前缀」报告就是为它准备的。**
//   2026-09-20 实测过一次代价：白名单当时只有 6 个前缀，而 tmpdir 里本仓库造的其实是 12 类。
//   于是「全清 943 个 / 失败 0 / 删完再数 0」看起来**彻底成功**，
//   而 probe-sb- / pbtn- / pfnt- / fontv- / fontvar- / dbg- 这 **18 个目录 / 212.8 MB**
//   从头到尾**没被看过一眼**（脚本只数白名单里的东西，白名单外的不在它的视野里）。
//   ⚠ 这就是「枚举不完整时不会红，只会少走」—— **它不会报错，只会安静地少扫一批。**
const PREFIXES = [
    'cdp-', 'diagth-', 'diag-',
    'fontpx-', 'fontd-', 'font-', 'fontv-', 'fontvar-',
    'probe-sb-', 'pbtn-', 'pfnt-', 'dbg-',
];

function scan() {
    const out = [];
    for (const name of fs.readdirSync(ROOT)) {
        if (!PREFIXES.some(p => name.startsWith(p))) continue;
        const full = path.join(ROOT, name);
        let st;
        try { st = fs.statSync(full); } catch (e) { continue; }
        if (!st.isDirectory()) continue;
        out.push({ name, full, mtime: st.mtimeMs });
    }
    return out;
}

// tmpdir 里存在、但不在白名单里的前缀 —— **只报告，不删**。
// ⚠ 故意不把「有未收录前缀」做成硬错误：那里绝大多数是宿主程序（编辑器 / agent）自己的目录，
//   天天都在。一个永远在报的检查只会被无视（判据宁可窄 + 白名单显式）。
function unlisted() {
    const seen = new Map();
    for (const name of fs.readdirSync(ROOT)) {
        if (PREFIXES.some(p => name.startsWith(p))) continue;
        const full = path.join(ROOT, name);
        let st;
        try { st = fs.statSync(full); } catch (e) { continue; }
        if (!st.isDirectory()) continue;
        const m = name.match(/^([A-Za-z]+-)/);
        const k = m ? m[1] : '(无前缀)';
        seen.set(k, (seen.get(k) || 0) + 1);
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]);
}

function sizeOf(dir) {
    let bytes = 0, files = 0;
    const walk = d => {
        let ents;
        try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
        for (const e of ents) {
            const full = path.join(d, e.name);
            if (e.isDirectory()) walk(full);
            else {
                files++;
                try { bytes += fs.statSync(full).size; } catch (err) {}
            }
        }
    };
    walk(dir);
    return { bytes, files };
}

const fmt = t => new Date(t).toISOString().replace('T', ' ').slice(0, 16);

// ── 先数 ───────────────────────────────────────────────
const before = scan();
const byPrefix = {};
for (const h of before) {
    const k = PREFIXES.find(p => h.name.startsWith(p));
    byPrefix[k] = (byPrefix[k] || 0) + 1;
}
before.sort((a, b) => a.mtime - b.mtime);

console.log('== 先数 ==');
console.log('  tmpdir  : ' + ROOT);
console.log('  待删目录: ' + before.length);
console.log('  前缀分布: ' + Object.entries(byPrefix).map(([k, v]) => k + '=' + v).join('  '));
if (before.length) {
    console.log('  最旧    : ' + fmt(before[0].mtime) + '  ' + before[0].name);
    console.log('  最新    : ' + fmt(before[before.length - 1].mtime) + '  ' + before[before.length - 1].name);
}

// ── 闸门：把「白名单可能不全」这件事变可见 ─────────────
const un = unlisted();
if (un.length) {
    console.log('\n  未收录的前缀（tmpdir 里有、但不在 PREFIXES 里，**不会被删**）：');
    console.log('    ' + un.map(([k, v]) => k + ' ' + v).join('   '));
    console.log('    ⚠ 若其中有**本仓库造的**，加进 PREFIXES —— 否则那批会被**静默跳过**，');
    console.log('      而输出看起来跟「扫干净了」一模一样。');
}

if (DRY) { console.log('\n(--dry：什么都没删。确认无误后加 --go 才会真删)'); process.exit(0); }
if (!before.length) { console.log('\n没有可删的，收工。'); process.exit(0); }

// ── 再删 ───────────────────────────────────────────────
console.log('\n== 再删 ==');
const failed = [];
let done = 0;
for (const h of before) {
    const t0 = Date.now();
    try {
        fs.rmSync(h.full, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
        done++;
        // ⚠⚠ **每个都打印，不要「每 100 个才打印一次」** —— 残留通常只有几十个（第二十一轮实测 44 个），
        //   而本机删一个 profile 目录要**上百秒**（~200 ms/文件 × 几百个文件）
        //   ⇒ 隔 100 个才打印 = **全程无输出**，看起来跟「挂了」一模一样。
        console.log('  ✓ ' + h.name + '  ' + ((Date.now() - t0) / 1000).toFixed(1) + 's  (' + done + '/' + before.length + ')');
    } catch (e) {
        failed.push(h.name + '  ' + (e && e.code ? e.code : e));
    }
}
console.log('  删除成功 ' + done + ' / ' + before.length);
if (failed.length) {
    console.log('  ⚠ 失败 ' + failed.length + ' 个：');
    failed.slice(0, 20).forEach(x => console.log('     ' + x));
}

// ── 删完再数 ───────────────────────────────────────────
const after = scan();
console.log('\n== 删完再数 ==');
console.log('  剩余匹配目录: ' + after.length + '（应为 0）');
const stillSize = after.reduce((s, h) => s + sizeOf(h.full).bytes, 0);
if (after.length) {
    after.forEach(h => console.log('     ' + fmt(h.mtime) + '  ' + h.name));
    console.log('  剩余占用: ' + (stillSize / 1073741824).toFixed(2) + ' GB');
}
console.log(after.length === 0 ? '\n✅ 清干净了。' : '\n❌ 还有剩的，别当成清完了。');
