// 一次性拆分器：把 saki.html 切成 src/ 下的功能模块 + manifest.json
//
// ⚠ 这个脚本只用一次（或者将来要「重新从单文件切一次」时用）。
//   切完之后 src/ 才是真相源，日常改代码只改 src/ 然后跑 build.js。
//
// 判据：拆完立刻按 manifest 拼回去，sha1 必须等于原文件 —— 不等就当场报错、不写盘。
//
// 用法：node _verify/_split-once.js [--go]
//   不带 --go 只打印计划；带 --go 才真的写 src/。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

const ROOT = 'G:/saki';
const SRC = path.join(ROOT, 'src');
const GO = process.argv.includes('--go');

const raw = fs.readFileSync(path.join(ROOT, 'saki.html'));
const ORIG_SHA = crypto.createHash('sha1').update(raw).digest('hex');
const ORIG_BYTES = raw.length;
const L = raw.toString('utf8').split(/\r?\n/);   // L[n-1] = 第 n 行

// ---------- 位置常量（这份单文件的结构） ----------
const HEAD_END = 11;          // 1..11  doctype / meta / link
const STYLE_OPEN = 12;        //     <style>
const STYLE_CLOSE = 6009;     //     </style>
const BODY_FIRST = 6010;      //     </head> <body> … （到 6671，含 <script> 开标签）
const SCRIPT_OPEN = 6671;     //     <script>
const BODY_LAST = SCRIPT_OPEN;
const SCRIPT_FIRST = 6672;
const SCRIPT_LAST = 33474;    //     最后一条 JS 语句
const SCRIPT_CLOSE = 33475;   //     </script>
const TAIL_FIRST = SCRIPT_CLOSE;  // </script> </body> </html>

// ---------- 注释 / 标题 ----------
// ⚠ CSS 里有多行盒子注释：
//       /* ==========================================
//          👕 角色卡编写器
//          ========================================== */
//   第 2 行不以 `//` `/*` `*` 开头，光看行首会把它当代码 ⇒ 块被切成 1 行、标题取空。
//   所以额外记一份「这一行是从块注释里开始的」，只在 CSS 区间算（JS 的模板串里
//   出现 `/*` 会让状态机误判，那边横幅全是 `//`，用不上）。
const inBlockCss = new Set();
const isComment = (t) => /^\s*(\/\/|\/\*|\*)/.test(t) && t.trim() !== '';
function commentAt(n) {
    return isComment(L[n - 1]) || inBlockCss.has(n);
}

function blockStart(n, lo) {
    let s = n, g = 0;
    while (s > lo && g++ < 40 && commentAt(s - 1)) s--;
    return s;
}
function blockEnd(n, hi) {
    // ⚠ 从 n+1 起算：n 这一行自己一定属于本块，否则单行注释块的循环会一行都取不到
    let e = n + 1, g = 0;
    while (e <= hi && g++ < 40 && commentAt(e)) e++;
    return e;   // 不含
}
const BORDER = /^[=\-*\/\s]*$/;
function titleOf(n, lo, hi) {
    const a = blockStart(n, lo), b = blockEnd(n, hi);
    for (let k = a; k < b; k++) {
        let t = (L[k - 1] || '').trim();
        t = t.replace(/^\/\*+/, '').replace(/\*\/$/, '').replace(/^\/+/, '').trim();
        // 去掉 `=====` / `-----` 这类装饰（`——` 是 U+2014，不是 ASCII 短横，留着）
        t = t.replace(/^[=\-*\/\s]+/, '').replace(/[=\-*\/\s]+$/, '').trim();
        if (!t) continue;
        return t.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
    }
    return '';
}

