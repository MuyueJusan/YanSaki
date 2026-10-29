// 一次性探针：把「模板库」那个折叠块**展开**截一张图，人眼确认一遍排版。
//
// 为什么要有它：`persona-verify.js` 拍的那张 `persona-01-pane.png` 是**折叠状态**的
// 面板，新加的下拉 / 名字框 / 三个按钮全在折叠块**里面** —— 断言再全也看不出
// 「两个按钮挤成一行」「select 跟名字框不一样宽」这种问题。断言管行为，截图管长相。
//
// ⚠ 探针造的数据全在**临时 profile** 的 localStorage 里，关掉就没了，不污染真身。
const PAGE_FILE = 'G:/saki/saki.html';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { spawn } = require('child_process');
const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
function ck(name, actual, expect) {
  const a = JSON.stringify(actual), e = JSON.stringify(expect);
  if (a === e) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + '\n       实际 ' + a + '\n       期望 ' + e); }
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      }
    });
  }
  send(method, params = {}, sessionId, timeout = 30000) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const tm = setTimeout(() => { this.pending.delete(id); rej(new Error('timeout ' + method)); }, timeout);
      this.pending.set(id, { res: v => { clearTimeout(tm); res(v); }, rej: e => { clearTimeout(tm); rej(e); } });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
    });
  }
}

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-probe-tplshot-'));
  const port = 9711;
  spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
    '--hide-scrollbars', '--window-size=1280,1400',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`], { stdio: 'ignore' });
  const srv = http.createServer((req, rep) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const f = path.join(path.dirname(PAGE_FILE), u === '/' ? path.basename(PAGE_FILE) : u.replace(/^\/+/, ''));
    fs.readFile(f, (e, buf) => {
      if (e) { rep.writeHead(404); rep.end('x'); return; }
      rep.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      rep.end(buf);
    });
  });
  await new Promise(r => srv.listen(9044, '127.0.0.1', r));

  let wsUrl = null;
  for (let i = 0; i < 80; i++) {
    try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch (e) {}
    if (wsUrl) break; await sleep(250);
  }
  if (!wsUrl) { console.log('连不上 CDP'); process.exit(1); }
  const ws = new WebSocket(wsUrl); await new Promise(r => ws.addEventListener('open', r));
  const cdp = new CDP(ws);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const SID = (await cdp.send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await cdp.send('Page.enable', {}, SID);
  await cdp.send('Runtime.enable', {}, SID);
  await cdp.send('Emulation.setDeviceMetricsOverride',
    { width: 1280, height: 1400, deviceScaleFactor: 1, mobile: false }, SID);

  const ev = async (expr, awaitPromise = false) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise }, SID);
    if (r.exceptionDetails) throw new Error('页面异常: ' + (r.exceptionDetails.exception
      ? r.exceptionDetails.exception.description : r.exceptionDetails.text));
    return r.result.value;
  };
  const shot = async (name, sel) => {
    const clip = await ev(`(function(){
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return null;
      el.scrollIntoView({ block: 'start' });
      const r = el.getBoundingClientRect();
      return { x: Math.max(0, r.left + window.scrollX - 8), y: Math.max(0, r.top + window.scrollY - 8),
               width: Math.min(1272, r.width + 16), height: r.height + 16 };
    })()`);
    const r = await cdp.send('Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: true, ...(clip ? { clip: { ...clip, scale: 1 } } : {}) }, SID);
    const p = path.join(SHOTS, name);
    fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
    console.log('  📸 ' + name + ' (' + Math.round(fs.statSync(p).size / 1024) + ' KB)');
  };

  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:9044/' }, SID);
  const l = new Promise(res => {
    const h = () => { cdp.ws.removeEventListener('message', h); res(); };
    cdp.ws.addEventListener('message', h);
  });
  await Promise.race([l, sleep(8000)]);
  await sleep(1200);
  await ev(`document.fonts.ready.then(() => true)`, true);
  await sleep(400);

  const errs = [];
  // 打开编辑器 → 人设页 → 展开模板折叠块
  await ev(`openStEditor()`);
  await sleep(300);
  await ev(`stSwitchTab('persona')`);
  await sleep(400);

  // 造两份自定义模板，好让「改名 / 删掉这份」两个按钮也出现在画面里
  await ev(`(function(){
    stPersonaTplNameSet('简洁版');
    stPersonaTplSet('姓名:\\n年龄:\\n性别:\\n性格:');
    stPersonaTplSaveAs();
    stPersonaTplNameSet('细致版');
    stPersonaTplSet('姓名:\\n年龄:\\n外貌:\\n衣着:\\n性格:\\n喜好:');
    stPersonaTplSaveAs();
    stPersonaTplPick(stPersonaTplList()[0].id);
    stEditor.personaTplOpen = true;
    stRerender();
    return true; })()`);
  await sleep(500);

  // —— 轻量断言：图里该有的东西确实在（截图只是给人看的，不能当判据）——
  ck('下拉在', await ev(`!!document.getElementById('st-persona-tpl-pick')`), true);
  // ⚠ 别把内置份数写死（第三十六轮写死成「1 份内置」⇒ 第三十七轮变四份之后这条直接红）。
  //   从产品常量数出「内置几份」，再断言「内置几份 + 我造的两份」，两边的来源不同
  const nBuiltin = await ev(`ST_PERSONA_TPLS_BUILTIN.length`);
  const opts = await ev(`[...document.querySelectorAll('#st-persona-tpl-pick option')].map(o => o.textContent)`);
  ck('下拉选项 = 内置 ' + nBuiltin + ' 份 + 两份自定义',
    { n: opts.length, tail: opts.slice(-2), allBuiltin: opts.slice(0, -2).every(s => /（内置）$/.test(s)) },
    { n: nBuiltin + 2, tail: ['简洁版', '细致版'], allBuiltin: true });
  ck('折叠块是展开的（量外层网格容器自己，不是里面的 textarea）',
    await ev(`(function(){ const el = document.getElementById('st-persona-tpl-body');
      return el ? el.getBoundingClientRect().height > 100 : false; })()`), true);
  ck('内置那份不渲染「删掉这份」', await ev(`!!document.getElementById('st-persona-tpl-drop')`), false);

  await shot('tpl-lib-builtin.png', '#st-persona-tpl-fold');

  // 切到自定义那份，再拍一张（这时候改名 / 删除按钮都在）。
  // ⚠ 别用下标 `[1]` —— 内置份数一变它指的就是另一份（第三十七轮就是这么红的）
  await ev(`stPersonaTplPick(stPersonaTplList().filter(t => !t.builtin)[0].id);
    stEditor.personaTplOpen = true; stRerender()`);
  await sleep(400);
  ck('切到自定义之后「删掉这份」出来了',
    await ev(`!!document.getElementById('st-persona-tpl-drop')`), true);
  await shot('tpl-lib-custom.png', '#st-persona-tpl-fold');

  // 窄屏（手机宽度）再拍一张 —— 下拉 + 名字框 + 三个按钮挤不挤
  await cdp.send('Emulation.setDeviceMetricsOverride',
    { width: 430, height: 1200, deviceScaleFactor: 1, mobile: true }, SID);
  await sleep(500);
  await shot('tpl-lib-narrow.png', '#st-persona-tpl-fold');

  console.log('\n== 汇总 ==');
  console.log(pass + ' 通过 / ' + fail + ' 失败' + (errs.length ? '；页面异常 ' + errs.length : ''));

  try { srv.close(); } catch (e) {}
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('💥 ' + e.message); process.exit(1); });
