// 小游戏「复古线框战机」—— 把 `retro_vector_space_shooter` 内联进主页、在弹窗里玩
//
// 要证的六件事：
//   ① 内联进去的那份**就是**游戏源文件（逐字节）—— 转义写错不会报错，
//      只会让游戏里某个正则 / 标签悄悄失效，只有逐字节比对抓得住
//   ② 菜单里多出第 4 项，走**真按钮的 onclick** 能把它打开（验的正是「接对了没有」）
//   ③ iframe 里的游戏**真的起来了**（文档解析完、选机页可见、战机卡数 == 源码里的预设数）
//   ④ 点战机卡**真的能开局**（gameState → PLAYING），而且循环真的在跑（不是静止画面）
//   ⑤ 返回菜单 / 关弹窗 / 切到别的游戏 —— 三条路都要把 iframe **摘掉**。
//      那个游戏的 gameLoop 在非 PLAYING 态**照样** requeue，藏起来 = 后台满帧空转，
//      所以这一条不是「清理卫生」，是**功能正确性**
//   ⑥ 三个老游戏一条都没被弄坏（对照组）
//
// 九段：A 装载 / B 内联源码 / C 菜单与挂载 / D iframe 里的游戏 / E 开局 /
//       F 卸载（三条路）/ G 老游戏回归 / H 关窗 / I 收尾零报错
//
// ⚠ 这个套件**依赖** `G:\retro_vector_space_shooter (1).html` 还在（B 段要拿它逐字节比）。
//   它不在就会硬红并说清楚为什么 —— 不许静默降级成「看看长度差不多就行」。
//
// 跑法：node game-verify.js

const PAGE_FILE = 'G:/saki/saki.html';
const SHOOTER_FILE = 'G:/retro_vector_space_shooter (1).html';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
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
const t0 = Date.now();
const log = m => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
const sha1 = s => crypto.createHash('sha1').update(s, 'utf8').digest('hex');

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
  send(method, params = {}, sessionId, timeout = 60000) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const tm = setTimeout(() => { this.pending.delete(id); rej(new Error(`CDP 超时 ${method}`)); }, timeout);
      this.pending.set(id, { res: v => { clearTimeout(tm); res(v); }, rej: e => { clearTimeout(tm); rej(e); } });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
    });
  }
}

