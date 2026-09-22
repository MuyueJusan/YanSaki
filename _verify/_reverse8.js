// 反向测试「展开键」那组新断言：证明它们**真的会红**，而不是永远为真。
//
//   探针 A：把展开键里的箭头 span 去掉        → 箭头相关的必须红，折叠态相关的必须仍绿
//   探针 B：把左侧栏的时长改回 `0.22s ease`   → **只有**「时长一致」那一条红
//   探针 C：撤掉主页卡片的箭头旋转规则        → **只有**主页卡片那条红（选项卡那组必须仍绿）
//
// ⚠ **注意「展开键」在这份代码里有**两个**：全屏浮层顶栏的 `≡ 选项卡`（A / B），
//   和主页上那张编写器卡片的箭头（C）。它们是两套独立的折叠机制，**不能互相代替**。
// ⚠ 跟 `_reverse2.js` / `_reverse3.js` 一个套路：**先备份、先检查、最后才写**，收尾核字节。
// ⚠ 注入的是**产品**（`saki.html`），不是只改断言 —— 只改断言证明不了任何事。
// ⚠ 探针 B / C 是「精确性」测试：它们要证明那几条断言**只对自己那个改动敏感**，
//   而不是碰巧跟别的检查一起红（一起红 = 不知道它到底在测什么）。
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const PAGE = 'G:/saki/saki.html';
const SUITE = path.join(DIR, 'smoke.js');
const BAK = path.join(DIR, '_reverse8.bak');

// ⚠ 上一次没还原干净就拒绝启动 —— 否则会把「注入过的产品」当成基线备份下来。
if (fs.existsSync(BAK)) {
    console.log('⚠ 目录里还留着 _reverse8.bak —— 上一次没还原。先人工核对 saki.html，再删掉它重跑。');
    process.exit(1);
}

const ORIG = fs.readFileSync(PAGE, 'utf8');

function runSuite() {
    const r = spawnSync(process.execPath, [SUITE], {
        cwd: DIR, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 180000
    });
    return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}

let bad = 0;
const expect = (name, cond, extra) => {
    console.log((cond ? '  ✅ ' : '  ❌ ') + name + (extra ? '   ' + extra : ''));
    if (!cond) bad++;
};
// ⚠ 按**行**判红绿：smoke.js 的 `check` 每行以 ✅ / ❌ 开头。
const failedWith = (out, sub) => out.split('\n').some(l => l.indexOf('❌') >= 0 && l.indexOf(sub) >= 0);
const passedWith = (out, sub) => out.split('\n').some(l => l.indexOf('✅') >= 0 && l.indexOf(sub) >= 0);

// 单行锚点（`saki.html` 是 CRLF —— 多行锚点要用 \r\n 拼，能避开就避开）
const ICO_OLD = '<span class="st-tabs-ico">▲</span>';
const DUR_OLD = 'transition: flex-basis 0.35s cubic-bezier(0.4, 0, 0.2, 1),';
const DUR_NEW = 'transition: flex-basis 0.22s ease,';
// 探针 C 要整条撤掉，只能多行拼（\r\n）
const CARD_RULE = '        .st-container.ai-collapsed .st-toggle-icon {\r\n' +
                  '            transform: rotate(-180deg);\r\n' +
                  '        }';

// 锚点在**进 try 之前**检查：`process.exit()` 不跑 `finally`，
// 写在里面会把改过的产品留在盘上。
for (const [label, a] of [['箭头 span', ICO_OLD], ['左侧栏时长', DUR_OLD], ['卡片箭头规则', CARD_RULE]]) {
    if (ORIG.indexOf(a) < 0) {
        console.log('  ' + label + ' NOT FOUND —— 锚点变了，先看 saki.html 里那段还在不在');
        process.exit(1);
    }
}
fs.writeFileSync(BAK, ORIG);

