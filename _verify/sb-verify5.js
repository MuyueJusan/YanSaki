// 第五轮：**按运行时的规矩解析** —— 实际游玩时怎么被认出来，编辑器就怎么认
//
// 准绳是酒馆助手那两条判定（缺一不可）：
//   ① 代码放在 ``` 围栏里  ② 代码里同时有 <body> 和 </body>
// 满足之后它被当成**一个独立网页**塞进 <iframe> 渲染 —— <style> / <script> /
// 外链资源全可用，vw / vh 以 iframe 为准。
//
// 六段：
//   A. 生成物必须满足那两条 + 结构注释还在（但注释不能多渲染出东西）
//   B. 围栏**外面**的原文逐字节往返（说明文字、别的代码块）
//   C. 原稿不合格时：照样解析、报告里明说、写回时补成合格包装
//   D. <head> 里的 <style> 也要捞出来（真 iframe 里那是最自然的写法）
//   E. 画布上的「真机预览」：真的是 iframe，且 <style> / vw 跟运行时一个规矩
//   F. 收尾零报错
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
    // ⚠ 这份清单**只 push 不删**过：预览 iframe 每重画一次就换一个 target，
    // 死掉的 session 全留在数组里（实测一轮下来 5 个里 4 个是僵尸）。
    // frameEval 每次从尾部往前白撞一遍它们，报错还被撑成「已看到 5 个 OOPIF」
    // —— 查问题时很容易误判成「选错了帧」。只增不减的清单属于
    // 「每加一次东西就来收账」那一类，趁早删
    cdp.on('Target.detachedFromTarget', p => {
      const i = oopif.findIndex(o => o.sessionId === p.sessionId);
      if (i >= 0) oopif.splice(i, 1);
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

    // ============ A. 生成物满足运行时条件 ============
    console.log('\n== A. 产物必须满足运行时的两条判定 ==');
    const a = await ev(`(() => {
      stSbApplyTemplate(0);
      const doc = stSbDocHtml();
      const rt = stSbRuntimeInfo(doc);
      const fenced = stSbFences(doc);
      return {
        live: rt.live.length, blocks: rt.blocks.length,
        lang: fenced[0] && fenced[0].lang,
        hasBody: /<body[\\s>]/i.test(fenced[0] ? fenced[0].code : ''),
        hasCloseBody: /<\\/body\\s*>/i.test(fenced[0] ? fenced[0].code : ''),
        // 结构注释在不在、在不在 body 里面
        mark: doc.indexOf(ST_SB_MARK + ':') >= 0,
        markInBody: (() => {
          const i = doc.indexOf(ST_SB_MARK + ':');
          const b = doc.indexOf('<body');
          return i > b;
        })(),
        // 注释不该多渲染出东西：注释前后 body 的元素个数一致
        detect: stSbDetect().state
      };
    })()`);
    check('产物里有且只有一个满足条件的代码块', a.live, 1);
    check('围栏语言是 html', a.lang, 'html');
    check('代码里有 <body>', a.hasBody, true);
    check('代码里有 </body>', a.hasCloseBody, true);
    check('结构注释还在', a.mark, true);
    check('结构注释在 <body> 里面（不会多渲染）', a.markInBody, true);
    check('卡里那条被认成「本编辑器画的」', a.detect, 'mine');

    // 注释是元素级透明的：把产物喂给 DOMParser，顶层元素个数不受注释影响
    const a2 = await ev(`(() => {
      const doc = stSbDocHtml();
      const withMark = stSbParseDoc(doc);
      const noMark = stSbParseDoc(doc.replace(/<!--MVU_STATUS_BAR:[\\s\\S]*?-->/, ''));
      const n = x => x.blocks.reduce((s, b) => s + 1 + (b.children || []).length, 0);
      return { ok1: withMark.ok, ok2: noMark.ok, n1: n(withMark), n2: n(noMark),
        same: stSbBodyHtml(stEditor.card.statusBar, false) ===
              stSbBodyHtml(stStatusBarFromRaw(withMark), false) };
    })()`);
    check('带注释照样解析成功', a2.ok1, true);
    check('注释不产生额外块', a2.n1, a2.n2);
    check('读回来的块列表能原样再生成', a2.same, true);

    // ============ B. 围栏外的原文逐字节往返 ============
    console.log('\n== B. 围栏外面的原文：一个字节都不能动 ==');
    const b = await ev(`(() => {
      const raw = ${JSON.stringify(OUTSIDE_RAW)};
      const p = stSbParseDoc(raw);
      if (!p.ok) return { ok: false, why: p.why };
      const rt = p.runtime;
      const sb = stStatusBarFromRaw({
        theme: p.theme, width: p.width, shellExtra: p.shellExtra,
        shellOff: p.shellOff, blocks: p.blocks, pre: rt.pre, post: rt.post });
      const gen = stSbDocHtmlOf(sb);
      const p2 = stSbParseDoc(gen);
      return {
        ok: true, runtimeOk: rt.ok, live: rt.live, blocks: rt.blocks,
        preSame: rt.pre === ${JSON.stringify(OUTSIDE_PRE)},
        postSame: rt.post === ${JSON.stringify(OUTSIDE_POST)},
        genStarts: gen.indexOf(${JSON.stringify(OUTSIDE_PRE)}) === 0,
        genEnds: gen.slice(-${JSON.stringify(OUTSIDE_POST)}.length) === ${JSON.stringify(OUTSIDE_POST)},
        genLive: stSbRuntimeInfo(gen).live.length,
        p2pre: p2.runtime.pre === rt.pre,
        p2post: p2.runtime.post === rt.post,
        // 二次解析的块也一模一样（幂等）
        idem: stSbBodyHtml(stStatusBarFromRaw(p2), false) ===
              stSbBodyHtml(stStatusBarFromRaw(p), false),
        textOk: p.textOk, keepOk: p.keepOk
      };
    })()`);
    check('围栏外原文解析成功', b.ok, true);
    check('运行时判定：合格', b.runtimeOk, true);
    check('认出的就是那个带 body 的代码块', b.live, 1);
    check('围栏前的说明文字逐字节保住了', b.preSame, true);
    check('围栏后的尾注逐字节保住了', b.postSame, true);
    check('写回的产物以那段说明开头', b.genStarts, true);
    check('写回的产物以那段尾注结尾', b.genEnds, true);
    check('写回后仍然只有一个是合格的', b.genLive, 1);
    check('再解析一次：前面的原文还是原样', b.p2pre, true);
    check('再解析一次：后面的原文还是原样', b.p2post, true);
    check('解析 → 写回 → 再解析 是幂等的', b.idem, true);
    check('文字内容对得上', b.textOk, true);
    check('保留声明自检通过', b.keepOk, true);

    // ============ C. 不合格的原稿 ============
    console.log('\n== C. 原稿不满足运行时条件时 ==');

    const c1 = await ev(`(() => {
      const p = stSbParseDoc(${JSON.stringify(NO_BODY_RAW)});
      return { ok: p.ok, rtOk: p.runtime.ok, why: p.runtime.why,
        blocks: p.runtime.blocks, live: p.runtime.live, n: p.blocks.length };
    })()`);
    check('有围栏、没 <body>：照样解析出块', c1.ok, true);
    check('  → 运行时判定为不合格', c1.rtOk, false);
    check('  → 原因说得清楚', c1.why, '代码块里没有 <body> / </body>');
    check('  → 认出的块数 > 0', c1.n, v => Number(v) > 0, '>0');

    const c2 = await ev(`(() => {
      const p = stSbParseDoc(${JSON.stringify(BARE_RAW)});
      return { ok: p.ok, rtOk: p.runtime.ok, why: p.runtime.why,
        blocks: p.runtime.blocks, n: p.blocks.length, pre: p.runtime.pre, post: p.runtime.post };
    })()`);
    check('连围栏都没有：照样解析出块', c2.ok, true);
    check('  → 运行时判定为不合格', c2.rtOk, false);
    check('  → 原因是「整段没有一个代码块」', c2.why, '整段没有一个 ``` 代码块');
    check('  → 没有围栏就没有围栏外的原文', [c2.pre, c2.post], v => v.join('') === '', '');

    // 接管 → 写回 → 必须变成合格的
    const c3 = await ev(`(() => {
      stEditor.sbOwn = false;
      stEditor.card.statusBar = stBlankStatusBar();
      stSbRegex().replaceString = ${JSON.stringify(NO_BODY_RAW)};
      stSbParseFromCard();
      const rep = stEditor.sbParse;
      const html = stSbDocHtml();
      return {
        own: stEditor.sbOwn,
        rtOk: rep && rep.runtimeOk, why: rep && rep.runtimeWhy,
        live: stSbRuntimeInfo(html).live.length,
        // 报告栏上必须有那句「玩家那边看不到」
        warned: stSbParseReportHtml().indexOf('运行时的渲染条件') >= 0,
        warnText: stSbParseReportHtml().slice(0, 400)
      };
    })()`);
    check('不合格的原稿也能接管', c3.own, true);
    check('接管记录里记着「原稿不合格」', c3.rtOk, false);
    check('  → 记着原因', c3.why, '代码块里没有 <body> / </body>');
    check('  → 写回后产物合格了（顺手修好）', c3.live, 1);
    check('  → 报告栏明确提示「不满足运行时的渲染条件」', c3.warned, true);
    await shot('sb5-runtime-warn.png', '.st-sb-report');

    // ============ D. <head> 里的 <style> ============
    console.log('\n== D. <head> 里的 <style> 不能丢 ==');
    const d = await ev(`(() => {
      const p = stSbParseDoc(${JSON.stringify(HEAD_STYLE_RAW)});
      if (!p.ok) return { ok: false, why: p.why };
      const sb = stStatusBarFromRaw({
        theme: p.theme, width: p.width, shellExtra: p.shellExtra,
        shellOff: p.shellOff, blocks: p.blocks,
        pre: p.runtime.pre, post: p.runtime.post });
      const gen = stSbDocHtmlOf(sb);
      return {
        ok: true, head: p.stats.head, styleTags: p.stats.styleTags,
        css: gen.indexOf('.st-head-probe{color:rgb(17,34,51)') >= 0,
        probe: gen.indexOf('class="st-head-probe"') >= 0,
        live: stSbRuntimeInfo(gen).live.length,
        textOk: p.textOk
      };
    })()`);
    check('解析成功', d.ok, true);
    check('<head> 里那个 style 被算成 head 里的', d.head, 1);
    check('style 标签计数含 head', d.styleTags, 1);
    check('CSS 原文还在产物里', d.css, true);
    check('用到这个 class 的元素也还在', d.probe, true);
    check('产物仍然合格', d.live, 1);
    check('文字内容对得上（style 不算文字）', d.textOk, true);

    // ============ E. 真机预览 ============
    console.log('\n== E. 画布上的真机预览 ==');
    const e0 = await ev(`(() => {
      const f = document.getElementById('st-sb-frame');
      if (!f) return { has: false };
      const want = stSbPreviewDoc(stEditor.card.statusBar);
      return {
        has: true,
        tag: f.tagName.toLowerCase(),
        sandbox: f.getAttribute('sandbox') || '',
        same: f.getAttribute('srcdoc') === want,
        // 预览里**不带**结构注释（那是给编辑器读的）
        noMark: (f.getAttribute('srcdoc') || '').indexOf(ST_SB_MARK) < 0,
        hasBody: (f.getAttribute('srcdoc') || '').indexOf('<body>') >= 0,
        report: !!document.getElementById('st-sb-runtime')
      };
    })()`);
    check('画布栏里有预览 iframe', e0.has, true);
    check('  是个真的 iframe', e0.tag, 'iframe');
    check('  内容就是运行时那套包装（宏换示例值）', e0.same, true);
    check('  预览里没有结构注释', e0.noMark, true);
    check('  预览文档有 <body>', e0.hasBody, true);
    check('  预览下面挂着运行时体检', e0.report, true);
    check('  sandbox 不给 same-origin（脚本碰不到编辑器）',
      e0.sandbox, v => /allow-scripts/.test(String(v)) && !/allow-same-origin/.test(String(v)),
      'allow-scripts 且无 allow-same-origin');

    // 往状态栏里塞一个探针块：<style> + 100vw + <script>
    await ev(`(() => {
      const b = stBlankSbBlock('html');
      b.text = '<style>.st-probe{color:rgb(17,34,51);letter-spacing:3.5px}</style>' +
        '<div class="st-probe" style="font-size:13px">探针</div>' +
        '<div class="st-probe-vw" style="width:100vw;height:1px"></div>' +
        '<div class="st-probe-js">没跑</div>' +
        '<script>document.querySelector(".st-probe-js").textContent = "跑了";<\\/script>';
      stEditor.card.statusBar.blocks.push(b);
      stSbSync(); stRerender();
    })()`);
    await sleep(600);

    const e1 = await frameEval(`(() => {
      const s = document.querySelector('.st-probe');
      const vw = document.querySelector('.st-probe-vw');
      const js = document.querySelector('.st-probe-js');
      return {
        title: document.title,
        hasHead: !!document.head,
        color: s ? getComputedStyle(s).color : null,
        spacing: s ? getComputedStyle(s).letterSpacing : null,
        vwWidth: vw ? Math.round(vw.getBoundingClientRect().width) : 0,
        frameWidth: document.documentElement.clientWidth,
        js: js ? js.textContent : null,
        n: document.querySelectorAll('*').length
      };
    })()`);
    check('预览 frame 里拿得到 document.head', e1.hasHead, true);
    check('  里面的 <style> 真的生效（颜色）', e1.color, 'rgb(17, 34, 51)');
    check('  里面的 <style> 真的生效（字距）', e1.spacing, '3.5px');
    check('  <script> 真的跑了（运行时放行，预览也放行）', e1.js, '跑了');
    check('  100vw 以 iframe 为准，不是编辑器视口',
      [e1.vwWidth, e1.frameWidth], v => Math.abs(v[0] - v[1]) <= 2 && v[0] < 1400,
      '约等于 iframe 宽度且明显小于 1440');

    // 改一个块 → 预览跟着变（240ms 防抖）
    const e2 = await ev(`(() => {
      const b = stEditor.card.statusBar.blocks[0];
      b.text = '预览联动探针';
      stSbSync(); stSbPaintCanvas();
      return b.type;
    })()`);
    await sleep(900);
    const e3 = await frameEval(`(() => document.body.textContent.indexOf('预览联动探针') >= 0)()`);
    check('改了画布 → 预览里的文字跟着变（' + e2 + ' 块）', e3, true);

    // 围栏外面混进**另一个合格代码块**：运行时可能两个都渲染，得提醒一句。
    // 走 stSet 这条路 —— 就是作者在「围栏外的原文」输入框里打字时走的那条
    const e4 = await ev(`(() => {
      stSet('card.statusBar.pre',
        '说明\\n\\n\\x60\\x60\\x60html\\n<body><div>x</div></body>\\n\\x60\\x60\\x60\\n');
      return stSbRuntimeInfo(stSbDocHtml()).live.length;
    })()`);
    check('围栏外混进另一个合格代码块 → 产物里就有两个', e4, 2);
    await sleep(900);
    const e5 = await ev(`(() => {
      const note = document.getElementById('st-sb-runtime');
      return note ? note.textContent : '';
    })()`);
    check('  → 体检栏仍然说「会渲染」（只是提醒别留两个）',
      e5, v => String(v).indexOf('还有 1 个代码块') >= 0, '含「还有 1 个代码块」');

    // 反过来：围栏外的原文把围栏搞没了 → 必须明确说「玩家那边看不到」
    const e6 = await ev(`(() => {
      stSet('card.statusBar.pre', '说明\\n\\n\\x60\\x60\\x60html\\n');
      return stSbRuntimeInfo(stSbDocHtml()).live.length;
    })()`);
    await sleep(900);
    const e7 = await ev(`(() => {
      const note = document.getElementById('st-sb-runtime');
      return note ? note.textContent : '';
    })()`);
    check('围栏外的原文吃掉了围栏 → 产物里一个合格块都没有', e6, 0);
    check('  → 体检栏明确说「玩家那边看不到」',
      e7, v => String(v).indexOf('看不到这个状态栏') >= 0, '含「看不到这个状态栏」');
    await shot('sb5-runtime-blocked.png', '.st-sb-report');

    await ev(`(() => {
      stEditor.card.statusBar.pre = '';
      stSbSync(); stRerender();
    })()`);
    await sleep(400);
    await shot('sb5-preview.png', '.st-sb-canvas-wrap');

    // ============ F. 收尾 ============
    console.log('\n== F. 收尾 ==');
    check('整轮无 console 错误 / 未捕获异常',
      consoleErrors.filter(x => !/favicon/i.test(x)), v => v.length === 0, '[]');
    check('confirm 只弹了预期次数（2 次接管）',
      (await ev('window.__dlg || []')).concat(DIALOGS).length, 2);

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

  console.log(`\n===== 第五轮：${pass} 通过 / ${fail} 失败 =====`);
  if (fails.length) console.log('失败项：\n  - ' + fails.join('\n  - '));
  process.exit(fail ? 1 : 0);
})();
