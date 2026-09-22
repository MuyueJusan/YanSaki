// 第三轮：卡里已经有「状态栏界面」时，解析它、并编辑已有元素
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
const t0 = Date.now();
const log = m => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

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

const CANDIDATES = [8891, 8794, 8902, 8913, 8924];
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

const DIALOGS = [];

// 手写的「状态栏界面」：外壳 + 各种元素 + 一个认不出来的表格 + 一个 <style>
const FIXTURE = [
  '<!doctype html><html><head><meta charset="utf-8"></head><body>',
  '<div style="border:1px solid #7b9fd4;border-radius:8px;padding:8px 10px;margin:6px 0;',
  'background:#0d1320;color:#e8ecf3;font-size:13px;line-height:1.6;',
  'box-shadow:0 2px 8px rgba(0,0,0,.4);width:420px;max-width:100%;">',
  '<div style="font-size:15px;font-weight:bold;color:#79aed2;text-align:center;',
  'margin:0 0 6px;line-height:1.4">状态</div>',
  '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;',
  'font-size:13px;margin:3px 0;text-align:left"><span style="color:#8b9bb4">好感度</span>',
  '<span style="color:#e8ecf3;font-weight:bold">{{format_message_variable::stat_data.好感度}}</span></div>',
  '<div style="margin:3px 0"><div style="display:flex;justify-content:space-between;',
  'font-size:11px;color:#8b9bb4;margin-bottom:3px"><span>体力</span>',
  '<span>{{format_message_variable::stat_data.体力}}</span></div>',
  '<div style="height:8px;background:rgba(128,150,180,.28);border-radius:4px;overflow:hidden">',
  '<div style="height:100%;width:0%;width:calc(({{get_message_variable::stat_data.体力}} - 0) / 100 * 100%);',
  'background:#79aed2;border-radius:4px"></div></div></div>',
  '<div style="display:flex;align-items:center;gap:8px;margin:3px 0;font-size:13px;',
  'justify-content:flex-start"><span style="color:#8b9bb4;font-size:13px">信赖</span>',
  '<span style="position:relative;display:inline-block;line-height:1;letter-spacing:4px;white-space:nowrap">',
  '<span style="color:#7b9fd4">●●●●●</span>',
  '<span style="position:absolute;left:0;top:0;overflow:hidden;width:0px;',
  'width:calc(({{get_message_variable::stat_data.信赖}} - 0) / 5 * 85px);max-width:100%;',
  'color:#79aed2">●●●●●</span></span>',
  '<span style="color:#e8ecf3;font-weight:bold;font-size:13px">',
  '{{format_message_variable::stat_data.信赖}}</span></div>',
  '<div style="height:1px;background:#7b9fd4;margin:7px 0"></div>',
  '<div style="height:6px"></div>',
  '<div style="display:flex;gap:8px;align-items:center;margin:3px 0">',
  '<div style="flex:1 1 0;min-width:0">',
  '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;',
  'font-size:13px;margin:3px 0;text-align:left"><span style="color:#8b9bb4">金币</span>',
  '<span style="color:#e8ecf3;font-weight:bold">{{format_message_variable::stat_data.金币}}</span></div></div>',
  '<div style="flex:1 1 0;min-width:0">',
  '<div style="font-size:13px;font-weight:bold;color:#79aed2;text-align:right;',
  'margin:0 0 6px;line-height:1.4">第 {{getvar::stat_data.天数}} 天</div></div>',
  '</div>',
  '<table style="width:100%"><tr><td>认不出来的东西</td></tr></table>',
  '<style>.sb-x{color:red}</style>',
  '<div>今天是 {{format_message_variable::stat_data.日期}}，天气不错</div>',
  '</div>',
  '</body></html>'
].join('\n');

