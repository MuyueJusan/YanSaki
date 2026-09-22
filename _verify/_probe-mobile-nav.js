// 一次性探针：手机比例下左上角入口菜单的**样子** —— 非复古 / 复古（Win98 菜单）各一张。
// 断言只说明「计算样式对不对」，说明不了「看上去像不像 Win98」；这个探针负责后者。
//
//   node _probe-mobile-nav.js            → shots/mnav-{phone,retro}.png
//   node _probe-mobile-nav.js after-fix  → shots/mnav-after-fix-{phone,retro}.png
//
// ⚠ 前缀 `_` ⇒ `run-all.js` 会跳过它（不用登记进 SUITES）。
const fs = require('fs'); const os = require('os'); const path = require('path');
const http = require('http'); const { spawn } = require('child_process');
const PAGE_FILE = 'G:/saki/saki.html';
const SHOTS = path.join(__dirname, 'shots');
const LABEL = process.argv[2] || 'now';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => fs.existsSync(p));

// ⚠ 这三个要挂在**模块作用域**上：`.finally()` 的回调不在那个 async IIFE 里，
//   在 IIFE 里 `const` 出来的东西它一个都看不见 —— 写 `try { ch.kill() } catch {}`
//   只会吞掉一个 `ReferenceError`，然后**看起来像清理过了**。
let chromeProf = null, chromeProc = null, httpSrv = null;
const dropProf = () => {
  if (!chromeProf) return;
  try { fs.rmSync(chromeProf, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); }
  // ⚠ 别把失败吞掉 —— 静默的清理等于没有清理（见 2026-09-20 日志 ⑰）
  catch (e) { console.log('  ⚠ 临时 profile 没删掉：' + chromeProf + '（' + e.code + '）'); }
};

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
  const pickFree = async lo => {
    for (let i = 0; i < 80; i++) {
      const p = lo + Math.floor(Math.random() * 400);
      const free = await new Promise(res => {
        const probe = http.createServer();
        probe.on('error', () => { try { probe.close(); } catch (e) {} res(false); });
        probe.listen(p, '127.0.0.1', () => probe.close(() => res(true)));
      });
      if (free) return p;
      await sleep(40);
    }
    return lo;
  };
  const HTTP_PORT = await pickFree(8800);
  await new Promise(r => srv.listen(HTTP_PORT, '127.0.0.1', r));
  httpSrv = srv;
  const port = await pickFree(9400);
  const prof = (chromeProf = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-mnav-')));
  const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`], { stdio: 'ignore' });
  chromeProc = ch;
  let wsUrl = null;
  for (let i = 0; i < 60; i++) {
    try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch (e) {}
    if (wsUrl) break; await sleep(250);
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
  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true }, SID);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception.description);
    return r.result.value;
  };
  const loaded = new Promise(r => ws.addEventListener('message', e => {
    if (JSON.parse(e.data).method === 'Page.loadEventFired') r();
  }));
  await send('Emulation.setDeviceMetricsOverride',
    { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, SID);
  await send('Page.navigate', { url: 'http://127.0.0.1:' + HTTP_PORT + '/' }, SID);
  await loaded; await sleep(1200);

  // 造一个「正在编的卡」，这样卡名标注才有内容
  await ev(`(function(){ openStEditor(); return true; })()`);
  await sleep(600);
  await ev(`(function(){ stSet('card.name', '星野 小夜'); return true; })()`);
  await sleep(300);
  await ev(`(function(){ closeStEditor(); return true; })()`);
  await sleep(700);
  await ev(`(function(){ toggleMobileNav(); return true; })()`);
  await sleep(600);

  const shot = async name => {
    const r = await send('Page.captureScreenshot', { format: 'png' }, SID, 30000);
    fs.mkdirSync(SHOTS, { recursive: true });
    const buf = Buffer.from(r.data, 'base64');
    fs.writeFileSync(path.join(SHOTS, name), buf);
    console.log('  📸 ' + name + '  (' + Math.round(buf.length / 1024) + ' KB)');
  };

  await shot(`mnav-${LABEL}-phone.png`);
  await ev(`(function(){ document.body.classList.add('retro-mode'); return true; })()`);
  await sleep(700);
  await shot(`mnav-${LABEL}-retro.png`);

  console.log('  菜单状态: ' + JSON.stringify(await ev(`(function(){
      const n = document.getElementById('mobile-nav');
      const nm = document.getElementById('mobile-nav-name');
      return { open: !!(n && n.classList.contains('open')),
               name: nm ? nm.textContent : '(无此元素)',
               retro: document.body.classList.contains('retro-mode') }; })()`)));
  // 几何：两个菜单项宽度不齐时，光看截图猜不出是哪一层没撑开，这里直接把整条链摊开。
  // ⚠ 纵向也量 —— 卡名挪进面板之后，「在不在编写器那一项下面」是个纵向关系。
  console.log('  几何: ' + JSON.stringify(await ev(`(function(){
      const w = el => { const r = el.getBoundingClientRect(); return Math.round(r.left) + '..' + Math.round(r.right); };
      const v = el => { if (!el) return '(无)'; const r = el.getBoundingClientRect(); return Math.round(r.top) + '..' + Math.round(r.bottom); };
      const items = [...document.querySelectorAll('.mobile-nav-item')];
      return { nav: w(document.getElementById('mobile-nav')),
               btn: w(document.getElementById('mobile-nav-btn')),
               panel: w(document.querySelector('.mobile-nav-panel')),
               inner: w(document.querySelector('.mobile-nav-inner')),
               box: w(document.querySelector('.mobile-nav-box')),
               items: items.map(w),
               vBox: v(document.querySelector('.mobile-nav-box')),
               vStItem: v(items[1]),
               vName: v(document.getElementById('mobile-nav-name')) }; })()`), null, 1));
})().catch(e => { console.log('  ❌ ' + e.message); process.exitCode = 1; })
  .finally(async () => {
    // ⚠⚠ 顺序不能反：**Chrome 还活着时 profile 目录是锁着的**，`rmSync` 会 EBUSY 抛异常，
    //    外面那层 `catch` 一吞 ⇒ 每次跑都静默留下一个 `cdp-mnav-*`。
    //    （实测就是这么漏的 3 个 —— 老坑「`try/catch` 包住的清理 = 没有清理」的新一份。）
    if (chromeProc) { try { chromeProc.kill(); } catch (e) { console.log('  ⚠ kill 失败：' + e.message); } }
    if (httpSrv) { try { httpSrv.close(); } catch (e) {} }
    await sleep(400);            // 等它真的退干净，`dropProf` 里还有 8 次重试兜底
    dropProf();
    try { process.exit(process.exitCode || 0); } catch (e) {}
  });
