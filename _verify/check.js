// 对 `saki.html` 的内联 `<script>` 做静态检查。**零依赖、不开浏览器**，改完先跑它。
//
// ⚠ **直接读 `saki.html`，不再读 `blk0.js`。**
// `blk0.js` 是 `extract.js` 的生成物 —— 改了 `saki.html` 却忘了重新 extract，
// 检查会**安安静静地对着旧代码给答案**，而那份答案看起来完全正常
// （`MISSING: (none)` 一样会打出来）。**过时的输入比没有检查更坏。**
// 所以：解析用 `vm.Script`（等价 `node --check`，但当场抽当场查），
// `blk0.js` 只留给临时分析用，`extract.js` 也只为它服务。
//
// 五项检查（`SYNTAX` / `MISSING` / `DUPLICATE literal ids` / `UNDECLARED` / `ESCAPE-GATE`），
// 每项都把「违规清单」打出来（`(none)` = 干净），最后给一行套件格式的汇总，
// 于是 `run-all.js` 能把它一起算进去。
//
// ⚠ 这五项里**没有手写清单**了。原先第 3 项是 45 个 `stSb*` 名字逐个 `declared.has()`
// —— 加了新函数要记得往里补，**它自己不会提醒你**，本质上还是「约定」；而且清单外
// 漏声明的名字一概看不见。现在改成从源码推导（见第 3 项，换之前先量过覆盖率）。
const fs = require('fs');

const PAGE = 'G:/saki/saki.html';
const src = fs.readFileSync(PAGE, 'utf8');

// 自己抽内联 <script>（和 extract.js 同一套规则；内联块只有一块，取最长的那块最稳）
const RE_SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m, code = '';
while ((m = RE_SCRIPT.exec(src))) {
    if (/\bsrc\s*=/.test(m[1] || '')) continue;   // 外链脚本不算
    if (m[2].length > code.length) code = m[2];
}
if (!code) { console.log('❌ 没抽到内联 <script> —— saki.html 的结构变了？'); process.exit(1); }

const results = [];
const check = (name, bad, detail) => {
    results.push({ name, ok: !bad.length });
    // 干净就 `名字: (none)`，有问题就 `名字: N 处` + 缩进清单 —— 两种都一眼可 grep
    console.log(name + ': ' + (bad.length ? bad.length + ' 处' : '(none)'));
    if (bad.length) (detail || bad).forEach(x => console.log('  · ' + x));
};

// ── 内联游戏源码（`ST_SHOOTER_SRC`）要**切掉**再做静态检查 ──────────
// 小游戏弹窗把整份 `retro_vector_space_shooter` 内联成了一个模板字面量常量
// （见 `_mk-shooter-embed.js`）。第 1 项用的是**原文** `code` 而不是涂过的 `clean`
// —— 那是**故意的**，因为主页自己的 `onclick="…"` 就是写在 JS 字符串里构建出来的，
// 用 `clean` 会把它们一起涂掉，那一项就变成空转。
// 代价是：这段内联源码会**同时**往「已声明」和「被引用」两边灌水。
// 实测（2026-09-21）它给 `declared` 添了 **32** 个
// 名字（27 个来自 `function name(` 那条正则、5 个来自 `const x = function|(` 那条），
// 给 `used` 添了 **4** 个；其中 `selectShip` / `togglePause` / `restartGame` /
// `showShipSelect` 四个**正是它自己那些 handler 引用的** —— 自洽，所以今天不误报。
// ⚠ 这几个数**不用另写探针量** —— 下面那行报告会把两对（`function name(` / `declared`）
// 加上 `used` 一起打出来；文档引用时**直接抄那行**，别抄旧的输出。
// ⚠ 32 / 4 都**不是** 27 —— 27 只是 `function name(` 那一条正则的差，
// 拿它当「declared 灌了多少」会少算 5 个。
// 但它让「主页里同名函数被删掉」这件事**可能被掩盖**：只要内联源码里有同名声明，
// 主页那个 handler 就会照样过。⇒ 整段切掉，让这几项只看见主页自己的代码。
// ⚠ 切了**要说出来**（下面会打长度）—— 静默地少看 100 KB 比不切更坏。
const RE_BLOB = /[ \t]*\/\/ ==== BEGIN ST_SHOOTER_SRC[\s\S]*?\/\/ ==== END ST_SHOOTER_SRC[^\n]*/;
const blobHit = code.match(RE_BLOB);
const codeNoBlob = blobHit ? code.replace(RE_BLOB, '/* [内联游戏源码 ST_SHOOTER_SRC 已切掉] */') : code;

