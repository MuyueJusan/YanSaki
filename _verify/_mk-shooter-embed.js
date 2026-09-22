// 把 `G:\retro_vector_space_shooter (1).html` 整份**内联**进 `saki.html` 的 `<script>` 里，
// 变成一个模板字面量常量 `ST_SHOOTER_SRC`（小游戏弹窗里用 iframe 的 `srcdoc` 喂给它）。
//
// 为什么内联而不是外链：`saki.html` 是**单文件**应用 —— 实测它对外**零个**本地相对引用
// （只有 Google Fonts 和 Discord 两个远程 URL）。加一个 `games/shooter.html` 就等于
// 把它从「双击就能跑的单文件」变成「要一起拷贝的目录」，跟这个项目的立身之本冲突。
//
// ── 转义规则（五条，一条都不能少）────────────────────────────────
// 内联进模板字面量要同时满足**两个解析器**：JS 的，和 HTML 的。HTML 那个最阴 ——
// 它**不认识 JS 字符串**，只会一路找 `</script` 把外层 `<script>` 掐断。
//
//   ① `\`  → `\\`      最要命的一条。不转义的话 `/\d+/` 会变成 `/d+/`，
//                       游戏里所有正则**静默失效**（不报错，只是行为不对）。
//   ② `` ` `` → `` \` ``  不转义就直接把字符串提前闭合了。
//   ③ `${` → `\${`     不转义就当成插值，轻则报错重则执行到不存在的东西。
//   ④ `</script` → `<\/script`
//                       不转义 ⇒ 外层 `<script>` 被**提前掐断**，页面从这儿往后全废。
//   ⑤ `<!--` → `<\!--`
//                       最不直观的一条。HTML 词法器在 script data 态见到 `<!--`
//                       会进入 **script data escaped** 态，此后遇到 `<script` 再进
//                       **double escaped** 态 —— 在那一态里 `</script` **不再算结束标签**。
//                       原游戏里 `<script src="…tailwind…">` 在第 7 行、`<!--` 注释在第 129 行、
//                       主 `<script>` 在第 329 行 —— 恰好凑齐这个序列。
//                       把 `<!--` 写坏成 `<\!--` 就永远进不了那个态，从根上绕开。
//
// 前四条里 `\/` `\!` 都是 JS 的 NonEscapeCharacter（求值回 `/` `!`），所以
// **运行时拿到的字符串跟原文一字不差** —— 这正是 `--verify` 要证的事。
//
// ── 行尾 ────────────────────────────────────────────────────
// 文件里存 **CRLF**（跟 `saki.html` 其余部分统一，不混行尾）；
// 但 JS 规范要求模板字面量把 `<CR><LF>` **规范化成 `<LF>`**，
// 所以**运行时**拿到的字符串是纯 LF。两边都对，别把「运行时没有 \r」当成 bug。
//
// 跑法：
//   node _mk-shooter-embed.js             干跑：转换 + 往返自检 + 报告，**不写文件**
//   node _mk-shooter-embed.js --go        真写：把常量插进 saki.html（幂等，重跑就整段替换）
//   node _mk-shooter-embed.js --verify    只从 saki.html 抽出来，跟原始文件逐字节比对
//
// ⚠ 改了游戏源文件就要重跑一次 `--go` —— 否则 `saki.html` 里留的是**旧版本**，
//   而它看起来完全正常（游戏照样能玩，只是没有你新加的东西）。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const SRC = 'G:/retro_vector_space_shooter (1).html';
const PAGE = 'G:/saki/saki.html';

const BEGIN = '// ==== BEGIN ST_SHOOTER_SRC';
const END = '// ==== END ST_SHOOTER_SRC ====';

const sha1 = s => crypto.createHash('sha1').update(s, 'utf8').digest('hex');

// ── 转义 ────────────────────────────────────────────────────
// 单趟逐字符，**不要**用一连串 `.replace()`：那样 `\` 先变 `\\`，
// 后面几条规则又会去动那些新产生的反斜杠，顺序稍微一乱就得到双重转义。
function escapeForTemplate(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { out += '\\\\'; continue; }
    if (c === '`') { out += '\\`'; continue; }
    if (c === '$' && s[i + 1] === '{') { out += '\\$'; continue; }
    // ⚠ 这两条**只补一个 `<` 和一个 `\`**，后面那几个字符留给循环正常输出。
    //   第一版写成 `'<\\/'`（顺手把 `/` 也吐了出去）→ 循环接着又输出一次原来的 `/`
    //   ⇒ `</script` 变成 `<//script`。`<!--` 同理变成 `<\!!--`。
    //   这种错**不会报错**，只会让游戏里某个标签悄悄失效 —— 只有往返逐字节比对抓得住。
    if (c === '<' && (s.startsWith('!--', i + 1) || s.startsWith('/script', i + 1))) {
      out += '<\\'; continue;
    }
    out += c;
  }
  return out;
}

