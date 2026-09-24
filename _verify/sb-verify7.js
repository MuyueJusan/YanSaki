// 第七轮：**调整大小** —— 块能拖把手改尺寸，小到 1px 都能改
//
// 跟第六轮（自由摆放）是配套的：位置和大小都得能随手调，而且**都不能弄脏产物**。
// 这一轮要证的三件事：
//   ① 面板两格 + 画布八向把手，改起来跟 PPT 一样（拖角 / 拖边 / Shift 吸附 / 方向键）
//   ② 没调过大小的块**一个字节都不多** —— 第六轮那套逐字节 / 逐像素对照不能被它动到
//   ③ 调完之后「按运行时规则解析」那套一个字都不能坏，而且**画布上的宽 = 玩家看到的宽**
//
// 十二段：
//   A. 面板两格 + 八向把手（只在选中那块上）；关掉自由摆放把手收起
//   B. 零尺寸 = 零字节（产物 + 再解析 + 逐字节自往返）
//   C. 拖东 / 南边：只长自己，另一轴保持自适应
//   D. 拖西 / 北边：位置跟着走，对边一动不动；拖过头夹在下限
//   E. 按住 Shift 拖 = 吸附 8px 网格
//   F. Alt+方向键改尺寸（1px / Shift 十档）；不带 Alt 仍然只挪位置
//   G. 恢复默认尺寸 / 全部归位 —— 两件事互不干扰
//   H. 解析别人的卡：px 读得回来；% / calc 原样带走；分割线那句 height:1px 是
//      生成器自己写的，不能误读；height:2px 才收进 h
//   I. 挪 + 调大小之后，第五轮那套判定与自检一条都不塌；真机预览也跟着变
//   J. **画布上的宽 == 真机预览里的宽**（带内边距的块也要对上）
//   K. 草稿往返
//   L. 收尾零报错
//
// 跑法：node sb-verify7.js
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

    // 页面内的小工具：真的按下把手、真的拖、真的松手。
    // 用合成 PointerEvent 而不是 CDP 的 Input.* —— 后者要先把坐标换算到
    // 视口，画布还会滚动，算错一次就是「拖到了别的地方」，很难查
    await ev(`window.__rsz = function (dir, dx, dy, shift) {
      const b = stSbSelected().block;
      const hitOf = () => stSbCanvasHitOf(b);
      const hit0 = hitOf();
      if (!hit0) return { err: '找不到命中框' };
      const h = hit0.querySelector('.st-sb-h[data-h="' + dir + '"]');
      if (!h) return { err: '没有 ' + dir + ' 方向的把手' };
      const r = h.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const fire = (type, cx, cy, extra) => h.dispatchEvent(new PointerEvent(type,
        Object.assign({ bubbles: true, cancelable: true, clientX: cx, clientY: cy,
          pointerId: 7, pointerType: 'mouse', button: 0, buttons: 1 }, extra || {})));
      const el = () => stSbCanvasEl(hitOf(), b);
      const rd = v => Math.round(v * 100) / 100;
      const box = () => {
        const e = el();
        if (!e) return null;
        const q = e.getBoundingClientRect();
        return { w: rd(q.width), h: rd(q.height), left: rd(q.left),
          right: rd(q.right), top: rd(q.top) };
      };
      const model = () => {
        const k = stSbSizeKeys(b);
        return { w: b[k.w], h: k.space ? b.height : b.h, x: b.offX, y: b.offY,
          style: el() ? (el().getAttribute('style') || '') : '' };
      };
      const before = { box: box(), model: model(),
        gw: Math.round(stSbMeasureEl(el(), 'w')),
        gh: Math.round(stSbMeasureEl(el(), 'h')) };
      fire('pointerdown', x, y);
      fire('pointermove', x + dx, y + dy, { shiftKey: !!shift });
      const mid = { box: box(), model: model() };
      fire('pointerup', x + dx, y + dy, { shiftKey: !!shift });
      return { before: before, mid: mid, after: { box: box(), model: model() },
        doc: stSbDocHtml() };
    };`);

    // ============ A. 面板与把手 ============
    console.log('\n== A. 尺寸字段与八向把手 ==');
    // 先选上第一块 —— 把手只在选中那块上渲染，后面几段都要有选中态
    await ev(`(() => { const b = stEditor.card.statusBar.blocks[0]; stSbSelect(b.id, true); })()`);
    await sleep(120);
    const a = await ev(`(() => {
      const b = stSbSelected().block;
      const k = stSbSizeKeys(b);
      const ids = ['-w', '-h'].map(s => {
        const el = document.getElementById('st-' + stSbDomId(b.id).replace(/^st-/, '') + s);
        return el ? el.value : null;
      });
      return { type: b.type, wKey: k.w, hKey: k.h, space: k.space,
        hasW: !!document.getElementById('st-' +
          stSbDomId(b.id).replace(/^st-/, '') + '-w'),
        hasH: !!document.getElementById('st-' +
          stSbDomId(b.id).replace(/^st-/, '') + '-h'),
        vals: ids, css: stSbSizeCss(b), label: stSbSizeLabel(b),
        w: stSbSizeNum(b.w), h: stSbSizeNum(b.h) };
    })()`);
    check('选中块的属性面板有「宽 W」那一格', a.hasW, true);
    check('  → 也有「高 H」', a.hasH, true);
    check('  → 两格默认都是 0', a.vals.join(','), '0,0');
    check('没调过大小 → 尺寸 CSS 是空的', a.css, '');
    check('  → 徽章上也不挂尺寸标签', a.label, '');

    // 八向把手：只在选中那一块上
    const a2 = await ev(`(() => {
      const sel = stSbSelected().block;
      const dirs = Array.prototype.slice.call(
        document.querySelectorAll('#st-sb-canvas .st-sb-h'))
        .map(e => e.getAttribute('data-h'));
      const selHit = stSbCanvasHitOf(sel);
      const onSel = Array.prototype.slice.call(selHit.querySelectorAll('.st-sb-h'))
        .map(e => e.getAttribute('data-h'));
      // 别的块上一个都没有
      let others = 0;
      stEditor.card.statusBar.blocks.forEach(b => {
        if (b.id === sel.id) return;
        const hit = stSbCanvasHitOf(b);
        if (hit) others += hit.querySelectorAll('.st-sb-h').length;
      });
      return { n: dirs.length, onSel: onSel.sort().join(','), others: others,
        cls: !!document.querySelector('#st-sb-canvas .st-sb-hit.st-sb-on') };
    })()`);
    check('选中的块上正好八个把手', a2.n, 8);
    check('  → 八向齐全（四角 + 四边）', a2.onSel, 'e,n,ne,nw,s,se,sw,w');
    check('  → 别的块上一个都没有（八个小方块铺满画布会糊掉）', a2.others, 0);

    // 关掉自由摆放 → 把手收起来
    const a3 = await ev(`(() => {
      stSbFreeSet(false);
      const n = document.querySelectorAll('#st-sb-canvas .st-sb-h').length;
      stSbFreeSet(true);
      return { off: n, back: document.querySelectorAll('#st-sb-canvas .st-sb-h').length };
    })()`);
    check('关掉自由摆放 → 把手全收起来', a3.off, 0);
    check('  → 开回来又有了', a3.back, 8);

    // ============ B. 零尺寸 = 零字节 ============
    console.log('\n== B. 没调过大小 → 产物里一个字节都不多 ==');
    const bz = await ev(`(() => {
      const sb = stEditor.card.statusBar;
      const css = [];
      (function walk(l) {
        (l || []).forEach(x => { css.push(stSbSizeCss(x)); walk(x.children); });
      })(sb.blocks);
      const doc = stSbDocHtml();
      const p = stSbParseDoc(doc);
      const back = stStatusBarFromRaw({ theme: p.theme, width: p.width,
        shellExtra: p.shellExtra, shellCls: p.shellCls, shellOff: p.shellOff,
        blocks: p.blocks, pre: p.runtime.pre, post: p.runtime.post });
      const w = [];
      (function walk2(l) {
        (l || []).forEach(x => { w.push([x.w, x.h]); walk2(x.children); });
      })(back.blocks);
      return { n: sb.blocks.length, empties: css.filter(s => !s).length,
        anyW: w.filter(p2 => p2[0] || p2[1]).length,
        same: stSbBodyHtml(back, false) === stSbBodyHtml(sb, false),
        live: stSbRuntimeInfo(doc).live.length };
    })()`);
    check('画布上有块', bz.n, v => Number(v) >= 3, '>=3');
    check('每一块的尺寸 CSS 都是空的', bz.empties, bz.n);
    check('产物仍是运行时认的那一段', bz.live, 1);
    check('再解析一遍 → 没有一块被误读出尺寸', bz.anyW, 0);
    check('  → 重新生成逐字节相同', bz.same, true);

    // ============ C. 东 / 南边：只长自己 ============
    console.log('\n== C. 拖东边 / 南边：只长，不动位置 ==');
    // 注意断言的是「起始宽 + 位移」而不是「位移」：拖边 = 抓住那条边跟着手走，
    // 起点是块**当前**的宽度（可能已经是满栏那么宽了），不是 0
    const c = await ev(`(() => {
      const b = stSbSelected().block;
      const g = window.__rsz('e', 37, 0, false);
      return { w: g.after.model.w, h: g.after.model.h, x: g.after.model.x,
        y: g.after.model.y, gw: g.before.gw,
        dw: Math.round(g.after.box.w - g.before.box.w),
        midW: g.mid.model.w, midStyle: g.mid.model.style,
        wantMid: 'width:' + (g.before.gw + 37) + 'px' };
    })()`);
    check('拖东边 37px → w = 起始宽 + 37', c.w, c.gw + 37);
    check('  → 高度一个字节没动（还是自适应）', c.h, 0);
    check('  → 位置也没动', c.x + ',' + c.y, '0,0');
    check('  → 可见宽度真的长了 37px', c.dw, 37);
    // 比之前先去空白：浏览器序列化 style 时会补空格（`width: 497px`），
    // 拿原样的字符串去 indexOf 只会一直 false
    check('  → 拖动过程中就实时跟手（没等松手）', String(c.midStyle).replace(/\s+/g, ''),
      v => v.indexOf(c.wantMid) >= 0, c.wantMid);

    const c2 = await ev(`(() => {
      stSbSizeReset(stSbSelected().block.id);
      const b = stSbSelected().block;
      const g = window.__rsz('s', 0, 23, false);
      return { w: g.after.model.w, h: g.after.model.h, gh: g.before.gh,
        dh: Math.round(g.after.box.h - g.before.box.h) };
    })()`);
    check('拖南边 23px → h = 起始高 + 23', c2.h, c2.gh + 23);
    check('  → 宽度还是自适应（拖一边不该把另一边也钉死）', c2.w, 0);
    check('  → 可见高度真的长了 23px', c2.dh, 23);

    const c3 = await ev(`(() => {
      stSbSizeReset(stSbSelected().block.id);
      const b = stSbSelected().block;
      const g = window.__rsz('se', 18, 12, false);
      return { w: g.after.model.w, h: g.after.model.h,
        gw: g.before.gw, gh: g.before.gh,
        dw: Math.round(g.after.box.w - g.before.box.w),
        dh: Math.round(g.after.box.h - g.before.box.h) };
    })()`);
    check('拖右下角：宽 +18 / 高 +12 一起落库',
      (c3.w - c3.gw) + 'x' + (c3.h - c3.gh), '18x12');
    check('  → 可见尺寸跟着长', c3.dw + 'x' + c3.dh, '18x12');

    // ============ D. 西 / 北边：位置跟着走，对边不动 ===");
    console.log('\n== D. 拖西边 / 北边：位置跟着走 ==');
    const d = await ev(`(() => {
      const b = stSbSelected().block;
      b.w = 200; b.h = 0; b.offX = 40; b.offY = 0; stSbSync(); stSbPaintCanvas();
      const g = window.__rsz('w', 30, 0, false);
      return { x: g.after.model.x, w: g.after.model.w,
        rightBefore: g.before.box.right, rightAfter: g.after.box.right,
        leftBefore: g.before.box.left, leftAfter: g.after.box.left };
    })()`);
    check('拖西边 30px → 宽度减 30', d.w, 170);
    check('  → 偏移加 30（往右挪）', d.x, 70);
    check('  → 左边缘跟着手走了 30px', Math.round(d.leftAfter - d.leftBefore), 30);
    check('  → 右边缘一动不动', Math.round(d.rightAfter - d.rightBefore), 0);

    const d2 = await ev(`(() => {
      const b = stSbSelected().block;
      b.w = 0; b.h = 100; b.offX = 0; b.offY = 20; stSbSync(); stSbPaintCanvas();
      const g = window.__rsz('n', 0, 25, false);
      return { y: g.after.model.y, h: g.after.model.h,
        topBefore: g.before.box.top, topAfter: g.after.box.top };
    })()`);
    check('拖北边 25px → 高度减 25', d2.h, 75);
    check('  → 偏移加 25', d2.y, 45);
    check('  → 上边缘跟着手走', Math.round(d2.topAfter - d2.topBefore), 25);

    // 拖过头：夹到下限，位置停在「对边减下限」那里，不会翻到反方向
    const d3 = await ev(`(() => {
      const b = stSbSelected().block;
      b.w = 60; b.h = 0; b.offX = 0; b.offY = 0; stSbSync(); stSbPaintCanvas();
      const g = window.__rsz('w', 500, 0, false);
      return { w: g.after.model.w, x: g.after.model.x };
    })()`);
    check('西边拖过头 → 宽度夹在下限 8', d3.w, 8);
    check('  → 偏移停在 52（60-8），没有继续往右跑', d3.x, 52);

    // ============ E. Shift 吸附 ============
    console.log('\n== E. 按住 Shift 拖 = 吸附 8px 网格 ==');
    // 起点给一个明确的值，吸附结果才是确定的 —— 从「满栏宽」起步的话
    // 结果取决于画布多宽，断言就成了看运气
    const e1 = await ev(`(() => {
      const b = stSbSelected().block;
      b.w = 100; b.h = 0; b.offX = 0; b.offY = 0; stSbSync(); stSbPaintCanvas();
      const g = window.__rsz('e', 37, 0, true);
      return { gw: g.before.gw, w: g.after.model.w };
    })()`);
    check('起始宽确实是 100', e1.gw, 100);
    check('100 + 37 = 137 → 吸附到 136（8 的倍数）', e1.w, 136);

    const e2 = await ev(`(() => {
      const b = stSbSelected().block;
      b.w = 0; b.h = 100; stSbSync(); stSbPaintCanvas();
      const g = window.__rsz('s', 0, 19, true);
      return { gh: g.before.gh, h: g.after.model.h };
    })()`);
    check('起始高确实是 100', e2.gh, 100);
    check('100 + 19 = 119 → 吸附到 120（8 的倍数）', e2.h, 120);

    // 不按 Shift 就是 1px 一档，不吸附
    const e3 = await ev(`(() => {
      const b = stSbSelected().block;
      b.w = 100; b.h = 0; stSbSync(); stSbPaintCanvas();
      const g = window.__rsz('e', 37, 0, false);
      return { w: g.after.model.w };
    })()`);
    check('不按 Shift：137 就是 137，不吸附', e3.w, 137);

    // ============ F. Alt+方向键改尺寸 ============
    console.log('\n== F. Alt+方向键：1px / Shift 十档 ==');
    const f1 = await ev(`(() => {
      const b = stSbSelected().block;
      b.w = 100; b.h = 50; stSbSync(); stSbPaintCanvas();
      const hit = stSbCanvasHitOf(b);
      const el = stSbCanvasEl(hit, b);
      const key = (k, alt, shift) => el.dispatchEvent(new KeyboardEvent('keydown',
        { key: k, altKey: !!alt, shiftKey: !!shift, bubbles: true, cancelable: true }));
      const seq = [];
      key('ArrowRight', true, false); seq.push(b.w + 'x' + b.h);
      key('ArrowRight', true, true);  seq.push(b.w + 'x' + b.h);
      key('ArrowDown', true, false);  seq.push(b.w + 'x' + b.h);
      key('ArrowDown', true, true);   seq.push(b.w + 'x' + b.h);
      key('ArrowLeft', true, false);  seq.push(b.w + 'x' + b.h);
      return { seq: seq };
    })()`);
    check('Alt+→：宽 +1', f1.seq[0], '101x50');
    check('Alt+Shift+→：宽 +10', f1.seq[1], '111x50');
    check('Alt+↓：高 +1', f1.seq[2], '111x51');
    check('Alt+Shift+↓：高 +10', f1.seq[3], '111x61');
    check('Alt+←：宽 -1', f1.seq[4], '110x61');

    // 没设过尺寸的块：第一次按键得从**量出来的当前大小**起步，
    // 不然会从 0 跳到 8，块当场缩成一条
    const f2 = await ev(`(() => {
      const b = stSbSelected().block;
      b.w = 0; b.h = 0; stSbSync(); stSbPaintCanvas();
      const hit = stSbCanvasHitOf(b);
      const el = stSbCanvasEl(hit, b);
      const measured = Math.round(stSbMeasureEl(el, 'w'));
      el.dispatchEvent(new KeyboardEvent('keydown',
        { key: 'ArrowRight', altKey: true, bubbles: true, cancelable: true }));
      return { measured: measured, w: b.w };
    })()`);
    check('没设过尺寸 → 从量出来的宽度起步，不是从 0 跳 8', f2.w, f2.measured + 1);

    // 方向键**不带** Alt 时仍然是挪位置，一个字节都不许改尺寸
    const f3 = await ev(`(() => {
      const b = stSbSelected().block;
      b.w = 0; b.h = 0; b.offX = 0; b.offY = 0; stSbSync(); stSbPaintCanvas();
      const el = stSbCanvasEl(stSbCanvasHitOf(b), b);
      el.dispatchEvent(new KeyboardEvent('keydown',
        { key: 'ArrowRight', bubbles: true, cancelable: true }));
      return { w: b.w, h: b.h, x: b.offX };
    })()`);
    check('光按方向键还是挪位置（不碰尺寸）', f3.w + '/' + f3.h, '0/0');
    check('  → 位置挪了 1px', f3.x, 1);

    // ============ G. 恢复默认尺寸 ============
    console.log('\n== G. 恢复默认尺寸 / 全部归位（两件事，别互相踩）==');
    const g1 = await ev(`(() => {
      const b = stSbSelected().block;
      b.w = 120; b.h = 40; b.offX = 15; b.offY = 9; stSbSync(); stSbPaintCanvas();
      const before = stSbDocHtml();
      stSbSizeReset(b.id);
      const after = stSbDocHtml();
      return { w: b.w, h: b.h, x: b.offX, y: b.offY,
        hadW: before.indexOf('width:120px') >= 0,
        hadH: before.indexOf('height:40px') >= 0,
        stillW: after.indexOf('width:120px') >= 0,
        stillH: after.indexOf('height:40px') >= 0,
        offKept: after.indexOf('left:15px') >= 0 };
    })()`);
    check('恢复前产物里确实有那两条', g1.hadW && g1.hadH, true);
    check('恢复后 w / h 都回 0', g1.w + '/' + g1.h, '0/0');
    check('  → 产物里也找不到了', g1.stillW || g1.stillH, false);
    check('  → **不碰偏移**（15px 还在）', g1.offKept, true);
    check('  → 偏移字段也没被清', g1.x + ',' + g1.y, '15,9');

    const g2 = await ev(`(() => {
      const bs = stEditor.card.statusBar.blocks;
      bs[0].w = 100; bs[0].offX = 12;
      if (bs[1]) { bs[1].h = 30; }
      if (bs[2]) { bs[2].w = 44; bs[2].offY = -6; }
      stSbSync(); stSbPaintCanvas();
      stSbOffResetAll();
      const offs = [];
      const sizes = [];
      (function walk(l) {
        (l || []).forEach(x => { offs.push([x.offX, x.offY]); sizes.push([x.w, x.h]); walk(x.children); });
      })(stEditor.card.statusBar.blocks);
      return { offLeft: offs.filter(p => p[0] || p[1]).length,
        sizeLeft: sizes.filter(p => p[0] || p[1]).length };
    })()`);
    check('全部归位：偏移一个不剩', g2.offLeft, 0);
    check('  → 但尺寸原封不动（两件事，别互相踩）', g2.sizeLeft, v => Number(v) >= 2, '>=2');

    const g3 = await ev(`(() => {
      stSbSizeResetAll();
      const sizes = [];
      (function walk(l) {
        (l || []).forEach(x => { sizes.push([x.w, x.h]); walk(x.children); });
      })(stEditor.card.statusBar.blocks);
      return { sizeLeft: sizes.filter(p => p[0] || p[1]).length };
    })()`);
    check('尺寸复原：一个不剩', g3.sizeLeft, 0);

    // ============ H. 解析别人的卡 ============
    console.log('\n== H. 解析：px 读得回来，别的原样带走 ==');
    const h1 = await ev(`(() => {
      const wrap = body =>
        '<!doctype html><html><head><meta charset="utf-8"></head><body>\\n' +
        '<div style="border:1px solid #5a3f6b;border-radius:10px;padding:9px 11px;' +
        'color:#f0e6f5;font-size:13px;line-height:1.6;box-sizing:border-box;text-align:left">\\n' +
        body + '\\n</div>\\n</body></html>';
      const text = st => '<div style="' + st + 'font-size:13px;color:#f0e6f5;' +
        'text-align:left;margin:3px 0;white-space:pre-wrap;line-height:1.6">HP ' +
        '{{format_message_variable::stat_data.生命}}</div>';
      const run = (st, probe) => {
        const p = stSbParseDoc(wrap(text(st)));
        const sb = stStatusBarFromRaw({ theme: p.theme, width: p.width,
          shellExtra: p.shellExtra, shellCls: p.shellCls, shellOff: p.shellOff,
          blocks: p.blocks, pre: '', post: '' });
        const blk = sb.blocks[0];
        const gen = stSbBodyHtml(sb, false);
        return { w: blk.w, h: blk.h, keepOk: p.keepOk, extra: String(blk.extra || ''),
          kept: gen.indexOf(probe) >= 0 };
      };
      return {
        px: run('width:200px;', 'width:200px'),
        pct: run('width:60%;', 'width:60%'),
        calc: run('height:calc(2em + 4px);', 'height:calc(2em + 4px)'),
        // 分割线：生成器自己就写 height:1px，不能被读成「用户设了 1px 高」
        div: (() => {
          const p = stSbParseDoc(wrap('<div style="height:1px;background:#ff00aa;' +
            'margin:7px 0"></div>'));
          const sb = stStatusBarFromRaw({ theme: p.theme, width: p.width,
            shellExtra: p.shellExtra, shellCls: p.shellCls, shellOff: p.shellOff,
            blocks: p.blocks, pre: '', post: '' });
          const blk = sb.blocks[0];
          const gen = stSbBodyHtml(sb, false);
          return { type: blk.type, h: blk.h, extra: String(blk.extra || ''),
            n: (gen.split('height:1px').length - 1), keepOk: p.keepOk };
        })(),
        // 加粗分割线：height:2px 是作者设的，该收进 h
        div2: (() => {
          const p = stSbParseDoc(wrap('<div style="height:2px;background:#ff00aa;' +
            'margin:7px 0"></div>'));
          const sb = stStatusBarFromRaw({ theme: p.theme, width: p.width,
            shellExtra: p.shellExtra, shellCls: p.shellCls, shellOff: p.shellOff,
            blocks: p.blocks, pre: '', post: '' });
          const blk = sb.blocks[0];
          const gen = stSbBodyHtml(sb, false);
          return { h: blk.h, extra: String(blk.extra || ''),
            has2: gen.indexOf('height:2px') >= 0, keepOk: p.keepOk,
            n1: (gen.split('height:1px').length - 1) };
        })()
      };
    })()`);
    check('手写稿里的 width:200px 读进了 w', h1.px.w, 200);
    check('  → 产物里还是 width:200px', h1.px.kept, true);
    check('  → extra 里没有重复记一遍', h1.px.extra, v => !/width\s*:/.test(String(v)),
      '不含 width');
    check('  → 自检也过', h1.px.keepOk, true);
    check('width:60% 不当尺寸读（那是作者的排版手法）', h1.pct.w, 0);
    check('  → 但原样保住了', h1.pct.kept, true);
    check('  → 记在 extra 里', h1.pct.extra, v => /width\s*:\s*60%/.test(String(v)),
      '含 width:60%');
    check('calc() 高度也不当尺寸读', h1.calc.h, 0);
    check('  → 原样保住了', h1.calc.kept, true);

    check('分割线认出来了', h1.div.type, 'divider');
    check('生成器那句 height:1px **不**当尺寸读', h1.div.h, 0);
    check('  → extra 里也不记它（那是生成器写的）', h1.div.extra,
      v => !/height\s*:/.test(String(v)), '不含 height');
    check('  → 产物里 height:1px 只出现一次', h1.div.n, 1);
    check('  → 自检过', h1.div.keepOk, true);

    check('加粗分割线的 height:2px 收进 h 字段', h1.div2.h, 2);
    check('  → 产物里那句 height:2px 还在', h1.div2.has2, true);
    check('  → 不再多写一句 height:1px', h1.div2.n1, 0);
    check('  → extra 里不重复', h1.div2.extra, v => !/height\s*:/.test(String(v)), '不含 height');
    check('  → 自检过', h1.div2.keepOk, true);

    // 解析 → 生成 → 再解析：尺寸不许越滚越大
    const h2 = await ev(`(() => {
      const raw = '<!doctype html><html><head><meta charset="utf-8"></head><body>\\n' +
        '<div style="border:1px solid #5a3f6b;border-radius:10px;padding:9px 11px;' +
        'color:#f0e6f5;font-size:13px;line-height:1.6;box-sizing:border-box;text-align:left">\\n' +
        '<div style="width:200px;height:40px;font-size:13px;color:#f0e6f5;' +
        'text-align:left;margin:3px 0;white-space:pre-wrap;line-height:1.6">HP ' +
        '{{format_message_variable::stat_data.生命}}</div>\\n' +
        '</div>\\n</body></html>';
      const mk = p => stStatusBarFromRaw({ theme: p.theme, width: p.width,
        shellExtra: p.shellExtra, shellCls: p.shellCls, shellOff: p.shellOff,
        blocks: p.blocks, pre: '', post: '' });
      const p1 = stSbParseDoc(raw);
      const sb1 = mk(p1);
      const gen1 = stSbBodyHtml(sb1, false);
      const p2 = stSbParseDoc(stSbFencedDoc(stSbMarkOf(sb1) + gen1));
      const sb2 = mk(p2);
      const b2 = sb2.blocks[0];
      const gen2 = stSbBodyHtml(sb2, false);
      return { w1: sb1.blocks[0].w, h1: sb1.blocks[0].h,
        w2: b2.w, h2: b2.h, same: gen1 === gen2,
        n: (gen2.split('width:200px').length - 1) };
    })()`);
    check('第一遍：w / h 读对了', h2.w1 + 'x' + h2.h1, '200x40');
    check('第二遍：还是 200x40（没翻倍也没漂）', h2.w2 + 'x' + h2.h2, '200x40');
    check('  → 两遍生成逐字节相同', h2.same, true);
    check('  → width:200px 只出现一次', h2.n, 1);

    // ============ I. 调过大小之后，运行时那套不受影响 ============
    console.log('\n== I. 挪 + 调大小之后，第五轮那套一条都不能塌 ==');
    const i1 = await ev(`(() => {
      const b = stEditor.card.statusBar.blocks[0];
      b.offX = 7; b.offY = 3; b.w = 180; b.h = 0;
      stSbSync();
      const doc = stSbDocHtml();
      const rt = stSbRuntimeInfo(doc);
      const p = stSbParseDoc(doc);
      const back = stStatusBarFromRaw({ theme: p.theme, width: p.width,
        shellExtra: p.shellExtra, shellCls: p.shellCls, shellOff: p.shellOff,
        blocks: p.blocks, pre: p.runtime.pre, post: p.runtime.post });
      const blk = back.blocks[0];
      return { live: rt.live.length, ok: p.ok, keepOk: p.keepOk, textOk: p.textOk,
        runtimeOk: p.runtime.ok, x: blk.offX, w: blk.w,
        extraHas: /(?:^|;)\\s*(left|top|width|height)\\s*:/.test(String(blk.extra || '')),
        same: stSbBodyHtml(back, false) === stSbBodyHtml(stEditor.card.statusBar, false),
        detect: stSbDetect().state };
    })()`);
    check('产物仍然是运行时认的那一段', i1.live, 1);
    check('解析成功', i1.ok, true);
    check('  → 运行时判定合格', i1.runtimeOk, true);
    check('  → 保留声明自检通过', i1.keepOk, true);
    check('  → 文字对得上', i1.textOk, true);
    check('  → 偏移读得回来', i1.x, 7);
    check('  → 尺寸也读得回来', i1.w, 180);
    check('  → 四条都没跑进 extra', i1.extraHas, false);
    check('  → 重新生成逐字节相同', i1.same, true);
    check('  → 卡里那条还认得出是本编辑器画的', i1.detect, 'mine');

    // 真机预览里也该变宽（预览跟写进卡里的是同一套包装）
    await ev(`(() => { const b = stEditor.card.statusBar.blocks[0];
      b.w = 210; b.h = 0; stSbSync(); stSbPaintCanvas(); })()`);
    let i2 = null;
    for (let k = 0; k < 30; k++) {
      await sleep(200);
      i2 = await frameEval(`(() => {
        const el = document.body ? document.body.querySelector('[style*="width:210px"]') : null;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), cs: getComputedStyle(el).width };
      })()`).catch(() => null);
      if (i2) break;
    }
    check('真机预览里那块也变宽了', i2, v => !!v && v.w === 210, '210');
    await shot('sb7-resize.png', '.st-sb-canvas-wrap');

    // ============ J. 画布 == 玩家看到的（带 padding 的块也要对上）============
    console.log('\n== J. 画布上的宽 == 真机预览里的宽 ==');
    const j = await ev(`(() => {
      // 高级 HTML 块：自带内边距，最容易暴露「按边框盒还是内容盒算」
      const b = stEditor.card.statusBar.blocks[0];
      b.w = 260; b.h = 0;
      stSbSync(); stSbPaintCanvas();
      const hit = stSbCanvasHitOf(b);
      const el = stSbCanvasEl(hit, b);
      const q = el.getBoundingClientRect();
      return { w: Math.round(q.width), pad: getComputedStyle(el).paddingLeft,
        hitW: Math.round(hit.getBoundingClientRect().width) };
    })()`);
    let j2 = null;
    for (let k = 0; k < 30; k++) {
      await sleep(200);
      j2 = await frameEval(`(() => {
        const el = document.body ? document.body.querySelector('[style*="width:260px"]') : null;
        if (!el) return null;
        return { w: Math.round(el.getBoundingClientRect().width) };
      })()`).catch(() => null);
      if (j2) break;
    }
    check('画布上那个块 260px 宽', j.w, 260);
    check('真机预览里也是 260px', j2, v => !!v && v.w === 260, '260');
    check('  → 命中框贴着块（选中轮廓不会拉到整栏那么长）', j.hitW, 260);

    // ============ K. 存了再读 ============
    console.log('\n== K. 存了再读，尺寸还在 ==');
    const kk = await ev(`(() => {
      const b = stEditor.card.statusBar.blocks[0];
      b.w = 133; b.h = 0;
      stSbSync(); stSaveDraft();
      const saved = JSON.parse(localStorage.getItem(ST_DRAFT_KEY) || '{}');
      const blk = (((saved.card || {}).statusBar || {}).blocks || [])[0] || {};
      return { w: blk.w, h: blk.h };
    })()`);
    check('草稿里记着 w', kk.w, 133);
    check('草稿里记着 h', kk.h, 0);

    // 重开页面，草稿得原样接上（**不清 localStorage** —— 清了就是在测「没有草稿」，
    // 那是另一件事）
    let loaded2 = new Promise(res => cdp.on('Page.loadEventFired', res));
    await cdp.send('Page.reload', {}, SID);
    await loaded2;
    await ev(`document.fonts.ready.then(() => true)`, true);
    await sleep(700);
    await ev('openStEditor()');
    await ev(`stSwitchTab('sb')`);
    await sleep(300);
    const kk2 = await ev(`(() => {
      const b = stEditor.card.statusBar.blocks[0];
      return { w: b.w, h: b.h, on: stSbFreeOn(),
        n: document.querySelectorAll('#st-sb-canvas .st-sb-h').length,
        inDoc: stSbDocHtml().indexOf('width:133px') >= 0 };
    })()`);
    check('重开之后 w 还在', kk2.w, 133);
    check('  → h 还是 0', kk2.h, 0);
    check('  → 产物里的尺寸也在', kk2.inDoc, true);
    check('  → 自由摆放还是开着的', kk2.on, true);
    check('  → 没选中块 → 一个把手都不渲染', kk2.n, 0);

    // ============ L. 收尾 ============
    console.log('\n== L. 收尾 ==');
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

  console.log(`\n===== 第七轮（调整大小）：${pass} 通过 / ${fail} 失败 =====`);
  if (fails.length) console.log('失败项：\n  - ' + fails.join('\n  - '));
  process.exit(fail ? 1 : 0);
})();
