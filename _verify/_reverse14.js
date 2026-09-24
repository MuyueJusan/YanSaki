// _reverse14.js —— 反向测试 `apig-verify.js`（第十七轮「API 全局配置」那一套）。
//
// 为什么必须有：`apig-verify.js` 报「N 通过 / 0 失败」只说明**这次**没红，
// ⚠ 那个数字**会漂**（每加一段断言就变），以实际跑出来为准 —— 别拿它当判据。
// 不说明它**会**红。一个永远为真的断言会让整套看着很绿、其实什么都没验。
//
// 这一轮引入的东西有个共同形状：**「读哪一份」在画面上完全看不出来**。
// 全局配置与对话配置可以长得一模一样，编写器跟谁走、生效值取自哪一份，
// 全是「值对了就行、错了也是一串看着正常的字符串」。所以这一套的重点是
// 逼着每条断言回答「你怎么知道读的是**那一份**」。
//
//   探针 R1：`stAiFollowCfg` 里的跟随目标退回 `aiConfig` → 编写器又跟回了【ai对话】
//   探针 R2：`apiGlobalLoad` 每次重新播种             → 二次载入把用户改过的全局值盖回去
//   探针 R3：跟随时 API 控件不上锁                    → 「能改、但下次刷新又变回去」的假输入框
//   探针 R4：`apigFetchModels` 不再走 `stAiModelIds`  → 下拉里出现两条一样的模型
//   探针 R5：`aiApplyEffective` 空转                  → 改了全局，对话那边一点动静没有
//   探针 R6：`getAiConfigFromInputs` 不带走 followGlobal / own → 一保存就丢配置来源
//   探针 R7：`saveApiGlobal` 不刷生效值               → 「保存」只落盘、不当场生效
//   探针 R8：`aiSyncOwnFromEffective` 去掉守卫        → 跟随模式下改提示词就把独立那份冲掉
//   探针 R9：`getAiConfigFromInputs` 不带走 Vertex 四格 → 在【ai对话】保存一次，独立那份的项目 / 位置 / 认证方式全没了（第十八轮加的四格，画面上看不出来）
//
// ⚠ 注入点在**产品**（`saki.html`），不在套件。每个探针都是**一处**最小改动，
//   跑完立刻还原，收尾核 sha1 —— 不核的话「注入过的产品」会被当成基线。
// ⚠ 每个探针都配了**对照组**（`green`）：那些断言在被注入之后**必须还是绿的**。
//   没有对照组的话，「全红」也能骗过这一关。
// ⚠⚠ 探针点名的断言必须在基线里真的存在（见下面那段存在性闸门）：
//   `red` 里的名字漂了 ⇒「预期该红的都红了」**永远红**；
//   `green` 里的名字漂了 ⇒「对照组一条都没红」**天然成立** —— 对照组被悄悄削弱，
//   而整套照样打 ✅。两边的名单都要查。
//   ⚠ 这一套的失败项列表符是 `·`（`apig-verify.js` 的 `fails.join` 前缀）。
//
// 跑法：node _reverse14.js   （基线 + 9 个探针 = 10 次整跑）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
// ⚠⚠ 必须用**异步** `spawn`：这个环境里 `spawnSync` / `execFileSync` / `execSync`
//   一律返回 `EBUSY`（连 `where.exe` / `git` 也一样），只有异步 `spawn` 正常。
//   这一套原来写的是 `spawnSync` ⇒ 在现在这台机器上**根本跑不起来**，
//   而它的表现是「基线拿不到汇总行」，看着像套件坏了（见 `RULES.md` 六之四十六）。
const { spawn } = require('child_process');

const DIR = __dirname;
const PAGE = path.join(DIR, '..', 'saki.html');
const SUITE = path.join(DIR, 'apig-verify.js');
const BAK = path.join(DIR, '_reverse14.bak');