// ---------- JS 切点 ----------
// 合法边界 = 把 <script> 开头到这一行**之前**的所有行拼起来，V8 能编译通过。
// 能编译 ⇔ 那里花括号深度为 0 ⇔ 是个顶层语句边界。
// ⚠ 用 V8 自己的解析器当判据，而不是手写花括号计数器：字符串 / 模板串 / 正则 /
//   注释全由它处理。手写的那种在 `ST_SHOOTER_SRC` 那段（一个几千行的模板串，
//   里面塞着整份 HTML）上必错。
// ⚠ 这一段要 ~50 s，只在拆分时跑一次。
const depthOk = new Set();
{
    const cands = [];
    for (let n = SCRIPT_FIRST + 1; n <= SCRIPT_LAST; n++) {
        if (/^ {0,8}(\/\/|\/\*)/.test(L[n - 1])) cands.push(n);
    }
    process.stdout.write('判定顶层边界（' + cands.length + ' 个候选，约 50 s）…');
    const t0 = Date.now();
    for (const n of cands) {
        try { new vm.Script(L.slice(SCRIPT_FIRST - 1, n - 1).join('\n'), { filename: 'prefix' }); depthOk.add(n); }
        catch (e) { /* 不是边界 */ }
    }
    console.log(' 边界 ' + depthOk.size + ' 个，用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
}

const bannerLines = [...depthOk].filter(n => {
    if (n < SCRIPT_FIRST || n > SCRIPT_LAST) return false;
    const t = L[n - 1];
    return /^ {0,8}\/\//.test(t) && (/=====/.test(t) || /^ {0,8}\/\/ —— /.test(t) || /^ {0,8}\/\/ ----/.test(t));
});

// 切点候选：注释块开头（boxed banner 要从上边框切，不能从下边框切）
let cand = new Set();
for (const n of bannerLines) cand.add(blockStart(n, SCRIPT_FIRST));
cand.add(31114);              // BEGIN ST_SHOOTER_SRC
cand = [...cand].filter(n => n > SCRIPT_FIRST && n <= SCRIPT_LAST - 5).sort((a, b) => a - b);

// 太小的块并进下一块
const MINLEN = 25;
let pts = [SCRIPT_FIRST];
for (const c of cand) if (c - pts[pts.length - 1] >= MINLEN) pts.push(c);

// 太大的块从内部补切（挑「注释 + 紧邻顶层声明」的合法边界）
const MAXLEN = 620;
function startsThing(n) {
    for (let k = n; k < Math.min(n + 6, SCRIPT_LAST); k++) {
        const t = L[k];
        if (/^\s*(\/\/|\/\*|\*)/.test(t)) continue;
        if (t.trim() === '') continue;
        return /^ {0,8}(function |const |let |var |class |window\.|document\.|async function )/.test(t);
    }
    return false;
}
function fill(a, b, d, okList, starts) {
    if (b - a <= MAXLEN || d > 4) return [];
    const inner = okList.filter(n => n > a + 60 && n < b - 40 && starts(n));
    if (!inner.length) return [];
    const mid = (a + b) / 2;
    inner.sort((x, y) => Math.abs(x - mid) - Math.abs(y - mid));
    const p = inner[0];
    return [...fill(a, p, d + 1, okList, starts), p, ...fill(p, b, d + 1, okList, starts)];
}
const jsOkList = [...depthOk].filter(n => n > SCRIPT_FIRST && n < SCRIPT_LAST).sort((a, b) => a - b);
let filled = [];
for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = i + 1 < pts.length ? pts[i + 1] : SCRIPT_LAST + 1;
    filled.push(a, ...fill(a, b, 0, jsOkList, startsThing));
}
pts = [...new Set(filled)].sort((a, b) => a - b);

const jsMods = [];
for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = i + 1 < pts.length ? pts[i + 1] : SCRIPT_LAST + 1;
    jsMods.push({ from: a, to: b - 1, title: titleOf(a, SCRIPT_FIRST, SCRIPT_LAST) });
}

