// 一次性探针：`launchGame('shooter')` 之后，怎么才能让键盘真的落到 iframe 里？
// 判据 = 父页面 `document.activeElement === iframe 元素`（那才是「键盘会进 iframe」的条件）
const PAGE_FILE = 'G:/saki/saki.html';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { spawn } = require('child_process');
const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', ev => { const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } }); }
  send(method, params = {}, sessionId, timeout = 30000) { const id = ++this.id;
    return new Promise((res, rej) => { const tm = setTimeout(() => { this.pending.delete(id); rej(new Error('timeout ' + method)); }, timeout);
      this.pending.set(id, { res: v => { clearTimeout(tm); res(v); }, rej: e => { clearTimeout(tm); rej(e); } });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) })); }); }
}
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-probe-focus-'));
  const port = 9671;
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`], { stdio: 'ignore' });
  const srv = http.createServer((req, rep) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const f = path.join(path.dirname(PAGE_FILE), u === '/' ? path.basename(PAGE_FILE) : u.replace(/^\/+/, ''));
    fs.readFile(f, (e, buf) => { if (e) { rep.writeHead(404); rep.end('x'); return; }
      rep.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); rep.end(buf); });
  });
  await new Promise(r => srv.listen(9031, '127.0.0.1', r));
  let wsUrl = null;
  for (let i = 0; i < 80; i++) { try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch (e) {} if (wsUrl) break; await sleep(250); }
  const ws = new WebSocket(wsUrl); await new Promise(r => ws.addEventListener('open', r));
  const cdp = new CDP(ws);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const SID = (await cdp.send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await cdp.send('Page.enable', {}, SID); await cdp.send('Runtime.enable', {}, SID);
  const ev = async e => { const r = await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true }, SID);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text);
    return r.result.value; };
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:9031/' }, SID);
  // 等页面自己的脚本执行完（1.4 MB 的单文件 + Google Fonts，2 秒不一定够）
  for (let i = 0; i < 80; i++) {
    let ok = false;
    try { ok = await ev(`typeof openCatGame === 'function'`); } catch (e) {}
    if (ok) break;
    await sleep(250);
  }
  console.log('页面就绪:', await ev(`typeof openCatGame`));
  await ev('openCatGame()');
  await ev(`launchGame('shooter')`);
  for (let i = 0; i < 60; i++) {
    const ok = await ev(`(function(){const f=document.getElementById('gameShooterFrame');
      if(!f||!f.contentWindow) return false; try{return f.contentWindow.eval('typeof startGame')==='function';}catch(e){return false;}})()`);
    if (ok) break; await sleep(300);
  }
  await sleep(400);
  const st = () => ev(`(function(){const f=document.getElementById('gameShooterFrame');
    const a=document.activeElement;
    return { activeTag:a?a.tagName:'?', activeId:a?a.id:'', isIframe:a===f,
      childHasFocus:(function(){try{return f.contentWindow.document.hasFocus();}catch(e){return 'ERR';}})(),
      parentHasFocus:document.hasFocus() };})()`);
  console.log('① 现状（load 里只调了 contentWindow.focus）:', JSON.stringify(await st()));
  console.log('② 元素自身 focus() 之后          :',
    JSON.stringify(await ev(`(function(){document.getElementById('gameShooterFrame').focus();return 1;})()`).then(st)));
  await sleep(200);
  console.log('③ 再调 contentWindow.focus()      :',
    JSON.stringify(await ev(`(function(){const f=document.getElementById('gameShooterFrame');
      try{f.contentWindow.focus();}catch(e){} return 1;})()`).then(st)));
  await sleep(200);
  console.log('④ contentDocument.body.focus()    :',
    JSON.stringify(await ev(`(function(){const f=document.getElementById('gameShooterFrame');
      try{f.contentDocument.body.focus();}catch(e){} return 1;})()`).then(st)));
  await sleep(200);
  console.log('⑤ 再试元素 focus() + 子窗口 focus :',
    JSON.stringify(await ev(`(function(){const f=document.getElementById('gameShooterFrame');
      f.focus(); try{f.contentWindow.focus();}catch(e){} return 1;})()`).then(st)));
  // 真按一个键，看游戏有没有收到（最硬的判据）
  await ev(`(function(){const f=document.getElementById('gameShooterFrame');
    f.contentWindow.eval('window.__keys=[]; window.addEventListener("keydown", e=>window.__keys.push(e.code));'); return 1;})()`);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 }, SID);
  await sleep(200);
  console.log('⑥ 真发一个 keydown，iframe 收到的是:',
    JSON.stringify(await ev(`(function(){const f=document.getElementById('gameShooterFrame');
      try{return f.contentWindow.eval('window.__keys');}catch(e){return 'ERR';}})()`)));
  console.log('   父页面收到的:',
    JSON.stringify(await ev(`(window.__parentKeys||[])`)));
  try { await cdp.send('Browser.close', {}, SID); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
  try { srv.close(); } catch (e) {}
  try { require('child_process').spawn(process.execPath, ['-e', 'require("fs").rmSync(process.argv[1],{recursive:true,force:true,maxRetries:0})', profile], { detached: true, stdio: 'ignore' }).unref(); } catch (e) {}
  process.exit(0);
})();
