#!/usr/bin/env node
/**
 * build.js —— 把 src/ 下的功能模块拼回一份完整的 saki.html
 *
 * 日常流程：
 *     改 src/ 里那一个文件  →  node build.js  →  刷新页面
 *
 * 为什么要有这个脚本：saki.html 原本是 170 万字节 / 3.3 万行的单文件，
 * 改任何一个功能都要在全文里 grep 定位。拆成 src/ 之后每个功能一个文件，
 * 构建时按 manifest.json 的顺序**纯拼接**（不做任何转换，除了 LF → CRLF）。
 *
 * ⚠ 三条规矩，违反会静默出错：
 *   1. **顺序就是语义**。manifest.json 的数组顺序 = 拼装顺序。JS 顶层的
 *      `const` / `let` 不提升，而且文件末尾有一段立即执行的启动代码
 *      （bindTouchButtonEvents() / stInit() …），重排会直接坏。
 *   2. **只改 src/，不要直接改 saki.html**。它是产物，下次构建会被覆盖。
 *      脚本会检查：如果 saki.html 的 sha1 跟上次构建记录的不一样，
 *      说明有人绕过 src/ 改了产物，这时**拒绝构建**并让你确认。
 *   3. **saki.html 是 CRLF**。src/ 里存的是 LF，构建时统一转 CRLF。
 *      别在 src/ 里手动塞 `\r`。
 *
 * 用法：
 *     node build.js                  正常构建（同时同步 index.html）
 *     node build.js --no-index       只写 saki.html
 *     node build.js --check          只校验「src/ 拼出来 == 磁盘上的 saki.html」
 *     node build.js --baseline       跟 manifest 里记的原始基线比（拆分时用的自检）
 *     node build.js --force          无视「产物被手改过」的拦截
 *     node build.js --where <关键字>  在所有模块里搜关键字，打印 文件:行号
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const MANIFEST = path.join(SRC, 'manifest.json');
const STAMP = path.join(SRC, '.build-stamp.json');
const OUT = path.join(ROOT, 'saki.html');
const OUT_INDEX = path.join(ROOT, 'index.html');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const whereArg = (() => {
    const i = argv.indexOf('--where');
    return i >= 0 ? argv[i + 1] : null;
})();

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
const kb = (n) => (n / 1024).toFixed(1) + ' KB';

// ---------- --where：按关键字找模块 ----------
if (whereArg) {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    let hits = 0;
    for (const m of manifest.modules) {
        const lines = fs.readFileSync(path.join(SRC, m.file), 'utf8').split('\n');
        lines.forEach((l, i) => {
            if (l.includes(whereArg)) {
                hits++;
                console.log(m.file + ':' + (i + 1) + ': ' + l.trim().slice(0, 120));
            }
        });
    }
    console.log('\n共 ' + hits + ' 处');
    process.exit(hits ? 0 : 1);
}

// ---------- 读 manifest ----------
function readManifest() {
    if (!fs.existsSync(MANIFEST)) throw new Error('找不到 ' + MANIFEST);
    const mf = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    if (!Array.isArray(mf.modules) || !mf.modules.length) throw new Error('manifest.json 里没有 modules');
    return mf;
}

// ---------- 拼 ----------
// ⚠ 每个模块文件都按「行」读：以 \n 切开，**末尾那个空元素要丢掉**（那是行终止符
//   的副产物，不是一行空行）。这样「模块最后一行正好是空行」也能保住 ——
//   直接 trim 掉尾部换行会把它吃掉，而那个空行在原文里是真实存在的。
//
// ⚠ 这个函数被 `_verify/check.js` 直接 require 去当「产物是否跟 src/ 同步」的判据。
//   **别在别处再抄一份拼装逻辑** —— 抄一份就一定会分叉，而分叉之后
//   「构建出来的」和「检查认为该构建出来的」会各说各话。
function assemble() {
    const manifest = readManifest();
    const allLines = [];
    const stat = [];
    for (const m of manifest.modules) {
        const p = path.join(SRC, m.file);
        if (!fs.existsSync(p)) throw new Error('manifest 里列了但文件不存在：' + m.file);
        const text = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
        if (text.includes('\r')) throw new Error(m.file + ' 里有裸 \\r（src/ 必须是纯 LF）');
        const lines = text.split('\n');
        if (lines.length && lines[lines.length - 1] === '') lines.pop();
        allLines.push(...lines);
        stat.push({ file: m.file, title: m.title, lines: lines.length });
    }
    const buf = Buffer.from(allLines.join('\n').replace(/\n/g, '\r\n'), 'utf8');
    return { manifest, buf, stat, lineCount: allLines.length };
}

module.exports = { assemble };

// 被 require 时不执行下面的构建流程
if (require.main !== module) return;

const { manifest, buf: out, stat, lineCount } = assemble();
const outSha = sha1(out);

console.log('模块 ' + manifest.modules.length + ' 个  →  ' + lineCount + ' 行 / ' + out.length + ' B');
console.log('sha1 ' + outSha);

// ---------- --baseline：跟拆分时的原始基线比 ----------
if (has('--baseline')) {
    const b = manifest.baseline || {};
    const ok = b.bytes === out.length && b.sha1 === outSha;
    console.log(ok
        ? '✅ 与原始基线逐字节一致（' + b.bytes + ' B）'
        : '⚠ 与原始基线不同：基线 ' + b.bytes + ' B / ' + b.sha1 + '（改过源码就会这样）');
    if (!ok) process.exitCode = 2;
}

// ---------- --check：只比对，不写盘 ----------
if (has('--check')) {
    if (!fs.existsSync(OUT)) { console.error('❌ saki.html 不存在'); process.exit(1); }
    const cur = fs.readFileSync(OUT);
    if (sha1(cur) === outSha) {
        console.log('✅ 磁盘上的 saki.html 与 src/ 一致');
        process.exit(0);
    }
    console.error('❌ 磁盘上的 saki.html 与 src/ 不一致');
    console.error('   磁盘 ' + cur.length + ' B / ' + sha1(cur));
    console.error('   src/ ' + out.length + ' B / ' + outSha);
    process.exit(1);
}

// ---------- 拦截「产物被绕过 src/ 手改过」 ----------
let stamp = null;
try { stamp = JSON.parse(fs.readFileSync(STAMP, 'utf8')); } catch (e) { /* 第一次构建 */ }
if (stamp && stamp.sha1 && fs.existsSync(OUT)) {
    const curSha = sha1(fs.readFileSync(OUT));
    if (curSha !== stamp.sha1 && !has('--force')) {
        console.error('');
        console.error('⛔ saki.html 的 sha1 跟上次构建记录的不一样。');
        console.error('   上次构建 ' + stamp.sha1);
        console.error('   现在磁盘 ' + curSha);
        console.error('');
        console.error('   说明有人**直接改了产物**而不是改 src/。现在构建会把这些改动冲掉。');
        console.error('   如果那些改动不要了 → node build.js --force');
        console.error('   如果那些改动要留 → 先手工把它们挪进 src/ 里对应的模块，再构建。');
        process.exit(1);
    }
}