// ⚠ 上一次没还原干净就拒绝启动 —— 否则会把「注入过的产品」当成基线备份下来
if (fs.existsSync(BAK)) {
    console.log('⚠ 目录里还留着 _reverse14.bak —— 上一次没还原。' +
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

// 跑一遍套件。**异步** —— 见文件头那条（`spawnSync` 在这个环境里必 `EBUSY`）。
// ⚠ timeout 给到 **15 min**，跟 `run-all.js` 一致：被截断的套件跟「通过了」长得一模一样
//   （汇总行照样打得出来），所以宁可等，不许切。
function runSuite() {
    return new Promise(resolve => {
        let out = '';
        let done = false;
        const c = spawn(process.execPath, [SUITE], { cwd: DIR });
        const timer = setTimeout(() => {
            if (done) return;
            done = true;
            try { c.kill(); } catch (e) {}
            resolve({ code: null, out: out + '\n[超时被掐]' });
        }, 15 * 60 * 1000);
        c.stdout.on('data', d => { out += d; });
        c.stderr.on('data', d => { out += d; });
        c.on('close', code => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve({ code, out });
        });
        c.on('error', e => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve({ code: null, out: out + '\n[起不了子进程: ' + (e && e.code) + ']' });
        });
    });
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
const hit = (list, x) => list.indexOf(nm(x)) >= 0;

const PROBES = [
    {
        id: 'R1',
        why: '`stAiFollowCfg` 里的跟随目标退回 `aiConfig` → 编写器又跟回了【ai对话】',
        // ⚠ 用**一行影子声明**打，而不是把 6 处 `apiGlobal.` 逐个改回 `aiConfig.`：
        //   后者既啰嗦又容易漏一处（漏了那处还绿着，反而看不出探针生效了）。
        //   一行 `const apiGlobal = aiConfig;` 把整个函数体内的读取全拽回对话那套。
        from: "        function stAiFollowCfg() {\r\n" +
              "            const base = String(apiGlobal.baseUrl || '').replace(/\\/+$/, '');",
        to:   "        function stAiFollowCfg() {\r\n" +
              "            const apiGlobal = aiConfig;   // 注入：跟随目标退回【ai对话】\r\n" +
              "            const base = String(apiGlobal.baseUrl || '').replace(/\\/+$/, '');",
        red: [
            '编写器跟随：apiKey 取的是全局那份',
            '编写器跟随：模型取的是全局那份',
            '编写器跟随：第一段取的是全局那份',
            '独立：编写器跟随模式仍然读全局（它不跟对话跑）'
        ],
        // 对照组：**标签 / 对照断言 / 提示词那条 / 切回来之后那条**都没被动 ——
        // `stAiModeLabel` 写死了「跟随 API 全局配置」这几个字（不读值）；
        // F 段那会儿两边恰好都是同一段哨兵串；
        // ⚠⚠ 而「切回跟随：编写器读到的还是全局那份」**两种实现下都绿** ——
        //   因为点回「跟随」这个动作本身就会把 aiConfig 刷成全局值，
        //   于是「读全局」和「读 aiConfig」又指向同一串了。**它天然无法分辨来源**，
        //   只能当对照组用（这一条是本轮反向测试反过来找出来的，值得记着：
        //   断言的位置不对，它就永远绿）
        green: [
            '编写器跟随：来源标签写「API 全局配置」',
            '（对照）对话那套是第三组，跟全局不同',
            '编写器（跟随）：stAiFirstSegText 用的也是全局那段',
            '切回跟随：编写器读到的还是全局那份',
            '保存后落盘到 apiGlobalCfg',
            '切独立：落盘了 followGlobal=false'
        ]
    },
    {
        id: 'R2',
        why: '`apiGlobalLoad` 每次重新播种 → 二次载入把用户改过的全局值盖回去',
        // 播种逻辑本身是对的（老配置没有 apiGlobalCfg 时才播）。这一针拆的是
        // 「已经有就直接用」那个判断 —— 拆掉之后**第一次迁移照样绿**
        // （播种结果和老配置一模一样），只有「用户改过之后再刷新」才会现形
        from: "            if (raw && typeof raw === 'object' && !Array.isArray(raw)) {\r\n" +
              "                apiGlobal = apiGlobalNormalize(raw);\r\n" +
              "                return false;\r\n" +
              "            }",
        to:   "            /* 注入：永远重新播种，不看已有的那份 */",
        red: [
            '二次载入：改过的全局值不被老配置盖回去',
            '二次载入：生效值跟着全局走'
        ],
        // 对照组：**第一次迁移那一整段**没被动 —— 播种本来就是这么干的
        green: [
            '迁移：全局的 Key 取自老配置',
            '迁移：全局的模型取自老配置',
            '迁移：全局的第一段取自老配置',
            '迁移：默认就是「跟随全局」',
            '迁移：已经落盘了 apiGlobalCfg（不是每次重新播种）',
            '迁移：独立那份也播种了（切过去不会一片空白）',
            '刷新后全局配置还在（落盘往返）'
        ]
    },
    {
        id: 'R3',
        why: '跟随时 API 控件不上锁 → 「能改、但下次刷新又变回去」的假输入框',
        // 产品里对这件事有明确立场（跟编写器那边「只读镜像」是同一条规矩）。
        // ⚠ 这一针只打**跟随**那一侧：独立模式本来就不该上锁，
        //   所以「切独立：控件解锁」必须还是绿的
        from: "                if (el) el.disabled = follow;\r\n" +
              "            });\r\n" +
              "            const fb = document.getElementById('ai-fetch-btn');\r\n" +
              "            if (fb) fb.disabled = follow;",
        to:   "                if (el) el.disabled = false;   // 注入：跟随时也不上锁\r\n" +
              "            });\r\n" +
              "            const fb = document.getElementById('ai-fetch-btn');\r\n" +
              "            if (fb) fb.disabled = false;",
        red: [
            '跟随时 API 控件是真 disabled（6 个全查）',
            '跟随时「获取模型」也点不动',
            '跟随时「第一段」也锁着',
            '切回跟随：控件重新上锁'
        ],
        green: [
            '切独立：控件解锁（6 个全查）',
            '切独立：第一段解锁',
            '跟随时输入框里显示的是全局那份',
            '跟随时给了「打开 API 全局配置」的出口',
            '切独立：出口提示收起来了'
        ]
    },
    {
        id: 'R4',
        why: '列模型不再走 `stAiModelIds` → 下拉里出现两条一样的模型',
        // ⚠ 这一针是**真抓到过东西的**：第一版实现自己写了
        //   `data.data.map(m => m.id)`，于是同一份响应里出现两次 `gpt-4o`，
        //   下拉里就真的有两个一模一样的项。复用 `stAiModelIds` 顺带把
        //   「三种返回形状」和「剥 models/ 前缀」也一起拿回来了 —— 那几条也一起验
        // ⚠⚠ **注入点第十八轮挪过位置**：全局面板的「获取模型」从「自己拼一份」
        //   改成委托 `stAiFetchModels`（协议的头/URL 都收在那儿，各写一遍迟早漏一处）
        //   ⇒ 旧的注入点（`apigFetchModels` 里的 `const list = stAiModelIds(data);`）
        //   在产品里**已经 0 命中**。注入点找不到时这一针会被闸门拦下（报「命中 0 次」），
        //   不会静默变成「没注入也全绿」—— 那个闸门就是为这种漂移准备的
        // ⚠⚠ **注入点又挪过一次**（第二十一轮发现）：产品在第十四段（第 20 轮）把
        //   `stAiFetchModels` 拆出 `stAiFetchModelsOnce` 时，顺手把这句报错文案从
        //   「这个接口没返回任何模型」改成了「返回里没有模型（字段名对不上？）」。
        //   ⇒ 老的 `from`（连**文案**一起写死的那串）在产品里**又一次 0 命中**，
        //     这一针**静默变成空操作**。
        //   ⚠⚠ 两件事要分开看：
        //     ① 闸门是好的 —— 跑起来它会报「命中 0 次」，**不会**伪装成「没注入也全绿」；
        //     ② 但闸门**只在有人跑它的时候**才起作用，而这一套用的是 `spawnSync`，
        //        在本环境里**必 `EBUSY`**（见 `RULES.md` 六之四十六）⇒ 实际上跑不起来，
        //        于是这一针漂了整整一轮没人知道。
        //   ⇒ 教训：**「注入点唯一」这道闸门挡不住「没人跑」**。写死产品文案的探针
        //     尤其脆 —— 产品改一句人话，探针就死了，而产品那边看不出任何异常。
        from: "            const ids = stAiModelIds(data);\r\n" +
              "            if (!ids.length) throw new Error('返回里没有模型（字段名对不上？）');",
        to:   "            const ids = (data && Array.isArray(data.data) ? data.data : [])\r\n" +
              "                .map(m => m && m.id).filter(Boolean);   // 注入：不去重不排序、只认一种形状\r\n" +
              "            if (!ids.length) throw new Error('返回里没有模型（字段名对不上？）');",
        red: [
            // ⚠ 这条名字在第十八轮改过（下拉 ⇒ 候选（datalist），模型控件从
            //   <select> 变成 input+datalist）—— **断言名漂了这里就会永远红**，
            //   而「预期该红的都红了」是条永远为假的判据。改名时两边一起改
            '获取模型：候选（datalist）里出现了拉到的模型',
            '获取模型：去重了（4o 只出现一次）',
            '获取模型：认 `{ models: [...] }` 这种形状',
            '获取模型：认裸数组形状，且剥掉 models/ 前缀'
        ],
        // 对照组：**请求那一侧和空列表闸门**没被动 —— 它们绿着正说明红的是
        // 「拿回来的列表怎么处理」，不是「请求没发出去」。
        // ⚠ 第十八轮把模型控件从 <select> 改成 input+datalist 之后又加了三组对照：
        //   控件形状、datalist 绑定、手输 —— 它们都不经过 `stAiModelIds`，
        //   所以这一针**不该**碰到它们（碰到了说明注入面比预期大）
        green: [
            '获取模型：请求发去了 /models',
            '获取模型：带上了 Bearer 头',
            '获取模型：空列表要报错（不静默当成功）',
            '测试连接：401 会报出状态码',
            '⚠ 模型框是 INPUT（能手输），不是下拉',
            '⚠ 模型框挂上了 datalist（候选来自它）',
            '⚠ 手输一个候选里没有的模型名也能存下来'
        ]
    },
    {
        id: 'R5',
        why: '`aiApplyEffective` 空转 → 改了全局，对话那边一点动静没有',
        // 全站 40 多个读点读的都是 `aiConfig` 顶层那几个字段，靠这一个函数刷。
        // 它空转的话：**存盘、镜像、编写器全对**（它们直接读 apiGlobal），
        // 只有真正发请求的那条路拿着旧值 —— 是最难肉眼发现的一种坏法
        from: "            API_GLOBAL_FIELDS.forEach(k => { if (src[k] !== undefined) aiConfig[k] = src[k]; });",
        to:   "            /* 注入：不刷生效值 */",
        red: [
            '二次载入：生效值跟着全局走',
            '改全局 ⇒ 对话的生效值跟着变（读 aiConfig）',
            '改全局 ⇒ 对话的模型也跟着变',
            '切回跟随：生效值回到全局那份',
            // ⚠ 这条是**连带红**：它本来查的是「改提示词别把生效值带歪」，
            //   而生效值压根没刷过 ⇒ 它读到的是「独立配置」留下的那串 ⇒ 也红了。
            //   **连带红必须一条不落地写进 red**，否则「没有预期之外的红」会拦下
            '跟随：改系统提示词也不会把生效值带歪',
            '对话：firstSegText 用的是全局那段'
        ],
        // 对照组：**直接读 apiGlobal 的那些**（镜像 / 编写器 / 落盘）没被动 ——
        // 它们绿着正好说明红的是「生效值没刷」，不是「全局配置没存进去」
        green: [
            '保存后内存里的全局配置变了',
            '保存后落盘到 apiGlobalCfg',
            '改全局 ⇒ 对话输入框的镜像也刷新了',
            '跟随时输入框里显示的是全局那份',
            '编写器跟随：apiKey 取的是全局那份',
            '编写器跟随：第一段取的是全局那份',
            '编写器（跟随）：stAiFirstSegText 用的也是全局那段',
            '迁移：生效值 == 老配置（外观一点没变）'
        ]
    },
    {
        id: 'R6',
        why: '`getAiConfigFromInputs` 不带走 followGlobal / own → 一保存就丢配置来源',
        // `getAiConfigFromInputs()` 返回的是**新对象**，`aiConfig = cfg` 会把没列进去的
        // 字段整个抹掉。漏掉这两个字段的症状特别隐蔽：
        //   · `followGlobal` 变 undefined ⇒ `!== false` 成立 ⇒ **静默退回跟随**；
        //   · `own` 变 undefined ⇒ `aiSyncOwnFromEffective` 里 `aiConfig.own = ...`
        //     倒还写得回去，但那一瞬间用户的独立配置已经不在 `aiConfig` 上了。
        // 于是「切到独立、填了 Key、保存」之后一切看起来正常，**只有再点一次才发现白填了**
        //
        // ⚠⚠ 这一针**第一次跑的时候把套件整个炸掉了**（连汇总行都没有，`summaryOf` 拿到 null）：
        //   字段被抹掉之后 `aiConfig.own` 变成 `undefined`，而套件里那几条
        //   `await ev('aiConfig.own.apiKey')` 直接抛 `TypeError`。
        //   ⇒ 那一针等于**白跑**（看起来像「探针有问题」，其实是断言崩不掉那条规矩没守住）。
        //   修法：读嵌套属性一律 `(aiConfig.own || {}).apiKey`，读 localStorage 一律
        //   `JSON.parse(localStorage.getItem(k) || 'null') || {}` —— 元素不在时给个空壳，
        //   断言**红了**（那正是我们要的），而不是把整个套件带走
        from: "                followGlobal: aiConfig.followGlobal,\r\n" +
              "                own: aiConfig.own,",
        to:   "                /* 注入：来源与独立快照不带走 */",
        red: [
            '独立：自己的那份（own）记下了新 Key',
            '独立：生效值用的是自己那份',
            '切回跟随：独立那份还留着（没被冲掉）',
            // ⚠ 连带红：`own` 已经被抹成 undefined，这条查的也是 own ⇒ 跟着红。
            //   一条不落地写进 red，否则「没有预期之外的红」会拦下（第一次跑就拦下了）
            '跟随：改系统提示词不会冲掉独立那份',
            '（准备）对话生效值现在是第三组',
            '（准备）它跟全局确实不同',
            '（对照）对话那套是第三组，跟全局不同',
            '独立：对话用自己那段',
            '独立：own 里记下了自己那段',
            // ⚠ 第十八轮 D2 那一段的连带红：它整个建在「保存之后 own 还在」上，
            //   own 被抹成 undefined ⇒ 这 8 条跟着红。一条不落地写进来，
            //   否则「没有预期之外的红」会拦下（这条规矩已经拦过好几次了）
            '⚠ 手输一个候选里没有的模型名也能存下来（独立那份）',
            '⚠ 而且立刻生效（读生效值）',
            '⚠ 独立 + Vertex ⇒ 出现「那几项沿用全局」的提示',
            '⚠⚠ 独立：保存后 project 没被打回默认',
            '⚠⚠ 独立：保存后 location 没被打回默认',
            '⚠⚠ 独立：保存后 authMode 没被打回默认',
            '⚠⚠ 独立：保存后 saJson 没被打回默认',
            '（对照）保存后模型名还是刚手输的那个（别把这条跟上面四条混成一条）'
        ],
        // 对照组：**「切来源」这个动作本身**（它直接写 aiConfig.followGlobal）没被动 ——
        // 落盘、解锁、角标那几条绿着正说明红的是「保存把字段吃掉了」
        green: [
            '切独立：落盘了 followGlobal=false',
            '切独立：控件解锁（6 个全查）',
            '切独立：角标改口',
            '切独立：出口提示收起来了',
            '（对照）全局那份没被独立配置改掉',
            '切回跟随：生效值回到全局那份',
            '切回跟随：控件重新上锁',
            '复原：回到跟随全局'
        ]
    },
    {
        id: 'R7',
        why: '`saveApiGlobal` 不刷生效值 → 「保存」只落盘、不当场生效',
        // 跟 R5 打的是**同一个函数**，但注入点在**调用方**：R5 证的是那个函数自己有效，
        // R7 证的是「保存按钮真的会去调它」。两针缺一不可 ——
        // 少了 R7，「保存后要立刻生效」这条可以被改成「下次刷新才生效」而没人发现
        from: "            const ok = apiGlobalPersist();\r\n" +
              "            aiApplyEffective();",
        to:   "            const ok = apiGlobalPersist();\r\n" +
              "            /* 注入：保存只落盘，不当场刷生效值 */",
        red: [
            '改全局 ⇒ 对话的生效值跟着变（读 aiConfig）',
            '改全局 ⇒ 对话的模型也跟着变'
        ],
        green: [
            '保存后内存里的全局配置变了',
            '保存后落盘到 apiGlobalCfg',
            '改全局 ⇒ 对话输入框的镜像也刷新了',
            '编写器跟随：apiKey 取的是全局那份',
            '二次载入：生效值跟着全局走'
        ]
    },
    {
        id: 'R8',
        why: '`aiSyncOwnFromEffective` 去掉守卫 → 跟随模式下改提示词就把独立那份冲掉',
        // ⚠ 这一针最初**在本套件里没有任何可观测效果** —— 也就是说那条守卫
        //   （`followGlobal === false`）当时是没人看着的。补了两条断言之后它才咬得动：
        //   跟随模式下 `persistSystemPrompt()` 照样会跑（改预设 / 改提示词都会调），
        //   无条件同步就会把用户那份独立配置**静默换成全局值**。
        //   ⚠ 这正是「反向测试反过来找套件的洞」那一类收获，值得留着
        from: "            if (aiConfig.followGlobal === false) aiConfig.own = apiGlobalPick(aiConfig);",
        to:   "            aiConfig.own = apiGlobalPick(aiConfig);   // 注入：无条件同步",
        red: [
            '跟随：改系统提示词不会冲掉独立那份'
        ],
        green: [
            '切回跟随：独立那份还留着（没被冲掉）',
            '跟随：改系统提示词也不会把生效值带歪',
            '独立：自己的那份（own）记下了新 Key',
            '切回跟随：生效值回到全局那份'
        ]
    },
    {
        id: 'R9',
        why: '`getAiConfigFromInputs` 不带走 Vertex 那四个字段 → 在【ai对话】点一次保存就把独立那份的 Vertex 设置打回默认',
        // 跟 R6 **同一个函数、同一种病**，但打的是第十八轮新加的四格：
        //   `authMode` / `project` / `location` / `saJson`。
        // 这四格在【ai对话】面板里**没有控件**（只在【API 全局配置】里改），
        // 所以漏掉它们的症状比 R6 更隐蔽 —— 画面上**根本没有任何东西会变**，
        // 只有用户真去用 Vertex（尤其完整模式）才会发现项目 / 位置没了。
        // ⇒ 非单独一针不可：R6 的注入点把 followGlobal / own 也一起拿掉了，
        //   没法证明这四条断言**恰好**盯着这四个字段。
        from: "                authMode: aiConfig.authMode,\r\n" +
              "                project: aiConfig.project,\r\n" +
              "                location: aiConfig.location,\r\n" +
              "                saJson: aiConfig.saJson,",
        to:   "                /* 注入：Vertex 那四个字段不带走 */",
        red: [
            '⚠⚠ 独立：保存后 project 没被打回默认',
            '⚠⚠ 独立：保存后 location 没被打回默认',
            '⚠⚠ 独立：保存后 authMode 没被打回默认',
            '⚠⚠ 独立：保存后 saJson 没被打回默认'
        ],
        // 对照组：**同一段里别的都还在** —— 模型能手输、提示会显隐、
        // own 也没被抹掉（R9 只拿掉那四个字段，不像 R6 连 own 一起拿）
        green: [
            '⚠ 模型框是 INPUT（能手输），不是下拉',
            '⚠ 手输一个候选里没有的模型名也能存下来（独立那份）',
            '⚠ 而且立刻生效（读生效值）',
            '⚠ 独立 + Vertex ⇒ 出现「那几项沿用全局」的提示',
            '（对照）保存后模型名还是刚手输的那个（别把这条跟上面四条混成一条）',
            '跟随 + Vertex ⇒ 提示收起',
            '（对照）切回跟随之后 provider 镜像的是全局那份（不是 vertex）'
        ]
    }
];

// ⚠ 整段主流程包在 async IIFE 里 —— `runSuite()` 现在是**异步**的（见文件头）。
(async () => {
  // 先跑一遍**没注入**的，拿到基线（也顺便确认套件本身现在是绿的）
  console.log('== 基线（未注入）==');
  const base = await runSuite();
  const bs = summaryOf(base.out);
  const basePass = passesOf(base.out);
  expect('套件能跑完（有汇总行）', !!bs, JSON.stringify(bs));
  expect('基线是绿的（0 失败）', !!bs && bs.fail === 0, JSON.stringify(bs));
  console.log('     基线 ' + (bs ? bs.pass : '?') + ' 条绿（这一套的断言总数）');

  // ⚠ 基线里一条 ✅ 都没有 ⇒ 下面的「名字还在不在」全部无从谈起，
  //   而且 `red` 会一条都匹配不上还打 ✅。直接拦掉
  expect('基线里能抽到断言名（否则后面的存在性检查是空转）', basePass.length > 0, basePass.length);

  // 先把所有探针点名的断言核一遍存在性 —— 这步**不需要跑套件**，纯离线。
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
          r = await runSuite();
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

  console.log('\n===== 反向测试（API 全局配置）：' + (bad ? bad + ' 项不达标' : '全部达标') + ' =====');
  process.exit(bad ? 1 : 0);
})();
