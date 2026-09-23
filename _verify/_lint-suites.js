// _lint-suites.js —— **每次改完套件先跑这个**：把 `_verify/*.js` 逐个过一遍 `node --check`。
//
// 为什么值得单开一个：
//   套件里到处是 `ev(\`...\`)` 这种**模板字符串**。注释里只要出现**一个反引号**
//   （比如写「`custom` 那条」），字符串就提前结束，报错是
//   `SyntaxError: missing ) after argument list` —— **指向的行号是模板字符串开头**，
//   看着跟那句注释毫无关系。人眼扫不出来，但 `node --check` 一秒钟就抓到。
//   ⚠ 本轮（第十八轮）连踩三次，所以做成闸门。
//
// ⚠ 以 `_` 开头 ⇒ run-all.js 会当临时脚本跳过，不进整跑清单。
//   它查的是**套件自己的语法**，跟产品无关，本来也不该混进回归数字里。
//
// 跑法：node _verify/_lint-suites.js
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DIR = __dirname;
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.js')).sort();

let bad = 0;
for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', path.join(DIR, f)], {
        encoding: 'utf8', timeout: 20000
    });
    if (r.status !== 0) {
        bad++;
        console.log('  ❌ ' + f);
        // 只打头几行 —— 完整栈没用，要的是「哪一行、什么错」
        String(r.stderr || '').split(/\r?\n/).slice(0, 4).forEach(l => console.log('       ' + l));
    }
}
console.log('\n' + (bad
    ? '❌ ' + bad + '/' + files.length + ' 个文件语法不过 —— 先修，再谈跑套件'
    : '✅ ' + files.length + ' 个 .js 全部通过 node --check'));
process.exit(bad ? 1 : 0);
