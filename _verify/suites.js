// `_verify/` 的**套件清单**与**汇总行解析** —— 单一真相源。
//
// 为什么要把这两样从 `run-all.js` 里抽出来：
//   整跑有**两个驱动**，共用同一份清单与正则：
//     · `run-all.js`  —— node 自己用**异步 `spawn`** 起子进程（**首选**）
//     · `run-all.sh`  —— bash 起子进程，跑完把输出交给 `suites.js --report` 呈现（**备用**）
//   ⚠ 为什么曾经需要 bash 那个：`run-all.js` 原来用的是 `spawnSync`，而这个环境里
//     **`spawnSync` / `execFileSync` / `execSync` 一律立刻返回 `EBUSY`**（异步 `spawn` 完全正常），
//     于是 19 套全部打出 `[无] 0.0s ← 没有可解析的汇总行`，
//     而**这个输出长得像「套件坏了」**（`0.0s` 是唯一线索：真跑过的套件不可能 0.0s）。
//   ⚠⚠ 当时据此**误判**成「沙箱只放行一层进程创建」（依据是 `spawnSync('where.exe')` /
//     `spawnSync('git')` 也一样 EBUSY）—— 那个结论是**错的**，代价是白写一个驱动。
//     真因见 `RULES.md` 六之四十六：**「环境不允许」这个结论要拿另一种写法证伪过再下。**
//   ⚠ 两个驱动**必须共用**这份清单与正则。抄一份就一定会分叉 ——
//     「两种汇总格式」这个坑本身就是抄出来的：`grep -E "[0-9]+ (通过|passed)"`
//     只匹配一种，另一种的套件打印**一行空白**，实测静默少了 4 套、**272 条**。
//
// 用法：
//   node suites.js --list-suites            # 每行一个套件名（给 bash 用）
//   node suites.js --audit                  # 清单跟目录对账，不通过退出码 1
//   node suites.js --report <tmpdir> <f...> # 按 <tmpdir>/<f>.out + meta 打印表与合计
const fs = require('fs');
const path = require('path');

const DIR = __dirname;

// 19 套回归测试。**顺序就是打印顺序**：静态检查放最前（最快、也最先能拦住东西）。
const SUITES = [
    'check.js',
    'sb-verify.js', 'sb-verify2.js', 'sb-verify3.js', 'sb-verify4.js',
    'sb-verify5.js', 'sb-verify6.js', 'sb-verify7.js', 'sb-verify8.js',
    'sb-verify9.js',
    'persona-verify.js',
    'game-verify.js',
    'st-ai.js', 'apig-verify.js', 'vertex-verify.js', 'st-code.js',
    // 第二十一轮：编写器「首页」选项卡（概览 / 新建 / 导入 / 从别处搬条目）
    'home-verify.js',
    'sb-keep-compare.js', 'smoke.js'
];

// 目录里的其他 `.js` —— 不是回归测试，但**必须显式列出来**。
// ⚠ 故意不写成「不在 SUITES 里的都跳过」：那样新加一个套件忘了登记就永远不会被发现。
const NOT_A_SUITE = [
    'blk0.js',            // extract.js 的生成物 —— ⚠ **平时不该在目录里**（生成物不留仓库，见 README §7）。
                          //   列在这里只是为了「跑过 extract.js 之后它不算未分类」；
                          //   留着过期的生成物才是坑：检查会**对着旧代码给答案**。
    'extract.js',         // 从 saki.html 抽出内联 <script> 写到 blk0.js（**临时分析用**，产物用完就删）
    'suites.js',          // 就是本文件：清单 + 汇总解析（两个 runner 共用）
    'run-all.js',         // node 驱动版整跑（**首选**；用异步 `spawn`，见上面那段）
    'run-all.sh',         // bash 驱动版整跑（**备用**，只在 node 侧起不了子进程时才用）
    'deploy-check.js',    // **只读**：线上 index.html 跟本地是不是逐字节一致（+ `--runs` 查 Actions /
                          //   deployment / workflow 条数）。⚠ 不是套件：它依赖网络，不该进整跑。
                          //   起因见 RULES.md 六之二十：`git push` 绿 + 远端 blob 一致 **≠ 上线了**。
    'api-push.js',        // git-over-HTTPS 被代理挡死时的**兜底推送**（Git Data API 复刻 commit 元数据
                          //   ⇒ 远端与本地同 sha、零分叉）。⚠ 同样依赖网络，不进整跑；**默认 dry-run**。
    'sb-diag.js', 'sb-diag3.js', 'sb-diag5.js', 'sb-diag-class.js',  // 一次性诊断
    'sb-shot-color.js', 'sb-zoom.js', 'sb-zoom5.js'                  // 一次性截图 / 探针
];

// ⚠ 以 `_` 开头的一律当作临时脚本（如 `_reverse2.js` 那种反向测试注入器），跳过。
const isScratch = f => f.charAt(0) === '_';

// 两种汇总格式，合成一个正则，靠捕获组区分。
const RE_SUMMARY = /(\d+)\s*通过\s*\/\s*(\d+)\s*失败|(\d+)\s*passed,\s*(\d+)\s*failed/g;

