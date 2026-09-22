// 第八轮：**预制块** —— 用块库里的原子块拼好的「一整组」，点一下整组进画布
//
// 要证的四件事：
//   ① 覆盖常见场景：生命值 / 物品栏 / 好感度（单个 + 复数）…，而且**每一条都能真的加进去**
//   ② 变量尽量**自动绑到卡里已有的变量**上（绑不上就写兜底路径，并且**当面说一句**）
//   ③ 用户能把画布上的一块（或整张画布）存成自己的预制块，**存在本机**、跨卡跨会话都在
//   ④ 这一切都不能弄坏原有那几套：块库还在、图层 / 命中框跟着涨、块 id 不重复、产物照写
//
// 十段：
//   A. 装载与零报错
//   B. 预制块那一区渲染出来（分类 / 按钮数 / 提示语 / 遍历全部 build 一遍）
//   C. 插入一个预制块（卡里还没变量 → 走兜底路径 + warn）
//   D. 建出变量之后再插 → 自动绑定，而且用**变量自己的** min/max
//   E. 选中分组 → 进分组；不选中 → 落根上（对照组）
//   F. 复数：好感度（多人）三个槽各绑各的，绝不三个槽绑同一个变量
//   G. 存 / 插 / 覆盖 / 取消 / 删 / 刷新后还在
//   H. 边界：空画布、超大块、localStorage 里的坏数据
//   I. 窄屏（0 高 = 不可见，那是另一回事，得配对照组）
//   J. 收尾零报错
//
// 跑法：node sb-verify8.js

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

const DIALOGS = [];

// 围栏外面有东西的原稿：前面一段说明、后面一段尾注。运行时只认围栏里那段，
// 但外面这些是作者写的字 —— 写回时得一个字节不差地带回去
const OUTSIDE_PRE = '这张卡的状态栏说明：把下面这段贴进「状态栏界面」正则。\n\n';
const OUTSIDE_POST = '\n\n<!-- 尾注：上面的注释是给读者看的 -->\n';
const FENCED_BODY =
  '<!doctype html><html><head><meta charset="utf-8"></head><body>\n' +
  '<div style="border:1px solid #5a3f6b;border-radius:10px;padding:9px 11px;' +
  'color:#f0e6f5;font-size:13px;line-height:1.6;box-sizing:border-box;text-align:left">\n' +
  '<div style="font-size:15px;font-weight:bold;color:#ffb3d9;text-align:left;' +
  'margin:0 0 6px;line-height:1.4">状态</div>\n' +
  '<div style="font-size:13px;color:#f0e6f5;text-align:left;margin:3px 0;' +
  'white-space:pre-wrap;line-height:1.6">HP {{format_message_variable::stat_data.生命}}</div>\n' +
  '</div>\n' +
  '</body></html>';
const OUTSIDE_RAW = OUTSIDE_PRE + '```html\n' + FENCED_BODY + '\n```' + OUTSIDE_POST;

// 不合格的原稿（一）：有围栏，但代码里没有 <body> / </body>
const NO_BODY_RAW = '```html\n' +
  '<div style="border:1px solid #345;border-radius:8px;padding:8px;color:#eee">\n' +
  '<div style="font-size:13px;color:#eee;text-align:left;margin:3px 0;' +
  'white-space:pre-wrap;line-height:1.6">HP {{format_message_variable::stat_data.生命}}</div>\n' +
  '</div>\n```';

// 不合格的原稿（二）：连围栏都没有，直接甩了一段裸 HTML
const BARE_RAW = '<div style="border:1px solid #345;border-radius:8px;padding:8px;color:#eee">' +
  '<div style="font-size:13px;color:#eee;text-align:left;margin:3px 0;' +
  'white-space:pre-wrap;line-height:1.6">HP {{format_message_variable::stat_data.生命}}</div></div>';

// <head> 里放 <style> —— 真 iframe 里这是最自然的写法
const HEAD_STYLE_RAW =
  '<!doctype html><html><head><meta charset="utf-8">' +
  '<style>.st-head-probe{color:rgb(17,34,51);letter-spacing:2.5px}</style></head><body>\n' +
  '<div style="border:1px solid #345;border-radius:8px;padding:8px;color:#eee">\n' +
  '<div class="st-head-probe" style="font-size:13px;text-align:left;margin:3px 0;' +
  'white-space:pre-wrap;line-height:1.6">甲</div>\n' +
  '</div>\n</body></html>';

