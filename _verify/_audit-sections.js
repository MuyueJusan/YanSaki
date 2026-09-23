// _audit-sections.js —— **只读**。扫 `markdown/` 里的「节号」，抓**撞号**（同一文件、同一层里两节同号）。
//
// 用法：
//   node _audit-sections.js                 # 扫全部 .md
//   node _audit-sections.js RULES.md        # 只看一个（可给多个）
//   node _audit-sections.js --quiet         # 只打有问题的
//
// 退出码：0 = 没有撞号；1 = 有撞号。
//
// ⚠ 为什么要有这个：`04-card-editor.md` 真的撞过号（两节都叫「二十」），而**肉眼扫标题基本发现不了** ——
//   它要的是「同一份文件里逐条比对」，正是机器该干的活。MEMORY.md 里那句「节号也会撞号，
//   `grep "^## "` 加 `sort | uniq -d` 才扫得出」就是这个意思，这里把它固化下来。
//
// ⚠⚠ 这个项目里的「节号」有**四种写法**，解析必须都认（实测枚举，不是猜的）：
//     ① 中文数字 + 、   `## 一、时钟卡片` … `## 二十一、测试`
//     ② 阿拉伯数字 + .  `## 1. 文件结构`
//     ③ 带圈数字 + 空格 `## ⑧ 验证习惯`
//     ④ `X之Y` 子节     `### 六之十九` / `### 一之补二` / `### 三之补三`
//   ⚠ 还有一种是**区间**：MEMORY.md 的 `## ②–⑦ 编写器 / AI / …` —— **区间不是节号**，
//     当成节号会立刻产生一个假撞号。所以解析到数字 token 后，**紧跟 `–—~-` 或「至」就丢弃**。
//
// ⚠ 硬判据只抓「撞号」。**「跳号 / 顺序异常」只打软提示，不计入失败、不影响退出码** ——
//   顺序异常可能是**故意的**：MEMORY.md 就把 ⑧ 排在最前（因为它按「被截断丢尾部」的重要性排序）。

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'markdown');

