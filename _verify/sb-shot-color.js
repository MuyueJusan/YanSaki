// 目视确认：选了颜色之后，「跟随主题」按钮确实出现在属性面板里
const fs = require('fs'); const os = require('os'); const path = require('path');
const http = require('http'); const { spawn } = require('child_process');
const PAGE_FILE = 'G:/saki/saki.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => fs.existsSync(p));
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

(async () => {
  const dir = path.dirname(PAGE_FILE), base = path.basename(PAGE_FILE);
  const srv = http.createServer((req, rep) => {
    const f = path.join(dir, req.url === '/' ? base : req.url.replace(/^\/+/, ''));
    fs.readFile(f, (e, b) => {
      if (e) { rep.writeHead(404); rep.end(); return; }
      rep.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'font/ttf', 'Cache-Control': 'no-store' });
      rep.end(b);
    });
  });
  await new Promise(r => srv.listen(8883, '127.0.0.1', r));
  const port = 9707;
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-shot-'));
  const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 60; i++) {
    try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch (e) {}
    if (wsUrl) break; await sleep(250);
  }
  const ws = new WebSocket(wsUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pend = new Map(); const handlers = new Map();
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
    else if (m.method) (handlers.get(m.method) || []).forEach(f => f(m.params));
  });
  const on = (m, fn) => { if (!handlers.has(m)) handlers.set(m, []); handlers.get(m).push(fn); };
  const send = (method, params = {}, sid) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params, ...(sid && { sessionId: sid }) }));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const SID = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await send('Page.enable', {}, SID); await send('Runtime.enable', {}, SID);
  // 换版式 / 覆盖别人写的状态栏都会弹 confirm，不应答页面就永远挂着
  on('Page.javascriptDialogOpening', p =>
    send('Page.handleJavaScriptDialog', { accept: true }, SID).catch(() => {}));
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true }, SID);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception.description);
    return r.result.value;
  };
  await send('Emulation.setDeviceMetricsOverride',
    { width: 1440, height: 980, deviceScaleFactor: 1, mobile: false }, SID);
  const loaded = new Promise(r => ws.addEventListener('message', function h(e) {
    const m = JSON.parse(e.data); if (m.method === 'Page.loadEventFired') r();
  }));
  await send('Page.navigate', { url: 'http://127.0.0.1:8883/' }, SID);
  await loaded; await sleep(700);
  await ev('openStEditor()');
  await ev(`stSwitchTab('mvu')`);
  await ev(`stMvuInstallClick()`);
  await ev(`stMvuQuickAdd(0)`);
  await ev(`stMvuQuickAdd(2)`);
  await ev(`stSwitchTab('sb')`);
  await ev(`stSbApplyTemplate(2)`);        // 状态卡片
  await sleep(200);

  // 选中一个 title 块并给它上色 → 检查器里应出现「跟随主题」按钮
  const r = await ev(`(() => {
    const t = stEditor.card.statusBar.blocks.find(b => b.type === 'title');
    stSbSelect(t.id);
    const p = stSbChain(t.id).slice(-1)[0].path;
    stSet(p + '.color', '#e8749b');
    const box = document.querySelector('.st-sb-insp .st-sb-color');
    return { hasBtn: !!box.querySelector('button'), btnText: (box.querySelector('button') || {}).textContent,
      inputColor: (box.querySelector('input') || {}).value };
  })()`);
  console.log('检查器颜色格:', JSON.stringify(r));

  // 再给它加粗 + 放大，看画布真渲染
  await ev(`(() => {
    const t = stEditor.card.statusBar.blocks.find(b => b.type === 'title');
    const p = stSbChain(t.id).slice(-1)[0].path;
    stSet(p + '.bold', true); stSet(p + '.size', '18'); stSet(p + '.align', 'center');
  })()`);
  await sleep(250);

  const h = await ev(`(() => { const el = document.querySelector('.st-sb-top');
    if (el) el.scrollIntoView({block:'start'}); return document.documentElement.scrollHeight; })()`);
  const shot = await send('Page.captureScreenshot', { format: 'png' }, SID);
  fs.writeFileSync(path.join(SHOTS, 'sb2-colorbtn.png'), Buffer.from(shot.data, 'base64'));
  console.log('📸 sb2-colorbtn.png', Math.round(Buffer.from(shot.data, 'base64').length / 1024) + ' KB');

  ch.kill(); srv.close(); dropProf(); process.exit(0);
})().catch(e => { console.log('ERR', e.message); dropProf(); process.exit(1); });

// ⚠ Chrome 的 profile 目录要自己删 —— 不删的话每跑一次就多一个（实测 cdp-* 堆到 873 个 / 14.5 GB）。
//   按前缀扫而不是用变量：`prof` 在 IIFE 里面，外面那个 `.catch` 够不着。
function dropProf() {
  try {
    fs.readdirSync(os.tmpdir()).filter(x => x.startsWith('cdp-shot-')).forEach(x => {
      try { require('child_process').spawn(process.execPath, ['-e', 'require("fs").rmSync(process.argv[1],{recursive:true,force:true,maxRetries:0})', path.join(os.tmpdir(), x)], { detached: true, stdio: 'ignore' }).unref(); } catch (e) {}
    });
  } catch (e) {}
}
