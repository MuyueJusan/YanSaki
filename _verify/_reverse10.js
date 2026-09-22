// _reverse10.js —— 反向测试 `sb-verify8.js`（状态栏「预制块」那一套）。
//
// 为什么必须有：`sb-verify8.js` 报「113 通过 / 0 失败」只说明**这次**没红，
// 不说明它**会**红。一个永远为真的断言（比如「绑定成功」和「绑定失败」在
// 路径和显示名上长得一模一样）会让整套看着很绿、其实什么都没验。
//
// ⚠ 注入点在**产品**（`saki.html`），不在套件。每个探针都是**一处**最小改动，
//   跑完立刻还原，收尾核 sha1 —— 不核的话「注入过的产品」会被当成基线。
// ⚠ 每个探针都配了**对照组**（`green`）：那些断言在被注入之后**必须还是绿的**。
//   没有对照组的话，「全红」也能骗过这一关。
// ⚠⚠ 第 9 轮补的一道闸门：**探针点名的断言必须在基线里真的存在**（`passesOf` + `hit`）。
//   `green` 里放一个不存在的名字，「对照组一条都没红」**天然成立** —— 对照组被悄悄削弱、
//   而探针照样全绿。名单对不上就**直接退出**。（`_reverse11.js` 首次跑就抓到 4 处。）
//
//   探针 R1：关键词匹配整个失效（一律 continue）→ 全部走兜底路径
//   探针 R2：复数版三个槽全取 hits[0]        → 三个槽绑同一个变量
//   探针 R3：克隆时不换 id                    → 同 id 串味
//   探针 R4：插入时永远落根上                 → 「选中分组就进分组」失效
//
// 跑法：node _reverse10.js   （约 1.5 分钟）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const DIR = __dirname;
const PAGE = path.join(DIR, '..', 'saki.html');
const SUITE = path.join(DIR, 'sb-verify8.js');
const BAK = path.join(DIR, '_reverse10.bak');

