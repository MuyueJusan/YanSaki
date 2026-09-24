// 第二十一轮：**角色卡编写器的「首页」选项卡** —— 概览 / 新建 / 导入 / 从别处搬条目
//
// 要证的六件事：
//   ① 选项卡真的加上了，而且**排在最前**、**默认就落在它上面**；
//      真按钮（`#st-tab-home`）点得动 —— 不是「数组里有这个 id」就算数
//   ② 概览里的数字**跟着真实数据走**：改卡名 → 正文字段数变；加条目 → 世界书条数变。
//      ⚠ 每条都要有**改动前后两个值**，否则「数字永远为真」也能全绿
//   ③ 「从别处搬条目」能把**别的角色卡**（V2，character_book 在 data 里）和
//      **独立世界书 JSON**（entries 是对象）都解析出来 —— 两种形状都要走通
//   ④ 导入是**追加**不是替换：原有条目一条不少、内容不变；新条目 id 不重复；
//      而且**不能和来源共享对象**（否则之后改条目会两边一起变）
//   ⑤ 勾选真的管用：全不选 → 一条都不进；只勾一条 → 只进一条
//   ⑥ ⚠⚠ **模式不残留**：用户点「提取条目」之后在文件框里点**取消**，
//      `change` 事件根本不触发 ⇒ 模式必须由下一次 `stImportPick()` 覆盖掉，
//      否则下次正常「导入角色卡」会被当成提取条目
//
// 九段：
//   A. 装载与零报错
//   B. 选项卡：总数 / 在不在 / **位置** / 真按钮 / 默认落点
//   C. 面板元素齐全（含反向对照：还没选文件时条目清单**不该在**）
//   D. 概览数字跟真实数据一致（改动前后对照）
//   E. 提取：两种来源形状都能解析（+ 没有 entries 时报错且不留半个状态）
//   F. 导入：追加而不是替换 / id 唯一 / 不与来源共享对象 / 导入后清场
//   G. 勾选：全不选 / 只勾一条 / 全选
//   H. 模式隔离：dataset.mode 每次被覆盖（模拟「点了提取又取消」）
//   I. 收尾零报错
//
// 跑法：node home-verify.js

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

const CANDIDATES = [8991, 8992, 8993, 8994];
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

// —— 两份来源样本，**在套件里独立写**（不引用产品常量）——
// ① 别的角色卡：V2，世界书装在 data.character_book 里（最容易漏的一种形状）
const CARD_JSON = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    name: '来源卡',
    description: '来源描述',
    first_mes: '来源开场',
    character_book: {
      name: '来源卡的世界书',
      entries: [
        { comment: '甲', keys: ['a1', 'a2'], content: '内容甲' },
        { comment: '乙', keys: ['b1'], content: '内容乙' },
        { comment: '丙', keys: [], content: '内容丙', constant: true }
      ]
    }
  }
};
// ② 独立世界书文件：entries 是**对象**（键是序号），不是数组
const BOOK_JSON = {
  name: '独立世界书',
  entries: {
    '0': { comment: '壹', key: ['w1'], content: '世界书壹' },
    '1': { comment: '贰', key: ['w2'], content: '世界书贰' }
  }
};
// ③ 一份「看着像 JSON 但没有 entries」的（对照组）
const BAD_JSON = { name: '空壳', nothing: true };

