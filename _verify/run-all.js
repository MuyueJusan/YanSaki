// 跑 `_verify/` 里的**全部**套件，并且**不允许静默少走**。
//
// ⚠⚠ **必须用异步 `spawn`，不能用 `spawnSync`。**
//   这个环境里 `spawnSync` 一律立刻返回 `EBUSY`（**连 `where.exe` / `git` 也一样**），
//   而异步 `spawn` 完全正常（实测 `spawnSync` err=EBUSY / `spawn` code=0）。
//   踩到的样子（**当时还是 18 套**）：18 次 `spawnSync` 全部失败 ⇒ 打出来是
//     `18 套，共 **0 通过 / 0 失败**` + 每套一行 `[无] 0.0s ← 没有可解析的汇总行`
//   —— ⚠ **这个输出长得像「套件全坏了」**，而真正坏的只是 runner 起不了子进程。
//   （`0.0s` 是唯一线索：真跑过的套件不可能 0.0s。）
//   ⚠ 顺带一提：套件自己（`persona-verify.js` 等）一直用的是异步 `spawn` 起 Chrome，
//     所以它们**从来没受过这个影响** —— 这也是当初「单跑绿、整跑全红」的由来。
//
// 为什么要有这个脚本：以前是用
//     for f in *.js; do node "$f" | grep -E "[0-9]+ (通过|passed)" | tail -1; done
// 收汇总行 —— 而汇总行**有两种格式**：
//     · `N 通过 / N 失败`   （sb-verify4~7 / st-ai / st-code / sb-keep-compare）
//     · `N passed, N failed`（sb-verify / 2 / 3 / smoke）
// grep 只匹配一种，另一种的套件就打印**一行空白**。空白看起来像「没报错」，
// 实际是「压根没看它们的结果」：实测静默少了 4 套、**272 条**。
//
// 所以这里把三件事变成**硬错误**：
//   ① 每个套件都必须产出一行**能解析**的汇总（空白 = 错）
//   ② 清单要跟**目录对账** —— 多出没分类的 `.js` 就报错
//      （枚举本身不完整时不会红，只会少走；和「选项卡清单是字面量数组」同族）
//   ③ 任何 `failed > 0` 就报错
//
// ⚠ **这里不写死「期望总数」。** 写死的话，每次加断言都要改它，迟早退化成
// 「永远在报的检查」—— 那种检查只会被无视（见 `04-card-editor.md` 里那条）。
// 要抓的是「**少走了几套**」，不是「数字变了」。数字只**打印**出来，
// 方便跟 `README.md` 里的「共 N 条」对照。
//
// ⚠ 清单（SUITES / NOT_A_SUITE）与汇总正则**不在这里** —— 在 `suites.js`，
//   跟 `run-all.sh` 共用。抄一份必然分叉。
//   `run-all.sh` 是**备用**驱动（bash 起子进程，不经过 node 的 child_process），
//   只在「异步 `spawn` 也出问题」时才用得上；平时请用这个。
//
// 用法：
//   node run-all.js                 # 全部
//   node run-all.js st-code.js      # 只跑指定的几个（会大声提示这是部分结果）
const { spawn } = require('child_process');
const { DIR, SUITES, summariesIn, auditManifest } = require('./suites.js');

const NODE = process.execPath;              // 用当前这个 node，别写死路径
const TIMEOUT_MS = 15 * 60 * 1000;          // 单套上限。⚠ 别再往小里调：慢的是走 CDP 的那几套，
                                            //   而**被截断的套件跟「通过了」长得一模一样**
                                            //   （汇总行照样打得出来）—— 宁可等，不许切

// 跑一套。**异步** —— 见文件头那条。stdout / stderr 分开攒、最后拼起来，
// 跟原来 `spawnSync` 的 `stdout + stderr` 语义保持一致
function runSuite(file) {
    return new Promise(resolve => {
        const t0 = Date.now();
        let so = '', se = '';
        let done = false;
        const c = spawn(NODE, [file], { cwd: DIR });
        const timer = setTimeout(() => {
            if (done) return;
            done = true;
            try { c.kill(); } catch (e) {}
            resolve({ text: so + se, ms: Date.now() - t0, timedOut: true, code: null });
        }, TIMEOUT_MS);
        c.stdout.on('data', d => { so += d; });
        c.stderr.on('data', d => { se += d; });
        c.on('close', code => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve({ text: so + se, ms: Date.now() - t0, timedOut: false, code });
        });
        c.on('error', e => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve({ text: so + se, ms: Date.now() - t0, timedOut: false, error: e });
        });
    });
}

