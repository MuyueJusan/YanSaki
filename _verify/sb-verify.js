// 状态栏外观编辑器（像编辑 PPT）的验证：真 Chrome + CDP
// 目标文件路径在这里改
const PAGE_FILE = 'G:/saki/saki.html';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const NODE = process.execPath;
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const CHROME = CHROME_CANDIDATES.find(p => fs.existsSync(p));
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
    fail++;
    fails.push(name);
    console.log(`  ❌ ${name}  actual=${JSON.stringify(actual)}  expect=${expect === undefined ? pred : JSON.stringify(expect)}`);
  }
}

// ---------- CDP ----------
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) p.rej(new Error(JSON.stringify(m.error)));
        else p.res(m.result);
      } else if (m.method) {
        (this.handlers.get(m.method) || []).forEach(f => f(m.params));
      }
    });
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
  send(method, params = {}, sessionId, timeout = 30000) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const tm = setTimeout(() => {
        this.pending.delete(id);
        rej(new Error(`CDP 超时 ${method}`));
      }, timeout);
      this.pending.set(id, {
        res: v => { clearTimeout(tm); res(v); },
        rej: e => { clearTimeout(tm); rej(e); }
      });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
    });
  }
}

// ---------- 静态服务 ----------
const CANDIDATES = [8793, 8890, 8901, 8912, 8923];
let HTTP_PORT = CANDIDATES[0];
function pickPort() {
  return new Promise(resolve => {
    const tryOne = i => {
      if (i >= CANDIDATES.length) { resolve(); return; }
      const probe = http.createServer();
      probe.on('error', () => { try { probe.close(); } catch (e) {} tryOne(i + 1); });
      probe.listen(CANDIDATES[i], '127.0.0.1', () => probe.close(() => {
        HTTP_PORT = CANDIDATES[i];
        resolve();
      }));
    };
    tryOne(0);
  });
}
function startServer() {
  const dir = path.dirname(PAGE_FILE);
  const base = path.basename(PAGE_FILE);
  return new Promise((res, rej) => {
    const srv = http.createServer((req, rep) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      const f = path.join(dir, u === '/' ? base : u.replace(/^\/+/, ''));
      fs.readFile(f, (e, buf) => {
        if (e) { rep.writeHead(404); rep.end('nope'); return; }
        const ext = path.extname(f).toLowerCase();
        const mime = ext === '.html' ? 'text/html; charset=utf-8'
          : ext === '.ttf' ? 'font/ttf'
            : ext === '.js' ? 'text/javascript'
              : ext === '.css' ? 'text/css' : 'application/octet-stream';
        rep.writeHead(200, { 'Content-Type': mime });
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-sb-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
    '--hide-scrollbars', '--disable-features=Translate',
    `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`
  ], { stdio: 'ignore' });

  let cdp = null, SID = null, srv = null;
  const VP = { width: 1440, height: 900, mobile: false };
  const setViewport = async (w, h, mobile) => {
    Object.assign(VP, { width: w, height: h, mobile });
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile
    }, SID);
  };
  const ev = async (expr, awaitPromise = false, timeout = 30000) => {
    const r = await cdp.send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise
    }, SID, timeout);
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
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: VP.width, height: Math.min(Math.max(h + 24, 320), 4000),
          deviceScaleFactor: VP.mobile ? 2 : 1, mobile: VP.mobile
        }, SID);
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
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: saved.width, height: saved.height,
        deviceScaleFactor: saved.mobile ? 2 : 1, mobile: saved.mobile
      }, SID);
    }
  };

  try {
    // 等调试端口
    let wsUrl = null;
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
        const j = await r.json();
        wsUrl = j.webSocketDebuggerUrl;
        if (wsUrl) break;
      } catch (e) {}
      await sleep(250);
    }
    if (!wsUrl) throw new Error('Chrome 调试端口没起来');

    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    cdp = new CDP(ws);

    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const att = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    SID = att.sessionId;
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
      if (p.type === 'error') {
        consoleErrors.push((p.args || []).map(a => a.value || a.description).join(' '));
      }
    });
    cdp.on('Runtime.exceptionThrown', p => {
      const d = p.exceptionDetails;
      consoleErrors.push('EXCEPTION: ' + (d.exception ? d.exception.description : d.text));
    });

    srv = await startServer();
    await setViewport(1440, 900, false);
    const loaded = new Promise(res => cdp.on('Page.loadEventFired', res));
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/` }, SID);
    await loaded;
    await ev('localStorage.clear()', false);
    const loaded2 = new Promise(res => cdp.on('Page.loadEventFired', res));
    await cdp.send('Page.reload', {}, SID);
    await loaded2;
    await ev(`document.fonts.ready.then(() => true)`, true);
    await sleep(600);
    log('页面加载完成');

    console.log('\n== A. 加载与零报错 ==');
    check('页面无 console 错误', consoleErrors, v => v.length === 0, []);
    if (consoleErrors.length) console.log('   ', consoleErrors.slice(0, 5));

    console.log('\n== B. 装 MVU，建出状态栏起点 ==');
    await ev('openStEditor()');
    check('编辑器已打开', await ev(`document.getElementById('st-overlay').classList.contains('active')`), true);
    const tabLabels = await ev(`[...document.querySelectorAll('.st-tab-label')].map(e=>e.textContent)`);
    check('选项卡里有「状态栏」', tabLabels, v => v.indexOf('状态栏') >= 0, tabLabels);
    check('「状态栏」排在 MVU 后面', tabLabels.indexOf('状态栏') - tabLabels.indexOf('MVU'), 1);

    await ev(`stSwitchTab('mvu')`);
    await ev('stMvuInstallClick()');
    const st = await ev(`(() => { const d = stSbDetect();
      return { state: d.state, own: stEditor.sbOwn, blocks: stSbCount(stEditor.card.statusBar.blocks) }; })()`);
    check('状态栏正则已建立', st.state, 'mine');
    check('自动接管了状态栏', st.own, true);
    check('自动生成了块', st.blocks, v => v > 0, '>0');

    console.log('\n== C. 切到状态栏页，三栏都渲染出来 ==');
    await ev(`stSwitchTab('sb')`);
    await sleep(200);
    check('画布存在', await ev(`!!document.getElementById('st-sb-canvas')`), true);
    const cols = await ev(`getComputedStyle(document.querySelector('.st-sb-split')).gridTemplateColumns`);
    check('三栏布局（3 个轨道）', String(cols).split(' ').length, 3, cols);
    const nBlocks = await ev(`stSbCount(stEditor.card.statusBar.blocks)`);
    const nLayer = await ev(`document.querySelectorAll('.st-sb-layers .st-mvu-row').length`);
    const nHit = await ev(`document.querySelectorAll('#st-sb-canvas .st-sb-hit').length`);
    check('图层行数 == 块数', nLayer, nBlocks, nBlocks);
    check('画布命中框数 == 块数', nHit, nBlocks, nBlocks);
    check('画布渲染出了真内容（有内联样式）',
      await ev(`document.querySelectorAll('#st-sb-canvas [style]').length`), v => v > 0, '>0');
    check('标签用 format_message_variable',
      await ev(`stSbDocHtml().indexOf('format_message_variable') >= 0`), true);
    check('替换产物里没有 <style>', await ev(`stSbDocHtml().indexOf('<style') < 0`), true);
    check('结构 base64 注释在', await ev(`stSbDocHtml().indexOf('MVU_STATUS_BAR:') >= 0`), true);

    console.log('\n== D. 无重复 id ==');
    const dupIds = await ev(`(() => { const seen = {}, dup = [];
      document.querySelectorAll('[id]').forEach(e => { if (seen[e.id]) dup.push(e.id); seen[e.id] = 1; });
      return dup; })()`);
    check('DOM 里没有重复 id', dupIds, v => v.length === 0, []);

    console.log('\n== E. 点画布上的块 = 选中 ==');
    const firstId = await ev(`stEditor.card.statusBar.blocks[0].id`);
    await ev(`document.querySelector('#st-sb-canvas [data-sb="${firstId}"]').click()`);
    await sleep(150);
    check('选中的就是它', await ev(`stEditor.sbSel`), firstId);
    check('画布上出现选中框',
      await ev(`document.querySelector('#st-sb-canvas [data-sb="${firstId}"]').classList.contains('st-sb-on')`), true);
    check('属性面板出现了字段', await ev(`document.querySelectorAll('.st-sb-insp input, .st-sb-insp select, .st-sb-insp textarea').length`), v => v > 0, '>0');
    check('图层上那一行也高亮了',
      await ev(`document.getElementById(stSbDomId(${JSON.stringify(firstId)})).classList.contains('st-mvu-sel')`), true);

    console.log('\n== E2. 双击画布 = 光标落到右边的输入框 ==');
    const dblRes = await ev(`(() => {
      const b = stEditor.card.statusBar.blocks[0];
      stEditor.sbSel = '';
      stRerender();
      const el = document.querySelector('#st-sb-canvas [data-sb="' + b.id + '"]');
      if (!el) return 'no-el';
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      const act = document.activeElement;
      return { sel: stEditor.sbSel, id: act ? act.id : '', tag: act ? act.tagName : '',
        inInsp: act ? !!act.closest('.st-sb-insp') : false,
        hasAttr: el.getAttribute('ondblclick') ? el.getAttribute('ondblclick').slice(0, 40) : null,
        hasProp: typeof el.ondblclick,
        fnExists: typeof window.stSbDblClick,
        dragAttr: el.getAttribute('draggable') };
    })()`);
    if (dblRes === 'no-el') { check('双击目标找得到', false, true); }
    else {
      check('双击把它选中了', dblRes.sel, firstId);
      check('光标落进了属性面板', dblRes.inInsp, true, JSON.stringify(dblRes));
      check('焦点在输入框 / 文本域上', dblRes.tag, v => v === 'INPUT' || v === 'TEXTAREA', dblRes.tag);
    }

    console.log('\n== F. 改属性 → 立刻写回卡里的正则 ==');    const before = await ev(`stSbRegex().replaceString.length`);
    const txtId = await ev(`stSbDomId(stEditor.card.statusBar.blocks[0].id).replace(/^st-/, '') + '-text'`);
    await ev(`(() => { const el = document.getElementById('st-' + ${JSON.stringify(txtId)});
      el.value = '测试标题XYZ'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(120);
    const after = await ev(`stSbRegex().replaceString`);
    check('卡里那条正则被重写了', after.indexOf('测试标题XYZ') >= 0, true);
    check('画布也跟着变了',
      await ev(`document.getElementById('st-sb-canvas').innerHTML.indexOf('测试标题XYZ') >= 0`), true);
    check('正则长度变了', after.length !== before, true);

    console.log('\n== G. 拖拽排序（真事件） ==');
    // 自由摆放默认是开的（拖着块 = 像素级挪位置），HTML5 拖放会主动让位。
    // 这一段测的是结构排序，所以先把它关掉 —— 两套手势是互斥的，必须各自显式声明
    check('自由摆放默认开着', await ev(`stSbFreeOn()`), true);
    await ev(`stSbFreeSet(false)`);
    check('关掉之后块恢复可拖放', await ev(
      `document.querySelector('#st-sb-canvas [data-sb]').getAttribute('draggable')`), 'true');
    const idsBefore = await ev(`stEditor.card.statusBar.blocks.map(b => b.id)`);
    check('至少两个块才测得了拖拽', idsBefore.length, v => v >= 2, '>=2');
    // 把最后一个拖到第一个的前面
    const dragResult = await ev(`(() => {
      const blocks = stEditor.card.statusBar.blocks;
      const src = document.querySelector('#st-sb-canvas [data-sb="' + blocks[blocks.length-1].id + '"]');
      const dst = document.querySelector('#st-sb-canvas [data-sb="' + blocks[0].id + '"]');
      if (!src || !dst) return 'no-el';
      const dt = new DataTransfer();
      const mk = (type, el, extra) => new DragEvent(type, Object.assign({
        bubbles: true, cancelable: true, dataTransfer: dt, ...extra
      }));
      const r = dst.getBoundingClientRect();
      const topY = Math.round(r.top + 2);
      src.dispatchEvent(mk('dragstart', src, { clientX: 5, clientY: 5 }));
      dst.dispatchEvent(mk('dragover', dst, { clientX: r.left + 5, clientY: topY }));
      const hinted = dst.className;
      dst.dispatchEvent(mk('drop', dst, { clientX: r.left + 5, clientY: topY }));
      return { hinted: hinted, order: stEditor.card.statusBar.blocks.map(b => b.id) };
    })()`);
    if (dragResult === 'no-el') { check('拖拽元素找得到', false, true); }
    else {
      check('dragover 给出了落点指示', dragResult.hinted.indexOf('st-sb-db') >= 0, true, dragResult.hinted);
      check('最后一个块被拖到了最前面',
        dragResult.order[0], idsBefore[idsBefore.length - 1]);
      check('块总数没变', dragResult.order.length, idsBefore.length);
      check('没有块凭空消失或重复',
        new Set(dragResult.order).size, idsBefore.length);
    }

    console.log('\n== H. 拖进分组（一行多列） ==');
    await ev(`(() => { stEditor.sbSel = ''; stSbAddBlock('row'); return true; })()`);
    const rowId = await ev(`(() => { const b = stEditor.card.statusBar.blocks;
      const r = b.filter(x => x.type === 'row').pop(); return r ? r.id : ''; })()`);
    check('加出了一个分组', rowId, v => v !== '', 'non-empty');
    const inResult = await ev(`(() => {
      const row = stSbBlockById(${JSON.stringify(rowId)});
      const outside = stEditor.card.statusBar.blocks.filter(x => x.type !== 'row')[0];
      if (!outside) return 'no-outside';
      const src = document.querySelector('#st-sb-canvas [data-sb="' + outside.id + '"]');
      const dst = document.querySelector('#st-sb-canvas [data-sb="' + row.id + '"]');
      const dt = new DataTransfer();
      const mk = (t, el, ex) => new DragEvent(t, Object.assign({
        bubbles: true, cancelable: true, dataTransfer: dt, ...ex
      }));
      const r = dst.getBoundingClientRect();
      const midY = Math.round(r.top + r.height / 2);
      src.dispatchEvent(mk('dragstart', src, { clientX: 5, clientY: 5 }));
      dst.dispatchEvent(mk('dragover', dst, { clientX: r.left + 10, clientY: midY }));
      const hinted = dst.className;
      dst.dispatchEvent(mk('drop', dst, { clientX: r.left + 10, clientY: midY }));
      const rr = stSbBlockById(${JSON.stringify(rowId)});
      return { hinted: hinted, kids: rr.children.length,
        rootHas: stEditor.card.statusBar.blocks.some(x => x.id === outside.id) };
    })()`);
    if (inResult === 'no-outside') { check('有可拖的块', false, true); }
    else {
      check('中间区域提示「放进分组」', inResult.hinted.indexOf('st-sb-di') >= 0, true, inResult.hinted);
      check('块进了分组', inResult.kids, v => v >= 1, '>=1');
      check('块离开了根列表', inResult.rootHas, false);
    }
    check('不能把分组拖进自己的子树', await ev(`(() => {
      const row = stSbBlockById(${JSON.stringify(rowId)});
      if (!row.children.length) return 'skip';
      const kid = row.children[0];
      return stSbHasBlock(row, kid.id);
    })()`), v => v === true || v === 'skip');
    // 收工：把自由摆放放回去。后面几段（分组 / 模板 / 窄屏 / 复古皮肤）
    // 都要在默认状态下跑，不能留一个被改过的全局开关
    await ev(`stSbFreeSet(true)`);
    check('自由摆放已恢复', await ev(`stSbFreeOn()`), true);

    console.log('\n== I. 分组操作 ==');
    const wrapRes = await ev(`(() => {
      const b = stEditor.card.statusBar.blocks.filter(x => x.type !== 'row' && x.type !== 'text' && x.type !== 'title')[0]
        || stEditor.card.statusBar.blocks.filter(x => x.type !== 'row')[0];
      if (!b) return 'none';
      const depth0 = (stSbChain(b.id) || []).length;
      const n0 = stEditor.card.statusBar.blocks.length;
      const at0 = stEditor.card.statusBar.blocks.findIndex(x => x.id === b.id);
      stSbWrapRow(b.id);
      const sel = stSbSelected();
      const depth1 = (stSbChain(b.id) || []).length;
      const isRow = sel && sel.block.type === 'row';
      const kids = sel ? sel.block.children.length : 0;
      const n1 = stEditor.card.statusBar.blocks.length;
      const at1 = stEditor.card.statusBar.blocks.findIndex(x => x.id === sel.block.id);
      stSbUnwrapRow(sel.block.id);
      return { depth0: depth0, depth1: depth1, n0: n0, n1: n1, at0: at0, at1: at1,
        isRow: isRow, kids: kids,
        depth2: (stSbChain(b.id) || []).length,
        n2: stEditor.card.statusBar.blocks.length,
        stillThere: stEditor.card.statusBar.blocks.some(x => x.id === b.id) };
    })()`);
    if (wrapRes === 'none') { check('有可包住的块', false, true); }
    else {
      check('包住是原地替换（根层数不变）', wrapRes.n1, wrapRes.n0);
      check('包住后深度 +1', wrapRes.depth1 - wrapRes.depth0, 1);
      check('包出来的分组占原来那个位置', wrapRes.at1, wrapRes.at0);
      check('包出来的是分组且选中它', wrapRes.isRow, true);
      check('原来那个块进了分组', wrapRes.kids, 1);
      check('解散后深度还原', wrapRes.depth2, wrapRes.depth0);
      check('解散分组后层数还原', wrapRes.n2, wrapRes.n0);
      check('解散后块还在', wrapRes.stillThere, true);
    }

    console.log('\n== J. 版式模板 / 主题 ==');
    await ev(`stSbApplyTemplate(1)`);   // 进度条面板
    const tpl = await ev(`(() => ({ blocks: stSbCount(stEditor.card.statusBar.blocks),
      theme: stEditor.card.statusBar.theme,
      bars: stEditor.card.statusBar.blocks.filter(b => b.type === 'bar').length }))()`);
    check('套模板后有块', tpl.blocks, v => v > 0, '>0');
    check('模板自带主题', tpl.theme, 'dark');
    check('进度条面板确实有 bar', tpl.bars, v => v >= 2, '>=2');
    check('进度条用 get_message_variable 取裸值',
      await ev(`stSbDocHtml().indexOf('get_message_variable') >= 0`), true);
    check('进度条宽度走 calc()', await ev(`stSbDocHtml().indexOf('calc((') >= 0`), true);
    check('先给 width:0% 兜底（宏取不回来也不会炸版）',
      await ev(`stSbDocHtml().indexOf('width:0%;width:calc(') >= 0`), true);
    check('换主题生效', await ev(`(() => { stSbSetTheme('terminal');
      return stEditor.card.statusBar.theme; })()`), 'terminal');
    check('主题色真的进了产物',
      await ev(`stSbDocHtml().indexOf('#04140a') >= 0`), true);
    check('换主题也写回了正则',
      await ev(`stSbRegex().replaceString.indexOf('#04140a') >= 0`), true);

    console.log('\n== K. 变量树 → 状态栏块的自动接线 ==');
    // 先建一个真实的变量树（这是用户实际会走的顺序）
    await ev(`stSwitchTab('mvu')`);
    await ev(`stMvuQuickAdd(0)`);            // 好感度 number 0~100
    await ev(`stMvuQuickAdd(1)`);            // 金钱 number
    await ev(`stSwitchTab('sb')`);
    await sleep(200);
    const autoRes = await ev(`(() => {
      stEditor.card.statusBar.blocks = [];
      stSbSync(); stRerender();
      stSbAddBlock('bar');
      const sel = stSbSelected();
      const before = { path: sel.block.path, min: sel.block.min, max: sel.block.max,
        label: sel.block.label };
      stSbAddBlock('bar');
      const second = stSbSelected().block;
      return { before: before, second: second.path,
        hint: document.querySelector('.st-sb-insp').innerHTML.indexOf('datalist') >= 0,
        opts: document.querySelectorAll('.st-sb-insp datalist option').length };
    })()`);
    check('新进度条自动挑了数值变量', autoRes.before.path, 'stat_data.好感度');
    check('带上了变量自己的 min', autoRes.before.min, 0);
    check('带上了变量自己的 max', autoRes.before.max, 100);
    check('显示名取自变量名', autoRes.before.label, '好感度');
    check('第二个进度条避开已用变量', autoRes.second, 'stat_data.金钱');
    check('路径控件带 datalist 候选', autoRes.hint, true);
    check('datalist 里有变量可选', autoRes.opts, v => v >= 2, '>=2');

    console.log('\n== L. 接管状态机 ==');
    const ownState = await ev(`(() => ({ own: stEditor.sbOwn, state: stSbDetect().state }))()`);
    check('当前是已接管 + mine', ownState.own && ownState.state === 'mine', true);
    // 模拟「卡里是别人手写的状态栏」
    await ev(`(() => { const f = String.fromCharCode(96).repeat(3);
      stSbRegex().replaceString = f + 'html\\n<div>别人手写的</div>\\n' + f;
      return stSbDetect().state; })()`);
    check('外来状态栏被认成 foreign', await ev(`stSbDetect().state`), 'foreign');
    check('foreign 时不写回（保住别人的 HTML）',
      await ev(`(() => { const n = stEditor.card.statusBar.blocks.length;
        stSbAddBlock('text');
        return stSbRegex().replaceString.indexOf('别人手写的') >= 0; })()`), true);
    // 走一遍接管（confirm 会被自动接受）
    await ev(`stSbTakeOver()`);
    await sleep(150);
    check('接管后 own = true', await ev(`stEditor.sbOwn`), true);
    check('接管后卡里那条换成了画布内容',
      await ev(`stSbRegex().replaceString.indexOf('别人手写的') < 0`), true);
    check('接管后产物带结构注释',
      await ev(`stSbRegex().replaceString.indexOf('MVU_STATUS_BAR:') >= 0`), true);
    // 对话框现在记在页里（window.__dlg），CDP 那边的 DIALOGS 只当保底
    const asked = (await ev('window.__dlg || []')).concat(DIALOGS);
    check('接管时确实弹了确认框', asked.some(m => /接管/.test(m)), true, asked);

    console.log('\n== M. 草稿往返（结构 base64 读得回来） ==');
    const roundTrip = await ev(`(() => {
      const html = stSbDocHtml();
      const at = html.indexOf('MVU_STATUS_BAR:');
      const end = html.indexOf('-->', at);
      const raw = JSON.parse(stSbB64Dec(html.slice(at + 'MVU_STATUS_BAR:'.length, end).trim()));
      const back = stStatusBarFromRaw(raw);
      return { theme: back.theme, n: stSbCount(back.blocks),
        same: stSbCount(back.blocks) === stSbCount(stEditor.card.statusBar.blocks) };
    })()`);
    check('base64 结构能解析回来', roundTrip.same, true);
    check('主题也带回来了', roundTrip.theme, v => !!v, 'non-empty');

    console.log('\n== N. 宽度 / 空状态 ==');
    check('宽度设成 320 后进了产物', await ev(`(() => {
      stSet('card.statusBar.width', '320');
      return stSbDocHtml().indexOf('width:320px') >= 0; })()`), true);
    await ev(`stSet('card.statusBar.width', '0')`);
    check('清空块后画布显示空状态', await ev(`(() => {
      stEditor.card.statusBar.blocks = [];
      stSbSync(); stRerender();
      return document.getElementById('st-sb-canvas').innerHTML.indexOf('画布是空的') >= 0; })()`), true);
    check('空画布时图层显示引导', await ev(`document.querySelector('.st-sb-layers').innerHTML.indexOf('画布还是空的') >= 0`), true);
    // ⚠ 判据按 **onclick 前缀**取，不按 `.st-sb-palette` 这个类 —— 2026-09-21 加了
    //   「预制块」之后，那一区**复用了同一个类**（两处都是「一排小按钮」），
    //   于是这条断言数到了 9 + 16 = 25。**不是产品坏了，是这条的选择器太松**：
    //   它本来想说的是「块库那 9 个原子块还在」，那就直接按块库的 handler 数
    check('空画布时块库按钮还在',
      await ev(`document.querySelectorAll('[onclick^="stSbAddBlock("]').length`), 9);
    await ev(`stSbApplyTemplate(2)`);   // 状态卡片
    check('从空状态套模板能恢复', await ev(`stSbCount(stEditor.card.statusBar.blocks)`), v => v > 0, '>0');

    console.log('\n== O. 数值夹紧 ==');
    const clampRes = await ev(`(() => {
      const b = stEditor.card.statusBar.blocks[0];
      const p = 'card.statusBar.blocks[0].size';
      stSet(p, '0');
      const a = b.size;
      stSet(p, '999');
      const c = b.size;
      stSet(p, '14');
      return { zero: a, big: c, ok: b.size };
    })()`);
    check('字号 0 被夹到 8', clampRes.zero, 8);
    check('字号 999 被夹到 40', clampRes.big, 40);
    check('字号 14 原样', clampRes.ok, 14);

    console.log('\n== P. 窄屏竖排 ==');
    await setViewport(390, 844, true);
    await sleep(300);
    const mCols = await ev(`getComputedStyle(document.querySelector('.st-sb-split')).gridTemplateColumns`);
    check('窄屏三栏变一栏', String(mCols).split(' ').length, 1, mCols);
    // ⚠ 这条取的是**整个调色板里最小的那个按钮**（块库 9 个 + 预制块 16 个 + 用户预制块的
    //   插入 / 删除键）。2026-09-21 加了预制块之后，覆盖面自动跟着变宽 ——
    //   这是「取 min」而不是「取第一个」的好处：新加进来的按钮**不用改这条也会被验到**
    const touchH = await ev(`(() => { const bs = [...document.querySelectorAll('.st-sb-palette .st-mini')];
      return Math.min(...bs.map(b => Math.round(b.getBoundingClientRect().height))); })()`);
    check('窄屏调色板里**每个**按钮都够点（>=32px，含预制块）', touchH, v => v >= 32, '>=32');
    await setViewport(1440, 900, false);
    await sleep(250);

    console.log('\n== Q. 复古皮肤 ==');
    await ev(`document.body.classList.add('retro-mode')`);
    await sleep(200);
    await ev(`document.getElementById('st-sb-canvas').scrollIntoView({block:'center'})`);
    await sleep(250);
    check('复古下画布仍可点', await ev(`(() => {
      const el = document.querySelector('#st-sb-canvas .st-sb-hit');
      if (!el) return 'no-el';
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > innerHeight) return 'offscreen:' + Math.round(r.top);
      const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
      return !!(hit && hit.closest('.st-sb-hit'));
    })()`), true);
    await shot('sb-retro.png', '#st-panes');
    await ev(`document.body.classList.remove('retro-mode')`);
    await sleep(200);

    console.log('\n== R. 截图 ==');
    await shot('sb-desktop.png', '#st-panes');
    await setViewport(390, 844, true);
    await sleep(300);
    await shot('sb-mobile.png', '#st-panes');
    await setViewport(1440, 900, false);
    await sleep(250);

    console.log('\n== S. 收尾零报错 ==');
    check('整轮无 console 错误 / 未捕获异常', consoleErrors, v => v.length === 0, []);
    if (consoleErrors.length) console.log('   ', consoleErrors.slice(0, 8));

  } catch (e) {
    fail++;
    fails.push('harness: ' + e.message);
    console.log('\n💥 ' + e.stack);
  } finally {
    try { if (srv) srv.close(); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
    // ⚠ profile 目录要自己删 —— mkdtempSync 只负责建。不删的话**每跑一次就多一个**，
    //   实测堆到 873 个目录 / 14.5 GB（`st-ai.js` 早就这么做了，这里是补齐）。
    //   maxRetries 是为 Windows：进程刚 kill 掉时目录还锁着，不重试就是 EBUSY，
    //   而那是**静默**的（外面还有一层 catch 兜着）。
    try { require('child_process').spawn(process.execPath, ['-e', 'require("fs").rmSync(process.argv[1],{recursive:true,force:true,maxRetries:0})', profile], { detached: true, stdio: 'ignore' }).unref(); } catch (e) {}
    console.log(`\n========== ${pass} passed, ${fail} failed ==========`);
    if (fails.length) console.log('FAILED: ' + fails.join(' | '));
  }
  process.exit(fail ? 1 : 0);
})();