// ── 两个口径函数：第 1 项与下面那行报告**必须同源** ────────────────
// 原先「声明集合」和「被引用集合」的构造正则在第 1 项里写了一遍、在报告里又写一遍
// （还是不同的写法）⇒ 改一处就静默漂，报告里的数跟判据用的集合**对不上**。
// 收成一个函数，两边都调它；报告因此能直接把「灌了多少水」打出来，不用另写探针。
const declaredNamesOf = (t) => {
    const s = new Set();
    for (const mm of t.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) s.add(mm[1]);
    for (const mm of t.matchAll(/(?:^|\n)\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:function|\()/g)) s.add(mm[1]);
    return s;
};
const usedNamesOf = (t) => {
    const s = new Set();
    for (const mm of t.matchAll(/on(?:click|input|change|dragstart|dragover|dragleave|drop|dragend)\s*=\s*["']([^"']*)["']/g)) {
        for (const f of mm[1].matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) s.add(f[1]);
    }
    return s;
};
// ⚠ 报告里把**两种口径**都打出来：`function name(` 只是其中一条正则的计数，
// 拿它当「`declared` 灌了多少」会**少算**（实测 27 vs 真值 32）。
console.log('内联游戏源码: ' + (blobHit
    ? '切掉 ' + Buffer.byteLength(blobHit[0], 'utf8') + ' 字节；' +
      '顶层 `function name(` ' + (code.match(/\bfunction\s+[A-Za-z_$][\w$]*\s*\(/g) || []).length +
      ' → ' + (codeNoBlob.match(/\bfunction\s+[A-Za-z_$][\w$]*\s*\(/g) || []).length + '；' +
      'declared ' + declaredNamesOf(code).size + ' → ' + declaredNamesOf(codeNoBlob).size + '；' +
      'used ' + usedNamesOf(code).size + ' → ' + usedNamesOf(codeNoBlob).size
    : '⚠ **没找到** —— 常量改名了？第 1 / 2 / 4 项会把它的名字算进主页'));

// ── 0) 内联 JS 能不能解析 ──────────────────────────────────────
// 用 `vm.Script` 只**解析**不执行 —— 等价于 `node --check blk0.js`，
// 但不用先 `extract.js` 生成那份可能过时的 `blk0.js`。
// ⚠ 这一条**必须最先**跑：语法都错了，后面那些正则检查的结论都不值得看。
const vm = require('vm');
let syntaxErr = '';
try { new vm.Script(code, { filename: 'saki.html<script>' }); }
catch (e) { syntaxErr = String((e && e.message) || e); }
check('SYNTAX', syntaxErr ? [syntaxErr] : []);

// ── 共享基础设施：涂掉非代码 + 收集所有声明 ────────────────────
// ⚠ **涂串不是可选项**：不涂的话，`localStorage.getItem('stCodeSessions')`
// 里的字符串会被当成一次「引用」，注释里提到的名字也一样。实测口径 A（不涂）
// 639 个名字 vs 口径 B（涂）631 个 —— 差的 8 个全是字面量 / 注释里的字样。
// 当前它们碰巧都在声明集合里，所以两种口径都干净；那是**运气**，不是保证。
// 口径与外部 `static_check.js` 第 7 项一致（那边踩过 `ST_TH_RAW_KEEP_MAX`
// 「引用落地了、声明没落地」的坑 —— 页面不报错，所有测试也都过，
// 直到用户真走到那条支路才炸）。
function stripNonCode(s) {
    const out = s.split('');
    let i = 0, state = 'code', lastSig = '';
    const n = s.length;
    while (i < n) {
        const c = s[i], c2 = s[i + 1];
        if (state === 'code') {
            if (c === '/' && c2 === '/') { state = 'line'; out[i] = out[i + 1] = ' '; i += 2; continue; }
            if (c === '/' && c2 === '*') { state = 'block'; out[i] = out[i + 1] = ' '; i += 2; continue; }
            if (c === '/' && /[=(,:[!&|?{};+\-*%<>~^]/.test(lastSig || '=')) {
                // 正则字面量：一直扫到未转义的 /，字符类里的 / 不算
                out[i] = ' '; i++;
                let inClass = false;
                while (i < n) {
                    const d = s[i];
                    out[i] = ' ';
                    if (d === '\\') { out[i + 1] = ' '; i += 2; continue; }
                    if (d === '[') inClass = true;
                    else if (d === ']') inClass = false;
                    else if (d === '/' && !inClass) { i++; break; }
                    else if (d === '\n') break;   // 正则不跨行
                    i++;
                }
                lastSig = '/';
                continue;
            }
            if (c === "'" || c === '"' || c === '`') {
                const q = c; out[i] = ' '; i++;
                while (i < n) {
                    const d = s[i];
                    out[i] = (d === '\n') ? '\n' : ' ';
                    if (d === '\\') { out[i + 1] = ' '; i += 2; continue; }
                    if (d === q) { i++; break; }
                    i++;
                }
                lastSig = q;
                continue;
            }
            if (!/\s/.test(c)) lastSig = c;
            i++; continue;
        }
        if (state === 'line') { out[i] = c === '\n' ? '\n' : ' '; if (c === '\n') state = 'code'; i++; continue; }
        if (state === 'block') {
            if (c === '*' && c2 === '/') { out[i] = out[i + 1] = ' '; state = 'code'; i += 2; continue; }
            out[i] = c === '\n' ? '\n' : ' '; i++; continue;
        }
        i++;
    }
    return out.join('');
}
const clean = stripNonCode(code);

// 所有「声明过」的名字。宁可**漏报**不要**误报**：多收一个名字只是少抓一次，
// 少收一个名字就会把正常代码报成红的 —— 后者会让人开始无视这条检查。
//
// ⚠ 这份是**第 3 项专用**的完整口径（含形参 / 解构 / for / catch / 对象键）。
// **不要拿它去给第 1 项用**：第 1 项查的是内联 handler 引用的名字，handler 在全局
// 作用域执行，合法来源只有顶层 `function` / 顶层 `const|let|var`。把局部变量和
// 对象键也算成「已声明」，只会**掩盖**真实的缺声明 —— 例如 `const obj = { toggleTab: 1 }`
// 会让 `onclick="toggleTab()"` 在函数声明丢掉时照样过。两个检查口径不同，各建各的。
const declaredAll = new Set();
{
    const addAll = (re, pick) => {
        let mm;
        while ((mm = re.exec(clean))) {
            const v = pick ? pick(mm) : mm[1];
            if (v) declaredAll.add(v);
        }
    };
    addAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g);
    addAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g);
    addAll(/catch\s*\(\s*([A-Za-z_$][\w$]*)/g);
    // 函数形参 + 箭头形参（粗一点，逐段拆名字）
    {
        let mm;
        const pre = /(?:function\s*[\w$]*\s*|\)\s*=>|\b[\w$]+\s*=>)\s*\(?([^)\n=]*)\)?/g;
        while ((mm = pre.exec(clean))) {
            mm[1].split(',').forEach(p => {
                const nm = p.split('=')[0].trim().replace(/^\.\.\./, '');
                if (/^[A-Za-z_$][\w$]*$/.test(nm)) declaredAll.add(nm);
            });
        }
    }
    // 解构声明
    {
        let mm;
        const d = /\b(?:const|let|var)\s*[\{\[]([^\)\]\}]*)[\}\]]/g;
        while ((mm = d.exec(clean))) {
            mm[1].split(',').forEach(p => {
                const nm = p.split(':').pop().split('=')[0].trim().replace(/^\.\.\./, '');
                if (/^[A-Za-z_$][\w$]*$/.test(nm)) declaredAll.add(nm);
            });
        }
    }
    // 对象字面量的键（简写 `{ stCode }` 里的那个名字）
    addAll(/(?:^|[\{,;])\s*([A-Za-z_$][\w$]*)\s*:/gm);
}