// ---------- CSS 切点 ----------
// 判据：花括号深度 0 且在注释行（CSS 没有语句，深度 0 就是「规则与规则之间」）
const cssDepth = new Map();
{
    let depth = 0, inC = false;
    for (let n = STYLE_OPEN + 1; n <= STYLE_CLOSE - 1; n++) {
        cssDepth.set(n, depth);
        if (inC) inBlockCss.add(n);   // 这一行是从块注释里开始的
        const s = L[n - 1];
        for (let i = 0; i < s.length; i++) {
            const c = s[i], c2 = s[i + 1];
            if (inC) { if (c === '*' && c2 === '/') { inC = false; i++; } continue; }
            if (c === '/' && c2 === '*') { inC = true; i++; continue; }
            if (c === '"' || c === "'") { const q = c; i++; while (i < s.length && s[i] !== q) { if (s[i] === '\\') i++; i++; } continue; }
            if (c === '{') depth++; else if (c === '}') depth--;
        }
    }
    if (depth !== 0) throw new Error('CSS 深度收尾不是 0：' + depth);
}
const cssCommentCuts = [];
for (let n = STYLE_OPEN + 1; n <= STYLE_CLOSE - 1; n++) {
    if (cssDepth.get(n) !== 0) continue;
    if (/^ {0,8}\/\*/.test(L[n - 1])) cssCommentCuts.push(n);
}
// 优先用 /* ===== 横幅当切点，再给大块补切
let cssPts = [STYLE_OPEN];
const cssBanners = cssCommentCuts.filter(n => /^ {0,8}\/\* =====/.test(L[n - 1]));
for (const c of cssBanners) if (c - cssPts[cssPts.length - 1] >= MINLEN) cssPts.push(c);
{
    const a = STYLE_CLOSE;   // 兜底：确保最后一块到 </style> 之前
    void a;
}
let cssFilled = [];
// CSS 的「下面紧接着是一条规则」判据：下一个非注释行是选择器 / at-rule 开头
function startsCss(n) {
    for (let k = n; k < n + 6 && k <= STYLE_CLOSE; k++) {
        if (commentAt(k)) continue;
        const t = L[k - 1];
        if (t.trim() === '') continue;
        return /^\s*[.#\[@a-zA-Z:*&>]/.test(t);
    }
    return false;
}
for (let i = 0; i < cssPts.length; i++) {
    const a = cssPts[i], b = i + 1 < cssPts.length ? cssPts[i + 1] : STYLE_CLOSE + 1;
    cssFilled.push(a, ...fill(a, b, 0, cssCommentCuts, startsCss));
}
cssPts = [...new Set(cssFilled)].sort((a, b) => a - b);

const cssMods = [];
for (let i = 0; i < cssPts.length; i++) {
    const a = cssPts[i], b = i + 1 < cssPts.length ? cssPts[i + 1] : STYLE_CLOSE + 1;
    cssMods.push({ from: a, to: b - 1, title: titleOf(a, STYLE_OPEN, STYLE_CLOSE) });
}

// ---------- 拼模块清单 ----------
function slug(t) {
    let s = String(t || '')
        .replace(/[\u0000-\u001f]/g, '')
        // ⚠ emoji 不进文件名：终端 / 某些工具在非 UTF-8 代码页下会把它变成乱码路径。
        //   标题（manifest / INDEX.md）里保留原样。
        .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/gu, '')
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/[「」『』【】（）()《》〈〉\[\]{}、，。：；！？·—…～"'"'`]/g, '-')
        .replace(/\s+/g, '-')
        .replace(/[*=]/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^[-.]+|[-.]+$/g, '')
        .slice(0, 38)
        .replace(/[-.]+$/, '');
    return s || 'section';
}

const mods = [];
const usedNames = new Set();
// 少数模块的自动标题取不到（比如第一块 CSS 一条注释都没有），
// 或者取到了句中散文 / 跟隔壁重名 —— 这些按块里真实有的符号手工定名。
const TITLE_FIX = new Map([
    [12, '基础变量 · 像素字体 · 顶部控制栏 · 时钟 / 日历骨架'],
    [6672, '时钟 / 时区 / 日历 / 复古模式'],
    [8793, '系统提示词预设 · 面板与切换'],
    [9134, '粗略 token 估算'],
    [9822, 'MVU 状态栏 · 外观数据模型'],
    [10845, 'MVU 状态栏 · 块模型 / 取值 / class 保留'],
    [15115, '作者注释 · 插入位置与深度'],
    [21549, 'Code 页 · 工具实现（读写 / 白名单）'],
    [22227, 'Code 页 · system 提示词 / 网络 / 停止'],
    [22759, 'skill 清单与触发器列举'],
    [24165, '编写器 · 首页（home）选项卡'],
    [25154, '人设生成器 · 写入 / 各选项卡'],
    [27773, '状态栏编辑器 · 面板渲染'],
    [28150, '状态栏编辑器 · 检查器 / 预览 / 清颜色'],
    [30031, '导出 · 消息 / 文本 / JSON / PNG'],
    [31114, '内嵌小游戏 ST_SHOOTER_SRC（自动生成 · 别手改）'],
]);
function add(dir, num, title, from, to) {
    if (TITLE_FIX.has(from)) title = TITLE_FIX.get(from);
    let base = slug(title);
    let name = base;
    let k = 2;
    while (usedNames.has(dir + '/' + name)) name = base + '-' + (k++);
    usedNames.add(dir + '/' + name);
    const ext = dir === 'js' ? '.js' : (dir === 'style' ? '.css' : '.html');
    const file = (dir ? dir + '/' : '') + String(num).padStart(3, '0') + '-' + name + ext;
    mods.push({ file, title, from, to });
}

add('', 0, 'HTML 头 · doctype / meta / 字体', 1, HEAD_END);
cssMods.forEach((m, i) => add('style', 10 + i, m.title, m.from, m.to));
add('', 100, 'BODY · 页面骨架与静态标记（含 script 开标签）', BODY_FIRST, BODY_LAST);
jsMods.forEach((m, i) => add('js', 200 + i, m.title, m.from, m.to));
add('', 900, 'HTML 尾 · script 闭标签 / body / html', TAIL_FIRST, L.length);

// ---------- 往返校验（内存里先做一遍） ----------
const pieces = mods.map(m => L.slice(m.from - 1, m.to).join('\n') + '\n');
pieces[pieces.length - 1] = pieces[pieces.length - 1].replace(/\n$/, '');   // 原文件末行无换行
const rebuilt = Buffer.from(pieces.join('').replace(/\r?\n/g, '\r\n'), 'utf8');
const newSha = crypto.createHash('sha1').update(rebuilt).digest('hex');

console.log('原文件  ' + ORIG_BYTES + ' B  ' + ORIG_SHA);
console.log('拼回来  ' + rebuilt.length + ' B  ' + newSha);
console.log('模块    ' + mods.length + ' 个（CSS ' + cssMods.length + ' / JS ' + jsMods.length + '）');
if (rebuilt.length !== ORIG_BYTES || newSha !== ORIG_SHA) {
    console.log('❌ 往返不一致，不写盘');
    // 找出第一个不一致的字节，帮忙定位
    const a = raw, b = rebuilt;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
        if (a[i] !== b[i]) {
            console.log('   首个不同字节 @ ' + i + '：原 ' + a[i] + ' / 新 ' + b[i]);
            console.log('   原: ' + JSON.stringify(a.slice(Math.max(0, i - 40), i + 40).toString('utf8')));
            console.log('   新: ' + JSON.stringify(b.slice(Math.max(0, i - 40), i + 40).toString('utf8')));
            break;
        }
    }
    process.exit(1);
}
console.log('✅ 往返逐字节一致');