// ⚠ 上一次没还原干净就拒绝启动 —— 否则会把「注入过的产品」当成基线备份下来
if (fs.existsSync(BAK)) {
    console.log('⚠ 目录里还留着 _reverse10.bak —— 上一次没还原。' +
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
// 失败项那一列。⚠ 两种列表符都剥（`-` 和 `·`）—— 同目录里 `sb-verify9.js` 用的是 `·`，
//   只剥 `-` 的话会一条都匹配不上，而且表现为「对照组没红 ✅」，看着像过了
function failsOf(out) {
    const i = out.lastIndexOf('失败项：');
    if (i < 0) return [];
    return out.slice(i).split(/\r?\n/).slice(1)
        .map(s => s.replace(/^\s*[-\u00b7]\s*/, '')).map(nm).filter(Boolean);
}
// 基线里**真的绿过**的断言名。用来核「探针点名的断言还在不在」
// ⚠ 两边都要 `nm()`（trim）：`check()` 打的是 `  ✅ ` + 名字，而**名字自己可能带前导空格**
//   （`check('  是摊平不是砍掉…')`）—— 正则里的 `\s+` 会把那个空格一起吃掉，
//   抽出来的名字少两个空格，跟手抄的名单对不上 ⇒ `indexOf` 永远 -1
function passesOf(out) {
    return (out.match(/^\s*✅\s+(.*)$/gm) || [])
        .map(s => nm(s.replace(/^\s*✅\s*/, '')));
}
// 比对一律过这一道 —— 别在调用点手写 `indexOf(x)`
const hit = (list, x) => list.indexOf(nm(x)) >= 0;

const PROBES = [
    {
        id: 'R1',
        why: '单个绑的关键词匹配失效 → 每个槽都走兜底路径',
        from: "if (!ks.length || !ks.some(k => nm.indexOf(k) >= 0)) continue;",
        to: "if (true) continue;",
        red: [
            '路径自动绑到了卡里那条变量',
            '用**变量自己的**上限 150（不是预制块默认的 100）',
            '下限也是变量自己的 10',
            '显示名跟变量名一致',
            '提示说变量都绑上了',
            '不再是 warn 样式'
        ],
        // 对照组：
        //   · 「第三个用兜底路径」「三条路径互不相同」—— 兜底路径本来就是角色C、
        //     三条兜底本来就互不相同，所以全走兜底它们照样对
        //   · F 段那几条 —— **复数走的是另一个函数**（stSbPrefabBindMany），
        //     这一针打不到它。它们绿着正好证明这一针的范围是准的
        //     （第一版把 F 段也算进 red，跑出来才知道打错了对象 —— 那是探针的错，不是产品的）
        green: [
            '加进去 1 块',
            '路径是兜底值',
            '第三个用兜底路径',
            '⚠ 三条路径互不相同（复数不能全绑同一个变量）',
            '变量树里有了 血量（10~150）',
            '又加了一块',
            '前两个绑到卡里那两个角色',
            '范围也各是各的（用的是变量自己的 80 / 90）',
            '第一列绑到了小猫'
        ]
    },
    {
        id: 'R1b',
        why: '复数版的关键词匹配失效 → 三个槽全走兜底路径',
        from: "                return ks.some(k => nm.indexOf(k) >= 0);",
        to: "                return false;",
        red: [
            '前两个绑到卡里那两个角色',
            '显示名各是各的',
            '范围也各是各的（用的是变量自己的 80 / 90）',
            '提示说了 2/3 绑上了',
            '第一列绑到了小猫'
        ],
        // 对照组：单个绑那条路没被动，D 段必须全绿；三条兜底路径仍然互不相同
        green: [
            '路径自动绑到了卡里那条变量',
            '用**变量自己的**上限 150（不是预制块默认的 100）',
            '提示说变量都绑上了',
            '第三个用兜底路径',
            '⚠ 三条路径互不相同（复数不能全绑同一个变量）'
        ]
    },
    {
        id: 'R2',
        why: '复数版三个槽全取 hits[0] → 三个槽绑同一个变量',
        from: "const h = hits[i];",
        to: "const h = hits[0];",
        red: [
            '前两个绑到卡里那两个角色',
            '第三个用兜底路径',
            '⚠ 三条路径互不相同（复数不能全绑同一个变量）',
            '显示名各是各的',
            '范围也各是各的（用的是变量自己的 80 / 90）',
            // 三个槽都绑上了 → 提示从「2/3」变成「都绑上了」。
            // ⚠ 这条第一版没料到，跑出来才发现：**提示语本身也是判据的一部分**
            '提示说了 2/3 绑上了',
            '列里的路径也各是各的'
        ],
        // 对照组：单个绑的那条路（stSbPrefabBind）没被动，D 段必须全绿
        green: [
            '路径自动绑到了卡里那条变量',
            '用**变量自己的**上限 150（不是预制块默认的 100）',
            '提示说变量都绑上了',
            '又加了一块',
            '第一列绑到了小猫'
        ]
    },
    {
        id: 'R3',
        why: '克隆时不换 id → 同 id 串味',
        // ⚠ 锚点必须**落在同一行**：产品是 CRLF，带 `\n` 的多行锚点一次都匹配不上
        //   （实测命中 0 次，第一版就是这么翻的）
        from: "                const reid = n => { n.id = stUuid(); (n.children || []).forEach(reid); };",
        to: "                const reid = n => { /* 注入：不换 id */ };",
        red: ['⚠ 插了两份之后所有块 id 仍然唯一（换 id 那条路真跑了）'],
        green: [
            '点自己的预制块 = 整组加进画布',
            '⚠ 插回来路径原样 —— 用户存的组不会被自动重绑',
            '刷新之后自己攒的还在'
        ]
    },
    {
        id: 'R4',
        why: '插入时永远落根上 → 「选中分组就进分组」失效',
        from: "            const cid = (sel && stSbIsBox(sel.block)) ? sel.block.id : '';",
        to: "            const cid = '';",
        red: [
            '选中分组 → 根层一块没多',
            '分组里多了 2 块',
            '新块的类型对'
        ],
        // 对照组：不选中时本来就落根上，那两条（增量式）必须还绿。
        // ⚠ 这两条第一版写的是**绝对值**，注入之后跟着红了 —— 那不是「对照组坏了」，
        //   是它们被上游那次失败带塌了。改成增量之后才是真对照
        green: [
            '先造了个分组（根层 3 块）',
            '对照组：没选中分组 → 落在根上（根层 +2）',
            '→ 分组里一块没多'
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
expect('基线里能抽到断言名（否则后面的存在性检查是空转）', basePass.length > 0, basePass.length);

// ⚠⚠ **探针点名的断言，必须在基线里真的存在。** 名单是**手抄**的，手抄的会漂：
//   ① `red` 里有个不存在的名字 ⇒「预期该红的都红了」会**永远红**（于是你去查产品）；
//   ② `green` 里有个不存在的名字 ⇒「对照组一条都没红」**天然成立** ——
//      **对照组被悄悄削弱了，而探针照样打 ✅**。
//   第 9 轮在 `_reverse11.js` 上第一次跑就抓到 4 处（3 处断言名带前导空格 + 1 处抄错名，
//   而抄错的那个正在 `green` 里）。这一套补上同一道闸门 —— 见 `RULES.md` 六之七。
//   名字对不上就直接停，别浪费后面 5 次整跑。
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

console.log('\n===== 反向测试（预制块）：' + (bad ? bad + ' 项不达标' : '全部达标') + ' =====');
process.exit(bad ? 1 : 0);
