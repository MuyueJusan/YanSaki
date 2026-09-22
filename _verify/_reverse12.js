// _reverse12.js —— 反向测试 `game-verify.js`（小游戏「复古线框战机」那一套）。
//
// 为什么必须有：`game-verify.js` 报「85 通过 / 0 失败」只说明**这次**没红，
// 不说明它**会**红。一个永远为真的断言会让整套看着很绿、其实什么都没验。
// 这一套里最需要被反向测试的是 **F 段「卸载」** —— 因为那个游戏在非 PLAYING 态
// **照样** requeue rAF，所以「藏起来」和「摘掉」在**画面上完全一样**；
// 要是断言只写了「元素不可见」之类的判据，它会永远为真而没人发现。
//
// ⚠ 注入点在**产品**（`saki.html`），不在套件。每个探针都是**一处**最小改动，
//   跑完立刻还原，收尾核 sha1 —— 不核的话「注入过的产品」会被当成基线。
// ⚠ 每个探针都配了**对照组**（`green`）：那些断言在被注入之后**必须还是绿的**。
//   没有对照组的话，「全红」也能骗过这一关。
// ⚠⚠ 探针点名的断言必须在基线里真的存在（见下面那段存在性闸门）：
//   `red` 里的名字漂了 ⇒「预期该红的都红了」**永远红**；
//   `green` 里的名字漂了 ⇒「对照组一条都没红」**天然成立** —— 对照组被悄悄削弱，
//   而整套照样打 ✅。两边的名单都要查。
//
//   ⚠ 这一套的失败项列表符是 `·`（跟 `sb-verify9.js` 一样，跟 `sb-verify8.js` 的 `-` 不一样）。
//
//   探针 R1：`stShooterUnmount` 整个变空操作 → 三条卸载路径全失效，iframe 留在后台空转
//   探针 R2：挂载时不加宽档               → 弹幕挤在 520px 里（画面问题，功能不受影响）
//   探针 R3：`closeCatGame` 不调 stShooterReset → 只有「关窗」这条路漏了
//   探针 R4：挂载后只调 contentWindow.focus() → 键盘一个键都进不去（实测过的真 bug 复原）
//
// 跑法：node _reverse12.js   （基线 + 4 个探针 = 5 次整跑，约 6 分钟）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const DIR = __dirname;
const PAGE = path.join(DIR, '..', 'saki.html');
const SUITE = path.join(DIR, 'game-verify.js');
const BAK = path.join(DIR, '_reverse12.bak');

// ⚠ 上一次没还原干净就拒绝启动 —— 否则会把「注入过的产品」当成基线备份下来
if (fs.existsSync(BAK)) {
    console.log('⚠ 目录里还留着 _reverse12.bak —— 上一次没还原。' +
        '先人工核对 saki.html，再删掉它重跑。');
    process.exit(1);
}

// ⚠ 原样读，别 replace(/\r/g,'')，否则会把 CRLF 写没
const ORIG = fs.readFileSync(PAGE, 'utf8');
const sha1 = s => crypto.createHash('sha1').update(s, 'utf8').digest('hex');
const H0 = sha1(ORIG);

let bad = 0;
const expect = (name, cond, extra) => {
    console.log((cond ? '  ✅ ' : '  ❌ ') + name + (extra ? '   ' + extra : ''));
    if (!cond) bad++;
};
const nm = s => String(s).trim();

function runSuite() {
    const r = spawnSync(process.execPath, [SUITE], {
        cwd: DIR, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 300000
    });
    return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}