// 原文 → 文件里那份 CRLF 形态
function toCrlf(s) { return s.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'); }

// 从 saki.html 里抠出常量的**字面量正文**（不含首尾反引号）
//
// ⚠ 结尾**不能**用「从头找第一个 `` `; ``」。第一版就是这么写的，结果被正文里
//   一句 `` radioText.innerText = `📡 ${msg}`; `` 提前截断 —— 它的 `` ` `` 后面
//   紧跟一个 `;`，正好长得像收尾。截断后拿去求值报的是 `Unexpected end of input`，
//   看着像「文件写坏了」，其实文件是好的、是**读的人**切错了刀。
//   ⇒ 改成从 END 标记**往前**找最后一个 `` `; ``，并且要求它前面不是 `\`。
function extractLiteral(page) {
  const b = page.indexOf(BEGIN);
  if (b < 0) return null;
  const q = page.indexOf('= `', b);
  if (q < 0) return null;
  const start = q + 3;
  const eIdx = page.indexOf(END, start);
  if (eIdx < 0) return null;
  let e = page.lastIndexOf('`;', eIdx);
  if (e < 0 || page[e - 1] === '\\') return null;
  return { body: page.slice(start, e), begin: b, end: e + 2 };
}

function buildBlock(escaped) {
  return [
    '        ' + BEGIN + '（自动生成 · 改游戏请重跑 _verify/_mk-shooter-embed.js）====',
    '        // 复古线框战机（`retro_vector_space_shooter`）的整份源码，内联在这里。',
    '        // 小游戏弹窗把它当 `srcdoc` 喂给 iframe —— 见 stShooterMount()。',
    '        // ⚠ 放在 `<script>` 的**最末尾**是故意的：这样它上面所有行号锚点都不动。',
    '        // ⚠ 这里面是转义过的（`\\\\` / `` \\` `` / `\\${` / `<\\/script` / `<\\!--`），',
    '        //   五个规则各挡一个解析器 —— 别手改，改游戏源文件然后重跑生成脚本。',
    '        const ST_SHOOTER_SRC = `' + escaped + '`;',
    '        ' + END
  ].join('\r\n');
}

// ── 主流程 ──────────────────────────────────────────────────
const mode = process.argv.includes('--go') ? 'go'
  : process.argv.includes('--verify') ? 'verify' : 'dry';

const raw = fs.readFileSync(SRC, 'utf8');
const lf = raw.replace(/\r\n/g, '\n');            // 运行时应当拿到的样子
const crlf = toCrlf(raw);                          // 文件里存的样子
const escaped = escapeForTemplate(crlf);

// 往返自检：把生成的正文包回反引号**求值**，必须跟 lf 逐字节一致。
// ⚠ 这条是整件事的地基 —— 转义写错的表现是「游戏能开但某些行为不对」，
//   肉眼和冒烟测试都抓不住，只有逐字节比对能。
const back = vm.runInNewContext('`' + escaped + '`');
const roundTrip = back === lf;

console.log('== 转换 ==');
// ⚠ 一律报**字节**：`.length` 数的是 UTF-16 码元，这个文件里一堆中文，
//   两者差 5 KB —— 拿 `.length` 跟文件大小比会得出「对不上」的假结论。
const B = s => Buffer.byteLength(s, 'utf8');
console.log('  原文            : ' + B(raw) + ' 字节 / sha1 ' + sha1(raw));
console.log('  文件里（CRLF）  : ' + B(crlf) + ' 字节');
console.log('  运行时（LF）    : ' + B(lf) + ' 字节 / sha1 ' + sha1(lf));
console.log('  转义后正文      : ' + B(escaped) + ' 字节');
console.log('  膨胀            : +' + (B(escaped) - B(raw)) + ' 字节 (' +
  ((B(escaped) / B(raw) - 1) * 100).toFixed(1) + '%)');
console.log('  往返一致        : ' + (roundTrip ? '✅ 逐字节一致' : '❌ 不一致'));
if (!roundTrip) {
  let i = 0; while (i < Math.min(back.length, lf.length) && back[i] === lf[i]) i++;
  console.log('    第一个分歧在 ' + i + '：原文 ' + JSON.stringify(lf.slice(i, i + 40)) +
    ' → 求值 ' + JSON.stringify(back.slice(i, i + 40)));
  process.exit(1);
}
{
  const crInBack = (back.match(/\r/g) || []).length;
  console.log('  运行时含 \\r     : ' + crInBack + (crInBack ? '  ❌ 模板字面量该把 CRLF 规范化掉' : '  ✅（CRLF 已按规范规范化成 LF）'));
  const nScript = (back.match(/<\/script/gi) || []).length;
  const nOpen = (back.match(/<!--/g) || []).length;
  console.log('  还原出的 </script : ' + nScript + ' 处 · <!-- : ' + nOpen + ' 处（转义没吃掉内容）');
  if (!nScript || !nOpen) { console.log('  ❌ 转义把原文改坏了'); process.exit(1); }
}

if (mode === 'dry') {
  console.log('\n（干跑，没写文件。确认无误后加 --go）');
  process.exit(0);
}

const page = fs.readFileSync(PAGE, 'utf8');
const cur = extractLiteral(page);

if (mode === 'verify') {
  if (!cur) { console.log('\n❌ saki.html 里没有 ST_SHOOTER_SRC'); process.exit(1); }
  const got = vm.runInNewContext('`' + cur.body + '`');
  const same = got === lf;
  console.log('\n== 核对 saki.html 里那份 ==');
  console.log('  长度 : ' + Buffer.byteLength(got, 'utf8') + ' 字节 / sha1 ' + sha1(got));
  console.log('  跟原始文件 : ' + (same ? '✅ 逐字节一致' : '❌ 不一致'));
  process.exit(same ? 0 : 1);
}

// --go
const block = buildBlock(escaped);
let next;
if (cur) {
  // 幂等：整段换掉（从 BEGIN 那行的行首到 END 那行）
  const lineStart = page.lastIndexOf('\n', cur.begin) + 1;
  next = page.slice(0, lineStart) + block + page.slice(cur.end);
  console.log('\n（整段替换已有的 ST_SHOOTER_SRC）');
} else {
  // 插在**最后一个** `</script>` 之前，也就是脚本的末尾
  const anchor = '\r\n    </script>';
  const at = page.lastIndexOf(anchor);
  if (at < 0) { console.log('\n❌ 找不到 `\\r\\n    </script>` 锚点'); process.exit(1); }
  next = page.slice(0, at) + '\r\n\r\n' + block + page.slice(at);
  console.log('\n（新插入，位置：脚本末尾，最后一个 </script> 之前）');
}

// 写之前把该守的守住
const before = page.length, after = next.length;
const crlfNext = (next.match(/\r\n/g) || []).length, lfNext = (next.match(/\n/g) || []).length;
if (crlfNext !== lfNext) { console.log('❌ 写进去会混行尾（\\r\\n ' + crlfNext + ' ≠ \\n ' + lfNext + '）'); process.exit(1); }
// ⚠ 数的是**闭标签** `</script`，不是 `<script`。
//   字面量里那两条**开标签**（tailwind 的 `<script src=…>` 和游戏自己的 `<script>`）
//   是内容的一部分，本来就该多出来 —— 第一版拿 `<script\b` 当判据，于是**永远误报**。
//   会把外层掐断的只有 `</script`，所以只守它。
for (const [what, re] of [['</script', /<\/script/gi], ['<!--', /<!--/g]]) {
  const a = (page.match(re) || []).length, b = (next.match(re) || []).length;
  if (a !== b) {
    console.log('❌ 写进去之后 `' + what + '` 的字面量个数变了（' + a + ' → ' + b + '）' +
      ' —— 字面量里漏转义了一处，页面会被**提前掐断**');
    process.exit(1);
  }
}

fs.writeFileSync(PAGE, next, 'utf8');
console.log('  saki.html: ' + before + ' → ' + after + ' 字节（+' + (after - before) + '）');
console.log('  行尾: \\r\\n ' + crlfNext + ' / \\n ' + lfNext + (crlfNext === lfNext ? ' ✅ 统一 CRLF' : ' ❌'));

// 落盘后**重新读一遍**再核 —— 写成功 ≠ 写对了
const re = fs.readFileSync(PAGE, 'utf8');
const reCur = extractLiteral(re);
const reGot = vm.runInNewContext('`' + reCur.body + '`');
console.log('  落盘复核: ' + (reGot === lf ? '✅ 抽出来跟原始文件逐字节一致' : '❌ 落盘后不一致'));
process.exit(reGot === lf ? 0 : 1);
