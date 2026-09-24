// _probe-tabs-anim.js —— 量「角色卡编写器」的展开键动画，并拿日历做对照。
// 一次性探针（`_` 前缀 ⇒ run-all 会跳过它）。
//
// 要回答的问题（**不猜，量**）：
//   ① 编写器的展开键（#st-tabs-btn）有没有 transition / 有没有会动的图标？
//   ② 点下去之后，左侧栏（#st-tabs）的宽度是**渐变**还是**跳变**？
//   ③ 日历那边（参照物）同样两问的答案是什么？
//
// 判据：**在点击后连续采样宽度**。渐变 = 采到中间值；跳变 = 只有起点和终点。
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
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
      rep.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'font/ttf' });
      rep.end(b);
    });
  });
  await new Promise(r => srv.listen(8867, '127.0.0.1', r));
  const port = 9502;
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-tabanim-'));
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }, SID);
  const loaded = new Promise(r => ws.addEventListener('message', function h(e) {
    const m = JSON.parse(e.data); if (m.method === 'Page.loadEventFired') r();
  }));
  await send('Page.navigate', { url: 'http://127.0.0.1:8867/' }, SID);
  await loaded; await sleep(900);

  // ── ① 静态：按钮自己有没有 transition、有没有会动的图标 ──────────
  await ev('openStEditor()');
  await sleep(500);
  const stat = await ev(`(() => {
    const b = document.getElementById('st-tabs-btn');
    const cs = getComputedStyle(b);
    const icon = b.querySelector('span');
    return {
      btnText: b.textContent.trim(),
      btnTransition: cs.transitionProperty + ' / ' + cs.transitionDuration,
      btnChildren: [...b.children].map(c => c.tagName + '.' + c.className + ':' + c.textContent),
      hasIconSpan: !!icon,
      railTransition: getComputedStyle(document.getElementById('st-tabs')).transitionProperty
                    + ' / ' + getComputedStyle(document.getElementById('st-tabs')).transitionDuration,
    };
  })()`);
  console.log('== 编写器 · 展开键静态 ==');
  console.log(JSON.stringify(stat, null, 1));

  // ── ② 动态：点下去之后连续采样「左侧栏宽度」+「箭头 transform」+「shell class」──
  const sampleRail = `(() => {
    window.__w = [];
    const rail = document.getElementById('st-tabs');
    const shell = document.getElementById('st-shell');
    const ico = document.querySelector('#st-tabs-btn .st-tabs-ico');
    const t0 = performance.now();
    const tick = () => {
      window.__w.push({
        t: Math.round(performance.now() - t0),
        w: parseFloat(getComputedStyle(rail).width).toFixed(1),
        ico: ico ? getComputedStyle(ico).transform : '(无箭头)',
        shellCls: shell.className,
      });
      if (performance.now() - t0 < 600) requestAnimationFrame(tick);
    };
    tick();
    return true;
  })()`;

  const show = (label, trace) => {
    console.log('\n== ' + label + ' ==');
    // 每 3 帧打一行，免得刷屏
    trace.filter((s, i) => i % 3 === 0).forEach(s =>
      console.log('  ' + String(s.t).padStart(4) + 'ms  w=' + String(s.w).padStart(6) + '  ico=' + s.ico +
                  '  shell="' + s.shellCls + '"'));
    const ws = trace.map(s => parseFloat(s.w));
    const mid = ws.filter(w => w > 47 && w < 167).length;
    const icos = new Set(trace.map(s => s.ico));
    console.log('  → 宽度的中间值帧数 = ' + mid + (mid > 3 ? '  ✅ 是渐变' : '  ❌ 像跳变'));
    console.log('  → 箭头 transform 取值数 = ' + icos.size + (icos.size > 3 ? '  ✅ 在转' : '  ❌ 没动/瞬变'));
  };

  await ev(sampleRail);
  await ev('stToggleTabs()');
  await sleep(800);
  show('折叠（168 → 46）', await ev('window.__w'));

  await ev(sampleRail);
  await ev('stToggleTabs()');
  await sleep(800);
  show('展开（46 → 168）', await ev('window.__w'));

  // 折叠态下强制重画一遍：状态必须由 stSyncTabsCollapsed 重新贴回去
  await ev('stToggleTabs()');
  await sleep(600);
  await ev('renderStEditor()');
  await sleep(300);
  const afterRerender = await ev(`(() => {
    const shell = document.getElementById('st-shell');
    const ico = document.querySelector('#st-tabs-btn .st-tabs-ico');
    return { shellCls: shell.className,
             railCls: document.getElementById('st-tabs').className,
             icoTransform: ico ? getComputedStyle(ico).transform : '(无箭头)' };
  })()`);
  console.log('\n== 折叠后重画一遍（状态要由 stSyncTabsCollapsed 贴回去）==');
  console.log(JSON.stringify(afterRerender));
  await ev('stToggleTabs()');   // 还原成展开

  // ── ③ 对照：日历的展开键 ──────────────────────────────────
  await ev('closeStEditor()');
  await sleep(400);
  const calStat = await ev(`(() => {
    const c = document.querySelector('.calendar-container');
    const btn = c.querySelector('.toggle-btn');
    const ico = btn ? btn.querySelector('.toggle-icon') : null;
    return {
      calCls: c.className,
      btnHTML: btn ? btn.outerHTML : '(无)',
      iconTransition: ico ? getComputedStyle(ico).transitionProperty + ' / ' + getComputedStyle(ico).transitionDuration : '(无图标)',
      iconTransformNow: ico ? getComputedStyle(ico).transform : '',
    };
  })()`);
  console.log('\n== 日历 · 展开键静态（参照物）==');
  console.log(JSON.stringify(calStat, null, 1));

  await ev(`(() => { window.__cw = []; const c = document.querySelector('.calendar-container');
    const ico = c.querySelector('.toggle-icon'); const t0 = performance.now();
    const tick = () => { window.__cw.push({ t: Math.round(performance.now()-t0),
        m: getComputedStyle(ico).transform });
      if (performance.now()-t0 < 500) requestAnimationFrame(tick); }; tick(); return true; })()`);
  await ev('toggleCalendar()');
  await sleep(600);
  const calTrace = await ev('window.__cw');
  console.log('\n== 日历 · 图标 transform 轨迹 ==');
  console.log(calTrace.filter((s, i) => i % 3 === 0).map(s => s.t + 'ms:' + s.m).join('\n'));

  ch.kill(); srv.close(); dropProf(); process.exit(0);
})().catch(e => { console.log('ERR', e.message); dropProf(); process.exit(1); });

// ⚠ Chrome 的 profile 目录要自己删（不删每跑一次多一个）。按前缀扫而不是用变量：
//   `prof` 在 IIFE 里面，外面那个 `.catch` 够不着。
function dropProf() {
  try {
    fs.readdirSync(os.tmpdir()).filter(x => x.startsWith('cdp-tabanim-')).forEach(x => {
      try { require('child_process').spawn(process.execPath, ['-e', 'require("fs").rmSync(process.argv[1],{recursive:true,force:true,maxRetries:0})', path.join(os.tmpdir(), x)], { detached: true, stdio: 'ignore' }).unref(); } catch (e) {}
    });
  } catch (e) {}
}
