// 第十九轮反向测试：**这两处修复的闸门真的有分辨力吗？**
//
// 要证的两件事（都是用户报的 bug）：
//   ① 【ai对话】在 Vertex 完整模式（Service Account）下 —— API Key 那一格该藏起来，
//      且点「应用」不该因为 Key 为空被拦。
//   ② 【API 全局配置】弹窗的标题栏不该跟着正文一起滚。
//
// ⚠⚠ 与老的 `_reverse*.js` **做法不同**（那些是把注入写回真产品、靠 `.bak` 还原）：
//   这里**绝不碰真产品**。做法是把 `saki.html` 拷成 `saki.__rev.html`
//   （**必须同目录**，否则页面里的 `./fonts/…` 会 404），只改它声称要改的那一处，
//   再用 `YS_PAGE=…` 让 `apig-verify.js` 去跑那一份，最后比对**红行集合**。
//
// ⚠ 为什么值得这么绕：老做法一旦中途被 kill，磁盘上就留着一份**被注入过的产品**，
//   下一次整跑会拿它当真值（RULES 六之三十四）。替身法没有这个失败模式。
//
// 每一针都要满足三条：
//   ① 该红的**一条不落**地红了（红行集合**逐条**比对，不是「至少红一条」）
//   ② 不该红的**保持绿**（否则这一针打歪了，红的是别的东西）
//   ③ 红的总条数**等于**预期条数 —— 多出来的「连带红」也要写进名单（六之二十九）
//
// 跑法：node _reverse19.js
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DIR = __dirname;
const REAL = path.join(DIR, '..', 'saki.html');
const REV = path.join(DIR, '..', 'saki.__rev.html');
const SUITE = path.join(DIR, 'apig-verify.js');

let pass = 0, fail = 0;
const fails = [];
function check(name, ok, detail) {
    if (ok) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; fails.push(name); console.log(`  ❌ ${name}${detail ? '  ' + detail : ''}`); }
}

// ⚠ 探针造的文件**无条件删** —— 三条退出路径（正常 / 断言失败 / 抛异常）都要走到
function rmRev() { try { fs.rmSync(REV, { force: true }); } catch (e) {} }
process.on('exit', rmRev);
process.on('SIGINT', () => { rmRev(); process.exit(130); });

