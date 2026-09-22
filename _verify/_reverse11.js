// _reverse11.js —— 反向测试 `sb-verify9.js`（状态栏「AI 生成预制块」那一套）。
//
// 为什么必须有：`sb-verify9.js` 报「123 通过 / 0 失败」只说明**这次**没红，
// 不说明它**会**红。一个永远为真的断言会让整套看着很绿、其实什么都没验。
//
// ⚠ 注入点在**产品**（`saki.html`），不在套件。每个探针都是**一处**最小改动，
//   跑完立刻还原，收尾核 sha1 —— 不核的话「注入过的产品」会被当成基线。
// ⚠ 每个探针都配了**对照组**（`green`）：那些断言在被注入之后**必须还是绿的**。
//   没有对照组的话，「全红」也能骗过这一关。
//
// ⚠⚠ 这一套比 `_reverse10.js` 多了一道闸门：**探针点名的断言，必须在基线里真的存在**。
//   断言被改名 / 删掉之后，`red` 会一条都匹配不上，于是「预期该红的都红了」这行
//   会因为「一条都没有」而**照样打 ✅** —— 反向测试静默失效。
//   这就是「枚举不完整时不会红，只会少走」的那一类，所以这里主动查一遍。
//   **第一次跑就抓到 4 处**：3 处是断言名带前导空格（抽 ✅ 时被正则吃掉）+ 1 处抄错名，
//   而抄错的那个在 `green` 里 —— 对照组里放一个不存在的名字，「一条都没红」**天然成立**，
//   探针照样全绿。⇒ 这道闸门两边的名单都要查，不能只查 `red`。
//
// ⚠⚠ 失败项的列表符**两套件不一样**：`sb-verify8.js` 是 `  - 名字`，
//   而 `sb-verify9.js` 是 `  · 名字`。照抄 `_reverse10.js` 的 `failsOf`（只剥 `-`）
//   会一条都匹配不上 —— 而且表现为「对照组一条都没红 ✅ / 没有预期之外的红 ✅」，
//   看着像过了。下面两个都剥。
//
//   探针 R1：深度上限退回「只在块数超了才生效」 → 一棵「块不多但很深」的树绕过封顶
//   探针 R2：清洗整段失效                      → 模型塞的 offX / clsMap 真的生效了
//   探针 R3：同名不换编号（直接返回原名）       → 「不覆盖别人的预制块」这条语义没了
//   探针 R4：提示词不喂真实变量路径             → 模型只能自己编 stat_data.生命值
//
// 跑法：node _reverse11.js   （基线 + 4 个探针 = 5 次整跑，约 6 分钟）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const DIR = __dirname;
const PAGE = path.join(DIR, '..', 'saki.html');
const SUITE = path.join(DIR, 'sb-verify9.js');
const BAK = path.join(DIR, '_reverse11.bak');

// ⚠ 上一次没还原干净就拒绝启动 —— 否则会把「注入过的产品」当成基线备份下来
if (fs.existsSync(BAK)) {
    console.log('⚠ 目录里还留着 _reverse11.bak —— 上一次没还原。' +
        '先人工核对 saki.html，再删掉它重跑。');
    process.exit(1);
}

const ORIG = fs.readFileSync(PAGE, 'utf8');   // ⚠ 原样读，别 replace(/\r/g,'')，否则会把 CRLF 写没
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
// 汇总行（`N 通过 / M 失败`）用来确认「确实跑完了」—— 提前退出的话它会缺
function summaryOf(out) {
    const m = out.match(/(\d+)\s*通过\s*\/\s*(\d+)\s*失败/);
    return m ? { pass: Number(m[1]), fail: Number(m[2]) } : null;
}
// 失败项那一列。⚠ 两种列表符都剥（`-` 和 `·`，见文件头）
function failsOf(out) {
    const i = out.lastIndexOf('失败项：');
    if (i < 0) return [];
    return out.slice(i).split(/\r?\n/).slice(1)
        .map(s => s.replace(/^\s*[-\u00b7]\s*/, '')).map(nm).filter(Boolean);
}
// 基线里**真的绿过**的断言名。用来核「探针点名的断言还在不在」
//
// ⚠⚠ 一律 `nm()`（trim）之后再比。`check()` 打的是 `  ✅ ` + 名字，而**名字自己
//   可能带前导空格**（`check('  是摊平不是砍掉…')`）—— 上面这个正则的 `\s+` 会把
//   那个空格一起吃掉，于是抽出来的名字**少了两个空格**，而 `red` / `green` 里
//   手抄的是带空格的原文 ⇒ `indexOf` 永远 -1。
//   （第一版就是这么翻的：R1 报「3 条找不到」、R3 报「5 条找不到」，看着像探针写错了，
//     其实是比对方式不对。**两边都 trim 才是同一个名字。**）
function passesOf(out) {
    return (out.match(/^\s*✅\s+(.*)$/gm) || [])
        .map(s => nm(s.replace(/^\s*✅\s*/, '')));
}
// 比对一律过这一道 —— 别在调用点手写 `indexOf(x)`
const hit = (list, x) => list.indexOf(nm(x)) >= 0;