// 汇总行用来确认「确实跑完了」—— 提前退出的话它会缺
function summaryOf(out) {
    const m = out.match(/(\d+)\s*通过\s*\/\s*(\d+)\s*失败/);
    return m ? { pass: Number(m[1]), fail: Number(m[2]) } : null;
}
// 失败项那一列。⚠ 两种列表符都剥（`-` 和 `·`）
function failsOf(out) {
    const i = out.lastIndexOf('失败项：');
    if (i < 0) return [];
    return out.slice(i).split(/\r?\n/).slice(1)
        .map(s => s.replace(/^\s*[-\u00b7]\s*/, '')).map(nm).filter(Boolean);
}
// 基线里**真的绿过**的断言名。
// ⚠⚠ 一律 `nm()`（trim）之后再比：`check()` 打的是 `  ✅ ` + 名字，而**名字自己
//   可能带前导空格**，那个正则的 `\s+` 会把名字自己的空格一起吃掉 ⇒ 抽出来少了空格，
//   而 `red` / `green` 里手抄的是带空格的原文 ⇒ `indexOf` 永远 -1。
function passesOf(out) {
    return (out.match(/^\s*✅\s+(.*)$/gm) || [])
        .map(s => nm(s.replace(/^\s*✅\s*/, '')));
}
// 比对一律过这一道 —— 别在调用点手写 `indexOf(x)`
const hit = (list, x) => list.indexOf(nm(x)) >= 0;

