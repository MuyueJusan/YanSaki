// 第二轮：补上第一轮没覆盖到的面
//   圆点块 / 分割线 / 间距 / 高级 HTML / 颜色「跟随主题」/ 刷新后草稿恢复 /
//   选中分组时从块库加点 / 转义边界
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

const CANDIDATES = [8890, 8793, 8901, 8912, 8923];
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-sb2-'));
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
        await sleep(250);
        await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'start'})`);
        await sleep(200);
      }
    }
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' }, SID);
    const buf = Buffer.from(r.data, 'base64');
    fs.writeFileSync(path.join(SHOTS, name), buf);
    console.log(`  📸 ${name} (${Math.round(buf.length / 1024)} KB)`);
    if (saved) {
      await cdp.send('Emulation.setDeviceMetricsOverride',
        { width: saved.width, height: saved.height, deviceScaleFactor: 1, mobile: false }, SID);
    }
  };

  try {
    let wsUrl = null;
    for (let i = 0; i < 60; i++) {
      try { wsUrl = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json()).webSocketDebuggerUrl; } catch (e) {}
      if (wsUrl) break;
      await sleep(250);
    }
    if (!wsUrl) throw new Error('Chrome 调试端口没起来');
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
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

    // 起手：装 MVU + 建一个真实变量树
    await ev('openStEditor()');
    await ev(`stSwitchTab('mvu')`);
    await ev(`stMvuInstallClick()`);
    await ev(`stMvuQuickAdd(0)`);      // 好感度 number 0~100
    await ev(`stMvuQuickAdd(2)`);      // 好感阶段 enum
    await ev(`stSwitchTab('sb')`);
    await sleep(250);

    // 临时诊断守卫：stSbLocate 递归超过 25 层就把当时的块结构 + 完整调用栈吐出来
    if (process.env.SB_DIAG) {
      await ev(`(() => {
        Error.stackTraceLimit = 300;
        window.__origLocate = stSbLocate;
        window.__depth = 0;
        stSbLocate = function(id, list, prefix) {
          window.__depth++;
          if (window.__depth > 25) {
            window.__depth = 0;
            const dump = (function walk(l, d) {
              return (Array.isArray(l) ? l : [{ __NOT_ARRAY__: Object.prototype.toString.call(l) }])
                .map(b => ({ d: d, id: String(b.id).slice(0, 8), type: b.type,
                  chArr: Array.isArray(b.children),
                  chRaw: b.children === undefined ? 'undef' : (b.children === null ? 'null' : typeof b.children),
                  kids: Array.isArray(b.children) ? walk(b.children, d + 1) : [] }));
            })(stEditor.card.statusBar.blocks, 0);
            throw new Error('SB_DIAG DEPTH>25 id=' + id + ' | listIsArray=' + Array.isArray(list) +
              ' | prefix=' + prefix + ' | sbSel=' + stEditor.sbSel +
              ' | blocks=' + JSON.stringify(dump));
          }
          try { return window.__origLocate(id, list, prefix); } finally { window.__depth--; }
        };
        return typeof stSbLocate;
      })()`);
      log('已装 stSbLocate 深度守卫');
    }

    console.log('\n== A. 圆点块（dots） ==');
    await ev(`(() => { stEditor.card.statusBar.blocks = []; stEditor.sbSel = ''; stSbSync(); stRerender(); })()`);
    const dots = await ev(`(() => {
      stSbAddBlock('dots');
      const b = stSbSelected().block;
      const doc = stSbDocHtml();
      return {
        type: b.type, path: b.path, label: b.label, count: b.count, icon: b.icon,
        min: b.min, max: b.max,
        hasTrack: doc.indexOf('position:absolute;left:0;top:0;overflow:hidden') >= 0,
        hasCalc: doc.indexOf('* ' + (b.count * Math.max(10, b.size + 4)) + 'px') >= 0,
        icons: (doc.match(/●/g) || []).length,
        fields: ['count', 'icon'].map(k => !!document.getElementById('st-' +
          stSbDomId(b.id).replace(/^st-/, '') + (k === 'count' ? '-count' : '-icon')))
      };
    })()`);
    check('圆点块自动挑了数值变量', dots.path, 'stat_data.好感度');
    check('带上变量自己的 min / max', [dots.min, dots.max], v => v[0] === 0 && v[1] === 100, '[0,100]');
    check('圆点个数默认 5', dots.count, 5);
    check('产物里有叠层裁切结构（纯 CSS 点亮 N 个）', dots.hasTrack, true);
    check('亮点宽度按 count 算', dots.hasCalc, true);
    check('圆点字符出现 2×count 次（底排 + 亮排）', dots.icons, dots.count * 2);
    check('属性面板有「圆点个数」', dots.fields[0], true);
    check('属性面板有「圆点字符」', dots.fields[1], true);
    const dots8 = await ev(`(() => {
      const b = stSbSelected().block;
      const p = stSbChain(b.id).slice(-1)[0].path;
      stSet(p + '.count', '8');
      const doc = stSbDocHtml();
      return { count: b.count, icons: (doc.match(/●/g) || []).length,
        clamped: (stSet(p + '.count', '99'), b.count) };
    })()`);
    check('改成 8 个 → 产物里 16 个圆点字符', dots8.icons, 16);
    check('圆点数 99 被夹到 20', dots8.clamped, 20);
    await ev(`(() => { const b = stSbSelected().block; stSet(stSbChain(b.id).slice(-1)[0].path + '.count', '5'); })()`);

    console.log('\n== B. 分割线 / 间距 / 高级 HTML ==');
    const misc = await ev(`(() => {
      stEditor.card.statusBar.blocks = []; stEditor.sbSel = ''; stSbSync(); stRerender();
      stSbAddBlock('divider');
      const d = stSbSelected().block;
      stSet(stSbChain(d.id).slice(-1)[0].path + '.color', '#ff00aa');
      // 属性面板要**在选中分割线的时候**量 —— 后面加了间距块，选中就换人了
      // 自由摆放的 X / Y 和尺寸的 W / H 是**每种块都有的**（分割线也能往下挪
      // 3px、也能调粗一点），不属于「这个块类型多余的字段」，所以从计数里排掉。
      // ⚠ 以后再加「人人都有」的字段，这里也得跟着排 —— 不然又是这个假报警
      const inspDivider = {
        color: document.querySelectorAll('.st-sb-insp input[type="color"]').length,
        other: document.querySelectorAll(
          '.st-sb-insp input[type="number"]:not([id$="-offx"]):not([id$="-offy"])' +
          ':not([id$="-w"]):not([id$="-h"]),' +
          '.st-sb-insp input[type="text"]').length
      };
      stSbAddBlock('space');
      const sp = stSbSelected().block;
      stSet(stSbChain(sp.id).slice(-1)[0].path + '.height', '12');
      const doc = stSbDocHtml();
      return {
        divider: doc.indexOf('height:1px;background:#ff00aa') >= 0,
        space: doc.indexOf('height:12px') >= 0,
        heightClamp: (stSet(stSbChain(sp.id).slice(-1)[0].path + '.height', '0'), sp.height),
        dividerColorFields: inspDivider.color,
        dividerOtherFields: inspDivider.other
      };
    })()`);
    check('分割线用了指定的线色', misc.divider, true);
    check('间距用了指定高度', misc.space, true);
    check('间距高度 0 被夹到 1', misc.heightClamp, 1);
    check('分割线只有一个颜色字段', misc.dividerColorFields, 1);
    check('分割线没有多余的文本框', misc.dividerOtherFields, 0);

    console.log('\n== C. 转义边界（只有「高级 HTML」原样透传） ==');
    const esc = await ev(`(() => {
      stEditor.card.statusBar.blocks = []; stEditor.sbSel = ''; stSbSync(); stRerender();
      stSbAddBlock('html');
      const h = stSbSelected().block;
      stSet(stSbChain(h.id).slice(-1)[0].path + '.text', '<b>RAW</b><i>');
      stSbAddBlock('text');
      const t = stSbSelected().block;
      stSet(stSbChain(t.id).slice(-1)[0].path + '.text', '<b>ESC</b>');
      const doc = stSbDocHtml();
      return {
        raw: doc.indexOf('<b>RAW</b><i>') >= 0,
        escaped: doc.indexOf('&lt;b&gt;ESC&lt;/b&gt;') >= 0,
        noLeak: doc.indexOf('<b>ESC</b>') < 0
      };
    })()`);
    check('高级 HTML 块原样透传（含未闭合标签）', esc.raw, true);
    check('文字块的尖括号被转义', esc.escaped, true);
    check('文字块不会漏出真标签', esc.noLeak, true);
    check('未闭合标签没吞掉后面的块（块数没少）',
      await ev(`document.querySelectorAll('#st-sb-canvas .st-sb-hit').length`), 2);

    console.log('\n== D. 颜色「跟随主题」 ==');
    const col = await ev(`(() => {
      stEditor.card.statusBar.blocks = []; stEditor.sbSel = ''; stSbSync(); stRerender();
      stSbAddBlock('title');
      const b = stSbSelected().block;
      const p = stSbChain(b.id).slice(-1)[0].path;
      stSet(p + '.color', '#ff0000');
      const on = { doc: stSbDocHtml().indexOf('#ff0000') >= 0,
        btn: document.querySelector('.st-sb-insp').innerHTML.indexOf('跟随主题') >= 0,
        btnIsButton: !!document.querySelector('.st-sb-insp .st-sb-color button') };
      // 先故意用**整块的路径**调一次 —— 这是曾经的爆栈现场：
      // stSet 会把块对象整个写成 ''，然后所有按 id 找块的遍历无限递归。
      // 现在必须是个彻底的空操作，连块本身都不能被碰坏
      let guard = null;
      try {
        stSbClearColor(p);
        // 顺手把 stSet 的对象保护也压一遍：标量不许顶掉块 / 顶掉 statusBar 本身
        stSet(p, 'oops');
        stSet('card.statusBar', 'oops');
        stSet('card.mvu', 'oops');
        guard = { threw: false, stillBlock: typeof stEditor.card.statusBar.blocks[0] === 'object',
          color: b.color, sel: stSbLocate(b.id) ? 'found' : 'lost',
          sbObj: typeof stEditor.card.statusBar === 'object',
          sbArr: Array.isArray(stEditor.card.statusBar.blocks),
          mvuObj: typeof stEditor.card.mvu === 'object' };
      } catch (e) { guard = { threw: true, msg: String(e.message).slice(0, 60) }; }
      stSbClearColor(p + '.color');
      const off = { color: b.color, doc: stSbDocHtml().indexOf('#ff0000') >= 0,
        btn: !!document.querySelector('.st-sb-insp .st-sb-color button') };
      return { on: on, off: off, guard: guard,
        themeColor: stSbDocHtml().indexOf('#79aed2') >= 0 };
    })()`);
    check('设了颜色 → 进了产物', col.on.doc, true);
    check('设了颜色 → 出现「跟随主题」按钮', col.on.btnIsButton, true);
    check('误传「整块路径」不会抛异常', col.guard.threw, false);
    check('误传「整块路径」不会把块写成标量', col.guard.stillBlock, true);
    check('误传「整块路径」后块还找得到', col.guard.sel, 'found');
    check('误传「整块路径」不会动到颜色', col.guard.color, '#ff0000');
    check('标量顶不掉 statusBar 本身', col.guard.sbObj, true);
    check('标量顶不掉块列表', col.guard.sbArr, true);
    check('标量顶不掉 MVU 结构', col.guard.mvuObj, true);
    check('点跟随主题 → 颜色清空', col.off.color, '');
    check('点跟随主题 → 产物里不再有那个色', col.off.doc, false);
    check('点跟随主题 → 按钮消失', col.off.btn, false);
    check('回落到主题色', col.themeColor, true);

    console.log('\n== E. 选中分组时从块库加点 ==');
    const intoRow = await ev(`(() => {
      stEditor.card.statusBar.blocks = []; stEditor.sbSel = ''; stSbSync(); stRerender();
      stSbAddBlock('row');
      const row = stSbSelected().block;
      const rootN0 = stEditor.card.statusBar.blocks.length;
      stSbAddBlock('title');           // 选中是分组 → 应进分组
      const after1 = { kids: row.children.length, root: stEditor.card.statusBar.blocks.length };
      const newId = stSbSelected().block.id;
      stEditor.sbSel = row.id; stRerender();
      stSbAddBlock('divider');
      return { rootN0: rootN0, after1: after1, kids2: row.children.length,
        root2: stEditor.card.statusBar.blocks.length,
        inRow: row.children.some(k => k.id === newId) };
    })()`);
    check('选中分组时新块进分组（不落根）', intoRow.after1.kids, 1);
    check('根层数没变', intoRow.after1.root, intoRow.rootN0);
    check('再点一个还是进分组', intoRow.kids2, 2);
    check('根层仍然没变', intoRow.root2, intoRow.rootN0);
    check('第一个新块确实挂在分组下', intoRow.inRow, true);

    console.log('\n== F. 写回幂等 ==');
    const idem = await ev(`(() => {
      const a = stSbRegex().replaceString;
      const did1 = stSbSync();
      const b = stSbRegex().replaceString;
      const did2 = stSbSync();
      return { same: a === b, did1: did1, did2: did2 };
    })()`);
    check('内容没变时 stSbSync 返回 false', idem.did1, false);
    check('连点两次也不改内容', idem.same, true);
    check('第二次同样返回 false', idem.did2, false);

    console.log('\n== G. 刷新页面 → 草稿接着编辑 ==');
    const beforeReload = await ev(`(() => {
      stEditor.card.name = '刷新测试卡';
      stEditor.card.statusBar.theme = 'sakura';
      stEditor.card.statusBar.width = 360;
      stSbApplyTemplate(3);            // 星级关系（sakura）
      stSaveDraft();
      return { n: stSbCount(stEditor.card.statusBar.blocks),
        theme: stEditor.card.statusBar.theme, own: stEditor.sbOwn,
        html: stSbDocHtml() };
    })()`);
    await sleep(300);
    loaded = new Promise(res => cdp.on('Page.loadEventFired', res));
    await cdp.send('Page.reload', {}, SID);
    await loaded;
    await ev(`document.fonts.ready.then(() => true)`, true);
    await sleep(500);
    await ev('openStEditor()');
    await ev(`stSwitchTab('sb')`);
    await sleep(250);
    const afterReload = await ev(`(() => ({
      name: stEditor.card.name,
      n: stSbCount(stEditor.card.statusBar.blocks),
      theme: stEditor.card.statusBar.theme,
      width: stEditor.card.statusBar.width,
      own: stEditor.sbOwn,
      state: stSbDetect().state,
      html: stSbDocHtml(),
      canvasHits: document.querySelectorAll('#st-sb-canvas .st-sb-hit').length,
      layerRows: document.querySelectorAll('.st-sb-layers .st-mvu-row').length,
      tab: stEditor.tab
    }))()`);
    check('角色名还在', afterReload.name, '刷新测试卡');
    check('块数一样', afterReload.n, beforeReload.n);
    check('主题还在', afterReload.theme, 'sakura');
    check('宽度还在', afterReload.width, 360);
    check('接管标记还在（不用重新接管）', afterReload.own, true);
    check('检测仍认作 mine', afterReload.state, 'mine');
    check('产物逐字节一致', afterReload.html === beforeReload.html, true);
    check('画布命中框数 == 块数', afterReload.canvasHits, afterReload.n);
    check('图层行数 == 块数', afterReload.layerRows, afterReload.n);
    check('刷新后停在状态栏页', afterReload.tab, 'sb');
    check('刷新后直接改还能写回', await ev(`(() => {
      const b = stEditor.card.statusBar.blocks[0];
      const p = stSbChain(b.id).slice(-1)[0].path;
      stSet(p + '.text', '刷新后改的');
      return stSbRegex().replaceString.indexOf('刷新后改的') >= 0; })()`), true);
    await shot('sb2-reload.png', '#st-panes');

    console.log('\n== H. 从卡里读回（base64 反推） ==');
    const adopt = await ev(`(() => {
      const html = stSbDocHtml();
      stEditor.card.statusBar = stBlankStatusBar();     // 先清空，再从正则读回
      const ok = stSbAdopt();
      return { ok: ok, n: stSbCount(stEditor.card.statusBar.blocks),
        theme: stEditor.card.statusBar.theme, width: stEditor.card.statusBar.width,
        same: stSbDocHtml() === html };
    })()`);
    check('清空后能从正则读回结构', adopt.ok, true);
    check('块数读回来一致', adopt.n, afterReload.n);
    check('主题读回来一致', adopt.theme, 'sakura');
    check('宽度读回来一致', adopt.width, 360);
    check('读回后重新生成，产物逐字节一致', adopt.same, true);

    console.log('\n== I. 移除 MVU 后状态栏页不装死 ==');
    const afterRemove = await ev(`(() => {
      stEditor.card.statusBar = stBlankStatusBar();
      stEditor.card.regex = stEditor.card.regex.filter(r => stMvuRegexKind(r) !== 'sbShow');
      stEditor.sbOwn = false;
      stRerender();
      const pane = document.querySelector('.st-sb-split');
      const btns = [...document.querySelectorAll('.st-mvu-status .st-big')].map(b => b.textContent.trim());
      return { paneAlive: !!pane, canvas: !!document.getElementById('st-sb-canvas'),
        state: stSbDetect().state, btns: btns,
        sync: stSbSync() };
    })()`);
    check('没有那条正则时页面照常渲染', afterRemove.paneAlive, true);
    check('画布还在（显示空状态）', afterRemove.canvas, true);
    check('状态识别为 none', afterRemove.state, 'none');
    check('给出「去 MVU 页」的出口', afterRemove.btns, v => v.some(t => /MVU/.test(t)), afterRemove.btns);
    check('没有落脚点时 stSbSync 返回 false', afterRemove.sync, false);
    await shot('sb2-none.png', '#st-panes');

    console.log('\n== J. 收尾零报错 ==');
    check('整轮无 console 错误 / 未捕获异常', consoleErrors, v => v.length === 0, []);
    if (consoleErrors.length) console.log('   ', consoleErrors.slice(0, 8));

  } catch (e) {
    fail++; fails.push('harness: ' + e.message);
    console.log('\n💥 ' + e.stack);
  } finally {
    try { if (srv) srv.close(); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
    // ⚠ profile 目录要自己删 —— 不删的话每跑一次就多一个（实测堆到 873 个 / 14.5 GB）
    try { require('child_process').spawn(process.execPath, ['-e', 'require("fs").rmSync(process.argv[1],{recursive:true,force:true,maxRetries:0})', profile], { detached: true, stdio: 'ignore' }).unref(); } catch (e) {}
    console.log(`\n========== ${pass} passed, ${fail} failed ==========`);
    if (fails.length) console.log('FAILED: ' + fails.join(' | '));
  }
  process.exit(fail ? 1 : 0);
})();
