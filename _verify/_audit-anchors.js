// _audit-anchors.js —— 核对 `markdown/README.md` 里那两张**行号表**还准不准。
// 一次性工具（`_` 前缀 ⇒ run-all 会跳过它）。**只读，不改任何文件。**
//
// 为什么要有它：行号会**静默漂** —— 往 `<head>` 里插一段 CSS，后面所有锚点整体后移，
// 而没有任何检查会报。2026-09-20 第十八 / 十九轮就是靠手 `grep` 一行行重取的，
// 而且实测**同一张表里两种位移**（+20 与 +41 并存）⇒ **靠加法算会算错**。
// ⇒ 按本项目的老规矩：**「约定」要尽量变成「闸门」**。
//
// 判据（**故意窄**，宽了就变成「永远在报的检查」，会被无视）：
//   §2 body 顶层锚点：`id="X"` 必须**就在**表里那个行号上（类名锚点退化成「body 区内第一处」）。
//   §3 CSS 分区：表里那个行号**必须是一条注释横幅的开头**（`/*`）。
//                漂一格通常就落在普通 CSS 行上 ⇒ 当场显形。
//                ⚠ **但它抓不到「漂到了另一个横幅上」** —— 那种情况下它照样是横幅、照样 ✅。
//                所以补一道**软提示**：区块名里的字跟横幅正文**共享不到 2 个** ⇒ 打 ⚠。
//                ⚠ 判据是「**共享字**」不是「整串包含」：表里的名字是**编者概括**，未必是横幅原文
//                  （实测栽过两次：「可折叠字段」vs 横幅「可折叠**的**字段（描述 / 性格…）」、
//                   「浮层复古皮肤」vs 横幅「复古皮肤：浮层也要跟着变成老终端配色」）。
//                ⚠ 软提示**不计入 `bad`**（中文名太自由，硬判会误报），也不影响退出码。
//                ⚠ 关键词必须**先去掉括号里的说明**：表里常写「（多行大横幅）」，
//                  那不是区块名，不去掉必然误报。
//                ⚠ 多行横幅的**第一行只有 `=====`**、名字在第二行 ⇒ 要取**整块**，不能只看第一行。
//                  只对**单行号**的行做（多行号那种一格对多个区块，名字用 `/` 分隔，对不上号）。
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const README = path.join(DIR, '..', 'markdown', 'README.md');
const PAGE = 'G:/saki/saki.html';

const md = fs.readFileSync(README, 'utf8').replace(/\r/g, '');
const src = fs.readFileSync(PAGE, 'utf8').replace(/\r/g, '');
const lines = src.split('\n');

let bad = 0;
const ok = (s) => console.log('  ✅ ' + s);
const no = (s) => { bad++; console.log('  ❌ ' + s); };

// 从 markdown 里切出一节（`## 标题` 到下一个 `## `）
function section(title) {
    const i = md.indexOf(title);
    if (i < 0) return '';
    const j = md.indexOf('\n## ', i + title.length);
    return md.slice(i, j < 0 ? md.length : j);
}
// 切出一节的表格行 → 每行拆成 `|` 的格子
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

// ── §2 body 顶层区块 ────────────────────────────────────────────
console.log('== README §2 · body 顶层锚点 ==');
const bodyRows = rows(section('## 2. body 顶层区块'));
if (!bodyRows.length) no('没解析到 §2 的表格行（表头或标题变了？）');
for (const [noCol, name, ids] of bodyRows) {
    const nums = (noCol.match(/\d+/g) || []).map(Number);
    // 第三个格里的第一个反引号记号：`#id` 或 `.class`
    const toks = [...ids.matchAll(/`([#.][\w-]+)`/g)].map(m => m[1]);
    if (!toks.length || !nums.length) { no(noCol + ' ' + name + '  ← 这一行没解析出锚点'); continue; }
    let allOk = true, detail = [];
    toks.forEach((tok, k) => {
        const want = nums[Math.min(k, nums.length - 1)];
        const isId = tok[0] === '#';
        const nm = tok.slice(1);
        const found = isId
            ? firstLineWith(new RegExp('id="' + nm + '"'))
            : firstLineWith(new RegExp('class="[^"]*\\b' + nm + '\\b'), BODY_START - 1);
        if (found !== want) {
            allOk = false;
            detail.push(tok + ' 表里写 ' + want + '、实际 ' + (found < 0 ? '找不到' : found));
        }
    });
    if (allOk) ok(String(nums[0]).padEnd(5) + ' ' + name);
    else no(String(nums[0]).padEnd(5) + ' ' + name + '   →  ' + detail.join(' / '));
}

