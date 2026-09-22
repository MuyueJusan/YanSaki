// 放大看一眼画布 + 真机预览，确认两边是同一份东西
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
  on(m, fn) { if (!this.handlers.has(m)) this.handlers.set(m, []); this.handlers.get(m).push(fn); }
  send(m, p = {}, sid, to = 30000) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const tm = setTimeout(() => { this.pending.delete(id); rej(new Error('超时 ' + m)); }, to);
      this.pending.set(id, { res: v => { clearTimeout(tm); res(v); }, rej: e => { clearTimeout(tm); rej(e); } });
      this.ws.send(JSON.stringify({ id, method: m, params: p, ...(sid && { sessionId: sid }) }));
    });
  }
}

const FIXTURE =
  '<!doctype html><html><head><meta charset="utf-8">' +
  '<style>.hp-name{color:rgb(255,179,217);letter-spacing:1.5px}' +
  '.hp-num{color:rgb(159,208,255);font-weight:bold}</style></head><body>\n' +
  '<div style="border:1px solid #5a3f6b;border-radius:10px;padding:9px 11px;' +
  'background:linear-gradient(160deg,#1a1024,#2b1733);color:#f0e6f5;' +
  'font-size:13px;line-height:1.6;box-sizing:border-box;text-align:left;' +
  'box-shadow:0 4px 14px rgba(226,106,160,.35)">\n' +
  '<div class="hp-name" style="font-size:15px;font-weight:bold;text-align:left;' +
  'margin:0 0 6px;line-height:1.4">状态面板</div>\n' +
  '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;' +
  'font-size:13px;margin:3px 0;text-align:left"><span class="hp-name">生命</span>' +
  '<span class="hp-num">{{format_message_variable::stat_data.生命}}</span></div>\n' +
  '<div style="margin:3px 0"><div style="height:8px;background:rgba(128,150,180,.28);' +
  'border-radius:4px;overflow:hidden"><div style="height:100%;width:0%;' +
  'width:calc(({{format_message_variable::stat_data.生命}} - 0) / 100 * 100%);' +
  'background:#ff77bb;border-radius:4px"></div></div></div>\n' +
  '</div>\n</body></html>';

(async () => {
  const PORT = 8996;
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
  const cdpPort = 9811;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-zoom5-'));
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu',
    '--no-first-run', '--hide-scrollbars',
    `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`], { stdio: 'ignore' });

  let cdp, SID;
  const ev = async (expr, awaitPromise = false) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise }, SID);
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
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
    cdp.on('Page.javascriptDialogOpening', async () =>
      await cdp.send('Page.handleJavaScriptDialog', { accept: true }, SID).catch(() => {}));

    const loaded = new Promise(res => cdp.on('Page.loadEventFired', res));
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` }, SID);
    await loaded;
    await ev('localStorage.clear()');
    const l2 = new Promise(res => cdp.on('Page.loadEventFired', res));
    await cdp.send('Page.reload', {}, SID);
    await l2;
    await sleep(700);

    await ev('openStEditor()');
    await ev(`stSwitchTab('mvu')`);
    await ev(`stMvuInstallClick()`);
    await ev(`stMvuQuickAdd(0)`);
    await ev(`stSwitchTab('sb')`);
    await sleep(200);

    // 手写稿（带 head 里的 <style> + class）走一遍完整接管
    await ev(`(() => {
      stEditor.sbOwn = false;
      stEditor.card.statusBar = stBlankStatusBar();
      stSbRegex().replaceString = ${JSON.stringify(FIXTURE)};
      stSbParseFromCard();
    })()`);
    await sleep(500);
    const info = await ev(`(() => {
      const p = stSbParseDoc(${JSON.stringify(FIXTURE)});
      const cls = [];
      (function w(l) { (l || []).forEach(b => {
        ST_SB_CLS_ROLES.forEach(r => {
          const c = stSbClsOf(b, r);
          if (c) cls.push(b.type + '.' + r + '=' + c);
        });
        w(b.children); }); })(stEditor.card.statusBar.blocks);
      const html = stSbDocHtml();
      return { kept: stEditor.sbParse.keptDecls, cls: cls, head: p.stats.head,
        live: stSbRuntimeInfo(html).live.length,
        inHtml: cls.every(x => html.indexOf(x.split('=')[1]) >= 0) };
    })()`);
    console.log('接管结果:', JSON.stringify(info));

    // 关掉预览的 debounce，立刻刷新一次
    await ev(`stSbPaintPreview()`);
    await sleep(900);

    // 高倍率截画布栏
    const h = await ev(`(() => { const el = document.querySelector('.st-sb-canvas-wrap');
      el.scrollIntoView({block:'start'}); return Math.ceil(el.getBoundingClientRect().height); })()`);
    await cdp.send('Emulation.setDeviceMetricsOverride',
      { width: 1200, height: Math.min(Math.max(h + 40, 400), 3000), deviceScaleFactor: 2, mobile: false }, SID);
    await sleep(400);
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' }, SID);
    fs.writeFileSync(path.join(__dirname, 'shots', 'sb5-zoom.png'), Buffer.from(r.data, 'base64'));
    console.log('📸 sb5-zoom.png',
      Math.round(Buffer.from(r.data, 'base64').length / 1024), 'KB');

  } catch (e) {
    console.log('FATAL', e.stack);
  } finally {
    try { srv.close(); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
    // ⚠ profile 目录要自己删 —— 不删的话每跑一次就多一个（实测 cdp-* 堆到 873 个 / 14.5 GB）
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); } catch (e) {}
  }
  process.exit(0);
})();
