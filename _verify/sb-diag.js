// 定位栈溢出：逐句复现，每步检查每个块的 children 形状
const fs = require('fs'); const os = require('os'); const path = require('path');
const http = require('http'); const { spawn } = require('child_process');
const PAGE_FILE = 'G:/saki/saki.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => fs.existsSync(p));

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
  await new Promise(r => srv.listen(8877, '127.0.0.1', r));
  const port = 9701;
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-diag-'));
  const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`], { stdio: 'ignore' });
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
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true }, SID);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception.description);
    return r.result.value;
  };
  const loaded = new Promise(r => ws.addEventListener('message', function h(e) {
    const m = JSON.parse(e.data); if (m.method === 'Page.loadEventFired') r();
  }));
  await send('Page.navigate', { url: 'http://127.0.0.1:8877/' }, SID);
  await loaded; await sleep(700);
  await ev('openStEditor()');
  await ev(`stSwitchTab('mvu')`);
  await ev(`stMvuInstallClick()`);
  await ev(`stSwitchTab('sb')`);
  await sleep(200);

  const probe = `(() => {
    const out = [];
    const walk = (l, d) => (l || []).forEach(b => {
      out.push({ d: d, type: b.type, hasChildren: ('children' in b),
        cType: Object.prototype.toString.call(b.children), cLen: b.children ? b.children.length : null,
        cTruthy: !!b.children });
      walk(b.children, d + 1);
    });
    walk(stEditor.card.statusBar.blocks, 0);
    return { sel: stEditor.sbSel, n: stEditor.card.statusBar.blocks.length, blocks: out };
  })()`;

  const steps = [
    ['起手（模板起点）', `true`],
    ['A: 清空 + 加 dots', `stEditor.card.statusBar.blocks = []; stEditor.sbSel=''; stSbSync(); stRerender(); stSbAddBlock('dots');`],
    ['A: 改 count=8', `{ const b = stSbSelected().block; stSet(stSbChain(b.id).slice(-1)[0].path + '.count','8'); }`],
    ['B: 清空 + 加 divider', `stEditor.card.statusBar.blocks = []; stEditor.sbSel=''; stSbSync(); stRerender(); stSbAddBlock('divider');`],
    ['B: divider 设色', `{ const d = stSbSelected().block; stSet(stSbChain(d.id).slice(-1)[0].path + '.color','#ff00aa'); }`],
    ['B: 加 space', `stSbAddBlock('space');`],
    ['B: space 高度 12', `{ const sp = stSbSelected().block; stSet(stSbChain(sp.id).slice(-1)[0].path + '.height','12'); }`],
    ['B: space 高度 0（夹紧）', `{ const sp = stSbSelected().block; stSet(stSbChain(sp.id).slice(-1)[0].path + '.height','0'); }`],
    ['C: 清空 + 加 html', `stEditor.card.statusBar.blocks = []; stEditor.sbSel=''; stSbSync(); stRerender(); stSbAddBlock('html');`],
    ['C: html 文本', `{ const h = stSbSelected().block; stSet(stSbChain(h.id).slice(-1)[0].path + '.text','<b>RAW</b><i>'); }`],
    ['C: 加 text', `stSbAddBlock('text');`],
    ['C: text 文本', `{ const t = stSbSelected().block; stSet(stSbChain(t.id).slice(-1)[0].path + '.text','<b>ESC</b>'); }`],
    ['C: stSbDocHtml', `stSbDocHtml().length`],
    ['C: 量画布命中框', `document.querySelectorAll('#st-sb-canvas .st-sb-hit').length`],
    ['D: 清空', `stEditor.card.statusBar.blocks = []; stEditor.sbSel=''; stSbSync(); stRerender();`],
    ['D: 加 title', `stSbAddBlock('title');`],
    ['D: title 设色', `{ const b = stSbSelected().block; stSet(stSbChain(b.id).slice(-1)[0].path + '.color','#ff0000'); }`],
    ['D: 量颜色输入框', `document.querySelectorAll('.st-sb-insp input[type="color"]').length`],
    ['D: stSbClearColor', `{ const b = stSbSelected().block; stSbClearColor(stSbChain(b.id).slice(-1)[0].path + '.color'); }`]
  ];

  for (const [name, code] of steps) {
    let r;
    try {
      const v = await ev(`(() => { ${code}; return ${probe}; })()`);
      r = `n=${v.n} sel=${v.sel ? 'set' : 'empty'} ` +
        v.blocks.map(b => `${'  '.repeat(b.d)}${b.type}[has=${b.hasChildren},truthy=${b.cTruthy},len=${b.cLen}]`).join(' ');
    } catch (e) { r = '💥 ' + e.message.split('\n')[0]; }
    console.log(`${name.padEnd(24)} ${r}`);
  }
  ch.kill(); srv.close(); dropProf(); process.exit(0);
})().catch(e => { console.log('ERR', e.message); dropProf(); process.exit(1); });

// ⚠ Chrome 的 profile 目录要自己删 —— `mkdtempSync` 只负责建。不删的话**每跑一次就多一个**
//   （实测 cdp-* 堆到 873 个目录 / 14.5 GB）。按**前缀扫**而不是用变量：`prof` 在 IIFE 里面，
//   外面那个 `.catch` 够不着。函数声明会提升，所以上面两处调用写在定义之前没问题。
function dropProf() {
  try {
    fs.readdirSync(os.tmpdir()).filter(x => x.startsWith('cdp-diag-')).forEach(x => {
      try { fs.rmSync(path.join(os.tmpdir(), x), { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); } catch (e) {}
    });
  } catch (e) {}
}
