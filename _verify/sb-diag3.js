// 抓 stSbLocate 无限递归的真凶：装一个深度守卫，超深就把当时的块结构和完整调用栈吐出来
// 关键：这里**照抄** sb-verify2.js 的写法（包括那句漏了 stEditor. 的 `stSbSel = ''`）
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
  await new Promise(r => srv.listen(8878, '127.0.0.1', r));
  const port = 9703;
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-diag3-'));
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
  await send('Page.navigate', { url: 'http://127.0.0.1:8878/' }, SID);
  await loaded; await sleep(700);
  await ev('openStEditor()');
  await ev(`stSwitchTab('mvu')`);
  await ev(`stMvuInstallClick()`);
  await ev(`stSwitchTab('sb')`);
  await sleep(200);

  // 装守卫
  console.log('装深度守卫:', await ev(`(() => {
    Error.stackTraceLimit = 200;
    window.__origLocate = stSbLocate;
    window.__depth = 0;
    window.__maxDepth = 0;
    stSbLocate = function(id, list, prefix) {
      window.__depth++;
      if (window.__depth > window.__maxDepth) window.__maxDepth = window.__depth;
      if (window.__depth > 25) {
        window.__depth = 0;
        const dump = (function walk(l, d) {
          return (Array.isArray(l) ? l : [{ __NOT_ARRAY__: Object.prototype.toString.call(l) }])
            .map(b => ({ d: d, id: String(b.id).slice(0, 8), type: b.type,
              chArr: Array.isArray(b.children), chRaw: b.children === undefined ? 'undef' : (b.children === null ? 'null' : typeof b.children),
              kids: Array.isArray(b.children) ? walk(b.children, d + 1) : [] }));
        })(stEditor.card.statusBar.blocks, 0);
        const err = new Error('DEPTH>25 id=' + id + ' | listIsArray=' + Array.isArray(list) +
          ' | prefix=' + prefix + ' | sbSel=' + stEditor.sbSel + ' | blocks=' + JSON.stringify(dump));
        err.__diag = true;
        throw err;
      }
      try { return window.__origLocate(id, list, prefix); } finally { window.__depth--; }
    };
    return typeof stSbLocate;
  })()`));

  const steps = [
    ['A: dots count=8', `stEditor.card.statusBar.blocks = []; stSbSel = ''; stSbSync(); stRerender(); stSbAddBlock('dots'); { const b = stSbSelected().block; stSet(stSbChain(b.id).slice(-1)[0].path + '.count','8'); }`],
    ['B: 清空 + divider', `stEditor.card.statusBar.blocks = []; stSbSel = ''; stSbSync(); stRerender(); stSbAddBlock('divider');`],
    ['B: divider 设色', `{ const d = stSbSelected().block; stSet(stSbChain(d.id).slice(-1)[0].path + '.color','#ff00aa'); }`],
    ['B: 加 space', `stSbAddBlock('space');`],
    ['B: space 高度 12', `{ const sp = stSbSelected().block; stSet(stSbChain(sp.id).slice(-1)[0].path + '.height','12'); }`],
    ['B: space 高度 0', `{ const sp = stSbSelected().block; stSet(stSbChain(sp.id).slice(-1)[0].path + '.height','0'); }`],
    ['B: 量颜色输入框', `document.querySelectorAll('.st-sb-insp input[type="color"]').length`],
    ['C: 清空 + html', `stEditor.card.statusBar.blocks = []; stSbSel = ''; stSbSync(); stRerender(); stSbAddBlock('html');`],
    ['C: html 文本', `{ const h = stSbSelected().block; stSet(stSbChain(h.id).slice(-1)[0].path + '.text','<b>RAW</b><i>'); }`],
    ['C: 加 text', `stSbAddBlock('text');`],
    ['C: text 文本', `{ const t = stSbSelected().block; stSet(stSbChain(t.id).slice(-1)[0].path + '.text','<b>ESC</b>'); }`],
    ['C: 量命中框', `document.querySelectorAll('#st-sb-canvas .st-sb-hit').length`],
    ['D: 清空 + title', `stEditor.card.statusBar.blocks = []; stSbSel = ''; stSbSync(); stRerender(); stSbAddBlock('title');`],
    ['D: title 设色', `{ const b = stSbSelected().block; stSet(stSbChain(b.id).slice(-1)[0].path + '.color','#ff0000'); }`],
    ['D: 量颜色输入框', `document.querySelectorAll('.st-sb-insp input[type="color"]').length`],
    ['D: stSbClearColor', `{ const b = stSbSelected().block; stSbClearColor(stSbChain(b.id).slice(-1)[0].path + '.color'); }`]
  ];

  for (const [name, code] of steps) {
    let r;
    try {
      const v = await ev(`(() => { window.__maxDepth = 0; ${code}; return { v: (function(){return 0;})(), md: window.__maxDepth, sel: stEditor.sbSel ? 'set' : 'empty', n: stEditor.card.statusBar.blocks.length }; })()`);
      r = `ok  maxDepth=${v.md}  sel=${v.sel}  n=${v.n}`;
    } catch (e) {
      r = '💥 ' + e.message.split('\n').slice(0, 14).join('\n      ');
    }
    console.log(`${name.padEnd(20)} ${r}`);
  }

  ch.kill(); srv.close(); dropProf(); process.exit(0);
})().catch(e => { console.log('ERR', e.message); dropProf(); process.exit(1); });

// ⚠ Chrome 的 profile 目录要自己删 —— 不删的话每跑一次就多一个（实测 cdp-* 堆到 873 个 / 14.5 GB）。
//   按前缀扫而不是用变量：`prof` 在 IIFE 里面，外面那个 `.catch` 够不着。
function dropProf() {
  try {
    fs.readdirSync(os.tmpdir()).filter(x => x.startsWith('cdp-diag3-')).forEach(x => {
      try { require('child_process').spawn(process.execPath, ['-e', 'require("fs").rmSync(process.argv[1],{recursive:true,force:true,maxRetries:0})', path.join(os.tmpdir(), x)], { detached: true, stdio: 'ignore' }).unref(); } catch (e) {}
    });
  } catch (e) {}
}
