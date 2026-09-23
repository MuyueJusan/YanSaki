// _fix-anchors.js —— 把 README §2 / §3 两张行号表的**真值**算出来（只读，不改任何文件）。
//
// 为什么不手 grep：§3 有 47 行、§2 有 9 行，一行行 grep 又慢又容易抄错；
// 而且实测**同一张表里两种位移并存**（靠加法算必错）。
//
// 手法：
//   §2 —— 直接用审计那套判据（`id="X"` / body 区内第一处 `class="…X…"`），取值。
//   §3 —— **可验证的位移**：`node _fix-anchors.js <位移>`（默认 194）。
//         插了一处 CSS ⇒ 插入点**之后**的横幅整体后移同一个量。
//         逐行核「旧值 + 位移」那一行**是不是横幅**（`/*` 开头），不是就打 ❌ 并列出来。
//         ⚠ 位移**每轮都不一样**（取决于这轮插了多少行、插在哪），**必须现量**；
//           拿不准就把位移传错 —— 它会**大声报 ❌**，不会静默给错值。
//         ⚠ 早先那版「单调对齐 + 共享字」的启发式**实测会错**（本轮错了 2 行：
//           「系统提示词预设」被对到 1047、「条目本轮会不会插入」被对到 1438）⇒ 已弃用。
//   ⚠ §3 输出里每一行都把横幅原文打出来，**要人核一眼**再往 README 里抄。
//
// 跑法：node _fix-anchors.js        （或 node _fix-anchors.js 194）
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const README = path.join(DIR, '..', 'markdown', 'README.md');
const PAGE = 'G:/saki/saki.html';

const md = fs.readFileSync(README, 'utf8').replace(/\r/g, '');
const src = fs.readFileSync(PAGE, 'utf8').replace(/\r/g, '');
const lines = src.split('\n');

function section(title) {
    const i = md.indexOf(title);
    if (i < 0) return '';
    const j = md.indexOf('\n## ', i + title.length);
    return md.slice(i, j < 0 ? md.length : j);
}
function rows(sec) {
    return sec.split('\n')
        .filter(l => /^\|\s*\d/.test(l))
        .map(l => l.split('|').slice(1, -1).map(c => c.trim()));
}
const firstLineWith = (re, from = 0) => {
    for (let i = from; i < lines.length; i++) if (re.test(lines[i])) return i + 1;
    return -1;
};
const BODY_START = firstLineWith(/^<body>/);
const zhChars = name => [...new Set((name
    .replace(/\*\*/g, '').replace(/`/g, '')
    .replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '')
    .match(/[\u4e00-\u9fa5]/g) || []))];
const bannerBlock = n => {
    const out = [];
    for (let i = n - 1; i < lines.length && i < n - 1 + 6; i++) {
        out.push(lines[i]);
        if (/\*\/\s*$/.test(lines[i])) break;
    }
    return out.join(' ');
};
const flat = s => String(s).replace(/\s+/g, ' ').slice(0, 56);

// ── §2 ─────────────────────────────────────────────────────────
console.log('== §2 · body 顶层区块（新值）==');
for (const [noCol, name, ids] of rows(section('## 2. body 顶层区块'))) {
    const nums = (noCol.match(/\d+/g) || []).map(Number);
    const toks = [...ids.matchAll(/`([#.][\w-]+)`/g)].map(m => m[1]);
    if (!toks.length || !nums.length) { console.log('  ⚠ 解析不出：' + noCol + ' ' + name); continue; }
    const got = toks.map(tok => {
        const isId = tok[0] === '#', nm = tok.slice(1);
        return isId ? firstLineWith(new RegExp('id="' + nm + '"'))
            : firstLineWith(new RegExp('class="[^"]*\\b' + nm + '\\b'), BODY_START - 1);
    });
    // 同一行的多个锚点合起来写成一格（跟原表一样用 ` → ` 或 ` / `）
    const cell = got.length === 2 && /→/.test(noCol) ? got.join(' → ') : got.join(' / ');
    const changed = cell !== noCol.replace(/\s/g, '');
    console.log('  ' + (changed ? '✏' : ' ') + ' | ' + cell + ' | ' + name + ' | ' + ids
        + (changed ? '   （原 ' + noCol + '）' : ''));
}

// ── §3 ─────────────────────────────────────────────────────────
// ⚠⚠ 上面那套「单调对齐 + 共享字」的启发式**实测会错**（本轮就错了 2 行：
//   「系统提示词预设」被对到 1047、「条目本轮会不会插入」被对到 1438）。
//   ⇒ 改用**可验证的位移**：这一轮只在样式块里插了**一处**（`.game-entry-btn` 之后），
//     所以 `> 113` 的横幅**一律 +194**。逐行核「旧值 + 194 是不是横幅」，并打横幅原文。
//     任何一行对不上就报出来 —— 那才是需要人看的地方。
const SHIFT = Number(process.argv[2] || 194);
const SHIFT_FROM = 113;   // 插入点（旧行号）之前的不动
console.log('\n== §3 · CSS 分区（旧值 + ' + SHIFT + '，逐行核是不是横幅）==');
for (const [noCol, name] of rows(section('## 3. CSS 分区'))) {
    const nums = (noCol.match(/\d+/g) || []).map(Number);
    if (!nums.length) continue;
    const got = nums.map(n => (n <= SHIFT_FROM ? n : n + SHIFT));
    const bad = got.filter(n => !/^\s*\/\*/.test(lines[n - 1] || ''));
    console.log((bad.length ? '❌' : '  ') + ' | ' + got.join(' / ') + ' | ' + name + ' |   （原 ' + noCol + '）');
    got.forEach(n => console.log('        ' + n + ' ← ' + flat(bannerBlock(n))));
    if (bad.length) console.log('        ⚠ 这几行**不是横幅**，要人看一眼：' + bad.join(' / '));
}
