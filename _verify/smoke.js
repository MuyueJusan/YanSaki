// 全应用冒烟：改过 stSet 之后，确认 15 个选项卡都还能渲染、零 console 报错
const fs = require('fs'); const os = require('os'); const path = require('path');
const http = require('http'); const { spawn } = require('child_process');
const PAGE_FILE = 'G:/saki/saki.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => fs.existsSync(p));

// ⚠ Chrome 的 profile 目录要自己删 —— `mkdtempSync` 只负责建。不删的话**每跑一次就多一个**，
//   实测堆到 873 个目录 / 14.5 GB。放在模块作用域是为了**崩了也能删**（`prof` 在 IIFE 里面，
//   外面的 `.catch` 够不着）。`st-ai.js` 早就这么做了，这里是补齐。
let chromeProf = null;
const dropProf = () => {
  try { if (chromeProf) fs.rmSync(chromeProf, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); } catch (e) {}
};

let pass = 0, fail = 0;
function check(name, actual, pred, expect) {
  const ok = typeof pred === 'function' ? pred(actual) : actual === pred;
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}  actual=${JSON.stringify(actual)}  expect=${expect === undefined ? pred : JSON.stringify(expect)}`); }
}

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
  // 端口不能写死、也不能纯随机：连跑整套时上一轮 Chrome 还没退干净就会占着
  // 刚抽到的号，症状是「连不上 CDP」/「端口没起来」—— 跟被测页面一点关系都没有。
  // HTTP 那个也一样（原来写死 8881）。先试着真绑一下，绑得上才算数
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
    return lo + Math.floor(Math.random() * 400);
  };
  const HTTP_PORT = await pickFree(8800);
  await new Promise(r => srv.listen(HTTP_PORT, '127.0.0.1', r));
  const port = await pickFree(9400);
  const prof = (chromeProf = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-smoke-')));
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
  const send = (method, params = {}, sid) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params, ...(sid && { sessionId: sid }) }));
  });
  const on = (m, fn) => { if (!handlers.has(m)) handlers.set(m, []); handlers.get(m).push(fn); };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const SID = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await send('Page.enable', {}, SID); await send('Runtime.enable', {}, SID);
  const errs = [];
  on('Runtime.consoleAPICalled', p => { if (p.type === 'error') errs.push((p.args || []).map(a => a.value || a.description).join(' ')); });
  on('Runtime.exceptionThrown', p => errs.push('EXCEPTION: ' + (p.exceptionDetails.exception ? p.exceptionDetails.exception.description : p.exceptionDetails.text)));
  // 页内的 confirm 换成同步桩 —— **不再靠 CDP 的对话框自动应答**。
  // 那条路子实测约 20% 会翻车：Chrome 先一步把对话框撤掉，我们那句
  // Page.handleJavaScriptDialog 才到，回一个 -32602「No dialog is showing」，
  // 于是 confirm() 静默返回 false。表现出来只是某个断言莫名红一次，而且红在
  // 跟弹窗八竿子打不着的地方（就是下面那条「产物里有进度条宏」：模板没套上，
  // 画布上还是装 MVU 时播种的「简约数值行」—— 同样是 3 块，光看块数看不出来）。
  // 装进页里之后，「点确定」完全同步发生，跟 CDP 的时序无关
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__dlg = [];
      window.confirm = function (m) { window.__dlg.push(String(m)); return true; };`
  }, SID);
  // 保底：真弹出来了也得接住，而且**错误不能吞**
  on('Page.javascriptDialogOpening', p => {
    send('Page.handleJavaScriptDialog', { accept: true }, SID)
      .catch(e => console.log('  ⚠ 对话框没接住：' + (e && e.message)));
  });
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true }, SID);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception.description);
    return r.result.value;
  };
  const loaded = new Promise(r => on('Page.loadEventFired', r));
  await send('Page.navigate', { url: 'http://127.0.0.1:' + HTTP_PORT + '/' }, SID);
  await loaded; await sleep(800);

  console.log('== 主页面 ==');
  check('页面标题在', await ev(`document.title.length > 0`), true);
  check('主页面有可见区块', await ev(`document.querySelectorAll('body *').length`), n => n > 200, '>200');

  // ── 主页面上那张**编写器卡片**的展开键 ────────────────────────────────
  // ⚠ 卡片复用了 `.ai-*` 那套折叠机制（容器上 `ai-collapsed` + `.ai-collapse-wrapper`），
  //   但箭头**另起了个名字** `.st-toggle-icon` ⇒ 少写配套 CSS 时，折叠前后箭头一动不动
  //   （而折叠区本身照样在动，所以只看「内容有没有收起来」是抓不到的）。
  //   参照物 = **日历**的 `.toggle-icon`：同样的 `▲`、同样的 0.35s cubic-bezier、同样 180°。
  // ⚠ 对照组在下面：**展开态下箭头必须回到未旋转** —— 只断言「折叠时转了」是不够的，
  //   一个永远转着 180° 的箭头同样能过那一条。
  console.log('== 主页面：编写器卡片的展开键 ==');
  const stCardBefore = await ev(`(function(){
    const card = document.getElementById('st-card');
    const ico = card && card.querySelector('.st-toggle-icon');
    const cal = document.querySelector('.calendar-container .toggle-icon');
    const wrap = card && card.querySelector('.ai-collapse-wrapper');
    const dur = el => el ? (getComputedStyle(el).transitionDuration.split(',')[0] || '').trim() : '(无)';
    return {
      collapsed: card ? card.classList.contains('ai-collapsed') : null,
      hasIco: !!ico,
      icoProp: ico ? getComputedStyle(ico).transitionProperty : '(无箭头)',
      icoDur: dur(ico),
      calDur: dur(cal),
      icoNow: ico ? getComputedStyle(ico).transform : '(无箭头)',
      wrapProp: wrap ? getComputedStyle(wrap).transitionProperty : '(无折叠区)'
    };
  })()`);
  check('编写器卡片默认是折叠的', stCardBefore.collapsed, true);
  check('卡片展开键里有一个箭头元素', stCardBefore.hasIco, true);
  check('卡片箭头自己有 transform 过渡', /transform/.test(stCardBefore.icoProp), true);
  check('卡片箭头与日历的箭头时长一致（' + stCardBefore.icoDur + ' vs ' + stCardBefore.calDur + '）',
        stCardBefore.icoDur, stCardBefore.calDur);
  check('卡片折叠时箭头转到了 180°（matrix 首元素 -1）', /^matrix\(-1[,)]/.test(stCardBefore.icoNow), true);
  check('卡片折叠区自己有过渡（grid-template-rows）', /grid-template-rows/.test(stCardBefore.wrapProp), true);

  await ev('toggleStArea()');
  await sleep(600);
  const stCardAfter = await ev(`(function(){
    const card = document.getElementById('st-card');
    const ico = card.querySelector('.st-toggle-icon');
    return { collapsed: card.classList.contains('ai-collapsed'),
             ico: ico ? getComputedStyle(ico).transform : '(无箭头)' };
  })()`);
  check('卡片再点一次展开', stCardAfter.collapsed, false);
  check('卡片展开（对照组）箭头回到未旋转',
        stCardAfter.ico === 'none' || /^matrix\(1[,)]/.test(stCardAfter.ico), true);
  // 收回默认的折叠态，别给后面的小节留状态
  await ev('toggleStArea()');
  await sleep(600);

  console.log('== 编写器：15 个选项卡逐个切 ==');
  await ev('openStEditor()');
  const tabs = await ev(`(function(){ const out = [];
    document.querySelectorAll('[onclick*="stSwitchTab"]').forEach(el => {
      const m = /stSwitchTab\\('([^']+)'\\)/.exec(el.getAttribute('onclick')); if (m) out.push(m[1]); });
    return out; })()`);
  check('选项卡数量 15', tabs.length, 15);
  for (const t of tabs) {
    let r;
    try { r = await ev(`(function(){ stSwitchTab(${JSON.stringify(t)});
      const p = document.getElementById('st-panes');
      return { n: p ? p.innerHTML.length : -1, tab: stEditor.tab }; })()`); }
    catch (e) { r = { err: e.message.split('\n')[0] }; }
    check(`选项卡 ${t} 渲染`, r.err ? r.err : r.n, r.err ? false : n => n > 100, '>100');
  }

  // ── 展开键（折叠 / 展开）──────────────────────────────────────────────
  // ⚠ 这组是「展开键动画不对」那个 bug 的守卫。它守的**不是某个具体数值**，而是两个不变量：
  //   ① 展开键上那个箭头**自己会动**（有 transform 过渡）；
  //   ② 它的时长跟左侧栏的 `flex-basis` 过渡**一致** —— 两边不同步正是原来那个 bug 的形状
  //      （栏 0.22s、箭头根本没有过渡 ⇒ 看起来「动画不对」）。
  // ⚠ 对照组在下面：**展开态下箭头必须回到未旋转**。只断言「折叠时转了」是不够的 ——
  //   一个永远转着 180° 的箭头同样能过那一条。
  console.log('== 编写器：展开键 ==');
  const tabsAnim = await ev(`(function(){
    const btn = document.getElementById('st-tabs-btn');
    const ico = btn && btn.querySelector('span');
    const rail = document.getElementById('st-tabs');
    const dur = el => (getComputedStyle(el).transitionDuration.split(',')[0] || '').trim();
    return {
      hasIco: !!ico,
      icoProp: ico ? getComputedStyle(ico).transitionProperty : '(无箭头)',
      icoDur: ico ? dur(ico) : '(无箭头)',
      railDur: rail ? dur(rail) : '(无左侧栏)',
    };
  })()`);
  check('展开键里有一个箭头元素', tabsAnim.hasIco, true);
  check('箭头自己有 transform 过渡', /transform/.test(tabsAnim.icoProp), true);
  check('箭头与左侧栏时长一致（' + tabsAnim.icoDur + ' vs ' + tabsAnim.railDur + '）',
        tabsAnim.icoDur, tabsAnim.railDur);

  await ev('stToggleTabs()');
  await sleep(600);
  const railCollapsed = await ev(`(function(){
    const shell = document.getElementById('st-shell');
    const ico = document.querySelector('#st-tabs-btn span');
    return { shell: shell.className, rail: document.getElementById('st-tabs').className,
             ico: ico ? getComputedStyle(ico).transform : '(无箭头)' }; })()`);
  check('折叠：折叠态挂在按钮的祖先（.st-shell）上', /st-tabs-collapsed/.test(railCollapsed.shell), true);
  check('折叠：左侧栏也收起来了', /st-tabs-collapsed/.test(railCollapsed.rail), true);
  check('折叠：箭头转到了 180°（matrix 首元素 -1）', /^matrix\(-1[,)]/.test(railCollapsed.ico), true);

  // 重画一遍：状态必须由 stSyncTabsCollapsed 重新贴回去（两个调用点只调它一处）
  await ev('renderStEditor()');
  await sleep(200);
  const railRepaint = await ev(`(function(){
    const shell = document.getElementById('st-shell');
    return { shell: shell.className, rail: document.getElementById('st-tabs').className }; })()`);
  check('折叠后重画：.st-shell 的折叠态还在', /st-tabs-collapsed/.test(railRepaint.shell), true);
  check('折叠后重画：左侧栏的折叠态也还在', /st-tabs-collapsed/.test(railRepaint.rail), true);

  // 对照组：展开回去，箭头必须**回到**未旋转
  await ev('stToggleTabs()');
  await sleep(600);
  const railExpanded = await ev(`(function(){
    const shell = document.getElementById('st-shell');
    const ico = document.querySelector('#st-tabs-btn span');
    return { shell: shell.className, ico: ico ? getComputedStyle(ico).transform : '(无箭头)' }; })()`);
  check('展开（对照组）：.st-shell 上没有折叠态', /st-tabs-collapsed/.test(railExpanded.shell), false);
  check('展开（对照组）：箭头回到了未旋转', railExpanded.ico === 'none' || /^matrix\(1[,)]/.test(railExpanded.ico), true);

  console.log('== 编写器：装 MVU + 建变量 + 状态栏一条龙 ==');
  await ev(`stSwitchTab('mvu')`);
  await ev(`stMvuInstallClick()`);
  await ev(`stMvuQuickAdd(0)`);
  await ev(`stMvuQuickAdd(2)`);
  check('变量树 2 个变量', await ev(`stEditor.card.mvu.nodes.length`), 2);
  await ev(`stSwitchTab('sb')`);
  await ev(`stSbApplyTemplate(1)`);
  // 失败时把块列表一并打出来。这一段踩过一个坑：套模板之前画布上**已经有** MVU
  // 装完播种的那套「简约数值行」—— 同样是 **3 个块**，所以「块数 3」过了、宏那条
  // 却过不了。光看数字完全看不出差在哪，必须把类型和路径摊开
  const sbNow = await ev(`(function(){ const sb = stEditor.card.statusBar; const doc = stSbDocHtml();
    return { n: sb.blocks.length, list: sb.blocks.map(b => b.type + '|' + (b.path || '')).join(', '),
             get: doc.indexOf('get_message_variable') >= 0,
             dlg: (window.__dlg || []).length }; })()`);
  check('套模板前问了一句', sbNow.dlg, v => v >= 1, '>=1');
  check('套了「进度条面板」模板：' + sbNow.list, sbNow.n, 3);
  check('状态栏写进了正则', await ev(`stSbDetect().state`), 'mine');
  check('产物里有进度条宏' + (sbNow.get ? '' : '  ← 画布上是 ' + sbNow.list), sbNow.get, true);

  console.log('== 复古皮肤来回切 ==');
  check('切到复古', await ev(`(function(){ document.body.classList.add('retro-mode'); return document.body.classList.contains('retro-mode'); })()`), true);
  await sleep(150);
  check('切回复古前', await ev(`(function(){ document.body.classList.remove('retro-mode'); return document.body.classList.contains('retro-mode'); })()`), false);

  console.log('== 关闭再打开编写器 ==');
  check('关闭不炸', await ev(`(function(){ if (typeof closeStEditor === 'function') { closeStEditor(); return true; } return 'no-close'; })()`), v => v === true || v === 'no-close');
  await ev('openStEditor()');
  check('重开后卡片还在', await ev(`!!stEditor.card`), true);

  // ── 手机比例下的入口菜单 ──────────────────────────────────────────────
  // 窄屏 / 极扁窗口下，`#ai-card` 与 `#st-card` 被 CSS 收起，改由左上角一个按钮呼出。
  // ⚠ 最要命的一条是「**全屏时 `display` 不能是 none**」：放大态就是给 `#ai-card` 加
  //   `.ai-maximized` 变成 `position: fixed; inset: 0` 的；隐藏规则若写成裸的
  //   `#ai-card { display: none }`（不带 `:not(.ai-maximized)`），**表现是「点进去什么都不出来」**
  //   —— 而 class 照样加得上，所以只断言「有没有 ai-maximized」抓不到它，必须断言 computed display。
  console.log('== 手机比例：左上角入口菜单 ==');
  const mnavSetVp = (w, h) => send('Emulation.setDeviceMetricsOverride',
    { width: w, height: h, deviceScaleFactor: 1, mobile: false }, SID);
  const mnavDisp = sel => `(function(){ const el = document.querySelector(${JSON.stringify(sel)});
      return el ? getComputedStyle(el).display : '(无此元素)'; })()`;
  const mnavShown = v => v !== 'none' && v !== '(无此元素)';
  // ⚠ 下面这两个必须**判空**：功能还没实现时 `#mobile-nav` 根本不存在，直接
  //   `getElementById(...).classList` 会抛异常 ⇒ 整个套件**中断**，后面的断言一条都不跑、
  //   汇总行也不打 —— 于是「红」悄悄变成「静默少走」，正是本项目最怕的那种形状。
  //   判空之后它老老实实返回 false / 不动作，后续断言照常报红。
  const mnavOpen = () => `(function(){ const n = document.getElementById('mobile-nav');
      return !!(n && n.classList.contains('open')); })()`;
  const mnavClick = sel => `(function(){ const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return false; el.click(); return true; })()`;

  await mnavSetVp(390, 844);
  await sleep(400);

  check('手机视口下媒体查询命中',
    await ev(`window.matchMedia('(max-width: 600px), (max-height: 480px)').matches`), true);
  check('左上角菜单出现了', await ev(mnavDisp('#mobile-nav')), mnavShown, 'block');
  check('AI 对话卡片被收起', await ev(mnavDisp('#ai-card')), 'none');
  check('角色卡编写器卡片被收起', await ev(mnavDisp('#st-card')), 'none');
  // 对照组：只该收那两张，别的卡片不能跟着消失
  check('对照组：时钟卡片仍在', await ev(mnavDisp('#clock-tz-card')), mnavShown);
  check('对照组：日历卡片仍在', await ev(mnavDisp('#calendar-card')), mnavShown);

  check('菜单初始是收起的',
    await ev(mnavOpen()), false);
  await ev(mnavClick('#mobile-nav-btn'));
  await sleep(450);
  check('点一下菜单展开',
    await ev(mnavOpen()), true);
  check('展开后能看到「AI 对话」入口',
    await ev(`!!document.querySelector('#mobile-nav [onclick*="mobileOpenAi"]')`), true);
  check('展开后能看到「角色卡编写器」入口',
    await ev(`!!document.querySelector('#mobile-nav [onclick*="mobileOpenSt"]')`), true);

  await ev(mnavClick('#mobile-nav [onclick*="mobileOpenAi"]'));
  await sleep(450);
  check('点「AI 对话」后菜单自动收起',
    await ev(mnavOpen()), false);
  check('点「AI 对话」直接进全屏（加了 ai-maximized）',
    await ev(`document.getElementById('ai-card').classList.contains('ai-maximized')`), true);
  check('全屏遮罩也挂上了', await ev(`document.body.classList.contains('ai-max-on')`), true);
  // ⚠ 这一条才是真正的闸门（见上面那段注释）
  check('全屏时卡片没有被 display:none 压掉', await ev(mnavDisp('#ai-card')), mnavShown);
  check('全屏时是 fixed 定位',
    await ev(`getComputedStyle(document.getElementById('ai-card')).position`), 'fixed');
  check('全屏时铺满窗口宽度',
    await ev(`Math.round(document.getElementById('ai-card').getBoundingClientRect().width)`),
    w => w >= 380, '>=380');

  await ev(`toggleAiMaximize()`);
  await sleep(450);
  check('退出全屏',
    await ev(`document.getElementById('ai-card').classList.contains('ai-maximized')`), false);

  // 切回桌面视口：三件事都要复原。
  // 对照组 —— 只测「手机下藏起来」是不够的，一个「**永远**藏起来」的实现同样能过上面那些断言。
  await mnavSetVp(1280, 900);
  await sleep(400);
  check('切回桌面后 AI 卡片恢复显示', await ev(mnavDisp('#ai-card')), mnavShown);
  check('切回桌面后编写器卡片恢复显示', await ev(mnavDisp('#st-card')), mnavShown);
  check('切回桌面后左上角菜单隐藏', await ev(mnavDisp('#mobile-nav')), 'none');
  await send('Emulation.clearDeviceMetricsOverride', {}, SID);
  await sleep(250);

  // ── 手机比例：入口菜单的复古皮肤 + 「正在编哪张卡」标注 ──────────────────
  // ⚠ 「标在**面板里面**」是这一节的核心（2026-09-20 第二十二轮改的：原来标在外面、
  //   常显；用户要求挪进展开后的菜单，放在「角色卡编写器」那一项的**下面**）。
  //   所以判据不能只看「文本对不对」—— 名字还留在外面的实现，文本断言照样全绿。
  //   必须再加三条：①结构上**在**面板里；②几何上在「角色卡编写器」**下面**；
  //   ③**菜单收起时命中测试摸不到它**。
  //   ⚠ ③ 不能只量 `getBoundingClientRect()`：面板收起是 `grid-template-rows: 0fr`
  //   + `overflow: hidden`，**裁切不影响 rect** ⇒ 收起了 rect 照样非零（本项目踩过同款假绿）。
  //   ③ 还要配对照组「展开时摸得到」，否则一个 `display:none` 写死的实现同样能过。
  // ⚠ 复古那组也要有对照组：先量「没开复古时不是 Win98 灰」，否则「切到复古变灰」
  //   可能只是因为**默认就是灰的** —— 规则写没写都一样。
  console.log('== 手机比例：菜单复古皮肤 + 当前卡名 ==');
  await mnavSetVp(390, 844);
  await sleep(400);
  // ⚠ **先把编写器浮层关掉。** 它是满屏的、`z-index: 1200`，而左上角菜单只有 850 ⇒
  //   浮层开着的时候菜单整个被压在底下。上一版就是忘了关，hover 那条红得莫名其妙
  //   （鼠标实际落在 `st-topbar-actions` 上），而且「卡名可见」那条还**假绿**了 ——
  //   它只量了 `getBoundingClientRect()`，被挡住的元素 rect 照样非零。
  await ev(`(function(){ if (typeof closeStEditor === 'function' && stIsOpen()) closeStEditor(); return true; })()`);
  await sleep(500);
  check('前置：编写器浮层已关（否则下面量的是被压在底下的菜单）',
    await ev(`(function(){ const ov = document.getElementById('st-overlay');
        return !!(ov && !ov.classList.contains('active')); })()`), true);
  await ev(`(function(){ document.body.classList.remove('retro-mode'); return true; })()`);
  await sleep(200);

  const mnavBgOf = sel => `(function(){ const el = document.querySelector(${JSON.stringify(sel)});
      return el ? getComputedStyle(el).backgroundColor : '(无此元素)'; })()`;
  const mnavRadiusOf = sel => `(function(){ const el = document.querySelector(${JSON.stringify(sel)});
      return el ? getComputedStyle(el).borderTopLeftRadius : '(无此元素)'; })()`;
  const mnavBordersOf = sel => `(function(){ const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return '(无此元素)'; const cs = getComputedStyle(el);
      return [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor].join(' | '); })()`;
  // Win98 的两种立体边框：凸起 = 上/左亮 + 下/右暗；凹陷 = 反过来
  const RAISED = 'rgb(255, 255, 255) | rgb(128, 128, 128) | rgb(128, 128, 128) | rgb(255, 255, 255)';
  const SUNKEN = 'rgb(128, 128, 128) | rgb(255, 255, 255) | rgb(255, 255, 255) | rgb(128, 128, 128)';
  const WIN98_FACE = 'rgb(192, 192, 192)';
  const CLEAR = v => v === 'rgba(0, 0, 0, 0)' || v === 'transparent';
  // ⚠ 颜色按**数值**比，别按字符串比。按钮上挂着 `transition: background 0.3s ease`，
  //   过渡还没落定时 Chrome 给的是 `rgba(192, 192, 192, 1)`、落定后是 `rgb(192, 192, 192)` ——
  //   **两者是同一个颜色**。写死字符串的话，这条断言会变成「睡多久才不算红」的骰子
  //   （本项目踩过同款：`sleep(350)` 对 `0.35s` 的过渡正好落在边界上）。
  const rgbEq = (a, b) => {
    const tri = c => (String(c).match(/[\d.]+/g) || []).slice(0, 3).join(',');
    return tri(a) === tri(b);
  };
  const navNameTxt = `(document.getElementById('mobile-nav-name') || {}).textContent || ''`;

  // —— ① 当前卡名标注 ——
  // 名字自己写死，别依赖草稿的默认值（默认可能是空 ⇒ 后面几条全是**空对空**）
  const origNavName = await ev(`String((stEditor.card && stEditor.card.name) || '')`);
  const navNameA = await ev(`(function(){ stSet('card.name', '烟测·卡名甲');
      return ${navNameTxt}; })()`);
  check('手机比例下左上角标出了当前卡名', navNameA, v => String(v).indexOf('烟测·卡名甲') >= 0, navNameA);
  // 「跟着变」而不是「碰巧渲染了个固定串」
  const navNameB = await ev(`(function(){ stSet('card.name', '烟测·卡名乙');
      return ${navNameTxt}; })()`);
  check('改名后标注跟着变（消费方读的是同一份数据）',
    navNameB, v => String(v).indexOf('烟测·卡名乙') >= 0 && String(v).indexOf('烟测·卡名甲') < 0, navNameB);
  // 结构判据：挂在面板**里面**（这一次的要求正好反过来）
  check('卡名挂在菜单面板里面（「在里面」）',
    await ev(`(function(){ const n = document.getElementById('mobile-nav-name');
        return !!(n && n.closest('.mobile-nav-panel')); })()`), true);

  // 命中测试：摸得到才算「看得见」。⚠ 被别的浮层盖住时 rect 照样非零
  //   （上一版只量 rect，于是被编写器浮层盖着也照样绿 —— 假绿）。
  const navNameHit = `(function(){ const n = document.getElementById('mobile-nav-name');
      if (!n) return '(无此元素)'; const r = n.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return 'rect 是 0';
      const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
      if (!(hit && (hit === n || n.contains(hit)))) return '被挡：' + (hit ? (hit.id || hit.className) : 'null');
      return 'ok'; })()`;

  // 展开菜单 → 量「在角色卡编写器下面」+ 对照组「摸得到」
  await ev(mnavClick('#mobile-nav-btn'));
  await sleep(450);
  check('对照组：菜单展开后卡名摸得到（下面「收起后摸不到」的前提）',
    await ev(navNameHit), 'ok');
  check('卡名在「角色卡编写器」那一项的下面',
    await ev(`(function(){ const n = document.getElementById('mobile-nav-name');
        const it = document.querySelectorAll('.mobile-nav-item')[1];
        if (!n || !it) return '(缺元素)';
        const a = n.getBoundingClientRect(), b = it.getBoundingClientRect();
        return { nameTop: Math.round(a.top), itemBottom: Math.round(b.bottom) }; })()`),
    v => !!(v && typeof v === 'object' && v.nameTop >= v.itemBottom - 1),
    'nameTop >= itemBottom');

  // 收起菜单 → 卡名应该摸不到了（被面板裁掉）
  await ev(`(function(){ const n = document.getElementById('mobile-nav');
      if (n) n.classList.remove('open'); return true; })()`);
  await sleep(450);
  check('菜单收起后卡名摸不到了（收进面板里 = 用户要的效果）',
    await ev(navNameHit), v => v !== 'ok', '≠ok');

  check('对照组：改回原名，标注也跟回去（没名字时整块收掉）',
    await ev(`(function(){ stSet('card.name', ${JSON.stringify(origNavName)});
        const el = document.getElementById('mobile-nav-name');
        return { txt: el ? el.textContent : '(无此元素)',
                 disp: el ? getComputedStyle(el).display : '(无此元素)' }; })()`),
    v => origNavName.trim()
        ? String(v.txt).indexOf(origNavName) >= 0
        : (v.txt === '' && v.disp === 'none'),
    origNavName);

  // —— ② 复古皮肤（Win98 / Win2000 的下拉菜单）——
  check('对照组：非复古时按钮不是 Win98 灰',
    await ev(mnavBgOf('#mobile-nav-btn')), v => !rgbEq(v, WIN98_FACE), '≠' + WIN98_FACE);
  check('对照组：非复古时按钮是圆角',
    await ev(mnavRadiusOf('#mobile-nav-btn')), v => v !== '0px', '≠0px');
  check('对照组：非复古时菜单项不是透明底',
    await ev(mnavBgOf('.mobile-nav-item')), v => !CLEAR(v), '≠transparent');

  await ev(`document.body.classList.add('retro-mode')`);
  await sleep(600);   // > 按钮那条 0.3s 过渡，别让它正好落在边界上
  check('复古：按钮变成 Win98 灰',
    await ev(mnavBgOf('#mobile-nav-btn')), v => rgbEq(v, WIN98_FACE), WIN98_FACE);
  check('复古：按钮圆角归零', await ev(mnavRadiusOf('#mobile-nav-btn')), '0px');
  check('复古：按钮是凸起立体边框', await ev(mnavBordersOf('#mobile-nav-btn')), RAISED);
  check('复古：卡名标签是 Win98 灰',
    await ev(mnavBgOf('#mobile-nav-name')), v => rgbEq(v, WIN98_FACE), WIN98_FACE);
  check('复古：卡名标签是凹陷边框（状态栏那种只读质感）',
    await ev(mnavBordersOf('#mobile-nav-name')), SUNKEN);

  await ev(mnavClick('#mobile-nav-btn'));
  await sleep(450);
  check('复古：菜单框是 Win98 灰',
    await ev(mnavBgOf('.mobile-nav-box')), v => rgbEq(v, WIN98_FACE), WIN98_FACE);
  check('复古：菜单框是凸起立体边框', await ev(mnavBordersOf('.mobile-nav-box')), RAISED);
  check('复古：菜单项自己没有底色（Win98 菜单项是平的）',
    await ev(mnavBgOf('.mobile-nav-item')), CLEAR, 'transparent');
  check('复古：菜单项圆角归零', await ev(mnavRadiusOf('.mobile-nav-item')), '0px');
  // ⚠ `display: flex` 的 `<button>` 宽度按 fit-content 算，不靠 `stretch` 对齐就会一长一短 ——
  //   判据用**宽度集合的大小**：只有一种宽度才算齐（`new Set` 之后长度必须是 1）
  check('两个菜单项等宽（右边缘不锯齿）',
    await ev(`(function(){ const w = [...document.querySelectorAll('.mobile-nav-item')]
        .map(el => Math.round(el.getBoundingClientRect().width));
        return { widths: w, kinds: [...new Set(w)].length }; })()`),
    v => v.widths.length >= 2 && v.kinds === 1, '宽度只有一种');

  // 真把鼠标移上去：Win98 的菜单项高亮是**海军蓝底 + 白字**
  const navItemBox = await ev(`(function(){ const el = document.querySelector('.mobile-nav-item');
      if (!el) return null; const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  if (navItemBox) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: navItemBox.x, y: navItemBox.y }, SID);
    await sleep(500);
    // ⚠ 失败时要把「鼠标到底落在谁身上」一起报出来 —— 只报「不是海军蓝」的话，
    //   「hover 没生效」和「鼠标压根没落在这个元素上」两种情况看起来一模一样
    const navHover = await ev(`(function(){ const el = document.querySelector('.mobile-nav-item');
        const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(${navItemBox.x}, ${navItemBox.y});
        return { bg: cs.backgroundColor, fg: cs.color, hover: el.matches(':hover'),
                 hit: hit ? (hit.id || hit.className || hit.tagName) : null,
                 rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(',') }; })()`);
    check('复古：鼠标移到菜单项上是海军蓝底 + 白字',
      navHover, v => v.bg === 'rgb(0, 0, 128)' && v.fg === 'rgb(255, 255, 255)', navHover);
    // 对照组：移开必须**恢复** —— 只断言「移上去变蓝」的话，永远蓝的实现同样能过
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 }, SID);
    await sleep(500);
    check('对照组：鼠标移开后菜单项恢复透明',
      await ev(mnavBgOf('.mobile-nav-item')), CLEAR, 'transparent');
  } else {
    check('复古：菜单项存在（量 hover 的前提）', '(找不到 .mobile-nav-item)', v => v === 'ok');
  }

  await ev(`(function(){ document.body.classList.remove('retro-mode');
      const n = document.getElementById('mobile-nav'); if (n) n.classList.remove('open');
      return true; })()`);
  await sleep(300);
  check('对照组：退出复古后按钮不再是 Win98 灰',
    await ev(mnavBgOf('#mobile-nav-btn')), v => !rgbEq(v, WIN98_FACE));
  await send('Emulation.clearDeviceMetricsOverride', {}, SID);
  await sleep(250);

  console.log('\n== 收尾 ==');
  check('整轮无 console 错误 / 未捕获异常', errs.length ? errs.slice(0, 3) : 0, 0);

  console.log(`\n========== ${pass} passed, ${fail} failed ==========`);
  ch.kill(); srv.close(); dropProf(); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR', e.message); dropProf(); process.exit(1); });
