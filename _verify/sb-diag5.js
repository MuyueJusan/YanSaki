// 临时诊断：为什么 NO_BODY_RAW 接管失败 + 预览 iframe 的 frame tree
const PAGE_FILE = 'G:/saki/saki.html';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].find(p => fs.existsSync(p));

const sleep = ms => new Promise(r => setTimeout(r, ms));

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
      const tm = setTimeout(() => { this.pending.delete(id); rej(new Error(`超时 ${method}`)); }, timeout);
      this.pending.set(id, { res: v => { clearTimeout(tm); res(v); }, rej: e => { clearTimeout(tm); rej(e); } });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
    });
  }
}

const NO_BODY_RAW = '```html\n' +
  '<div style="border:1px solid #345;border-radius:8px;padding:8px;color:#eee">\n' +
  '<div style="font-size:13px;color:#eee;text-align:left;margin:3px 0;' +
  'white-space:pre-wrap;line-height:1.6">HP {{format_message_variable::stat_data.生命}}</div>\n' +
  '</div>\n```';

const HEAD_STYLE_RAW =
  '<!doctype html><html><head><meta charset="utf-8">' +
  '<style>.st-head-probe{color:rgb(17,34,51);letter-spacing:2.5px}</style></head><body>\n' +
  '<div style="border:1px solid #345;border-radius:8px;padding:8px;color:#eee">\n' +
  '<div class="st-head-probe" style="font-size:13px;text-align:left;margin:3px 0;' +
  'white-space:pre-wrap;line-height:1.6">甲</div>\n' +
  '</div>\n</body></html>';

