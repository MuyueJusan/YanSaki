// _reverse18.js —— 反向测试**第二十一轮**（编写器「首页」选项卡）。
//
// 这一轮新加了一整页，`home-verify.js` 一次就 60/0 全绿 —— ⚠ **这正是最该怀疑的时候**：
// 新写的断言很可能「天生为真」（字段没了照样绿 / 数字写死了也不动 / 对照组本来就不红）。
// 所以这一套的任务是**把每一条关键断言都打红一次**，证明它真的在盯着东西。
//
// 探针（全部打在**产品** `saki.html`，一处最小改动，跑完立刻还原）：
//   R1  往 `ST_TABS` **最前面插**一个探针选项卡 → 「总数 16 / 排在最前」该红（「在清单里」仍绿）
//   R2  概览的正文字段数写死成 0           → 「改名之后 1 / 8」该红（而「空卡 0 / 8」仍绿）
//   R3  导入改成**替换**而不是追加         → 「1 + 3 = 4 条」该红（连带 3 条）
//   R4  `stImportPick` 不写 `dataset.mode` → 「点导入 → mode=card」该红（模式残留那一条）
//   R5  导入时**不 clone**、直接用来源对象 → 「改卡里条目不污染来源」该红
//   R6  提取时**不解包 `data`**（V2/V3 卡的世界书在 `data.character_book` 里）
//        → 「角色卡来源」那一整条路该红（而「世界书来源」必须还是绿的）
// —— 同日补的三针（首页内容**模块化**之后新加的断言）——
//   R7  折叠状态**不落盘**（草稿里漏掉 `homeClosed`）→ 只有「读回来」那两条红
//   R8  空模块**也渲染**（不再跳过空 body）        → 「只有三个模块 / 标题顺序」该红
//   R9  渲染时**不看**折叠状态（`closed` 写死 false）→ 整条折叠链该红
//        ⚠ R7 与 R9 是**两个方向**：R7 = 用了但没存，R9 = 存了但没用
//
// ⚠⚠ 第一版 R1 是「把 `home` 从 `ST_TABS` 里删掉」，**那一针是坏的**：
//   删掉之后 `#st-tab-home` 变 null，而套件里有一句 `getElementById('st-tab-home').click()`，
//   `ev()` 遇到页面异常**直接 throw** ⇒ 整套**崩掉、连汇总行都没有** ⇒
//   反向测试拿不到「红了几条」，「预期该红」三条全判失败。改成「插一个」才收敛。
// ⚠⚠ 第一版 R1 的 `from` 还带了尾 `\n`，而产品是 **CRLF** ⇒ 命中 **0 次** ⇒ 注入是**空操作**，
//   表现是「注入后套件跑出和基线一模一样的 60/0」。**注入没效果 ≠ 断言不够强**，
//   这两件事长得一样，但一个要改探针、一个要改套件 —— 上面那道唯一性闸门就是用来分开它们的。
// ⚠⚠ 而 R5 那一次「注入没效果」**恰恰是套件的问题**，它抓到了一条**永真断言**：
//   套件原来在断言前「重新 feed 一次文件」，`parseWorldBook` 会 parse 出**全新对象** ⇒
//   比的是两个不同对象 ⇒ 删掉 clone 也照样绿。已改成「先抓住来源对象的引用再导入」。
//
// ⚠ 注入点在**产品**（`saki.html`），不在套件。每个探针都是**一处**最小改动，
//   跑完立刻还原，收尾核 sha1 —— 不核的话「注入过的产品」会被当成基线。
// ⚠ 每个探针都配了**对照组**（`green`）：那些断言在被注入之后**必须还是绿的**。
//   没有对照组的话，「全红」也能骗过这一关。
// ⚠⚠ 探针点名的断言必须在基线里真的存在（见下面那段存在性闸门）：
//   `red` 里的名字漂了 ⇒「预期该红的都红了」**永远红**；
//   `green` 里的名字漂了 ⇒「对照组一条都没红」**天然成立** —— 对照组被悄悄削弱，
//   而整套照样打 ✅。两边的名单都要查。
// ⚠⚠ **必须用异步 `spawn`** —— 这个环境里 `spawnSync` / `execFileSync` / `execSync`
//   一律返回 `EBUSY`（见 RULES 六之四十六）。用同步 API 的话整套会**假红**。
//
// 跑法：
//   node _reverse18.js                 # 全部 6 针（1 个基线 + 6 次套件运行）
//   node _reverse18.js --only R7,R9    # 只跑基线 + 点名的针（补针 / 修清单时用，实测 **46 s**）
//   ⚠ 上面这个秒数是 2026-09-24 实测的。原来写的是「约 9 分钟而不是 30 分钟」——
//     那个大头是套件收尾卡在 `rmSync` 上（RULES 六之五十五），修掉之后单次只剩约 10 s。
//     **别照抄这里的数字**，它是会漂的；`--only` 至少能把范围压到「只跑改过的那几针」。
// ⚠⚠ **这里的耗时数字在 2026-09-24 变过一次，别照抄旧的。**
//   原来写的是「每针约 4.3 分钟、6 针 + 基线 ≈ 30 分钟」—— 那个数字的**大头不是断言**，
//   是套件收尾卡在 `fs.rmSync(profile)` 上（RULES 六之五十五）。
//   把收尾改成 `spawn(detached)` 之后，`home-verify.js` 单次从「10 分钟不退」变成 **约 10 s**，
//   于是 9 针 + 基线（10 次运行）**总共约 2 分钟**。
//   ⇒ 判据：**别信这里写的数字，跑一次看实际**。数字会随套件规模漂，而漂了不会有人提醒。
//   一律 `run_in_background: true`，否则前台会被工具超时打断（输出走 `tail` 就更看不到东西）。
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const DIR = __dirname;
const PAGE = path.join(DIR, '..', 'saki.html');
const SUITE = path.join(DIR, 'home-verify.js');
const BAK = path.join(DIR, '_reverse18.bak');

