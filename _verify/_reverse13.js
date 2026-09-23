// _reverse13.js —— 反向测试 `persona-verify.js`（第十一轮「人设生成器」那一套）。
//
// 为什么必须有：`persona-verify.js` 报「188 通过 / 0 失败」只说明**这次**没红，
// ⚠ 上面这个数字**会漂**（每加一段断言就变），以实际跑出来为准 —— 别拿它当判据。
// 不说明它**会**红。一个永远为真的断言会让整套看着很绿、其实什么都没验。
// 这一套里最需要被反向测试的是这几件事：
//   ① 模板「清空 = 回到默认」—— 这条**差点写成永远为真**：面板上写着这句承诺，
//      而当时 `stPersonaTpl()` 会把内存里的空串原样返回 ⇒ 标签说「（默认）」、
//      框里是空的、点生成又报「模板是空的」。**写套件的时候才发现**，顺手修了。
//      所以必须有一个探针把它按回去，证明这条断言真的盯着它。
//   ② 覆盖非空角色描述**必须弹 confirm** —— 「生成的东西必须先能反悔」这条规矩里
//      唯一不可逆的动作。断言写成「弹过 confirm」很容易，写成「不弹就红」才算数。
//   ③ 围栏清洗 —— 洗多了会吃掉真正的第一行，而**输出照样有内容、照样能写进卡**，
//      肉眼看不出来。所以「没包围栏的不许动」和「包围栏的必须洗」要成对存在。
//   ④ 全角冒号 —— 用户给的那份模板里半角 / 全角是混着用的，只认半角的话
//      会静默少掉 9 个字段，而**面板照样渲染、生成照样成功**。
//   ⑤ 「模板默认折叠」（第十二轮加）—— 「收起了」这类断言**最容易写成恒真**：
//      折叠靠 `grid-template-rows: 0fr` + `overflow: hidden`，而**裁切不影响
//      `getBoundingClientRect()`**（里面 textarea 的 rect 照样满高）⇒ 拿 rect 当判据
//      的话，「收起了」和「展开了」量出来一模一样。所以那几条必须**成对**存在
//      （收起量外层网格 + 命中测试在外 / 展开量同样两样在内），R6 就是来把按钮打断，
//      证明展开那半边**真的会红**。
//   ⑥ 「工作状态挪到按钮上方」（第十三轮加）—— 「挪」和「再抄一份」在画面上很像：
//      消息**同时**出现在页内格和常驻条里，用户看到的就是同一句话两遍。所以 R7 拆常驻条的
//      让位判定、R8 拆 `scope` 的存储，上游下游各打一针。
//   ⑦ 「生成结果追加到世界书 / 要不要拿卡名当人物姓名」（第十四轮加）——
//      前者的坑是「提示说成功了，条目却没进卡」（报的是 `a.length`，那个数根本不会变），
//      所以 R9 拆 push；后者的坑是「勾选框点得动、状态也真的变成 false，
//      但喂给模型的提示词里卡名照旧」—— 只看状态抓不到，所以 R10 拆的是**读**那一端。
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
//   ⚠ 这一套的失败项列表符是 `-`（`persona-verify.js` 的 `fails.join('\n  - ')`）。
//
//   探针 R1：`stPersonaTpl()` 不再「空则回落默认」 → 清空模板之后面板自相矛盾
//   探针 R2：`stPersonaApply` 去掉覆盖前的 confirm   → 直接抹掉别人手写的角色描述
//   探针 R3：`stPersonaText` 去掉围栏清洗             → 整份输出带着 ``` 进卡
//   探针 R4：`stPersonaLabels` 只认半角冒号          → 静默少认 9 个字段
//   探针 R5：`stPersonaTplSet` 清空时存空串而不是删键 → 「是不是默认」再也分不出来
//   探针 R6：`stPersonaTplToggle` 点了也不开       → 展开态那几条断言必须红（第十二轮）
//   探针 R7：`stPaintMsg` 常驻条不再让位            → 同一句话在页内格和常驻条**同时**出现（第十三轮）
//   探针 R8：`stExportMsg` 不再记 scope            → 消息全退回常驻条，页内格永远空着（第十三轮）
//   探针 R9：`stPersonaApply('book')` 不 push        → 按钮点了没反应，而提示照样说「已追加」（第十四轮）
//   探针 R10：`stPersonaNameUse()` 恒为真           → 取消了勾选也照样把卡名喂给 AI（第十四轮）
//
// 跑法：node _reverse13.js   （基线 + 10 个探针 = 11 次整跑）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const DIR = __dirname;
const PAGE = path.join(DIR, '..', 'saki.html');
const SUITE = path.join(DIR, 'persona-verify.js');
const BAK = path.join(DIR, '_reverse13.bak');

