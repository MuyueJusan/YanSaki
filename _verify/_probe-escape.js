// 探针：把 `stCode*Html` / `stCodeHighlight` 这些**构建 HTML 字符串**的函数体抠出来，
// 找里面的「裸插值」—— 直接把变量拼进字符串、**没走 escapeHtml** 的地方。
//
// 目的只有一个：先量出**有多少条**。数量少 → 可以做「显式白名单」闸门；
// 数量多 → 说明这个判据太粗，做了就是「永远在报的检查」，不如不做。
// （这个问题已经答完了：白名单现在就活在 `check.js` 的 `ESCAPE_ALLOW` 里。这个探针留着
//   是为了**重新量** —— 想再收窄 / 放宽判据时，先看看会多出多少条再决定。）
//
// ⚠ 直接读 `saki.html` 并当场抽内联 `<script>`（规则和 `check.js` 第 22~28 行同一套），
//   **不读生成物 `blk0.js`** —— 那份东西一过期，这里量出来的数就是错的，而且错得看不出来
//   （数字照样打印，只是对着旧代码）。生成物已于 2026-09-20 从目录里清掉。
const fs = require('fs');
const page = fs.readFileSync('G:/saki/saki.html', 'utf8');
const RE_SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let src = '', sm;
while ((sm = RE_SCRIPT.exec(page))) {
    if (/\bsrc\s*=/.test(sm[1] || '')) continue;   // 外链脚本不算
    if (sm[2].length > src.length) src = sm[2];
}
if (!src) { console.log('❌ 没抽到内联 <script> —— saki.html 的结构变了？'); process.exit(1); }

// 用大括号配对抠函数体（字符串 / 注释 / 模板串要跳过）
function bodyOf(src, startIdx) {
    let i = src.indexOf('{', startIdx);
    if (i < 0) return '';
    let d = 0, n = src.length;
    for (let j = i; j < n; j++) {
        const c = src[j];
        if (c === '"' || c === "'" || c === '`') {
            const q = c; j++;
            while (j < n && src[j] !== q) { if (src[j] === '\\') j++; j++; }
            continue;
        }
        if (c === '/' && src[j + 1] === '/') { while (j < n && src[j] !== '\n') j++; continue; }
        if (c === '/' && src[j + 1] === '*') { j = src.indexOf('*/', j) + 1; continue; }
        if (c === '{') d++;
        else if (c === '}') { d--; if (d === 0) return src.slice(i + 1, j); }
    }
    return '';
}

const RE_FN = /function (stCode[A-Za-z]*Html|stCodeHighlight)\s*\(/g;
let m, found = 0, total = 0;
const report = [];

while ((m = RE_FN.exec(src)) !== null) {
    const name = m[1];
    const body = bodyOf(src, m.index);
    found++;
    // 把已经安全的片段先「抹白」：escapeHtml(...) / stCodeJsonText(...) 的调用
    const safe = body
        .replace(/escapeHtml\([^()]*(?:\([^()]*\)[^()]*)*\)/g, '@SAFE@')
        .replace(/stCodeJsonText\([^()]*(?:\([^()]*\)[^()]*)*\)/g, '@SAFE@');
    // 裸插值候选：`+ 变量` 或 `+ a.b` 或 `+ a[i]`
    const re = /\+\s*([A-Za-z_$][\w$]*(?:\.[\w$]+|\[[^\]]*\])*)\s*(?=[+,)])/g;
    let mm; const hits = [];
    while ((mm = re.exec(safe)) !== null) hits.push(mm[1]);
    total += hits.length;
    if (hits.length) report.push('  ' + name.padEnd(22) + hits.length + ' 条: ' + hits.join(', '));
}

console.log('构建函数 ' + found + ' 个，裸插值候选 ' + total + ' 条');
console.log(report.join('\n'));
