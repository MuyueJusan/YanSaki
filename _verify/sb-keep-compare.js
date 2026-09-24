// 「按原样解析」的终极证据：把原稿和解析后重新生成的产物放进同一个浏览器里，
// 逐元素比对**渲染出来的**几何与计算样式。
//
// 产出：
//   shots/keep-compare.html  原稿 / 解析后 左右对照（可以直接打开看）
//   shots/keep-compare.png   同一页的截图
// 并且把逐元素比对的结果当断言跑。
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
const log = m => console.log(m);

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
// 额外路由：对照页写在 _verify/shots/ 下，但静态服务的根是 saki.html 那个目录，
// 所以单独挂一条路径过去（不要去改静态服务的根）
const EXTRA_ROUTES = {};

function startServer() {
  const dir = path.dirname(PAGE_FILE), base = path.basename(PAGE_FILE);
  return new Promise((res, rej) => {
    const srv = http.createServer((req, rep) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      const f = EXTRA_ROUTES[u] || path.join(dir, u === '/' ? base : u.replace(/^\/+/, ''));
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

// 两份「处处是自定义」的手写状态栏。
//   inline —— 全内联 style，生成器画不出来的那些声明走 extra 那几层
//   class  —— 靠 <head> 里的 <style> + class 命中（运行时的界面是真 iframe，
//             这条路本来就该通）。class 挂在**每一层**上，一层都不能丢
const FIXTURES = [];

FIXTURES.push({ name: 'inline', maxRaw: 0, html: [
  '<!doctype html><html><head><meta charset="utf-8"></head><body>',
  '<div style="border:1px solid #5a3f6b;border-radius:10px;padding:9px 11px;margin:6px 0;',
  'color:#f0e6f5;font-size:13px;line-height:1.6;box-sizing:border-box;text-align:left;',
  'background:linear-gradient(160deg,#1a1024,#2b1733);',
  'box-shadow:0 4px 14px rgba(226,106,160,.35);width:430px;max-width:100%;">',

  '<div style="font-size:15px;font-weight:bold;color:#ffb3d9;text-align:center;',
  'margin:0 0 6px;line-height:1.4;white-space:pre-wrap">夜<br>状态</div>',

  '<div style="font-size:13px;color:#f0e6f5;text-align:left;margin:3px 0;',
  'white-space:pre-wrap;line-height:1.6;text-shadow:0 0 6px #ffb3d9;',
  'letter-spacing:1.5px;padding:2px 4px">第一行<br>第二行</div>',

  '<div style="margin:3px 0">',
  '<div style="display:flex;justify-content:space-between;font-size:11px;color:#a891b8;',
  'margin-bottom:3px"><span>体力</span>',
  '<span>{{format_message_variable::stat_data.体力}}</span></div>',
  '<div style="height:9px;background:#241a2e;border-radius:2px;overflow:hidden;',
  'border:1px solid #ff77bb">',
  '<div style="height:100%;width:0%;width:calc(({{get_message_variable::stat_data.体力}} - 0) / 100 * 100%);',
  'background:#ffb3d9;border-radius:2px;box-shadow:0 0 8px #ff77bb"></div></div></div>',

  '<div style="display:flex;align-items:center;gap:8px;margin:3px 0;font-size:13px;',
  'justify-content:flex-start"><span style="color:#a891b8;font-size:13px">信赖</span>',
  '<span style="position:relative;display:inline-block;line-height:1;letter-spacing:9px;',
  'white-space:nowrap"><span style="color:#5a3f6b">●●●●●</span>',
  '<span style="position:absolute;left:0;top:0;overflow:hidden;width:0px;',
  'width:calc(({{get_message_variable::stat_data.信赖}} - 0) / 5 * 85px);max-width:100%;',
  'color:#ffb3d9;text-shadow:0 0 4px #fff">●●●●●</span></span>',
  '<span style="color:#f0e6f5;font-weight:bold;font-size:13px">',
  '{{format_message_variable::stat_data.信赖}}</span></div>',

  '<div style="height:2px;background:#5a3f6b;margin:7px 0"></div>',

  '<div style="display:flex;gap:10px;align-items:center;margin:3px 0">',
  '<div style="flex:2 1 0;min-width:0">',
  '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;',
  'font-size:13px;margin:3px 0;text-align:left"><span style="color:#a891b8">金币</span>',
  '<span style="color:#f0e6f5;font-weight:bold">{{format_message_variable::stat_data.金币}}</span></div></div>',
  '<div style="flex:1 1 0;min-width:0">',
  '<div style="font-size:13px;color:#f0e6f5;text-align:right;margin:3px 0;',
  'white-space:pre-wrap;line-height:1.6">第 {{getvar::stat_data.天数}} 天</div></div>',
  '</div>',

  '</div>',
  '</body></html>'
].join('\n') });

// class 版：样式全在 <head> 的 <style> 里，靠 class 命中每一层。
// 这是「运行时是真 iframe」的直接后果 —— 编辑器必须把 class 一层不差地带回去
FIXTURES.push({ name: 'class', maxRaw: 3, html: [
  '<!doctype html><html><head><meta charset="utf-8">',
  '<style>',
  '.hp-panel{border:1px solid #5a3f6b;border-radius:10px;padding:9px 11px;',
  'background:linear-gradient(160deg,#1a1024,#2b1733);color:#f0e6f5;',
  'font-size:13px;line-height:1.6;box-shadow:0 4px 14px rgba(226,106,160,.35);width:430px}',
  '.hp-title{font-size:15px;font-weight:bold;color:#ffb3d9;text-align:center;',
  'margin:0 0 6px;line-height:1.4}',
  '.hp-k{color:#a891b8;letter-spacing:1.5px}',
  '.hp-v{color:#f0e6f5;font-weight:bold}',
  '.hp-track{height:9px;background:#241a2e;border-radius:2px;overflow:hidden;',
  'border:1px solid #ff77bb}',
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
].join('\n') });

const FIXTURE = FIXTURES[0].html;

// 在对照页里跑：把两边 iframe 的每个元素量一遍。
// **跳过 <br> / <style> / <script>** —— 这三个不该参与「渲染结果」的比对：
//   <br>     原稿的 <br> 被解析成文字块里的换行（配 pre-wrap 渲染出同样的断行），
//            DOM 上少一个元素但画出来一模一样
//   <style>  原稿写在 <head> 里，产物把它原样搬成了 body 里的高级块。
//            CSS 是全文档生效的，位置不同不影响渲染，但元素表会错位
const PROBE = `window.__probe = function (id) {
  var f = document.getElementById(id);
  var d = f.contentDocument;
  var w = f.contentWindow;
  var SKIP = { BR: 1, STYLE: 1, SCRIPT: 1 };
  var all = Array.prototype.slice.call(d.body.querySelectorAll('*'))
    .filter(function (el) { return !SKIP[el.tagName]; });
  var props = ['color','backgroundColor','backgroundImage','boxShadow','textShadow',
    'letterSpacing','paddingTop','paddingRight','paddingBottom','paddingLeft',
    'borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth',
    'borderTopColor','borderLeftColor','borderTopStyle','borderTopLeftRadius',
    'fontSize','fontWeight','textAlign','display','flexGrow','flexBasis','minWidth',
    'gap','lineHeight','whiteSpace','overflow','width','height','opacity',
    'marginTop','marginBottom','justifyContent','alignItems','position'];
  return all.map(function (el) {
    var r = el.getBoundingClientRect();
    var cs = w.getComputedStyle(el);
    var o = { tag: el.tagName,
      x: Math.round(r.x * 2) / 2, y: Math.round(r.y * 2) / 2,
      w: Math.round(r.width * 2) / 2, h: Math.round(r.height * 2) / 2 };
    props.forEach(function (p) { o[p] = cs[p]; });
    return o;
  });
};`;

function comparePage(origHtml, genHtml) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>原样解析对照</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 20px 22px 40px; background: #f6f8fb; color: #1f2733;
    font: 13px/1.6 'Segoe UI', system-ui, -apple-system, sans-serif; }
  h1 { font-size: 17px; margin: 0 0 4px; }
  .sub { color: #6b7a90; margin-bottom: 14px; }
  .verdict { display: inline-block; padding: 3px 10px; border-radius: 999px;
    font-weight: 700; font-size: 12px; margin-left: 8px; vertical-align: 2px; }
  .ok { background: #dff5e6; color: #14683a; border: 1px solid #a9dcbc; }
  .bad { background: #fde8e8; color: #8f1f1f; border: 1px solid #f0b4b4; }
  .cols { display: flex; gap: 18px; align-items: flex-start; flex-wrap: wrap; }
  .col { flex: 1 1 460px; min-width: 380px; background: #fff; border: 1px solid #dbe3ee;
    border-radius: 10px; overflow: hidden; }
  .col > h2 { margin: 0; padding: 9px 12px; font-size: 13px; background: #eef3fa;
    border-bottom: 1px solid #dbe3ee; color: #34455c; }
  .col > h2 span { color: #6b7a90; font-weight: 400; }
  iframe { display: block; width: 100%; border: 0; }
  .diffs { margin-top: 16px; background: #fff; border: 1px solid #dbe3ee;
    border-radius: 10px; padding: 10px 12px; }
  .diffs h3 { margin: 0 0 6px; font-size: 13px; }
  table { border-collapse: collapse; font-size: 12px; width: 100%; }
  th, td { border: 1px solid #e3e9f2; padding: 3px 7px; text-align: left; }
  th { background: #f2f6fb; }
  code { background: #eef2f7; padding: 1px 4px; border-radius: 4px; }
  .hint { color: #6b7a90; margin-top: 10px; }
</style></head><body>
<h1>「按原样解析」对照<span id="verdict" class="verdict">…</span></h1>
<div class="sub">左边是卡里那条手写的「状态栏界面」，右边是编辑器<b>解析成块、再重新生成</b>出来的产物。
逐元素的渲染位置与计算样式都会被量一遍 —— 两边一致，才算真的保住了原样。</div>
<div class="cols">
  <div class="col"><h2>原稿 <span>（卡里那条 replaceString）</span></h2>
    <iframe id="a" srcdoc="${escapeAttr(origHtml)}"></iframe></div>
  <div class="col"><h2>解析后重新生成 <span>（块 → HTML）</span></h2>
    <iframe id="b" srcdoc="${escapeAttr(genHtml)}"></iframe></div>
</div>
<div class="diffs" id="diffs"><h3>逐元素比对</h3><div id="dbody">测量中…</div></div>
<script>
${PROBE}
function fit(id) {
  var f = document.getElementById(id);
  var h = f.contentDocument.documentElement.scrollHeight;
  f.style.height = Math.max(h + 8, 60) + 'px';
}
var PROPS = ['x','y','w','h','color','backgroundColor','backgroundImage','boxShadow',
  'textShadow','letterSpacing','paddingTop','paddingRight','paddingBottom','paddingLeft',
  'borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth',
  'borderTopColor','borderLeftColor','borderTopStyle','borderTopLeftRadius',
  'fontSize','fontWeight','textAlign','display','flexGrow','flexBasis','minWidth',
  'gap','lineHeight','whiteSpace','overflow','width','height','opacity',
  'marginTop','marginBottom','justifyContent','alignItems','position'];
window.__run = function () {
  fit('a'); fit('b');
  var A = __probe('a'), B = __probe('b');
  var diffs = [];
  if (A.length !== B.length) {
    diffs.push({ el: '（元素个数）', prop: 'count', a: A.length, b: B.length });
  }
  for (var i = 0; i < Math.min(A.length, B.length); i++) {
    var keys = Object.keys(A[i]);
    for (var j = 0; j < keys.length; j++) {
      var k = keys[j];
      if (String(A[i][k]) !== String(B[i][k])) {
        diffs.push({ el: i + ' ' + A[i].tag, prop: k, a: A[i][k], b: B[i][k] });
      }
    }
  }
  var el = document.getElementById('verdict');
  el.textContent = diffs.length ? diffs.length + ' 处不同' : '完全一致';
  el.className = 'verdict ' + (diffs.length ? 'bad' : 'ok');
  var d = document.getElementById('dbody');
  if (!diffs.length) {
    d.innerHTML = '<b>' + A.length + ' 个元素</b>的位置、尺寸、颜色、间距、阴影、' +
      '字号、字距、边框、圆角、列宽 —— 全部一致。';
  } else {
    d.innerHTML = '<table><tr><th>元素</th><th>属性</th><th>原稿</th><th>解析后</th></tr>' +
      diffs.slice(0, 40).map(function (x) {
        return '<tr><td>' + x.el + '</td><td><code>' + x.prop + '</code></td><td>' +
          String(x.a) + '</td><td>' + String(x.b) + '</td></tr>';
      }).join('') + '</table>' +
      (diffs.length > 40 ? '<div class="hint">（只列前 40 条）</div>' : '');
  }
  return { n: A.length, diffs: diffs };
};
<\/script>
</body></html>`;
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 像素比对的载体：一个干干净净的页面，只有一个 iframe 钉在左上角。
// 原稿和解析产物各来一份，截同一块区域，直接比 PNG 字节
function pxPage(html) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:#fff}
  iframe{display:block;width:500px;height:1100px;border:0}
  </style></head><body><iframe id="f" srcdoc="${escapeAttr(html)}"></iframe></body></html>`;
}

(async () => {
  await pickPort();
  log(`静态服务 http://127.0.0.1:${HTTP_PORT}`);
  const cdpPort = 10100 + Math.floor(Math.random() * 150);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-sbkeep-'));
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu',
    '--no-first-run', '--hide-scrollbars',
    `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`], { stdio: 'ignore' });

  let cdp = null, SID = null, srv = null;
  const ev = async (expr, awaitPromise = false, timeout = 30000) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise }, SID, timeout);
    if (r.exceptionDetails) {
      throw new Error('页面异常: ' + (r.exceptionDetails.exception
        ? r.exceptionDetails.exception.description : r.exceptionDetails.text));
    }
    return r.result.value;
  };

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
    cdp.on('Page.javascriptDialogOpening', async () => {
      cdp.send('Page.handleJavaScriptDialog', { accept: true }, SID)
        .catch(e => console.log('  ⚠ 对话框没接住：' + (e && e.message)));
    });
    const errs = [];
    cdp.on('Runtime.consoleAPICalled', p => {
      if (p.type === 'error') errs.push((p.args || []).map(a => a.value || a.description).join(' '));
    });
    cdp.on('Runtime.exceptionThrown', p => {
      const d = p.exceptionDetails;
      errs.push('EXCEPTION: ' + (d.exception ? d.exception.description : d.text));
    });

    srv = await startServer();
    await cdp.send('Emulation.setDeviceMetricsOverride',
      { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }, SID);
    let loaded = new Promise(res => cdp.on('Page.loadEventFired', res));
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/` }, SID);
    await loaded;
    await ev('localStorage.clear()');
    loaded = new Promise(res => cdp.on('Page.loadEventFired', res));
    await cdp.send('Page.reload', {}, SID);
    await loaded;
    await ev(`document.fonts.ready.then(() => true)`, true);
    await sleep(500);

    await ev('openStEditor()');
    await ev(`stSwitchTab('mvu')`);
    await ev(`stMvuInstallClick()`);
    await ev(`stSwitchTab('sb')`);
    await sleep(200);

    // 像素比对的载体：一个干干净净的页面，只有一个 iframe 钉在左上角。
    // 原稿和解析产物各来一份，截同一块区域，直接比 PNG 字节
    const shot = async (name, w, h) => {
      await cdp.send('Emulation.setDeviceMetricsOverride',
        { width: w, height: h, deviceScaleFactor: 1, mobile: false }, SID);
      await sleep(350);
      const r = await cdp.send('Page.captureScreenshot', { format: 'png' }, SID);
      fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, 'base64'));
      console.log(`  📸 ${name} (${Math.round(Buffer.from(r.data, 'base64').length / 1024)} KB)`);
    };

    const clipShot = async url => {
      const l = new Promise(res => cdp.on('Page.loadEventFired', res));
      await cdp.send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}${url}` }, SID);
      await l;
      await sleep(450);
      const r = await cdp.send('Page.captureScreenshot',
        { format: 'png', clip: { x: 0, y: 0, width: 500, height: 1100, scale: 1 } }, SID);
      return r.data;
    };

    // 先把每一份都解析一遍（这一步必须在编辑器页面上做），
    // 再统一去对照页 —— 对照页会顶掉编辑器页面，两者不能交叉
    const results = [];
    for (let fi = 0; fi < FIXTURES.length; fi++) {
      const fx = FIXTURES[fi];
      console.log(`\n== 第 ${fi + 1} 份手写稿：${fx.name} ==`);
      const got = await ev(`(() => {
        const src = ${JSON.stringify(fx.html)};
        const r = stSbParseDoc(src);
        if (!r.ok) return { ok: false, why: r.why };
        const sb = stStatusBarFromRaw({
          theme: r.theme, width: r.width, shellExtra: r.shellExtra,
          shellCls: r.shellCls, shellOff: r.shellOff, blocks: r.blocks });
        const cls = [];
        (function w(l) { (l || []).forEach(b => {
          ST_SB_CLS_ROLES.forEach(role => {
            const c = stSbClsOf(b, role);
            if (c) cls.push(role + '=' + c);
          });
          w(b.children); }); })(r.blocks);
        return { ok: true, gen: stSbBodyHtml(sb, false), cls: cls,
          shellCls: sb.shellCls, kept: r.stats.keptDecls, keepOk: r.keepOk,
          textOk: r.textOk, raw: r.stats.raw,
          clsN: r.stats.cls, clsBare: r.stats.clsBare,
          live: stSbRuntimeInfo(stSbDocHtmlOf(sb)).live.length };
      })()`);
      results.push({ fx: fx, got: got });
      check('解析成功', got.ok, true);
      check('保留声明自检', got.keepOk, true, got.ok ? '' : got.why);
      check('文字对得上', got.textOk, true);
      check('退化成高级块的数量没超预期', got.raw, v => Number(v) <= fx.maxRaw,
        '≤' + fx.maxRaw);
      check('产物仍然满足运行时判定', got.live, 1);

      // 原稿里出现的 class，产物里必须一个不少
      const wantCls = (fx.html.match(/class="([^"]+)"/g) || [])
        .map(s => s.slice(7, -1)).filter((v, i, a) => a.indexOf(v) === i);
      const missCls = wantCls.filter(c =>
        got.gen.indexOf('class="' + c + '"') < 0 && got.shellCls !== c);
      check(`原稿的 ${wantCls.length} 个 class 全在产物里` +
        (wantCls.length ? '（' + wantCls.join(' / ') + '）' : ''),
        missCls, v => v.length === 0, missCls.join(' / '));

      // class 的账要数对：多少层挂着 class，其中多少层「一条内联都没写」
      // （后者长相全归作者那段 CSS，生成器对它一句内联都不能写）
      check('class 层数数对了', got.clsN, wantCls.length,
        '原稿 class="…" 出现 ' + wantCls.length + ' 次');
      check('「光靠 class」的层数不超过总层数', got.clsBare,
        v => Number(v) <= Number(got.clsN), '≤ ' + got.clsN);
      if (fx.name === 'class') {
        check('其中至少一层完全交给 CSS', got.clsBare, v => Number(v) >= 1);
      }

      // stSbLook 的语义单测：带 class 的层，只放行**原稿内联里写过**的属性。
      // 这条是整件事的根 —— 内联永远赢过 class，多写一条就是盖掉作者一条
      const look = await ev(`(function () {
        function mk(cls, own, text) {
          var b = stBlankSbBlock('text');
          if (cls) b.clsMap.outer = cls;
          b.clsOwn.outer = own || [];
          b.text = text || '';
          return b;
        }
        return {
          noCls: stSbLook(mk('', [], ''), 'outer', 'color:red;font-size:9px'),
          withCls: stSbLook(mk('hp-x', ['font-size']), 'outer', 'color:red;font-size:9px'),
          bare: stSbLook(mk('hp-x', []), 'outer', 'color:red;font-size:9px'),
          pre: [stSbPreWrap(mk('hp-x', [], '夜状态')),
                stSbPreWrap(mk('hp-x', [], 'a\\nb')),
                stSbPreWrap(mk('', [], '夜状态'))]
        };
      })()`);
      check('不带 class：原样返回，一条不动', look.noCls, 'color:red;font-size:9px');
      check('带 class：只留原稿写过的属性', look.withCls, 'font-size:9px;');
      check('光靠 class：一条都不写', look.bare, '');
      check('pre-wrap：class 层无换行不写 / 有换行才写 / 无 class 照旧写',
        JSON.stringify(look.pre), '[false,true,true]');
    }

    for (let fi = 0; fi < results.length; fi++) {
      const fx = results[fi].fx;
      const got = results[fi].got;
      console.log(`\n-- 对照：${fx.name} --`);

      // 原稿的 <head> 里可能有 <style>，产物把那些 style 变成了高级 HTML 块 ——
      // 两边都得带上，不然比的是「有没有样式」而不是「渲染结果」
      const headOf = h => (h.match(/<head>([\s\S]*?)<\/head>/) || ['', ''])[1]
        .replace(/<meta[^>]*>/gi, '');
      const bodyOf = h => h.replace(/^[\s\S]*?<body>/, '').replace(/<\/body>[\s\S]*$/, '');
      const origFull = '<!doctype html><html><head><meta charset="utf-8">' +
        headOf(fx.html) + '</head><body>' + bodyOf(fx.html) + '</body></html>';
      const genFull = '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
        got.gen + '</body></html>';

      const page = comparePage(origFull, genFull);
      const outFile = path.join(SHOTS, `keep-compare-${fx.name}.html`);
      fs.writeFileSync(outFile, page);
      EXTRA_ROUTES['/keep-compare-' + fx.name + '.html'] = outFile;

      const pxA = path.join(SHOTS, `px-${fx.name}-a.html`);
      const pxB = path.join(SHOTS, `px-${fx.name}-b.html`);
      fs.writeFileSync(pxA, pxPage(origFull));
      fs.writeFileSync(pxB, pxPage(genFull));
      EXTRA_ROUTES['/px-' + fx.name + '-a.html'] = pxA;
      EXTRA_ROUTES['/px-' + fx.name + '-b.html'] = pxB;

      loaded = new Promise(res => cdp.on('Page.loadEventFired', res));
      await cdp.send('Page.navigate',
        { url: `http://127.0.0.1:${HTTP_PORT}/keep-compare-${fx.name}.html` }, SID);
      await loaded;
      await sleep(700);

      const cmp = await ev(`window.__run()`);
      check('两边元素个数一致（跳过 <br>）', cmp.diffs.filter(d => d.prop === 'count').length, 0);
      check(`逐元素渲染完全一致（${cmp.n} 个元素）`,
        cmp.diffs, v => v.length === 0,
        cmp.diffs.slice(0, 6).map(d => `${d.el}.${d.prop}: ${d.a} ≠ ${d.b}`).join(' | '));

      const pageH = await ev(`document.documentElement.scrollHeight`);
      await shot(`keep-compare-${fx.name}.png`, 1400, Math.min(Math.max(pageH, 400), 4200));

      // ===== 像素级：同一块区域，原稿 vs 解析产物 =====
      await cdp.send('Emulation.setDeviceMetricsOverride',
        { width: 520, height: 1120, deviceScaleFactor: 1, mobile: false }, SID);
      const pngA = await clipShot('/px-' + fx.name + '-a.html');
      const pngB = await clipShot('/px-' + fx.name + '-b.html');
      fs.writeFileSync(path.join(SHOTS, `keep-px-${fx.name}-orig.png`), Buffer.from(pngA, 'base64'));
      fs.writeFileSync(path.join(SHOTS, `keep-px-${fx.name}-gen.png`), Buffer.from(pngB, 'base64'));
      check('像素级：原稿与产物的截图逐字节相同（500×1100）', pngA === pngB, true,
        pngA === pngB ? '' : `两张 PNG 不同 —— 看 shots/keep-px-${fx.name}-orig.png 与 keep-px-${fx.name}-gen.png`);

      await cdp.send('Emulation.setDeviceMetricsOverride',
        { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }, SID);
    }

    check('对照页零报错', errs, v => v.length === 0, errs.slice(0, 3).join(' | '));

  } catch (err) {
    fail++; fails.push('运行异常');
    console.log('❌ 运行异常: ' + (err && err.stack ? err.stack : err));
  } finally {
    try { if (srv) srv.close(); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
    // ⚠ profile 目录要自己删 —— 不删的话每跑一次就多一个（实测堆到 873 个 / 14.5 GB）。
    //   这一套要截 PNG，profile 里带的缓存最大。
    try { require('child_process').spawn(process.execPath, ['-e', 'require("fs").rmSync(process.argv[1],{recursive:true,force:true,maxRetries:0})', profile], { detached: true, stdio: 'ignore' }).unref(); } catch (e) {}
  }

  console.log(`\n===== 原样对照：${pass} 通过 / ${fail} 失败 =====`);
  if (fails.length) { console.log('失败项：'); fails.forEach(f => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
})();
