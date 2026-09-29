// _lint-suites.js —— **每次改完套件先跑这个**：把本仓库里**要跑起来的 .js** 逐个过 `node --check`。
//
// 为什么值得单开一个：
//   套件里到处是 `ev(\`...\`)` 这种**模板字符串**。注释里只要出现**一个反引号**
//   （比如写「`custom` 那条」），字符串就提前结束，报错是
//   `SyntaxError: missing ) after argument list` —— **指向的行号是模板字符串开头**，
//   看着跟那句注释毫无关系。人眼扫不出来，但 `node --check` 一秒钟就抓到。
//   ⚠ 第十八轮连踩三次，所以做成闸门。
//
// ⚠⚠ **闸门的作用域不能只罩 `_verify/`。**（2026-09-30）
//   原来这里只 `readdirSync(__dirname)`，而 `android/` 下还有要跑的 `.js`
//   （`shim/ai-fetch-shim.js` / `tools/release.js` / `tools/test-aiproxy/contract.test.js`）
//   —— **一个都不在闸门里**。新写的 `tools/release.js` 就是活例子：
//   明明是个要跑的脚本，语法检查却对它隐身。
//   这就是「只修踩过的那一处 = 把坑留给隔壁」：闸门存在的理由是
//   「本仓库的脚本别带语法错」，而它实际只管了其中一个目录。
//
// ⚠⚠ **清单从 git 推导，不写死根目录、也不写死跳过名单。**（同轮第二次修）
//   第一版改成「递归扫 `android/` + 硬编码跳过 build/__pycache__」，跑出来是 67 个。
//   但其中 `android/assets/ys-ai-shim.js` 是 **`build.sh` 第 114 行 `cp -f` 出来的副本**
//   （与 `shim/ai-fetch-shim.js` 逐字节相同），而 `build.sh` 第 119 行**已经**对它跑过
//   `node --check` ⇒ 既**重复数了它**，又让**这个数字取决于「本机构建过没有」**
//   （干净 clone 是 3、本机是 4）。一个会随环境变动的数字，比没有数字更坏。
//   ⇒ 判据换成：**git 认得、且不被 .gitignore 排除的 `.js`**
//     （`git ls-files --cached --others --exclude-standard`）——
//     这恰好就是「本仓库里要跑起来的脚本」，且**自动跟着文件增删走**。
//   ⚠ 被排除的那些**打出来**（白名单式的跳过自己也会漏，不说出来没人会发现）。
//
// ⚠ 以 `_` 开头 ⇒ run-all.js 会当临时脚本跳过，不进整跑清单。
//   它查的是**脚本自己的语法**，跟产品无关，本来也不该混进回归数字里。
//
// 跑法：node _verify/_lint-suites.js
const path = require('path');
// ⚠⚠ **必须用异步 `spawn`** —— 这个环境里 `spawnSync` / `execFileSync` / `execSync`
//   **一律返回 EBUSY**（见 RULES 六之四十六），只有异步 `spawn` 正常。
//   用同步 API 的话这里会**全红假报**：`❌ 60/60 个文件语法不过` ——
//   看着像全仓炸了，其实只是起不了子进程。
const { spawn } = require('child_process');

const DIR = __dirname;
const ROOT = path.resolve(DIR, '..');

// 跑一条 git 命令，返回按行拆好的输出
function git(args) {
    return new Promise((resolve, reject) => {
        const c = spawn('git', args, { cwd: ROOT });
        let out = '', err = '';
        c.stdout.on('data', d => { out += d; });
        c.stderr.on('data', d => { err += d; });
        c.on('error', e => reject(new Error('起不了 git：' + e.code)));
        c.on('close', code => code === 0
            ? resolve(out.split(/\r?\n/).filter(Boolean))
            : reject(new Error('git ' + args.join(' ') + ' 退出码 ' + code + '\n' + err)));
    });
}

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

// 显示用：相对仓库根的 posix 路径
const label = p => path.relative(ROOT, p).split(path.sep).join('/');

(async () => {
    let targets, ignored;
    try {
        targets = (await git(['ls-files', '--cached', '--others', '--exclude-standard', '--', '*.js']))
            .map(f => path.join(ROOT, f));
        // ⚠ 被 .gitignore 排除的那些要**说出来**，否则「该查的被静默跳过」没人会发现
        ignored = await git(['ls-files', '--others', '--ignored', '--exclude-standard', '--', '*.js']);
    } catch (e) {
        console.error('❌ 拿不到文件清单：' + e.message);
        process.exit(1);
    }
    targets.sort();

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
    if (ignored.length) console.log('  （.gitignore 排除，未检查：' + ignored.join('、') + '）');
    console.log('\n' + (bad
        ? '❌ ' + bad + '/' + targets.length + ' 个文件语法不过 —— 先修，再谈跑套件'
        : '✅ ' + targets.length + ' 个 .js 全部通过 node --check'));
    process.exit(bad ? 1 : 0);
})();