// ── 1) 内联 handler 引用的函数都声明过 ─────────────────────────
// 这一项**只要顶层声明**（见上面那段 ⚠），口径故意比第 3 项窄。
// ⚠ 两个集合都走上面那两个**同源**的口径函数 —— 别在这里重写正则。
const declared = declaredNamesOf(codeNoBlob);

// 所有被内联事件处理器引用的名字
const used = usedNamesOf(codeNoBlob);
// 内联 handler 里出现的方法名不算「被引用的函数」。`onclick="document.getElementById('x').click()"`
// 会被上面那个正则连 `getElementById` 一起捞进来 —— 那是误报，不是缺声明
const builtins = new Set(['if','for','while','return','Number','String','Math','parseInt','JSON','event','stopPropagation','confirm','alert','getElementById','querySelector','click','focus','blur','select','preventDefault','closest','remove','add','toggle']);
const missing = [...used].filter(n => !declared.has(n) && !builtins.has(n));
console.log('declared functions: ' + declared.size);
console.log('inline handlers referenced: ' + used.size);
check('MISSING', missing);

// ── 2) 重复的 id="..." 字面量（静态可查的那部分）────────────────
const ids = new Map();
for (const mm of codeNoBlob.matchAll(/id="st-[A-Za-z0-9_-]*"/g)) ids.set(mm[0], (ids.get(mm[0]) || 0) + 1);
const dup = [...ids.entries()].filter(([, n]) => n > 1).map(([k, n]) => k + ' ×' + n);
check('DUPLICATE literal ids', dup);