(async () => {
  const PORT = 8995;
  const dir = path.dirname(PAGE_FILE), base = path.basename(PAGE_FILE);
  const srv = http.createServer((req, rep) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const f = path.join(dir, u === '/' ? base : u.replace(/^\/+/, ''));
    fs.readFile(f, (e, buf) => {
      if (e) { rep.writeHead(404); rep.end('nope'); return; }
      rep.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      rep.end(buf);
    });
  });
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));

  const cdpPort = 9777;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-diag-'));
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu',
    '--no-first-run', '--hide-scrollbars',
    `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`], { stdio: 'ignore' });

  let cdp, SID;
  const ev = async (expr, awaitPromise = false) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise }, SID);
    if (r.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  try {
    let wsUrl = null;
    for (let i = 0; i < 80; i++) {
      try { wsUrl = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json()).webSocketDebuggerUrl; } catch (e) {}
      if (wsUrl) break; await sleep(250);
    }
    const ws = new WebSocket(wsUrl);
    await new Promise(r => ws.addEventListener('open', r));
    cdp = new CDP(ws);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    SID = (await cdp.send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
    await cdp.send('Page.enable', {}, SID);
    await cdp.send('Runtime.enable', {}, SID);
    let dialogs = 0;
    cdp.on('Page.javascriptDialogOpening', async p => {
      dialogs++; console.log('  [dialog]', JSON.stringify(p.message).slice(0, 120));
      await cdp.send('Page.handleJavaScriptDialog', { accept: true }, SID).catch(() => {});
    });
    const ctxByFrame = new Map();
    cdp.on('Runtime.executionContextCreated', p => {
      const c = p.context;
      if (c.auxData && c.auxData.frameId) ctxByFrame.set(c.auxData.frameId, c.id);
    });

    const loaded = new Promise(res => cdp.on('Page.loadEventFired', res));
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` }, SID);
    await loaded;
    await ev('localStorage.clear()');
    const l2 = new Promise(res => cdp.on('Page.loadEventFired', res));
    await cdp.send('Page.reload', {}, SID);
    await l2;
    await sleep(600);

    await ev('openStEditor()');
    await ev(`stSwitchTab('mvu')`);
    await ev(`stMvuInstallClick()`);
    await ev(`stMvuQuickAdd(0)`);
    await ev(`stSwitchTab('sb')`);
    await sleep(300);

    console.log('\n-- 接管诊断（复现 A→B→C 顺序）--');
    // A：套模板（这一步在 verify5 里跑过，怀疑就是它留下的状态）
    await ev(`(() => { stSbApplyTemplate(0); })()`);
    await sleep(200);
    const dA = await ev(`(() => ({ own: stEditor.sbOwn, state: stSbDetect().state,
      hasMark: String(stSbRegex().replaceString || '').indexOf(ST_SB_MARK) >= 0,
      n: stEditor.card.statusBar.blocks.length }))()`);
    console.log('A 之后:', JSON.stringify(dA));

    // B：纯解析，不碰卡
    await ev(`stSbParseDoc(${JSON.stringify(NO_BODY_RAW)})`);

    const d1 = await ev(`(() => {
      stEditor.sbOwn = false;
      stEditor.card.statusBar = stBlankStatusBar();
      stSbRegex().replaceString = ${JSON.stringify(NO_BODY_RAW)};
      const st = stSbDetect().state;
      const p = stSbParseDoc(${JSON.stringify(NO_BODY_RAW)});
      const before = { ok: p.ok, why: p.why, nb: p.blocks && p.blocks.length };
      stSbParseFromCard();
      return { state: st, before: before, own: stEditor.sbOwn,
        rep: stEditor.sbParse ? { rtOk: stEditor.sbParse.runtimeOk, why: stEditor.sbParse.runtimeWhy } : null,
        msg: (document.querySelector('.st-export-msg') || {}).textContent || '' };
    })()`);
    console.log(JSON.stringify(d1, null, 2));
    console.log('dialogs =', dialogs);

    console.log('\n-- head style 诊断 --');
    const d2 = await ev(`(() => {
      const p = stSbParseDoc(${JSON.stringify(HEAD_STYLE_RAW)});
      const sb = stStatusBarFromRaw({ theme: p.theme, width: p.width, shellExtra: p.shellExtra,
        shellOff: p.shellOff, blocks: p.blocks, pre: p.runtime.pre, post: p.runtime.post });
      const gen = stSbDocHtmlOf(sb);
      return { blocks: p.blocks.map(b => ({ type: b.type, text: b.text, cls: b.cls,
        extra: b.extra })), gen: gen.slice(0, 1200) };
    })()`);
    console.log(JSON.stringify(d2, null, 2));

    console.log('\n-- 预览 iframe 诊断 --');
    await ev(`(() => { stEditor.card.statusBar = stBlankStatusBar(); stSbApplyTemplate(0); stRerender(); })()`);
    await sleep(800);
    const tree = await cdp.send('Page.getFrameTree', {}, SID);
    const dump = f => ({ id: f.frame.id, url: f.frame.url, mime: f.frame.mimeType,
      name: f.frame.name, kids: (f.childFrames || []).map(dump) });
    console.log(JSON.stringify(dump(tree.frameTree), null, 2));
    console.log('contexts:', JSON.stringify([...ctxByFrame.entries()]));
    const d3 = await ev(`(() => {
      const f = document.getElementById('st-sb-frame');
      if (!f) return { has: false };
      const want = stSbPreviewDoc(stEditor.card.statusBar);
      const got = f.getAttribute('srcdoc') || '';
      let at = -1;
      const n = Math.min(want.length, got.length);
      for (let k = 0; k < n; k++) if (want[k] !== got[k]) { at = k; break; }
      if (at < 0 && want.length !== got.length) at = n;
      let cd = null, cw = null;
      try { cd = f.contentDocument ? 'yes' : 'no'; } catch (e) { cd = 'throw'; }
      try { cw = f.contentWindow ? 'yes' : 'no'; } catch (e) { cw = 'throw'; }
      const r = f.getBoundingClientRect();
      return { has: true, same: want === got, lenW: want.length, lenG: got.length, at,
        w: want.slice(Math.max(0, at - 60), at + 60), g: got.slice(Math.max(0, at - 60), at + 60),
        cd: cd, cw: cw, box: [Math.round(r.width), Math.round(r.height)],
        vis: getComputedStyle(f).display + '/' + getComputedStyle(f).visibility,
        inDoc: document.contains(f), wrapH: f.parentNode ? f.parentNode.clientHeight : -1,
        paneDisplay: (() => { let p = f; while (p && p !== document.body) {
          if (getComputedStyle(p).display === 'none') return p.className; p = p.parentNode; } return 'visible'; })()
      };
    })()`);
    console.log(JSON.stringify(d3, null, 2));
    const dom = await cdp.send('DOM.getDocument', { depth: -1, pierce: true }, SID);
    const countFrames = n => (n.children || []).reduce((s, c) => s + countFrames(c) + 1, 0);
    console.log('pierced node count:', countFrames(dom.root));
    console.log('has contentDocument node:', JSON.stringify(dom.root).indexOf('contentDocument') >= 0);

    console.log('\n-- targets --');
    const tg = await cdp.send('Target.getTargets', {});
    console.log(tg.targetInfos.map(t => `${t.type} | ${t.url.slice(0, 60)} | ${t.title}`).join('\n'));

    console.log('\n-- 对照实验：普通 iframe / sandbox iframe --');
    await ev(`(() => {
      const mk = (id, attrs, srcdoc) => {
        const f = document.createElement('iframe');
        f.id = id; f.setAttribute('srcdoc', srcdoc);
        Object.keys(attrs).forEach(k => f.setAttribute(k, attrs[k]));
        f.style.width = '300px'; f.style.height = '120px';
        document.body.appendChild(f);
      };
      mk('plain-frame', {}, '<body><div class="probe">普通</div></body>');
      mk('sb-frame', { sandbox: 'allow-scripts' }, '<body><div class="probe">沙盒</div></body>');
      mk('sb2-frame', { sandbox: 'allow-scripts allow-same-origin' }, '<body><div class="probe">沙盒同源</div></body>');
      return true;
    })()`);
    await sleep(900);
    const tree2 = await cdp.send('Page.getFrameTree', {}, SID);
    console.log(JSON.stringify(dump(tree2.frameTree), null, 2));
    const tg2 = await cdp.send('Target.getTargets', {});
    console.log(tg2.targetInfos.map(t => `${t.type} | ${t.url.slice(0, 60)} | ${t.title}`).join('\n'));

  } catch (e) {
    console.log('FATAL', e.stack);
  } finally {
    try { srv.close(); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
    // ⚠ profile 目录要自己删 —— 不删的话每跑一次就多一个（实测 cdp-* 堆到 873 个 / 14.5 GB）
    try { require('child_process').spawn(process.execPath, ['-e', 'require("fs").rmSync(process.argv[1],{recursive:true,force:true,maxRetries:0})', profile], { detached: true, stdio: 'ignore' }).unref(); } catch (e) {}
  }
  process.exit(0);
})();
