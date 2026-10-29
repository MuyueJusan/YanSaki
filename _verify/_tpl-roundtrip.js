// 一次性：三份内置模板的正文，跟**用户给的原始 .txt** 逐字节比（往返判据）。
//
// 为什么要有它：`persona-verify.js` 的 D3 段只能盯「字符数 / 行数 / 行尾空格行数 / 首行」——
// 那是常驻哨兵，挡得住「手抄吃空格」，挡不住「两个字符被换成另外两个字符而总数不变」。
// 真正的判据是**往返**：常量喂回去跟原文件比，一个字都不能差。
//
// ⚠ 它读的是 `src/` 里的**真相源**（不是产物、不是中间生成文件）——
//   所以不依赖任何 `_*.gen.js`，随时可以重跑。
// ⚠ 原始 .txt 在用户桌面上，**路径不存在就直说**，不许静默跳过（跳过 = 假装全过）。
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'js', '300b-编写器-人设生成器-内置模板.js');
const DIR = 'C:/Users/liron/OneDrive/Desktop/';

const src = fs.readFileSync(SRC, 'utf8');
const C = new Function(src +
    '\nreturn { SLIM: ST_PERSONA_TPL_SLIM, FATE: ST_PERSONA_TPL_FATE, MD: ST_PERSONA_TPL_MD };')();

const pairs = [['SLIM', '精简人设'], ['FATE', 'fate人设'], ['MD', '另一个模板']];
let bad = 0;
for (const [k, name] of pairs) {
    const file = DIR + name + '.txt';
    if (!fs.existsSync(file)) {
        console.log(k, '❌ 找不到原始文件', file);
        bad++;
        continue;
    }
    const got = C[k];
    // 原文件是 CRLF，源码里是纯 LF —— 只归一化行尾，别的一概不动
    const want = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
    const ok = got === want;
    console.log(k, ok ? '往返一致 ✓' : '❌ 不一致',
        '| 字符', got.length, '| 行', got.split('\n').length,
        '| 含 CR', got.indexOf('\r') >= 0,
        '| 行尾空格行', got.split('\n').filter(l => /[ \t]$/.test(l)).length);
    if (!ok) {
        bad++;
        const a = got.split('\n'), b = want.split('\n');
        for (let i = 0; i < Math.max(a.length, b.length); i++) {
            if (a[i] !== b[i]) {
                console.log('  首处差异 第', i + 1, '行', JSON.stringify(a[i]), '≠', JSON.stringify(b[i]));
                break;
            }
        }
    }
}
console.log(bad ? '❌ ' + bad + ' 份不一致' : '✅ 三份全部逐字节一致');
process.exit(bad ? 1 : 0);