// ── 3) `ST_` / `st` 前缀的名字，凡是引用过就必须声明过 ──────────
// 这条**原来是手写清单**（45 个 `stSb*` 名字，逐个 `declared.has()`）。手写清单有
// 两个毛病：① 加了新函数要记得往里补，**它自己不会提醒你** —— 本质上还是「约定」；
// ② 只覆盖清单里那 45 个名字，清单外漏声明的名字一概看不见。
//
// 现在改成**推导式**。换之前先量过：那 45 个名字**全部**都在引用集合里，
// 说明推导式**完整覆盖**了清单的意图（任何一个声明消失，推导式当场红），
// 覆盖面还从 45 个名字扩到全部 639 个 —— 包括 `ST_` 前缀的常量。
//
// ⚠ 必须排除属性访问：`stCode.trash` 里的 `trash` 不算，`x.stFoo` 里的 `stFoo`
//   也不算。判据看**引用点前 40 字符**是否以 `.` / `?.` 结尾 —— 少了这一步，
//   任何 `x.stSomething` 都会被报成缺声明。
// ⚠ 万一真出现「宿主注入的全局」这类合法例外：**不要放宽正则**，在这里显式列一份
//   `NOT_DECLARED_OK` 并写明它由谁提供、为什么可以不在本文件里声明。
//   当前是空的（0 条例外），所以不预建空壳。
const refs = new Map();
{
    const re = /\b(ST_[A-Z0-9_]{2,}|st[A-Z][A-Za-z0-9_]*)\b/g;
    let mm;
    while ((mm = re.exec(clean))) {
        if (!refs.has(mm[1])) refs.set(mm[1], []);
        refs.get(mm[1]).push(mm.index);
    }
}
const undeclared = [];
for (const [name, idxs] of refs) {
    if (declaredAll.has(name)) continue;
    const real = idxs.filter(i => {
        const before = clean.slice(Math.max(0, i - 40), i);
        return !/\.\s*$/.test(before) && !/\?\.\s*$/.test(before);
    });
    if (real.length) undeclared.push(name + ' ×' + real.length);
}
console.log('ST_ / st 前缀标识符: ' + refs.size + ' 个名字');
check('UNDECLARED', undeclared);