(async () => {
  await pickPort();
  log(`静态服务 http://127.0.0.1:${HTTP_PORT}`);
  // 端口不能写死、也不能纯随机：连跑整套时上一轮 Chrome 还没退干净就会占着
  // 刚抽到的号，症状是「Chrome 调试端口没起来」—— 跟被测页面一点关系都没有。
  // 先试着真绑一下，绑得上才算数
  const cdpPort = await (async () => {
    for (let i = 0; i < 80; i++) {
      const p = 9400 + Math.floor(Math.random() * 900);
      const free = await new Promise(res => {
        const probe = http.createServer();
        probe.on('error', () => { try { probe.close(); } catch (e) {} res(false); });
        probe.listen(p, '127.0.0.1', () => probe.close(() => res(true)));
      });
      if (free) return p;
      await sleep(40);
    }
    return 9400 + Math.floor(Math.random() * 900);
  })();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-sb3-'));
  // ⚠ profile 目录要自己删 —— mkdtempSync 只负责建。不删的话**每跑一次就多一个**，
  //   实测堆到 873 个目录 / 14.5 GB。`st-ai.js` 早就这么做了，这里是补齐。
  //   maxRetries 是为 Windows：进程刚 kill 掉时目录还锁着，不重试就是 EBUSY，
  //   而那是**静默**的（外面还有一层 catch 兜着）。
  const cleanupProfile = () => {
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); } catch (e) {}
  };
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu',
    '--no-first-run', '--hide-scrollbars',
    `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`], { stdio: 'ignore' });

  let cdp = null, SID = null, srv = null;
  const VP = { width: 1440, height: 900, mobile: false };
  const ev = async (expr, awaitPromise = false, timeout = 30000) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise }, SID, timeout);
    if (r.exceptionDetails) {
      throw new Error('页面异常: ' + (r.exceptionDetails.exception
        ? r.exceptionDetails.exception.description : r.exceptionDetails.text));
    }
    return r.result.value;
  };
  const shot = async (name, sel) => {
    let saved = null;
    if (sel) {
      const h = await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
        if (!el) return 0; el.scrollIntoView({block:'start'});
        return Math.ceil(el.getBoundingClientRect().height); })()`);
      if (h > 0) {
        saved = { ...VP };
        await cdp.send('Emulation.setDeviceMetricsOverride',
          { width: VP.width, height: Math.min(Math.max(h + 24, 320), 4000), deviceScaleFactor: 1, mobile: false }, SID);
      }
    }
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' }, SID);
    fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, 'base64'));
    if (saved) await cdp.send('Emulation.setDeviceMetricsOverride',
      { ...saved, deviceScaleFactor: 1, mobile: false }, SID);
    console.log(`  📸 ${name} (${Math.round(Buffer.from(r.data, 'base64').length / 1024)} KB)`);
  };
  const typeTree = async () => ev(`(function tt(l){ return l.map(function(b){
    return b.type + (b.children && b.children.length ? '(' + tt(b.children) + ')' : ''); }).join(','); })
    (stEditor.card.statusBar.blocks)`);

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
    cdp.on('Page.javascriptDialogOpening', async p => {
      DIALOGS.push(p.message);
      cdp.send('Page.handleJavaScriptDialog', { accept: true }, SID)
        .catch(e => console.log('  ⚠ 对话框没接住：' + (e && e.message)));
    });
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
    let loaded = new Promise(res => cdp.on('Page.loadEventFired', res));
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/` }, SID);
    await loaded;
    await ev('localStorage.clear()');
    loaded = new Promise(res => cdp.on('Page.loadEventFired', res));
    await cdp.send('Page.reload', {}, SID);
    await loaded;
    await ev(`document.fonts.ready.then(() => true)`, true);
    await sleep(600);
    log('页面加载完成');

    await ev('openStEditor()');
    await ev(`stSwitchTab('mvu')`);
    await ev(`stMvuInstallClick()`);
    await ev(`stMvuQuickAdd(0)`);      // 好感度 number 0~100
    await ev(`stMvuQuickAdd(2)`);
    await ev(`stSwitchTab('sb')`);
    await sleep(250);

    // ============ A. 自往返：6 个版式模板都要能解析回同样的结构 ============
    console.log('\n== A. 自往返（生成 → 去掉结构注释 → 解析回来） ==');
    for (let i = 0; i < 6; i++) {
      const name = await ev(`ST_SB_TEMPLATES[${i}].name`);
      const r = await ev(`(() => {
        stEditor.card.statusBar.blocks = []; stEditor.sbSel = ''; stRerender();
        stSbApplyTemplate(${i});
        const before = (function tt(l){ return l.map(function(b){
          return b.type + (b.children && b.children.length ? '(' + tt(b.children) + ')' : ''); }).join(','); })
          (stEditor.card.statusBar.blocks);
        const theme0 = stEditor.card.statusBar.theme;
        // 生成 → 抹掉结构注释 = 变成「别人手写的」
        const foreign = stSbDocHtml().replace(/<!--MVU_STATUS_BAR:[\\s\\S]*?-->/, '<!---->');
        const p = stSbParseDoc(foreign);
        const after = p.ok ? (function tt(l){ return l.map(function(b){
          return b.type + (b.children && b.children.length ? '(' + tt(b.children) + ')' : ''); }).join(','); })
          (p.blocks) : ('ERR:' + p.why);
        return { before: before, after: after, theme0: theme0, theme1: p.ok ? p.theme : null,
          extra: p.ok ? p.shellExtra : null, textOk: p.ok ? p.textOk : null,
          raw: p.ok ? p.stats.raw : null };
      })()`);
      if (i === 5) {   // 空白模板没有块，另外断言
        check(`模板「${name}」空白 → 解析出 0 个块`, r.after, '');
        continue;
      }
      check(`模板「${name}」块结构原样往返`, r.after, r.before);
      check(`模板「${name}」主题认回来一致`, r.theme1, r.theme0);
      check(`模板「${name}」没有退化成高级块`, r.raw, 0);
      check(`模板「${name}」文字对得上`, r.textOk, true);
      check(`模板「${name}」没有多出外壳附加样式`, r.extra, '');
    }

    // ============ B. 手写状态栏：每种元素都认得出来 ============
    console.log('\n== B. 手写状态栏的逐元素识别 ==');
    const p = await ev(`(() => {
      stEditor.sbOwn = false;
      stSbRegex().replaceString = ${JSON.stringify(FIXTURE)};
      const r = stSbParseDoc(${JSON.stringify(FIXTURE)});
      if (!r.ok) return { ok: false, why: r.why };
      const t = (function tt(l){ return l.map(function(b){
        return b.type + (b.children && b.children.length ? '(' + tt(b.children) + ')' : ''); }).join(','); })(r.blocks);
      const at = function(i){ return r.blocks[i]; };
      const row = r.blocks.filter(function(b){ return b.type === 'row'; })[0];
      return {
        ok: true, tree: t, n: r.blocks.length, raw: r.stats.raw, styleTags: r.stats.styleTags,
        theme: r.theme, exact: r.themeExact, width: r.width, extra: r.shellExtra, textOk: r.textOk,
        title: at(0).type === 'title' ? at(0) : null,
        v1: at(1), bar: at(2), dots: at(3), div: at(4), sp: at(5),
        rowKids: row ? row.children.map(function(k){ return k.type; }) : null,
        rowVar: row && row.children[0] ? row.children[0].path : null,
        rowTitle: row && row.children[1] ? row.children[1].text : null,
        text: at(9) ? at(9).text : null
      };
    })()`);
    check('解析成功', p.ok, true);
    check('顶层块类型序列', p.tree,
      'title,var,bar,dots,divider,space,row(var,title),html,html,text');
    check('外壳主题认作暗夜（底色一致）', p.theme, 'dark');
    check('底色一致标记', p.exact, true);
    check('宽度读出来 420', p.width, 420);
    check('外壳附加样式只剩 box-shadow', p.extra, 'box-shadow:0 2px 8px rgba(0,0,0,.4)');
    check('文字内容对得上', p.textOk, true);
    check('标题块：文字', p.title && p.title.text, '状态');
    check('标题块：字号反推 13（15-2）', p.title && p.title.size, 13);
    check('标题块：居中', p.title && p.title.align, 'center');
    check('变量块：路径', p.v1 && p.v1.path, 'stat_data.好感度');
    check('变量块：显示名', p.v1 && p.v1.label, '好感度');
    check('进度条：路径', p.bar && p.bar.path, 'stat_data.体力');
    check('进度条：条高', p.bar && p.bar.height, 8);
    check('进度条：min/max 从 calc 反解', p.bar ? [p.bar.min, p.bar.max] : null,
      v => Array.isArray(v) && v[0] === 0 && v[1] === 100, '[0,100]');
    check('进度条：表头显示名', p.bar && p.bar.label, '体力');
    check('进度条：表头字号反推 13（11+2）', p.bar && p.bar.size, 13);
    check('圆点：路径', p.dots && p.dots.path, 'stat_data.信赖');
    check('圆点：个数从底排字符数来', p.dots && p.dots.count, 5);
    check('圆点：字符', p.dots && p.dots.icon, '●');
    check('圆点：min/max 从 calc 反解', p.dots ? [p.dots.min, p.dots.max] : null,
      v => Array.isArray(v) && v[0] === 0 && v[1] === 5, '[0,5]');
    check('圆点：显示名', p.dots && p.dots.label, '信赖');
    check('分割线：线色就是主题色 → 不写死', p.div && p.div.color, '');
    check('间距：高度', p.sp && p.sp.height, 6);
    check('一行多列：两列', p.rowKids, v => Array.isArray(v) && v.join(',') === 'var,title', 'var,title');
    check('一行多列：第一列是变量', p.rowVar, 'stat_data.金币');
    check('一行多列：第二列是标题（句子里带宏也不拆散）', p.rowTitle,
      '第 {{getvar::stat_data.天数}} 天');
    check('句子里带宏的文字块保留全文', p.text, '今天是 {{format_message_variable::stat_data.日期}}，天气不错');
    check('表格认不出来 → 原样保留', p.raw, 2);
    check('<style> 单独计数', p.styleTags, 1);

    // 认不出来的东西必须原样出现在生成物里（不能丢）。
    // 先把解析结果装进卡里 —— stSbDocHtml() 是从 stEditor.card.statusBar 生成的
    const keep = await ev(`(() => {
      const r = stSbParseDoc(${JSON.stringify(FIXTURE)});
      stEditor.card.statusBar = stStatusBarFromRaw({
        theme: r.theme, width: r.width, shellExtra: r.shellExtra, blocks: r.blocks
      });
      const html = stSbDocHtml();
      return { table: html.indexOf('<table') >= 0 && html.indexOf('认不出来的东西') >= 0,
        style: html.indexOf('<style>') >= 0 && html.indexOf('.sb-x{color:red}') >= 0,
        shadow: html.indexOf('box-shadow:0 2px 8px') >= 0,
        macroOld: html.indexOf('{{getvar::stat_data.天数}}') >= 0 };
    })()`);
    check('生成物里表格还在', keep.table, true);
    check('生成物里 <style> 还在', keep.style, true);
    check('生成物里外壳的阴影还在', keep.shadow, true);
    check('生成物里老写法宏原样保留', keep.macroOld, true);

    // ============ C. 接管流程 ============
    console.log('\n== C. 解析 → 接管 → 直接改 ==');
    const beforeTake = await ev(`(() => {
      stEditor.sbOwn = false; stEditor.sbParse = null;
      stSbRegex().replaceString = ${JSON.stringify(FIXTURE)};
      stEditor.card.statusBar = stBlankStatusBar();
      stRerender();
      const d = stSbDetect();
      return { state: d.state, hasParseBtn: !!document.getElementById('st-sb-parse'),
        canvasHits: document.querySelectorAll('#st-sb-canvas .st-sb-hit').length };
    })()`);
    check('卡里那条被认作 foreign', beforeTake.state, 'foreign');
    check('给出「解析」按钮', beforeTake.hasParseBtn, true);
    check('还没接管时画布是空的', beforeTake.canvasHits, 0);

    await ev(`stSbParseFromCard()`);
    await sleep(200);
    const afterTake = await ev(`(() => {
      const d = stSbDetect();
      return { state: d.state, own: stEditor.sbOwn, tree: (function tt(l){ return l.map(function(b){
          return b.type + (b.children && b.children.length ? '(' + tt(b.children) + ')' : ''); }).join(','); })
          (stEditor.card.statusBar.blocks),
        canvasHits: document.querySelectorAll('#st-sb-canvas .st-sb-hit').length,
        layerRows: document.querySelectorAll('.st-sb-layers .st-mvu-row').length,
        n: stSbCount(stEditor.card.statusBar.blocks),
        hasReport: !!document.querySelector('.st-sb-report'),
        hasRestore: !!document.querySelector('.st-sb-report button'),
        extraField: !!document.getElementById('st-sb-shell-extra') };
    })()`);
    check('接管后卡里那条变成 mine', afterTake.state, 'mine');
    check('接管后 sbOwn = true', afterTake.own, true);
    check('画布换成解析出来的块', afterTake.tree,
      'title,var,bar,dots,divider,space,row(var,title),html,html,text');
    check('画布命中框数 == 块数', afterTake.canvasHits, afterTake.n);
    check('图层行数 == 块数', afterTake.layerRows, afterTake.n);
    check('给出解析报告', afterTake.hasReport, true);
    check('给出「还原解析前的 HTML」按钮', afterTake.hasRestore, true);
    check('外壳附加样式可编辑', afterTake.extraField, true);

    // 接管之后直接改一个已有元素 → 要写回卡里
    const edited = await ev(`(() => {
      const t = stEditor.card.statusBar.blocks[0];
      stSbSelect(t.id);
      const p = stSbChain(t.id).slice(-1)[0].path;
      stSet(p + '.text', '角色状态');
      const doc = stSbDocHtml();
      return { inCard: String(stSbRegex().replaceString).indexOf('角色状态') >= 0,
        inCanvas: document.querySelector('#st-sb-canvas').innerHTML.indexOf('角色状态') >= 0,
        old: String(stSbRegex().replaceString).indexOf('>状态<') >= 0 };
    })()`);
    check('改标题 → 立刻写回卡里', edited.inCard, true);
    check('改标题 → 画布跟着变', edited.inCanvas, true);
    check('改标题 → 卡里不再是旧文字', edited.old, false);

    const editedVar = await ev(`(() => {
      const v = stEditor.card.statusBar.blocks.filter(function(b){ return b.type === 'var'; })[0];
      const p = stSbChain(v.id).slice(-1)[0].path;
      stSet(p + '.label', '亲密度');
      const doc = String(stSbRegex().replaceString);
      return { label: doc.indexOf('亲密度') >= 0, path: doc.indexOf('stat_data.好感度') >= 0 };
    })()`);
    check('改变量块的显示名 → 写回', editedVar.label, true);
    check('改变量块 → 路径没丢', editedVar.path, true);

    const editedBar = await ev(`(() => {
      const b = stEditor.card.statusBar.blocks.filter(function(x){ return x.type === 'bar'; })[0];
      const p = stSbChain(b.id).slice(-1)[0].path;
      stSet(p + '.max', '200');
      const doc = String(stSbRegex().replaceString);
      return { max: b.max, inDoc: doc.indexOf('/ 200 *') >= 0 };
    })()`);
    check('改进度条上限 → 产物里的 calc 跟着变', editedBar.inDoc, true);

    const dotsEdit = await ev(`(() => {
      const d = stEditor.card.statusBar.blocks.filter(function(x){ return x.type === 'dots'; })[0];
      const p = stSbChain(d.id).slice(-1)[0].path;
      stSet(p + '.icon', '★'); stSet(p + '.count', '4');
      const doc = String(stSbRegex().replaceString);
      return { icons: (doc.match(/★/g) || []).length };
    })()`);
    check('改圆点字符与个数 → 2×4 个字符', dotsEdit.icons, 8);

    // 整页来一张：要能同时看到「解析报告 + 外壳附加样式 + 三栏画布」
    await cdp.send('Emulation.setDeviceMetricsOverride',
      { width: 1440, height: 1500, deviceScaleFactor: 1, mobile: false }, SID);
    await ev(`document.querySelector('.st-sb-top').scrollIntoView({block:'start'})`);
    await sleep(200);
    await shot('sb3-parsed.png');
    await cdp.send('Emulation.setDeviceMetricsOverride',
      { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, SID);

    // ============ D. 还原 ============
    console.log('\n== D. 还原解析前的 HTML ==');
    const restored = await ev(`(() => {
      stSbRestoreParsed();
      const d = stSbDetect();
      const s = String(stSbRegex().replaceString);
      return { state: d.state, own: stEditor.sbOwn,
        same: s === ${JSON.stringify(FIXTURE)},
        canvasHits: document.querySelectorAll('#st-sb-canvas .st-sb-hit').length,
        n: stSbCount(stEditor.card.statusBar.blocks),
        parseBtn: !!document.getElementById('st-sb-parse'),
        restoreBtn: !!document.querySelector('.st-sb-report button') };
    })()`);
    check('还原后卡里那条 == 原始手写 HTML', restored.same, true);
    check('还原后又变成 foreign', restored.state, 'foreign');
    check('还原后不再接管', restored.own, false);
    check('还原后画布清空', restored.n, 0);
    check('还原后画布没有命中框', restored.canvasHits, 0);
    check('还原后「解析」按钮回来', restored.parseBtn, true);
    check('还原后报告消失', restored.restoreBtn, false);

    // 还原后还能再解析一遍（可重复）
    const reParse = await ev(`(() => {
      stSbParseFromCard();
      return { n: stSbCount(stEditor.card.statusBar.blocks), state: stSbDetect().state };
    })()`);
    check('还原后可以重新解析', reParse.n, 12);
    check('重新解析后又接管了', reParse.state, 'mine');

    // ============ E. 解析不出来时不改卡 ============
    console.log('\n== E. 解析失败时不改卡 ==');
    const bad = await ev(`(() => {
      stSbRestoreParsed();
      const keep = String(stSbRegex().replaceString);
      stSbRegex().replaceString = '只有文字，没有任何元素';
      stEditor.card.statusBar.blocks = []; stRerender();
      const r = stSbParseDoc('只有文字，没有任何元素');
      stSbParseFromCard();
      const after = String(stSbRegex().replaceString);
      const back = { state: stSbDetect().state, own: stEditor.sbOwn,
        n: stSbCount(stEditor.card.statusBar.blocks), unchanged: after === '只有文字，没有任何元素' };
      stSbRegex().replaceString = keep;
      return { ok: r.ok, why: r.why, back: back };
    })()`);
    check('纯文字解析不出来', bad.ok, false);
    check('给出原因', typeof bad.why, 'string');
    check('解析失败 → 不改卡', bad.back.unchanged, true);
    check('解析失败 → 不接管', bad.back.own, false);
    check('解析失败 → 画布不动', bad.back.n, 0);

    // ============ F. 不认识的写法别硬拆 ============
    console.log('\n== F. 边界 ==');
    const edge = await ev(`(() => {
      const mk = function(inner){
        return '<div style="border:1px solid #7b9fd4;background:#0d1320;color:#e8ecf3;padding:8px 10px">'
          + inner + '</div>';
      };
      const cases = {
        // 句子里的宏不能拆成变量块
        sentence: stSbParseDoc(mk('<div>好感度是 {{format_message_variable::stat_data.好感度}} 点</div>')),
        // 带样式的行内标签不能压成纯文本
        styled: stSbParseDoc(mk('<div>今天<b style="color:red">很好</b></div>')),
        // 无样式的行内标签可以压
        plain: stSbParseDoc(mk('<div>今天<b>很好</b></div>')),
        // 裸 div 包一个子元素 → 拆开
        bare: stSbParseDoc(mk('<div><div style="font-size:15px;font-weight:bold">标题</div></div>')),
        // 表格不能被「光壳」规则拆散
        table: stSbParseDoc(mk('<table><tr><td>甲</td><td>乙</td></tr></table>')),
        // 嵌套两层的一行多列
        nest: stSbParseDoc(mk('<div style="display:flex;gap:4px">' +
          '<div style="flex:1 1 0"><div style="display:flex;gap:4px">' +
          '<div style="flex:1 1 0"><div style="font-size:13px;font-weight:bold">甲</div></div>' +
          '<div style="flex:1 1 0"><div style="font-size:13px;font-weight:bold">乙</div></div>' +
          '</div></div>' +
          '<div style="flex:1 1 0"><div style="font-size:13px;font-weight:bold">丙</div></div>' +
          '</div>'))
      };
      const tt = function(l){ return l.map(function(b){
        return b.type + (b.children && b.children.length ? '(' + tt(b.children) + ')' : ''); }).join(','); };
      const out = {};
      Object.keys(cases).forEach(function(k){
        out[k] = cases[k].ok ? tt(cases[k].blocks) : ('ERR:' + cases[k].why);
      });
      return out;
    })()`);
    check('句子里的宏 → 文字块（不拆）', edge.sentence, 'text');
    check('带样式的行内标签 → 高级块（不丢样式）', edge.styled, 'html');
    check('无样式的行内标签 → 文字块', edge.plain, 'text');
    check('裸壳拆开', edge.bare, 'title');
    check('表格不拆散 → 高级块', edge.table, 'html');
    check('两层嵌套的一行多列', edge.nest, 'row(row(title,title),title)');

    // ============ G. 收尾 ============
    console.log('\n== G. 收尾 ==');
    check('整轮无 console 错误 / 未捕获异常',
      consoleErrors.length ? consoleErrors.slice(0, 3) : 0, 0);

    console.log(`\n========== ${pass} passed, ${fail} failed ==========`);
    if (fails.length) console.log('FAILED: ' + fails.join(' | '));
    chrome.kill(); srv.close(); cleanupProfile(); process.exit(fail ? 1 : 0);
  } catch (e) {
    console.log('\n💥 ' + (e && e.message ? e.message : e));
    if (srv) srv.close();
    chrome.kill();
    cleanupProfile();
    process.exit(1);
  }
})();
