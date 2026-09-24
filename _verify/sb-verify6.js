// 第六轮：**自由摆放** —— 块能随手拖到任何地方，小到 1px 都能挪
//
// 这一轮跟第五轮的「按运行时规则解析」是配套的：偏移必须**同时**满足两条
//   ① 在编辑器里随手拖、随手改（鼠标拖 / 方向键 / 面板填数字）
//   ② 生成物里的写法在运行时那边是**只挪自己**的 —— 相对定位，不脱流，
//      后面的块一动不动（绝对定位会把整张排版砸了）
//   ③ 没挪过的块**一个字节都不写** —— 第五轮那套逐字节 / 逐像素对照不能被它动到
//
// 十段：
//   A. 开关与默认值：默认自由摆放；两套手势互斥（原生拖放主动让位）
//   B. 零偏移 = 零字节
//   C. 真指针拖动（合成 PointerEvent）：3px 阈值、实时跟手、落库、写回正则
//   D. Shift 吸附 8px 网格
//   E. 方向键 1px / Shift+方向键 10px / Escape 取消选中
//   F. 归位 + 全部归位（回到零字节）
//   G. 解析别人的卡：left / top 读得回来；static / absolute 上的 left 不能误读；
//      高级 HTML 块的定位壳不能越套越多
//   H. 挪过位置之后，第五轮那套判定和自检一条都不能塌
//   I. 草稿往返
//   J. 收尾零报错
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-sb5-'));
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
        window.confirm = function (m) { window.__dlg.push(String(m)); return true; };`
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
    await ev(`stMvuQuickAdd(0)`);
    await ev(`stSwitchTab('sb')`);
    await sleep(250);

    // 先铺一版模板 —— 后面几段都要在「画布上有块」的前提下跑。
    // 这时画布是空的，stSbApplyTemplate 不会弹确认
    await ev(`stSbApplyTemplate(0)`);
    await sleep(200);

    // ============ A. 开关与默认值 ============
    console.log('\n== A. 自由摆放开关 ==');
    const a = await ev(`(() => {
      const btns = Array.prototype.slice.call(
        document.querySelectorAll('.st-sb-cvbar button')).map(b => b.textContent.trim());
      return {
        on: stSbFreeOn(),
        n: stEditor.card.statusBar.blocks.length,
        stageFree: !!document.querySelector('#st-sb-canvas .st-sb-stage.st-sb-free'),
        draggable: document.querySelector('#st-sb-canvas [data-sb]').getAttribute('draggable'),
        btns: btns
      };
    })()`);
    check('模板铺出了块', a.n, v => Number(v) >= 3, '>=3');
    check('默认就是自由摆放', a.on, true);
    check('舞台带上了自由摆放的标记（光标 = move）', a.stageFree, true);
    check('自由摆放时 draggable 关掉（原生拖放让位）', a.draggable, 'false');
    check('画布顶上有开关 + 归位 + 尺寸复原三个按钮', a.btns.length, 3);
    check('开关按钮上写着「自由摆放：开」',
      a.btns[0], v => String(v).indexOf('自由摆放：开') >= 0, '含「自由摆放：开」');
    check('  → 另两个是「全部归位」和「尺寸复原」', a.btns.slice(1).join('|'),
      v => /归位/.test(v) && /尺寸复原/.test(v), '含「归位」与「尺寸复原」');

    // 关掉 → 结构排序回来
    const a2 = await ev(`(() => {
      stSbFreeSet(false);
      const el = document.querySelector('#st-sb-canvas [data-sb]');
      const e2 = new DragEvent('dragstart', { bubbles: true, cancelable: true,
        dataTransfer: new DataTransfer() });
      el.dispatchEvent(e2);
      const got = { dragId: stSbDragId, prevented: e2.defaultPrevented,
        draggable: el.getAttribute('draggable'), free: stSbFreeOn(),
        stageFree: !!document.querySelector('#st-sb-canvas .st-sb-stage.st-sb-free') };
      stSbDragEnd();
      return got;
    })()`);
    check('关掉之后不再是自由摆放', a2.free, false);
    check('  → draggable 回到 true', a2.draggable, 'true');
    check('  → 舞台上的标记也撤了', a2.stageFree, false);
    check('  → dragstart 真的接住了（记下了拖的是谁）', a2.dragId, v => !!v, 'non-empty');
    check('  → 而且没有被 preventDefault 挡掉', a2.prevented, false);

    // 开着的时候 dragstart 必须被拦住 —— 两道闸都留着的话，
    // 拖一下会「既挪位置又换顺序」，没人能预期那是什么结果
    const a3 = await ev(`(() => {
      stSbFreeSet(true);
      const el = document.querySelector('#st-sb-canvas [data-sb]');
      const e2 = new DragEvent('dragstart', { bubbles: true, cancelable: true,
        dataTransfer: new DataTransfer() });
      el.dispatchEvent(e2);
      return { prevented: e2.defaultPrevented, dragId: stSbDragId };
    })()`);
    check('自由摆放时 dragstart 被拦下', a3.prevented, true);
    check('  → 没记下拖拽状态（不会跟指针拖动打架）', a3.dragId, v => !v, 'falsy');

    // 开关会跟着草稿走
    const a4 = await ev(`(() => {
      stSbFreeSet(false);
      const saved = JSON.parse(localStorage.getItem(ST_DRAFT_KEY) || '{}');
      return saved.sbFree;
    })()`);
    check('关掉之后草稿里记着 sbFree=false', a4, false);
    await ev(`stSbFreeSet(true)`);
    check('开回来', await ev(`stSbFreeOn()`), true);

    // ============ B. 零偏移 = 零字节 ============
    console.log('\n== B. 没挪过的块：一个字节都不写 ==');
    const b = await ev(`(() => {
      const sb = stEditor.card.statusBar;
      const theme = sb.theme;
      // 每个块**单独**生成一遍，看它最外层有没有 left / top。
      // 只看最外层 —— dots 内部那层 span 本来就有 left:0;top:0（叠层裁切），
      // 拿整篇去 indexOf 会把它误当成「偏移」
      const walk = list => list.reduce((acc, x) => acc.concat([x], walk(x.children || [])), []);
      const all = walk(sb.blocks);
      const offCss = all.map(x => stSbOffCss(x)).filter(v => v);
      const outerOff = all.filter(x => {
        const doc = new DOMParser().parseFromString(
          '<body>' + stSbBlockHtml(x, false, theme) + '</body>', 'text/html');
        const el = doc.body.firstElementChild;
        const st = el ? String(el.getAttribute('style') || '') : '';
        return /(?:^|;)\\s*(left|top)\\s*:/.test(st);
      }).length;
      return { n: all.length, offCss: offCss.length, outerOff: outerOff,
        hasPos: stSbDocHtml().indexOf('position:relative;left:') >= 0 };
    })()`);
    check('模板生成了块', b.n, v => Number(v) >= 3, '>=3');
    check('每一块的偏移 CSS 都是空的', b.offCss, 0);
    check('每一块最外层都没有 left / top', b.outerOff, 0);
    check('整篇产物里没有 position:relative;left:（偏移那句没冒出来）', b.hasPos, false);

    // ============ C. 真指针拖动 ============
    console.log('\n== C. 拖着块走（真指针事件） ==');
    const c = await ev(`(() => {
      const sb = stEditor.card.statusBar;
      const id = sb.blocks[0].id;
      // 先选中 —— 属性面板里那两格只有选中了才在
      stSbSelect(id, true);
      const el = document.querySelector('#st-sb-canvas [data-sb="' + id + '"]');
      if (!el) return { err: 'no-el' };
      const r = el.getBoundingClientRect();
      const x0 = Math.round(r.left + 20), y0 = Math.round(r.top + 10);
      const mk = (t, x, y, extra) => new PointerEvent(t, Object.assign({
        bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse',
        isPrimary: true, button: 0, buttons: 1, clientX: x, clientY: y
      }, extra || {}));
      // 1) 只是点一下（没超过 3px 阈值）→ 不该动
      el.dispatchEvent(mk('pointerdown', x0, y0));
      el.dispatchEvent(mk('pointermove', x0 + 2, y0 + 1));
      el.dispatchEvent(mk('pointerup', x0 + 2, y0 + 1));
      const afterTap = { x: stSbBlockById(id).offX, y: stSbBlockById(id).offY };
      // 2) 真拖：+25 / +14
      el.dispatchEvent(mk('pointerdown', x0, y0));
      el.dispatchEvent(mk('pointermove', x0 + 25, y0 + 14));
      const mid = document.querySelector('#st-sb-canvas [data-sb="' + id + '"]');
      const midStyle = mid.getAttribute('style') || '';
      el.dispatchEvent(mk('pointerup', x0 + 25, y0 + 14));
      const blk = stSbBlockById(id);
      const doc = stSbDocHtml();
      const now = document.querySelector('#st-sb-canvas [data-sb="' + id + '"]');
      const wid = stSbDomId(id).replace(/^st-/, '');
      return {
        afterTap: afterTap, x: blk.offX, y: blk.offY, midStyle: midStyle,
        inDoc: doc.indexOf('position:relative;left:25px;top:14px') >= 0,
        badge: (now.querySelector('.st-sb-badge') || {}).textContent || '',
        offClass: now.classList.contains('st-sb-off'),
        inspX: (document.getElementById('st-' + wid + '-offx') || {}).value,
        inspY: (document.getElementById('st-' + wid + '-offy') || {}).value
      };
    })()`);
    check('找得到画布上的块', c.err, undefined, undefined);
    check('3px 以内只是点击，块不动', JSON.stringify(c.afterTap), '{"x":0,"y":0}');
    check('拖了 +25 / +14 → offX 落库', c.x, 25);
    check('  → offY 落库', c.y, 14);
    check('  → 拖动过程中就实时跟着走（没等松手）',
      c.midStyle, v => /left:\s*25px/.test(String(v)) && /top:\s*14px/.test(String(v)),
      'left:25px;top:14px');
    check('  → 写进卡里那条正则了', c.inDoc, true);
    check('  → 徽章上标着偏移', c.badge, v => String(v).indexOf('⇱ +25,+14') >= 0, '含「⇱ +25,+14」');
    check('  → 块被打上「挪过位置」的标记', c.offClass, true);
    check('  → 属性面板 X 跟着变', c.inspX, '25');
    check('  → 属性面板 Y 跟着变', c.inspY, '14');

    // 负方向
    const c2 = await ev(`(() => {
      const id = stEditor.card.statusBar.blocks[0].id;
      stSbNudge(id, -30, -20);
      const blk = stSbBlockById(id);
      return { x: blk.offX, y: blk.offY,
        inDoc: stSbDocHtml().indexOf('left:-5px;top:-6px') >= 0 };
    })()`);
    check('往左上挪得出负值', JSON.stringify(c2), '{"x":-5,"y":-6,"inDoc":true}');

    // ============ D. Shift 吸附 8px 网格 ============
    console.log('\n== D. 按住 Shift 拖 = 吸附 8px 网格 ==');
    const d = await ev(`(() => {
      const id = stEditor.card.statusBar.blocks[0].id;
      stSbOffReset(id);
      const el = document.querySelector('#st-sb-canvas [data-sb="' + id + '"]');
      const r = el.getBoundingClientRect();
      const x0 = Math.round(r.left + 20), y0 = Math.round(r.top + 10);
      const mk = (t, x, y, extra) => new PointerEvent(t, Object.assign({
        bubbles: true, cancelable: true, pointerId: 8, pointerType: 'mouse',
        isPrimary: true, button: 0, buttons: 1, clientX: x, clientY: y
      }, extra || {}));
      el.dispatchEvent(mk('pointerdown', x0, y0));
      el.dispatchEvent(mk('pointermove', x0 + 30, y0 + 20, { shiftKey: true }));
      el.dispatchEvent(mk('pointerup', x0 + 30, y0 + 20, { shiftKey: true }));
      const blk = stSbBlockById(id);
      return { x: blk.offX, y: blk.offY };
    })()`);
    check('30 → 32（8 的倍数）', d.x, 32);
    check('20 → 24（8 的倍数）', d.y, 24);

    // ============ E. 方向键微调 ============
    console.log('\n== E. 方向键 1px / Shift+方向键 10px ==');
    const e = await ev(`(() => {
      const id = stEditor.card.statusBar.blocks[0].id;
      stSbOffReset(id);
      stSbSelect(id, true);
      const el = document.querySelector('#st-sb-canvas [data-sb="' + id + '"]');
      const key = (k, extra) => {
        const ev2 = new KeyboardEvent('keydown', Object.assign({
          key: k, bubbles: true, cancelable: true
        }, extra || {}));
        el.dispatchEvent(ev2);
        return ev2.defaultPrevented;
      };
      const steps = [];
      const rec = () => { const x = stSbBlockById(id); steps.push(x.offX + ',' + x.offY); };
      const focused = document.activeElement ===
        document.querySelector('#st-sb-canvas .st-sb-stage');
      key('ArrowRight'); rec();
      key('ArrowRight'); rec();
      key('ArrowDown'); rec();
      const prevented = key('ArrowLeft');
      rec();
      key('ArrowRight', { shiftKey: true }); rec();
      key('ArrowUp', { shiftKey: true }); rec();
      key('ArrowUp', { shiftKey: true }); rec();
      key('Escape');
      return { steps: steps, prevented: prevented, focused: focused, sel: stEditor.sbSel };
    })()`);
    check('点块之后焦点落在舞台（方向键才接得到）', e.focused, true);
    check('→ 两次：X = 2', e.steps[1], '2,0');
    check('↓ 一次：Y = 1', e.steps[2], '2,1');
    check('← 一次：X = 1', e.steps[3], '1,1');
    check('方向键被拦下（页面不会跟着滚）', e.prevented, true);
    check('Shift+→：X = 11（10px 一档）', e.steps[4], '11,1');
    check('Shift+↑ 两次：Y = -19', e.steps[6], '11,-19');
    check('Escape 取消选中', e.sel, '');

    // ============ F. 归位 ============
    console.log('\n== F. 归位 ==');
    const f = await ev(`(() => {
      const sb = stEditor.card.statusBar;
      sb.blocks[0].offX = 12; sb.blocks[0].offY = -9;
      stSbSync(); stSbPaintCanvas();
      const before = stSbDocHtml().indexOf('position:relative;left:12px;top:-9px') >= 0;
      const id = sb.blocks[0].id;
      stSbOffReset(id);
      const blk = stSbBlockById(id);
      const doc = stSbDocHtml();
      const one = new DOMParser().parseFromString(
        '<body>' + stSbBlockHtml(blk, false, sb.theme) + '</body>', 'text/html');
      const outer = one.body.firstElementChild;
      return { before: before, x: blk.offX, y: blk.offY, offCss: stSbOffCss(blk),
        outerStyle: outer ? String(outer.getAttribute('style') || '') : '',
        stillInDoc: doc.indexOf('position:relative;left:12px') >= 0 };
    })()`);
    check('归位前产物里确实有那两条', f.before, true);
    check('归位后 offX / offY 都回 0', JSON.stringify({ x: f.x, y: f.y }), '{"x":0,"y":0}');
    check('  → 偏移 CSS 空掉了', f.offCss, '');
    check('  → 块最外层没有 left / top 了',
      /(?:^|;)\s*(left|top)\s*:/.test(f.outerStyle), false, f.outerStyle);
    check('  → 产物里也找不到了', f.stillInDoc, false);

    // 全部归位
    const f2 = await ev(`(() => {
      const sb = stEditor.card.statusBar;
      const walk = l => l.reduce((a, x) => a.concat([x], walk(x.children || [])), []);
      const all = walk(sb.blocks);
      all.forEach((x, i) => { x.offX = i + 1; x.offY = -(i + 1); });
      stSbSync(); stSbPaintCanvas();
      const n0 = all.filter(x => stSbOffNum(x.offX) || stSbOffNum(x.offY)).length;
      stSbOffResetAll();
      const after = walk(sb.blocks);
      return { n0: n0, left: after.filter(x => stSbOffNum(x.offX) || stSbOffNum(x.offY)).length,
        inDoc: /position:relative;left:/.test(stSbDocHtml()) };
    })()`);
    check('先把所有块都挪歪', f2.n0, v => Number(v) >= 3, '>=3');
    check('全部归位之后一个歪的都不剩', f2.left, 0);
    check('  → 产物里回到零字节', f2.inDoc, false);

    // ============ G. 解析回读：手写稿里的偏移 ============
    console.log('\n== G. 解析别人的卡：left / top 读得回来 ==');
    const g = await ev(`(() => {
      const raw = '<!doctype html><html><head><meta charset="utf-8"></head><body>\\n' +
        '<div style="border:1px solid #5a3f6b;border-radius:10px;padding:9px 11px;' +
        'color:#f0e6f5;font-size:13px;line-height:1.6;box-sizing:border-box;text-align:left">\\n' +
        '<div style="position:relative;left:8px;top:-4px;font-size:13px;color:#f0e6f5;' +
        'text-align:left;margin:3px 0;white-space:pre-wrap;line-height:1.6">' +
        'HP {{format_message_variable::stat_data.生命}}</div>\\n' +
        '</div>\\n</body></html>';
      const p = stSbParseDoc(raw);
      if (!p.ok) return { ok: false, why: p.why };
      const sb = stStatusBarFromRaw({
        theme: p.theme, width: p.width, shellExtra: p.shellExtra, shellCls: p.shellCls,
        shellOff: p.shellOff, blocks: p.blocks, pre: '', post: '' });
      const blk = sb.blocks[0];
      const gen = stSbBodyHtml(sb, false);
      return { ok: true, keepOk: p.keepOk, textOk: p.textOk, type: blk.type,
        x: blk.offX, y: blk.offY, extra: String(blk.extra || ''),
        inGen: gen.indexOf('position:relative;left:8px;top:-4px') >= 0,
        offInExtra: /(?:^|;)\\s*(left|top|position)\\s*:/.test(String(blk.extra || '')) };
    })()`);
    check('解析成功', g.ok, true, g.why);
    check('保留声明自检通过', g.keepOk, true);
    check('文字对得上', g.textOk, true);
    check('认成文字块', g.type, 'text');
    check('left:8px 读进了 offX', g.x, 8);
    check('top:-4px 读进了 offY', g.y, -4);
    check('  → extra 里**没有**重复记这两条', g.offInExtra, false, g.extra);
    check('重新生成时偏移还在', g.inGen, true);

    // 边界：静态元素上的 left 是**无效**的，不能读成偏移
    // （读成偏移等于我们凭空加一句 position:relative，把原本无效的 left 变有效）
    const g2 = await ev(`(() => {
      const wrap = body =>
        '<!doctype html><html><head><meta charset="utf-8"></head><body>\\n' +
        '<div style="border:1px solid #5a3f6b;border-radius:10px;padding:9px 11px;' +
        'color:#f0e6f5;font-size:13px;line-height:1.6;box-sizing:border-box;text-align:left">\\n' +
        body + '\\n</div>\\n</body></html>';
      const text = '<div style="%S%font-size:13px;color:#f0e6f5;text-align:left;' +
        'margin:3px 0;white-space:pre-wrap;line-height:1.6">HP ' +
        '{{format_message_variable::stat_data.生命}}</div>';
      const run = (style, probe) => {
        const p = stSbParseDoc(wrap(text.replace('%S%', style)));
        const sb = stStatusBarFromRaw({ theme: p.theme, width: p.width,
          shellExtra: p.shellExtra, shellCls: p.shellCls, shellOff: p.shellOff,
          blocks: p.blocks, pre: '', post: '' });
        const blk = sb.blocks[0];
        const gen = stSbBodyHtml(sb, false);
        return { x: blk.offX, y: blk.offY, keepOk: p.keepOk,
          kept: gen.indexOf(probe) >= 0,
          wrapped: gen.indexOf('position:relative') >= 0 };
      };
      return {
        stat: run('left:8px;', 'left:8px'),
        abs: run('position:absolute;left:40px;top:5px;', 'left:40px')
      };
    })()`);
    check('static 元素上的 left:8px 不当偏移（offX 保持 0）', g2.stat.x, 0);
    check('  → 但原样保住了（没被悄悄丢掉）', g2.stat.kept, true);
    check('  → 也没给它凭空加 position:relative', g2.stat.wrapped, false);
    check('absolute 定位不当偏移（那是脱流写法）', g2.abs.x, 0);
    check('  → left:40px 原样留着', g2.abs.kept, true);
    check('  → 自检也通过', g2.abs.keepOk, true);

    // 高级 HTML 块：挪过位置的壳不能越套越多
    const g3 = await ev(`(() => {
      const raw = '<!doctype html><html><head><meta charset="utf-8"></head><body>\\n' +
        '<div style="border:1px solid #5a3f6b;border-radius:10px;padding:9px 11px;' +
        'color:#f0e6f5;font-size:13px;line-height:1.6;box-sizing:border-box;text-align:left">\\n' +
        '<div style="position:relative;left:8px">' +
        '<table style="width:100%"><tr><td>甲</td></tr></table></div>\\n' +
        '</div>\\n</body></html>';
      const mkSb = p => stStatusBarFromRaw({ theme: p.theme, width: p.width,
        shellExtra: p.shellExtra, shellCls: p.shellCls, shellOff: p.shellOff,
        blocks: p.blocks, pre: '', post: '' });
      const p1 = stSbParseDoc(raw);
      const sb1 = mkSb(p1);
      const b1 = sb1.blocks[0];
      const gen1 = stSbBodyHtml(sb1, false);
      // 再解析一遍生成物 —— 壳要是没拆干净，偏移会翻倍（8 → 16）
      const p2 = stSbParseDoc(stSbFencedDoc(stSbMarkOf(sb1) + gen1));
      const sb2 = mkSb(p2);
      const b2 = sb2.blocks[0];
      const gen2 = stSbBodyHtml(sb2, false);
      const cnt = (s, n) => (s.split('position:relative;left:' + n + 'px').length - 1);
      return { type1: b1.type, x1: b1.offX, type2: b2.type, x2: b2.offX,
        c1: cnt(gen1, 8), c2: cnt(gen2, 8), d2: cnt(gen2, 16),
        hasTable1: gen1.indexOf('<table') >= 0, hasTable2: gen2.indexOf('<table') >= 0 };
    })()`);
    check('带定位壳的表格 → 高级 HTML 块', g3.type1, 'html');
    check('  → 壳拆掉了，偏移交给块（offX=8）', g3.x1, 8);
    check('  → 表格内容没丢', g3.hasTable1, true);
    check('  → 产物里只有一层定位壳', g3.c1, 1);
    check('再解析一遍 → 偏移不翻倍', g3.x2, 8);
    check('  → 也没有 16px 那种叠出来的偏移', g3.d2, 0);
    check('  → 还是高级块', g3.type2, 'html');
    check('  → 壳还是一层', g3.c2, 1);
    check('  → 表格还在', g3.hasTable2, true);

    // ============ H. 挪过位置之后，原样解析不受影响 ============
    console.log('\n== H. 挪位置不破坏「按运行时规则解析」 ==');
    const h = await ev(`(() => {
      const sb = stEditor.card.statusBar;
      sb.blocks[0].offX = 7;
      sb.blocks[0].offY = 3;
      stSbSync();
      const doc = stSbDocHtml();
      const rt = stSbRuntimeInfo(doc);
      const p = stSbParseDoc(doc);
      const back = stStatusBarFromRaw({
        theme: p.theme, width: p.width, shellExtra: p.shellExtra, shellCls: p.shellCls,
        shellOff: p.shellOff, blocks: p.blocks, pre: p.runtime.pre, post: p.runtime.post });
      const blk = back.blocks[0];
      return {
        live: rt.live.length, ok: p.ok, keepOk: p.keepOk, textOk: p.textOk,
        runtimeOk: p.runtime.ok, x: blk.offX, y: blk.offY,
        extraHasOff: /(?:^|;)\\s*(left|top)\\s*:/.test(String(blk.extra || '')),
        same: stSbBodyHtml(back, false) === stSbBodyHtml(sb, false),
        detect: stSbDetect().state
      };
    })()`);
    check('产物仍然是运行时认的那一段', h.live, 1);
    check('解析成功', h.ok, true);
    check('  → 运行时判定合格', h.runtimeOk, true);
    check('  → 保留声明自检通过', h.keepOk, true);
    check('  → 文字对得上', h.textOk, true);
    check('  → 偏移读得回来', JSON.stringify({ x: h.x, y: h.y }), '{"x":7,"y":3}');
    check('  → 没有跑进 extra', h.extraHasOff, false);
    check('  → 重新生成逐字节相同', h.same, true);
    check('  → 卡里那条还认得出是本编辑器画的', h.detect, 'mine');

    // 真机预览里也该有偏移（预览跟写进卡里的是同一套包装）
    //
    // 这里**必须轮询**，不能睡一觉就定案：改了 srcdoc 之后 iframe 是整篇重载的，
    // 新文档还没解析完的时候求值会「成功但拿到空 body」。frameEval 只在**抛异常**
    // 时才重试，返回 null 它认为是正经答案 —— 于是就成了随机翻车
    await ev(`(() => { stEditor.card.statusBar.blocks[0].offX = 40;
      stEditor.card.statusBar.blocks[0].offY = 6; stSbSync(); stSbPaintCanvas(); })()`);
    let h2 = null;
    for (let i = 0; i < 30; i++) {
      await sleep(200);
      h2 = await frameEval(`(() => {
        const el = document.body ? document.body.querySelector('[style*="left:40px"]') : null;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return { left: cs.left, top: cs.top, pos: cs.position, w: Math.round(r.width) };
      })()`).catch(() => null);
      if (h2 && h2.pos === 'relative') break;
    }
    check('真机预览里那块也挪了', h2, v => !!v && v.pos === 'relative', 'position:relative');
    if (h2) {
      check('  → left 是 40px', h2.left, '40px');
      check('  → top 是 6px', h2.top, '6px');
    }
    await shot('sb6-free.png', '.st-sb-canvas-wrap');

    // ============ I. 草稿往返 ============
    console.log('\n== I. 存了再读，偏移还在 ==');
    const i1 = await ev(`(() => {
      stSaveDraft();
      const saved = JSON.parse(localStorage.getItem(ST_DRAFT_KEY) || '{}');
      const b0 = saved.card.statusBar.blocks[0];
      return { x: b0.offX, y: b0.offY, free: saved.sbFree };
    })()`);
    check('草稿里记着 offX', i1.x, 40);
    check('草稿里记着 offY', i1.y, 6);
    check('草稿里记着自由摆放是开着的', i1.free, true);

    let loaded2 = new Promise(res => cdp.on('Page.loadEventFired', res));
    await cdp.send('Page.reload', {}, SID);
    await loaded2;
    await ev(`document.fonts.ready.then(() => true)`, true);
    await sleep(700);
    await ev('openStEditor()');
    await ev(`stSwitchTab('sb')`);
    await sleep(300);
    const i2 = await ev(`(() => {
      const b0 = stEditor.card.statusBar.blocks[0];
      return { x: b0.offX, y: b0.offY, free: stSbFreeOn(),
        inDoc: stSbDocHtml().indexOf('position:relative;left:40px;top:6px') >= 0,
        draggable: document.querySelector('#st-sb-canvas [data-sb]').getAttribute('draggable') };
    })()`);
    check('重开之后 offX 还在', i2.x, 40);
    check('  → offY 还在', i2.y, 6);
    check('  → 自由摆放还是开着的', i2.free, true);
    check('  → draggable 也还是 false', i2.draggable, 'false');
    check('  → 产物里的偏移也在', i2.inDoc, true);

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
    try { require('child_process').spawn(process.execPath, ['-e', 'require("fs").rmSync(process.argv[1],{recursive:true,force:true,maxRetries:0})', profile], { detached: true, stdio: 'ignore' }).unref(); } catch (e) {}
  }

  console.log(`\n===== 第六轮（自由摆放）：${pass} 通过 / ${fail} 失败 =====`);
  if (fails.length) console.log('失败项：\n  - ' + fails.join('\n  - '));
  process.exit(fail ? 1 : 0);
})();