// ⚠ 上一次没还原干净就拒绝启动 —— 否则会把「注入过的产品」当成基线备份下来
if (fs.existsSync(BAK)) {
    console.log('⚠ 目录里还留着 _reverse13.bak —— 上一次没还原。' +
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
// 失败项那一列。⚠ 两种列表符都剥（`-` 和 `·`）—— 同族套件用的不一样，
//   照抄上一套的写法会**一条都匹配不上**，而且表现为「对照组没红 ✅」，看着像过了
function failsOf(out) {
    const i = out.lastIndexOf('失败项：');
    if (i < 0) return [];
    return out.slice(i).split(/\r?\n/).slice(1)
        .map(s => s.replace(/^\s*[-\u00b7]\s*/, '')).map(nm).filter(Boolean);
}
// 基线里**真的绿过**的断言名。
// ⚠⚠ 一律 `nm()`（trim）之后再比：`check()` 打的是 `  ✅ ` + 名字，而**名字自己
//   可能带前导空格**，那个正则的 `\s+` 会把名字自己的空格一起吃掉。
function passesOf(out) {
    return (out.match(/^\s*✅\s+(.*)$/gm) || [])
        .map(s => nm(s.replace(/^\s*✅\s*/, '')));
}
// 比对一律过这一道 —— 别在调用点手写 `indexOf(x)`
const hit = (list, x) => list.indexOf(nm(x)) >= 0;

const PROBES = [
    {
        id: 'R1',
        why: '`stPersonaTpl()` 不再「空则回落默认」 → 清空模板之后面板自相矛盾',
        // 这一针就是**我写套件时发现并修掉的那个 bug 的复原**。
        // 修之前：`stPersonaTplSet('')` 把内存设成空串、键删掉，
        // 而 `stPersonaTpl()` 因为 `typeof === 'string'` 就直接返回那个空串 ——
        // 于是标签（问 localStorage）说「（默认）」、框里是空的、点生成报「模板是空的」。
        from: "            return stEditor.personaTpl.trim() ? stEditor.personaTpl : ST_PERSONA_TPL_DEFAULT;",
        to:   "            return stEditor.personaTpl;   // 注入：空串不再回落默认",
        red: [
            '清空之后 stPersonaTpl() 回落到默认模板（不然面板会说「默认」却给空模板）',
            '重绘之后模板框里是默认模板（不是空的）'
        ],
        // 对照组：**「从 localStorage 读回来」那一路没被动** —— 内存是 null 时照样读盘，
        // 所以「刷新之后模板还在」「内存清空后能读回来」必须还是绿的。
        // 它们绿着正好说明这一针打的是「空串回落」而不是「懒加载」
        green: [
            '默认模板**逐字**等于用户给的那份',
            '模板框里显示的就是它',
            '标签写着「（默认）」',
            '项数跟独立算出来的一致',
            '模板写进了状态',
            '而且存进了 localStorage',
            '刷新之后模板还在（读的就是刚才存的那份）',
            '刷新之后模板框里也是它',
            '内存清空后 stPersonaTpl() 能从 localStorage 读回来',
            '超长模板被截到上限',
            '点「恢复默认模板」之后模板回到默认'
        ]
    },
    {
        id: 'R2',
        why: '`stPersonaApply` 去掉覆盖前的 confirm → 直接抹掉别人手写的角色描述',
        from: "            if (cur.trim() && !window.confirm('角色描述里已经有 ' + cur.length +\r\n" +
              "                ' 个字符，「写入」会**整个替换**掉它。要继续吗？')) {\r\n" +
              "                stExportMsg('已取消 —— 角色描述没动。', 'warn', 'persona');\r\n" +
              "                return;\r\n" +
              "            }",
        to:   "            /* 注入：覆盖非空描述不再问 */",
        red: [
            '非空描述 ⇒ 弹了 confirm',
            'confirm 的话里说了会整个替换',
            '答「不要」⇒ 角色描述**一点没动**',
            '答「不要」⇒ 提示说已取消',
            '非空描述 ⇒ 也弹了 confirm（对照组）'
        ],
        // 对照组：**追加那一路和空描述那一路都没被动**。它们绿着正好说明
        // 红的是「覆盖非空时少问了一句」，不是「写入整体坏了」
        green: [
            '空描述 ⇒ 直接写进去',
            '空描述 ⇒ **不弹** confirm（没东西可覆盖）',
            '提示说已写入',
            '追加 ⇒ 不弹 confirm',
            '追加之后原文还在开头',
            '追加之后新内容接在后面（中间空一行）',
            '追加的提示说「已追加」',
            '答「要」⇒ 整个替换成新内容',
            '没有结果时点写入 ⇒ 提示「还没有生成结果」',
            '没有结果时点写入 ⇒ 卡没动',
            '没有结果时点写入 ⇒ 不弹 confirm',
            '没有结果时点追加 ⇒ 卡也没动',
            '描述是纯空白时追加 ⇒ 不留空行开头'
        ]
    },
    {
        id: 'R3',
        why: '`stPersonaText` 去掉围栏清洗 → 整份输出带着 ``` 进卡',
        // ⚠ 这个锚点**跨行**，所以必须显式写 `\r\n`（产品是 CRLF）。
        //   单行锚点会匹配不上，而症状是「注入点命中 0 次」——还算好抓
        from: "            const fence = s.match(/^```[a-zA-Z]*\\n([\\s\\S]*?)\\n?```$/);\r\n" +
              "            if (fence) s = fence[1].trim();",
        to:   "            /* 注入：不清洗围栏 */",
        red: [
            '围栏被洗掉了',
            '洗完之后第一行就是正文（没有 ``` 残留）',
            '带语言标记的围栏也洗掉了'
        ],
        // 对照组：**没包围栏的那条没被动** —— 它绿着才说明这一针打的是「洗」，
        // 不是「把第一行也一起吃了」。这也是「洗多了」唯一会被抓到的地方
        green: [
            '结果进了状态',
            '面板上出现了结果框',
            '结果框里的内容跟状态一致',
            '三个按钮都出来了',
            '空态没了',
            '提示说「对上了 3 项」',
            '全中 ⇒ 提示是 ok（不是 warn）',
            '小标题报了几字符 + 对上几项',
            '漏了 1 项 ⇒ 提示说「1 项没出现」',
            '没包围栏的原样留着（清洗不许吃掉第一行）',
            '首行没有被吃掉',
            '空回复 ⇒ 报「模型返回了空内容」'
        ]
    },
    {
        id: 'R4',
        why: '`stPersonaLabels` 只认半角冒号 → 静默少认 9 个字段',
        // 用户给的那份模板里半角 / 全角是**混着用**的（`三围：`、`- 风格：`、`补充：`…）。
        // 只认半角的话：面板照样渲染、生成照样成功、提示照样打 ✅ ——
        // 只有「项数」悄悄变小。所以这一条只能靠**独立算一遍**来抓
        from: "                const m = line.match(/^[\\s\\-]*([^:：\\n]{1,12})[:：]\\s*$/);",
        to:   "                const m = line.match(/^[\\s\\-]*([^:\\n]{1,12}):\\s*$/);   // 注入：只认半角",
        red: [
            '项数跟独立算出来的一致',
            '全角冒号那几行也认（三围 / 气味 / 泳装 / 内衣）',
            '「风格」只算了一项',
            '末项是「补充」',
            '标签上写了项数'
        ],
        // 对照组：**半角那一半没被动**。它们绿着正好说明红的是「全角漏了」，
        // 不是「一个字段都没认出来」
        green: [
            '默认模板**逐字**等于用户给的那份',
            '模板框里显示的就是它',
            '项数里没有重复（风格 / 标志性穿着 / 配饰习惯 各出现 3 次，只能算一项）',
            '首项是「基本信息」',
            '模板写进了状态',
            '清空之后 stPersonaTpl() 回落到默认模板（不然面板会说「默认」却给空模板）',
            '提示说「对上了 3 项」'
        ]
    },
    {
        id: 'R5',
        why: '`stPersonaTplSet` 清空时存空串而不是删键 → 「是不是默认」再也分不出来',
        // ⚠ 探针粒度落在**存储**上，不落在显示上 —— 因为显示那一层
        //   （`stPersonaTplIsDefault` 的 `v.trim()`）本来就容得下空串，
        //   所以这一针**只该红一条**。多红了说明套件里有别的东西顺带盯着存储，
        //   那是意外耦合，值得看一眼
        from: "                if (!s.trim()) localStorage.removeItem(ST_PERSONA_TPL_KEY);\r\n" +
              "                else localStorage.setItem(ST_PERSONA_TPL_KEY, s);",
        to:   "                localStorage.setItem(ST_PERSONA_TPL_KEY, s);   // 注入：清空也存空串",
        red: [
            '清空之后 localStorage 的键被删了（不是存了个空串）'
        ],
        green: [
            '清空之后「是不是默认」为 true',
            '清空之后 stPersonaTpl() 回落到默认模板（不然面板会说「默认」却给空模板）',
            '重绘之后模板框里是默认模板（不是空的）',
            '而且存进了 localStorage',
            'localStorage 的键也被清掉了'
        ]
    },
    {
        id: 'R6',
        why: '`stPersonaTplToggle` 点了也不开 → 「默认折叠」那几条会永远为真（第十二轮新增）',
        // ⚠ 这一针**故意只打「打不开」**，不打「默认折叠」：默认折叠那几条在基线里本来就绿着，
        //   要证的是它们**不是恒真** —— 一旦按钮失效，跟它们**成对**的展开态断言必须红。
        //   所以红名单**全部落在展开态**（p1 那一段），收起态 / 位置 / 重绘那些留作对照组。
        from: "            stEditor.personaTplOpen = !(stEditor.personaTplOpen === true);",
        to:   "            stEditor.personaTplOpen = false;   // 注入：点了也不开",
        red: [
            '展开后拿到了 st-fold-open 类',
            '展开后 aria-expanded 是 true',
            '展开后折叠体不再是 0 行',
            '展开后折叠体真的有了高度',
            '展开后命中测试打在折叠块**里面**',
            '展开后箭头转回正（computed transform 是 none）'
        ],
        // 对照组：**收起态那半边一条都不许红**。它们绿着正好说明红的是「打不开」，
        // 而不是「折叠块整个坏了」—— 也顺带说明「默认折叠」那几条盯的是真状态
        green: [
            '默认**没有** st-fold-open 类',
            '默认 aria-expanded 是 false',
            '折叠体算出来是 0 行（computed grid-template-rows）',
            '折叠体量出来高约 0',
            '内层（overflow:hidden 那个）也是 0 高',
            '默认箭头是转下去的（computed transform 不是 none）',
            '（对照）里面 textarea 自己的 rect **照样是满高** ⇒「量 rect」判不出收起',
            '（对照）命中测试那个点确实落在视口里（否则下一条会天然成立）',
            '收起时：折叠头下方 60px 那个点**打在折叠块外面**',
            '再点一次又收起了',
            '收起后折叠体又回到 0 高',
            '重绘之后展开态还在（状态驱动，不是只活在 DOM 上）',
            '（对照）重绘之后收起态也如实反映',
            '状态提示排在模板折叠块**后面**',
            '（对照）两个节点都在顺序表里找到了（否则 indexOf 的 -1 会让上一条天然成立）',
            '状态提示排在按钮行前面'
        ]
    },
    {
        id: 'R7',
        why: '`stPaintMsg` 的常驻条不再「让位」 → 同一句话在两处同时出现（第十三轮新增）',
        // 需求是「把工作状态**挪**到按钮上方」—— 是**挪**，不是「再抄一份」。
        // 这一针把常驻条的让位判定拆掉，让消息**同时**出现在页内格和常驻条里。
        // ⚠ 只该红那两条「常驻条是空的」。页内格那半边**一条都不许红** ——
        //   它们绿着正好说明红的是「重复显示」，而不是「页内格整个坏了」。
        from: "            const show = !!m.text && !(inPane && pm);",
        to:   "            const show = !!m.text;   // 注入：常驻条不再让位",
        red: [
            '（对照）同一时刻常驻条 `#st-status` 是空的 —— 同一句话不能出现两遍',
            '（对照）切回来之后常驻条又空了'
        ],
        green: [
            '（对照）工作状态格与生成按钮都在顺序表里找到了',
            '工作状态格排在「生成人设」按钮**前面**（DOM 顺序 = 上方）',
            '还没生成时工作状态格没字',
            '还没生成时工作状态格不显示',
            '带 scope=persona ⇒ 页内格显示出来',
            '页内格空 kind 时用 ok 样式（绿）',
            '切走之后常驻条接住了这条消息（消息不丢）',
            '切回来之后页内格又接住了',
            '（收尾）清空之后页内格也空了',
            '重绘之后页内状态格还写着正在生成'
        ]
    },
    {
        id: 'R8',
        why: '`stExportMsg` 不再记 scope → 消息全退回常驻条，页内格永远空着（第十三轮新增）',
        // 这一针打**上游**：R7 打的是分流的下游（谁显示），R8 打的是「scope 有没有被存下来」。
        // ⚠ 上游一断，「常驻条是空的」**也会**红 —— 消息**确实**跑到常驻条去了。
        //   所以那两条属于 red，不能当对照组（这正是 R7 / R8 必须分开的原因）。
        from: "                scope: scope || ''",
        to:   "                scope: '',   // 注入：scope 不存",
        red: [
            '带 scope=persona ⇒ 页内格显示出来',
            '切回来之后页内格又接住了',
            '（对照）同一时刻常驻条 `#st-status` 是空的 —— 同一句话不能出现两遍',
            '（对照）切回来之后常驻条又空了',
            '重绘之后页内状态格还写着正在生成'
        ],
        green: [
            '（对照）工作状态格与生成按钮都在顺序表里找到了',
            '工作状态格排在「生成人设」按钮**前面**（DOM 顺序 = 上方）',
            '还没生成时工作状态格没字',
            '还没生成时工作状态格不显示',
            '页内格空 kind 时用 ok 样式（绿）',
            '切走之后常驻条接住了这条消息（消息不丢）',
            '（收尾）清空之后页内格也空了'
        ]
    },
    {
        id: 'R9',
        why: '「追加到世界书」不真的写进 bookEntries → 按钮点了没反应（第十四轮新增）',
        // 需求是「给生成结果加一个『追加到世界书』」。要证的是**结果真的变成了卡里的一条条目**，
        // 不是「按钮存在、提示也打了 ✅」。
        // ⚠ 这一针把 push 拆掉，而**提示照样说「已追加到世界书（第 1 条）」** ——
        //   因为那句话报的是 `a.length`，也就是**那个没变过的长度**。
        //   「提示是 ok」留在 green 里是**故意的**：它正是这一针要暴露的东西 ——
        //   光看提示，功能像是成功了。
        // ⚠ 只该红那几条「新条目本身」；「原有条目没被动」那三条必须还是绿的 ——
        //   它们绿着才说明红的是「新的没进去」，而不是「世界书整个被搞坏了」。
        from: "                if (nm) e.keys = [nm];\r\n" +
              "                a.push(e);",
        to:   "                if (nm) e.keys = [nm];   // 注入：不 push",
        red: [
            '点一下 ⇒ 世界书多了一条',
            '新条目的正文就是生成结果',
            '新条目是启用的',
            '新条目的备注带上了卡名',
            '新条目的关键词就是卡名',
            '世界书页真的多渲染了一条',
            '卡里没名字 ⇒ 照样多了一条',
            // ⚠ 这条是**连带**红的：条目压根没建出来，`bookEntries[b2-1]` 落到那条原有条目上，
            //   于是读到的是它的关键词。连带红必须写进 red —— 否则「恰好这几条」那道闸门会拦下
            '卡里没名字 ⇒ 新条目关键词是空的'
        ],
        // 对照组：**原有那条条目、提示文案、空结果那一路，一条都不许红**
        green: [
            '结果区有「追加到世界书」按钮',
            '按钮文案里有「追加到世界书」',
            '（对照）原来那三个按钮都还在',
            '提示说已追加到世界书',
            '提示是 ok',
            '（对照）原有条目还在原位',
            '（对照）原有条目的正文没被动',
            '（对照）原有条目的关键词没被动',
            '没有结果时点「追加到世界书」⇒ 条目数不变',
            '没有结果时点「追加到世界书」⇒ 提示「还没有生成结果」',
            '卡里没名字 ⇒ 提示提醒去填关键词（不静默）'
        ]
    },
    {
        id: 'R10',
        why: '`stPersonaNameUse()` 恒为真 → 取消了勾选也照样把卡名喂给 AI（第十四轮新增）',
        // 需求是「**提供选择**是否用角色卡名字当人物姓名」。这一针把开关的**读**那一端拆掉、
        // 只留写那一端 —— 于是勾选框点得动、`stEditor.personaNameUse` 也真的变成了 false，
        // 但喂给模型的提示词里卡名照旧。
        // ⚠ 这正是「面板上看着关掉了」和「实际关掉了」的差别：只看状态、不看提示词，是抓不到的。
        from: "            return stEditor.personaNameUse !== false;",
        to:   "            return true;   // 注入：开关恒为真",
        red: [
            '取消勾选 ⇒ 提示词里不再有卡名',
            '取消勾选 ⇒ 也不再说「这张卡现在的名字」',
            '重绘之后勾选框仍然是关的',
            '关掉之后真实请求里也没有卡名'
        ],
        // 对照组：**「状态真的被写下来了」那几条不许红** —— 它们绿着正好说明
        // 红的是「读了不生效」，不是「点不动」；也说明「要求 / 模板」那半边没被牵连
        green: [
            '面板上有「用卡名当人物姓名」的勾选框',
            '默认是勾上的',
            '默认勾上 ⇒ 提示词里带卡名',
            '默认勾上 ⇒ 提示词里有「这张卡现在的名字」',
            '取消勾选 ⇒ 状态跟着关掉',
            '（对照）关掉之后用户的要求和模板照样在',
            '（对照）真实请求里仍然有用户的要求原文',
            '勾回去 ⇒ 勾选框又是勾上的',
            '勾回去 ⇒ 提示词里又有卡名了（对照组）'
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
// 名字对不上就直接停，别浪费后面 5 次整跑。
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

console.log('\n===== 反向测试（人设生成器）：' + (bad ? bad + ' 项不达标' : '全部达标') + ' =====');
process.exit(bad ? 1 : 0);
