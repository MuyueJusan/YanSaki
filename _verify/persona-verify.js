// 第十一轮：**人设生成器** —— 写一句设定，AI 按一份模板逐项填好，生成一整份人设
//
// 要证的六件事：
//   ① 模板**可以换**，而且换了之后**真的存下来了**（localStorage）、刷新还在、
//      清空 = 回到默认 —— 而「现在用的是不是默认」这个显示必须**跟存储一致**
//   ② 生成结果**不自动进卡**：先落在状态里、给你看、可以手改，点「写入」才进角色描述
//      （「生成的东西必须先能反悔」，跟第 9 轮 AI 生成预制块同一条规矩）
//   ③ 覆盖非空的角色描述**必须弹 confirm**；追加不用弹（它不破坏已有内容）—— 两条都要有**对照**
//   ④ 面板参数**不能只活在 DOM 里**（stRerender 会重建整个 pane），
//      忙态也一样 —— 「生成中…」必须扛得过一次重绘
//   ⑤ 提示词里**真的**带上了用户的原文 + 模板全文 + 这张卡的现状
//   ⑥ 失败路径（没配 / 网络不通 / 401 / 空回复）都有能看懂的话，且忙态一定归位
//   ⑦ 生成结果能**追加成一条世界书条目**（追加 ≠ 覆盖：原有条目必须一点没动），
//      而且「要不要拿卡名当人物姓名」是个**看得见、扛得住重绘**的勾选框
//
// 十二 段：
//   A. 装载与零报错
//   B. 选项卡：在不在、位置对不对、**真按钮**能不能切过去
//   C. 面板元素齐全（含反向对照：还没生成时结果框 / 三个按钮**不该在**）
//   D. 模板逻辑：默认逐字 / 懒加载 / 自定义落盘 / 刷新还在 / 清空回默认 / 恢复默认按钮
//      / 项数统计（含去重）/ 「是不是默认」跟存储一致 / 超长截断
//   E. 状态而不是 DOM：走**真实输入路径**（oninput）+ 重绘之后还在
//   F. 提示词：系统提示词 + 用户提示词（要求原文 / 模板全文 / 卡的名字）
//   G. 未配 AI：不发请求、只给提示、忙态归位（配好之后作对照）
//   H. 生成成功：围栏清洗 / 结果进状态 / 面板出现结果框 / 「对上了几项」（漏项 → warn，全中 → ok）
//   I. 写入与追加：空描述直接写 / 非空描述要 confirm（含**取消**对照）/ 追加不弹窗
//   I2. 追加到世界书（备注 / 关键词**都取生成结果里「姓名:」后面的字符** —— 含取值函数本身的
//       半角 / 全角 / 行首装饰 / 加粗 / CRLF / 取不到；
//       ⚠⚠ 套件里**故意**让「姓名:」跟卡名**不同**（艾莉丝 vs 夜乃），
//       否则「取的是 `姓名:`」和「取的是卡名」读出来是同一个字符串、断言分不出从哪儿取的；
//       真按钮 → 条目真的进卡、真的渲染出来；含「原有条目没被动」对照 + 空结果不动世界书
//       + 没有「姓名:」时回落卡名且**明说** + 两边都没有时关键词为空且提示是 warn）
//       / 要不要拿卡名当人物姓名（真勾选框 / 重绘后还原 / **真实请求**里也不带卡名）
//   J. 复制 + 忙态扛重绘 + 失败路径（网络不通 / 401 / 空回复）
//   K. 收尾零报错
//
// 跑法：node persona-verify.js

const PAGE_FILE = 'G:/saki/saki.html';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].find(p => fs.existsSync(p));
if (!CHROME) { console.log('找不到 Chrome / Edge'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const t0 = Date.now();
const log = m => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

let pass = 0, fail = 0;
const fails = [];
function check(name, actual, pred, expect) {
  const ok = typeof pred === 'function' ? pred(actual) : actual === pred;
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else {
    fail++; fails.push(name);
    console.log(`  ❌ ${name}  actual=${JSON.stringify(actual)}  expect=${expect === undefined ? pred : JSON.stringify(expect)}`);
  }
}
function section(t) { console.log('\n== ' + t + ' =='); }

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map();
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id);
        if (m.error) p.rej(new Error(JSON.stringify(m.error))); else p.res(m.result);
      } else if (m.method) (this.handlers.get(m.method) || []).forEach(f => f(m.params));
    });
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
  send(method, params = {}, sessionId, timeout = 30000) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const tm = setTimeout(() => { this.pending.delete(id); rej(new Error(`CDP 超时 ${method}`)); }, timeout);
      this.pending.set(id, { res: v => { clearTimeout(tm); res(v); }, rej: e => { clearTimeout(tm); rej(e); } });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
    });
  }
}

const CANDIDATES = [8995, 8996, 8997, 8998];
let HTTP_PORT = CANDIDATES[0];
function pickPort() {
  return new Promise(resolve => {
    const tryOne = i => {
      if (i >= CANDIDATES.length) { resolve(); return; }
      const probe = http.createServer();
      probe.on('error', () => { try { probe.close(); } catch (e) {} tryOne(i + 1); });
      probe.listen(CANDIDATES[i], '127.0.0.1', () => probe.close(() => {
        HTTP_PORT = CANDIDATES[i]; resolve();
      }));
    };
    tryOne(0);
  });
}
function startServer() {
  const dir = path.dirname(PAGE_FILE), base = path.basename(PAGE_FILE);
  return new Promise((res, rej) => {
    const srv = http.createServer((req, rep) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      const f = path.join(dir, u === '/' ? base : u.replace(/^\/+/, ''));
      fs.readFile(f, (e, buf) => {
        if (e) { rep.writeHead(404); rep.end('nope'); return; }
        const ext = path.extname(f).toLowerCase();
        rep.writeHead(200, {
          'Content-Type': ext === '.html' ? 'text/html; charset=utf-8'
            : ext === '.ttf' ? 'font/ttf' : 'application/octet-stream',
          'Cache-Control': 'no-store'
        });
        rep.end(buf);
      });
    });
    srv.on('error', rej);
    srv.listen(HTTP_PORT, '127.0.0.1', () => res(srv));
  });
}

// 用户给的那份默认模板，**在测试里独立写一遍** —— 不引用产品常量，
// 否则「产品把常量改错了」这件事在测试里永远看不见（拿常量比自己永远相等）
const TPL_EXPECT = [
  '基本信息:', '姓名:', '年龄:', '性别:', '身高:', '身份:', '背景故事:',
  '外貌:', '发型:', '眼睛:', '肤色:', '脸型:', '体型:', '三围：', '气味：',
  '衣着风格:', '校园/工作的日常装：', '- 风格：', '- 标志性穿着：', '- 配饰习惯：',
  '休闲装:', '- 风格：', '- 标志性穿着：', '- 配饰习惯：',
  '居家服:', '- 风格：', '- 标志性穿着：', '- 配饰习惯：',
  '泳装：', '内衣：', '性格:', '核心特质:', '恋爱特质:', '生活习惯:', '情绪表现:',
  '愤怒时:', '高兴时:', '缺点弱点:', '喜好厌恶:', '喜欢:', '讨厌:', '补充：'
].join('\n');

// 独立算一遍「模板里有多少个字段」——**换一种写法**（剥掉行首的 `- `、看行尾是不是冒号），
// 而不是抄产品那个正则。抄正则的话，正则写错时两边一起错
function expectLabels(tpl) {
  const out = [];
  String(tpl).split('\n').forEach(line => {
    const t = line.replace(/^[\s-]+/, '').replace(/\s+$/, '');
    if (!/[:：]$/.test(t)) return;
    const k = t.slice(0, -1).replace(/\s+$/, '');
    if (k && out.indexOf(k) < 0) out.push(k);
  });
  return out;
}

// 假 fetch 的源码。用 addScriptToEvaluateOnNewDocument 装 —— **刷新之后桩还在**，
// 「自定义模板刷新还在不在」那一段才立得住
const MOCK_SRC = `
window.__aiCalls = [];
window.__aiScript = { reply: '', fail: '', delay: 0 };
window.__copied = null;
// clipboard 也桩掉：headless 下 navigator.clipboard.writeText 会因为「文档没聚焦」而 reject，
// 那是环境问题不是产品问题 —— 但那样就分不清「复制按钮接错了」和「浏览器不让写」
try {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: t => { window.__copied = String(t); return Promise.resolve(); } }
  });
} catch (e) {}
window.fetch = async function (url, init) {
  init = init || {};
  let body = null;
  try { body = init.body ? JSON.parse(init.body) : null; } catch (e) {}
  window.__aiCalls.push({ url: String(url), method: init.method || 'GET',
    headers: init.headers || {}, body: body });
  const S = window.__aiScript;
  if (S.delay) await new Promise(r => setTimeout(r, S.delay));
  if (S.fail === 'network') throw new TypeError('Failed to fetch');
  if (S.fail === 'http401') return new Response('{"error":{"message":"invalid api key"}}',
    { status: 401, headers: { 'Content-Type': 'application/json' } });
  const content = (S.fail === 'notjson') ? '好的，这是人设。'
    : String(S.reply == null ? '' : S.reply);
  return new Response(JSON.stringify({ choices: [{ message: { content: content } }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } });
};
`;