function summariesIn(text) {
    const out = [];
    let m;
    RE_SUMMARY.lastIndex = 0;
    while ((m = RE_SUMMARY.exec(text)) !== null) {
        if (m[1] !== undefined) out.push({ pass: +m[1], fail: +m[2], form: 'zh' });
        else out.push({ pass: +m[3], fail: +m[4], form: 'en' });
    }
    return out;
}

// ── ① 清单跟目录对账 ───────────────────────────────────────────
// 返回 { lines: [打印行], unclassified: [..] }
function auditManifest() {
    const onDisk = fs.readdirSync(DIR).filter(f => f.endsWith('.js')).sort();
    const known = new Set(SUITES.concat(NOT_A_SUITE));
    const unclassified = onDisk.filter(f => !known.has(f) && !isScratch(f));
    const onDiskSet = new Set(onDisk);
    // ⚠ 三个数都从**磁盘**上数：`NOT_A_SUITE` 里允许有「平时不存在」的条目（比如生成物
    //   `blk0.js`），直接用数组长度会让这行加法对不上 —— 而一行对不上的数字比没有它更糟：
    //   下一个人会去查一个根本不存在的差异。
    const lines = [
        '  目录里 ' + onDisk.length + ' 个 .js：套件 ' + SUITES.length +
        ' + 非套件 ' + NOT_A_SUITE.filter(f => onDiskSet.has(f)).length +
        ' + 临时 ' + onDisk.filter(isScratch).length
    ];
    return { lines, unclassified };
}

module.exports = { DIR, SUITES, NOT_A_SUITE, isScratch, RE_SUMMARY, summariesIn, auditManifest };

// ── CLI ────────────────────────────────────────────────────────
if (require.main === module) {
    const argv = process.argv.slice(2);
    const mode = argv[0];

    if (mode === '--list-suites') {
        SUITES.forEach(f => console.log(f));
        process.exit(0);
    }

    if (mode === '--audit') {
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
        process.exit(0);
    }

    if (mode === '--report') {
        // 用法：--report <tmpdir> <suite.js> [<suite.js> ...]
        //   <tmpdir>/<suite>.out  = 该套的 stdout+stderr
        //   <tmpdir>/meta.txt     = 每行 `<suite> <exitCode> <ms>`
        const tmp = argv[1];
        const files = argv.slice(2);
        const meta = {};
        try {
            fs.readFileSync(path.join(tmp, 'meta.txt'), 'utf8')
                .split('\n').filter(Boolean)
                .forEach(line => {
                    const p = line.trim().split(/\s+/);
                    if (p.length >= 3) meta[p[0]] = { code: +p[1], ms: +p[2] };
                });
        } catch (e) { /* 没跑起来就全是 0 */ }

        console.log('\n== 逐套运行 ==');
        const rows = [];
        let bad = 0;
        for (const file of files) {
            let text = '';
            try { text = fs.readFileSync(path.join(tmp, file + '.out'), 'utf8'); } catch (e) {}
            const m = meta[file] || { code: 0, ms: 0 };
            const found = summariesIn(text);
            const s = found.length ? found[found.length - 1] : null;   // 取**最后**一条

            let status, note = '';
            if (!s) { status = 'NO-SUMMARY'; note = '没有可解析的汇总行' + (m.code ? '（退出码 ' + m.code + '）' : ''); }
            else if (s.fail > 0) { status = 'FAILED'; note = s.fail + ' 条失败'; }
            else { status = 'OK'; }

            if (status !== 'OK') bad++;
            rows.push({ file, s, status, note, ms: m.ms, form: s ? s.form : '' });
            const mark = status === 'OK' ? '✅' : '❌';
            console.log('  ' + mark + ' ' + file.padEnd(20) +
                (s ? String(s.pass).padStart(5) + ' 通过 / ' + s.fail + ' 失败' : '      —        ') +
                '  [' + (s ? s.form : '无') + '] ' + (m.ms / 1000).toFixed(1) + 's' +
                (note ? '  ← ' + note : ''));
        }

        // ── ② 合计 ────────────────────────────────────────────────
        const totalPass = rows.reduce((a, r) => a + (r.s ? r.s.pass : 0), 0);
        const totalFail = rows.reduce((a, r) => a + (r.s ? r.s.fail : 0), 0);
        console.log('\n== 合计 ==');
        console.log('  ' + files.length + ' 套，共 **' + totalPass + ' 通过 / ' + totalFail + ' 失败**');
        console.log('  （对照 `markdown/README.md` 里的「共 N 条」；这里故意不写死期望值，见 run-all.js 文件头）');

        if (bad) {
            console.log('\n❌ 有 ' + bad + ' 套没通过：' +
                rows.filter(r => r.status !== 'OK').map(r => r.file + '(' + r.status + ')').join(', '));
            process.exit(1);
        }
        console.log('\n✅ 全部通过');
        process.exit(0);
    }

    console.error('用法：node suites.js --list-suites | --audit | --report <tmpdir> <f...>');
    process.exit(2);
}