const PROBES = [
    {
        id: 'R1',
        why: '深度上限退回「只在块数超了才生效」→ 深树绕过封顶',
        // 这是本套件 G 段抓到的**真 bug** 的复原。修复前就是这一行少了一个 `||` 分支：
        // 一棵「5 块、深 5 层」的树块数没超 24，裁剪根本没跑，深度上限形同虚设。
        from: "if (cap.n > ST_SB_AI_MAX_BLOCKS || cap.deep > ST_SB_AI_MAX_DEEP) {",
        to: "if (cap.n > ST_SB_AI_MAX_BLOCKS) {   // 注入：深度上限失效",
        red: ['嵌套 5 层被摊到深度 3'],
        // 对照组：**块数那一路没被动**，40 块照样裁到 24；而且这棵树本身没被裁，
        // 所以「块一块没少 / 没裁成空 / 文字还在」三条**必须还是绿的** ——
        // 它们绿着正好说明这一针打的是「深度上限」，不是「裁剪整个坏了」
        green: [
            '40 块被裁到上限 24 块',
            '裁完前 24 条顺序没乱',
            '裁完第 24 条是 t23',
            '  是摊平不是砍掉 —— 5 块一块没少',
            '  没被裁成空（还是 ok）',
            '  「太深了」那句还在（真的没丢内容）'
        ]
    },
    {
        id: 'R2',
        why: '清洗整段失效 → 模型塞的 offX / extra / clsMap 真的生效了',
        // 一行就能把整个 `stSbAiClean` 打瘸：拿到白名单块之后**立刻返回**，
        // 下面那三行归零全被跳过（连递归子块也一起跳过）
        from: "const b = stSbBlockFromRaw(raw);",
        to: "const b = stSbBlockFromRaw(raw); return b;   // 注入：清洗整段失效",
        red: [
            'offX 被归零', 'offY 被归零', 'w 被归零', 'h 被归零',
            'extra 被清空', 'extraInner 被清空', 'extraFill 被清空', 'wrapExtra 被清空',
            'clsMap 被清空', 'clsOwn 被清空',
            '子块也被清洗过（递归，不是只看第一层）',
            '子块的 clsMap 也被清了'
        ],
        // 对照组：**合法外观字段必须原样留住**。这 9 条在注入之后一条都不该红 ——
        // 它们绿着才能证明「红的是清洗，不是块被清空了」
        green: [
            '对照组：path 留住了',
            '对照组：label 留住了',
            '对照组：min 留住了',
            '对照组：max 留住了（变量自己的范围）',
            '对照组：size 留住了',
            '对照组：color 留住了',
            '对照组：height 留住了',
            '对照组：bold 留住了',
            '子块的 path 留着（对照）'
        ]
    },
    {
        id: 'R3',
        why: '同名不换编号（直接返回原名）→ 「不覆盖」这条语义没了',
        from: "if (!list.some(it => it.name === base)) return base;",
        to: "if (true) return base;   // 注入：同名直接覆盖",
        red: [
            '  新的那条叫「战斗面板 2」',
            '提示里说了名字重了'
        ],
        // 对照组：
        //   · 「同名不覆盖，变成两条」—— 存储是**追加**的（`list.concat([item])`），
        //     所以即使名字撞了也还是两条。它绿着说明这一针没打到存储层，
        //     只打到了命名策略（探针范围是准的）
        //   · 「旧的那条名字没动」—— 名字撞了也还是原名，两个方向都绿 ⇒ 真对照
        //   · 刷新那三条 —— 验的是持久化，跟命名无关
        green: [
            '同名不覆盖，变成两条',
            '  旧的那条名字没动（对照组）',
            '  旧的那条内容也没动（块数仍是 2）',
            '  新的那条是新内容（1 块）',
            '存进了「我的预制块」',
            '刷新整页之后还在',
            '  名字还是那个'
        ]
    },
    {
        id: 'R4',
        why: '提示词不喂真实变量路径 → 模型只能自己编 stat_data.生命值',
        // ⚠ 不能用 `const paths = stSbVarPaths();` 当锚点 —— 那行在产品里出现 **2 次**，
        //   锚点不唯一，`split` 计数会当场拦下来（这一条是探针自己的守卫）
        from: "return '- ' + p.path + '（' + (p.type || '?') + rng + '）';",
        to: "return '';   // 注入：不喂变量路径",
        red: [
            'user 里喂了卡里真实的变量路径 stat_data.hp',
            'user 里喂了第二个变量 stat_data.affection',
            'user 里带上了变量自己的范围 0~150',
            '负范围也照样带出来（-100~100）'
        ],
        // 对照组：**「卡里没变量」那条兜底话术走的是另一个分支**（`lines.length` 为 0），
        // 这一针打不到它。它绿着正好证明红的是「喂路径」而不是「提示词整个坏了」
        green: [
            '卡里没变量时，明说「还没建变量」',
            '而且不再列变量清单',
            'user 里有用户那句描述',
            'user 里说了当前主题',
            'system 里 9 种块类型一个不少',
            '生成完忙态归位',
            '生成完按钮恢复可点'
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

// 先把所有探针点名的断言核一遍存在性 —— 这步**不需要跑套件**，纯离线
//
// ⚠⚠ 这一道不是装饰，它挡的是**两类静默失效**：
//   ① `red` 里有个不存在的名字 ⇒「预期该红的都红了」会**永远红**，你会去查产品；
//   ② `green` 里有个不存在的名字 ⇒「对照组一条都没红」**天然成立** ——
//      **对照组被悄悄削弱了，而整套照样打 ✅**。（第一版 R4 就踩了这个：
//      `user 里说了当前状态栏主题` 抄错成 `…当前主题` 之外的名字，探针**照样全绿**。）
//   两类都是「断言名漂了，反向测试却还在打 ✅」。所以名字对不上就直接停，
//   别浪费后面 4 次整跑（每次约 40 s）。
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

console.log('\n===== 反向测试（AI 生成预制块）：' + (bad ? bad + ' 项不达标' : '全部达标') + ' =====');
process.exit(bad ? 1 : 0);