// ── 4) 转义闸门 ────────────────────────────────────────────────
// 不变量：下面这些**构建 HTML 字符串**的函数，凡是把动态值拼进字符串的，
// 都必须先过 `escapeHtml` —— 因为它们渲染的是模型输出 / skill 输出 / 卡里的内容。
//
// 判据：先把「已经安全的包装」整段抹白（连括号一起配对抹），剩下的 `+ 变量` 就是候选；
//       候选的**多重集**必须跟白名单**逐字一致**。
// ⚠ 为什么按「函数名 + 标识符名」而不是行号 / 出现次序：那些都会漂，这两个不会。
// ⚠ 为什么是**多重集**而不是集合：同一个函数里再多一个裸插值，集合看不出来。
// ⚠ 白名单是**显式**的：新加一个构建函数、或者在老函数里多拼一个变量，都必须来改这里 ——
//    要么给它套上 escapeHtml，要么想清楚为什么它不用（数字 / 静态常量表）。
//    这正是这条闸门存在的意义：**让「又插了一个值」这件事必须被看见一次。**
const ESCAPE_ALLOW = {
    stCodeHighlight:   ['bool', 'num', 'str', 'str'],                     // 正则命中已转义文本，拆出来的片段
    stCodeJsonHtml:    [],                                                // 只委托 stCodeHighlight
    stCodeMsgHtml:     ['body', 'body', 'body', 't.length'],              // body 已 escapeHtml；t.length 是数字
    stCodeEmptyHtml:   [],                                                // 示例文案写死，skill 名已转义
    stCodeLogHtml:     ['stCode.step'],                                   // 步数，数字
    // ⚠ 进度那句是 skill 自己给的文本（`host.progress("…")`），**必须转义**。
    //   写成 `[]` 是**故意的**：它已经把 p.text 包进 escapeHtml，所以候选为空；
    //   哪天有人往里多拼一个裸变量，这里立刻变红
    stCodeProgressHtml: [],
    stCodeTasksHtml:   ['done', 'list.length', 'st.id', 'st.ico'],         // 计数 + ST_CODE_TASK_ST 静态表
    // ⚠ 2026-09-20 加「字数上限提示」时新插了三个值，所以从 ['n'] 变成四项：
    //   `ST_CODE_MEMO_CHARS` 是数字常量（用在 `maxlength` 上）；`k.cls` / `k.text` 是
    //   `stCodeMemoCounter()` 的返回值 —— 里面只有数字常量和写死的文案，**没有外部输入**。
    //   这正是这条闸门的用处：**让「又插了一个值」这件事必须被看见一次**。
    stCodeMemoPopHtml: ['n', 'ST_CODE_MEMO_CHARS', 'k.cls', 'k.text'],
    // 三个常量（次数 / 毫秒 / 次数上限）—— 都是写死的数字，没有外部输入
    stCodeSkillPopHtml:['ST_CODE_PROG_MAX', 'ST_CODE_PROG_MS', 'ST_CODE_SANDBOX_RPC_MAX'],
    stCodeHistPopHtml: ['ST_CODE_MAX_SESS'],                              // 常量
    stCodeThinkPopHtml:['t.ico', 't.label', 't.steps'],                    // ST_CODE_THINK 静态表
    stCodeBarHtml:     ['stCode.skills.length', 'stCode.sessions.length',
                        'th.ico', 'th.label', 'stCode.trash.length'],       // 计数 + ST_CODE_THINK 静态表
    // 状态栏「预制块」那一整段。三个裸值：`i` 是数组下标（数字）；
    // `it.id` 两处 —— 它是 stSbPfId() 洗出来的**纯字母数字**（那个函数的存在理由
    // 就是「id 要能直接塞进 onclick 的单引号里」），所以不用再转义。
    // 其余全部走 escapeHtml（名字 / 提示语都是用户输入，必须转）
    stSbPrefabHtml:    ['i', 'it.id', 'it.id'],
    // 「让 AI 生成预制块」那一行。唯一的裸值是 `ST_SB_AI_DESC_MAX` ——
    // 一个写死的数字常量，用在 `maxlength` 上，**没有外部输入**。
    // 描述文字本身走 escapeHtml（用户输入，必须转）。
    // ⚠ 按钮文字/`disabled` 那两处是三目，`+ (busy ? …)` 以 `(` 开头，RE_RAW 抓不到 ——
    //   两个分支都是写死的字面量，本来就安全
    stSbAiRowHtml:     ['ST_SB_AI_DESC_MAX']
};