// ── ① 清单跟目录对账 ───────────────────────────────────────────
console.log('== 清单对账 ==');
const { lines, unclassified } = auditManifest();
lines.forEach(l => console.log(l));
if (unclassified.length) {
    console.log('\n❌ 有 ' + unclassified.length + ' 个 .js 没分类：' + unclassified.join(', '));
    console.log('   新加的是套件就写进 suites.js 的 SUITES，是工具 / 探针就写进 NOT_A_SUITE ——');
    console.log('   ⚠ 别图省事改成「不在 SUITES 里的都跳过」：那样新套件忘了登记永远不会被发现。');
    process.exit(1);
}
console.log('  ✓ 全部有归属（没有「没登记就静默跳过」的空间）');

// 只跑指定的几个（显式传参），会大声提示这是部分结果
const picked = process.argv.slice(2).filter(a => !a.startsWith('-'));
const runList = picked.length ? picked : SUITES;
const missing = runList.filter(f => SUITES.indexOf(f) < 0);
if (missing.length) {
    console.log('\n❌ 这些不在套件清单里：' + missing.join(', '));
    process.exit(1);
}

main();

async function main() {
    console.log('\n== 逐套运行 ==');
    const rows = [];
    let bad = 0;

    for (const file of runList) {
        const r = await runSuite(file);
        const ms = r.ms;
        const found = summariesIn(r.text);
        const s = found.length ? found[found.length - 1] : null;   // 取**最后**一条

        let status, note = '';
        if (r.timedOut) { status = 'TIMEOUT'; note = '超过 ' + (TIMEOUT_MS / 1000) + 's'; }
        else if (r.error) { status = 'SPAWN-FAIL'; note = '起不了子进程：' + r.error.code; }
        else if (!s) { status = 'NO-SUMMARY'; note = '没有可解析的汇总行' + (r.code ? '（退出码 ' + r.code + '）' : ''); }
        else if (s.fail > 0) { status = 'FAILED'; note = s.fail + ' 条失败'; }
        else { status = 'OK'; }

        if (status !== 'OK') bad++;
        rows.push({ file, s, status, note, ms, form: s ? s.form : '', text: r.text });
        const mark = status === 'OK' ? '✅' : '❌';
        console.log('  ' + mark + ' ' + file.padEnd(20) +
            (s ? String(s.pass).padStart(5) + ' 通过 / ' + s.fail + ' 失败' : '      —        ') +
            '  [' + (s ? s.form : '无') + '] ' + (ms / 1000).toFixed(1) + 's' +
            (note ? '  ← ' + note : ''));
    }

    // ── ② 合计 ────────────────────────────────────────────────
    const totalPass = rows.reduce((a, r) => a + (r.s ? r.s.pass : 0), 0);
    const totalFail = rows.reduce((a, r) => a + (r.s ? r.s.fail : 0), 0);

    console.log('\n== 合计 ==');
    if (picked.length) {
        console.log('  ⚠ **这是部分结果**（只跑了 ' + runList.length + ' 套，共 ' + SUITES.length + ' 套）——');
        console.log('    别拿这个总数去对 README。要对照就整跑一遍。');
    }
    console.log('  ' + runList.length + ' 套，共 **' + totalPass + ' 通过 / ' + totalFail + ' 失败**');
    console.log('  （对照 `markdown/README.md` 里的「共 N 条」；这里故意不写死期望值，见文件头）');

    // ── ③ 没通过的套件：把尾部输出打出来 ──────────────────────
    // ⚠⚠ 为什么不落盘成文件：`_verify/` 里的生成物**用完就得删**，留两份就一定有一份是错的。
    //   而这里真正需要的只是**「为什么红」那一小段** —— 尤其是套件自己崩掉时的那句
    //   `💥 套件自身出错：<stack>`：它**只在完整输出里**，汇总行只打 `1 通过 / 1 失败`。
    //   2026-09-24 实测：`vertex-verify.js` 报 `1 通过 / 1 失败`，而崩点 / 堆栈**全丢了**，
    //   只能花五分钟重跑一遍单套才能看到。所以：**只打印，不留文件。**
    const failed = rows.filter(r => r.status !== 'OK');
    if (failed.length) {
        console.log('\n== 没通过的套件：尾部输出（每套最后 25 行）==');
        for (const r of failed) {
            console.log('\n── ' + r.file + '  [' + r.status + '] ' + r.note + ' ──');
            const ls = String(r.text || '').replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
            for (const l of ls.slice(-25)) console.log('  │ ' + l);
        }
    }

    if (bad) {
        console.log('\n❌ 有 ' + bad + ' 套没通过：' +
            rows.filter(r => r.status !== 'OK').map(r => r.file + '(' + r.status + ')').join(', '));
        process.exit(1);
    }
    console.log('\n✅ 全部通过');
}