const PROBES = [
    {
        id: 'R1',
        why: '`stShooterUnmount` 整个变空操作 → 三条卸载路径全失效，iframe 留在后台空转',
        // 一行就把卸载打瘸。**这一针打的是整套的核心语义**：
        // 那个游戏的 gameLoop 在非 PLAYING 态照样 requeue，所以「不摘 DOM」= 关掉弹窗
        // 之后还在满帧跑，而**页面上什么都看不见**。
        from: "function stShooterUnmount() {",
        to: "function stShooterUnmount() { return;   // 注入：卸载整个失效",
        red: [
            'iframe 从 DOM 里摘掉了',
            'host 里一个都不剩',
            // ⚠ 这个名字是**固定的**（套件里两个分支合成了一个判据）。
            //   第一版套件把两个分支写成两个名字，结果 R1 注入后走的是另一个分支
            //   ⇒ 这里点了一个基线里查无此人的名字，存在性闸门当场拦下。
            '摘掉之后 rAF 停了',
            // ⚠ 判据是**时长**不是分数。第一版写的是 `这次是全新的一局（分数回到 0）`，
            //   而 R1 注入之后它**照样绿** —— 上一局只跑了 1.5 秒，分数本来就是 0，
            //   「回到 0」天然成立，等于没断言。换成长度之后才真的能红。
            '这次是全新的一局（时长从 0 重新开始）',
            '切到 runner 之后 iframe 没了',
            'host 也空了',
            'doodle：没有 iframe',
            'parade：没有 iframe',
            '关窗后 iframe 摘掉了',
            'host 空了',
            '再打开时是干净的菜单态'
        ],
        // 对照组：**挂载那一路没被动**。它们绿着正好说明这一针打的是「摘」不是「挂」，
        // 也说明 `stShooterReset` 里另外两件事（藏 wrap / 撤宽档）跟卸载是分开的
        green: [
            '菜单态下没有 iframe（对照组）',
            'iframe 挂出来了',
            'host 里正好一个',
            '战机那块显示出来了',
            '画布那块收着（菜单态本来就该收）',
            '战机那块也收着（不是两块都亮着）',
            'activeGameType 清空了',
            'activeGameType 是 runner',
            'doodle：activeGameType 对',
            'parade：十字键露出来了',
            '弹窗关上了'
        ]
    },
    {
        id: 'R2',
        why: '挂载时不加宽档 → 纵向弹幕挤在 520px 的卡片里',
        from: "document.getElementById('gameCard').classList.add('game-card--wide');",
        to: "/* 注入：不加宽 */",
        red: [
            '卡片进了宽档',
            '战机那张卡确实比普通小游戏的卡宽'
        ],
        // 对照组：**撤宽档那一路没被动**（`remove` 还在），所以三处「宽卡片撤了」
        // 一条都不该红 —— 它们绿着才说明红的是「加」不是「撤」。
        // 另外「战机那块显示出来了」绿着 ⇒ 这一针没打到挂载本身。
        green: [
            '菜单态下宽卡片没生效（对照组）',
            '战机那块显示出来了',
            '画布那块收起来了',
            '标题换成了 Retro Vector Shooter.exe',
            '宽卡片撤了',
            '而且 runner 那张不是宽档（对照组）',
            'iframe 挂出来了'
        ]
    },
    {
        id: 'R3',
        why: '`closeCatGame` 不调 stShooterReset → 只有「关窗」这条路漏了',
        // ⚠ 这个锚点**跨行**，所以必须显式写 `\r\n`（产品是 CRLF）。
        //   单行锚点 `stShooterReset();` 在产品里出现 **3 次**，不唯一 —— 加了
        //   `modal.classList.remove('active');` 这行前缀才只命中 closeCatGame。
        from: "modal.classList.remove('active');\r\n" +
              "            if (gameAnimationId) cancelAnimationFrame(gameAnimationId);\r\n" +
              "            stShooterReset();\r\n" +
              "            activeGameType = null;",
        to:   "modal.classList.remove('active');\r\n" +
              "            if (gameAnimationId) cancelAnimationFrame(gameAnimationId);\r\n" +
              "            /* 注入：关窗不卸载 */\r\n" +
              "            activeGameType = null;",
        red: [
            '关窗后 iframe 摘掉了',
            'host 空了',
            // ⚠ 「宽卡片撤了」在基线里**出现两次**（F 段走 showGameMenu、H 段走 closeCatGame）。
            //   这一针只打 closeCatGame，所以 F 段那条绿、H 段那条红 —— 失败项列表里
            //   同名只会出现一次（只有 H 段那条进列表）。所以它**只能**放 red，不能放 green。
            '宽卡片撤了'
        ],
        // 对照组：**showGameMenu 那条路没被动**，所以 F 段那批必须全绿。
        // 「再打开时是干净的菜单态」也绿 —— 它走的是 openCatGame → showGameMenu，
        // 正好证明「关窗漏了」和「回菜单没漏」是两条独立的路，断言没把它们混在一起。
        green: [
            'iframe 从 DOM 里摘掉了',
            'host 里一个都不剩',
            '菜单列表回来了',
            'activeGameType 清空了',
            '战机那块也收着（不是两块都亮着）',
            '再打开时是干净的菜单态',
            '弹窗关上了',
            '先挂上（对照组）'
        ]
    },
    {
        id: 'R4',
        why: '完全不把焦点送进 iframe → 键盘一个键都进不去（真 bug 的复原）',
        // 这一条是**套件先抓出来的**：第一版产品把聚焦放在 `load` 里送，
        // 实测父页面 `activeElement` 还是 BODY、子文档 `hasFocus()` 是 false ——
        // 按 WASD 一点反应都没有，而游戏画面**看不出任何异常**。
        //
        // ⚠⚠ 探针的粒度**必须落在行为上**，不能落在实现细节上。
        //   第一版写的是「只留 `contentWindow.focus()`、把元素 `focus()` 拿掉」，
        //   结果注入之后 87 条**全绿** —— 因为产品改成「挂上去立刻聚焦」之后，
        //   那个时机下调 `contentWindow.focus()` 单独就够了。
        //   ⇒ 这个实现细节**套件分不出来**（它守的是「焦点进没进去」）。
        //     把探针改成「根本不聚焦」才是它真正能证的那件事。
        from: "function stShooterFocus(f) {",
        to: "function stShooterFocus(f) { return;   // 注入：完全不把焦点送进去",
        red: [
            '焦点被接进 iframe 了',
            '真发一个 W：iframe 收到了',
            '而且父页面**没**收到（对照组：键盘是真进去了，不是两边都收）'
        ],
        // 对照组：**游戏本身一点没受影响** —— 它照样装载、照样能点战机卡开局
        // （点卡片是程序化 click，不需要焦点）。它们绿着正好说明红的是「键盘投递」
        // 而不是「iframe 没起来」。
        // `页面本身是聚焦的` 也在里面：这一针不打环境，它必须还是绿的 ——
        // 否则「焦点没进去」就分不清是产品坏了还是 headless 环境没聚焦（白查半天）。
        green: [
            '页面本身是聚焦的（下面两条的前提）',
            '游戏脚本执行完了（startGame 已定义）',
            'canvas 在',
            '初始状态是 MENU（对照组：还没开局）',
            '选机页可见',
            '点得到第一张战机卡',
            'gameState 变成 PLAYING',
            'iframe 挂出来了'
        ]
    }
];

