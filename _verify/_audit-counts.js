// _audit-counts.js —— 把「N 个 <名词>」这类计数断言从全部文档里挖出来，按名词归组。
// 用法：node _audit-counts.js            —— 打印清单
//       node _audit-counts.js <名词>     —— 只看某个名词（如 选项卡 / 预设 / 字段）
//
// ⚠ 为什么要有这个：文档里的「共 N 个」会静默漂，而**静态检查看不见事实**。
// ⚠ 上一轮的正则只扫到 README —— 因为它要求数字后面紧跟「个」，
//   而分册里大量写法是「14 个选项卡」（数字与「个」之间有空格？不，是有空格）之类，
//   真正被漏掉的是「N 个」后面**紧跟中文名词且没有边界**的情形。
//   所以这里**不再加任何边界断言**，先全量挖出来再人工筛 —— 宁可多挖。
//
// 输出：按「名词」分组，每组列出出现过的数字集合 + 出处（文件:行号），
//       同一名词出现**多个不同数字**时打 ⚠（那多半就是漂了的那处）。

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'markdown');
const ALL = ['README.md', '01-clock-calendar.md', '02-ai-chat.md', '03-tavern.md',
             '04-card-editor.md', '05-games.md', '06-fonts-theme.md', 'CHANGELOG.md'];
// ⚠ CHANGELOG 是**历史文本**（「当时是 12 个」也是正确的），拿它当当前断言会淹掉信号。
// 默认排除；要连它一起扫就加 `--with-changelog`。
const FILES = process.argv.includes('--with-changelog')
    ? ALL
    : ALL.filter(f => f !== 'CHANGELOG.md');

const only = process.argv.slice(2).find(a => !a.startsWith('--')) || null;

// 数字 + 量词 + 名词（名词 1~8 个汉字/字母，允许中间有 ` 包起来的标识符）
const RE = /(\d{1,4})\s*(个|条|种|处|项|张|层|份|款|套|列|块|位|组|类|步|档|道)\s*([\u4e00-\u9fa5A-Za-z`_]{1,10})/g;

const groups = new Map();   // 名词 -> Map(数字 -> [出处])
const unitOf = new Map();   // 名词 -> 量词集合

for (const f of FILES) {
    const p = path.join(DIR, f);
    if (!fs.existsSync(p)) { console.log('⚠ 缺文件', f); continue; }
    const lines = fs.readFileSync(p, 'utf8').split('\n');
    lines.forEach((line, i) => {
        // 跳过纯引用/代码块行里的噪声：整行以 ``` 开头的围栏标记
        if (/^\s*```/.test(line)) return;
        RE.lastIndex = 0;
        let m;
        while ((m = RE.exec(line)) !== null) {
            const num = +m[1], unit = m[2], noun = m[3];
            if (only && noun.indexOf(only) < 0) continue;
            if (!groups.has(noun)) { groups.set(noun, new Map()); unitOf.set(noun, new Set()); }
            const g = groups.get(noun);
            unitOf.get(noun).add(unit);
            if (!g.has(num)) g.set(num, []);
            g.get(num).push(f.replace(/\.md$/, '') + ':' + (i + 1));
        }
    });
}

// 只关心「同一名词出现过 ≥2 个不同数字」的（单一数字的没法判对错，但仍然打印出来供人工核）
const rows = [...groups.entries()]
    .map(([noun, g]) => ({ noun, nums: [...g.keys()].sort((a, b) => a - b), g }))
    .sort((a, b) => (b.nums.length - a.nums.length) || (b.g.size - a.g.size));

console.log('名词总数', rows.length);
console.log('');

let flagged = 0;
for (const r of rows) {
    const multi = r.nums.length > 1;
    if (multi) flagged++;
    const tag = multi ? '⚠' : ' ';
    const places = r.nums.map(n => n + '(' + r.g.get(n).length + ')').join(' ');
    console.log(tag, r.noun.padEnd(12, '　'), '单位[' + [...unitOf.get(r.noun)].join('') + ']', places);
}
console.log('');
console.log('⚠ 同一名词出现多个数字的：', flagged, '组（这些是「至少有一处是错的」候选）');
console.log('');
console.log('=== 明细（只列多数字组） ===');
for (const r of rows) {
    if (r.nums.length < 2) continue;
    console.log('');
    console.log('【' + r.noun + '】');
    for (const n of r.nums) {
        console.log('  ' + n + ' 个 → ' + r.g.get(n).slice(0, 12).join(' · ') +
                    (r.g.get(n).length > 12 ? ' …共' + r.g.get(n).length + '处' : ''));
    }
}