try {
    // ── 探针 A：去掉箭头 span ────────────────────────────────────
    console.log('== 探针 A：展开键里没有箭头 ==');
    fs.writeFileSync(PAGE, ORIG.replace(ICO_OLD, ''));
    const a = runSuite();
    expect('套件确实红了（退出码非 0）', a.code !== 0, '(退出码 ' + a.code + ')');
    expect('红：展开键里有一个箭头元素', failedWith(a.out, '展开键里有一个箭头元素'));
    expect('红：箭头自己有 transform 过渡', failedWith(a.out, '箭头自己有 transform 过渡'));
    expect('红：箭头与左侧栏时长一致', failedWith(a.out, '箭头与左侧栏时长一致'));
    expect('红：折叠时箭头转到了 180°', failedWith(a.out, '折叠：箭头转到了 180°'));
    expect('红：展开（对照组）箭头回到未旋转', failedWith(a.out, '展开（对照组）：箭头回到了未旋转'));
    // 对照组：这些**不该**被箭头缺失带红 —— 否则它们测的其实是别的东西
    expect('仍绿：折叠态挂在 .st-shell 上', passedWith(a.out, '折叠：折叠态挂在按钮的祖先'));
    expect('仍绿：左侧栏也收起来了', passedWith(a.out, '折叠：左侧栏也收起来了'));
    expect('仍绿：折叠后重画 .st-shell 的态还在', passedWith(a.out, '折叠后重画：.st-shell 的折叠态还在'));
    expect('仍绿：展开（对照组）.st-shell 上没有折叠态', passedWith(a.out, '展开（对照组）：.st-shell 上没有折叠态'));

    // ── 探针 B：只把时长改回 0.22s ──────────────────────────────
    console.log('\n== 探针 B：左侧栏时长改回 0.22s（只该红一条）==');
    fs.writeFileSync(PAGE, ORIG.replace(DUR_OLD, DUR_NEW));
    const b = runSuite();
    expect('套件确实红了（退出码非 0）', b.code !== 0, '(退出码 ' + b.code + ')');
    expect('红：箭头与左侧栏时长一致', failedWith(b.out, '箭头与左侧栏时长一致'));
    expect('仍绿：箭头自己有 transform 过渡', passedWith(b.out, '箭头自己有 transform 过渡'));
    expect('仍绿：折叠时箭头转到了 180°', passedWith(b.out, '折叠：箭头转到了 180°'));
    expect('仍绿：展开（对照组）箭头回到未旋转', passedWith(b.out, '展开（对照组）：箭头回到了未旋转'));

    // ── 探针 C：撤掉主页卡片的箭头旋转规则（只该红主页卡片那条）──────
    console.log('\n== 探针 C：主页卡片的箭头不转了（撤掉 .st-container.ai-collapsed .st-toggle-icon）==');
    fs.writeFileSync(PAGE, ORIG.replace(CARD_RULE, ''));
    const c = runSuite();
    expect('套件确实红了（退出码非 0）', c.code !== 0, '(退出码 ' + c.code + ')');
    expect('红：卡片折叠时箭头转到了 180°', failedWith(c.out, '卡片折叠时箭头转到了 180°'));
    // 对照组：这些**不该**跟着红 —— 否则说明它们测的其实是别的东西
    expect('仍绿：卡片箭头元素还在', passedWith(c.out, '卡片展开键里有一个箭头元素'));
    expect('仍绿：卡片箭头自己有 transform 过渡', passedWith(c.out, '卡片箭头自己有 transform 过渡'));
    expect('仍绿：卡片箭头与日历的箭头时长一致', passedWith(c.out, '卡片箭头与日历的箭头时长一致'));
    expect('仍绿：卡片折叠区自己有过渡', passedWith(c.out, '卡片折叠区自己有过渡'));
    expect('仍绿：卡片展开（对照组）箭头回到未旋转', passedWith(c.out, '卡片展开（对照组）箭头回到未旋转'));
    // 另一组「展开键」（全屏浮层那个）**完全不该受影响** —— 两套机制互相独立
    expect('仍绿：选项卡那组的箭头仍然会转', passedWith(c.out, '折叠：箭头转到了 180°'));
} finally {
    fs.writeFileSync(PAGE, ORIG);
}

// ── 还原核对 ───────────────────────────────────────────────────
console.log('\n== 还原 ==');
expect('saki.html 与备份逐字节一致', fs.readFileSync(PAGE, 'utf8') === ORIG);
const r = runSuite();
const m = r.out.match(/(\d+) passed, (\d+) failed/);
expect('还原后套件全绿', r.code === 0 && !!m && +m[2] === 0,
    '(' + (m ? m[1] + ' passed / ' + m[2] + ' failed' : '?') + ')');
try { fs.unlinkSync(BAK); } catch (e) {}

console.log(bad ? ('\n❌ ' + bad + ' 条没达到预期') : '\n✅ 这组断言真的会红，而且红的正是该红的那几条');
process.exit(bad ? 1 : 0);