// ── §3 CSS 分区 ────────────────────────────────────────────────
console.log('\n== README §3 · CSS 分区 ==');
const cssRows = rows(section('## 3. CSS 分区'));
if (!cssRows.length) no('没解析到 §3 的表格行（表头或标题变了？）');
// 所有横幅行号（`^\s*/*`），用来在漂了的时候报「最近的上一个横幅」
const banners = [];
lines.forEach((l, i) => { if (/^\s*\/\*/.test(l)) banners.push(i + 1); });
const nearestAbove = n => { let r = -1; for (const b of banners) { if (b <= n) r = b; else break; } return r; };
const bannerText = n => (lines[n - 1] || '').replace(/^\s*\/\*\s*/, '').replace(/\s*\*\/\s*$/, '').slice(0, 40);
// 软提示用：横幅**整块**正文（多行横幅的第一行只有 `=====`，名字在第二行 ⇒ 要往下收）
const bannerBlock = n => {
    const out = [];
    for (let i = n - 1; i < lines.length && i < n - 1 + 6; i++) {
        out.push(lines[i]);
        if (/\*\/\s*$/.test(lines[i])) break;
    }
    return out.join(' ');
};
// 软提示用：区块名里的中文字（**去重**）。
// ⚠ 先去掉 `**` / 反引号 / **括号里的说明** —— 表里常写「（多行大横幅）」，那不是区块名。
// ⚠ 判据是「**共享字 ≥ 2 个**」，不是「整串包含」—— 表里的名字是**编者概括**，未必是横幅原文。
//    实测两处误报都栽在这一点上：表里「可折叠字段」vs 横幅「可折叠**的**字段（描述 / 性格…）」、
//    表里「浮层复古皮肤」vs 横幅「复古皮肤：浮层也要跟着变成老终端配色」—— 整串都不是子串。
const zhChars = name => [...new Set((name
    .replace(/\*\*/g, '').replace(/`/g, '')
    .replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '')
    .match(/[\u4e00-\u9fa5]/g) || []))];
let soft = 0;

for (const [noCol, name] of cssRows) {
    const nums = (noCol.match(/\d+/g) || []).map(Number);
    if (!nums.length) continue;
    let allOk = true, detail = [];
    for (const n of nums) {
        const isBanner = /^\s*\/\*/.test(lines[n - 1] || '');
        if (!isBanner) {
            allOk = false;
            const above = nearestAbove(n);
            detail.push(n + ' 不是横幅；最近的**上一个**横幅在 ' + above + '（' + bannerText(above) + '…）');
        }
    }
    if (allOk) {
        ok(noCol.padEnd(18) + name);
        // 软提示：单行号的行，名字里的字应该跟横幅正文有交集（**共享 ≥ 2 个不同的字**）。
        // 抓的是**硬判据的盲区** —— 行号漂到了**另一个横幅**上（照样是横幅 ⇒ 硬判照样 ✅）。
        if (nums.length === 1) {
            const txt = bannerBlock(nums[0]);
            const cs = zhChars(name);
            const hit = cs.filter(c => txt.includes(c));
            // ⚠ 门槛要跟名字长度挂钩：名字里只剩 1 个中文字时（如 `Code（Agent）页` 去括号后只剩「页」），
            //   要求「共享 2 字」是**不可能满足**的 ⇒ 会变成永远在报的检查。用 min(2, 字数) 兜住。
            if (cs.length && hit.length < Math.min(2, cs.length)) {
                soft++;
                console.log('     ⚠ ' + nums[0] + ' 是横幅，但正文跟区块名只共享 '
                    + hit.length + ' 个字（名字里的字：' + cs.join('') + '）→ 可能漂到了**别的**横幅上');
            }
        }
    }
    else no(noCol.padEnd(18) + name + '   →  ' + detail.join(' / '));
}

// ── 汇总 ──────────────────────────────────────────────────────
console.log('\n' + (bad
    ? '❌ ' + bad + ' 行对不上 —— 表里那些行号该重取了（**重新 `grep`，别按加法推**）。'
    : '✅ 两张表的行号全部对得上。'));
if (soft) console.log('⚠ ' + soft + ' 行「是横幅、但正文跟区块名几乎不共享字」—— '
    + '**软提示，不计入失败、不影响退出码**，请人看一眼是不是漂到别的横幅上了。');
console.log('（只读工具：没有改任何文件。对不上就先 `grep` 取真值，再改 README。）');
process.exit(bad ? 1 : 0);
