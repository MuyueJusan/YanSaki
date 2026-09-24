// 只看画布：把变量树和画布上的示例值对着打印出来，并截一张放大图
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const PAGE_FILE = 'G:/saki/saki.html';
const SHOTS = path.join(__dirname, 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => fs.existsSync(p));

(async () => {
  const dir = path.dirname(PAGE_FILE), base = path.basename(PAGE_FILE);
  const srv = http.createServer((req, rep) => {
    const f = path.join(dir, req.url === '/' ? base : req.url.replace(/^\/+/, ''));
    fs.readFile(f, (e, b) => {
      if (e) { rep.writeHead(404); rep.end(); return; }
      rep.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'font/ttf' });
      rep.end(b);
    });
  });
  await new Promise(r => srv.listen(8866, '127.0.0.1', r));
  const port = 9501;
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-zoom-'));
  const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 60; i++) {
    try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch (e) {}
    if (wsUrl) break;
    await sleep(250);
  }
  const ws = new WebSocket(wsUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pend = new Map();
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  });
  const send = (method, params = {}, sid) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params, ...(sid && { sessionId: sid }) }));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const SID = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await send('Page.enable', {}, SID); await send('Runtime.enable', {}, SID);
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true }, SID);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception.description);
    return r.result.value;
  };
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 2, mobile: false }, SID);
  const loaded = new Promise(r => ws.addEventListener('message', function h(e) {
    const m = JSON.parse(e.data); if (m.method === 'Page.loadEventFired') r();
  }));
  await send('Page.navigate', { url: 'http://127.0.0.1:8866/' }, SID);
  await loaded; await sleep(800);

  await ev('openStEditor()');
  await ev(`stSwitchTab('mvu')`);
  await ev(`stMvuQuickAdd(0)`);      // 好感度 number 0~100
  await ev(`stMvuQuickAdd(2)`);      // 好感阶段 enum
  await ev(`stSwitchTab('sb')`);
  await ev(`stSbApplyTemplate(2)`);  // 状态卡片（含 var / bar）
  await sleep(400);

  const dump = await ev(`(() => ({
    tree: stEditor.card.mvu.nodes.map(n => ({ name: n.name, type: n.type, value: n.value, min: n.min, max: n.max })),
    paths: stSbVarPaths().map(p => p.path),
    blocks: stEditor.card.statusBar.blocks.map(b => ({ type: b.type, path: b.path, label: b.label })),
    samples: stEditor.card.statusBar.blocks.map(b => b.path ? [b.path, stSbSampleOf(b.path)] : [b.type, ''])
  }))()`);
  console.log(JSON.stringify(dump, null, 1));

  // 选中一个进度条，看属性面板
  await ev(`(() => { const b = stEditor.card.statusBar.blocks.filter(x=>x.type==='bar')[0];
    if (b) stSbSelect(b.id); return true; })()`);
  await sleep(300);
  const h = await ev(`Math.ceil(document.querySelector('.st-sb-split').getBoundingClientRect().height)`);
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: Math.min(h + 260, 1400), deviceScaleFactor: 2, mobile: false }, SID);
  await sleep(300);
  await ev(`document.querySelector('.st-sb-split').scrollIntoView({block:'start'})`);
  await sleep(300);
  const r = await send('Page.captureScreenshot', { format: 'png' }, SID);
  fs.writeFileSync(path.join(SHOTS, 'sb-zoom.png'), Buffer.from(r.data, 'base64'));
  console.log('shot written');
  ch.kill(); srv.close(); dropProf(); process.exit(0);
})().catch(e => { console.log('ERR', e.message); dropProf(); process.exit(1); });

// ⚠ Chrome 的 profile 目录要自己删 —— 不删的话每跑一次就多一个（实测 cdp-* 堆到 873 个 / 14.5 GB）。
//   按前缀扫而不是用变量：`prof` 在 IIFE 里面，外面那个 `.catch` 够不着。
function dropProf() {
  try {
    fs.readdirSync(os.tmpdir()).filter(x => x.startsWith('cdp-zoom-')).forEach(x => {
      try { require('child_process').spawn(process.execPath, ['-e', 'require("fs").rmSync(process.argv[1],{recursive:true,force:true,maxRetries:0})', path.join(os.tmpdir(), x)], { detached: true, stdio: 'ignore' }).unref(); } catch (e) {}
    });
  } catch (e) {}
}
