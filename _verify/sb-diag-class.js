// 诊断：class 版手写稿为什么没保住
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
      this.pending.set(id, { resolve: res, reject: rej });
      this.pending.set(id, { res: v => { clearTimeout(tm); res(v); }, rej: e => { clearTimeout(tm); rej(e); } });
      this.ws.send(JSON.stringify({ id, method: m, params: p, ...(sid && { sessionId: sid }) }));
    });
  }
}

const HTML = [
  '<!doctype html><html><head><meta charset="utf-8">',
  '<style>',
  '.hp-panel{border:1px solid #5a3f6b;border-radius:10px;padding:9px 11px;',
  'background:linear-gradient(160deg,#1a1024,#2b1733);color:#f0e6f5;',
  'font-size:13px;line-height:1.6;box-shadow:0 4px 14px rgba(226,106,160,.35);width:430px}',
  '.hp-title{font-size:15px;font-weight:bold;color:#ffb3d9;text-align:center;margin:0 0 6px;line-height:1.4}',
  '.hp-k{color:#a891b8;letter-spacing:1.5px}',
  '.hp-v{color:#f0e6f5;font-weight:bold}',
  '.hp-track{height:9px;background:#241a2e;border-radius:2px;overflow:hidden;border:1px solid #ff77bb}',
  '.hp-fill{height:100%;background:#ffb3d9;border-radius:2px;box-shadow:0 0 8px #ff77bb}',
  '.hp-off{color:#5a3f6b}',
  '.hp-on{color:#ffb3d9;text-shadow:0 0 4px #fff}',
  '</style></head><body>',
  '<div class="hp-panel">',
  '<div class="hp-title">夜状态</div>',
  '<div style="margin:3px 0">',
  '<div style="display:flex;justify-content:space-between;font-size:11px;color:#a891b8;',
  'margin-bottom:3px"><span class="hp-k">体力</span>',
  '<span class="hp-v">{{format_message_variable::stat_data.体力}}</span></div>',
  '<div class="hp-track">',
  '<div class="hp-fill" style="width:0%;width:calc(({{get_message_variable::stat_data.体力}} - 0) / 100 * 100%)"></div>',
  '</div></div>',
  '<div style="display:flex;align-items:center;gap:8px;margin:3px 0;font-size:13px;',
  'justify-content:flex-start"><span class="hp-k" style="font-size:13px">信赖</span>',
  '<span style="position:relative;display:inline-block;line-height:1;letter-spacing:9px;',
  'white-space:nowrap"><span class="hp-off">●●●●●</span>',
  '<span class="hp-on" style="position:absolute;left:0;top:0;overflow:hidden;width:0px;',
  'width:calc(({{get_message_variable::stat_data.信赖}} - 0) / 5 * 85px);max-width:100%">',
  '●●●●●</span></span>',
  '<span class="hp-v" style="font-size:13px">',
  '{{format_message_variable::stat_data.信赖}}</span></div>',
  '<div style="height:2px;background:#5a3f6b;margin:7px 0"></div>',
  '<div style="display:flex;gap:10px;align-items:center;margin:3px 0">',
  '<div class="hp-col-l" style="flex:2 1 0;min-width:0">',
  '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;',
  'font-size:13px;margin:3px 0;text-align:left"><span class="hp-k">金币</span>',
  '<span class="hp-v">{{format_message_variable::stat_data.金币}}</span></div></div>',
  '<div class="hp-col-r" style="flex:1 1 0;min-width:0">',
  '<div class="hp-k" style="font-size:13px;text-align:right;margin:3px 0;',
  'white-space:pre-wrap;line-height:1.6">第 {{getvar::stat_data.天数}} 天</div></div>',
  '</div>',
  '</div>',
  '</body></html>'
].join('\n');

(async () => {
  const PORT = 8997;
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
  const cdpPort = 9823;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-diagc-'));
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
    await ev(`stSwitchTab('sb')`);
    await sleep(200);

    const d = await ev(`(() => {
      const src = ${JSON.stringify(HTML)};
      const r = stSbParseDoc(src);
      if (!r.ok) return { ok: false, why: r.why };
      const sb = stStatusBarFromRaw({ theme: r.theme, width: r.width,
        shellExtra: r.shellExtra, shellCls: r.shellCls, shellOff: r.shellOff, blocks: r.blocks });
      const gen = stSbDocHtmlOf(sb);
      const types = [];
      (function w(l, d) { (l || []).forEach(b => { types.push('  '.repeat(d) + b.type +
        (b.text ? ' «' + String(b.text).slice(0, 30) + '»' : '')); w(b.children, d + 1); }); })(sb.blocks, 0);
      return {
        ok: true, shell: r.shell, shellCls: r.shellCls, shellOff: r.shellOff,
        width: r.width, raw: r.stats.raw, head: r.stats.head, keepOk: r.keepOk,
        keepMiss: r.keepMiss, textOk: r.textOk, types: types,
        visSrc: stSbVisibleText(src).slice(0, 200),
        visGen: stSbVisibleText(gen).slice(0, 200),
        shellOpen: stSbShellOpen(sb).slice(0, 400),
        genHead: gen.slice(0, 900)
      };
    })()`);
    console.log(JSON.stringify(d, null, 2));

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