// ---------- 写盘 ----------
fs.writeFileSync(OUT, out);
console.log('已写 ' + path.basename(OUT));

if (!has('--no-index')) {
    // index.html 是 GitHub Pages 的发布副本，必须跟 saki.html 逐字节相同。
    // 在这里一起写，省掉「推之前忘了同步」这个老坑。
    const old = fs.existsSync(OUT_INDEX) ? fs.readFileSync(OUT_INDEX) : null;
    if (!old || !old.equals(out)) {
        fs.writeFileSync(OUT_INDEX, out);
        console.log('已写 ' + path.basename(OUT_INDEX) + '（发布副本，与 saki.html 逐字节相同）');
    } else {
        console.log(path.basename(OUT_INDEX) + ' 已是最新，没动');
    }
}

// ⚠ 刻意不写时间戳：写了的话每次构建都会产生一个「内容没变但 diff 变了」的
//   无意义改动，久了就没人看这个文件的 diff 了。它只记「上次构建出来是什么」。
fs.writeFileSync(STAMP, JSON.stringify({ sha1: outSha, bytes: out.length }, null, 2) + '\n');

// ---------- 重新生成 src/INDEX.md ----------
writeIndex(stat);

function symbolsOf(file) {
    const text = fs.readFileSync(path.join(SRC, file), 'utf8');
    const names = [];
    const seen = new Set();
    if (/\.css$/.test(file)) {
        // CSS 没有「符号」，就列选择器 —— 索引要回答的是「这个文件管哪些元素」
        const re = /^ {0,8}([^\s{@\/][^{}\n]*?)\s*\{/gm;
        let c;
        while ((c = re.exec(text))) {
            const sel = c[1].trim();
            if (!sel || sel.length > 46 || seen.has(sel)) continue;
            seen.add(sel);
            names.push(sel);
        }
        return names;
    }
    const re = /^(?: {0,8})(?:async\s+)?(?:function\s+([A-Za-z_$][\w$]*)|const\s+([A-Za-z_$][\w$]*)\s*=|let\s+([A-Za-z_$][\w$]*)\s*=|var\s+([A-Za-z_$][\w$]*)\s*=|class\s+([A-Za-z_$][\w$]*))/gm;
    let m;
    while ((m = re.exec(text))) {
        const n = m[1] || m[2] || m[3] || m[4] || m[5];
        if (n && !seen.has(n)) { seen.add(n); names.push(n); }
    }
    return names;
}

function writeIndex(stat) {
    const total = stat.reduce((s, x) => s + x.lines, 0);
    const L = [];
    L.push('# src/ 模块索引');
    L.push('');
    L.push('> **自动生成，别手改。** 每次 `node build.js` 都会重写这一份。');
    L.push('> 想改标题 → 改 `src/manifest.json` 里对应那条的 `title`；想加模块 → 在 manifest 里按顺序插一条。');
    L.push('');
    L.push('共 **' + stat.length + '** 个模块 / **' + total + '** 行，拼成 `saki.html`（' + kb(out.length) + '）。');
    L.push('');
    L.push('## 怎么改');
    L.push('');
    L.push('1. 下面这张表里找到功能 → 打开那个文件（或者 `node build.js --where 关键字` 直接搜）。');
    L.push('2. 改完 `node build.js`。');
    L.push('3. 构建会拦住「绕过 src/ 直接改 saki.html」的情况，报错时按提示处理。');
    L.push('');
    L.push('⚠ **顺序就是语义**：`manifest.json` 的数组顺序 = 拼装顺序。JS 顶层 `const`/`let`');
    L.push('不提升，文件末尾还有一段立即执行的启动代码，重排会直接坏。');
    L.push('');
    L.push('## 模块');
    L.push('');
    L.push('| # | 文件 | 行 | 标题 | 主要符号 |');
    L.push('|---:|---|---:|---|---|');
    stat.forEach((m, i) => {
        const syms = symbolsOf(m.file);
        const head = syms.slice(0, 7).map(s => '`' + s + '`').join(' ');
        const more = syms.length > 7 ? ' …+' + (syms.length - 7) : '';
        L.push('| ' + (i + 1) + ' | `' + m.file + '` | ' + m.lines + ' | ' + (m.title || '').replace(/\|/g, '\\|') + ' | ' + (head + more) + ' |');
    });
    L.push('');
    fs.writeFileSync(path.join(SRC, 'INDEX.md'), L.join('\n'), 'utf8');
    console.log('已重写 src/INDEX.md');
}