(async () => {
  // 端口不能写死、也不能纯随机：连跑整套时上一轮 Chrome 还没退干净就会占着
  // 刚抽到的号，症状是「Chrome 调试端口没起来」—— 跟被测页面一点关系都没有
  await pickPort();
  const cdpPort = await (async () => {
    for (let i = 0; i < 80; i++) {
      const p = 9500 + Math.floor(Math.random() * 900);
      const free = await new Promise(res => {
        const probe = http.createServer();
        probe.on('error', () => { try { probe.close(); } catch (e) {} res(false); });
        probe.listen(p, '127.0.0.1', () => probe.close(() => res(true)));
      });
      if (free) return p;
      await sleep(40);
    }
    return 9500 + Math.floor(Math.random() * 900);
  })();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-persona-'));
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu',
    '--no-first-run', '--hide-scrollbars',
    `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`], { stdio: 'ignore' });

  let cdp = null, SID = null, srv = null;
  const ev = async (expr, awaitPromise = false, timeout = 30000) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise }, SID, timeout);
    if (r.exceptionDetails) {
      throw new Error('页面异常: ' + (r.exceptionDetails.exception
        ? r.exceptionDetails.exception.description : r.exceptionDetails.text));
    }
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' }, SID);
    fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, 'base64'));
    console.log(`  📸 ${name} (${Math.round(Buffer.from(r.data, 'base64').length / 1024)} KB)`);
  };

  // —— 页面内的小工具 ——
  const script = (o) => ev(`(function(){ Object.assign(window.__aiScript, ${JSON.stringify(o)}); return true; })()`);
  const clearCalls = () => ev(`(window.__aiCalls = [], true)`);
  const callN = () => ev(`window.__aiCalls.length`);
  const lastCall = () => ev(`(function(){ const c = window.__aiCalls; return c.length ? c[c.length-1] : null; })()`);
  const msgText = () => ev(`(stEditor.msg && stEditor.msg.text) || ''`);
  const msgKind = () => ev(`(stEditor.msg && stEditor.msg.kind) || ''`);
  const desc = () => ev(`(stEditor.card && stEditor.card.description) || ''`);
  const dlg = () => ev(`window.__dlg || []`);
  const dlgClear = () => ev(`(window.__dlg = [], true)`);
  const confirmYes = (v) => ev(`(window.__confirmYes = ${v ? 'true' : 'false'}, true)`);
  const tplStored = () => ev(`(function(){ try { return localStorage.getItem('stPersonaTpl'); } catch (e) { return 'ERR'; } })()`);
  const busy = () => ev(`stEditor.personaBusy === true`);
  const out = () => ev(`String(stEditor.personaOut || '')`);
  const tab = () => ev(`stEditor.tab`);
  const gen = () => ev(`stPersonaRun()`, true, 40000);
  const waitFor = async (expr, ms = 15000) => {
    const t = Date.now();
    while (Date.now() - t < ms) { if (await ev(expr)) return true; await sleep(120); }
    return false;
  };
  // 走**真输入路径**：改 DOM 的 value 再派发 input 事件。
  // 直接调 stPersonaReqSet 只证明「那个函数写得对」，证明不了「输入框接上了它」
  const typeIn = (id, v) => ev(`(function(){
    const el = document.getElementById(${JSON.stringify(id)});
    if (!el) return false;
    el.value = ${JSON.stringify(v)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true; })()`);
  const openPersona = async () => {
    await ev(`openStEditor()`);
    await ev(`stSwitchTab('persona')`);
    await sleep(250);
  };
  const reload = async () => {
    const l = new Promise(res => cdp.on('Page.loadEventFired', res));
    await cdp.send('Page.reload', {}, SID);
    await l;
    await ev(`document.fonts.ready.then(() => true)`, true);
    await sleep(500);
  };
  // ⚠ 刷新之后 aiConfig 会回到 localStorage 里那份（我在内存里改的没存过），
  //   所以每次 reload 之后都得重配一遍 —— 否则后面那条 gen 会红在
  //   「还没配 Base URL」上，看着像功能坏了
  const configAi = () => ev(`(function(){
    aiConfig.provider = 'deepseek';
    aiConfig.baseUrl = 'https://api.deepseek.com/v1';
    aiConfig.apiKey = 'sk-test-KKK';
    aiConfig.model = 'deepseek-chat';
    aiConfig.temperature = 0.7;
    aiConfig.maxTokens = 2048;
    return true; })()`);

  try {
    let wsUrl = null;
    for (let i = 0; i < 80; i++) {
      try { wsUrl = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json()).webSocketDebuggerUrl; } catch (e) {}
      if (wsUrl) break; await sleep(250);
    }
    if (!wsUrl) throw new Error('连不上 CDP');
    const ws = new WebSocket(wsUrl);
    await new Promise(r => ws.addEventListener('open', r));
    cdp = new CDP(ws);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    SID = (await cdp.send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
    await cdp.send('Page.enable', {}, SID);
    await cdp.send('Runtime.enable', {}, SID);
    // 页内的 confirm 一律换成同步桩（走 CDP 应答约 20% 会翻车）
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__dlg = [];
        window.__confirmYes = true;
        window.confirm = function (m) { window.__dlg.push(String(m)); return window.__confirmYes !== false; };
        ${MOCK_SRC}`
    }, SID);
    const consoleErrors = [];
    cdp.on('Runtime.consoleAPICalled', p => {
      if (p.type === 'error') consoleErrors.push((p.args || []).map(a => a.value || a.description).join(' '));
    });
    cdp.on('Runtime.exceptionThrown', p => {
      const d = p.exceptionDetails;
      consoleErrors.push('EXCEPTION: ' + (d.exception ? d.exception.description : d.text));
    });

    srv = await startServer();
    await cdp.send('Emulation.setDeviceMetricsOverride',
      { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, SID);
    let loaded = new Promise(res => cdp.on('Page.loadEventFired', res));
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/` }, SID);
    await loaded;
    await ev('localStorage.clear()');
    await reload();
    log('页面加载完成');

    // ============ A. 装载与零报错 ============
    section('A. 装载与零报错');
    check('页面无 console 错误', consoleErrors.filter(x => !/favicon/i.test(x)),
      v => v.length === 0, []);
    check('假 fetch 装上了', await ev(`typeof window.fetch === 'function' && Array.isArray(window.__aiCalls)`), true);
    check('clipboard 桩装上了', await ev(`!!(navigator.clipboard && navigator.clipboard.writeText)`), true);

    await openPersona();
    check('编辑器已打开',
      await ev(`document.getElementById('st-overlay').classList.contains('active')`), true);
    check('卡在（否则后面写角色描述无从谈起）', await ev(`!!stEditor.card`), true);

    // ============ B. 选项卡 ============
    section('B. 选项卡：在不在、位置对不对、真按钮能不能切');
    const tabs = await ev(`ST_TABS.map(t => ({ id: t.id, ico: t.ico, label: t.label }))`);
    check('选项卡总数 15（加了这个之后）', tabs.length, 15);
    const pi = tabs.findIndex(t => t.id === 'persona');
    const ci = tabs.findIndex(t => t.id === 'code');
    const di = tabs.findIndex(t => t.id === 'desc');
    check('人设生成器在清单里', pi >= 0, true);
    // ⚠ 它现在排在 **Code 后面**（用户指定），不是「角色描述」后面。
    //   别按「它产出的东西是角色描述」把这条改回 desc —— 那是看起来更合理的错位。
    check('它紧跟在 Code 后面', pi - ci, 1, 1);
    // 反向对照：既然挪走了，就**不该**还贴着「角色描述」。
    // 少了这条，只把顺序原样留在 desc 后面也能让上面那条正断言「看起来还行」
    // —— 正断言只要求挨着 code，不要求离开 desc。
    check('它不再跟在「角色描述」后面（对照组）', pi - di, v => v !== 1, '≠1');
    check('标签是「人设生成器」', tabs[pi] && tabs[pi].label, '人设生成器');
    check('图标是 🎭', tabs[pi] && tabs[pi].ico, '🎭');

    check('选项卡按钮渲染出来了', await ev(`!!document.getElementById('st-tab-persona')`), true);
    check('按钮上的字是「人设生成器」',
      await ev(`(document.querySelector('#st-tab-persona .st-tab-label') || {}).textContent`), '人设生成器');
    // 走**真按钮** —— 要验的正是「接对了没有」，不是「函数存在」
    await ev(`document.getElementById('st-tab-persona').click()`);
    await sleep(250);
    check('点真按钮切到了 persona 页', await tab(), 'persona');
    check('按钮拿到了 active 类',
      await ev(`document.getElementById('st-tab-persona').classList.contains('active')`), true);

    // ============ C. 面板元素 ============
    section('C. 面板元素齐全（含反向对照）');
    check('需求输入框在', await ev(`!!document.getElementById('st-persona-req')`), true);
    check('模板框在', await ev(`!!document.getElementById('st-persona-tpl')`), true);
    check('生成按钮在', await ev(`!!document.getElementById('st-persona-run')`), true);
    check('「恢复默认模板」按钮在', await ev(`!!document.getElementById('st-persona-tpl-reset')`), true);
    check('AI 状态行在', await ev(`!!document.getElementById('st-persona-ai-status')`), true);
    check('生成按钮文案是「✨ 生成人设」',
      await ev(`document.getElementById('st-persona-run').textContent.trim()`), '✨ 生成人设');
    check('生成按钮没被禁用', await ev(`document.getElementById('st-persona-run').disabled`), false);
    check('生成按钮真的接上了 onclick',
      await ev(`typeof document.getElementById('st-persona-run').onclick === 'function'`), true);
    check('需求框给了例子',
      await ev(`document.getElementById('st-persona-req').getAttribute('placeholder')`),
      v => /例如/.test(v), '含「例如」');
    // 反向对照：还没生成，结果区**不该在** —— 少了这几条，「结果框一直都在」
    // 这种退化（比如空态被顺手删了）会被上面前几条掩盖
    check('还没生成 ⇒ 没有结果框', await ev(`!!document.getElementById('st-persona-out')`), false);
    check('还没生成 ⇒ 没有「写入」按钮', await ev(`!!document.getElementById('st-persona-write')`), false);
    check('还没生成 ⇒ 没有「追加」按钮', await ev(`!!document.getElementById('st-persona-append')`), false);
    check('还没生成 ⇒ 没有「复制」按钮', await ev(`!!document.getElementById('st-persona-copy')`), false);
    check('空态说了「还没有生成结果」',
      await ev(`(function(){ const e = document.querySelector('#st-panes .st-empty');
        return e ? e.textContent : ''; })()`), v => /还没有生成结果/.test(v), '含「还没有生成结果」');
    await shot('persona-01-pane.png');

    // ============ C2. 「模板」折叠 + 配置行的位置（第十二轮）============
    // ⚠ 这一段盯的是 `#st-persona-ai-status`（配置行「当前生效：…」）。
    //   「工作状态」那个格子（`#st-persona-msg`）是**另一个元素**，在 C3 段。
    section('C2. 模板默认折叠、点标题能展开、配置行在模板下面');
    // ⚠⚠ 判「收起了」**不能看 rect** —— 折叠靠 `grid-template-rows: 0fr` + `overflow: hidden`，
    //     **裁切不影响 `getBoundingClientRect()`**：里面那个 textarea 的 rect 照样是满高。
    //     所以这里① 量**外层网格容器自己**（它确实塌成 0）、② 做一次**命中测试**。
    //     「textarea 的 rect 还是满高」那条留成**对照**，免得下次又有人拿 rect 当判据。
    const foldProbe = `(function(){
      const box = document.getElementById('st-persona-tpl-fold');
      const body = document.getElementById('st-persona-tpl-body');
      const head = document.getElementById('st-persona-tpl-toggle');
      const inner = document.querySelector('#st-persona-tpl-fold .st-fold-inner');
      const ta = document.getElementById('st-persona-tpl');
      if (!box || !body || !head || !inner || !ta) return { err: '缺节点' };
      head.scrollIntoView({ block: 'center' });
      const hr = head.getBoundingClientRect();
      const y = hr.bottom + 60, x = hr.left + 30;
      const inView = y > 0 && y < innerHeight && x > 0 && x < innerWidth;
      const hit = inView ? document.elementFromPoint(x, y) : null;
      return {
        open: box.classList.contains('st-fold-open'),
        aria: head.getAttribute('aria-expanded'),
        rows: getComputedStyle(body).gridTemplateRows,
        bodyH: Math.round(body.getBoundingClientRect().height),
        innerH: Math.round(inner.getBoundingClientRect().height),
        taH: Math.round(ta.getBoundingClientRect().height),
        inView: inView,
        hitInside: !!(hit && hit.closest && hit.closest('#st-persona-tpl-fold')),
        ico: getComputedStyle(document.querySelector('#st-persona-tpl-fold .st-fold-ico')).transform
      };
    })()`;

    const p0 = await ev(foldProbe);
    check('默认**没有** st-fold-open 类', p0.open, false);
    check('默认 aria-expanded 是 false', p0.aria, 'false');
    check('折叠体算出来是 0 行（computed grid-template-rows）', p0.rows,
      v => /^0px/.test(v), '以 0px 开头');
    check('折叠体量出来高约 0', p0.bodyH, v => v <= 2, '≤ 2');
    check('内层（overflow:hidden 那个）也是 0 高', p0.innerH, v => v <= 2, '≤ 2');
    check('默认箭头是转下去的（computed transform 不是 none）', p0.ico,
      v => v !== 'none', '不是 none');
    // 反向对照：这一条**故意断言「量 rect 判不出来」** —— 它就是上一轮踩的那个坑
    check('（对照）里面 textarea 自己的 rect **照样是满高** ⇒「量 rect」判不出收起',
      p0.taH, v => v > 100, '> 100');
    check('（对照）命中测试那个点确实落在视口里（否则下一条会天然成立）', p0.inView, true);
    check('收起时：折叠头下方 60px 那个点**打在折叠块外面**', p0.hitInside, false);

    // 点**真按钮**展开
    await ev(`document.getElementById('st-persona-tpl-toggle').click()`);
    // ⚠⚠ 别用固定 sleep 等 CSS 过渡。`.st-fold-ico` 是 `transition: transform 0.3s`，
    //   而这里原本 `sleep(450)` —— 看着有 150ms 余量，**实测会偶尔不够**：
    //   反向测试 R8 那一跑就多红了「展开后箭头转回正」这一条，而 R8 打的是 `scope`，
    //   跟折叠**毫无关系** ⇒ 是假红。headless 下过渡由 rAF 驱动，主线程一忙
    //   （比如常驻条刚显示、触发了重排）就会拖后。
    //   而这条断言**不能删**：R6（点了也不开）下它必须红。所以改成「等到它真的转回正」。
    await waitFor(`(function(){
      const ico = getComputedStyle(document.querySelector('#st-persona-tpl-fold .st-fold-ico')).transform;
      const h = document.getElementById('st-persona-tpl-body').getBoundingClientRect().height;
      return ico === 'none' && h > 200;
    })()`, 3000);
    const p1 = await ev(foldProbe);
    check('展开后拿到了 st-fold-open 类', p1.open, true);
    check('展开后 aria-expanded 是 true', p1.aria, 'true');
    check('展开后折叠体不再是 0 行', p1.rows, v => !/^0px/.test(v), '不以 0px 开头');
    check('展开后折叠体真的有了高度', p1.bodyH, v => v > 200, '> 200');
    check('展开后命中测试打在折叠块**里面**', p1.hitInside, true);
    check('展开后箭头转回正（computed transform 是 none）', p1.ico, 'none');

    // 再点一次收回 —— 对照组：证明上一条不是「一展开就回不去」
    await ev(`document.getElementById('st-persona-tpl-toggle').click()`);
    // ⚠ 同理，别用固定 sleep —— 收起要等 `grid-template-rows` 真的塌成 0
    await waitFor(`document.getElementById('st-persona-tpl-body').getBoundingClientRect().height <= 2`, 3000);
    const p2 = await ev(foldProbe);
    check('再点一次又收起了', p2.open, false);
    check('收起后折叠体又回到 0 高', p2.bodyH, v => v <= 2, '≤ 2');

    // 折叠态**从状态渲染**：重绘之后必须还在（不是只活在 DOM 上）
    await ev(`stEditor.personaTplOpen = true; stRerender()`);
    await sleep(150);
    check('重绘之后展开态还在（状态驱动，不是只活在 DOM 上）',
      await ev(`document.getElementById('st-persona-tpl-fold').classList.contains('st-fold-open')`), true);
    await ev(`stEditor.personaTplOpen = false; stRerender()`);
    await sleep(150);
    check('（对照）重绘之后收起态也如实反映',
      await ev(`document.getElementById('st-persona-tpl-fold').classList.contains('st-fold-open')`), false);

    // 状态提示的位置：DOM 顺序上必须排在模板**后面**
    const order = await ev(`(function(){
      const box = document.getElementById('st-persona-tpl-fold');
      const st = document.getElementById('st-persona-ai-status');
      const pane = box.closest('.st-pane');
      const act = pane.querySelector('.st-actions');
      const all = [...document.querySelectorAll('#st-panes *')];
      return { fold: all.indexOf(box), status: all.indexOf(st), act: all.indexOf(act) };
    })()`);
    check('状态提示排在模板折叠块**后面**', order.status > order.fold, true);
    // ⚠ 对照组不能写成「status < fold」—— 那是主断言的**反命题**，逻辑上恒真，
    //   等于没对照。真正的风险是 `indexOf` **没找到时返回 -1**：只要 fold 是 -1，
    //   任何 status 都「大于」它 ⇒ 主断言天然成立。所以对照要盯**两个节点都在表里**。
    check('（对照）两个节点都在顺序表里找到了（否则 indexOf 的 -1 会让上一条天然成立）',
      order.fold >= 0 && order.status >= 0, true);
    check('状态提示排在按钮行前面', order.status < order.act, true);

    // ============ C3. 工作状态贴着「生成人设」按钮（第十三轮）============
    section('C3. 生成器的工作状态在按钮上方（不再只活在常驻条里）');
    // ⚠ 需求：「把生成器的工作状态（『⏳ 正在让 AI 生成人设…』之类）挪到『生成人设』按钮上方」。
    //   原来这类消息只出现在浮层**最上面**那条常驻条 `#st-status` 里 —— 眼睛盯着按钮时看不见，
    //   点了没反应，看着像坏了。
    // ⚠⚠ 别跟 `#st-persona-ai-status` 搞混：那是**配置行**（「当前生效：跟随全局…」），
    //   建面板时算出来的静态行，上一轮挪到模板下面，**本段不管它**。
    const posMsg = await ev(`(function(){
      const all = [...document.querySelectorAll('#st-panes *')];
      return {
        msg: all.indexOf(document.getElementById('st-persona-msg')),
        run: all.indexOf(document.getElementById('st-persona-run'))
      };
    })()`);
    // ⚠ 对照组必须在前：`indexOf` 找不到时返回 **-1**，而「-1 < 任何正数」恒真
    //   ⇒ 主断言会**天然成立**。所以先盯「两个节点都在表里」。
    check('（对照）工作状态格与生成按钮都在顺序表里找到了',
      posMsg.msg >= 0 && posMsg.run >= 0, true);
    check('工作状态格排在「生成人设」按钮**前面**（DOM 顺序 = 上方）',
      posMsg.msg, v => v >= 0 && v < posMsg.run, '≥0 且 < 按钮位置');
    check('还没生成时工作状态格没字',
      await ev(`document.getElementById('st-persona-msg').textContent`), '');
    check('还没生成时工作状态格不显示',
      await ev(`getComputedStyle(document.getElementById('st-persona-msg')).display`), 'none');

    // 分流：**一条消息只出现在一个地方** —— 人设页开着时进页内格，常驻条留空
    await ev(`stExportMsg('测试：页内格', '', 'persona')`);
    await sleep(120);
    check('带 scope=persona ⇒ 页内格显示出来',
      await ev(`document.getElementById('st-persona-msg').textContent`), '测试：页内格');
    check('（对照）同一时刻常驻条 `#st-status` 是空的 —— 同一句话不能出现两遍',
      await ev(`document.getElementById('st-status').textContent`), '');
    check('页内格空 kind 时用 ok 样式（绿）',
      await ev(`document.getElementById('st-persona-msg').className`),
      v => /st-ok/.test(v), '含 st-ok');

    // 切到别的选项卡 ⇒ 消息**退回常驻条**，不能丢
    await ev(`stSwitchTab('desc')`);
    await sleep(200);
    check('切走之后常驻条接住了这条消息（消息不丢）',
      await ev(`document.getElementById('st-status').textContent`), '测试：页内格');
    await ev(`stSwitchTab('persona')`);
    await sleep(200);
    check('切回来之后页内格又接住了',
      await ev(`document.getElementById('st-persona-msg').textContent`), '测试：页内格');
    check('（对照）切回来之后常驻条又空了',
      await ev(`document.getElementById('st-status').textContent`), '');
    // 清干净，别污染后面几段
    await ev(`stExportMsg('', '')`);
    await sleep(120);
    check('（收尾）清空之后页内格也空了',
      await ev(`document.getElementById('st-persona-msg').textContent`), '');

    // ============ D. 模板逻辑 ============
    section('D. 模板逻辑');
    check('默认模板**逐字**等于用户给的那份', await ev(`stPersonaTpl()`), TPL_EXPECT);
    check('模板框里显示的就是它',
      await ev(`document.getElementById('st-persona-tpl').value`), TPL_EXPECT);
    check('标签写着「（默认）」',
      await ev(`(function(){ const s = [...document.querySelectorAll('#st-panes .st-sub')];
        const h = s.filter(x => /^模板/.test(x.textContent))[0];
        return h ? h.textContent : ''; })()`), v => /（默认）/.test(v), '含「（默认）」');

    // 项数：独立算一遍，再跟产品给的对
    const exp = expectLabels(TPL_EXPECT);
    const got = await ev(`stPersonaLabels(stPersonaTpl())`);
    // ⚠ 数组不能用 `===` 比 —— 那是**引用相等**，两份内容一样的数组永远不等。
    //   第一版就是这么写的，于是这两条「红」得毫无信息量（actual 跟 expect 明明一样）
    const sameArr = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    check('项数跟独立算出来的一致', got, v => sameArr(v, exp), exp);
    check('项数里没有重复（风格 / 标志性穿着 / 配饰习惯 各出现 3 次，只能算一项）',
      got.length, new Set(got).size);
    check('「风格」只算了一项', got.filter(k => k === '风格').length, 1);
    check('首项是「基本信息」', got[0], '基本信息');
    check('末项是「补充」', got[got.length - 1], '补充');
    check('全角冒号那几行也认（三围 / 气味 / 泳装 / 内衣）',
      ['三围', '气味', '泳装', '内衣'].filter(k => got.indexOf(k) < 0), v => v.length === 0, []);
    check('`- 风格：` 这种带前缀的子项认成了「风格」而不是「- 风格」',
      got.indexOf('- 风格'), -1);
    check('标签上写了项数',
      await ev(`document.querySelector('#st-persona-tpl').parentNode.querySelector('.st-hint-inline').textContent`),
      v => v.indexOf(String(exp.length)) === 0, '以「' + exp.length + '」开头');

    // 自定义 → 落盘
    const MY_TPL = '姓名:\n年龄:\n性别:';
    await typeIn('st-persona-tpl', MY_TPL);
    check('模板写进了状态', await ev(`stEditor.personaTpl`), MY_TPL);
    check('而且存进了 localStorage', await tplStored(), MY_TPL);
    check('「是不是默认」跟着变成 false', await ev(`stPersonaTplIsDefault()`), false);
    await ev(`stRerender()`);
    await sleep(150);
    check('重绘之后模板框里还是它（对照组：证明上一条不是白写的）',
      await ev(`document.getElementById('st-persona-tpl').value`), MY_TPL);
    check('标签改成了「（已自定义）」',
      await ev(`(function(){ const s = [...document.querySelectorAll('#st-panes .st-sub')];
        const h = s.filter(x => /^模板/.test(x.textContent))[0];
        return h ? h.textContent : ''; })()`), v => /已自定义/.test(v), '含「已自定义」');

    // 刷新还在 —— 懒加载那条路（内存里是 null，只能从 localStorage 读）
    await reload();
    await openPersona();
    await configAi();
    check('刷新之后模板还在（读的就是刚才存的那份）', await ev(`stPersonaTpl()`), MY_TPL);
    check('刷新之后模板框里也是它',
      await ev(`document.getElementById('st-persona-tpl').value`), MY_TPL);
    // ⚠ 「懒加载」这条要**单独**证，不能拿刷新后那个值当证据：渲染面板时就会调
    //   stPersonaTpl()，等我们去读的时候它早被填好了。手动把内存清成 null 再读一次，
    //   走的才只剩 localStorage 一条路
    await ev(`(stEditor.personaTpl = null, true)`);
    check('内存清空后 stPersonaTpl() 能从 localStorage 读回来',
      await ev(`stPersonaTpl()`), MY_TPL);

    // 超长截断
    const HUGE = 'あ'.repeat(9000);
    await typeIn('st-persona-tpl', HUGE);
    check('超长模板被截到上限', await ev(`stEditor.personaTpl.length`), 8000);
    check('截断之后存进去的也是截过的',
      await ev(`localStorage.getItem('stPersonaTpl').length`), 8000);

    // 清空 = 回到默认（而且**删键**，不是存空串）
    await typeIn('st-persona-tpl', '');
    check('清空之后 localStorage 的键被删了（不是存了个空串）', await tplStored(), null);
    check('清空之后「是不是默认」为 true', await ev(`stPersonaTplIsDefault()`), true);
    check('清空之后 stPersonaTpl() 回落到默认模板（不然面板会说「默认」却给空模板）',
      await ev(`stPersonaTpl()`), TPL_EXPECT);
    await ev(`stRerender()`);
    await sleep(150);
    check('重绘之后模板框里是默认模板（不是空的）',
      await ev(`document.getElementById('st-persona-tpl').value`), TPL_EXPECT);

    // 「恢复默认模板」按钮
    await typeIn('st-persona-tpl', '只有一项:');
    check('先自定义一下', await tplStored(), '只有一项:');
    await ev(`document.getElementById('st-persona-tpl-reset').click()`);
    await sleep(200);
    check('点「恢复默认模板」之后模板回到默认', await ev(`stPersonaTpl()`), TPL_EXPECT);
    check('localStorage 的键也被清掉了', await tplStored(), null);
    check('模板框里也刷新成默认了',
      await ev(`document.getElementById('st-persona-tpl').value`), TPL_EXPECT);
    check('当面说了恢复了多少项', await msgText(), v => /恢复默认/.test(v), '含「恢复默认」');
    check('提示是 ok 不是 warn', await msgKind(), '');

    // ============ E. 状态而不是 DOM ============
    section('E. 面板参数活在状态里（重绘之后还在）');
    const REQ = '冷淡的吸血鬼女仆，喜欢红茶，讨厌阳光，说话很短';
    await typeIn('st-persona-req', REQ);
    check('需求写进了状态', await ev(`stEditor.personaReq`), REQ);
    await ev(`stRerender()`);
    await sleep(150);
    check('重绘之后需求框里还是它', await ev(`document.getElementById('st-persona-req').value`), REQ);
    await typeIn('st-persona-req', 'あ'.repeat(2500));
    check('超长需求被截到上限', await ev(`stEditor.personaReq.length`), 2000);
    await typeIn('st-persona-req', REQ);

    // ============ F. 提示词 ============
    section('F. 提示词内容');
    await ev(`stSet('card.name', '夜乃')`);
    await clearCalls();
    await script({ reply: '姓名: 夜乃' });
    await gen();
    const call = await lastCall();
    check('确实发了 1 次请求', await callN(), 1);
    check('发去了 /chat/completions（OpenAI 形状）',
      call && call.url, v => /\/chat\/completions$/.test(v || ''), '以 /chat/completions 结尾');
    const msgs = (call && call.body && call.body.messages) || [];
    check('两条消息：system + user', msgs.length, 2);
    check('第一条是 system', msgs[0] && msgs[0].role, 'system');
    const sys = (msgs[0] && msgs[0].content) || '';
    const usr = (msgs[1] && msgs[1].content) || '';
    check('system 里有「硬规则」', /硬规则/.test(sys), true);
    check('system 要求只输出人设本身（不许寒暄 / 围栏）',
      /只输出填好的人设本身/.test(sys), true);
    check('system 要求照模板的结构和顺序', /严格照模板的结构和顺序/.test(sys), true);
    check('system 要求别加模板以外的字段', /没有.*的字段不要自己加|不要自己加/.test(sys), true);
    check('system 说了用中文', /用中文/.test(sys), true);
    check('user 里带上了用户的要求原文', usr.indexOf(REQ) >= 0, true);
    check('user 里带上了**模板全文**', usr.indexOf(TPL_EXPECT) >= 0, true);
    check('user 里带上了这张卡的名字（跟它保持一致）',
      /这张卡现在的名字：夜乃/.test(usr), true);
    check('user 里有「照它的结构逐项填」这一节', /## 模板/.test(usr), true);
    check('maxTokens 至少给了 2048（人设比预制块长得多）',
      call && call.body && call.body.max_tokens, v => v >= 2048, '>= 2048');

    // ============ G. 未配 AI ============
    section('G. 未配 AI：不发请求、只给提示');
    await ev(`(function(){ aiConfig.baseUrl = ''; aiConfig.apiKey = ''; aiConfig.model = ''; return true; })()`);
    check('就绪判定先确认一下是「没配」', (await ev(`stAiReady(stAiCfg())`)).ok, false);
    // ⚠ 状态行是**建面板时**算出来的，改了配置得重绘才看得见 —— 不重绘就检查它，
    //   检查到的是上一次渲染的旧值（第一版就这么红了一条）
    await ev(`stRerender()`);
    await sleep(150);
    await clearCalls();
    await gen();
    check('没配就不发请求', await callN(), 0);
    check('而且当面说了为什么', await msgText(), v => /还没配|还没填|还没选/.test(v), '含「还没配/填/选」');
    check('提示是 warn 而不是 ok', await msgKind(), 'warn');
    check('忙态没有卡住', await busy(), false);
    check('状态行也标了 warn',
      await ev(`document.getElementById('st-persona-ai-status').className`),
      v => /st-warn/.test(v), '含 st-warn');

    await configAi();
    check('配好之后就绪判定通过（对照组）', (await ev(`stAiReady(stAiCfg())`)).ok, true);
    await ev(`stRerender()`);
    await sleep(150);
    check('状态行跟着变成 ok',
      await ev(`document.getElementById('st-persona-ai-status').className`),
      v => /st-ok/.test(v), '含 st-ok');

    // 需求空着也不该发请求
    await clearCalls();
    await typeIn('st-persona-req', '   ');
    await gen();
    check('需求空着 ⇒ 不发请求', await callN(), 0);
    check('而且提示先去写一句', await msgText(), v => /先写一句/.test(v), '含「先写一句」');
    await typeIn('st-persona-req', REQ);

    // ============ H. 生成成功 ============
    section('H. 生成成功：清洗 / 进状态 / 面板 / 「对上了几项」');
    // ① 全中：三项都出现 → ok
    const OK_REPLY = '姓名: 夜乃\n年龄: 19\n性别: 女';
    await ev(`stPersonaTplSet('姓名:\\n年龄:\\n性别:')`);
    await ev(`stRerender()`);
    await sleep(150);
    await script({ reply: OK_REPLY });
    await gen();
    check('结果进了状态', await out(), OK_REPLY);
    check('面板上出现了结果框', await ev(`!!document.getElementById('st-persona-out')`), true);
    check('结果框里的内容跟状态一致',
      await ev(`document.getElementById('st-persona-out').value`), OK_REPLY);
    check('三个按钮都出来了',
      await ev(`['st-persona-write','st-persona-append','st-persona-copy']
        .every(id => !!document.getElementById(id))`), true);
    check('空态没了', await ev(`!!document.querySelector('#st-panes .st-empty')`), false);
    check('提示说「对上了 3 项」', await msgText(), v => /对上了 3 项/.test(v), '含「对上了 3 项」');
    check('全中 ⇒ 提示是 ok（不是 warn）', await msgKind(), '');
    check('小标题报了几字符 + 对上几项',
      await ev(`(function(){ const s = [...document.querySelectorAll('#st-panes .st-sub')];
        const h = s.filter(x => /^生成结果/.test(x.textContent))[0];
        return h ? h.textContent : ''; })()`), v => /对上了 3 项/.test(v), '含「对上了 3 项」');
    await shot('persona-02-generated.png');

    // ② 漏一项 → warn，并且说出漏了几项（对照组：证明①那条不是恒真）
    await script({ reply: '姓名: 夜乃\n年龄: 19' });
    await gen();
    check('漏了 1 项 ⇒ 提示说「1 项没出现」', await msgText(), v => /1 项没出现/.test(v), '含「1 项没出现」');
    check('漏项时提示是 warn', await msgKind(), 'warn');
    check('但结果照样进了状态（不是整份丢掉）', await out(), '姓名: 夜乃\n年龄: 19');

    // ③ 围栏要被洗掉
    await script({ reply: '```\n姓名: 夜乃\n年龄: 19\n性别: 女\n```' });
    await gen();
    check('围栏被洗掉了', await out(), OK_REPLY);
    check('洗完之后第一行就是正文（没有 ``` 残留）',
      await ev(`String(stEditor.personaOut).indexOf('\`\`\`')`), -1);
    // 带语言标记的围栏也要洗
    await script({ reply: '```markdown\n姓名: 夜乃\n```' });
    await gen();
    check('带语言标记的围栏也洗掉了', await out(), '姓名: 夜乃');
    // 但**没包围栏**的不能被动 —— 那会吃掉真正的第一行
    await script({ reply: '姓名: 夜乃\n年龄: 19\n性别: 女' });
    await gen();
    check('没包围栏的原样留着（清洗不许吃掉第一行）', await out(), OK_REPLY);
    check('首行没有被吃掉', await ev(`String(stEditor.personaOut).split('\\n')[0]`), '姓名: 夜乃');

    // ④ 空回复 → 报错，而且**不许把上一次的结果清掉**
    await script({ reply: '' });
    await gen();
    check('空回复 ⇒ 报「模型返回了空内容」', await msgText(), v => /空内容/.test(v), '含「空内容」');
    check('空回复时上一次的结果**没被清掉**（对照）', await out(), OK_REPLY);
    check('空回复时提示是 bad', await msgKind(), 'bad');
    check('空回复之后忙态归位', await busy(), false);

    // ⑤ 手改结果也要进状态（不是只改 DOM）
    await script({ reply: OK_REPLY });
    await gen();
    await typeIn('st-persona-out', '姓名: 手改的');
    check('手改结果进了状态', await out(), '姓名: 手改的');
    await ev(`stRerender()`);
    await sleep(150);
    check('重绘之后结果框里还是手改的那份',
      await ev(`document.getElementById('st-persona-out').value`), '姓名: 手改的');

    // ============ I. 写入与追加 ============
    section('I. 写入与追加');
    await ev(`stSet('card.description', '')`);
    await ev(`stSet('card.name', '夜乃')`);
    await script({ reply: OK_REPLY });
    await gen();
    await dlgClear();
    await ev(`document.getElementById('st-persona-write').click()`);
    await sleep(200);
    check('空描述 ⇒ 直接写进去', await desc(), OK_REPLY);
    check('空描述 ⇒ **不弹** confirm（没东西可覆盖）', (await dlg()).length, 0);
    check('提示说写入角色描述', await msgText(), v => /写入角色描述/.test(v), '含「写入角色描述」');
    check('提示是 ok', await msgKind(), '');

    // 追加：不弹窗，保留原文
    await dlgClear();
    await ev(`document.getElementById('st-persona-append').click()`);
    await sleep(200);
    check('追加 ⇒ 不弹 confirm', (await dlg()).length, 0);
    check('追加之后原文还在开头',
      await desc(), v => v.indexOf(OK_REPLY) === 0, '以原文开头');
    check('追加之后新内容接在后面（中间空一行）',
      await desc(), OK_REPLY + '\n\n' + OK_REPLY);
    check('追加的提示说「追加到角色描述」',
      await msgText(), v => /追加到角色描述/.test(v), '含「追加到角色描述」');

    // 写入覆盖非空描述：必须问
    await dlgClear();
    await confirmYes(false);          // 先答「不要」
    await ev(`document.getElementById('st-persona-write').click()`);
    await sleep(200);
    check('非空描述 ⇒ 弹了 confirm', (await dlg()).length, 1);
    check('confirm 的话里说了会整个替换', (await dlg())[0], v => /整个替换/.test(v), '含「整个替换」');
    check('答「不要」⇒ 角色描述**一点没动**', await desc(), OK_REPLY + '\n\n' + OK_REPLY);
    check('答「不要」⇒ 提示说已取消', await msgText(), v => /已取消/.test(v), '含「已取消」');

    await dlgClear();
    await confirmYes(true);           // 再答「要」
    await ev(`stSet('card.description', '别人手写的旧描述')`);
    await ev(`document.getElementById('st-persona-write').click()`);
    await sleep(200);
    check('非空描述 ⇒ 也弹了 confirm（对照组）', (await dlg()).length, 1);
    check('答「要」⇒ 整个替换成新内容', await desc(), OK_REPLY);
    await confirmYes(true);

    // 结果空着的时候点写入 / 追加：只给提示，不动卡
    await ev(`stSet('card.description', '不该被动')`);
    await ev(`stPersonaOutSet('')`);
    await dlgClear();
    await ev(`document.getElementById('st-persona-write').click()`);
    await sleep(150);
    check('没有结果时点写入 ⇒ 提示「还没有生成结果」', await msgText(), v => /还没有生成结果/.test(v), '含「还没有生成结果」');
    check('没有结果时点写入 ⇒ 卡没动', await desc(), '不该被动');
    check('没有结果时点写入 ⇒ 不弹 confirm', (await dlg()).length, 0);
    await ev(`stPersonaApply('append')`);
    check('没有结果时点追加 ⇒ 卡也没动', await desc(), '不该被动');

    // 描述是纯空白时追加应当走「写入」而不是留个空行开头
    await ev(`stPersonaOutSet('新内容')`);
    await ev(`stSet('card.description', '   ')`);
    await ev(`stPersonaApply('append')`);
    check('描述是纯空白时追加 ⇒ 不留空行开头', await desc(), '新内容');

    // ============ I2. 追加到世界书 + 姓名开关 ============
    section('I2. 生成结果追加到世界书 / 要不要拿卡名当人物姓名');

    // 「又生成了一份新的人设」= 记账清零。**真实路径在 stPersonaRun 里**（I3 的 ⑥ 去证它）；
    // 下面这些单测写入逻辑的地方先手动清一下 —— 不清的话第二次点会变成「弹窗问」
    // 而不是「直接追加」，那些断言会红得莫名其妙。
    const freshBook = () => ev(`(stEditor.personaBookRef = null, stEditor.personaBookAsk = null, true)`);
    const askEl = () => ev(`!!document.getElementById('st-persona-book-ask')`);
    const askTitle = () =>
      ev(`(document.getElementById('st-persona-book-ask-title') || {}).textContent || ''`);
    const bookAt = i => `(stEditor.card.bookEntries[${i}] || {})`;
    const bookIds = () =>
      ev(`JSON.stringify(stEditor.card.bookEntries.map(e => (e || {}).id))`);
    // ⚠ 弹窗里那三个按钮**不是一直都在**（没弹窗时它们压根不存在）。
    //   直接 `.click()` 会在反向测试里抛 `TypeError` ⇒ 套件**当场炸掉、连汇总行都没有**，
    //   那一针就白跑了（RULES.md 六之二十四）。所以一律走这个空安全版本。
    const clickIf = id => ev(`(function(){
      const el = document.getElementById(${JSON.stringify(id)});
      if (!el) return false;
      el.click();
      return true; })()`);

    // —— ① 把生成结果追加成一条世界书条目 ——
    // ⚠⚠ 这里**故意**让生成结果里的「姓名:」跟卡名**不一样**（艾莉丝 vs 夜乃）。
    //   两者相同时，「取的是 `姓名:`」和「取的是卡名」两条路**读出来是同一个字符串**，
    //   断言就分不出它到底从哪儿取的 —— 那是一个天然成立的对照组。
    const BOOK_REPLY = '姓名: 艾莉丝\n年龄: 19\n性别: 女';
    await ev(`stSet('card.name', '夜乃')`);
    await ev(`stPersonaOutSet(${JSON.stringify(BOOK_REPLY)})`);

    // 取值函数本身：半角 / 全角 / 行首装饰 / CRLF / 取不到
    check('能从「姓名:」后面取到名字',
      await ev(`stPersonaNameFromOut('年龄: 19\\n姓名: 艾莉丝\\n性别: 女')`), '艾莉丝');
    check('全角「姓名：」也认',
      await ev(`stPersonaNameFromOut('姓名：艾莉丝')`), '艾莉丝');
    check('行首有空格 / 破折号 / 星号也认',
      await ev(`stPersonaNameFromOut('- 姓名: 艾莉丝')`), '艾莉丝');
    // ⚠ JS 的 `.` **不匹配 `\r`**，多行模式下 `$` 也不认 `\r`
    //   ⇒ 不先把 CRLF 归一成 LF 的话，这一条会**整行匹配不上**，名字悄悄回落成卡名
    check('CRLF 文本也认（不归一化就会悄悄取不到）',
      await ev(`stPersonaNameFromOut('姓名: 艾莉丝\\r\\n年龄: 19')`), '艾莉丝');
    check('模型给整行加粗也剥得掉',
      await ev(`stPersonaNameFromOut('**姓名：艾莉丝**')`), '艾莉丝');
    check('没有「姓名:」这一行 ⇒ 空串',
      await ev(`String(stPersonaNameFromOut('年龄: 19\\n性别: 女'))`), '');
    check('「姓名:」后面是空的 ⇒ 也算取不到',
      await ev(`String(stPersonaNameFromOut('姓名:   \\n年龄: 19'))`), '');
    check('结果是空串 ⇒ 也给空串', await ev(`String(stPersonaNameFromOut(''))`), '');

    // 先塞一条**原有条目**：待会儿要拿它当对照组 —— 新增不能动到老的
    await ev(`(function(){
      stEditor.card.bookEntries = [];
      const e = stBlankEntry();
      e.comment = '原有条目'; e.content = '原有正文'; e.keys = ['原有'];
      stEditor.card.bookEntries.push(e);
      stSaveDraft();
      return true; })()`);
    await ev(`stRerender()`);
    await sleep(150);
    check('结果区有「追加到世界书」按钮',
      await ev(`!!document.getElementById('st-persona-to-book')`), true);
    check('按钮文案里有「追加到世界书」',
      await ev(`(document.getElementById('st-persona-to-book') || {}).textContent`),
      v => /追加到世界书/.test(v || ''), '含「追加到世界书」');
    // 反向对照：加了新按钮**不该**挤掉老的那三个
    check('（对照）原来那三个按钮都还在',
      await ev(`['st-persona-write','st-persona-append','st-persona-copy']
        .every(id => !!document.getElementById(id))`), true);

    const b0 = await ev(`stEditor.card.bookEntries.length`);
    // 走**真按钮** —— 要验的是「接对了没有」，不是「函数存在」
    await ev(`document.getElementById('st-persona-to-book').click()`);
    await sleep(200);
    check('点一下 ⇒ 世界书多了一条', await ev(`stEditor.card.bookEntries.length`), b0 + 1);
    // ⚠ 下面几条一律走「取不到就当空对象」的写法：条目真没建出来时，
    //   直接 `bookEntries[1].content` 会抛 TypeError，整跑当场炸掉、连汇总行都没有 ——
    //   那样反向测试拿不到「红了几条」，注入就白跑了
    const NE = `(stEditor.card.bookEntries[${b0}] || {})`;
    check('新条目的正文就是生成结果', await ev(`String(${NE}.content || '')`), BOOK_REPLY);
    check('新条目是启用的', await ev(`${NE}.enabled`), true);
    // ⚠ 期望值「艾莉丝」**不是**卡名（卡名是「夜乃」）—— 这一条就是来证「取的是 `姓名:`」的
    check('新条目的备注取的是「姓名:」后面的字符',
      await ev(`String(${NE}.comment || '')`), '艾莉丝');
    check('新条目的关键词也是「姓名:」后面的字符',
      await ev(`JSON.stringify(${NE}.keys || [])`), JSON.stringify(['艾莉丝']));
    // ⚠ 文案本轮改过（用户要求「按下后有反馈，比如『已将（名字）追加为新的世界书条目』」）
    //   ⇒ **改需求先改断言**，不是把产品改回去
    check('提示说「追加为新的世界书条目」',
      await msgText(), v => /追加为新的世界书条目/.test(v), '含「追加为新的世界书条目」');
    check('提示里报的名字是「艾莉丝」（不是卡名）',
      await msgText(), v => /艾莉丝/.test(v), '含「艾莉丝」');
    check('提示是 ok', await msgKind(), '');
    // ⚠ 对照组：只证「多了一条」不够 —— 还得证「原来那条一点没动」
    check('（对照）原有条目还在原位',
      await ev(`stEditor.card.bookEntries[0].comment`), '原有条目');
    check('（对照）原有条目的正文没被动',
      await ev(`stEditor.card.bookEntries[0].content`), '原有正文');
    check('（对照）原有条目的关键词没被动',
      await ev(`JSON.stringify(stEditor.card.bookEntries[0].keys)`), JSON.stringify(['原有']));

    // 真去世界书页看一眼：它得**渲染出来**，不能只活在状态里
    await ev(`document.getElementById('st-tab-book').click()`);
    await sleep(250);
    check('世界书页真的多渲染了一条',
      await ev(`document.querySelectorAll('#st-panes .st-entry').length`), b0 + 1);
    await ev(`document.getElementById('st-tab-persona').click()`);
    await sleep(250);

    // 反向对照：结果空着的时候**不该**动世界书
    await ev(`stPersonaOutSet('')`);
    const b1 = await ev(`stEditor.card.bookEntries.length`);
    await ev(`stPersonaApply('book')`);
    await sleep(150);
    check('没有结果时点「追加到世界书」⇒ 条目数不变',
      await ev(`stEditor.card.bookEntries.length`), b1);
    check('没有结果时点「追加到世界书」⇒ 提示「还没有生成结果」',
      await msgText(), v => /还没有生成结果/.test(v), '含「还没有生成结果」');

    // 生成结果里没有「姓名:」⇒ **回落卡名**，而且提示要说清用的是卡名（不静默）
    await ev(`stSet('card.name', '夜乃')`);
    await ev(`stPersonaOutSet('一段没有姓名的结果')`);
    // ⚠ 这里要的是「直接追加」那条路 —— 账上还记着上一次那条的话，点下去会**弹窗**
    await freshBook();
    await ev(`stPersonaApply('book')`);
    await sleep(150);
    const b2 = await ev(`stEditor.card.bookEntries.length`);
    check('生成结果里没有「姓名:」⇒ 照样多了一条', b2, b1 + 1);
    check('生成结果里没有「姓名:」⇒ 回落卡名',
      await ev(`JSON.stringify((stEditor.card.bookEntries[${b2 - 1}] || {}).keys || [])`),
      JSON.stringify(['夜乃']));
    check('回落时提示说清了「用的是卡名」', await msgText(), v => /卡名/.test(v), '含「卡名」');

    // 两边都没有 ⇒ 关键词留空，而且要**明说**让用户去补（不静默）
    await ev(`stSet('card.name', '')`);
    await ev(`stPersonaOutSet('一段没有姓名的结果')`);
    await freshBook();
    await ev(`stPersonaApply('book')`);
    await sleep(150);
    const b3 = await ev(`stEditor.card.bookEntries.length`);
    check('两边都没有 ⇒ 照样多了一条', b3, b2 + 1);
    check('两边都没有 ⇒ 关键词是空的',
      await ev(`JSON.stringify((stEditor.card.bookEntries[${b3 - 1}] || {}).keys || [])`), '[]');
    check('两边都没有 ⇒ 备注回落成「人设」（留空的话列表里根本找不到它）',
      await ev(`String((stEditor.card.bookEntries[${b3 - 1}] || {}).comment || '')`), '人设');
    check('两边都没有 ⇒ 提示提醒去填关键词（不静默）',
      await msgText(), v => /关键词/.test(v), '含「关键词」');
    check('两边都没有 ⇒ 提示是 warn', await msgKind(), 'warn');
    await ev(`stSet('card.name', '夜乃')`);

    // —— ② 要不要拿角色卡名字当人物姓名 ——
    await ev(`stRerender()`);
    await sleep(150);
    check('面板上有「用卡名当人物姓名」的勾选框',
      await ev(`!!document.getElementById('st-persona-name-use')`), true);
    check('默认是勾上的',
      await ev(`document.getElementById('st-persona-name-use').checked`), true);
    check('默认勾上 ⇒ 提示词里带卡名',
      await ev(`stPersonaUserPrompt('要一个女仆', '姓名:')`),
      v => /夜乃/.test(v || ''), '含「夜乃」');
    check('默认勾上 ⇒ 提示词里有「这张卡现在的名字」',
      await ev(`stPersonaUserPrompt('x', '姓名:')`),
      v => /这张卡现在的名字/.test(v || ''), true);

    // 走**真勾选框**
    await ev(`document.getElementById('st-persona-name-use').click()`);
    await sleep(150);
    check('取消勾选 ⇒ 状态跟着关掉', await ev(`stEditor.personaNameUse`), false);
    check('取消勾选 ⇒ 提示词里不再有卡名',
      await ev(`stPersonaUserPrompt('x', '姓名:')`),
      v => !/夜乃/.test(v || ''), '不含「夜乃」');
    check('取消勾选 ⇒ 也不再说「这张卡现在的名字」',
      await ev(`stPersonaUserPrompt('x', '姓名:')`),
      v => !/这张卡现在的名字/.test(v || ''), true);
    // 对照组：关掉的是**名字**，不是整段提示词
    check('（对照）关掉之后用户的要求和模板照样在',
      await ev(`stPersonaUserPrompt('要一个女仆', '姓名:')`),
      v => /要一个女仆/.test(v || '') && /姓名:/.test(v || ''), true);

    // 重绘之后勾选状态要还原 —— 跟 personaTplOpen 同一条规矩：从状态渲染
    await ev(`stRerender()`);
    await sleep(150);
    check('重绘之后勾选框仍然是关的',
      await ev(`document.getElementById('st-persona-name-use').checked`), false);

    // **真实生成路径**：真的发给模型的那条 user 消息里也不该有卡名。
    // 直接调 stPersonaUserPrompt 只证明「那个函数写得对」，证明不了「请求真的走了它」
    await clearCalls();
    await script({ reply: '姓名: 某人' });
    await typeIn('st-persona-req', REQ);
    await gen();
    const call2 = await lastCall();
    const usr2 = String((((call2 || {}).body || {}).messages || [])[1]
      ? call2.body.messages[1].content : '');
    check('关掉之后真实请求里也没有卡名', usr2, v => v.indexOf('夜乃') < 0, '不含「夜乃」');
    check('（对照）真实请求里仍然有用户的要求原文',
      usr2, v => v.indexOf(REQ) >= 0, '含要求原文');

    await ev(`stPersonaNameUseSet(true)`);
    await ev(`stRerender()`);
    await sleep(150);
    check('勾回去 ⇒ 勾选框又是勾上的',
      await ev(`document.getElementById('st-persona-name-use').checked`), true);
    check('勾回去 ⇒ 提示词里又有卡名了（对照组）',
      await ev(`stPersonaUserPrompt('x', '姓名:')`),
      v => /这张卡现在的名字/.test(v || ''), true);

    // ============ I3. 「已经添加过了」的三选一弹窗 ============
    section('I3. 「已经添加过了」：取消 / 覆盖 / 追加为新条目');

    await ev(`stSet('card.name', '夜乃')`);
    await ev(`(function(){
      stEditor.card.bookEntries = [];
      const e = stBlankEntry();
      e.comment = '原有条目'; e.content = '原有正文'; e.keys = ['原有'];
      stEditor.card.bookEntries.push(e);
      stSaveDraft(); return true; })()`);
    await ev(`stPersonaOutSet(${JSON.stringify(BOOK_REPLY)})`);
    await freshBook();
    await ev(`stRerender()`);
    await sleep(150);

    // —— ① 第一次点：还没追加过 ⇒ 直接追加，**不弹窗** ——
    check('（前置）现在没有弹窗', await askEl(), false);
    await ev(`document.getElementById('st-persona-to-book').click()`);
    await sleep(200);
    check('第一次点 ⇒ 不弹窗（还没追加过）', await askEl(), false);
    check('第一次点 ⇒ 世界书多了一条', await ev(`stEditor.card.bookEntries.length`), 2);
    const firstId = await ev(`String(${bookAt(1)}.id || '')`);

    // —— ② 第二次点：弹三选一，而且**什么都不许写** ——
    await ev(`document.getElementById('st-persona-to-book').click()`);
    await sleep(200);
    check('第二次点 ⇒ 弹出三选一', await askEl(), true);
    check('弹窗标题里有名字「艾莉丝」', await askTitle(), v => /艾莉丝/.test(v || ''), '含「艾莉丝」');
    check('弹窗标题说的是「已经添加过了」',
      await askTitle(), v => /已经添加过了/.test(v || ''), '含「已经添加过了」');
    check('弹窗有三个选项按钮',
      await ev(`['st-persona-book-cancel','st-persona-book-overwrite','st-persona-book-new']
        .every(id => !!document.getElementById(id))`), true);
    check('三个按钮的文案是「取消 / 覆盖 / 追加为新条目」',
      await ev(`['st-persona-book-cancel','st-persona-book-overwrite','st-persona-book-new']
        .map(id => String((document.getElementById(id) || {}).textContent || '')).join('|')`),
      v => v === '取消|覆盖|追加为新条目', '取消|覆盖|追加为新条目');
    // ⚠ 光「问」不许写：条数、备注一样都不许动
    check('（弹窗期间）条数没变', await ev(`stEditor.card.bookEntries.length`), 2);
    check('（弹窗期间）没有多出条目、备注也没被改写',
      await ev(`JSON.stringify(stEditor.card.bookEntries.map(e => String((e || {}).comment || '')))`),
      JSON.stringify(['原有条目', '艾莉丝']));
    // ⚠ 量 rect 量不出「被别的层盖住」⇒ 用**命中测试**：屏幕正中必须点到弹窗自己。
    //   这条同时盯着「position:fixed 的包含块还对不对」（#st-overlay 带 backdrop-filter）
    check('弹窗真的盖在屏幕正中（命中测试）',
      await ev(`(function(){
        const el = document.getElementById('st-persona-book-ask');
        if (!el) return 'NO-MODAL';
        const hit = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
        if (!hit) return 'NOTHING';
        return el.contains(hit) ? 'OK' : ('OTHER:' + hit.tagName + '.' + hit.className);
      })()`), 'OK');

    // —— ③ 取消：什么都不做 ——
    await clickIf('st-persona-book-cancel');
    await sleep(200);
    check('点「取消」⇒ 弹窗关掉', await askEl(), false);
    check('点「取消」⇒ 条数不变', await ev(`stEditor.card.bookEntries.length`), 2);
    check('点「取消」⇒ 提示说「已取消」', await msgText(), v => /已取消/.test(v), '含「已取消」');
    check('点「取消」⇒ 原来那条正文没动',
      await ev(`String(${bookAt(1)}.content || '')`), BOOK_REPLY);
    // 「取消」不该改任何状态 ⇒ 再点还是要问
    await ev(`document.getElementById('st-persona-to-book').click()`);
    await sleep(200);
    check('取消之后再点 ⇒ 照样弹窗（取消不改记账）', await askEl(), true);

    // —— ④ 追加为新条目 ——
    await clickIf('st-persona-book-new');
    await sleep(250);
    check('点「追加为新条目」⇒ 弹窗关掉', await askEl(), false);
    check('点「追加为新条目」⇒ 条数 +1', await ev(`stEditor.card.bookEntries.length`), 3);
    check('新条目是**另一条**（id 跟原来那条不同）',
      await ev(`String(${bookAt(2)}.id || '')`), v => !!v && v !== firstId, '非空且 != 上一条的 id');
    check('新条目的备注还是「艾莉丝」', await ev(`String(${bookAt(2)}.comment || '')`), '艾莉丝');
    check('提示说「追加为新的世界书条目」',
      await msgText(), v => /追加为新的世界书条目/.test(v), '含「追加为新的世界书条目」');

    // —— ⑤ 覆盖：条数不变、原位不动、只换内容 ——
    // ⚠ 换一份**不一样**的结果：否则「覆盖成功」和「什么都没做」读出来是一样的
    const BOOK_REPLY2 = '姓名: 艾莉丝\n年龄: 25\n性别: 女';
    await ev(`stPersonaOutSet(${JSON.stringify(BOOK_REPLY2)})`);
    // 把当前那条的开关改掉 —— 覆盖**不该**把它们抹掉
    await ev(`(function(){
      const a = stEditor.card.bookEntries;
      const e = a[a.length - 1];
      e.enabled = false; e.useRegex = true; e.comment = '用户改过的备注';
      stSaveDraft(); return true; })()`);
    const beforeIds = await bookIds();
    await ev(`document.getElementById('st-persona-to-book').click()`);
    await sleep(200);
    check('（覆盖前）又弹窗了', await askEl(), true);
    await clickIf('st-persona-book-overwrite');
    await sleep(250);
    check('点「覆盖」⇒ 弹窗关掉', await askEl(), false);
    check('点「覆盖」⇒ 条数**不变**（不是新建）', await ev(`stEditor.card.bookEntries.length`), 3);
    check('点「覆盖」⇒ 所有条目的 id 都没变（原位覆盖）', await bookIds(), beforeIds);
    check('点「覆盖」⇒ 那条的正文换成了新结果',
      await ev(`String(${bookAt(2)}.content || '')`), BOOK_REPLY2);
    check('点「覆盖」⇒ 备注被新结果里的名字改写',
      await ev(`String(${bookAt(2)}.comment || '')`), '艾莉丝');
    // ⚠ 对照组：覆盖只该动 content / comment / keys，用户在世界书页调过的**不许被抹掉**
    check('（对照）覆盖没有把启用开关改回去', await ev(`${bookAt(2)}.enabled`), false);
    check('（对照）覆盖没有把正则开关改回去', await ev(`${bookAt(2)}.useRegex`), true);
    check('（对照）原有那条一点没动',
      await ev(`String(${bookAt(0)}.comment || '')`), '原有条目');
    check('提示说「覆盖」', await msgText(), v => /覆盖/.test(v), '含「覆盖」');

    // —— ⑥ 又生成了一份新的人设 ⇒ 记账清零，第一次点直接追加 ——
    await script({ reply: BOOK_REPLY, delay: 0 });
    await typeIn('st-persona-req', REQ);
    await gen();
    check('重新生成之后 ⇒ 记账清零', await ev(`String(stEditor.personaBookRef || '')`), '');
    check('重新生成之后 ⇒ 没有弹窗', await askEl(), false);
    const n4 = await ev(`stEditor.card.bookEntries.length`);
    await ev(`document.getElementById('st-persona-to-book').click()`);
    await sleep(200);
    check('清零之后**第一次**点 ⇒ 不弹窗、直接追加', await askEl(), false);
    check('清零之后**第一次**点 ⇒ 条数 +1', await ev(`stEditor.card.bookEntries.length`), n4 + 1);
    await ev(`document.getElementById('st-persona-to-book').click()`);
    await sleep(200);
    check('清零之后**第二次**点 ⇒ 又弹窗了', await askEl(), true);
    await clickIf('st-persona-book-cancel');
    await sleep(200);

    // —— ⑦ 记账里那条被用户删了 ⇒ 当新条目，而且要**说出来** ——
    await freshBook();
    await ev(`stPersonaOutSet(${JSON.stringify(BOOK_REPLY)})`);
    await ev(`document.getElementById('st-persona-to-book').click()`);
    await sleep(200);
    const n5 = await ev(`stEditor.card.bookEntries.length`);
    await ev(`(function(){ stEditor.card.bookEntries.pop(); stSaveDraft(); return true; })()`);
    await ev(`document.getElementById('st-persona-to-book').click()`);
    await sleep(200);
    check('记账里那条已经不在 ⇒ 不弹窗（没什么可覆盖的）', await askEl(), false);
    check('记账里那条已经不在 ⇒ 照样写了一条新的',
      await ev(`stEditor.card.bookEntries.length`), n5);
    check('记账里那条已经不在 ⇒ 提示说清了这件事',
      await msgText(), v => /已经不在了/.test(v), '含「已经不在了」');

    // —— ⑧ 四个按钮的反馈都带名字 ——
    // ⚠ 需求是「四个按钮按下后都要有反馈」。名字统一取「姓名:」后面的字符，
    //   所以四条提示里都该出现「艾莉丝」；卡名是「夜乃」，出现卡名就说明取错了源。
    await ev(`stSet('card.name', '夜乃')`);
    await ev(`stPersonaOutSet(${JSON.stringify(BOOK_REPLY)})`);
    await ev(`stSet('card.description', '原来的描述')`);
    await ev(`document.getElementById('st-persona-write').click()`);
    await sleep(150);
    check('「写入角色描述」的反馈里有名字',
      await msgText(), v => /已将「艾莉丝」写入角色描述/.test(v), '含「已将「艾莉丝」写入角色描述」');
    await ev(`document.getElementById('st-persona-append').click()`);
    await sleep(150);
    check('「追加到角色描述」的反馈里有名字',
      await msgText(), v => /已将「艾莉丝」追加到角色描述/.test(v), '含「已将「艾莉丝」追加到角色描述」');
    await ev(`document.getElementById('st-persona-copy').click()`);
    await sleep(250);
    check('「复制」的反馈里有名字',
      await msgText(), v => /已复制「艾莉丝」的人设/.test(v), '含「已复制「艾莉丝」的人设」');
    // 名字取不到时**整段省掉**，不许印一对空引号
    await ev(`stSet('card.name', '')`);
    await ev(`stSet('card.description', '')`);
    await ev(`stPersonaOutSet('一段没有姓名的结果')`);
    await freshBook();
    await ev(`document.getElementById('st-persona-write').click()`);
    await sleep(150);
    check('名字取不到 ⇒ 反馈里不出现空的「」',
      await msgText(), v => /已写入角色描述/.test(v) && !/「」/.test(v),
      '含「已写入角色描述」且不含「「」」');

    // 收尾：把状态还原，别影响后面的 J
    await ev(`stSet('card.name', '夜乃')`);
    await ev(`stPersonaNameUseSet(true)`);
    await freshBook();
    await ev(`stRerender()`);
    await sleep(150);

    // ============ J. 复制 + 忙态 + 失败路径 ============
    section('J. 复制 / 忙态 / 失败路径');
    await ev(`stPersonaOutSet('要复制的这一段')`);
    await ev(`stRerender()`);
    await sleep(150);
    await ev(`(window.__copied = null, true)`);
    await ev(`document.getElementById('st-persona-copy').click()`);
    await sleep(250);
    check('复制按钮把结果送进了剪贴板', await ev(`window.__copied`), '要复制的这一段');
    check('复制之后提示说已复制', await msgText(), v => /已复制/.test(v), '含「已复制」');

    // 忙态：给个慢回复，点真按钮，中途检查
    await script({ reply: OK_REPLY, delay: 1500 });
    await clearCalls();
    await ev(`document.getElementById('st-persona-run').click()`);
    await sleep(300);
    check('忙态为 true', await busy(), true);
    check('按钮变成「⏳ 生成中…」',
      await ev(`document.getElementById('st-persona-run').textContent.trim()`), '⏳ 生成中…');
    check('按钮被禁用', await ev(`document.getElementById('st-persona-run').disabled`), true);
    // 忙的时候重绘一次 —— 「忙态只活在 DOM 里」的话这里就穿帮了
    await ev(`stRerender()`);
    await sleep(150);
    check('重绘之后按钮还是「⏳ 生成中…」（忙态扛得过重绘）',
      await ev(`document.getElementById('st-persona-run').textContent.trim()`), '⏳ 生成中…');
    check('重绘之后还是禁用',
      await ev(`document.getElementById('st-persona-run').disabled`), true);
    // ⚠ 这一条原来读的是**常驻条** `#st-status` —— 用户要求把生成器的工作状态挪到
    //   「✨ 生成人设」按钮**上方**，所以**断言的方向跟着改**（读页内格 `#st-persona-msg`）。
    //   「断言的方向本身就是需求」：改需求就先改断言、看它红，再改产品。
    check('重绘之后页内状态格还写着正在生成',
      await ev(`document.getElementById('st-persona-msg').textContent`), v => /正在让 AI 生成人设/.test(v), '含「正在让 AI 生成人设」');
    // 再点一次不许重复发请求
    await ev(`stPersonaRun()`);
    check('忙的时候再点一次 ⇒ 不重复发请求', await callN(), 1);
    await waitFor(`stEditor.personaBusy === false`, 10000);
    check('生成完忙态归位', await busy(), false);
    check('生成完按钮文案回到「✨ 生成人设」',
      await ev(`document.getElementById('st-persona-run').textContent.trim()`), '✨ 生成人设');
    check('生成完按钮不再禁用',
      await ev(`document.getElementById('st-persona-run').disabled`), false);
    check('结果进了状态', await out(), OK_REPLY);

    // 网络不通
    await script({ reply: '', fail: 'network', delay: 0 });
    await ev(`stPersonaOutSet('')`);
    await gen();
    check('网络不通 ⇒ 报「生成失败」', await msgText(), v => /AI 生成失败/.test(v), '含「AI 生成失败」');
    check('网络不通 ⇒ 提示里给了可能原因', await msgText(), v => /Failed to fetch/.test(v), '含「Failed to fetch」');
    check('网络不通 ⇒ 提示是 bad', await msgKind(), 'bad');
    check('网络不通 ⇒ 忙态归位', await busy(), false);
    check('网络不通 ⇒ 结果没被写进去', await out(), '');

    // 401
    await script({ fail: 'http401' });
    await gen();
    check('401 ⇒ 报「生成失败」', await msgText(), v => /AI 生成失败/.test(v), '含「AI 生成失败」');
    check('401 ⇒ 提示里带上了服务端的话',
      await msgText(), v => /401|invalid api key|api key/i.test(v), '含 401 或 api key');
    check('401 ⇒ 忙态归位', await busy(), false);

    // 模型回一堆寒暄（不是人设）—— 照样收下，但不许崩
    await script({ reply: '好的，这是人设。', fail: '' });
    await gen();
    check('模型回寒暄也不崩，原样收下（不做「智能」清洗）', await out(), '好的，这是人设。');
    check('提示照样是 warn（模板一项都没对上）', await msgKind(), 'warn');
    check('而且说出了几项没出现', await msgText(), v => /没出现/.test(v), '含「没出现」');

    // ============ K. 收尾 ============
    section('K. 收尾零报错');
    await ev(`stSwitchTab('desc')`);
    await sleep(200);
    await ev(`stSwitchTab('persona')`);
    await sleep(200);
    check('来回切页之后面板还在', await ev(`!!document.getElementById('st-persona-req')`), true);
    check('来回切页之后需求还在状态里', await ev(`stEditor.personaReq`), REQ);
    check('收尾无 console 错误', consoleErrors.filter(x => !/favicon/i.test(x)),
      v => v.length === 0, []);
    if (consoleErrors.length) console.log('    ' + consoleErrors.slice(0, 5).join('\n    '));

  } catch (e) {
    fail++;
    console.log('\n💥 套件自己炸了：' + (e && e.stack ? e.stack : e));
  } finally {
    try { if (srv) srv.close(); } catch (e) {}
    try { if (cdp && cdp.ws) cdp.ws.close(); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
    await sleep(400);
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); } catch (e) {}
  }

  console.log(`\n== 汇总 ==`);
  console.log(`${pass} 通过 / ${fail} 失败`);
  if (fails.length) console.log('失败项：\n  - ' + fails.join('\n  - '));
  process.exit(fail ? 1 : 0);
})();
