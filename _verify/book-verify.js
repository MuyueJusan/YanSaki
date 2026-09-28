// 第二十二轮：**世界书条目的关键词标签控件**（keys / secondary_keys）
//
// 用户那句话就是规格：
//   「关键词（触发词）与次关键词的词条采用类似社交软件中的【标签】，
//     要求每个词被圆角矩形包裹，输入时以回车为一个词，可以对某个关键词直接删除」
// 拆成四件事，每件都配一个**反向对照** —— 少了对照，「永远为真」也能全绿：
//   ① 每个词被圆角矩形包裹 —— 量 computed `border-radius`（不是「有没有 .st-tag 这个类」）
//   ② 回车落一个词 —— 走真实 keydown；对照：**别的键不许落**
//   ③ 点 × 能直接删 —— 删的必须是**指定的那一个**；对照：别的标签还在（防「一删全清」）
//   ④ 旧行为不能丢 —— 逗号仍按 [\n,，] 切；重复词不加（对照：换个新词就得加）
//      ⚠ 换行**不能**靠「设 value 再回车」测：`<input type="text">` 的 value 会被浏览器
//        按 HTML 规范抹掉 `\r` / `\n`（单行输入的 value sanitization）。
//        ⇒ 旧版那句「一行一个」的提示**从来没成立过**（它也是个单行输入框）；
//          多行只能从**粘贴**进来，所以这一轮顺手补了 paste 处理
//
// 另外三条「不专门写就一定会踩」的：
//   ⑤ 落词之后输入框**必须还是同一个节点** —— 整块重画会把光标顶掉，
//      而关键词正是在这个框里一个字一个字敲出来的
//   ⑥ keys 与 secondaryKeys 是**两个**列表 —— 拿一个「不同值」的对照证明没串
//      （⚠ 两边填同一个词的话，两条取值路径会读出同一个值，删掉实现照样绿）
//   ⑦ 中文输入法组字中的回车是「选字」不是「落词」 —— 不挡掉会把半个词落成标签
//
// 十一节：
//   A. 装载与零报错            G. 输入法组字中的回车不落词
//   B. 控件就位与形状          H. 退格删最后一个
//   C. 回车落一个词            I. retro-mode 走方角
//   D. 点 × 删指定的那一个      J. 草稿往返（走 stLoadDraft 真实路径）
//   E. 分隔规则（含多行粘贴）   K. 收尾零报错
//   F. keys / secondaryKeys 不串
//
// 跑法：node book-verify.js

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
// ⚠ 数组不能用 `===` 比（RULES 六之七）—— 直接在这一层堵掉
function same(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; }
}
function check(name, actual, pred, expect) {
  const ok = typeof pred === 'function' ? pred(actual) : same(actual, pred);
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

// —— 探针词。刻意选**互不相同**的串：两边填同一个词的话，
//    「keys 没被改到」这类断言会在「两条路径其实指向同一个数组」时照样绿 ——
//    而那个 bug（控件接错 path）正是要抓的东西（RULES 六之二十六）
const W_A = '青岚';
const W_B = '银霜';
const W_C = '白露';
const W_D = '子规';

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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-book-'));
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
  // ⚠ 轮询要等**实质条件**（宽度 > 0），不是「有值」——
  //   `getBoundingClientRect()` 在刚解析完还没布局时给 0，而 `getComputedStyle` 已经有值了。
  //   签名就是 `{w:0, cs:"…"}`（RULES 六之五十七）
  const waitFor = async (expr, ms = 3000) => {
    const t = Date.now();
    let v = null;
    while (Date.now() - t < ms) {
      v = await ev(expr).catch(() => null);
      if (v) return v;
      await sleep(60);
    }
    return v;
  };

  // —— 页面内的小工具 ——
  const K = 'st-e0-keys', KS = 'st-e0-keys-tags';        // 关键词：输入框 / 装标签的框
  const S = 'st-e0-sec', SS = 'st-e0-sec-tags';          // 次关键词
  const keysArr = () => ev(`stEditor.card.bookEntries[0].keys`);
  const secArr = () => ev(`stEditor.card.bookEntries[0].secondaryKeys`);
  const chips = id => ev(`[...document.querySelectorAll('#${id} .st-tag > span')].map(n => n.textContent)`);
  const val = id => ev(`document.getElementById('${id}').value`);
  const ph = id => ev(`document.getElementById('${id}').placeholder`);
  // 走**真实路径**：改 value + 派发真 keydown（内联 onkeydown 是真的监听器）
  const typeKey = (id, key, extra) => ev(`(function(){
    const el = document.getElementById('${id}');
    el.dispatchEvent(new KeyboardEvent('keydown', Object.assign(
      { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }, ${JSON.stringify(extra || {})})));
    return true; })()`);
  const typeWord = async (id, word) => { await ev(`(function(){
      document.getElementById('${id}').value = ${JSON.stringify(word)}; return true; })()`);
    await typeKey(id, 'Enter'); await sleep(80); };
  // 真 paste 事件 + 真 DataTransfer。返回 `defaultPrevented` ——
  // 它就是「标签逻辑有没有接管这一下」的判据。
  // ⚠ 合成事件**不会替浏览器把字插进输入框**，所以「粘单个词之后 value 里有没有它」
  //   根本量不出来；能量的只有「有没有 preventDefault」这一件事
  const paste = async (id, text) => {
    const p = await ev(`(function(){
      const el = document.getElementById('${id}');
      const dt = new DataTransfer();
      dt.setData('text/plain', ${JSON.stringify(text)});
      const e = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      el.dispatchEvent(e);
      return { prevented: e.defaultPrevented, hadClip: !!e.clipboardData }; })()`);
    await sleep(80);
    return p;
  };
  // 点 × —— 真按钮、真 click
  const clickX = async (boxId, i) => { const ok = await ev(`(function(){
      const b = document.querySelectorAll('#${boxId} .st-tag-x')[${i}];
      if (!b) return false;
      b.click();
      return true; })()`); await sleep(80); return ok; };

  // 夹具：一个条目 + 指定的两组词。⚠ 直接写模型是**夹具**（不是在测 stAddEntry），
  //   真按钮那条路径在 B 节末尾单独走一遍
  const resetBook = async (keys, sec) => {
    await ev(`(function(){
      const e = stBlankEntry();
      e.comment = '探针条目';
      e.keys = ${JSON.stringify(keys)};
      e.secondaryKeys = ${JSON.stringify(sec)};
      stEditor.card.bookEntries = [e];
      stSwitchTab('book');
      return true; })()`);
    await sleep(250);
    // 条目默认是收起的 —— 走真点击展开，别直接改 open（那就不算走真实路径了）
    const opened = await ev(`(function(){
      const d = document.getElementById('st-entry-0');
      if (!d) return 'no-entry';
      if (!d.open) d.querySelector('summary').click();
      return d.open; })()`);
    await sleep(200);
    return opened;
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
    await ev(`openStEditor()`);

    // ============ B. 控件就位与形状 ============
    section('B. 控件就位与形状（圆角矩形）');
    check('条目展开成功（前提成立）', await resetBook([W_A], []), true);

    check('关键词的标签框在', await ev(`!!document.getElementById('${KS}')`), true);
    check('次关键词的标签框在', await ev(`!!document.getElementById('${SS}')`), true);
    // 旧 id 保留 —— 万一别处（或以后）按 id 找它，别静默失效
    check('输入框仍然叫 st-e0-keys（旧 id 没被换掉）',
      await ev(`!!document.getElementById('${K}')`), true);
    check('label 的 for 指到真输入框（点标签能聚焦）',
      await ev(`(function(){ const l = document.querySelector('label[for="${K}"]');
        return !!(l && document.getElementById(l.getAttribute('for'))); })()`), true);

    // 圆角矩形：量 **computed**，不是「有没有这个类」
    const w0 = await waitFor(`(function(){
      const t = document.querySelector('#${KS} .st-tag');
      if (!t) return 0;
      return Math.round(t.getBoundingClientRect().width); })()`);
    check('标签真的量出了宽度（不是刚解析还没布局的 0）', w0 > 0, true, '>0');

    const sh = await ev(`(function(){
      const t = document.querySelector('#${KS} .st-tag');
      if (!t) return null;
      const cs = getComputedStyle(t), r = t.getBoundingClientRect();
      const x = t.querySelector('button.st-tag-x');
      return {
        radius: cs.borderTopLeftRadius, bw: cs.borderTopWidth, bg: cs.backgroundColor,
        w: Math.round(r.width), h: Math.round(r.height),
        word: (t.querySelector('span') || {}).textContent,
        xN: t.querySelectorAll('button.st-tag-x').length,
        xType: x ? x.type : '',
        disp: cs.display, wrap: getComputedStyle(document.getElementById('${KS}')).flexWrap
      }; })()`);
    check('一个词 = 一个圆角矩形（border-radius 是圆角，不是 0）',
      sh && sh.radius, v => /^\d+(\.\d+)?px$/.test(String(v)) && parseFloat(v) >= 8, '>= 8px');
    check('这个矩形有边框（不是只有个透明盒子）', sh && sh.bw, v => parseFloat(v) > 0, '> 0px');
    check('这个矩形有底色', sh && sh.bg, v => String(v) !== 'rgba(0, 0, 0, 0)', '不透明');
    check('这个矩形看得见（宽高都 > 0）', sh && [sh.w > 0, sh.h > 0], [true, true]);
    check('标签里就是那个词', sh && sh.word, W_A);
    check('每个标签里正好一个 × 按钮', sh && sh.xN, 1);
    check('× 是 type=button（不会把外面当表单提交）', sh && sh.xType, 'button');
    check('标签框是 flex + wrap（词多了会换行）', sh && [sh.disp, sh.wrap], ['flex', 'wrap']);

    // ⚠ 输入框必须**没有**边框和底色 —— 它得融进标签框里。
    //   这条盯的是选择器特异性：`.st-field input`（0,1,1）会盖掉光秃秃的 `.st-tags-in`（0,1,0）
    const ish = await ev(`(function(){
      const i = document.getElementById('${K}');
      const cs = getComputedStyle(i);
      return { bw: cs.borderTopWidth, bg: cs.backgroundColor, radius: cs.borderTopLeftRadius }; })()`);
    check('输入框没有自己的边框（融进标签框）', ish.bw, '0px');
    check('输入框没有自己的底色（融进标签框）', ish.bg, 'rgba(0, 0, 0, 0)');
    check('输入框没有自己的圆角（融进标签框）', ish.radius, '0px');

    // ⚠ 提示语只在**空态**挂 —— 有标签时挂着会挤在最后一个标签旁边
    check('有标签时不挂提示语', await ph(K), '');
    check('铺一个空条目（前提成立）', await resetBook([], []), true);
    check('没有标签时挂出提示语（空态）', await ph(K), v => /回车/.test(String(v)), '含「回车」');
    check('空态下一个标签都没有', await chips(KS), []);
    check('空态下标签框仍有高度（不是塌成 0）',
      await ev(`Math.round(document.getElementById('${KS}').getBoundingClientRect().height)`),
      v => v > 0, '>0');
    check('回到 1 个词的夹具（前提成立）', await resetBook([W_A], []), true);
    await shot('book-01-tags.png');

    // 真按钮那条路径：点「✚ 添加条目」长出来的条目也得带标签控件
    const beforeN = await ev(`stEditor.card.bookEntries.length`);
    await ev(`(function(){
      const b = [...document.querySelectorAll('#st-panes .st-actions button')]
        .filter(x => x.textContent.indexOf('添加条目') >= 0)[0];
      if (!b) return false;
      b.click();
      return true; })()`);
    await sleep(250);
    check('点「✚ 添加条目」真的多了一条', await ev(`stEditor.card.bookEntries.length`), beforeN + 1);
    check('新条目的关键词也是标签控件（不是老输入框）',
      await ev(`!!document.getElementById('st-e${beforeN}-keys-tags')`), true);
    check('新条目的次关键词也是标签控件',
      await ev(`!!document.getElementById('st-e${beforeN}-sec-tags')`), true);
    // 收拾干净，回到单条目夹具
    check('重新铺夹具（前提成立）', await resetBook([W_A], []), true);

    // ============ C. 回车落一个词 ============
    section('C. 回车落一个词');
    check('起手 1 个标签', await chips(KS), [W_A]);
    await ev(`window.__inp = document.getElementById('${K}'); true`);
    check('参照节点就是那个输入框（前提成立）',
      await ev(`window.__inp === document.getElementById('${K}')`), true);

    await typeWord(K, W_B);
    check('回车之后模型里多了这个词', await keysArr(), [W_A, W_B]);
    check('回车之后框里画出了两个标签', await chips(KS), [W_A, W_B]);
    check('回车之后输入框清空了（不用手动删残留）', await val(K), '');
    check('有标签之后提示语收起来了', await ph(K), '');
    // ⚠⚠ 这条是「不整块重画」的证据：重画会把输入框换成新节点，光标就飞了
    check('落词之后输入框还是**同一个节点**（光标不会飞）',
      await ev(`window.__inp === document.getElementById('${K}')`), true);
    // 对照：别的键不许落词
    await ev(`document.getElementById('${K}').value = ${JSON.stringify(W_D)}; true`);
    await typeKey(K, 'a'); await sleep(80);
    check('敲普通字母**不会**落词（对照）', await keysArr(), [W_A, W_B]);
    check('敲普通字母时输入框里的字还在（没被清掉）', await val(K), W_D);
    await ev(`document.getElementById('${K}').value = ''; true`);
    check('摘要跟着更新了（世界书那一行）',
      await ev(`(function(){ const s = document.querySelector('#st-entry-0 .st-entry-sum');
        return s ? s.textContent : ''; })()`), v => String(v).indexOf(W_B) >= 0, '含 ' + W_B);

    // ============ D. 点 × 删指定的那一个 ============
    section('D. 点 × 删掉指定的那一个');
    check('重新铺 3 个词（前提成立）', await resetBook([W_A, W_B, W_D], []), true);
    check('起手 3 个标签', await chips(KS), [W_A, W_B, W_D]);
    check('点到了第 2 个 × （前提成立）', await clickX(KS, 1), true);
    check('删掉的是**中间那一个**', await keysArr(), [W_A, W_D]);
    check('画面上也只剩另外两个', await chips(KS), [W_A, W_D]);
    // ⚠ 对照：不能「一删全清」，也不能删错人
    check('第一个还在（对照）', await ev(`stEditor.card.bookEntries[0].keys.indexOf(${JSON.stringify(W_A)})`), 0);
    check('被删的那个真的没了（对照）',
      await ev(`stEditor.card.bookEntries[0].keys.indexOf(${JSON.stringify(W_B)})`), -1);
    // 删到空
    await clickX(KS, 0); await clickX(KS, 0);
    check('删光之后是空数组', await keysArr(), []);
    check('删光之后一个标签都没有', await chips(KS), []);
    check('删光之后提示语又回来了', await ph(K), v => /回车/.test(String(v)), '含「回车」');

    // ============ E. 分隔规则 ============
    section('E. 分隔规则：逗号照切 / 多行粘贴照切 / 重复不加');
    check('重新铺空夹具（前提成立）', await resetBook([], []), true);
    // 旧版就是按 [\n,，] 切的 —— 逗号那条路必须原样还在
    await typeWord(K, 'a,b，c');
    check('一串里混着半角 / 全角逗号 → 切成 3 个词', await keysArr(), ['a', 'b', 'c']);
    // ⚠⚠ 换行**没法**靠「设 value 再回车」测：`<input type="text">` 的 value 会被浏览器
    //   按 HTML 规范抹掉 `\r` / `\n`（单行输入的 value sanitization），
    //   所以 `'d\ne'` 到了解析器手上已经是 `'de'` 这个连体词。
    //   换行只能从**粘贴**进来 —— 而粘贴正是这次补的那条路（不补就会静默粘成连体词）。
    //   旧版那句「一行一个」的提示其实从来没成立过：它也是个单行输入框。
    const p1 = await paste(K, 'd\ne\nf');
    check('多行粘贴被标签逻辑接管（prevented，且真的拿到了剪贴板）',
      p1, v => !!(v && v.hadClip && v.prevented), 'prevented=true');
    check('粘贴一行一个的多行清单 → 按换行切成 3 个词',
      await keysArr(), ['a', 'b', 'c', 'd', 'e', 'f']);
    check('粘贴之后输入框是干净的（不用手动删残留）', await val(K), '');
    // 对照：粘一个普通单词**不该**接管，留给浏览器原生插入
    const p2 = await paste(K, 'g');
    check('单个普通词粘贴不接管（prevented=false，留给原生）',
      p2, v => !!(v && v.prevented === false), 'prevented=false');
    check('不接管时列表没被动（对照）', await keysArr(), ['a', 'b', 'c', 'd', 'e', 'f']);
    // 解析器本身仍然认 \n（哪怕单行输入框送不进来）
    check('stSplitList 本身仍然认 \\n / 半角逗号 / 全角逗号',
      await ev(`stSplitList('x\\ny,z，w')`), ['x', 'y', 'z', 'w']);
    // 重复的不加（对照：换个新词就得加）
    await typeWord(K, 'a');
    check('重复的词不再加进去', await keysArr(), ['a', 'b', 'c', 'd', 'e', 'f']);
    await typeWord(K, 'z');
    check('换个新词就加进去了（对照，证明上一条不是「永远为真」）',
      await keysArr(), ['a', 'b', 'c', 'd', 'e', 'f', 'z']);
    // 空回车不该凭空加一个空词
    await typeKey(K, 'Enter'); await sleep(80);
    check('空着按回车不会加空词', await keysArr(), ['a', 'b', 'c', 'd', 'e', 'f', 'z']);

    // ============ F. keys / secondaryKeys 不串 ============
    section('F. keys 与 secondaryKeys 是两个列表');
    check('重新铺夹具（前提成立）', await resetBook([W_A], [W_C]), true);
    check('两个框的 data-path **不一样**（接错 path 这里就红）',
      await ev(`(function(){
        const a = document.getElementById('${KS}').dataset.path;
        const b = document.getElementById('${SS}').dataset.path;
        return [a, b, a !== b]; })()`),
      ['card.bookEntries[0].keysText', 'card.bookEntries[0].secondaryKeysText', true]);
    check('起手各画各的', [await chips(KS), await chips(SS)], [[W_A], [W_C]]);
    await typeWord(K, W_B);
    check('往 keys 落词：keys 变了', await keysArr(), [W_A, W_B]);
    // ⚠ 这两条是对照。两边用**不同的词**，所以「其实指向同一个数组」也骗不过去
    check('往 keys 落词：secondaryKeys **没被动**（对照）', await secArr(), [W_C]);
    check('往 keys 落词：次关键词那边只画了一个标签（对照）', await chips(SS), [W_C]);
    await typeWord(S, W_D);
    check('往次关键词落词：secondaryKeys 变了', await secArr(), [W_C, W_D]);
    check('往次关键词落词：keys **没被动**（对照）', await keysArr(), [W_A, W_B]);
    await clickX(KS, 0);
    check('删 keys 的标签：secondaryKeys 纹丝不动（对照）', await secArr(), [W_C, W_D]);

    // ============ G. 输入法组字中的回车不落词 ============
    section('G. 输入法组字中的回车是「选字」不是「落词」');
    check('重新铺夹具（前提成立）', await resetBook([W_A], []), true);
    await ev(`document.getElementById('${K}').value = '半'; true`);
    await typeKey(K, 'Enter', { isComposing: true }); await sleep(80);
    check('组字中的回车**不落词**（对照：这条红了说明中文打一半就被切走了）',
      await keysArr(), [W_A]);
    check('组字中的回车也没把输入框清掉', await val(K), '半');
    await typeKey(K, 'Enter'); await sleep(80);
    check('退出组字之后再按回车就落了（证明上一条不是「永远不落」）',
      await keysArr(), [W_A, '半']);

    // ============ H. 退格删最后一个 ============
    section('H. 输入框空着按退格 = 删掉最后一个');
    check('重新铺 2 个词（前提成立）', await resetBook([W_A, W_B], []), true);
    await typeKey(K, 'Backspace'); await sleep(80);
    check('输入框空着按退格：删掉最后一个', await keysArr(), [W_A]);
    // 对照：输入框里有字的时候退格是删字，不许删标签
    await ev(`document.getElementById('${K}').value = 'x'; true`);
    await typeKey(K, 'Backspace'); await sleep(80);
    check('输入框里有字时按退格**不删标签**（对照）', await keysArr(), [W_A]);
    await ev(`document.getElementById('${K}').value = ''; true`);
    await typeKey(K, 'Backspace'); await sleep(80);
    check('清空之后再按退格：删到空', await keysArr(), []);
    await typeKey(K, 'Backspace'); await sleep(80);
    check('空列表上再按退格不炸（数组不会变成 -1 长度）', await keysArr(), []);

    // ============ I. retro-mode 走方角 ============
    section('I. retro-mode 下标签是方角');
    check('重新铺夹具（前提成立）', await resetBook([W_A, W_B], []), true);
    const rad = () => ev(`(function(){
      const t = document.querySelector('#${KS} .st-tag');
      return t ? getComputedStyle(t).borderTopLeftRadius : null; })()`);
    check('现代模式：圆角（前提成立）', await rad(), v => parseFloat(v) >= 8, '>= 8px');
    await ev(`document.body.classList.add('retro-mode'); true`);
    await sleep(150);
    check('retro-mode：方角（0）', await rad(), '0px');
    const ish2 = await ev(`(function(){
      const i = document.getElementById('${K}');
      const cs = getComputedStyle(i);
      return { bg: cs.backgroundColor, bw: cs.borderTopWidth }; })()`);
    check('retro-mode 下输入框仍然是透明的（没被 95 那条白底盖回去）',
      [ish2.bg, ish2.bw], ['rgba(0, 0, 0, 0)', '0px']);
    await shot('book-02-retro.png');
    await ev(`document.body.classList.remove('retro-mode'); true`);
    await sleep(150);
    check('摘掉 retro-mode：圆角回来了（对照）', await rad(), v => parseFloat(v) >= 8, '>= 8px');

    // ============ J. 草稿往返 ============
    section('J. 草稿往返（走 stLoadDraft 真实路径）');
    check('重新铺夹具（前提成立）', await resetBook([], []), true);
    await typeWord(K, W_A);
    await typeWord(S, W_C);
    await ev(`stSaveDraft()`);
    await sleep(150);
    check('序列化出来的草稿里真的有这两个词（不只是内存里对）',
      await ev(`(function(){
        const raw = localStorage.getItem(ST_DRAFT_KEY) || '';
        return [raw.indexOf(${JSON.stringify(W_A)}) >= 0,
                raw.indexOf(${JSON.stringify(W_C)}) >= 0]; })()`), [true, true]);
    // 抹掉内存，走真实加载路径读回来
    await ev(`(function(){
      stEditor.card.bookEntries = [];
      stRerender();
      stLoadDraft();
      stSwitchTab('book');
      return true; })()`);
    await sleep(250);
    check('读回来之后 keys 还在', await ev(`((stEditor.card.bookEntries[0] || {}).keys)`), [W_A]);
    check('读回来之后 secondaryKeys 还在',
      await ev(`((stEditor.card.bookEntries[0] || {}).secondaryKeys)`), [W_C]);
    // ⚠ 展开再读 —— 收起状态下 rect 是 0，量出来的「看不见」不算数
    await ev(`(function(){
      const d = document.getElementById('st-entry-0');
      if (d && !d.open) d.querySelector('summary').click();
      return true; })()`);
    await sleep(200);
    check('读回来之后画面上也是两个框各一个标签',
      [await chips(KS), await chips(SS)], [[W_A], [W_C]]);
    await shot('book-03-draft.png');

    // ============ L. 世界书多选管理 ============
    section('L. 世界书多选管理');

    // 页面内小工具（都走真实路径：真 .click()、真内联 handler）
    const boxes = () => ev(`[...document.querySelectorAll('#st-panes .st-sel-box')].map(b => b.checked)`);
    const clickBox = async (i) => { const ok = await ev(`(function(){
        const b = document.querySelectorAll('#st-panes .st-sel-box')[${i}];
        if (!b) return false; b.click(); return true; })()`); await sleep(90); return ok; };
    const selInfo = () => ev(`(function(){ const el = document.getElementById('st-sel-info');
        return el ? el.textContent : null; })()`);
    const allBox = () => ev(`(function(){ const el = document.getElementById('st-sel-all');
        return el ? { checked: el.checked, ind: el.indeterminate } : null; })()`);
    // ⚠ 不写死「6 个」—— 那是个会随界面增删而漂的数字。改成**从 DOM 推导**：
    //   「该禁用的那批」靠 `.st-need-sel` 自己标出来，另外单独断言
    //   「第二行每个按钮都标了」—— 漏标一个的话它会永远不禁用，而计数看不出来
    const batch = () => ev(`(function(){
        const bar = document.getElementById('st-book-batch');
        if (!bar) return null;
        const all = [...bar.querySelectorAll('.st-mini')];
        const need = all.filter(b => b.classList.contains('st-need-sel'));
        const rows = bar.querySelectorAll('.st-batch-row');
        const row2 = rows[1] ? [...rows[1].querySelectorAll('.st-mini')] : [];
        return { total: all.length, need: need.length, row2: row2.length,
                 needAllOff: need.every(b => b.disabled),
                 needAllOn: need.every(b => !b.disabled),
                 labels: all.map(b => b.textContent.trim()) }; })()`);
    const clickBatch = async (label) => { const ok = await ev(`(function(){
        const b = [...document.querySelectorAll('#st-book-batch .st-mini')]
            .find(x => x.textContent.indexOf(${JSON.stringify(label)}) >= 0);
        if (!b) return false; b.click(); return true; })()`); await sleep(180); return ok; };
    const entryOpen = (i) => ev(`(function(){ const d = document.getElementById('st-entry-${i}');
        return d ? d.open : null; })()`);
    const field = (f) => ev(`stEditor.card.bookEntries.map(e => e.${f})`);
    const names = () => ev(`stEditor.card.bookEntries.map(e => e.comment)`);
    // 夹具：n 条备注各不相同的条目。⚠ 备注取不同值 —— 一样的话
    //   「删对了没有」根本分不出来（六之二十六）
    const multiBook = async (n) => {
      await ev(`(function(){
        const NAMES = ['阿尔法', '贝塔', '伽马', '德尔塔'];
        const out = [];
        for (let i = 0; i < ${n}; i++) {
          const e = stBlankEntry();
          e.comment = NAMES[i];
          e.keys = ['k' + i];
          out.push(e);
        }
        stEditor.card.bookEntries = out;
        stEditor.bookSel = [];
        stSwitchTab('book');
        return true; })()`);
      await sleep(260);
    };

    // —— L1. 控件就位 ——
    await multiBook(3);
    check('三个条目各有一个多选勾选框', await boxes(), v => v.length === 3, 3);
    check('批量操作栏在，且排在第一个条目**前面**',
      await ev(`(function(){
        const bar = document.getElementById('st-book-batch');
        const first = document.getElementById('st-entry-0');
        if (!bar || !first) return null;
        return (bar.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0; })()`),
      true);
    check('一条都没选时：该禁用的动作按钮全禁用', await batch(),
      v => !!v && v.need > 0 && v.needAllOff, 'need>0 且全 disabled');
    // ⚠ 这条防的是「新加一个批量按钮忘了标 st-need-sel」——
    //   漏标的话它永远不会被禁用，而上面那条照样绿
    check('第二行每个按钮都标了 st-need-sel（没人漏标）', await batch(),
      v => !!v && v.row2 > 0 && v.row2 === v.need, 'row2 === need');
    // ⚠ 对照组：全选 / 反选**不该**被禁用 —— 它们本来就不需要先有选中项。
    //   少了这条，把「所有按钮一律 disabled」也能骗绿
    check('对照组：全选 / 反选不受「有没有选中」影响',
      await ev(`(function(){
        const all = document.getElementById('st-sel-all');
        const inv = [...document.querySelectorAll('#st-book-batch .st-mini')]
          .find(b => b.textContent.indexOf('反选') >= 0);
        return { all: !!all && !all.disabled, inv: !!inv && !inv.disabled }; })()`),
      v => !!v && v.all && v.inv, '两个都可用');
    check('计数那一行是「已选 0 / 3 条」', await selInfo(), v => v === '已选 0 / 3 条');

    // —— L2. 点勾选框只选中，**不把条目摊开** ——
    await ev(`window.__box0 = document.querySelectorAll('#st-panes .st-sel-box')[0]`);
    const openBefore = await entryOpen(0);
    await clickBox(0);
    check('点一下勾选框 ⇒ 它自己变成选中', (await boxes())[0], true);
    // ⚠⚠ 这条是这一节最要紧的一条：勾选框待在 <summary> 里，而 <summary> 的默认动作
    //    是开合 <details>。少了 stopPropagation，勾一条就会把那条摊开
    check('⚠ 点勾选框**没有**把条目摊开（stopPropagation 挡住了冒泡）',
      await entryOpen(0), v => v === openBefore, openBefore);
    check('计数跟着变成「已选 1 / 3 条」', await selInfo(), v => v === '已选 1 / 3 条');
    check('选中之后动作按钮全解禁', await batch(),
      v => !!v && v.need > 0 && v.needAllOn, 'need>0 且全可用');
    // ⚠ 定向重画：勾选框的节点身份必须没变。整页重画的话这个引用会失效 ——
    //   而条目卡片里有输入框，整页重画会把正在编辑的节点换掉（光标飞）
    check('⚠ 是定向重画：勾选框节点身份没变',
      await ev(`window.__box0 === document.querySelectorAll('#st-panes .st-sel-box')[0]`), true);
    // 对照组：点 summary 本身**确实**会开合 —— 证明上面那条不是因为「点了什么都不动」
    await ev(`document.getElementById('st-entry-0').querySelector('summary').click()`);
    await sleep(160);
    check('对照组：点 summary 本身会把条目开合', await entryOpen(0), v => v !== openBefore);
    await ev(`document.getElementById('st-entry-0').querySelector('summary').click()`);
    await sleep(160);

    // —— L3. 全选 / 反选 / 半选态 ——
    await clickBox(1);
    check('选两条时「全选」是半选态（indeterminate）', await allBox(),
      v => !!v && v.ind === true && v.checked === false);
    await ev(`document.getElementById('st-sel-all').click()`);
    await sleep(160);
    check('点「全选」⇒ 三条全选上', await boxes(), [true, true, true]);
    check('全选之后「全选」勾上、且不再是半选态', await allBox(),
      v => !!v && v.checked === true && v.ind === false);
    await clickBatch('反选');
    check('全选状态下点「反选」⇒ 一条都不剩', await boxes(), [false, false, false]);
    await clickBatch('反选');
    check('再点一次「反选」⇒ 又全回来了', await boxes(), [true, true, true]);

    // —— L4. 批量停用 / 启用（带「只动选中的」对照） ——
    await multiBook(3);
    await clickBox(0);
    await clickBox(1);
    await clickBatch('停用');
    // ⚠⚠ 对照组在这条里：只选了前两条，第三条**必须一点没动** ——
    //    少了它，「批量」写成「全部」也会全绿
    check('批量停用只动选中的两条，第三条不受影响', await field('enabled'),
      [false, false, true], '[false, false, true]');
    check('摘要上的小标签也跟着变成「停用」',
      await ev(`[...document.querySelectorAll('#st-panes .st-entry')].map(d => {
        const c = d.querySelector('summary .st-chip');
        return c ? c.textContent : null; })`),
      v => v.length === 3 && v[0] === '停用' && v[1] === '停用' && v[2] === '启用');
    await clickBatch('启用');
    check('批量启用把三条都打开了', await field('enabled'), [true, true, true]);

    // —— L5. 批量设为常驻 / 取消常驻 ——
    await multiBook(3);
    await clickBox(0);
    await clickBox(2);
    await clickBatch('设为常驻');
    check('批量设为常驻只动选中的（0 和 2）', await field('constant'),
      [true, false, true], '[true, false, true]');
    check('摘要上出现「常驻」小标签',
      await ev(`[...document.querySelectorAll('#st-panes .st-entry')].map(d =>
        !!d.querySelector('summary .st-chip.st-const'))`),
      [true, false, true]);
    await clickBatch('取消常驻');
    check('批量取消常驻 ⇒ 三条都关掉', await field('constant'), [false, false, false]);

    // —— L6. 批量删除：问不问 / 答不要 / 只删选中的 ——
    await multiBook(4);
    await clickBox(1);
    await clickBox(3);
    await ev(`window.__dlg = []; window.__confirmYes = false;`);
    await clickBatch('删除');
    check('答「不要」时先**问了一句**', await ev(`window.__dlg.length`), v => v === 1);
    check('答「不要」⇒ 一条都没删', await names(), ['阿尔法', '贝塔', '伽马', '德尔塔']);
    await ev(`window.__confirmYes = true; window.__dlg = [];`);
    await clickBatch('删除');
    check('答「要」⇒ 问了第二次', await ev(`window.__dlg.length`), v => v === 1);
    // ⚠⚠ 删的是**不连续**的第 2、第 4 条。从前往后删的实现会下标错位，
    //    留下的就不是「阿尔法 / 伽马」了
    check('⚠ 只删勾中的那两条，顺序不变', await names(), ['阿尔法', '伽马']);
    check('删完选中集清空', await selInfo(), v => v === '已选 0 / 2 条');

    // —— L7. 单条删除会把死 id 从选中集里摘掉 ——
    await multiBook(3);
    await ev(`document.getElementById('st-sel-all').click()`);
    await sleep(160);
    // 走**真按钮**（条目卡片里那个 ✕ 删除），不是直接调 stDelEntry
    await ev(`document.querySelector('#st-entry-0 .st-actions button.st-danger').click()`);
    await sleep(260);
    check('单条删除之后计数跟着减，不留死 id', await selInfo(), v => v === '已选 2 / 2 条');

    // —— L8. 导出为世界书（形状 + 往返） ——
    await multiBook(3);
    await ev(`(function(){
      stEditor.card.bookName = '探针世界书';
      stEditor.card.bookEntries[0].constant = true;
      stEditor.card.bookEntries[0].keys = [${JSON.stringify(W_A)}];
      stEditor.card.bookEntries[0].secondaryKeys = [${JSON.stringify(W_B)}];
      stEditor.card.bookEntries[1].enabled = false;
      window.__dl = null;
      window.stDownload = function (name, blob) { window.__dl = { name: name, blob: blob }; };
      return true; })()`);
    await clickBox(0);
    await clickBox(1);
    await clickBatch('导出为世界书');
    const dl = await ev(`(async function(){
      if (!window.__dl) return null;
      return { name: window.__dl.name, text: await window.__dl.blob.text() }; })()`, true);
    check('导出真的触发了下载', dl, v => !!v && !!v.text);
    check('部分导出时文件名标出条数', dl && dl.name,
      v => v === '探针世界书（选中 2 条）.json', '探针世界书（选中 2 条）.json');
    let wi = null;
    try { wi = JSON.parse(dl.text); } catch (e) { wi = null; }
    check('导出的是一份能解析的 JSON', wi, v => !!v && typeof v === 'object');
    // ⚠⚠ 这条是从 ST 源码里核出来的形状：世界书的 `entries` 是**以 uid 字符串为键的对象**，
    //    不是数组（world-info.js 里到处是 data.entries[uid] / Object.values(data.entries)）。
    //    写成数组的话 ST 那边会直接读不到条目
    check('⚠ entries 是**对象**不是数组', wi && wi.entries,
      v => !!v && !Array.isArray(v) && typeof v === 'object', 'object');
    check('entries 的键是 "0" / "1"', wi && Object.keys(wi.entries || {}),
      v => JSON.stringify(v) === '["0","1"]');
    check('用的是 ST 世界书的字段名（key / keysecondary / uid / disable）',
      wi && wi.entries && wi.entries['0'],
      v => !!v && Array.isArray(v.key) && Array.isArray(v.keysecondary) &&
          v.uid === 0 && typeof v.disable === 'boolean',
      'key[] + keysecondary[] + uid + disable');
    check('key / keysecondary 装的就是那两条词',
      wi && wi.entries && wi.entries['0'],
      v => !!v && v.key[0] === W_A && v.keysecondary[0] === W_B, [W_A, W_B]);
    check('constant 原样带出去', wi && wi.entries && wi.entries['0'].constant, true);
    check('disable 是 enabled 的反面（第二条是停用的）',
      wi && wi.entries && wi.entries['1'].disable, true);
    check('position 是**数字**（卡内那份才是字符串）',
      wi && wi.entries && typeof wi.entries['0'].position, 'number');
    // ⚠⚠ 往返才是「形状对不对」唯一可信的判据：把导出的 JSON 喂回产品自己的解析器，
    //    条目一个不少、字段一个不差，才说明这份文件不是「看着像」
    const rt = await ev(`(function(){
      try {
        const b = parseWorldBook(JSON.parse(${JSON.stringify(dl.text)}), '往返');
        return { n: b.entries.length, names: b.entries.map(e => e.comment),
                 keys: b.entries.map(e => e.keys),
                 sec: b.entries.map(e => e.secondaryKeys),
                 en: b.entries.map(e => e.enabled),
                 con: b.entries.map(e => e.constant) };
      } catch (e) { return { err: String(e.message) }; } })()`);
    check('往返：导出的世界书能被自己的解析器读回来（2 条）',
      rt && rt.n, v => v === 2, 2);
    check('往返：备注一字不差', rt,
      v => !!v && JSON.stringify(v.names) === '["阿尔法","贝塔"]', '阿尔法 / 贝塔');
    check('往返：第 1 条的关键词 / 次关键词一字不差', rt,
      v => !!v && JSON.stringify(v.keys[0]) === JSON.stringify([W_A]) &&
          JSON.stringify(v.sec[0]) === JSON.stringify([W_B]), W_A + ' / ' + W_B);
    // 对照组：第 2 条的关键词是夹具给的 'k1'，跟第 1 条**不同** ——
    //   两边一样的话「有没有把条目接错」根本分不出来（六之二十六）
    check('对照组：第 2 条带的是它自己的关键词，没串到第 1 条', rt,
      v => !!v && JSON.stringify(v.keys[1]) === JSON.stringify(['k1']), ['k1']);
    check('往返：启用与常驻也对得上', rt,
      v => !!v && JSON.stringify(v.en) === '[true,false]' &&
          JSON.stringify(v.con) === '[true,false]',
      'en [true,false] / con [true,false]');
    // 对照组：全选导出时文件名里**不该**有「选中 N 条」
    await ev(`document.getElementById('st-sel-all').click()`);
    await sleep(160);
    await ev(`window.__dl = null;`);
    await clickBatch('导出为世界书');
    const dl2 = await ev(`(function(){ return window.__dl ? window.__dl.name : null; })()`);
    check('对照组：全选导出时文件名不带「选中」', dl2,
      v => v === '探针世界书.json', '探针世界书.json');

    // —— L9. 新建卡之后选中清空 ——
    await ev(`stNewCard(false)`);
    await sleep(300);
    check('新建卡之后选中集清空', await ev(`stEditor.bookSel.length`), v => v === 0);

    // —— L10. 复古皮肤下方角 ——
    await multiBook(2);
    const radiusOf = () => ev(`(function(){
      const el = document.getElementById('st-book-batch');
      return el ? getComputedStyle(el).borderTopLeftRadius : null; })()`);
    const normalR = await radiusOf();
    check('非复古时批量栏是圆角', normalR, v => v && v !== '0px' && v !== '0px 0px', normalR);
    await ev(`document.body.classList.add('retro-mode')`);
    await sleep(220);
    check('复古模式下批量栏变方角', await radiusOf(), v => v === '0px', '0px');
    await ev(`document.body.classList.remove('retro-mode')`);
    await sleep(160);

    // ============ K. 收尾 ============
    section('K. 收尾');
    check('世界书面板还在（没被标签控件带崩）',
      await ev(`(function(){ const p = document.querySelector('#st-panes .st-pane');
        return !!(p && p.textContent.indexOf('世界书') >= 0); })()`), true);
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
    // ⚠⚠ **不要在本进程里删 profile**：这台机器删一个文件要 ~200 ms，一个 Chrome profile
    //   有几百个文件 ⇒ `fs.rmSync` 永不返回 ⇒ finally 不返回 ⇒ **连汇总行都打不出来**
    //   （RULES 六之五十五）。派一个脱离的子进程去删，`_purge-tmp.js` 会兜底
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
