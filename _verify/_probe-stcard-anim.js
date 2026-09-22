// _probe-stcard-anim.js —— 量「**主页上那张编写器卡片**」的展开键动画，拿日历做对照。
// 一次性探针（`_` 前缀 ⇒ run-all 会跳过它）。
//
// 要回答的问题（**不猜，量**）：
//   ① `#st-card` 的展开键里那个箭头（`.st-toggle-icon`）有没有 transition？
//   ② 点下去之后，它的 `transform` 是**渐变**还是**一动不动**？
//   ③ 日历那边（参照物）同样两问的答案是什么？
//   ④ 顺便拍两张「展开键特写」，用来肉眼比对（`--label` 进文件名，方便做修前 / 修后对照）
//
// 用法： node _probe-stcard-anim.js [标签]        # 标签默认 'now'
//
// ⚠ 判据是「**transform 取值数**」而不是「终值对不对」：
//   终值断言分不出「转过去」和「瞬移过去」，而「一动不动」跟「瞬移」在终值上**长得一样**。
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const PAGE_FILE = 'G:/saki/saki.html';
const SHOTS = path.join(__dirname, 'shots');
const LABEL = (process.argv[2] || 'now').replace(/[^\w-]/g, '');
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
  await new Promise(r => srv.listen(8868, '127.0.0.1', r));
  const port = 9503;
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-stcard-'));
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
  await send('Page.navigate', { url: 'http://127.0.0.1:8868/' }, SID);
  await loaded; await sleep(900);
  fs.mkdirSync(SHOTS, { recursive: true });

  // 元素特写：先 scrollIntoView，再按**页坐标** clip。
  // ⚠ `captureBeyondViewport: true` 要的是**页坐标**（rect + scroll），不是视口坐标 ——
  //   卡片一展开页面就会滚，用视口坐标截出来的是一条错位的横带。
  const shot = async (name, sel, scale = 2, pad = 8) => {
    const box = await ev(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
    })()`);
    if (!box) { console.log('  (截图跳过：找不到 ' + sel + ')'); return; }
    await sleep(150);
    const r = await send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true,
      clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
              width: box.w + pad * 2, height: box.h + pad * 2, scale }
    }, SID);
    const out = path.join(SHOTS, `stcard-${LABEL}-${name}.png`);
    fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
    console.log('  📷 ' + path.basename(out) + '  (' + box.w.toFixed(0) + '×' + box.h.toFixed(0) + ' @' + scale + 'x)');
  };

  // ── ① 静态：卡片的折叠机制 + 箭头自己的过渡 ──────────────────────
  const stat = await ev(`(() => {
    const card = document.getElementById('st-card');
    const ico = card.querySelector('.st-toggle-icon');
    const wrap = card.querySelector('.ai-collapse-wrapper');
    const cal = document.querySelector('.calendar-container .toggle-icon');
    const t = el => el ? getComputedStyle(el).transitionProperty + ' / ' +
                        getComputedStyle(el).transitionDuration : '(无)';
    return {
      cardCls: card.className,
      折叠态: card.classList.contains('ai-collapsed'),
      箭头HTML: ico ? ico.outerHTML : '(没有 .st-toggle-icon)',
      箭头过渡: t(ico),
      箭头当前transform: ico ? getComputedStyle(ico).transform : '(无)',
      折叠区过渡: t(wrap),
      '—— 日历（参照物）——': '',
      日历箭头过渡: t(cal),
      日历箭头transform: cal ? getComputedStyle(cal).transform : '(无)'
    };
  })()`);
  console.log('== 编写器卡片 · 展开键静态 ==');
  console.log(JSON.stringify(stat, null, 1));

  await shot('head-collapsed', '#st-card .ai-header', 3);

  // ── ② 动态：逐帧采样箭头的 transform + 卡片高度 ────────────────
  const sample = `(() => {
    window.__s = [];
    const card = document.getElementById('st-card');
    const ico = card.querySelector('.st-toggle-icon');
    const t0 = performance.now();
    const tick = () => {
      window.__s.push({ t: Math.round(performance.now() - t0),
        ico: ico ? getComputedStyle(ico).transform : '(无箭头)',
        h: Math.round(card.getBoundingClientRect().height) });
      if (performance.now() - t0 < 700) requestAnimationFrame(tick);
    };
    tick(); return true;
  })()`;

  const show = (label, trace) => {
    console.log('\n== ' + label + ' ==');
    trace.filter((s, i) => i % 4 === 0).forEach(s =>
      console.log('  ' + String(s.t).padStart(4) + 'ms  ico=' + s.ico + '  cardH=' + s.h));
    const icos = new Set(trace.map(s => s.ico));
    const hs = trace.map(s => s.h);
    const mid = hs.filter(h => h > Math.min(...hs) + 4 && h < Math.max(...hs) - 4).length;
    console.log('  → 箭头 transform 取值数 = ' + icos.size +
      (icos.size > 3 ? '  ✅ 在转（渐变）' : '  ❌ 没动 / 瞬变'));
    console.log('  → 卡片高度的中间值帧数 = ' + mid + (mid > 3 ? '  ✅ 内容是渐变收起' : '  ❌ 像跳变'));
  };

  await ev(sample);
  await ev('toggleStArea()');
  await sleep(900);
  show('展开（折叠 → 展开）', await ev('window.__s'));
  await shot('head-expanded', '#st-card .ai-header', 3);

  await ev(sample);
  await ev('toggleStArea()');
  await sleep(900);
  show('折叠（展开 → 折叠）', await ev('window.__s'));

  // ── ③ 对照：日历的箭头轨迹（同一个 `▲`、同一套缓动）─────────────
  await ev(`(() => { window.__c = []; const ico = document.querySelector('.calendar-container .toggle-icon');
    const t0 = performance.now();
    const tick = () => { window.__c.push({ t: Math.round(performance.now()-t0),
      ico: getComputedStyle(ico).transform });
      if (performance.now()-t0 < 600) requestAnimationFrame(tick); }; tick(); return true; })()`);
  await ev('toggleCalendar()');
  await sleep(700);
  const calTrace = await ev('window.__c');
  console.log('\n== 日历 · 箭头 transform 轨迹（参照物）==');
  console.log(calTrace.filter((s, i) => i % 4 === 0).map(s => s.t + 'ms: ' + s.ico).join('\n'));
  console.log('  → 取值数 = ' + new Set(calTrace.map(s => s.ico)).size);

  ch.kill(); srv.close(); dropProf(); process.exit(0);
})().catch(e => { console.log('ERR', e.message); dropProf(); process.exit(1); });

// ⚠ Chrome 的 profile 目录要自己删（不删每跑一次多一个）。按前缀扫而不是用变量：
//   `prof` 在 IIFE 里面，外面那个 `.catch` 够不着。
function dropProf() {
  try {
    fs.readdirSync(os.tmpdir()).filter(x => x.startsWith('cdp-stcard-')).forEach(x => {
      try { fs.rmSync(path.join(os.tmpdir(), x), { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); } catch (e) {}
    });
  } catch (e) {}
}