(async () => {
  await pickPort();
  log(`静态服务 http://127.0.0.1:${HTTP_PORT}`);
  // 端口不能写死、也不能纯随机：连跑整套时上一轮 Chrome 还没退干净就会占着
  // 刚抽到的号，症状是「Chrome 调试端口没起来」—— 跟被测页面一点关系都没有。
  // 先试着真绑一下，绑得上才算数
  const cdpPort = await (async () => {
    for (let i = 0; i < 80; i++) {
      const p = 9400 + Math.floor(Math.random() * 900);
      const free = await new Promise(res => {
        const probe = http.createServer();
        probe.on('error', () => { try { probe.close(); } catch (e) {} res(false); });
        probe.listen(p, '127.0.0.1', () => probe.close(() => res(true)));
      });
      if (free) return p;
      await sleep(40);
    }
    return 9400 + Math.floor(Math.random() * 900);
  })();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-sb8-'));
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu',
    '--no-first-run', '--hide-scrollbars',
    `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`], { stdio: 'ignore' });

  let cdp = null, SID = null, srv = null;
  const VP = { width: 1440, height: 900, mobile: false };
  const ev = async (expr, awaitPromise = false, timeout = 30000) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise }, SID, timeout);
    if (r.exceptionDetails) {
      throw new Error('页面异常: ' + (r.exceptionDetails.exception
        ? r.exceptionDetails.exception.description : r.exceptionDetails.text));
    }
    return r.result.value;
  };
  const shot = async (name, sel) => {
    let saved = null;
    if (sel) {
      const h = await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
        if (!el) return 0; el.scrollIntoView({block:'start'});
        return Math.ceil(el.getBoundingClientRect().height); })()`);
      if (h > 0) {
        saved = { ...VP };
        await cdp.send('Emulation.setDeviceMetricsOverride',
          { width: VP.width, height: Math.min(Math.max(h + 24, 320), 4000), deviceScaleFactor: 1, mobile: false }, SID);
      }
    }
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' }, SID);
    fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, 'base64'));
    if (saved) await cdp.send('Emulation.setDeviceMetricsOverride',
      { ...saved, deviceScaleFactor: 1, mobile: false }, SID);
    console.log(`  📸 ${name} (${Math.round(Buffer.from(r.data, 'base64').length / 1024)} KB)`);
  };

  // 预览 iframe 的 sandbox **不给 same-origin**，Chrome 会把它扔进另一个进程
  // （OOPIF）—— 父页面的 frame tree 里根本看不到它，父页面的 JS 也摸不到它。
  // 想验它里面到底渲染成什么样，只能 auto-attach 到那个 target，在它自己的
  // session 里求值。顺带一提：这个隔离本身就是我们想要的
  const oopif = [];
  async function frameEval(expr) {
    let lastErr = null;
    for (let i = 0; i < 40; i++) {
      const cand = oopif.filter(o => /srcdoc/.test(o.url || ''));
      for (let k = cand.length - 1; k >= 0; k--) {
        try {
          const r = await cdp.send('Runtime.evaluate',
            { expression: expr, returnByValue: true }, cand[k].sessionId, 8000);
          if (r.exceptionDetails) {
            throw new Error('预览 frame 里求值出错: ' + (r.exceptionDetails.exception
              ? r.exceptionDetails.exception.description : r.exceptionDetails.text));
          }
          return r.result.value;
        } catch (e) {
          if (/求值出错/.test(e.message)) throw e;      // 表达式自己的错，别重试
          lastErr = e;                                   // 上下文没了 / 还在加载
        }
      }
      await sleep(200);
    }
    throw new Error('进不去预览 iframe：' + (lastErr && lastErr.message) +
      '（已看到 ' + oopif.length + ' 个 OOPIF）');
  }

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
    // 预览 iframe 是 OOPIF，得开 auto-attach 才够得着
    await cdp.send('Target.setAutoAttach',
      { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, SID);
    await cdp.send('Page.enable', {}, SID);
    await cdp.send('Runtime.enable', {}, SID);
    // 页内的 confirm 一律换成同步桩 —— **不再靠 CDP 的对话框自动应答**。
    // 那条路子实测约 20% 会翻车：Chrome 会先一步把对话框撤掉，我们那句
    // Page.handleJavaScriptDialog 才到，回一个 -32602「No dialog is showing」，
    // 于是 confirm() 静默返回 false。现场看着只是某个断言莫名红一次，而且红在
    // 跟弹窗八竿子打不着的地方（踩过一次：状态栏模板没套上，块数还是 3 ——
    // 因为装 MVU 时播种的「简约数值行」也是 3 块，光看数字根本看不出差别）。
    // addScriptToEvaluateOnNewDocument 每次新文档都跑一遍，刷新之后桩也还在
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__dlg = [];
        window.__confirmYes = true;
        window.confirm = function (m) { window.__dlg.push(String(m)); return window.__confirmYes !== false; };`
    }, SID);
    // 保底：万一真弹出来了也得接住，而且**错误不能吞** —— 上面那个 20% 就是
    // 被一个空的 .catch(() => {}) 藏了整整一轮
    cdp.on('Page.javascriptDialogOpening', async p => {
      DIALOGS.push(p.message);
      cdp.send('Page.handleJavaScriptDialog', { accept: true }, SID)
        .catch(e => console.log('  ⚠ 对话框没接住：' + (e && e.message)));
    });
    cdp.on('Target.attachedToTarget', async p => {
      if (!p.targetInfo || p.targetInfo.type !== 'iframe') return;
      oopif.push({ sessionId: p.sessionId, url: p.targetInfo.url || '' });
      try { await cdp.send('Runtime.enable', {}, p.sessionId); } catch (e) {}
    });
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
    loaded = new Promise(res => cdp.on('Page.loadEventFired', res));
    await cdp.send('Page.reload', {}, SID);
    await loaded;
    await ev(`document.fonts.ready.then(() => true)`, true);
    await sleep(600);
    log('页面加载完成');

    await ev('openStEditor()');
    await ev(`stSwitchTab('mvu')`);
    await ev(`stMvuInstallClick()`);
    // 变量树清空 —— 后面每一段都要能自己说了算「卡里有哪些变量」，
    // 留着安装时播下的种会让「兜底路径」和「自动绑定」两件事分不清
    await ev(`stEditor.card.mvu.nodes = []; stMvuSync(); stSaveDraft();`);
    await ev(`stSbApplyTemplate(5)`);        // 5 = 空白模板
    await ev(`stSwitchTab('sb')`);
    await sleep(250);

    // 页面内的小工具：按 id 点某个内置预制块。**走真按钮的 onclick**，
    // 不是直接调函数 —— 要验的正是「按钮接对了没有」
    await ev(`window.__pfIdx = id => ST_SB_PREFABS.findIndex(p => p.id === id);`);
    await ev(`window.__clickPrefab = id => {
      const i = ST_SB_PREFABS.findIndex(p => p.id === id);
      if (i < 0) return 'no-prefab';
      const btn = document.querySelector('[onclick="stSbAddPrefab(' + i + ')"]');
      if (!btn) return 'no-btn';
      btn.click();
      return 'ok';
    };`);
    await ev(`window.__mineItem = name => [...document.querySelectorAll('.st-sb-pf-item')]
      .filter(s => s.textContent.indexOf(name) >= 0)[0] || null;`);
    await ev(`window.__insertMine = id => {
      const it = stSbUserPrefabs().filter(x => x.id === id)[0];
      if (!it) return 'no-item';
      stSbAddUserPrefab(it.id);
      return 'ok';
    };`);

    // ============ A. 装载与零报错 ============
    console.log('\n== A. 装载与零报错 ==');
    check('页面无 console 错误', consoleErrors.filter(x => !/favicon/i.test(x)),
      v => v.length === 0, []);
    check('编辑器已打开',
      await ev(`document.getElementById('st-overlay').classList.contains('active')`), true);
    check('MVU 已装、状态栏已接管', await ev(`stEditor.sbOwn`), true);
    check('画布起点是空的（套了空白模板）',
      await ev(`stSbCount(stEditor.card.statusBar.blocks)`), 0);

    // ============ B. 预制块那一区渲染出来了 ============
    console.log('\n== B. 预制块区 ==');
    const pfN = await ev(`ST_SB_PREFABS.length`);
    const btnN = await ev(`document.querySelectorAll('[onclick^="stSbAddPrefab("]').length`);
    check('内置预制块按钮数 == 内置清单长度', btnN, pfN);
    check('  覆盖面够（≥12 个）', pfN, v => v >= 12, '>=12');
    check('块库没被挤掉（9 个原子块还在）',
      await ev(`document.querySelectorAll('[onclick^="stSbAddBlock("]').length`), 9);
    const cats = await ev(`[...document.querySelectorAll('.st-sb-pf-cat')].map(e => e.textContent.trim())`);
    // ⚠ **按源码枚举，别写死 6** —— 第 9 轮加了「让 AI 生成」那一行，多出一个分类小标题，
    //   写死 6 的断言当场红，而**产品是对的**（多了一个来源，标题自然多一个）。
    //   「新增功能让旧套件的前提失效」的第 N 次 —— 修判据，不是把产品改回去。
    const catWant = await ev(`ST_SB_PREFAB_CATS.length + 2`);   // 内置分类 + 我的预制块 + 让 AI 生成
    check('分类小标题 = 内置分类 + 我的预制块 + 让 AI 生成', cats.length, catWant, cats);
    check('  头一个是「生命与属性」', cats[0].indexOf('生命与属性'), 0);
    // ⚠ 「我的预制块」**不再是最后一个**了 —— 第 9 轮那行排在它后面。
    //   判据改成「两者都在，而且顺序是 我的预制块 → 让 AI 生成」，
    //   这样以后再往末尾加一区，这条也不会无故变红。
    check('  「我的预制块」和「让 AI 生成」都在，且后者排在后面',
      await ev(`(function(){
        const t = [...document.querySelectorAll('.st-sb-pf-cat')].map(e => e.textContent.trim());
        const a = t.findIndex(x => x.indexOf('我的预制块') >= 0);
        const b = t.findIndex(x => x.indexOf('让 AI 生成') >= 0);
        return a >= 0 && b > a;
      })()`), true);
    check('⚠ 没有「分类不在清单里」的预制块（那种会静默不渲染）',
      await ev(`ST_SB_PREFABS.filter(p => ST_SB_PREFAB_CATS.indexOf(p.cat) < 0).map(p => p.id)`),
      v => v.length === 0, []);
    check('每个预制块都写了提示语（title 不是空壳）',
      await ev(`[...document.querySelectorAll('[onclick^="stSbAddPrefab("]')]
        .map(b => (b.getAttribute('title') || '').length).filter(n => n < 6).length`), 0);
    check('「我的预制块」默认是空提示（没有按钮）',
      await ev(`document.querySelectorAll('.st-sb-pf-item').length`), 0);
    check('  空提示说了怎么存',
      await ev(`document.querySelector('.st-sb-layers').textContent.indexOf('存成自己的预制块') >= 0`),
      true);
    check('名字输入框在', await ev(`!!document.getElementById('st-sb-pf-name')`), true);
    check('  限 24 字', await ev(`document.getElementById('st-sb-pf-name').getAttribute('maxlength')`),
      '24');

    // 逐个 build 一遍：不写死「16 个」这种数，直接遍历页面里那份清单 ——
    // 以后再加预制块，这一段自动跟着走（写死清单的话新项根本不进循环，
    // 不会红，只会静默少走）
    const buildBad = await ev(`(() => {
      const bad = [];
      ST_SB_PREFABS.forEach(p => {
        const api = stSbPrefabApi();
        let out = [];
        try { out = p.build(api) || []; } catch (e) { bad.push(p.id + ':throw:' + e.message); return; }
        if (!out.length) bad.push(p.id + ':empty');
        out.forEach(b => {
          if (!b || !b.id || ST_SB_BLOCKS.indexOf(b.type) < 0) bad.push(p.id + ':bad-block:' + (b && b.type));
          if (b && b.type === 'row' && (!b.children || !b.children.length)) bad.push(p.id + ':empty-row');
        });
        if (api.auto > api.total) bad.push(p.id + ':auto>total');
      });
      return bad; })()`);
    check('每个预制块都能 build 出合法的块（类型都在块库里）',
      buildBad, v => v.length === 0, []);
    // ⚠ 这条是补出来的：星级预制块的 extra 里带过一句 `max: 5`（本来是给兜底路
    //   准备的），而 extra 当初是**后**应用的，于是把绑到的变量范围一起盖掉了 ——
    //   卡里 0~100 的好感度被压成 0~5，值 50 直接顶满，五颗星永远全亮。
    //   所以钉住「bind 赢 extra」这条顺序
    const order = await ev(`(() => {
      const api = stSbPrefabApi();
      const b = api.blk('dots',
        { path: 'stat_data.X', label: 'X', min: 3, max: 777 }, { max: 5, count: 5 });
      return { max: b.max, min: b.min, count: b.count, path: b.path }; })()`);
    check('⚠ extra 里的 max 盖不掉绑到的范围（先 extra、后 bind）', order.max, 777);
    check('  下限同理', order.min, 3);
    check('  但 extra 里别的字段照样生效', order.count, 5);
    check('  路径也是 bind 的', order.path, 'stat_data.X');
    check('空画布时的提示也提到了预制块',
      await ev(`document.querySelector('.st-sb-layers').textContent.indexOf('预制块') >= 0`), true);

    // ============ C. 插入一个预制块（兜底路径）============
    console.log('\n== C. 插入「生命值」（卡里还没这个变量）==');
    await ev(`__clickPrefab('hp')`);
    await sleep(150);
    const c1 = await ev(`(() => {
      const bs = stEditor.card.statusBar.blocks;
      const b = bs[0];
      const bar = document.getElementById('st-status');
      return { n: bs.length, t: b.type, path: b.path, color: b.color, h: b.height,
        bold: b.bold, sel: stEditor.sbSel === b.id,
        msg: bar.textContent, cls: bar.className,
        layers: document.querySelectorAll('.st-sb-layers .st-mvu-row').length,
        hits: document.querySelectorAll('#st-sb-canvas .st-sb-hit').length,
        doc: stSbDocHtml().indexOf('format_message_variable::stat_data.生命值') >= 0 }; })()`);
    check('加进去 1 块', c1.n, 1);
    check('  是进度条', c1.t, 'bar');
    check('  路径是兜底值', c1.path, 'stat_data.生命值');
    check('  带上了预制块指定的红色', c1.color, '#e5484d');
    check('  条高也是预制块指定的', c1.h, 9);
    check('  新块被选中（可以直接接着改）', c1.sel, true);
    check('图层行跟着涨', c1.layers, 1);
    check('画布命中框跟着涨', c1.hits, 1);
    check('写进产物了', c1.doc, true);
    check('提示说了「已加入预制块」', c1.msg.indexOf('已加入预制块「生命值」') >= 0, true);
    check('  并且说明了路径是默认值', c1.msg.indexOf('默认值') >= 0, true);
    check('  是 warn 样式（兜底路径不能当成功报）', c1.cls.indexOf('st-warn') >= 0, true);

    // ============ D. 自动绑到卡里已有的变量 ============
    // ⚠ 故意用「血量」而不是「生命值」：预制块 `hp` 的兜底路径本来就是
    //   stat_data.生命值 / 上限 100，要是拿同名同范围的变量来验，
    //   **绑上了和没绑上长得一模一样**（路径、显示名全一样），
    //   那条断言就永远绿。换成「血量 / 10~150」，路径、显示名、上下限三处都能区分
    console.log('\n== D. 建一个 血量 变量，再插一次 ==');
    await ev(`stMvuAddNode('', { name: '血量', type: 'number', min: 10, max: 150, value: '80' })`);
    await sleep(150);
    await ev(`stSwitchTab('sb')`);
    await sleep(150);
    check('变量树里有了 血量（10~150）',
      await ev(`stSbVarPaths().map(p => p.name + ':' + p.type + ':' + p.min + '-' + p.max)`),
      v => v.indexOf('血量:number:10-150') >= 0, '含 血量:number:10-150');
    await ev(`__clickPrefab('hp')`);
    await sleep(150);
    const d1 = await ev(`(() => {
      const bs = stEditor.card.statusBar.blocks;
      const b = bs[bs.length - 1];
      const bar = document.getElementById('st-status');
      return { n: bs.length, path: b.path, min: b.min, max: b.max, label: b.label,
        msg: bar.textContent, cls: bar.className }; })()`);
    check('又加了一块', d1.n, 2);
    check('  路径自动绑到了卡里那条变量', d1.path, 'stat_data.血量');
    check('  用**变量自己的**上限 150（不是预制块默认的 100）', d1.max, 150);
    check('  下限也是变量自己的 10', d1.min, 10);
    check('  显示名跟变量名一致', d1.label, '血量');
    check('提示说变量都绑上了', d1.msg.indexOf('都绑到了卡里现成的变量上') >= 0, true);
    check('  不再是 warn 样式', d1.cls.indexOf('st-warn') < 0, true);

    // ============ E. 选中分组时进分组 ============
    console.log('\n== E. 选中分组 → 预制块进分组 ==');
    const eg = await ev(`(() => {
      const c = stEditor.card;
      const r = stBlankSbBlock('row');
      r.children = [stBlankSbBlock('var')];
      c.statusBar.blocks.push(r);
      stEditor.sbSel = r.id;
      stSbSync(); stSaveDraft(); stRerender();
      return { id: r.id, root: c.statusBar.blocks.length, kids: r.children.length }; })()`);
    check('先造了个分组（根层 3 块）', eg.root, 3);
    // ⚠ 判据一律走**增量**，不走绝对值 —— 绝对值会被前面那一步的失败带塌：
    //   注入「永远落根上」之后，第一次插入就跑歪了，后面拿绝对值比的断言
    //   会跟着红一片，看着像「对照组也坏了」，其实是同一次失败的余波。
    //   增量式的对照组在被注入时**照样绿**，才叫真对照
    const e1a = await ev(`(() => {
      const c = stEditor.card;
      const r = c.statusBar.blocks.filter(b => b.type === 'row')[0];
      return { root: c.statusBar.blocks.length, kids: r ? r.children.length : -1 }; })()`);
    await ev(`__clickPrefab('head')`);       // 标题 + 分割线 = 2 块
    await sleep(150);
    const e1b = await ev(`(() => {
      const c = stEditor.card;
      const r = c.statusBar.blocks.filter(b => b.type === 'row')[0];
      return { root: c.statusBar.blocks.length, kids: r ? r.children.length : -1,
        types: r ? r.children.map(x => x.type) : [] }; })()`);
    check('选中分组 → 根层一块没多', e1b.root - e1a.root, 0);
    check('  分组里多了 2 块', e1b.kids - e1a.kids, 2);
    check('  新块的类型对', e1b.types.join(','), 'var,title,divider');
    // 对照组：不选中 → 落根上
    await ev(`stEditor.sbSel = ''; stRerender();`);
    const e2a = await ev(`(() => {
      const c = stEditor.card;
      const r = c.statusBar.blocks.filter(b => b.type === 'row')[0];
      return { root: c.statusBar.blocks.length, kids: r ? r.children.length : -1 }; })()`);
    await ev(`__clickPrefab('head')`);
    await sleep(150);
    const e2 = await ev(`(() => {
      const c = stEditor.card;
      const r = c.statusBar.blocks.filter(b => b.type === 'row')[0];
      return { root: c.statusBar.blocks.length, kids: r ? r.children.length : -1 }; })()`);
    check('对照组：没选中分组 → 落在根上（根层 +2）', e2.root - e2a.root, 2);
    check('  → 分组里一块没多', e2.kids - e2a.kids, 0);

    // ============ F. 复数（多人好感度）============
    // ⚠ 同样避开「变量名跟兜底名撞车」：兜底路径是 …好感度.角色A/B/C，
    //   所以卡里那两个角色**故意叫小猫 / 小犬**，否则「绑上了」和「没绑上」
    //   在路径和显示名上完全一样，只有 uniq 一条能区分
    console.log('\n== F. 好感度（多人）==');
    await ev(`stMvuAddNode('', { name: '好感度', type: 'object', children: [
      { name: '小猫', type: 'number', min: 0, max: 80, value: '30' },
      { name: '小犬', type: 'number', min: 0, max: 90, value: '60' }] })`);
    await sleep(150);
    await ev(`stSwitchTab('sb')`);
    await sleep(150);
    const f1 = await ev(`(() => {
      stEditor.sbSel = ''; stRerender();
      const n0 = stEditor.card.statusBar.blocks.length;
      __clickPrefab('affmany');
      const bs = stEditor.card.statusBar.blocks.slice(n0);
      const dots = bs.filter(x => x.type === 'dots');
      return { n: bs.length, types: bs.map(x => x.type),
        paths: dots.map(x => x.path), labels: dots.map(x => x.label),
        maxes: dots.map(x => x.max),
        uniq: new Set(dots.map(x => x.path)).size,
        msg: document.getElementById('st-status').textContent }; })()`);
    check('加了 4 块（标题 + 3 个星级）', f1.n, 4);
    check('  结构对', f1.types.join(','), 'title,dots,dots,dots');
    check('  前两个绑到卡里那两个角色',
      f1.paths.slice(0, 2).join(' | '),
      'stat_data.好感度.小猫 | stat_data.好感度.小犬');
    check('  第三个用兜底路径', f1.paths[2], 'stat_data.好感度.角色C');
    check('⚠ 三条路径互不相同（复数不能全绑同一个变量）', f1.uniq, 3);
    check('  显示名各是各的', f1.labels.slice(0, 2).join(','), '小猫,小犬');
    check('  范围也各是各的（用的是变量自己的 80 / 90）',
      f1.maxes.slice(0, 2).join(','), '80,90');
    check('  提示说了 2/3 绑上了', f1.msg.indexOf('2/3') >= 0, true);
    const f2 = await ev(`(() => {
      const c = stEditor.card;
      const n0 = c.statusBar.blocks.length;
      stEditor.sbSel = ''; stRerender();
      __clickPrefab('affmanyrow');
      const bs = c.statusBar.blocks.slice(n0);
      return { n: bs.length, t: bs[0] && bs[0].type,
        kids: bs[0] && bs[0].children ? bs[0].children.length : 0,
        paths: bs[0] && bs[0].children ? bs[0].children.map(x => x.path) : [] }; })()`);
    check('横排版加的是「一行三列」', f2.t, 'row');
    check('  三列', f2.kids, 3);
    check('  列里的路径也各是各的', new Set(f2.paths).size, 3);
    check('  第一列绑到了小猫', f2.paths[0], 'stat_data.好感度.小猫');

    // ============ G. 自己攒预制块 ============
    console.log('\n== G. 存 / 插 / 覆盖 / 删 ==');
    const g0 = await ev(`(() => {
      stEditor.sbSel = ''; stRerender();
      const el = document.getElementById('st-sb-pf-name');
      el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true }));
      const n0 = stSbUserPrefabs().length;
      stSbPrefabSave();
      const bar = document.getElementById('st-status');
      return { n0: n0, n1: stSbUserPrefabs().length,
        msg: bar.textContent, cls: bar.className,
        raw: localStorage.getItem(ST_SB_PF_KEY) }; })()`);
    check('没填名字 → 不存', g0.n1, 0);
    check('  当面说了一句', g0.msg.indexOf('起个名字') >= 0, true);
    check('  是 warn 样式', g0.cls.indexOf('st-warn') >= 0, true);
    check('  localStorage 里一个字节都没写', g0.raw, null);

    const g1 = await ev(`(() => {
      const el = document.getElementById('st-sb-pf-name');
      el.value = '我的整套'; el.dispatchEvent(new Event('input', { bubbles: true }));
      const deep = l => (l || []).reduce((n, b) => n + 1 + deep(b.children), 0);
      const n0 = stSbCount(stEditor.card.statusBar.blocks);
      const root = stEditor.card.statusBar.blocks.length;
      stSbPrefabSave();
      const list = stSbUserPrefabs();
      const bar = document.getElementById('st-status');
      return { n0: n0, root: root, names: list.map(x => x.name),
        blocks: list[0] ? list[0].blocks.length : -1,
        deep: list[0] ? deep(list[0].blocks) : -1,
        btns: document.querySelectorAll('.st-sb-pf-item').length,
        onclick: (document.querySelector('.st-sb-pf-item .st-mini') || {}).getAttribute
          ? document.querySelector('.st-sb-pf-item .st-mini').getAttribute('onclick') : '',
        del: document.querySelectorAll('.st-sb-pf-item .st-danger').length,
        input: (document.getElementById('st-sb-pf-name') || {}).value,
        msg: bar.textContent,
        raw: localStorage.getItem(ST_SB_PF_KEY) }; })()`);
    check('没选中 → 整张画布存成一份', g1.names.join(','), '我的整套');
    check('  根层块数 == 画布的根层块数', g1.blocks, g1.root);
    check('  连子块一起数也对得上（分组里的东西没丢）', g1.deep, g1.n0);
    check('  「我的预制块」里出现了按钮', g1.btns, 1);
    check('  按钮接的是插入', String(g1.onclick).indexOf('stSbAddUserPrefab('), 0);
    check('  旁边有删除键', g1.del, 1);
    check('  localStorage 里真写了', String(g1.raw).indexOf('我的整套') > 0, true);
    check('  存完把名字那格清空（不会手一抖覆盖掉）', g1.input, '');
    check('  提示说了存成什么', g1.msg.indexOf('存成预制块「我的整套」') >= 0, true);

    const g2 = await ev(`(() => {
      const it = stSbUserPrefabs()[0];
      const n0 = stSbCount(stEditor.card.statusBar.blocks);
      __insertMine(it.id);
      const bar = document.getElementById('st-status');
      return { n0: n0, n1: stSbCount(stEditor.card.statusBar.blocks),
        msg: bar.textContent, cls: bar.className }; })()`);
    check('点自己的预制块 = 整组加进画布', g2.n1 - g2.n0, g1.n0);
    check('  用户预制块不重绑变量（提示里不提变量）',
      g2.msg.indexOf('变量') < 0, true);
    check('  也就不会是 warn', g2.cls.indexOf('st-warn') < 0, true);

    const g3 = await ev(`(() => {
      const ids = [];
      const walk = l => (l || []).forEach(b => { ids.push(b.id); walk(b.children); });
      walk(stEditor.card.statusBar.blocks);
      return { total: ids.length, uniq: new Set(ids).size }; })()`);
    check('⚠ 插了两份之后所有块 id 仍然唯一（换 id 那条路真跑了）',
      g3.uniq, g3.total);

    // 存一块路径特别的，验证「插回来路径原样」
    const g4 = await ev(`(() => {
      const c = stEditor.card;
      const keep = c.statusBar.blocks;
      const b = stBlankSbBlock('var');
      b.path = 'stat_data.自定义路径'; b.label = '自定义';
      c.statusBar.blocks = [b];
      stEditor.sbSel = ''; stSbSync(); stSaveDraft(); stRerender();
      const el = document.getElementById('st-sb-pf-name');
      el.value = '自定义组'; el.dispatchEvent(new Event('input', { bubbles: true }));
      stSbPrefabSave();
      const it = stSbUserPrefabs().filter(x => x.name === '自定义组')[0];
      __insertMine(it.id);
      const last = c.statusBar.blocks[c.statusBar.blocks.length - 1];
      const r = { path: last.path, label: last.label, n: c.statusBar.blocks.length,
        count: stSbUserPrefabs().length };
      c.statusBar.blocks = keep; stSbSync(); stSaveDraft(); stRerender();
      return r; })()`);
    check('第二份也存进去了', g4.count, 2);
    check('⚠ 插回来路径原样 —— 用户存的组不会被自动重绑', g4.path, 'stat_data.自定义路径');
    check('  显示名也原样', g4.label, '自定义');

    // 刷新：用户预制块是**跨会话**的，草稿里的画布也还在
    const keepBlocks = await ev(`stSbCount(stEditor.card.statusBar.blocks)`);
    loaded = new Promise(res => cdp.on('Page.loadEventFired', res));
    await cdp.send('Page.reload', {}, SID);
    await loaded;
    await ev(`document.fonts.ready.then(() => true)`, true);
    await sleep(700);
    await ev('openStEditor()');
    await ev(`stSwitchTab('sb')`);
    await sleep(300);
    const g5 = await ev(`(() => ({
      names: stSbUserPrefabs().map(x => x.name),
      btns: document.querySelectorAll('.st-sb-pf-item').length,
      canvas: stSbCount(stEditor.card.statusBar.blocks),
      own: stEditor.sbOwn
    }))()`);
    check('刷新之后自己攒的还在', g5.names.join(','), '我的整套,自定义组');
    check('  界面按钮也在', g5.btns, 2);
    check('  画布也从草稿接上了', g5.canvas, keepBlocks);

    // 敲进名字格的字要能扛过一次重绘
    const g6 = await ev(`(() => {
      const el = document.getElementById('st-sb-pf-name');
      el.value = '还没存'; el.dispatchEvent(new Event('input', { bubbles: true }));
      const st = stEditor.sbPfName;
      stSbSelect(stEditor.card.statusBar.blocks[0].id, false);
      const el2 = document.getElementById('st-sb-pf-name');
      return { st: st, dom: el2 ? el2.value : 'no-el' }; })()`);
    check('名字格里的字扛得住重绘（状态不在 DOM 里）', g6.dom, '还没存');

    // 同名覆盖
    const g7 = await ev(`(() => {
      stEditor.sbSel = stEditor.card.statusBar.blocks[0].id; stRerender();
      const el = document.getElementById('st-sb-pf-name');
      el.value = '我的整套'; el.dispatchEvent(new Event('input', { bubbles: true }));
      const before = stSbUserPrefabs().filter(x => x.name === '我的整套')[0].blocks.length;
      const n0 = stSbUserPrefabs().length;
      window.__dlg.length = 0;
      stSbPrefabSave();
      const list = stSbUserPrefabs();
      const it = list.filter(x => x.name === '我的整套')[0];
      return { before: before, n0: n0, n1: list.length, blocks: it.blocks.length,
        asked: window.__dlg.slice(),
        msg: document.getElementById('st-status').textContent }; })()`);
    check('同名 → 先问一句', g7.asked.length, 1);
    check('  问的是「覆盖」', g7.asked[0].indexOf('覆盖') >= 0, true);
    check('  列表没变长（是覆盖不是新增）', g7.n1, g7.n0);
    check('  内容换成了这次选的（1 块）', g7.blocks, 1);
    check('  提示说了是覆盖', g7.msg.indexOf('覆盖') >= 0, true);

    // 点「取消」就真不覆盖
    const g8 = await ev(`(() => {
      window.__confirmYes = false;
      window.__dlg.length = 0;
      const el = document.getElementById('st-sb-pf-name');
      el.value = '我的整套'; el.dispatchEvent(new Event('input', { bubbles: true }));
      const before = stSbUserPrefabs().filter(x => x.name === '我的整套')[0].blocks.length;
      stSbPrefabSave();
      window.__confirmYes = true;
      return { before: before,
        after: stSbUserPrefabs().filter(x => x.name === '我的整套')[0].blocks.length,
        asked: window.__dlg.length }; })()`);
    check('点了「取消」→ 真不覆盖', g8.after, g8.before);
    check('  但确实问过了', g8.asked, 1);

    // 删除
    const g9 = await ev(`(() => {
      const it = stSbUserPrefabs().filter(x => x.name === '自定义组')[0];
      const canvas0 = stSbCount(stEditor.card.statusBar.blocks);
      window.__dlg.length = 0;
      stSbPrefabDel(it.id);
      return { names: stSbUserPrefabs().map(x => x.name),
        asked: window.__dlg.slice(),
        btns: document.querySelectorAll('.st-sb-pf-item').length,
        canvas: stSbCount(stEditor.card.statusBar.blocks),
        raw: JSON.parse(localStorage.getItem(ST_SB_PF_KEY) || '{}'),
        msg: document.getElementById('st-status').textContent }; })()`);
    check('删掉之后只剩一份', g9.names.join(','), '我的整套');
    check('  先问了一句', g9.asked.length, 1);
    check('  界面上的按钮跟着少一个', g9.btns, 1);
    check('  localStorage 里也删了',
      (g9.raw.list || []).map(x => x.name).join(','), '我的整套');
    check('⚠ 画布上已经加进去的块不受影响', g9.canvas, keepBlocks);
    check('  提示说了删了哪个', g9.msg.indexOf('已删掉预制块「自定义组」') >= 0, true);

    // ============ H. 边界 ============
    console.log('\n== H. 边界 ==');
    const h1 = await ev(`(() => {
      const keep = stEditor.card.statusBar.blocks;
      stEditor.card.statusBar.blocks = [];
      stEditor.sbSel = ''; stRerender();
      const el = document.getElementById('st-sb-pf-name');
      el.value = '空的'; el.dispatchEvent(new Event('input', { bubbles: true }));
      const n0 = stSbUserPrefabs().length;
      stSbPrefabSave();
      const r = { same: stSbUserPrefabs().length === n0,
        msg: document.getElementById('st-status').textContent,
        cls: document.getElementById('st-status').className };
      stEditor.card.statusBar.blocks = keep; stSbSync(); stSaveDraft(); stRerender();
      return r; })()`);
    check('画布空 + 没选中 → 存不了', h1.same, true);
    check('  说了「画布是空的」', h1.msg.indexOf('画布是空的') >= 0, true);
    check('  是 warn 样式', h1.cls.indexOf('st-warn') >= 0, true);

    const h2 = await ev(`(() => {
      const c = stEditor.card;
      const keep = c.statusBar.blocks;
      const big = stBlankSbBlock('html');
      big.text = '<div>' + new Array(45001).join('x') + '</div>';
      c.statusBar.blocks = [big];
      stEditor.sbSel = ''; stRerender();
      const el = document.getElementById('st-sb-pf-name');
      el.value = '太大'; el.dispatchEvent(new Event('input', { bubbles: true }));
      const n0 = stSbUserPrefabs().length;
      stSbPrefabSave();
      const r = { same: stSbUserPrefabs().length === n0,
        msg: document.getElementById('st-status').textContent,
        cls: document.getElementById('st-status').className };
      c.statusBar.blocks = keep; stSbSync(); stSaveDraft(); stRerender();
      return r; })()`);
    check('单块超过 40KB → 拒绝', h2.same, true);
    check('  说了多大', /KB/.test(h2.msg), true);
    check('  是 warn 样式', h2.cls.indexOf('st-warn') >= 0, true);

    const h3 = await ev(`(() => {
      // 坏数据：混进一条不是对象的、一条没名字的、一条块全是垃圾的
      localStorage.setItem(ST_SB_PF_KEY, JSON.stringify({ v: 1, list: [
        null, 42, { name: '', blocks: [{ type: 'bar' }] },
        { id: 'x1', name: '好的一份', blocks: [{ type: 'title', text: '甲' }] },
        { id: 'x2', name: '垃圾块', blocks: ['不是对象', 7] }
      ] }));
      stSbPfCache = null;
      const list = stSbUserPrefabs();
      return { names: list.map(x => x.name),
        blocks: list.map(x => x.blocks.length),
        ids: list.map(x => x.id) }; })()`);
    check('坏数据被逐条跳过，不炸', h3.names.join(','), '好的一份');
    check('  块也被规范化过（走的是同一份白名单）', h3.blocks.join(','), '1');
    check('  拿到的 id 是纯字母数字（能塞进 onclick）', /^[A-Za-z0-9]+$/.test(h3.ids[0]), true);
    const h4 = await ev(`(() => {
      const bad = [];
      stSbUserPrefabs().forEach(it => {
        it.blocks.forEach(b => {
          Object.keys(b).forEach(k => {
            if (k === 'clsOwn' || k === 'clsMap' || k === 'children') return;
            if (ST_SB_BLOCKS && stBlankSbBlock(b.type) === null) bad.push(k);
          });
        });
      });
      // 更直接的一条：规范化后的块，字段集必须跟空白块**逐字一致**
      const keysOf = o => Object.keys(o).sort().join(',');
      const a = keysOf(stBlankSbBlock('bar'));
      const c = stSbUserPrefabs()[0].blocks[0];
      return { same: keysOf(c) === keysOf(stBlankSbBlock(c.type)) || keysOf(c) === a,
        got: keysOf(c) }; })()`);
    check('规范化后的块字段集 == 空白块（白名单没有漏字段）', h4.same, true);
    await ev(`localStorage.removeItem(ST_SB_PF_KEY); stSbPfCache = null; stRerender();`);

    // ============ I. 窄屏 ============
    console.log('\n== I. 窄屏 ==');
    await cdp.send('Emulation.setDeviceMetricsOverride',
      { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, SID);
    await sleep(350);
    const i1 = await ev(`(() => {
      const panel = document.querySelector('.st-sb-layers');
      const bs = [...document.querySelectorAll('[onclick^="stSbAddPrefab("]')];
      const rects = bs.map(b => b.getBoundingClientRect());
      const mine = [...document.querySelectorAll('.st-sb-pf-item .st-mini')];
      return { n: bs.length, zero: rects.filter(r => r.height === 0).length,
        minH: Math.min.apply(null, rects.map(r => r.height)),
        panelW: panel ? panel.getBoundingClientRect().width : 0,
        mineZero: mine.filter(b => b.getBoundingClientRect().height === 0).length,
        inputH: (document.getElementById('st-sb-pf-name') || { getBoundingClientRect: () => ({ height: 0 }) })
          .getBoundingClientRect().height }; })()`);
    check('窄屏下预制块按钮一个不少', i1.n, pfN);
    check('⚠ 没有 0 高的（0 高 = 元素不可见，不是「尺寸不达标」）', i1.zero, 0);
    check('  对照组：整个块库面板是可见的', i1.panelW, v => v > 0, '>0');
    check('  点击目标 ≥ 32px（手机上手点得准）', i1.minH, v => v >= 32, '>=32');
    check('  名字输入框也够高', i1.inputH, v => v >= 28, '>=28');
    await cdp.send('Emulation.setDeviceMetricsOverride',
      { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, SID);
    await sleep(250);

    // ============ J. 收尾 ============
    console.log('\n== J. 收尾 ==');
    check('整轮无 console 错误 / 未捕获异常',
      consoleErrors.filter(x => !/favicon/i.test(x)), v => v.length === 0, '[]');

  } catch (err) {
    fail++; fails.push('FATAL: ' + err.message);
    console.log('\n💥 ' + err.stack);
  } finally {
    try { srv && srv.close(); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
    await sleep(200);
    // ⚠ profile 目录要自己删 —— 不删的话每跑一次就多一个（实测堆到 873 个 / 14.5 GB）。
    //   放在 sleep 之后：进程刚 kill 掉时目录还锁着，等它退干净再删。
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); } catch (e) {}
  }

  console.log(`\n===== 第八轮（预制块）：${pass} 通过 / ${fail} 失败 =====`);
  if (fails.length) console.log('失败项：\n  - ' + fails.join('\n  - '));
  process.exit(fail ? 1 : 0);
})();