// ---------- 每个 JS 模块单独能不能编译 ----------
let badMod = 0;
for (const m of jsMods) {
    const code = L.slice(m.from - 1, m.to).join('\n');
    try { new vm.Script(code, { filename: m.title }); } catch (e) {
        badMod++;
        console.log('⚠ 模块不能独立编译 ' + m.from + '-' + m.to + ' 「' + m.title + '」：' + e.message.slice(0, 90));
    }
}
console.log(badMod === 0 ? '✅ ' + jsMods.length + ' 个 JS 模块全部可独立编译（= 都是完整语句序列）'
    : '❌ ' + badMod + ' 个模块不是完整语句序列');

console.log('\n=== 模块清单 ===');
mods.forEach(m => console.log(String(m.from).padStart(6) + '-' + String(m.to).padStart(6) +
    '  ' + String(m.to - m.from + 1).padStart(5) + ' 行  ' + m.file));

if (!GO) { console.log('\n（未带 --go，只打印计划）'); process.exit(0); }
if (badMod !== 0) { console.log('\n模块有问题，不写盘'); process.exit(1); }

// ---------- 写盘 ----------
fs.rmSync(SRC, { recursive: true, force: true });
for (const m of mods) {
    const p = path.join(SRC, m.file);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const text = L.slice(m.from - 1, m.to).join('\n') + (m === mods[mods.length - 1] ? '' : '\n');
    fs.writeFileSync(p, text, 'utf8');
}
fs.writeFileSync(path.join(SRC, 'manifest.json'), JSON.stringify({
    note: 'src/ 的拼装顺序 = 这份数组的顺序。**顺序就是语义**：JS 顶层 const/let 不提升，' +
          '而且文件末尾有一段立即执行的启动代码，重排会直接坏。',
    baseline: { bytes: ORIG_BYTES, sha1: ORIG_SHA },
    modules: mods.map(m => ({ file: m.file, title: m.title })),
}, null, 2) + '\n', 'utf8');

console.log('\n已写 ' + mods.length + ' 个模块到 src/');
