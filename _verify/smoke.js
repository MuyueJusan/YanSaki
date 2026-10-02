// 全应用冒烟：改过 stSet 之后，确认 16 个选项卡都还能渲染、零 console 报错
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
  // ⚠⚠ **不要在本进程里删**：这台机器删一个文件要 ~200 ms，profile 有几百个文件 ⇒
  //   `rmSync(…, {maxRetries: 8})` 永不返回 ⇒ 卡住收尾 ⇒ **连汇总行都打不出来**。
  //   派一个**脱离的子进程**去删（第二十一轮；RULES.md 六之五十五）。
  try { if (chromeProf) require('child_process').spawn(process.execPath, ['-e', 'require("fs").rmSync(process.argv[1],{recursive:true,force:true,maxRetries:0})', chromeProf], { detached: true, stdio: 'ignore' }).unref(); } catch (e) {}
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

  console.log('== 编写器：16 个选项卡逐个切 ==');
  await ev('openStEditor()');
  const tabs = await ev(`(function(){ const out = [];
    document.querySelectorAll('[onclick*="stSwitchTab"]').forEach(el => {
      const m = /stSwitchTab\\('([^']+)'\\)/.exec(el.getAttribute('onclick')); if (m) out.push(m[1]); });
    return out; })()`);
  // ⚠⚠ 加 / 删选项卡必须同步改**六处**写死的数字（第二十一轮实测，别只改前三处）：
  //   ① 这里  ② `persona-verify.js`  ③ `st-code.js`
  //   ④ **`st-ai.js` 里那条 `选项卡数量 16`**（断言名同此处，别抄行号 —— 行号每轮都漂）
  //      —— 第二十一轮**漏了这一处**，是靠**整跑**才抓出来的（单跑该套件时它红，但
  //         当时只按「已知三处」的清单去改，没回头看这份清单本身就是漏的）
  //   ⑤ 外部 harness `…\2026-09-17-00-10-39\_verify\verify_steditor.js`
  //      —— `B6` / `C1` / `C12` / `C2`·`C3`（标签与 id 清单）/ `C4`（默认选中）/ `P69`
  //   ⑥ 外部 harness `…\verify_tavern_visual.js`
  //      —— `左侧有 N 个选项卡` / `选项卡文案齐全` / `默认选中` / `展开后 N 个标签` /
  //         `折叠后 N 个标签` / `移动端折叠后 N 个图标` / `tabWalk` 那两处清单
  //   ⚠⚠ 这份清单**改过三次：三处 → 五处 → 六处**，每一次都是「按上一版清单改完之后
  //      整跑又红」。结论不是「这次数对了」，而是：**清单本身是推导式的反面** ——
  //      它是手写枚举，手写枚举就一定会漏。真正可靠的做法是**整跑**（`run-all.js`
  //      把每一套的断言数打出来，对不上 README §7 表就是少走 / 有红）。
  //   ⚠ 下一轮再动选项卡，请**先 grep 出所有候选**（`grep -rn "个选项卡\|st-tab').length" _verify/`
  //      + 外部两处），别信这份清单的条数。
  check('选项卡数量 16', tabs.length, 16);
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

  // ── 世界时间：日期偏移徽标（`【D+1】` / `【D-1】`）────────────────────────
  // 需求：选了非本地时区后，如果**那个时区的日期**跟本地差一天，时钟旁边出现小字标记。
  // ⚠⚠ 期望值**不能拿产品那套算法算** —— 那是「两条路径读同一个值」，产品算错了期望值跟着错，
  //   删掉实现照样绿（RULES 六之二十六）。这里换一条**不同机制**：用
  //   `timeZoneName: 'longOffset'` 取该时区的 UTC 偏移分钟数，把 `Date.now()` 加上偏移后
  //   读它的 **UTC** 年月日 —— 跟产品那条 `formatToParts(year/month/day)` 不是一回事。
  // ⚠ 更不能写死「东京 = D+1」：同一个城市**上午看是同一天、晚上看就是下一天**，
  //   写死的话每天有半天是假红。所以从城市表里**现扫**出此刻真的跨了天的那个时区。
  // ⚠⚠ 断言名一律**不带动态值**（不放城市名 / 不放 `【D+1】`）—— 名字随时辰变的话，
  //   反向测试的「存在性闸门」会在别的时辰假红（那是闸门自己坏，不是产品坏）。
  //   会变的东西放 `actual` / `expect` 和下面那行 log 里，报红时照样看得到。
  console.log('== 世界时间：日期偏移徽标 ==');
  const offBadge = () => ev(`document.getElementById('clock-day-offset') ? document.getElementById('clock-day-offset').textContent : '(无此徽标)'`);
  check('前提：时钟卡片里有那个日期徽标元素', await offBadge(), v => v !== '(无此徽标)', '不是 (无此徽标)');

  // 独立算法：某个 IANA 时区「当天」的日序号（把该时区的本地日期折成 UTC 零点）
  const tzDayIndex = (tz) => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
      .formatToParts(new Date());
    const raw = (parts.find(p => p.type === 'timeZoneName') || {}).value || 'GMT';
    const m = raw.match(/GMT([+-])(\d{2}):(\d{2})/);           // 偏移为 0 时只有 "GMT"，落回 0
    const offMin = m ? (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10)) : 0;
    const t = new Date(Date.now() + offMin * 60000);
    return Math.floor(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) / 86400000);
  };
  const localDayIndex = () => {
    const n = new Date();
    return Math.floor(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / 86400000);
  };
  const expectBadge = (diff) => diff === 0 ? '' : '【D' + (diff > 0 ? '+' : '') + diff + '】';

  const tzList = await ev(`TIMEZONES.filter(t => t.value !== 'local').map(t => t.value)`);
  const L0 = localDayIndex();
  const crossed = tzList.map(v => ({ v, diff: tzDayIndex(v) - L0 })).filter(o => o.diff !== 0);
  // 覆盖率闸门：**必须真的有城市跨了天**，否则下一条根本没被测到（而它会「绿」）。
  // 本机 UTC+8 配这份城市表：本地 ≥11:00 时奥克兰是 D+1、<14:00 时檀香山是 D-1，
  // 两段覆盖全天 ⇒ 任何时刻都至少有一个跨天。
  check('前提：城市表里至少有一个时区此刻跨了天', crossed.length, n => n > 0, '>0');

  // 基准不标自己
  await ev(`(function(){ setClockTimezone('local'); return clockTimezone; })()`);
  await sleep(300);
  check('对照组：本地时间下徽标为空（基准不标自己）', await offBadge(), '');

  // 探针固定取**唯一一个**（|偏移| 最大的那个）⇒ 断言**恒好跑一次**，
  // 不会因为此刻是正偏移还是负偏移而多跑 / 少跑一条。
  crossed.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  const probe = crossed[0] || { v: 'local', diff: 0 };
  console.log('  此刻跨天的时区 ' + crossed.length + ' 个，探针取 ' + probe.v +
    '（期望 ' + expectBadge(probe.diff) + '）');
  await ev(`(function(){ setClockTimezone(${JSON.stringify(probe.v)}); return clockTimezone; })()`);
  await sleep(300);
  check('跨天的时区：徽标与独立算法一致（含方向）', await offBadge(), expectBadge(probe.diff));

  // 需求是「时钟**旁边**」⇒ 只断言文案不够，还得断言**位置**：徽标的左边缘在时钟右边缘的右边。
  // ⚠ 用 **rect 比较**（量出来的），别用 CSS 算 —— CSS 算不出「元素在视口里的 x」
  //   （RULES 六之六十二：挂在按钮上的弹层在会折行的容器里必然出界，调 max-width 治不了）。
  // ⚠ 徽标为空时 CSS 的 `:empty` 会把它 `display:none` ⇒ rect 全 0 ⇒ 这条**会红**。
  //   那是对的（「在旁边」的前提是它真的显示出来了），所以 R1 / R3 也把它算进 `red`。
  const badgeGeo = await ev(`(function(){
      const c = document.getElementById('clock'), b = document.getElementById('clock-day-offset');
      if (!c || !b) return '(缺元素)';
      const rc = c.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return { vis: getComputedStyle(b).display !== 'none',
               gap: Math.round(rb.left - rc.right), bw: Math.round(rb.width) };
    })()`);
  // ⚠ 把量到的数打出来：断言只报「过 / 不过」，而这两个数才是「它真的在旁边」的证据
  //   （也是唯一盯着**外观**的那点东西 —— 颜色仍然没有断言，见 RULES 六之八十五）。
  console.log('  徽标几何：display=' + (badgeGeo && badgeGeo.vis) +
    '  与时钟的间距=' + (badgeGeo && badgeGeo.gap) + 'px  宽=' + (badgeGeo && badgeGeo.bw) + 'px');
  check('跨天的时区：徽标在时钟右边（不是压在上面 / 飘到别处）',
    badgeGeo, g => !!g && g.vis === true && g.gap >= 0 && g.bw > 0, 'vis=true 且 gap>=0 且 bw>0');

  // 对照组：切回本地，徽标又变空 —— 证明上一条不是「反正一直有字」
  await ev(`(function(){ setClockTimezone('local'); return clockTimezone; })()`);
  await sleep(300);
  check('对照组：切回本地时间后徽标又变空', await offBadge(), '');

  // 「不该发生」的另一半：需求只说了**时钟旁边**，时区格子上**不该**冒出 D+ / D-。
  // ⚠ 先断言格子里**真有格子** —— 否则 `filter(...).length` 对空网格恒为 0，
  //   这条会变成**天生为真**（同族：兜底让断言永真，RULES 六之三十九）。
  const tzCellN = await ev(`document.querySelectorAll('#clock-tz-grid .tz-cell').length`);
  check('前提：时区网格里有格子', tzCellN, n => n > 0, '>0');
  check('时区格子上没有多余的 D+ / D- 标记',
    await ev(`Array.from(document.querySelectorAll('#clock-tz-grid .tz-cell')).filter(b => /D[+-]\\d/.test(b.textContent)).length`),
    0);

  // ── 日历「今日」按钮：**显示当前日** + 点它仍然回到今天 ──────────────────
  // 这个按钮原来写死「今日」两个字（2026-10-02 改），现在显示当前日（`2日` / `31日`）。
  // ⚠ 判据必须**现算** `new Date().getDate()`，**不能写死数字** —— 写死的话明天就假红，
  //   而假红久了就没人看（同族：文档里写死的数字没有断言盯着）。
  // ⚠ 必须配对照组：只断言「点完回到当前月」，在**本来就在当前月**时永远为真 ⇒
  //   先点 ＜ 离开当前月、断言「确实离开了」，再点回来。
  // ⚠ 两处点击都**判空后再点**：元素不在时 `null.click()` 会抛异常 ⇒ 整个套件中断、
  //   后面的断言一条都不跑、汇总行也不打 —— 「红」会悄悄变成「静默少走」。
  console.log('== 日历「今日」按钮 ==');
  const calDay = new Date().getDate();
  const calDayText = () => ev(`document.getElementById('today-btn') ? document.getElementById('today-btn').textContent : '(无此按钮)'`);
  check('按钮上显示的是当前日（' + calDay + '日）', await calDayText(), calDay + '日');
  // 前提：`＜` 在「日」视图下退的是**月**；若视图被切到「月 / 年」，它退的成了年 ⇒
  // 下面那条对照会**假红**（红的是前提，不是产品）。所以先把前提摆出来。
  check('前提：日历处于「日」视图',
    await ev(`(typeof currentMode === 'string') ? currentMode : '(取不到)'`), 'day');

  const calMonth = () => ev(`document.getElementById('title-month').textContent`);
  const calNowMonth = await calMonth();
  await ev(`(function(){ const b = document.querySelector('#calendar-card .cal-btn[onclick="handlePrev()"]'); if (b) b.click(); return !!b; })()`);
  await sleep(500);
  const calPrevMonth = await calMonth();
  check('对照组：点 ＜ 之后确实离开了当前月（' + calNowMonth + ' → ' + calPrevMonth + '）',
    calPrevMonth !== calNowMonth, true);
  // 「不该发生」的另一半：翻月**不该**动到按钮上那个日子 —— 它永远是今天，跟浏览到哪个月无关。
  // （只断言「点完能回本月」的话，一个「跟着 viewMonth 走」的实现照样能绿。）
  check('对照组：翻月之后按钮上的日子没变（仍是 ' + calDay + '日）', await calDayText(), calDay + '日');
  await ev(`(function(){ const b = document.getElementById('today-btn'); if (b) b.click(); return !!b; })()`);
  await sleep(500);
  check('点「今日」回到当前月（' + calNowMonth + '）', await calMonth(), calNowMonth);

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