// 先跑一遍**没注入**的，拿到基线（也顺便确认套件本身现在是绿的）
console.log('== 基线（未注入）==');
const base = runSuite();
const bs = summaryOf(base.out);
const basePass = passesOf(base.out);
expect('套件能跑完（有汇总行）', !!bs, JSON.stringify(bs));
expect('基线是绿的（0 失败）', !!bs && bs.fail === 0, JSON.stringify(bs));
console.log('     基线 ' + (bs ? bs.pass : '?') + ' 条绿（这一套的断言总数）');

// ⚠ 基线里一条 ✅ 都没有 ⇒ 下面的「名字还在不在」全部无从谈起，
//   而且 `red` 会一条都匹配不上还打 ✅。直接拦掉
expect('基线里能抽到断言名（否则后面的存在性检查是空转）', basePass.length > 0, basePass.length);

// 先把所有探针点名的断言核一遍存在性 —— 这步**不需要跑套件**，纯离线。
// 名字对不上就直接停，别浪费后面 4 次整跑。
console.log('\n== 探针点名的断言，在基线里都在吗 ==');
let stale = 0;
for (const p of PROBES) {
    const miss = p.red.concat(p.green).filter(x => !hit(basePass, x));
    expect(p.id + ' 点名的 ' + (p.red.length + p.green.length) + ' 条断言都在基线里',
        miss.length === 0, miss.length ? '找不到：' + miss.join(' / ') : '');
    stale += miss.length;
}
if (stale) {
    console.log('\n⚠ 有 ' + stale + ' 条探针期望对不上基线 —— 后面的整跑没有意义，先修期望。');
    process.exit(1);
}

for (const p of PROBES) {
    console.log('\n== ' + p.id + '：' + p.why + ' ==');
    const cnt = ORIG.split(p.from).length - 1;
    expect('注入点在产品里唯一（命中 ' + cnt + ' 次）', cnt === 1, cnt);
    if (cnt !== 1) { bad++; continue; }

    fs.writeFileSync(BAK, ORIG, 'utf8');
    fs.writeFileSync(PAGE, ORIG.replace(p.from, p.to), 'utf8');
    let r;
    try {
        r = runSuite();
    } finally {
        fs.writeFileSync(PAGE, ORIG, 'utf8');   // 无论跑成什么样都先还原
    }
    const s = summaryOf(r.out);
    const got = failsOf(r.out);

    expect('注入后套件跑完了（有汇总行）', !!s, JSON.stringify(s));
    expect('  退出码是 1', r.code === 1, r.code);
    expect('  确实红了（失败数 > 0）', !!s && s.fail > 0, s && s.fail);

    const missRed = p.red.filter(x => !hit(got, x));
    expect('预期该红的都红了（' + p.red.length + ' 条）', missRed.length === 0, missRed);
    const badGreen = p.green.filter(x => hit(got, x));
    expect('对照组一条都没红（' + p.green.length + ' 条）', badGreen.length === 0, badGreen);
    expect('没有预期之外的红（恰好这几条）', got.length === p.red.length,
        '实际 ' + got.length + ' 条' + (got.length === p.red.length ? '' : '：' + got.join(' / ')));

    expect('还原后产品与基线逐字节一致', sha1(fs.readFileSync(PAGE, 'utf8')) === H0);
}

// 收尾：备份文件必须删掉，且产品没被动过
if (fs.existsSync(BAK)) fs.unlinkSync(BAK);
console.log('\n== 收尾 ==');
expect('没留下 .bak', !fs.existsSync(BAK));
expect('saki.html 与基线逐字节一致', sha1(fs.readFileSync(PAGE, 'utf8')) === H0);

console.log('\n===== 反向测试（小游戏·复古线框战机）：' + (bad ? bad + ' 项不达标' : '全部达标') + ' =====');
process.exit(bad ? 1 : 0);