// 括号配平地抠出函数体（字符串 / 注释 / 模板串要跳过）
function bodyOf(text, startIdx) {
    let i = text.indexOf('{', startIdx);
    if (i < 0) return '';
    let d = 0; const n = text.length;
    for (let j = i; j < n; j++) {
        const c = text[j];
        if (c === '"' || c === "'" || c === '`') {
            const q = c; j++;
            while (j < n && text[j] !== q) { if (text[j] === '\\') j++; j++; }
            continue;
        }
        if (c === '/' && text[j + 1] === '/') { while (j < n && text[j] !== '\n') j++; continue; }
        if (c === '/' && text[j + 1] === '*') { j = text.indexOf('*/', j) + 1; continue; }
        if (c === '{') d++;
        else if (c === '}') { d--; if (d === 0) return text.slice(i + 1, j); }
    }
    return '';
}

// 把「已经安全的包装」整段抹白（配对抹，不用有深度上限的正则）
const SAFE_CALLS = ['escapeHtml', 'stCodeAttr', 'stCodeJsonText'];
function blankSafe(text) {
    let out = '', i = 0; const n = text.length;
    while (i < n) {
        let hit = null;
        for (const f of SAFE_CALLS) {
            if (text.startsWith(f + '(', i)) { hit = f; break; }
        }
        if (!hit) { out += text[i++]; continue; }
        i += hit.length + 1;                     // 跳过 `名字(`
        let d = 1;
        while (i < n && d > 0) {
            const c = text[i];
            if (c === '"' || c === "'" || c === '`') {
                const q = c; i++;
                while (i < n && text[i] !== q) { if (text[i] === '\\') i++; i++; }
            } else if (c === '(') { d++; }
            else if (c === ')') { d--; }
            i++;
        }
        out += '@SAFE@';
    }
    return out;
}

// 裸插值候选：`+ 变量` / `+ a.b` / `+ a[i]`
const RE_RAW = /\+\s*([A-Za-z_$][\w$]*(?:\.[\w$]+|\[[^\]]*\])*)\s*(?=[+,)])/g;
const found = {};
// ⚠ 范围是**点名**的，不是「所有构建函数」。
//   2026-09-21 量过一次：把 `*Html` 全收进来会命中 **27 个**函数（`stSbBlockHtml` 一家
//   就 60+ 个裸值），逐条判断「这个值安不安全」本身就是一个大工程，草率地全塞进白名单
//   只会得到一道「看着在守、其实没看过」的闸门。
//   ⇒ 所以：**新加的构建函数一律点名加进来**（下面这个 stSbPrefabHtml 就是），
//     老的等真去动它们的时候再逐条收。缺口在这儿写着，不藏。
const RE_FN = /function (stCode[A-Za-z]*Html|stCodeHighlight|stSbPrefabHtml|stSbAiRowHtml)\s*\(/g;
let fmm;
while ((fmm = RE_FN.exec(codeNoBlob)) !== null) {
    const safe = blankSafe(bodyOf(codeNoBlob, fmm.index));
    const hits = [];
    let r;
    RE_RAW.lastIndex = 0;
    while ((r = RE_RAW.exec(safe)) !== null) hits.push(r[1]);
    found[fmm[1]] = hits;
}

const bad = [];
const allNames = Object.keys(ESCAPE_ALLOW).concat(Object.keys(found))
    .filter((v, i, a) => a.indexOf(v) === i).sort();
for (const name of allNames) {
    const want = (ESCAPE_ALLOW[name] || []).slice().sort();
    const got = (found[name] || []).slice().sort();
    if (want.join('|') === got.join('|')) continue;
    bad.push('· ' + name + '：白名单 [' + want.join(', ') + '] → 实际 [' + got.join(', ') + ']');
}
check('ESCAPE-GATE', bad);

// ── 汇总 ───────────────────────────────────────────────────────
const pass = results.filter(r => r.ok).length;
const fail = results.length - pass;
console.log('\n========== ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
process.exit(fail ? 1 : 0);