// ⚠ 上一次没还原干净就拒绝启动 —— 否则会把「注入过的产品」当成基线备份下来
if (fs.existsSync(BAK)) {
    console.log('⚠ 目录里还留着 _reverse18.bak —— 上一次没还原。' +
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

// 异步跑一个命令，返回 { code, out }
function run(cmd, args, opts) {
    return new Promise(resolve => {
        const o = opts || {};
        let so = '', se = '';
        let done = false;
        const c = spawn(cmd, args, { cwd: o.cwd });
        const timer = o.timeout ? setTimeout(() => {
            if (done) return; done = true;
            try { c.kill(); } catch (e) {}
            resolve({ code: null, out: so + se, timedOut: true });
        }, o.timeout) : null;
        c.stdout.on('data', d => { so += d; });
        c.stderr.on('data', d => { se += d; });
        c.on('close', code => {
            if (done) return; done = true;
            if (timer) clearTimeout(timer);
            resolve({ code, out: so + se });
        });
        c.on('error', e => {
            if (done) return; done = true;
            if (timer) clearTimeout(timer);
            resolve({ code: 1, out: so + se + '\n起不了子进程：' + e.code });
        });
    });
}

async function runSuite() {
    const r = await run(process.execPath, [SUITE], { cwd: DIR, timeout: 900000 });
    return r.out;
}
// 汇总行用来确认「确实跑完了」—— 提前退出的话它会缺
function summaryOf(out) {
    const m = out.match(/(\d+)\s*通过\s*\/\s*(\d+)\s*失败/);
    return m ? { pass: Number(m[1]), fail: Number(m[2]) } : null;
}
// 失败项那一列。⚠ 列表符各家套件不一样（`-` / `·` / `❌`）—— 照抄别家的写法会
//   **一条都匹配不上**，而且表现为「对照组没红 ✅」，看着像过了。这里一次覆盖全部已知符号
const LIST_MARK = /^\s*(?:[-·×✗❌*]+)?\s*/;
function failsOf(out) {
    const i = out.lastIndexOf('失败项：');
    if (i < 0) return [];
    return out.slice(i).split(/\r?\n/).slice(1)
        .map(s => s.replace(LIST_MARK, '')).map(nm).filter(Boolean);
}
// 基线里**真的绿过**的断言名。
// ⚠⚠ 一律 `nm()`（trim）之后再比：`check()` 打的是 `  ✅ ` + 名字，而**名字自己
//   可能带前导空格**，那个正则的 `\s+` 会把名字自己的空格一起吃掉。
function passesOf(out) {
    return (out.match(/^\s*✅\s+(.*)$/gm) || [])
        .map(s => nm(s.replace(/^\s*✅\s*/, '')));
}
const hit = (list, x) => list.indexOf(nm(x)) >= 0;

// ⚠ 注入片段必须**把整块包住**。少包一行就会在产品里留下语法残渣，
//   而它的表现是「**整个内联脚本解析失败**」—— 套件红一大片（看着像产品彻底坏了），
//   其实是**这一针打的是语法、不是逻辑**。这个闸门就是用来分开这两种情况的。
async function pageParses() {
    const html = fs.readFileSync(PAGE, 'utf8');
    const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
    if (!blocks.length) return { ok: false, err: '一个内联 <script> 都没抽到' };
    const tmp = path.join(os.tmpdir(), '_reverse18-pagecheck.js');
    fs.writeFileSync(tmp, blocks.map(m => m[1]).join('\n;\n'), 'utf8');
    const r = await run(process.execPath, ['--check', tmp]);
    try { fs.unlinkSync(tmp); } catch (e) {}
    return {
        ok: r.code === 0,
        err: String(r.out || '').split(/\r?\n/).slice(0, 3).join(' ')
    };
}

const PROBES = [
    {
        id: 'R1',
        why: '往 ST_TABS 最前面插一个探针选项卡（总数变 17、首页被挤到第 2）',
        // ⚠⚠ 这里**故意不删 `home`**，而是**在最前面插一个**。
        //   原因：删掉 `home` 会让 `#st-tab-home` 这个真按钮变成 null，
        //   而套件第 294 行写的是 `document.getElementById('st-tab-home').click()` ——
        //   `ev()` 在页面抛异常时是**直接 throw** 的 ⇒ 整套**崩掉、连汇总行都没有**，
        //   反向测试拿不到「红了几条」，那一针等于白跑。
        //   插一个反而更好：它一次把「总数」「排在最前」两条都打红，
        //   而「首页在清单里」仍然绿 ⇒ 那条恰好成了**活着的对照组**。
        // ⚠⚠ `from` **不带尾换行**：产品是 CRLF，带 `\n` 的话命中 0 次
        //   （注入静默变成空操作，表现是「套件跑出和基线一模一样的 60/0」）。
        //   带上尾换行的那版就真的踩过这个坑，所以这里一律用「行内插入」。
        from: "        const ST_TABS = [",
        to: "        const ST_TABS = [{ id: 'zzprobe', ico: '\u{1F9EA}', label: '探针' },",
        red: [
            '选项卡总数 16',
            '首页**排在最前**',
            '「名字」被挤到第二位（对照）'
        ],
        // ⚠ 对照组：`home` **还在清单里**（只是位置错了）⇒ 这条必须还是绿的。
        //   它绿着才说明「排在最前」红得有意义 —— 否则可能只是整个清单都没了
        green: [
            '首页在清单里',
            '编辑器已打开',
            '概览的键值表在',
            '空卡：世界书 0 条',
            '新建之后默认落在首页',
            '点「首页」真按钮能切回来'
        ]
    },
    {
        id: 'R2',
        why: '概览的正文字段数写死成 0（不跟真实数据）',
        from: "            const filled = ST_HOME_BODY_FIELDS.filter(k => String(c[k] || '').trim()).length;",
        to: "            const filled = 0;   /* 注入：不跟真实数据 */",
        red: [
            '改名之后正文字段 1 / 8',
            '正文字段数**真的变了**（对照）'
        ],
        // ⚠ 对照组：空卡本来就该是 0 ⇒ 写死成 0 之后这条**照样绿**。
        //   少了它，「数字写死了」和「数字算对了」在空卡上看不出区别
        green: [
            '空卡：正文字段 0 / 8',
            '空卡：世界书 0 条',
            '选项卡总数 16'
        ]
    },
    {
        id: 'R3',
        why: '导入改成**替换**而不是追加',
        from: "            stEditor.card.bookEntries.push(...added);",
        to: "            stEditor.card.bookEntries = added.slice();   /* 注入：替换而不是追加 */",
        red: [
            '导入 3 条之后：1 + 3 = 4 条（**追加**，不是替换）',
            '原有条目还在第一位',
            // ⚠ 下面三条是**连带红**：改成替换之后 index 0 变成新导入的第一条，
            //   于是「原有条目」那两条读到的都不是原值，而「新来的第一条」从 index 1 掉到了 index 0。
            //   连带红**必须一条不落地列进来** —— 否则「没有预期之外的红」那道闸门会拦下这一针
            '原有条目的 id 没被换掉',
            '原有条目的内容没被动',
            '新来的第一条内容对得上'
        ],
        green: [
            '选项卡总数 16',
            '编辑器已打开'
        ]
    },
    {
        id: 'R4',
        why: 'stImportPick 不写 dataset.mode → 模式会残留',
        // ⚠ 这一行**恰好唯一**：兄弟函数 `stExtractPick` 写的是 `'extract'`，不是 `'card'`。
        //   也就是说**唯一性来自「另一个入口写的是别的值」** —— 哪天有人再加一个写 `'card'`
        //   的入口，这针就会打歪。上面那道「恰好出现 1 次」的闸门就是为了接住这种情况。
        from: "            el.dataset.mode = 'card';",
        to: "            /* 注入：不写 mode，靠上次残留 */",
        red: [
            '正常点「导入」→ mode=card',
            // ⚠ 连带红：mode 残留成 'extract' 之后，套件里「再点一次导入」那条也会读到 'extract'
            '之后再点「导入」→ 被覆盖回 card'
        ],
        // ⚠ 对照组：`stExtractPick` 自己那一行没被改 ⇒ 它仍然写得对
        green: [
            '点「提取条目」→ mode=extract',
            '选项卡总数 16'
        ]
    },
    {
        id: 'R5',
        why: '导入时不 clone、直接把来源对象塞进卡里（两处共享同一个对象）',
        from: "            const added = picked.map(e => Object.assign({}, e, { id: stUuid() }));",
        to: "            const added = picked;   /* 注入：直接用来源对象 */",
        red: [
            '卡里改条目**不会**污染来源（不共享对象）'
        ],
        green: [
            '导入 3 条之后：1 + 3 = 4 条（**追加**，不是替换）',
            '选项卡总数 16'
        ]
    },
    {
        id: 'R6',
        why: '提取时**不解包 `data`** —— V2 / V3 卡的世界书装在 data.character_book 里',
        // ⚠⚠ 这一针打的是**这次功能的核心**：`parseWorldBook` 只认顶层 `character_book` / `entries`，
        //   而 V2 / V3 卡把它们装在 `data` 里 ⇒ 少了解包这一步，**角色卡来源整个解析不出来**。
        //   （前五针都没覆盖到它 —— 那是本轮补的一个**覆盖缺口**：反向测试的价值在于
        //   「每一条关键断言都被打红过一次」，而「从角色卡里提取」是需求原话里的四个能力之一。）
        // ⚠ 注入片段**单行**：产品是 CRLF，跨行的 `from` 会命中 0 次（R1 第一版就栽在这儿）。
        from: "                    ? json.data : json;",
        to: "                    ? json : json;   /* 注入：不解包 data */",
        red: [
            // —— E 段：角色卡那条路整个垮掉（`parseWorldBook` 找不到 book ⇒ 抛错 ⇒ catch）
            '角色卡来源：解析出 3 条',
            '角色卡来源：认出来了是「角色卡」',
            '角色卡来源：世界书名取到了',
            '角色卡来源：默认**全选**',
            '角色卡来源：面板上出现 3 个勾选框',
            // —— 连带红：F 段用的也是角色卡来源，于是「追加」那一段全部落空
            '导入 3 条之后：1 + 3 = 4 条（**追加**，不是替换）',
            '新来的第一条内容对得上',
            '卡里改条目**不会**污染来源（不共享对象）',
            '导入后给了成功提示'
        ],
        // ⚠ 对照组：**世界书那条路完全不受影响**（它本来就走顶层 `entries`），
        //   所以这几条必须还是绿的 —— 它们绿着才说明这一针打的是「解包」而不是「解析整体坏了」
        green: [
            '世界书来源：解析出 2 条',
            '世界书来源：认出来了是「世界书」',
            '世界书来源：世界书名取到了',
            '没有 entries 的来源：extractSrc 归空',
            '选项卡总数 16',
            '编辑器已打开'
        ]
    },
    {
        id: 'R7',
        why: '折叠状态**不落盘**（`stSaveDraftInner` 里漏掉 `homeClosed`）',
        // ⚠ 这一针**故意保留**「点一下就收起来、重绘也还收着」——
        //   状态确实存在 `stEditor` 上，只是**没写进草稿**。
        //   所以下面 `green` 里那几条必须还是绿的：它们绿着才说明这一针打的是**持久化**，
        //   而不是「折叠整个坏了」（那是 R9 打的东西）。
        from: "                homeClosed: stEditor.homeClosed,",
        to: "                /* 注入：折叠状态不落盘 */",
        red: [
            '把内存里的状态清掉、走 stLoadDraft 读回来：仍然是收起的',
            '读回来的确实是「概览收起」这一条',
            // ⚠ 连带红（第一版漏了这两条，闸门「没有预期之外的红」当场拦下）：
            //   不落盘 ⇒ ⑦ 那步 `stLoadDraft()` 把内存状态清成了 `{}` ⇒ 模块回到**展开**态，
            //   于是 ⑧ 那次「再点一下」实际是**把它关上** ⇒「展开回来」那两条跟着红。
            //   连带红必须一条不落地列出来 —— 否则红得对，却过不了闸门。
            '再点一下：展开回来（class 摘掉）',
            '再点一下：行高回到非 0'
        ],
        green: [
            '点一下头：模块打上 st-mod-closed',
            '收起之后行高真的塌成 0（computed）',
            '收起之后那个点**不再**落在模块体里（命中测试）',
            '重绘之后仍然是收起的（状态不在 DOM 上）',
            '默认全部展开（computed 行高不是 0）'
        ]
    },
    {
        id: 'R8',
        why: '空模块**也渲染**（`stHomeModule` 不再跳过空 body）',
        // ⚠ 没头像时头像模块的 body 是空串 ⇒ 正常实现里它整个不出现。
        //   注入之后它会变成一个**空壳模块**（有头、没内容）。
        from: "            if (!body) return '';",
        to: "            if (false) return '';   /* 注入：空模块也渲染 */",
        red: [
            '没头像时模块只有三个（头像那块整个不渲染）',
            '模块标题按注册表顺序'
        ],
        // ⚠ 对照组：「有头像时它排在最前」**不受影响**（本来就该在），
        //   而那三条按 id 取模块的断言也不受影响 —— 它们绿着说明红的是「跳过」这一条逻辑
        green: [
            '有头像时头像模块出现，且排在最前',
            '每个模块都有头 + 箭头 + 内边距层',
            '概览模块里就是那张 .st-kv（钩子没动）',
            '整个首页的 .st-actions 按钮合计 4（3 + 提取入口 1）'
        ]
    },
    {
        id: 'R9',
        why: '渲染时**不看**折叠状态（`stHomeModule` 里 `closed` 写死成 false）',
        // ⚠ 状态存了、也落盘了，但**渲染不用它** ⇒ 整条折叠链失效。
        //   这跟 R7 是**两个方向**：R7 是「用了但没存」，R9 是「存了但没用」。
        from: "            const closed = stEditor.homeClosed[m.id] === true;",
        to: "            const closed = false;   /* 注入：渲染时不看折叠状态 */",
        red: [
            '点一下头：模块打上 st-mod-closed',
            '收起之后行高真的塌成 0（computed）',
            '收起之后那个点**不再**落在模块体里（命中测试）',
            '重绘之后仍然是收起的（状态不在 DOM 上）',
            '把内存里的状态清掉、走 stLoadDraft 读回来：仍然是收起的'
            // ⚠ 「读回来的确实是「概览收起」这一条」**不在这里** —— 第一版列进来了，
            //   实测它**照样绿**：`closed` 写死只影响**渲染**，`stHomeFold` 里的
            //   `stSaveDraft()` 照旧把 `homeClosed` 写进草稿。
            //   ⇒ 它其实是这一针的**对照组**（状态存了、只是没用上），已挪到下面。
        ],
        green: [
            '读回来的确实是「概览收起」这一条',
            '默认全部展开（computed 行高不是 0）',
            '每个模块都有头 + 箭头 + 内边距层',
            '概览模块里就是那张 .st-kv（钩子没动）',
            '快捷动作模块里 3 个按钮',
            '对照：收起概览没连累快捷动作（它还是展开的）'
        ]
    }
];

// ⚠ 可选：`node _reverse18.js --only R6` —— 只跑**基线 + 点名的探针**。
//   9 针全跑实测 **246 s**（2026-09-24；修掉收尾的 `rmSync` 之前是「每针 4.3 分钟」），
//   而**补一针 / 修一针的清单**时只跑那一针能把这一轮压到 ~46 s。
//   ⚠ 基线**仍然要跑**：存在性闸门要拿基线里真的绿过的名字来核对，不能省。
//   ⚠ 唯一性闸门与存在性闸门**仍然检查全部探针**（它们不花时间），
//     这样「某针的 `from` 漂了」不会因为「这一轮没跑它」而被静默放过。
const ONLY = (() => {
    const i = process.argv.indexOf('--only');
    if (i < 0) return null;
    const ids = process.argv.slice(i + 1).join(',').split(',').map(s => s.trim()).filter(Boolean);
    return ids.length ? ids : null;
})();
const RUN_PROBES = ONLY ? PROBES.filter(p => ONLY.indexOf(p.id) >= 0) : PROBES;
if (ONLY && !RUN_PROBES.length) {
    console.log('⚠ --only 点名的探针一个都不存在：' + ONLY.join(', '));
    console.log('  现有的：' + PROBES.map(p => p.id).join(', '));
    process.exit(1);
}

(async () => {
    console.log('== 反向测试：编写器「首页」选项卡 ==');
    console.log('基线 sha1 = ' + H0.slice(0, 12) + ' …\n');

    // ── ⓪ 每个探针的注入点必须**唯一**（不唯一就是打歪了，而且打歪了也会「有红」）──
    console.log('== 注入点唯一性 ==');
    for (const p of PROBES) {
        const n = ORIG.split(p.from).length - 1;
        expect(p.id + ' 注入点在产品里恰好出现 1 次', n === 1, '出现 ' + n + ' 次');
    }

    // ── ① 基线：先把「本来该绿的」拿下来 ──
    console.log('\n== 基线（未注入）==');
    const baseOut = await runSuite();
    const baseSum = summaryOf(baseOut);
    const basePasses = passesOf(baseOut);
    expect('基线跑完了（有汇总行）', !!baseSum, baseSum ? JSON.stringify(baseSum) : '缺汇总行');
    expect('基线全绿（0 失败）', !!baseSum && baseSum.fail === 0,
        baseSum ? baseSum.pass + ' 通过 / ' + baseSum.fail + ' 失败' : '');
    console.log('  基线绿了 ' + basePasses.length + ' 条');

    // ── ② 存在性闸门：探针点名的断言必须在基线里真的出现过 ──
    console.log('\n== 存在性闸门（名单漂了的话，两边的判定都会失真）==');
    for (const p of PROBES) {
        for (const name of p.red) {
            expect(p.id + ' red 里的名字在基线里存在：' + name, hit(basePasses, name));
        }
        for (const name of p.green) {
            expect(p.id + ' green 里的名字在基线里存在：' + name, hit(basePasses, name));
        }
    }

    // ── ③ 逐针注入（`--only` 时只跑点名的那些）──
    for (const p of RUN_PROBES) {
        console.log('\n== ' + p.id + ' · ' + p.why + ' ==');
        fs.writeFileSync(PAGE, ORIG.replace(p.from, p.to), 'utf8');

        const parse = await pageParses();
        expect(p.id + ' 注入后页面仍能解析（打的是逻辑，不是语法）', parse.ok, parse.ok ? '' : parse.err);

        const out = await runSuite();
        const sum = summaryOf(out);
        expect(p.id + ' 注入后套件跑完了', !!sum, sum ? JSON.stringify(sum) : '缺汇总行');

        const reds = failsOf(out);
        // ① 预期该红的**都**红了
        for (const name of p.red) {
            expect(p.id + ' 预期该红：' + name, hit(reds, name));
        }
        // ② 对照组**一条都没红**
        const greenBroke = p.green.filter(name => hit(reds, name));
        expect(p.id + ' 对照组一条都没红', greenBroke.length === 0,
            greenBroke.length ? '红了：' + greenBroke.join(' / ') : '');
        // ③ 没有预期之外的红（免得「红了一片」被当成达标）
        const unexpected = reds.filter(x => !hit(p.red, x));
        expect(p.id + ' 没有预期之外的红', unexpected.length === 0,
            unexpected.length ? unexpected.slice(0, 4).join(' / ') : '');

        // 立刻还原
        fs.writeFileSync(PAGE, ORIG, 'utf8');
    }

    // ── ④ 收尾：产品必须逐字节回到基线 ──
    console.log('\n== 收尾 ==');
    const H1 = sha1(fs.readFileSync(PAGE, 'utf8'));
    expect('产品已逐字节还原', H1 === H0, H1.slice(0, 12) + ' vs ' + H0.slice(0, 12));

    console.log('\n===== 反向测试（编写器「首页」）：' + (bad ? '有 ' + bad + ' 条不达标' : '全部达标') +
        (ONLY ? '  [--only ' + RUN_PROBES.map(p => p.id).join(',') + ']' : '') + ' =====');
    process.exit(bad ? 1 : 0);
})();