// ⚠ 本环境 `spawnSync` / `execFileSync` / `execSync` 一律 EBUSY（RULES 六之四十六）
//   ⇒ 只能用异步 `spawn`
function runSuite(pageFile) {
    return new Promise(resolve => {
        const env = Object.assign({}, process.env);
        if (pageFile) env.YS_PAGE = pageFile; else delete env.YS_PAGE;
        const p = spawn(process.execPath, [SUITE], { cwd: DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        p.stdout.on('data', d => { out += d; });
        p.stderr.on('data', d => { out += d; });
        const tm = setTimeout(() => { try { p.kill(); } catch (e) {} }, 600000);
        p.on('close', code => { clearTimeout(tm); resolve({ code, out }); });
    });
}

// ⚠ 断言名里**可能带换行 / 多余空格**，所以按行取、只截到 `  actual=`
function reds(out) {
    return out.split('\n')
        .filter(l => /^\s*❌ /.test(l))
        .map(l => {
            const m = l.match(/^\s*❌ (.*?)\s{2}actual=/);
            return (m ? m[1] : l.replace(/^\s*❌ /, '')).trim();
        });
}
function summaryLine(out) {
    const m = out.match(/=====\s*[^=]*：(\d+) 通过 \/ (\d+) 失败\s*=====/);
    return m ? { ok: +m[1], bad: +m[2] } : null;
}

// 红行集合**逐条**比对：多一条少一条都要说出来
function sameSet(a, b) {
    const A = [...a].sort(), B = [...b].sort();
    if (A.length !== B.length) return false;
    return A.every((x, i) => x === B[i]);
}
function diffSets(actual, expected) {
    const A = new Set(actual), B = new Set(expected);
    const miss = [...B].filter(x => !A.has(x));   // 该红没红
    const extra = [...A].filter(x => !B.has(x));  // 多出来的连带红
    let s = '';
    if (miss.length) s += '\n      该红没红：' + miss.map(x => '\n        · ' + x).join('');
    if (extra.length) s += '\n      多出来的红（连带红也要写进名单）：' + extra.map(x => '\n        · ' + x).join('');
    return s;
}

// ⚠⚠ 产品是 **CRLF**（`saki.html` 历来如此）。探针里写的多行 `from` 用的是 `\n`，
//   直接 `replace()` 会**一处都匹配不到** —— 而「没匹配到」在反向测试里是个
//   **静默**失败：如果不检查唯一性，就会写出一份**根本没被改过**的替身，
//   然后「该红的没红」，看起来像「闸门没抓到」。
//   ⇒ 一律按文件实际的换行风格把锚点拼出来；下面的「注入点唯一」闸门负责兜底。
function withEol(s, eol) { return s.split('\n').join(eol); }

// ===== 注入 =====
// ⚠ 每一针都**窄到只打它声称打的那件事** —— 整块替换会把对照组一起打红，
//   那样「红了」就证明不了任何东西
const SHIM_HIDE = `                keyField.hidden = !!(stAiIsVertex({ provider: prov, baseUrl: baseUrl })
                    && aiConfig.authMode === 'sa');`;
const APPLY_GUARD = `            if (stAiNeedsKey(cfg) && !cfg.apiKey) { updateAiStatus('⚠️ 请先在' + where + '填写 API Key'); return; }`;
const FETCH_GUARD = `            const needKey = stAiNeedsKey(cfg);`;

// CSS 那一针要整块还原成**改之前的样子**（卡片自己滚）。
// ⚠⚠ 必须替换**整块**（三条规则一起）：第一版只改了 `.game-card.api-global-card`
//   的开头几行，后面那行 `overflow: hidden` 还留在原地 —— 它写得更靠后，
//   照样赢 ⇒ 替身其实**没被改过**，于是「一条红都没有」。
//   而那个结果长得像「闸门没抓到」，其实**是探针坏了**（RULES 六之六十九）。
const CSS_NEW = `        .game-card.api-global-card {
            align-items: stretch;
            max-width: 560px;
            max-height: 86vh;
            /* ⚠⚠ 卡片自己**不滚**，滚动条交给下面的 .apig-body。
               原来这里是 \`overflow-y: auto\` ⇒ 整个卡片（**含标题栏**）一起滚，
               标题和那个 × 关闭按钮都被推出去。 */
            overflow: hidden;
            /* 内边距拆给标题栏和正文两段，卡片本身不要 */
            padding: 0;
        }

        /* 标题栏留在原地：不参与滚动，也不被压缩 */
        /* ⚠ 这条的权重是 (0,2,0)：压得住 \`.game-card-header\`（0,1,0），
           但**压不过** retro 那条 (0,2,1) —— 那是故意的，retro 下标题栏是
           绝对定位的 Win95 样式，\`padding: 0 4px\` 得留住。
           别手贱把它升成三段的 \`.game-card.api-global-card .game-card-header\`（0,3,0），
           那会把 retro 的标题栏样式一起打坏。 */
        .api-global-card .game-card-header {
            flex: 0 0 auto;
            margin-bottom: 0;
            padding: 18px 20px 8px;
        }

        .apig-body {
            display: flex;
            flex-direction: column;
            gap: 10px;
            /* ⚠⚠ \`min-height: 0\` 不能省 —— flex 子项的 \`min-height\` 默认是 \`auto\`，
               不加它这个子项**不肯缩到内容高度以下**，于是 \`overflow-y: auto\`
               永远不生效（滚动条会跑回卡片身上，标题栏又跟着滚）。 */
            flex: 1 1 auto;
            min-height: 0;
            overflow-y: auto;
            padding: 12px 20px 20px;
        }`;
const CSS_OLD = `        .api-global-card {
            align-items: stretch;
            max-width: 560px;
            max-height: 86vh;
            overflow-y: auto;
        }

        .apig-body {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }`;

const NEEDLES = [
    {
        name: 'A. 把「完整模式下藏起 Key 那一格」改回去',
        from: SHIM_HIDE,
        to: `                keyField.hidden = false;   // YSREV`,
        expectRed: [
            '⚠⚠ 跟随 + Vertex 完整模式 ⇒ Key 那一格真的藏住了（computed display = none）',
            '前置：完整模式下 Key 那一格是藏着的'
        ],
        keepGreen: [
            '（对照）快速模式 ⇒ Key 那一格**显示**',
            '（对照）非 Vertex + 残留 authMode=sa ⇒ Key 那一格**显示**（判据不是只看 authMode）'
        ]
    },
    {
        name: 'B. 把「应用」那条判据改回无条件要 Key',
        from: APPLY_GUARD,
        to: `            if (!cfg.apiKey) { updateAiStatus('⚠️ 请先在' + where + '填写 API Key'); return; }   // YSREV`,
        expectRed: [
            '⚠⚠ 完整模式 + 空 Key：点「应用」**不该**被「请先填写 API Key」拦住',
            '⚠ 而且真的走完了（设置面板收起来 = 进对话）'
        ],
        keepGreen: [
            '（强对照）OpenAI + 空 Key：同一条路**必须**被拦住',
            '（强对照）被拦住时不该进对话'
        ]
    },
    {
        name: 'C. 把 fetchModels 的判据改回旧写法（proto === gemini && authMode === sa）',
        from: FETCH_GUARD,
        to: `            const needKey = !(cfg.proto === 'gemini' && cfg.authMode === 'sa');   // YSREV`,
        expectRed: [
            '⚠⚠ fetchModels 走真实路径：这种配置下**必须**要 Key（旧写法会不带 Key 就发出去）',
            '⚠ 而且真的一个请求都没发出去'
        ],
        keepGreen: [
            '⚠⚠ 新旧判据在「自定义 + AI Studio 域名」上真的不同（proto=gemini / 旧=不用Key / 新=要Key）',
            '⚠ stAiNeedsKey：Vertex + sa ⇒ 不需要 Key'
        ]
    },
    {
        name: 'D. 把 CSS 改回「卡片自己滚」（标题栏跟着滚的那个版本）',
        from: CSS_NEW,
        to: CSS_OLD,
        expectRed: [
            '前置：正文确实比可视区高（不然「滚一下」测不出任何东西）',
            '卡片自己不再是滚动容器（overflow-y = hidden）',
            '正文才是滚动容器（overflow-y = auto）',
            '标题栏不参与伸缩（flex-shrink = 0 —— 默认是 1，所以这条真的能分辨）',
            '⚠⚠ 正文的滚动容器**就是** .apig-body（不是卡片）',
            '⚠⚠ 卡片**不是**正文的滚动容器',
            '⚠⚠ 滚动之后标题栏**一动没动**（rect.top 与滚动前逐像素相同）',
            '卡片自身的 scrollTop 始终是 0（滚动没跑回卡片身上）',
            '前置（retro）：正文仍然比可视区高',
            'retro：卡片仍然不是滚动容器',
            'retro：滚动之后标题栏照样不动'
        ],
        keepGreen: [
            '（对照）同一个滚动里，正文里的元素**确实动了** —— 证明上面那条不是量了个死值',
            '（对照）retro：正文里的元素照样会动'
        ]
    }
];

(async () => {
    console.log('== 第十九轮反向测试 ==');
    console.log('   替身：' + REV);
    console.log('   ⚠ 真产品一个字节都不动\n');

    const real = fs.readFileSync(REAL);

    // ===== 0. 基线：没被改过的产品必须**一条红都没有** =====
    //   ⚠ 没有这一条的话，「注入之后红了 N 条」说明不了什么 ——
    //     可能本来就红着 N 条，注入根本没起作用
    console.log('== 0. 基线（原样跑一遍）==');
    const base = await runSuite(null);
    const baseReds = reds(base.out);
    const baseSum = summaryLine(base.out);
    check('基线：套件跑到了汇总行（没提前死掉）', !!baseSum, baseSum ? '' : '（连汇总行都没有）');
    if (baseSum) check('基线：0 通过以外的数字对得上（失败数 = 红行数）',
        baseSum.bad === baseReds.length, `汇总 ${baseSum.bad} vs 红行 ${baseReds.length}`);
    check('⚠ 基线：一条红都没有（不然下面的比对没有意义）', baseReds.length === 0,
        baseReds.length ? diffSets(baseReds, []) : '');
    console.log(`   基线：${baseSum ? baseSum.ok : '?'} 通过 / ${baseReds.length} 红\n`);

    // ===== 逐针 =====
    const realTxt = real.toString('utf8');
    const EOL = realTxt.includes('\r\n') ? '\r\n' : '\n';
    console.log(`   产品换行风格：${EOL === '\r\n' ? 'CRLF' : 'LF'}\n`);
    for (const n of NEEDLES) {
        console.log(`== ${n.name} ==`);
        const from = withEol(n.from, EOL);
        const to = withEol(n.to, EOL);
        const cnt = realTxt.split(from).length - 1;
        if (cnt !== 1) {
            check(`注入点唯一（找到 ${cnt} 处，应为 1）`, false, '注入点选得不结构性，换锚点');
            continue;
        }
        fs.writeFileSync(REV, realTxt.replace(from, to), 'utf8');
        const r = await runSuite(REV);
        rmRev();

        const got = reds(r.out);
        const sum = summaryLine(r.out);
        check('替身跑到了汇总行（没提前死掉）', !!sum, sum ? '' : '（连汇总行都没有）');
        check('红行集合与预期**逐条**一致', sameSet(got, n.expectRed),
            diffSets(got, n.expectRed));
        for (const g of n.keepGreen) {
            check(`不该红的保持绿：${g.slice(0, 28)}…`, !got.includes(g));
        }
        if (sum) check('汇总里的失败数 = 红行数', sum.bad === got.length,
            `汇总 ${sum.bad} vs 红行 ${got.length}`);
        console.log('');
    }

    rmRev();
    console.log(`===== 反向测试：${pass} 通过 / ${fail} 失败 =====`);
    if (fails.length) { console.log('失败项：'); fails.forEach(f => console.log('  · ' + f)); }
    process.exit(fail ? 1 : 0);
})().catch(e => {
    console.error('💥 反向测试自己崩了：' + (e && e.stack ? e.stack : e));
    rmRev();
    process.exit(1);
});