// 端口跟别的套件错开：连跑整套时上一轮 Chrome 还没退干净就会占着号，
// 症状是「调试端口没起来」—— 跟被测页面一点关系都没有
const CANDIDATES = [9020, 9021, 9022, 9023];
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
function startServer() {
  const dir = path.dirname(PAGE_FILE), base = path.basename(PAGE_FILE);
  return new Promise((res, rej) => {
    const srv = http.createServer((req, rep) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      const f = path.join(dir, u === '/' ? base : u.replace(/^\/+/, ''));
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

(async () => {
  await pickPort();
  const cdpPort = await (async () => {
    for (let i = 0; i < 80; i++) {
      const p = 9500 + Math.floor(Math.random() * 900);
      const free = await new Promise(res => {
        const probe = http.createServer();
        probe.on('error', () => { try { probe.close(); } catch (e) {} res(false); });
        probe.listen(p, '127.0.0.1', () => probe.close(() => res(true)));
      });
      if (free) return p;
      await sleep(40);
    }
    return 9500 + Math.floor(Math.random() * 900);
  })();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-game-'));
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu',
    '--no-first-run', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required',
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
  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' }, SID);
    fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, 'base64'));
    console.log(`  📸 ${name} (${Math.round(Buffer.from(r.data, 'base64').length / 1024)} KB)`);
  };

  // ── iframe 里的求值 ────────────────────────────────────────
  // `srcdoc` 的 iframe **继承父页面的源**，所以同源可达。
  // ⚠ 但**不能**写成 `frame.contentWindow.gameState`：游戏里那些是 `let` 顶层声明，
  //   属于**全局词法环境**，不是 window 的属性 —— 那样读只会得到 undefined，
  //   而 undefined 会让「开局了没」这类断言**静默变成假红**。
  //   `w.eval(…)` 是**间接 eval**，跑在那个 realm 的全局作用域里，看得见 `let`。
  const fe = (expr) => ev(`(function(){
    const f = document.getElementById('gameShooterFrame');
    if (!f) return '__NO_FRAME__';
    const w = f.contentWindow;
    if (!w) return '__NO_WINDOW__';
    try { return w.eval(${JSON.stringify(expr)}); } catch (e) { return 'ERR:' + e.message; }
  })()`);

  // 轮询等条件成立。⚠ 别写死 sleep —— CDN 那支 tailwind 是**阻塞脚本**，
  //   网络慢的时候游戏脚本要几秒才执行到。
  const waitFor = async (fn, ms = 25000, step = 200) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (await fn()) return true;
      await sleep(step);
    }
    return false;
  };

  const menuItems = () => ev(`[...document.querySelectorAll('#gameMenuList .game-item-btn')]
    .map(b => ({ title: b.querySelector('.game-item-title').textContent.trim(),
                 fn: (b.getAttribute('onclick') || '') }))`);
  const clickMenuItem = (i) => ev(`(function(){
    const b = document.querySelectorAll('#gameMenuList .game-item-btn')[${i}];
    if (!b) return false;
    b.click(); return true; })()`);
  const cardW = () => ev(`Math.round(document.getElementById('gameCard').getBoundingClientRect().width)`);
  const hasFrame = () => ev(`!!document.getElementById('gameShooterFrame')`);
  const hostKids = () => ev(`document.getElementById('gameShooterFrameHost').children.length`);
  const disp = (id) => ev(`getComputedStyle(document.getElementById('${id}')).display`);

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
    // ⚠⚠ **必须先把这个 target 激活。** headless 里新建的 target 不一定处于「聚焦」状态，
    //   而「焦点」正是 D 段那三条断言的**前提**：文档不聚焦时 `element.focus()` 会
    //   照样把 `activeElement` 设上，但**键盘事件不会路由进去** —— 于是断言时红时绿。
    //   实测过一次：同一份产品，一次 85/0、下一次 83/3，红的三条全是焦点那组。
    //   **飘的测试比红的测试更坏**（会让人开始无视它），所以把环境钉死。
    await cdp.send('Target.activateTarget', { targetId });
    SID = (await cdp.send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
    await cdp.send('Page.enable', {}, SID);
    await cdp.send('Runtime.enable', {}, SID);
    await cdp.send('Page.bringToFront', {}, SID);
    const consoleErrors = [];
    cdp.on('Runtime.consoleAPICalled', p => {
      if (p.type === 'error') consoleErrors.push((p.args || []).map(a => a.value || a.description).join(' '));
    });
    cdp.on('Runtime.exceptionThrown', p => {
      const d = p.exceptionDetails;
      consoleErrors.push('EXCEPTION: ' + (d.exception ? d.exception.description : d.text));
    });

    srv = await startServer();
    await cdp.send('Emulation.setDeviceMetricsOverride',
      { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, SID);
    const loaded = new Promise(res => cdp.on('Page.loadEventFired', res));
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/` }, SID);
    await loaded;
    await ev(`document.fonts.ready.then(() => true)`, true);
    await sleep(400);
    log('页面加载完成');

    // ============ A. 装载 ============
    console.log('\n== A. 装载 ==');
    check('页面无 console 错误', consoleErrors.filter(x => !/favicon/i.test(x)),
      v => v.length === 0, []);
    check('小游戏入口按钮在', await ev(`!!document.querySelector('.game-entry-btn')`), true);
    check('弹窗还没打开（对照组）',
      await ev(`document.getElementById('gameModal').classList.contains('active')`), false);
    check('菜单态下没有 iframe（对照组）', await hasFrame(), false);

    // ============ B. 内联源码就是游戏源文件 ============
    console.log('\n== B. 内联源码 ==');
    const blob = await ev(`ST_SHOOTER_SRC`);
    check('ST_SHOOTER_SRC 是个非空字符串',
      typeof blob === 'string' && blob.length > 50000, true, '>50000 字符');
    check('  开头是 DOCTYPE', blob.slice(0, 15), '<!DOCTYPE html>');
    // ⚠ 先 `replace(/\s+$/,'')` **再** slice —— 直接 `slice(-8)` 拿到的是 `\n</html>`，
    //   而末尾那个换行在**开头**，`/\s+$/` 剥不掉它（第一版就栽在这儿）
    check('  结尾是 </html>', blob.replace(/\s+$/, '').slice(-7), '</html>');
    check('  文档结构完整（<html> / <body> / 收尾都齐）',
      ['<html', '<head>', '<body', '</body>', '</html>'].every(t => blob.indexOf(t) >= 0), true);
    check('  游戏的关键函数都在里面',
      ['function startGame', 'function gameLoop', 'SHIP_PRESETS'].every(t => blob.indexOf(t) >= 0), true);
    // ⚠ 转义的两条硬证据：正文里**不该**再有裸的 `</script` / `<!--`
    //   （它们全被写成 `<\/script` / `<\!--`，求值后才会变回来）
    check('  求值后 `</script` 回来了（转义没吃掉内容）',
      (blob.match(/<\/script/gi) || []).length, v => v >= 1, '≥1');
    check('  求值后 `<!--` 回来了', (blob.match(/<!--/g) || []).length, v => v >= 1, '≥1');
    check('  正文里没有残留的转义反斜杠（`<\\/script` 这种形态）',
      blob.indexOf('<\\/script') < 0 && blob.indexOf('<\\!--') < 0, true);

    // 逐字节跟源文件比。**推导式**，不写死长度。
    if (!fs.existsSync(SHOOTER_FILE)) {
      check('游戏源文件在 G: 上（B 段的判据依赖它）', false, true,
        '文件不在 → 这条断言失去意义，别降级成「长度差不多就行」');
    } else {
      const orig = fs.readFileSync(SHOOTER_FILE, 'utf8').replace(/\r\n/g, '\n');
      check('  跟源文件**逐字节一致**', sha1(blob) === sha1(orig), true,
        'sha1 ' + sha1(orig) + '（实际 ' + sha1(blob) + '）');
      check('  长度一致', blob.length, orig.length);
    }

    // ============ C. 菜单与挂载 ============
    console.log('\n== C. 菜单与挂载 ==');
    await ev('openCatGame()');
    await sleep(250);
    check('弹窗打开了',
      await ev(`document.getElementById('gameModal').classList.contains('active')`), true);
    const items = await menuItems();
    check('菜单 4 项', items.length, 4, items.map(i => i.title));
    check('  头三项还是那三个老游戏',
      items.slice(0, 3).map(i => i.title).join('|'),
      'Cat Runner|Cat Doodle Jump|Cat Parade');
    check('  第 4 项是 Retro Vector Shooter', items[3].title, 'Retro Vector Shooter');
    check('  第 4 项接的是 launchGame(\'shooter\')', items[3].fn, `launchGame('shooter')`);
    check('菜单态下宽卡片没生效（对照组）',
      await ev(`document.getElementById('gameCard').classList.contains('game-card--wide')`), false);

    // 走**真按钮**，不是直接调 launchGame —— 要验的正是按钮接对了没有
    check('点得到第 4 项', await clickMenuItem(3), true);
    check('iframe 挂出来了', await waitFor(hasFrame, 8000), true);
    check('  host 里正好一个', await hostKids(), 1);
    check('  画布那块收起来了', await disp('gameViewport'), 'none');
    check('  战机那块显示出来了', await disp('gameShooterWrap'), 'flex');
    check('  卡片进了宽档', await ev(`document.getElementById('gameCard').classList.contains('game-card--wide')`), true);
    check('  标题换成了 Retro Vector Shooter.exe',
      await ev(`document.getElementById('gameModalTitle').textContent`), 'Retro Vector Shooter.exe');
    check('  返回菜单按钮出来了',
      await ev(`getComputedStyle(document.getElementById('backMenuBtn')).display`), v => v !== 'none', '≠none');
    check('  没有触发 gameAnimationId 那条老路径（activeGameType 是 shooter）',
      await ev(`activeGameType`), 'shooter');
    check('  触摸/十字键都没露出来',
      (await disp('touchControls')) === 'none' && (await disp('dpadControls')) === 'none', true);
    const wideW = await cardW();

    // ============ D. iframe 里的游戏真的起来了 ============
    console.log('\n== D. iframe 里的游戏 ==');
    // tailwind 是阻塞脚本，网络慢的时候游戏脚本要等几秒
    const booted = await waitFor(async () => (await fe(`typeof startGame`)) === 'function', 25000);
    check('游戏脚本执行完了（startGame 已定义）', booted, true,
      '等不到 → 多半是 cdn.tailwindcss.com 没拉下来（它是 head 里的阻塞脚本）');
    check('  readyState', await fe(`document.readyState`), v => v === 'complete' || v === 'interactive', 'complete');
    check('  canvas 在', await fe(`!!document.getElementById('gameCanvas')`), true);
    check('  初始状态是 MENU（对照组：还没开局）', await fe(`gameState`), 'MENU');
    check('  选机页可见',
      await fe(`!document.getElementById('ship-select-screen').classList.contains('hidden')`), true);
    check('  HUD 还是藏着的',
      await fe(`document.getElementById('hud-overlay').classList.contains('hidden')`), true);
    // 键盘事件挂在 iframe **自己那个** window 上 —— 焦点不在里面，按 WASD 一点反应都没有，
    // 而画面上**完全看不出异常**（游戏好好地显示着，就是不动）。
    // ⚠ 别只断言 `activeElement` 这个**代理指标** —— 真正要证的是「键**送到了**」。
    //   实测过：只调 `contentWindow.focus()` 时 activeElement 是 BODY、子文档 hasFocus 是 false，
    //   而这一条正是当时唯一红的东西。
    // ⚠ 这条是**前提断言**，故意放在最前面：页面自己都不聚焦的话，
    //   下面那两条「焦点进 iframe」根本无从谈起 —— 那时红的是环境，不是产品。
    //   有了它，环境飘的时候会**指着环境**，而不是让人去查产品（那会白查半天）。
    check('  页面本身是聚焦的（下面两条的前提）', await ev(`document.hasFocus()`), true);
    // ⚠ 焦点这条**要等**，不能假设「跑到这儿 load 已经触发过了」。
    //   那个游戏页面里有一条 `@import` 拉 Google Fonts —— 字体慢的时候 iframe 的
    //   `load` 会被拖后好几秒，期间 `readyState` 停在 `interactive`。
    //   实测过：第一版直接断言 `activeElement`，同一份产品**一次 85/0、一次 83/3**，
    //   红的三条全是焦点那组 —— 纯时序，跟产品对不对没关系。
    //   产品那边也已经改成「挂上去就立刻聚焦」，`load` 里那次只是再确认一遍。
    check('  焦点被接进 iframe 了',
      await waitFor(async () =>
        (await ev(`document.activeElement === document.getElementById('gameShooterFrame')`)) === true, 8000), true);
    await fe(`window.__got = []; window.addEventListener('keydown', e => window.__got.push(e.code)); 1`);
    await ev(`(window.__parentGot = [], (function(){
      window.addEventListener('keydown', function (e) { window.__parentGot.push(e.code); }); })(), true)`);
    await cdp.send('Input.dispatchKeyEvent',
      { type: 'keyDown', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 }, SID);
    await cdp.send('Input.dispatchKeyEvent',
      { type: 'keyUp', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 }, SID);
    await sleep(200);
    check('  真发一个 W：iframe 收到了',
      await fe(`window.__got`), v => Array.isArray(v) && v.indexOf('KeyW') >= 0, "['KeyW']");
    check('  而且父页面**没**收到（对照组：键盘是真进去了，不是两边都收）',
      await ev(`window.__parentGot`), v => Array.isArray(v) && v.indexOf('KeyW') < 0, '不含 KeyW');
    const nPreset = await fe(`SHIP_PRESETS.length`);
    check('  战机卡数 == 源码里的预设数（推导式，不写死）',
      await fe(`document.querySelectorAll('.ship-card').length`), nPreset, nPreset);
    check('  预设数本身是合理的（5 种）', nPreset, v => v >= 3 && v <= 8, '3~8');
    await shot('game-shooter-menu.png');

    // ============ E. 点战机卡真的能开局 ============
    console.log('\n== E. 开局 ==');
    check('点得到第一张战机卡',
      await fe(`!!document.querySelectorAll('.ship-card')[0]`), true);
    await fe(`document.querySelectorAll('.ship-card')[0].click(); 1`);
    check('gameState 变成 PLAYING', await waitFor(async () => (await fe(`gameState`)) === 'PLAYING', 6000), true);
    check('  选机页收起来了',
      await fe(`document.getElementById('ship-select-screen').classList.contains('hidden')`), true);
    check('  HUD 出来了',
      await fe(`!document.getElementById('hud-overlay').classList.contains('hidden')`), true);
    check('  玩家对象建出来了', await fe(`!!player`), true);
    check('  分数从 0 开始', await fe(`score`), 0);

    // 「循环真的在跑」—— 用游戏自己记的时长，不是我们猜
    const dur1 = await fe(`gameDurationSeconds`);
    await sleep(700);
    const dur2 = await fe(`gameDurationSeconds`);
    check('游戏时长在涨（循环真的在跑，不是静止画面）', dur2, v => v > dur1, '> ' + dur1);
    check('  涨得差不多是真实时间（不是一帧跳一大截）', dur2 - dur1,
      v => v > 0.3 && v < 1.6, '0.3~1.6 秒');
    await shot('game-shooter-playing.png');

    // 记一下「这一局确实跑过一段时间」—— 等下用它证明「重开是全新的一局」
    // （⚠ 不用分数：跑 1.5 秒可能一分没得，拿它当判据会**天然成立**，见 F2）
    await fe(`window.__tick = 0; (function t(){ window.__tick++; requestAnimationFrame(t); })(); 1`);
    await sleep(400);
    const tickA = await fe(`window.__tick`);
    await sleep(400);
    const tickB = await fe(`window.__tick`);
    check('iframe 里的 rAF 计数器有效（对照组：证明下面那条不是天然成立）',
      tickB, v => v > tickA, '> ' + tickA);

    // ============ F. 卸载 —— 三条路 ============
    console.log('\n== F. 卸载（返回菜单）==');
    // 留一个引用再摘掉：这样 iframe 里的 window 还在我们手里，
    // 「循环停了」这件事才有可能**量**出来，而不是靠「反正 DOM 没了」推
    await ev(`(window.__detached = document.getElementById('gameShooterFrame'), true)`);
    await ev(`showGameMenu()`);
    await sleep(200);
    check('iframe 从 DOM 里摘掉了', await hasFrame(), false);
    check('  host 里一个都不剩', await hostKids(), 0);
    // ⚠ 菜单态下画布那块**本来就该藏着**（showGameMenu 会把它设成 none）。
    //   第一版写成「应该回来 flex」—— 那是切到别的游戏才成立的，套在菜单态上是**假红**。
    //   这里真正要守的是「两块别都亮着」，所以判据是「两个都 none + 菜单列表可见」。
    check('  画布那块收着（菜单态本来就该收）', await disp('gameViewport'), 'none');
    check('  战机那块也收着（不是两块都亮着）', await disp('gameShooterWrap'), 'none');
    check('  宽卡片撤了',
      await ev(`document.getElementById('gameCard').classList.contains('game-card--wide')`), false);
    check('  标题回到 Arcade Select.exe',
      await ev(`document.getElementById('gameModalTitle').textContent`), 'Arcade Select.exe');
    check('  返回菜单按钮藏了',
      await ev(`getComputedStyle(document.getElementById('backMenuBtn')).display`), 'none');
    check('  菜单列表回来了', await disp('gameMenuList'), v => v !== 'none', '≠none');
    check('  activeGameType 清空了', await ev(`activeGameType`), null);

    // ⚠ 最硬的一条：那个游戏在非 PLAYING 态**照样** requeue rAF，
    //   所以「藏起来」和「摘掉」在画面上**完全一样**，只有量 tick 才分得出来。
    //   摘掉之后文档销毁 ⇒ rAF 不再触发 ⇒ tick 冻住。
    // ⚠ 这条**必须只有一个名字**。第一版写成了两个名字（「window 已被回收 ⇒ 停」/
    //   「tick 冻住了」），看着更精确，其实是给反向测试挖了个坑：基线里永远只出现
    //   其中一个 —— 另一个名字**在基线里查无此人**，而注入之后走的正好是另一个分支
    //   ⇒ 探针的 `red` 点了一个不存在的名字，存在性闸门当场拦下。
    //   （真跑起来更糟：`red` 匹配不上会打「预期该红的都红了 ✅」—— 反向测试静默失效。）
    //   ⇒ 判据合成一个布尔、名字固定；**走的是哪个分支打出来**，不许静默选。
    const tickAt = async () => ev(`(function(){
      const f = window.__detached;
      if (!f || !f.contentWindow) return '__GONE__';
      try { return f.contentWindow.eval('window.__tick'); } catch (e) { return '__ERR__'; }
    })()`);
    const d1 = await tickAt();
    await sleep(600);
    const d2 = await tickAt();
    let stopped, how;
    if (d1 === '__GONE__' || d1 === '__ERR__') {
        // 浏览器把那个 window 收掉了 —— 也算停（比冻住更彻底），但要说出来
        stopped = true;
        how = 'window 已被回收（' + d1 + '）—— 文档确实销毁了，rAF 不可能还在跑';
    } else {
        stopped = (d2 === d1);
        how = 'tick 冻在 ' + d1 + '（两次读数 ' + d1 + ' / ' + d2 + '）';
    }
    console.log('  ℹ ' + how);
    check('摘掉之后 rAF 停了', stopped, true, how);
    check('  而且摘掉之前它确实在涨（同一条断言的反面对照）', tickB > tickA, true);

    // 第二条路：切到别的游戏
    console.log('\n== F2. 卸载（切到别的游戏）==');
    await clickMenuItem(3);
    await waitFor(hasFrame, 8000);
    check('先重新挂上（对照组）', await hasFrame(), true);
    // ⚠ 判据用**时长**不用**分数**。第一版用 `score === 0`，结果 R1（卸载失效）
    //   注入之后这一条**照样绿** —— 因为上一局只跑了 1.5 秒，分数本来就是 0，
    //   「回到 0」这件事**天然成立**，断言等于没写。
    //   时长不一样：老那一局已经跑了好几秒，新的一局必然从 0 开始。
    check('  这次是全新的一局（时长从 0 重新开始）',
      await waitFor(async () => {
        const d = await fe(`gameDurationSeconds`);
        return typeof d === 'number' && d < 0.5;
      }, 20000), true);
    check('  上一局的时长已经不小了（证明「从 0 开始」有意义）', dur2, v => v > 0.3, '> 0.3');
    await clickMenuItem(0);
    await sleep(300);
    check('切到 runner 之后 iframe 没了', await hasFrame(), false);
    check('  host 也空了', await hostKids(), 0);
    check('  activeGameType 是 runner', await ev(`activeGameType`), 'runner');
    check('  画布那块显示着', await disp('gameViewport'), 'flex');
    check('  宽卡片撤了',
      await ev(`document.getElementById('gameCard').classList.contains('game-card--wide')`), false);

    // ============ G. 老游戏回归 ============
    console.log('\n== G. 老游戏回归 ==');
    // 宽卡片是给战机开的，必须只对它生效 —— 拿同一个视口量宽度做对比
    await clickMenuItem(0); await sleep(250);
    const runnerW = await cardW();
    await clickMenuItem(3);
    await waitFor(hasFrame, 8000);
    check('战机那张卡确实比普通小游戏的卡宽', wideW, v => v > runnerW, '> ' + runnerW);
    check('  而且 runner 那张不是宽档（对照组）', runnerW, v => v <= 620, '≤620');

    await clickMenuItem(1); await sleep(300);
    check('doodle：activeGameType 对', await ev(`activeGameType`), 'doodle');
    check('doodle：左右键露出来了', await disp('touchControls'), 'flex');
    check('doodle：十字键没露', await disp('dpadControls'), 'none');
    check('doodle：没有 iframe', await hasFrame(), false);

    await clickMenuItem(2); await sleep(300);
    check('parade：activeGameType 对', await ev(`activeGameType`), 'parade');
    check('parade：十字键露出来了', await disp('dpadControls'), 'grid');
    check('parade：左右键没露', await disp('touchControls'), 'none');
    check('parade：没有 iframe', await hasFrame(), false);

    // ============ H. 关弹窗 ============
    console.log('\n== H. 关弹窗 ==');
    await clickMenuItem(3);
    await waitFor(hasFrame, 8000);
    check('先挂上（对照组）', await hasFrame(), true);
    await ev(`closeCatGame()`);
    await sleep(200);
    check('关窗后 iframe 摘掉了', await hasFrame(), false);
    check('  host 空了', await hostKids(), 0);
    check('  弹窗关上了',
      await ev(`document.getElementById('gameModal').classList.contains('active')`), false);
    check('  宽卡片撤了',
      await ev(`document.getElementById('gameCard').classList.contains('game-card--wide')`), false);
    // 再开一次 —— 关窗把状态弄脏的话这里会露馅
    await ev(`openCatGame()`); await sleep(200);
    check('再打开时是干净的菜单态',
      (await disp('gameMenuList')) !== 'none' && (await hasFrame()) === false, true);
    await ev(`closeCatGame()`);

    // ============ I. 收尾零报错 ============
    console.log('\n== I. 收尾 ==');
    await sleep(300);
    check('全程零 console.error（含 iframe 里抛的）', consoleErrors.length, 0);
    if (consoleErrors.length) consoleErrors.slice(0, 6).forEach(e => console.log('    ' + e));

    console.log(`\n===== 小游戏·复古线框战机：${pass} 通过 / ${fail} 失败 =====`);
    if (fails.length) { console.log('失败项：'); fails.forEach(f => console.log('  · ' + f)); }
  } catch (e) {
    fail++;
    console.log('\n💥 套件自己崩了：' + (e && e.stack ? e.stack : e));
  } finally {
    try { if (cdp) await cdp.send('Browser.close', {}, SID); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
    try { if (srv) srv.close(); } catch (e) {}
    // ⚠ 必须带 maxRetries：Windows 上进程刚 kill 时 profile 还锁着，
    //   裸 rmSync 会 EBUSY 退出而外面这层 catch 把它吞掉 —— 静默失败
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); } catch (e) {}
  }
  process.exit(fail ? 1 : 0);
})();
