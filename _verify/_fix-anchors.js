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
// ⚠⚠ 上面那套「单调对齐 + 共享字」的启发式**实测会错**（第十七轮就错了 2 行：
//   「系统提示词预设」被对到 1047、「条目本轮会不会插入」被对到 1438）。
//   ⇒ 改用**可验证的位移**：逐行核「旧值 + 位移 那一行是不是横幅」，并打横幅原文。
//     任何一行对不上就报出来 —— 那才是需要人看的地方。
//
// ⚠⚠ 位移**可以有多段** —— 一轮里插了两处 CSS 就是两段。第十八轮实测：
//   旧 138 起 +13、旧 220 起再 +27（累计 27）。写法：
//       node _fix-anchors.js 138:13,220:27
//   每段是 `<旧行号起>:<到这一段为止的累计增量>`，按旧行号升序，增量必须递增。
//   ⚠ 那个「旧行号起」= 插入块在**去掉本轮插入之后**的行号。怎么算：
//     在新文件里找到插入块的第一行 P、数出块长 C ⇒ 该块插在「旧行号 P - 之前各段累计」之前。
//     ⚠ 别拿新行号当旧行号用（差着前面各段的累计量）。
//   不传参数就退回第十七轮那次单段 `113:194`。
const SEGS = (process.argv[2] || '113:194').split(',').map(s => {
    const [from, delta] = s.split(':').map(Number);
    return { from: from, delta: delta };
}).sort((a, b) => a.from - b.from);
for (let i = 0; i < SEGS.length; i++) {
    if (!isFinite(SEGS[i].from) || !isFinite(SEGS[i].delta)) {
        console.log('⚠ 位移写法不对，应形如 138:13,220:27'); process.exit(1);
    }
    if (i && SEGS[i].delta <= SEGS[i - 1].delta) {
        console.log('⚠ 增量必须严格递增（后面那段是**累计**值）'); process.exit(1);
    }
}
const shiftOf = n => { let d = 0; for (const s of SEGS) { if (n >= s.from) d = s.delta; } return d; };
console.log('\n== §3 · CSS 分区（分段位移：' +
    SEGS.map(s => '旧 ' + s.from + ' 起 +' + s.delta).join('，') + '）==');
for (const [noCol, name] of rows(section('## 3. CSS 分区'))) {
    const nums = (noCol.match(/\d+/g) || []).map(Number);
    if (!nums.length) continue;
    const got = nums.map(n => n + shiftOf(n));
    const bad = got.filter(n => !/^\s*\/\*/.test(lines[n - 1] || ''));
    console.log((bad.length ? '❌' : '  ') + ' | ' + got.join(' / ') + ' | ' + name + ' |   （原 ' + noCol + '）');
    got.forEach(n => console.log('        ' + n + ' ← ' + flat(bannerBlock(n))));
    if (bad.length) console.log('        ⚠ 这几行**不是横幅**，要人看一眼：' + bad.join(' / '));
}