(async () => {
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-home-'));
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
  const tab = () => ev(`stEditor.tab`);
  const kvText = () => ev(`(function(){
    const el = document.querySelector('#st-panes .st-kv');
    return el ? el.textContent.replace(/\\s+/g, ' ') : ''; })()`);
  const paneText = () => ev(`(function(){
    const el = document.querySelector('#st-panes .st-pane');
    return el ? el.textContent.replace(/\\s+/g, ' ') : ''; })()`);
  const extractSrc = () => ev(`(function(){
    const s = stEditor.extractSrc;
    return s ? { srcName: s.srcName, kind: s.kind, bookName: s.bookName, n: s.entries.length } : null; })()`);
  const bookN = () => ev(`stEditor.card.bookEntries.length`);
  const selN = () => ev(`(function(){ return Object.keys(stEditor.extractSel).length; })()`);
  const checkboxes = () => ev(`document.querySelectorAll('#st-panes input[type=checkbox][id^="st-ex-"]').length`);
  // 走**真实路径**：造一个 File，走 stOnImportPicked（它按 dataset.mode 分流）
  const feedFile = (obj, fileName, mode) => ev(`(async function(){
    const f = new File([${JSON.stringify(JSON.stringify(obj))}], ${JSON.stringify(fileName)},
      { type: 'application/json' });
    const el = document.getElementById('st-import-file');
    el.dataset.mode = ${JSON.stringify(mode)};
    await stOnImportPicked({ target: { files: [f], value: '', dataset: { mode: ${JSON.stringify(mode)} } } });
    return true; })()`, true, 30000);
  const openHome = async () => {
    await ev(`openStEditor()`);
    await ev(`stSwitchTab('home')`);
    await sleep(200);
  };

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
        window.confirm = function (m) { window.__dlg.push(String(m)); return window.__confirmYes !== false; };`
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
    const loaded = new Promise(res => cdp.on('Page.loadEventFired', res));
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/` }, SID);
    await loaded;
    await ev('localStorage.clear()');
    const l2 = new Promise(res => cdp.on('Page.loadEventFired', res));
    await cdp.send('Page.reload', {}, SID);
    await l2;
    await ev(`document.fonts.ready.then(() => true)`, true);
    await sleep(400);
    log('页面加载完成');

    // ============ A. 装载与零报错 ============
    section('A. 装载与零报错');
    check('页面无 console 错误', consoleErrors.filter(x => !/favicon/i.test(x)),
      v => v.length === 0, []);

    // ============ B. 选项卡 ============
    section('B. 选项卡：总数 / 位置 / 真按钮 / 默认落点');
    const tabs = await ev(`ST_TABS.map(t => ({ id: t.id, ico: t.ico, label: t.label }))`);
    check('选项卡总数 16', tabs.length, 16);
    const hi = tabs.findIndex(t => t.id === 'home');
    check('首页在清单里', hi >= 0, true);
    check('首页**排在最前**', hi, 0);
    check('首页有图标和文字标签',
      !!(tabs[0] && tabs[0].ico && tabs[0].label), true);
    // 反向对照：不能只是「加了个 id 进去」——位置必须真的在 name 前面
    const ni = tabs.findIndex(t => t.id === 'name');
    check('「名字」被挤到第二位（对照）', ni, 1);

    await ev(`openStEditor()`);
    check('编辑器已打开',
      await ev(`document.getElementById('st-overlay').classList.contains('active')`), true);
    // ⚠ 默认落点：新建/首次打开就该在首页
    await ev(`stNewCard(false)`);
    check('新建之后默认落在首页', await tab(), 'home');
    check('首页那个真按钮是 active 的',
      await ev(`(function(){ const b = document.getElementById('st-tab-home');
        return !!(b && b.classList.contains('active')); })()`), true);

    // 真按钮：切走再切回来
    await ev(`(function(){ document.getElementById('st-tab-name').click(); return true; })()`);
    await sleep(120);
    check('点「名字」真按钮能切走', await tab(), 'name');
    await ev(`(function(){ document.getElementById('st-tab-home').click(); return true; })()`);
    await sleep(120);
    check('点「首页」真按钮能切回来', await tab(), 'home');
    await openHome();

    // ============ C. 面板元素 ============
    section('C. 面板元素齐全');
    check('概览的键值表在', await ev(`!!document.querySelector('#st-panes .st-kv')`), true);
    check('三个快捷动作按钮都在', await ev(`(function(){
      const t = document.querySelector('#st-panes .st-pane').textContent;
      return t.indexOf('新建角色卡') >= 0 && t.indexOf('导入角色卡') >= 0
        && t.indexOf('读取酒馆当前卡') >= 0; })()`), true);
    check('「选择来源文件」按钮在', await ev(`(function(){
      return document.querySelector('#st-panes .st-pane').textContent.indexOf('选择来源文件') >= 0; })()`), true);
    // 反向对照：还没选文件时，勾选清单**不该**出现
    check('还没选文件时没有条目勾选框（对照）', await checkboxes(), 0);
    await shot('home-01-overview.png');

    // ============ D. 概览数字跟真实数据一致 ============
    section('D. 概览数字跟着真实数据走');
    await ev(`stNewCard(false)`);
    await openHome();
    const kv0 = await kvText();
    check('空卡：正文字段 0 / 8', /正文字段\s*0\s*\/\s*8/.test(kv0), true, kv0);
    check('空卡：世界书 0 条', /世界书\s*0\s*条/.test(kv0), true, kv0);
    check('空卡：名字显示「还没起名字」', kv0.indexOf('还没起名字') >= 0, true, kv0);

    // 改卡名（走真实输入路径：改 DOM value + input 事件）
    await ev(`stSwitchTab('name')`);
    await sleep(120);
    await ev(`(function(){
      const el = document.getElementById('st-name');
      el.value = '夜乃';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true; })()`);
    await ev(`stSwitchTab('home')`);
    await sleep(150);
    const kv1 = await kvText();
    check('改名之后概览里的名字跟着变', kv1.indexOf('夜乃') >= 0, true, kv1);
    check('改名之后正文字段 1 / 8', /正文字段\s*1\s*\/\s*8/.test(kv1), true, kv1);
    // ⚠ 这一条是「数字真的会动」的对照 —— 少了它，上面两条在「数字永远为真」时也绿
    check('正文字段数**真的变了**（对照）', /正文字段\s*0\s*\/\s*8/.test(kv1), false);

    // 加两条世界书条目 → 概览要跟着变
    await ev(`(function(){
      stEditor.card.bookEntries.push(stBlankEntry());
      stEditor.card.bookEntries.push(stBlankEntry());
      stRerender(); return true; })()`);
    const kv2 = await kvText();
    check('加两条条目之后世界书 2 条', /世界书\s*2\s*条/.test(kv2), true, kv2);
    check('世界书条数**真的变了**（对照）', /世界书\s*0\s*条/.test(kv2), false);

    // ============ E. 提取：两种来源形状 ============
    section('E. 提取：角色卡 / 世界书两种形状');
    // ① 别的角色卡（character_book 在 data 里）
    await feedFile(CARD_JSON, 'source-card.json', 'extract');
    const s1 = await extractSrc();
    check('角色卡来源：解析出 3 条', s1 && s1.n, 3, s1);
    check('角色卡来源：认出来了是「角色卡」', s1 && s1.kind, '角色卡', s1);
    check('角色卡来源：世界书名取到了', s1 && s1.bookName, '来源卡的世界书', s1);
    check('角色卡来源：默认**全选**', await selN(), 3);
    check('角色卡来源：面板上出现 3 个勾选框', await checkboxes(), 3);
    await shot('home-02-extract.png');

    // ② 独立世界书文件（entries 是对象）
    await feedFile(BOOK_JSON, 'lore.json', 'extract');
    const s2 = await extractSrc();
    check('世界书来源：解析出 2 条', s2 && s2.n, 2, s2);
    check('世界书来源：认出来了是「世界书」', s2 && s2.kind, '世界书', s2);
    check('世界书来源：世界书名取到了', s2 && s2.bookName, '独立世界书', s2);

    // ③ 对照组：没有 entries 的 JSON
    await feedFile(BAD_JSON, 'bad.json', 'extract');
    check('没有 entries 的来源：extractSrc 归空', await extractSrc(), null);
    check('没有 entries 的来源：给了能看懂的话', await ev(`stEditor.extractMsg.text`),
      v => /读不出来|entries/.test(String(v)), '含「读不出来」');
    check('没有 entries 的来源：面板上没有勾选框', await checkboxes(), 0);

    // ============ F. 导入：追加而不是替换 ============
    section('F. 导入：追加 / id 唯一 / 不共享对象');
    // 先给当前卡留一条「原有条目」，用来验「没被动过」
    await ev(`(function(){
      const e = stBlankEntry();
      e.comment = '原有条目';
      e.content = '原有内容';
      stEditor.card.bookEntries = [e];
      stRerender(); return true; })()`);
    check('起手：当前卡 1 条', await bookN(), 1);
    const beforeId = await ev(`stEditor.card.bookEntries[0].id`);

    await feedFile(CARD_JSON, 'source-card.json', 'extract');
    await ev(`stExtractImport()`);
    check('导入 3 条之后：1 + 3 = 4 条（**追加**，不是替换）', await bookN(), 4);
    check('原有条目还在第一位', await ev(`stEditor.card.bookEntries[0].comment`), '原有条目');
    check('原有条目的 id 没被换掉', await ev(`stEditor.card.bookEntries[0].id`), beforeId);
    check('原有条目的内容没被动', await ev(`stEditor.card.bookEntries[0].content`), '原有内容');
    // ⚠ 一律 `(x || {})` 地读 —— 读数组元素/嵌套字段时**抛异常会让整套当场炸掉、
    //   连汇总行都没有**，反向测试那一针就拿不到「红了几条」（见 RULES 六之三十九）。
    //   实测：R6 注入「不解包 data」之后来源解析失败，这里 `bookEntries[1]` 就是 undefined。
    check('新来的第一条内容对得上', await ev(`(stEditor.card.bookEntries[1] || {}).content`), '内容甲');
    check('id 全不重复', await ev(`(function(){
      const ids = stEditor.card.bookEntries.map(e => e.id);
      return new Set(ids).size === ids.length; })()`), true);
    // ⚠⚠ 不共享对象这条**必须先抓住来源那个对象的引用，再导入**。
    //   反例（踩过）：导入之后 stExtractImport 末尾会把 stEditor.extractSrc 清成 null，
    //   于是「重新 feed 一次文件再读 extractSrc.entries[0]」拿到的是**刚 parse 出来的新对象**
    //   —— 比的是两个不同对象，断言**永远为真**，把 clone 删掉也照样绿。
    //   反向测试 R5（注入 added = picked）就是靠这一点发现的：它当时仍然全绿。
    //   所以这里先把 bookEntries 清空，走一遍干净流程，把引用存在 window 上。
    await ev(`(function(){ stEditor.card.bookEntries = []; stRerender(); return true; })()`);
    await feedFile(CARD_JSON, 'source-card.json', 'extract');
    // ⚠ `((x || {}).entries || [])[0]` —— 来源解析失败时这里是 undefined，直接点 `.entries`
    //   会抛异常把整套带走（RULES 六之三十九）
    await ev(`window.__srcRef = ((stEditor.extractSrc || {}).entries || [])[0]; true`);
    await ev(`stExtractImport()`);
    await ev(`(function(){
      var e = stEditor.card.bookEntries[0]; if (e) e.content = '被改了'; return true; })()`);
    check('卡里改条目**不会**污染来源（不共享对象）',
      await ev(`(window.__srcRef || {}).content`), '内容甲');
    // 导入之后要清场，免得同一个来源被反复导入
    await feedFile(CARD_JSON, 'source-card.json', 'extract');
    await ev(`stExtractImport()`);
    check('导入后 extractSrc 清空', await extractSrc(), null);
    check('导入后给了成功提示', await ev(`stEditor.extractMsg.text`),
      v => /导入\s*3\s*条/.test(String(v)), '含「导入 3 条」');

    // ============ G. 勾选 ============
    section('G. 勾选真的管用');
    await ev(`(function(){ stEditor.card.bookEntries = []; stRerender(); return true; })()`);
    await feedFile(BOOK_JSON, 'lore.json', 'extract');
    await ev(`stExtractSetAll(false)`);
    check('全不选之后勾选数 0', await selN(), 0);
    check('全不选之后「导入」按钮是 disabled 的', await ev(`(function(){
      const bs = Array.prototype.slice.call(
        document.querySelectorAll('#st-panes button'));
      const b = bs.filter(x => x.textContent.indexOf('导入选中的') >= 0)[0];
      return !!(b && b.disabled); })()`), true);
    await ev(`stExtractImport()`);
    check('一条没勾时点导入：世界书仍是 0 条', await bookN(), 0);
    check('一条没勾时点导入：提示是「没东西可导入」', await ev(`stEditor.extractMsg.text`),
      v => /没东西可导入|一条都没勾/.test(String(v)), '含「没东西可导入」');

    await ev(`stExtractToggle(1, true)`);
    check('只勾第 2 条：勾选数 1', await selN(), 1);
    await ev(`stExtractImport()`);
    check('只勾第 2 条：只进了 1 条', await bookN(), 1);
    check('只勾第 2 条：进的是那一条', await ev(`(stEditor.card.bookEntries[0] || {}).content`), '世界书贰');

    // ============ H. 模式隔离 ============
    section('H. 模式不残留（dataset.mode）');
    check('正常点「导入」→ mode=card', await ev(`(function(){
      stImportPick();
      return document.getElementById('st-import-file').dataset.mode; })()`), 'card');
    check('点「提取条目」→ mode=extract', await ev(`(function(){
      stExtractPick();
      return document.getElementById('st-import-file').dataset.mode; })()`), 'extract');
    // ⚠⚠ 核心那一条：模拟「点了提取条目、然后在文件框里点取消」——
    //   `change` 根本不触发，所以 dataset 会留在 extract。
    //   此时用户正常点「导入」，**必须**被覆盖回 card，否则会走错分支
    await ev(`(function(){
      document.getElementById('st-import-file').dataset.mode = 'extract';
      return true; })()`);
    check('取消留下的 extract 还在（前提成立）', await ev(`(function(){
      return document.getElementById('st-import-file').dataset.mode; })()`), 'extract');
    await ev(`stImportPick()`);
    check('之后再点「导入」→ 被覆盖回 card', await ev(`(function(){
      return document.getElementById('st-import-file').dataset.mode; })()`), 'card');
    // 端到端：mode=card 时喂一张卡，**必须换整张卡**，而不是弹条目清单
    await ev(`(function(){ stEditor.card.bookEntries = []; stRerender(); return true; })()`);
    await feedFile(CARD_JSON, 'source-card.json', 'card');
    check('mode=card 喂卡 → 走的是「换整张卡」', await ev(`stEditor.card.name`), '来源卡');
    check('mode=card 喂卡 → 世界书跟着整张卡一起进来', await bookN(), 3);
    check('mode=card 喂卡 → 没有留下提取状态', await extractSrc(), null);

    // ============ I. 收尾 ============
    section('I. 收尾');
    await ev(`stSwitchTab('home')`);
    await sleep(150);
    check('切回首页面板还在', await ev(`!!document.querySelector('#st-panes .st-kv')`), true);
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
    // ⚠⚠ **不要在本进程里删 profile**：这台机器「删一个文件」要 ~200 ms，一个 Chrome profile
    //   有几百个文件 ⇒ `fs.rmSync(…, {maxRetries: 8})` **永不返回** ⇒ finally 不返回 ⇒
    //   **连下面的汇总行都打不出来**（第二十一轮实测：断言全绿、页面 5.9 s 就加载完，
    //   进程 240 s 不退、`EXIT=null`；`_reverse18.js` 的基线因此卡了 10 分钟）。
    //   ⇒ 派一个**脱离的子进程**去删（照外部视觉层 `verify_tavern_visual.js` 的最终修法，
    //   见 RULES.md 六之五十五）。删不完也无所谓，_purge-tmp.js 会收（白名单里有 cdp-）。
    if (profile) {
      try {
        spawn(process.execPath, ['-e',
          'require("fs").rmSync(process.argv[1],{recursive:true,force:true,maxRetries:0})',
          profile], { detached: true, stdio: 'ignore' }).unref();
      } catch (e) {}
    }
  }

  console.log(`\n== 汇总 ==`);
  console.log(`${pass} 通过 / ${fail} 失败`);
  if (fails.length) console.log('失败项：\n  - ' + fails.join('\n  - '));
  process.exit(fail ? 1 : 0);
})();