const CN = { 〇: 0, 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_UNIT = { 十: 10, 百: 100 };

// 「一」→1、「十」→10、「十一」→11、「二十」→20、「二十三」→23、「一百」→100
function cn2num(s) {
    if (!s) return null;
    let total = 0, section = 0, ok = false;
    for (const ch of s) {
        if (ch in CN) { section = CN[ch]; ok = true; }
        else if (ch in CN_UNIT) {
            const u = CN_UNIT[ch];
            total += (section === 0 ? 1 : section) * u;
            section = 0; ok = true;
        } else return null;
    }
    if (!ok) return null;
    return total + section;
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
const cir2num = ch => { const i = CIRCLED.indexOf(ch); return i < 0 ? null : i + 1; };

// 区间尾巴：`②–⑦` 里的 `–`；也认 `~` `-` `—` 和「至」
const RANGE_TAIL = /^[\s]*[–—~\-至]/;

// 从标题文本里抠出「节号」。返回 {raw, num, scheme} 或 null（= 这节本来就没编号）
function sectionOf(title) {
    // ① 中文数字 + 、
    let m = title.match(/^([〇零一二三四五六七八九十百两]+)、/);
    if (m) return { raw: m[1], num: cn2num(m[1]), scheme: 'cn' };

    // ② 阿拉伯数字 + .
    m = title.match(/^(\d+)\.\s/);
    if (m) return { raw: m[1], num: Number(m[1]), scheme: 'ar' };

    // ③ 带圈数字 + 空格（或紧跟中文）
    m = title.match(/^([①-⑳])/);
    if (m) {
        if (RANGE_TAIL.test(title.slice(m[0].length))) return null;   // `②–⑦` ⇒ 区间，不是节号
        return { raw: m[0], num: cir2num(m[0]), scheme: 'cir' };
    }

    // ④ `X之Y`（Y 可以是中文数字、「补」、「补二」、「补三」）
    m = title.match(/^([〇零一二三四五六七八九十百]+)之(补[〇零一二三四五六七八九十百]*|[〇零一二三四五六七八九十百]+|\d+)/);
    if (m) {
        const whole = m[0];
        return { raw: whole, num: null, scheme: 'zhi', sortKey: cn2num(m[1]) * 1000 + (cn2num(m[2]) || 0) };
    }
    return null;
}

function scanFile(file) {
    const lines = fs.readFileSync(path.join(DIR, file), 'utf8').split(/\r?\n/);
    const hits = [];   // { level, line, title, sec, parentLine }
    const stack = [];  // 标题栈：{ level, line }
    lines.forEach((ln, i) => {
        const m = ln.match(/^(#{2,3})\s+(.*)$/);
        if (!m) return;
        const level = m[1].length;
        const title = m[2].trim();
        while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
        const parent = stack.length ? stack[stack.length - 1] : null;
        const sec = sectionOf(title);
        if (sec) {
            hits.push({
                level: level, line: i + 1, title: title, sec: sec,
                parentLine: parent ? parent.line : 0
            });
        }
        // ⚠ 每一个标题都要进栈（哪怕它自己没编号）—— 没编号的 `##` 照样是别人的父节
        stack.push({ level: level, line: i + 1 });
    });
    return hits;
}

// ---------- 主流程 ----------
const argv = process.argv.slice(2);
const quiet = argv.includes('--quiet');
const wanted = argv.filter(a => !a.startsWith('--'));

let files = fs.readdirSync(DIR).filter(f => f.endsWith('.md')).sort();
if (wanted.length) files = files.filter(f => wanted.includes(f));

let dupTotal = 0, softTotal = 0;

for (const file of files) {
    const hits = scanFile(file);
    if (!hits.length) {
        if (!quiet) console.log('\n' + file + '  —— 没有编号节（按内容命名，跳过）');
        continue;
    }

    // ⚠⚠ 撞号的范围是「**同一个父节内**」，不是「同一个文件内」！
    //   实测踩过：日报 / CHANGELOG 里每个 `## 第 N 段` 各自有 `### ①…⑧`，
    //   那是**每段内部的局部编号**，跨段重复完全正常。按「同文件同层」去比会一次报出
    //   24 个假撞号（CHANGELOG 一个文件就 27 处）—— **判据范围定错 = 造一堆假红**。
    const key = h => h.parentLine + '|' + h.level + '|' + h.sec.scheme + '|' + h.sec.raw;
    const groups = new Map();
    for (const h of hits) {
        if (!groups.has(key(h))) groups.set(key(h), []);
        groups.get(key(h)).push(h);
    }
    const dups = [...groups.values()].filter(g => g.length > 1);

    // 软提示：同一父节、同一层、同一 scheme 的序列，跳号与倒序
    const soft = [];
    const seqGroups = new Map();
    for (const h of hits) {
        if (typeof h.sec.num !== 'number') continue;
        const k = h.parentLine + '|' + h.level + '|' + h.sec.scheme;
        if (!seqGroups.has(k)) seqGroups.set(k, []);
        seqGroups.get(k).push(h);
    }
    for (const [k, g] of seqGroups) {
        if (g.length < 3) continue;
        const label = 'H' + g[0].level + ' ' + g[0].sec.scheme +
            (g[0].parentLine ? '（父节在第 ' + g[0].parentLine + ' 行）' : '');
        const seq = g.map(h => h.sec.num);
        const uniq = [...new Set(seq)].sort((a, b) => a - b);
        const missing = [];
        for (let n = uniq[0]; n <= uniq[uniq.length - 1]; n++) if (!uniq.includes(n)) missing.push(n);
        if (missing.length) soft.push(label + '：缺 ' + missing.join('、'));
        let inv = 0;
        for (let i = 1; i < seq.length; i++) if (seq[i] < seq[i - 1]) inv++;
        if (inv) soft.push(label + '：出现 ' + inv + ' 处倒序（⚠ 可能是**故意**的，如 MEMORY.md 把 ⑧ 排最前）');
    }

    const bad = dups.length || soft.length;
    if (quiet && !bad) continue;

    console.log('\n=== ' + file + ' ===  ' + hits.length + ' 个编号节');
    if (!dups.length) console.log('  ✅ 无撞号');
    for (const g of dups) {
        dupTotal++;
        console.log('  ❌ 撞号 [' + 'H' + g[0].level + ' / ' + g[0].sec.scheme + ' / ' + g[0].sec.raw + ']' +
            ' 共 ' + g.length + ' 处（同一父节：第 ' + g[0].parentLine + ' 行）');
        g.forEach(h => console.log('       第 ' + h.line + ' 行  ' + h.title.slice(0, 72)));
    }
    for (const s of soft) { softTotal++; console.log('  ⚠ ' + s); }
}

console.log('\n== 汇总 ==');
console.log('  扫了 ' + files.length + ' 个文件');
console.log('  撞号：' + dupTotal + (dupTotal ? '  ❌' : '  ✅'));
console.log('  软提示：' + softTotal + '（跳号 / 倒序，**不计入失败**）');
process.exit(dupTotal ? 1 : 0);
