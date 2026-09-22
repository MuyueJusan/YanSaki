// 把 `saki.html` 的内联 `<script>` 抽成 `blk0.js` —— **临时分析用**（想在编辑器里对着
// 纯 JS 搜东西时方便）。抽取规则和 `check.js` 第 22~28 行是同一套。
//
// ⚠ **生成物不要留在目录里。** 过期的 `blk0.js` 比没有它更坏：改了页面忘了重抽，
//   任何读它的东西都会**安安静静地对着旧代码给答案**。`check.js` 早就不读它了
//   （它当场抽、当场 `vm.Script` 解析），所以现在抽出来只服务于你手上这一次分析 ——
//   **用完删掉**。仓库里原来那两份过期副本已于 2026-09-20 清掉。
const fs = require('fs');
const src = fs.readFileSync('G:/saki/saki.html', 'utf8');
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m, i = 0, total = 0;
const out = [];
while ((m = re.exec(src))) {
  const attrs = m[1] || '';
  if (/\bsrc\s*=/.test(attrs)) continue;
  const type = (/\btype\s*=\s*"([^"]*)"/.exec(attrs) || [])[1] || 'text/javascript';
  const code = m[2];
  total += code.length;
  const off = src.slice(0, m.index).split('\n').length;
  const f = `blk${i}.js`;
  fs.writeFileSync(f, code);
  out.push({ file: f, type, startLine: off, len: code.length });
  i++;
}
console.log(JSON.stringify({ blocks: out, totalChars: total }, null, 1));
