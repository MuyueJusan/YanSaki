// _lint-suites.js —— **每次改完套件先跑这个**：把本仓库里**要跑起来的 .js** 逐个过 `node --check`。
//
// 为什么值得单开一个：
//   套件里到处是 `ev(\`...\`)` 这种**模板字符串**。注释里只要出现**一个反引号**
//   （比如写「`custom` 那条」），字符串就提前结束，报错是
//   `SyntaxError: missing ) after argument list` —— **指向的行号是模板字符串开头**，
//   看着跟那句注释毫无关系。人眼扫不出来，但 `node --check` 一秒钟就抓到。
//   ⚠ 第十八轮连踩三次，所以做成闸门。
//
// ⚠⚠ **闸门不能只罩 `_verify/`。**（2026-09-30）
//   原来这里只 `readdirSync(__dirname)`，而 `android/` 下还躺着 4 个 .js：
//     `assets/ys-ai-shim.js` / `shim/ai-fetch-shim.js`
//     `tools/release.js` / `tools/test-aiproxy/contract.test.js`
//   **一个都不在闸门里**。新写的 `tools/release.js` 就是活例子 ——
//   明明是个要跑的脚本，语法检查却对它隐身。
//   这就是「只修踩过的那一处 = 把坑留给隔壁」：闸门存在的理由是「本仓库的脚本别带语法错」，
//   而它实际只管了其中一个目录。⇒ 现在递归扫 `android/`。
//
// ⚠ 以 `_` 开头 ⇒ run-all.js 会当临时脚本跳过，不进整跑清单。
//   它查的是**脚本自己的语法**，跟产品无关，本来也不该混进回归数字里。
//
// 跑法：node _verify/_lint-suites.js
const fs = require('fs');
const path = require('path');
// ⚠⚠ **必须用异步 `spawn`** —— 这个环境里 `spawnSync` / `execFileSync` / `execSync`
//   **一律返回 EBUSY**（见 RULES 六之四十六），只有异步 `spawn` 正常。
//   用同步 API 的话这里会**全红假报**：`❌ 60/60 个文件语法不过` ——
//   看着像全仓炸了，其实只是起不了子进程。
const { spawn } = require('child_process');

const DIR = __dirname;
const ROOT = path.resolve(DIR, '..');

// 除 `_verify/` 外还要扫的根
const EXTRA_ROOTS = [path.join(ROOT, 'android')];

// ⚠ 跳过的是**生成物 / 依赖**，不是「我觉得有问题的」。
//   白名单式的跳过自己也会漏，所以下面把「跳过了哪些目录」**打出来**
//   —— 否则哪天真正该查的东西被静默跳过，没人会发现。
const SKIP_DIRS = new Set(['node_modules', '.git', 'build', '__pycache__']);
const skipped = [];

// 递归收集 .js
function collect(dir, out) {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { return out; }   // 目录不存在（比如 main 分支上没有 android/）就当没有
    for (const e of ents) {
        if (!e.isDirectory()) {
            if (e.isFile() && e.name.endsWith('.js')) out.push(path.join(dir, e.name));
            continue;
        }
        if (SKIP_DIRS.has(e.name)) { skipped.push(path.relative(ROOT, path.join(dir, e.name))); continue; }
        collect(path.join(dir, e.name), out);
    }
    return out;
}

const verifyFiles = fs.readdirSync(DIR).filter(f => f.endsWith('.js')).map(f => path.join(DIR, f));
const targets = verifyFiles.slice();
for (const r of EXTRA_ROOTS) collect(r, targets);
targets.sort();

// 显示用：相对仓库根的 posix 路径
const label = p => path.relative(ROOT, p).split(path.sep).join('/');

// 异步跑一个 `node --check`，返回 { code, stderr }
function runCheck(file) {
    return new Promise(resolve => {
        let se = '';
        let done = false;
        const c = spawn(process.execPath, ['--check', file]);
        c.stderr.on('data', d => { se += d; });
        c.on('close', code => { if (done) return; done = true; resolve({ code, stderr: se }); });
        c.on('error', e => { if (done) return; done = true; resolve({ code: 1, stderr: '起不了子进程：' + e.code }); });
    });
}

(async () => {
    let bad = 0;
    for (const f of targets) {
        const r = await runCheck(f);
        if (r.code !== 0) {
            bad++;
            console.log('  ❌ ' + label(f));
            // 只打头几行 —— 完整栈没用，要的是「哪一行、什么错」
            String(r.stderr || '').split(/\r?\n/).slice(0, 4).forEach(l => console.log('       ' + l));
        }
    }
    if (skipped.length) console.log('  （跳过生成物/依赖目录：' + skipped.join('、') + '）');
    console.log('\n' + (bad
        ? '❌ ' + bad + '/' + targets.length + ' 个文件语法不过 —— 先修，再谈跑套件'
        : '✅ ' + targets.length + ' 个 .js 全部通过 node --check'
          + '（_verify/ ' + verifyFiles.length + ' 个 + android/ ' + (targets.length - verifyFiles.length) + ' 个）'));
    process.exit(bad ? 1 : 0);
})();
