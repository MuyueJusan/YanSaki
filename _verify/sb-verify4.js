// 第四轮：解析要「尽可能按原样」—— 自定义样式不能被抹平
//
// 两条主线：
//   A. 自往返的**最强形式**：自己的产物 → 抹掉结构注释 → 解析 → 再生成，
//      两段 HTML 必须逐字节相同。结构一样但样式被抹了，这里会当场露馅。
//   B. 手写稿里的自定义声明（轨道色 / 阴影 / 列宽 / 换行）必须进 extra 那几层，
//      并且真的出现在重新生成的 HTML 里。
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

const CANDIDATES = [8951, 8962, 8973, 8984];
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

// 手写稿，处处是「生成器画不出来」的东西。一条一条都要活着回来
const CUSTOM = [
  'box-shadow:0 4px 14px rgba(226,106,160,.35)',   // 外壳：阴影
  'background:linear-gradient(160deg,#1a1024,#2b1733)', // 外壳：渐变（纯色表达不了）
  'text-shadow:0 0 6px #ffb3d9',                   // 文字：发光
  'letter-spacing:1.5px',                          // 文字：字距
  'padding:2px 4px',                               // 文字：内边距
  'border:1px solid #ff77bb',                      // 轨道：描边
  'box-shadow:0 0 8px #ff77bb',                    // 填充层：发光
  'letter-spacing:9px',                            // 圆点：间距
  'flex:2 1 0',                                    // 分组里的列宽
  'height:2px',                                    // 分割线：加粗
  'color:#a891b8',                                 // 显示名那排的颜色（跟主题的次要色不同）
  'color:#5a3f6b'                                  // 圆点没点亮那排的颜色
];

const FIXTURE = [
  '<!doctype html><html><head><meta charset="utf-8"></head><body>',
  '<div style="border:1px solid #5a3f6b;border-radius:10px;padding:9px 11px;margin:6px 0;',
  'color:#f0e6f5;font-size:13px;line-height:1.6;box-sizing:border-box;text-align:left;',
  'background:linear-gradient(160deg,#1a1024,#2b1733);',
  'box-shadow:0 4px 14px rgba(226,106,160,.35);width:430px;max-width:100%;">',

  // 标题里带 <br>：换行必须活着回来
  '<div style="font-size:15px;font-weight:bold;color:#ffb3d9;text-align:center;',
  'margin:0 0 6px;line-height:1.4;white-space:pre-wrap">夜<br>状态</div>',

  // 文字块：发光 + 字距 + 内边距，三样都不在生成器里
  '<div style="font-size:13px;color:#f0e6f5;text-align:left;margin:3px 0;',
  'white-space:pre-wrap;line-height:1.6;text-shadow:0 0 6px #ffb3d9;',
  'letter-spacing:1.5px;padding:2px 4px">第一行<br>第二行</div>',

  // 进度条：自定义轨道底色 + 轨道描边 + 填充层发光 + 非默认圆角
  '<div style="margin:3px 0">',
  '<div style="display:flex;justify-content:space-between;font-size:11px;color:#a891b8;',
  'margin-bottom:3px"><span>体力</span>',
  '<span>{{format_message_variable::stat_data.体力}}</span></div>',
  '<div style="height:9px;background:#241a2e;border-radius:2px;overflow:hidden;',
  'border:1px solid #ff77bb">',
  '<div style="height:100%;width:0%;width:calc(({{get_message_variable::stat_data.体力}} - 0) / 100 * 100%);',
  'background:#ffb3d9;border-radius:2px;box-shadow:0 0 8px #ff77bb"></div></div></div>',

  // 圆点：自定义间距 + 亮点层发光
  '<div style="display:flex;align-items:center;gap:8px;margin:3px 0;font-size:13px;',
  'justify-content:flex-start"><span style="color:#a891b8;font-size:13px">信赖</span>',
  '<span style="position:relative;display:inline-block;line-height:1;letter-spacing:9px;',
  'white-space:nowrap"><span style="color:#5a3f6b">●●●●●</span>',
  '<span style="position:absolute;left:0;top:0;overflow:hidden;width:0px;',
  'width:calc(({{get_message_variable::stat_data.信赖}} - 0) / 5 * 85px);max-width:100%;',
  'color:#ffb3d9;text-shadow:0 0 4px #fff">●●●●●</span></span>',
  '<span style="color:#f0e6f5;font-weight:bold;font-size:13px">',
  '{{format_message_variable::stat_data.信赖}}</span></div>',

  // 加粗的分割线
  '<div style="height:2px;background:#5a3f6b;margin:7px 0"></div>',

  // 分组：左列宽度 2 份
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-sb4-'));
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
    await ev(`stMvuQuickAdd(0)`);
    await ev(`stMvuQuickAdd(2)`);
    await ev(`stSwitchTab('sb')`);
    await sleep(250);

    // ============ A. 自往返的逐字节形式 ============
    console.log('\n== A. 自往返：产物 → 解析 → 再生成，两段必须逐字节相同 ==');
    for (let i = 0; i < 6; i++) {
      const name = await ev(`ST_SB_TEMPLATES[${i}].name`);
      const r = await ev(`(() => {
        stEditor.card.statusBar.blocks = []; stEditor.sbSel = ''; stRerender();
        stSbApplyTemplate(${i});
        // 只比 body —— 注释里那行 base64 存的是块 id，解析会重新发号，
        // 那是设计如此，不该算差异
        const gen1 = stSbBodyHtml(stEditor.card.statusBar, false);
        const foreign = stSbDocHtml().replace(/<!--MVU_STATUS_BAR:[\\s\\S]*?-->/, '<!---->');
        const p = stSbParseDoc(foreign);
        if (!p.ok) return { err: p.why };
        const gen2 = stSbBodyHtml(stStatusBarFromRaw({
          theme: p.theme, width: p.width, shellExtra: p.shellExtra,
          shellOff: p.shellOff, blocks: p.blocks }), false);
        let at = -1;
        const n = Math.min(gen1.length, gen2.length);
        for (let k = 0; k < n; k++) { if (gen1.charAt(k) !== gen2.charAt(k)) { at = k; break; } }
        if (at < 0 && gen1.length !== gen2.length) at = n;
        return {
          same: gen1 === gen2, at: at,
          a: at < 0 ? '' : gen1.slice(Math.max(0, at - 70), at + 70),
          b: at < 0 ? '' : gen2.slice(Math.max(0, at - 70), at + 70),
          kept: p.stats.keptDecls, keepOk: p.keepOk, textOk: p.textOk, raw: p.stats.raw
        };
      })()`);
      if (i === 5) {   // 空白模板
        check(`模板「${name}」空白模板无块可往返`, r.same, true, 'true');
        continue;
      }
      check(`模板「${name}」再生成与原产物逐字节相同`, r.same, true,
        r.same ? '' : `第 ${r.at} 字符\n    原: ...${r.a}...\n    新: ...${r.b}...`);
      check(`模板「${name}」没有多出「保原样」的声明`, r.kept, 0);
      check(`模板「${name}」保留声明自检通过`, r.keepOk, true);
      check(`模板「${name}」没有退化成高级块`, r.raw, 0);
    }

    // ============ B. 手写稿里的自定义声明必须活着回来 ============
    console.log('\n== B. 手写稿：自定义样式逐条核对 ==');
    const b = await ev(`(() => {
      const r = stSbParseDoc(${JSON.stringify(FIXTURE)});
      if (!r.ok) return { ok: false, why: r.why };
      stEditor.card.statusBar = stStatusBarFromRaw({
        theme: r.theme, width: r.width, shellExtra: r.shellExtra,
        shellOff: r.shellOff, blocks: r.blocks });
      const html = stSbDocHtml();
      const norm = stSbNormCss(html);
      const has = s => norm.indexOf(stSbNormCss(s)) >= 0;
      const hit = function(t){ return stEditor.card.statusBar.blocks.filter(function(x){
        return x.type === t; })[0]; };
      const row = hit('row');
      return {
        ok: true, kept: r.stats.kept, keptDecls: r.stats.keptDecls,
        keepOk: r.keepOk, keepMiss: r.keepMiss, textOk: r.textOk, raw: r.stats.raw,
        shellExtra: r.shellExtra, shellOff: r.shellOff, shell: r.shell,
        shellFont: /font-family/.test(norm),
        missing: ${JSON.stringify(CUSTOM)}.filter(function(s){ return !has(s); }),
        // 逐块抽查
        titleText: hit('title') ? hit('title').text : null,
        titleType: hit('title') ? hit('title').type : null,
        textText: (function(){ const t = stEditor.card.statusBar.blocks.filter(function(x){
          return x.type === 'text'; })[0]; return t ? t.text : null; })(),
        barTrack: hit('bar') ? hit('bar').track : null,
        barExtraInner: hit('bar') ? hit('bar').extraInner : null,
        barExtraFill: hit('bar') ? hit('bar').extraFill : null,
        dotsExtraInner: hit('dots') ? hit('dots').extraInner : null,
        dotsExtraFill: hit('dots') ? hit('dots').extraFill : null,
        divExtra: hit('divider') ? hit('divider').extra : null,
        // 加粗分割线的那句 height:2px 从「保原样」升成了正经字段（自由摆放
        // 那一轮加的 w / h）—— 它能被面板和把手直接改了，不该再埋在 extra 里
        divH: hit('divider') ? hit('divider').h : null,
        divOut: html,
        varLabelColor: row && row.children[0] ? row.children[0].labelColor : null,
        barLabelColor: hit('bar') ? hit('bar').labelColor : null,
        dotsLabelColor: hit('dots') ? hit('dots').labelColor : null,
        dotsEmptyColor: hit('dots') ? hit('dots').emptyColor : null,
        dotsValueColor: hit('dots') ? hit('dots').valueColor : null,
        rowWrap0: row && row.children[0] ? row.children[0].wrapExtra : null,
        rowWrap1: row && row.children[1] ? row.children[1].wrapExtra : null,
        rowGap: row ? row.gap : null
      };
    })()`);
    check('解析成功', b.ok, true);
    check('文字内容对得上（<br> 不算丢）', b.textOk, true);
    check('没有退化成高级块', b.raw, 0);
    check('保留声明自检通过', b.keepOk, true, 'true');
    check('保留声明无遗漏', b.keepMiss, v => Array.isArray(v) && v.length === 0, '[]');
    check('自定义声明全部出现在产物里', b.missing, v => Array.isArray(v) && v.length === 0, '[]');
    // 4 而不是 5：加粗分割线那条 height:2px 现在走正经字段了（见下面那条断言），
    // 不再算「生成器表达不了的东西」。判据没松 —— 少的那一条在下面单独验
    check('保住的块数', b.kept, v => v >= 4, '>=4');
    check('保住的声明条数', b.keptDecls, v => v >= 9, '>=9');
    check('外壳渐变进 shellExtra', b.shellExtra,
      v => /linear-gradient/.test(String(v)), '含 linear-gradient');
    check('原稿没写 font-family → 关掉，不硬套主题字体', b.shellFont, false);
    check('shellOff 里正是 font-family', b.shellOff,
      v => Array.isArray(v) && v.join(',') === 'font-family', 'font-family');
    check('标题里的 <br> 还原成换行', b.titleText, '夜\n状态');
    check('带 pre-wrap 的加粗块仍认作标题', b.titleType, 'title');
    check('文字块的 <br> 还原成换行', b.textText, '第一行\n第二行');
    check('轨道底色收进 track 字段', b.barTrack, '#241a2e');
    check('轨道描边进 extraInner', b.barExtraInner,
      v => /border:1px solid #ff77bb/.test(String(v)), '含 border');
    check('轨道额外圆角进 extraInner', b.barExtraInner,
      v => /border-radius:2px/.test(String(v)), '含 border-radius:2px');
    check('填充层发光进 extraFill', b.barExtraFill,
      v => /box-shadow/.test(String(v)), '含 box-shadow');
    check('圆点间距进 extraInner', b.dotsExtraInner,
      v => /letter-spacing:9px/.test(String(v)), '含 letter-spacing:9px');
    check('亮点层发光进 extraFill', b.dotsExtraFill,
      v => /text-shadow/.test(String(v)), '含 text-shadow');
    // 加粗分割线：原来记在 extra 里，现在收进了 h 字段。
    // 判据没变 —— 那句 height:2px 必须**活着**（改得动、写得出），
    // 只是入口从「原样保留」换成了「尺寸」那一格
    check('加粗分割线收进 h 字段', b.divH, 2);
    check('  → 产物里那句 height:2px 还在', b.divOut, v => /height:2px/.test(String(v)),
      '含 height:2px');
    check('  → extra 里不再重复记一遍', b.divExtra,
      v => !/height\s*:/.test(String(v)), '不含 height');
    check('变量行的显示名颜色读回来', b.varLabelColor, '#a891b8');
    check('进度条表头颜色读回来', b.barLabelColor, '#a891b8');
    check('圆点显示名颜色读回来', b.dotsLabelColor, '#a891b8');
    check('圆点未点亮颜色读回来', b.dotsEmptyColor, '#5a3f6b');
    check('圆点数值颜色读回来（跟点亮色不是一个）', b.dotsValueColor, '#f0e6f5');
    check('分组左列宽度进 wrapExtra', b.rowWrap0, v => /flex:2 1 0/.test(String(v)), '含 flex:2 1 0');
    check('分组右列是默认宽度 → 不记', b.rowWrap1, '');
    check('分组列间距', b.rowGap, 10);

    // ============ C. 保原样与「改已有元素」共存 ============
    console.log('\n== C. 解析后改已有元素，保下来的样式不能掉 ==');
    const c = await ev(`(() => {
      const t = stEditor.card.statusBar.blocks.filter(function(x){
        return x.type === 'text'; })[0];
      const p = stSbLocate(t.id);
      stSet(p.path + '.size', '16');
      stSet(p.path + '.align', 'center');
      const html = stSbDocHtml();
      const norm = stSbNormCss(html);
      return {
        size: t.size, align: t.align,
        hasShadow: norm.indexOf(stSbNormCss('text-shadow:0 0 6px #ffb3d9')) >= 0,
        hasSpacing: norm.indexOf(stSbNormCss('letter-spacing:1.5px')) >= 0,
        hasPad: norm.indexOf(stSbNormCss('padding:2px 4px')) >= 0,
        hasSize: norm.indexOf('font-size:16px') >= 0,
        hasAlign: norm.indexOf('text-align:center') >= 0,
        keepOk: stSbParseDoc(html).keepOk
      };
    })()`);
    check('字号改成了 16', c.size, 16);
    check('对齐改成了居中', c.align, 'center');
    check('产物里出现新的字号', c.hasSize, true);
    check('产物里出现新的对齐', c.hasAlign, true);
    check('改完之后发光还在', c.hasShadow, true);
    check('改完之后字距还在', c.hasSpacing, true);
    check('改完之后内边距还在', c.hasPad, true);

    // ============ D. 丢掉一层 ============
    console.log('\n== D. 「丢掉这一层」按钮 ==');
    const d = await ev(`(() => {
      const t = stEditor.card.statusBar.blocks.filter(function(x){
        return x.type === 'text'; })[0];
      const p = stSbLocate(t.id);
      const before = t.extra;
      stSbDropExtra(p.path, 'extra');
      const norm = stSbNormCss(stSbDocHtml());
      const out = {
        before: before, after: t.extra,
        shadowGone: norm.indexOf(stSbNormCss('text-shadow:0 0 6px #ffb3d9')) < 0
      };
      // 路径 / 字段名不对时不能动到任何东西
      stSbDropExtra('card.statusBar.blocks', 'extra');
      stSbDropExtra(p.path, 'children');
      stSbDropExtra('card.statusBar', 'extra');
      out.cardOk = !!stEditor.card.statusBar && Array.isArray(stEditor.card.statusBar.blocks);
      out.blockOk = !!t && typeof t === 'object' && t.type === 'text';
      return out;
    })()`);
    check('丢之前有保留样式', d.before, v => /\S/.test(String(v)), '非空');
    check('丢之后清空了', d.after, '');
    check('产物里的发光也消失了', d.shadowGone, true);
    check('坏路径不会把 statusBar 写坏', d.cardOk, true);
    check('坏字段名不会把块写坏', d.blockOk, true);

    // ============ E. 属性面板把保留样式摆出来 ============
    console.log('\n== E. 属性面板 ==');
    const e = await ev(`(() => {
      const bar = stEditor.card.statusBar.blocks.filter(function(x){
        return x.type === 'bar'; })[0];
      stSbSelect(bar.id);
      const html = stSbInspectorHtml();
      const dom = document.querySelector('.st-sb-insp');
      const inDom = dom ? dom.innerHTML : '';
      const track = document.getElementById('st-' + stSbDomId(bar.id).replace(/^st-/, '') + '-track');
      return {
        hasKeptSection: html.indexOf('原样保留的样式') >= 0,
        hasBarTrack: html.indexOf('轨道底色') >= 0,
        inDom: inDom.indexOf('原样保留的样式') >= 0,
        trackVal: track ? track.value : null
      };
    })()`);
    check('面板里有「原样保留的样式」一节', e.hasKeptSection, true);
    check('面板里有「轨道底色」输入框', e.hasBarTrack, true);
    check('保留样式节真的渲染到 DOM 里', e.inDom, true);
    check('轨道底色输入框里是解析出来的值', e.trackVal, '#241a2e');
    await shot('sb4-inspector-kept.png', '#st-sb-inspector');

    // 圆点块：三个颜色字段都该在
    const e2 = await ev(`(() => {
      const dots = stEditor.card.statusBar.blocks.filter(function(x){
        return x.type === 'dots'; })[0];
      stSbSelect(dots.id);
      const html = stSbInspectorHtml();
      const wid = stSbDomId(dots.id).replace(/^st-/, '');
      const get = s => { const el = document.getElementById('st-' + wid + '-' + s);
        return el ? el.value : null; };
      return {
        hasL: html.indexOf('显示名颜色') >= 0,
        hasE: html.indexOf('未点亮颜色') >= 0,
        hasV: html.indexOf('数值颜色') >= 0,
        l: get('lcolor'), e: get('ecolor'), v: get('vcolor')
      };
    })()`);
    check('圆点面板有「显示名颜色」', e2.hasL, true);
    check('圆点面板有「未点亮颜色」', e2.hasE, true);
    check('圆点面板有「数值颜色」', e2.hasV, true);
    check('三个颜色输入框的值', [e2.l, e2.e, e2.v],
      v => Array.isArray(v) && v.join(',') === '#a891b8,#5a3f6b,#f0e6f5',
      '#a891b8,#5a3f6b,#f0e6f5');
    await shot('sb4-inspector-dots.png', '.st-sb-insp');

    // ============ F. 从卡里解析 → 报告里报出保原样 ============
    console.log('\n== F. 走完整流程（卡里那条是手写的） ==');
    const f = await ev(`(() => {
      stEditor.sbOwn = false;
      stEditor.card.statusBar = stBlankStatusBar();
      stSbRegex().replaceString = ${JSON.stringify(FIXTURE)};
      stSbParseFromCard();
      const r = stEditor.sbParse;
      const html = stSbDocHtml();
      return {
        own: stEditor.sbOwn,
        parse: r,
        report: stSbParseReportHtml().indexOf('原样保住') >= 0,
        keepOk: stSbParseDoc(html).keepOk,
        backup: !!stSbParseBackup,
        n: stSbCount(stEditor.card.statusBar.blocks)
      };
    })()`);
    check('已接管', f.own, true);
    check('报告里有「原样保住 N 条自定义样式」', f.report, true);
    check('报告记下了保住条数', f.parse && f.parse.keptDecls, v => Number(v) >= 9, '>=9');
    check('解析结果自检通过', f.keepOk, true);
    check('留着解析前的原稿可以还原', f.backup, true);
    check('块数', f.n, v => Number(v) >= 6, '>=6');
    await shot('sb4-canvas-kept.png', '#st-sb-canvas');
    await shot('sb4-parse-report.png', '.st-sb-report');

    // ============ G. 还原 → 原稿一模一样 ============
    console.log('\n== G. 还原 ==');
    const g = await ev(`(() => {
      stSbRestoreParsed();
      return {
        back: stSbRegex().replaceString === ${JSON.stringify(FIXTURE)},
        own: stEditor.sbOwn,
        n: stEditor.card.statusBar.blocks.length,
        state: stSbDetect().state
      };
    })()`);
    check('卡里换回了原稿（逐字节）', g.back, true);
    check('回到未接管状态', g.own, false);
    check('画布清空', g.n, 0);
    check('状态回到 foreign', g.state, 'foreign');

    // ============ G2. <br> 配 white-space:normal：换行不能被吃掉 ============
    // 原稿的 <br> 会被换成换行，靠的是生成器那句 pre-wrap。要是让原稿的
    // white-space:normal 一起进 extra（追加在最后 → 后者胜），换行当场就没了
    console.log('\n== G2. <br> 遇上 white-space:normal ==');
    const BRWS = '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
      '<div style="border:1px solid #333;border-radius:6px;padding:6px 8px;' +
      'background:#111;color:#eee;font-size:13px;line-height:1.6">' +
      '<div style="font-size:13px;color:#eee;text-align:left;margin:3px 0;' +
      'white-space:normal;line-height:1.6">甲<br>乙</div></div></body></html>';
    const g2 = await ev(`(() => {
      const r = stSbParseDoc(${JSON.stringify(BRWS)});
      if (!r.ok) return { ok: false, why: r.why };
      const b = r.blocks[0];
      stEditor.card.statusBar = stStatusBarFromRaw({
        theme: r.theme, width: r.width, shellExtra: r.shellExtra,
        shellOff: r.shellOff, blocks: r.blocks });
      const doc = stSbDocHtml();
      return {
        ok: true, type: b.type, text: b.text, extra: b.extra,
        hasPre: stSbNormCss(doc).indexOf('white-space:pre-wrap') >= 0,
        noNormal: stSbNormCss(doc).indexOf('white-space:normal') < 0,
        keepOk: r.keepOk
      };
    })()`);
    check('解析成功', g2.ok, true);
    check('文字块的 <br> 变成换行', g2.text, '甲\n乙');
    check('white-space 没被塞进 extra', g2.extra,
      v => !/white-space/i.test(String(v)), '不含 white-space');
    check('产物里是 pre-wrap', g2.hasPre, true);
    check('产物里没有被 normal 盖掉', g2.noNormal, true);

    // ============ H. 原稿根本没有外壳 ============    console.log('\n== H. 没有外壳的手写稿：不许硬套主题盒子 ==');
    const BARE = [
      '<!doctype html><html><head><meta charset="utf-8"></head><body>',
      '<div style="font-size:15px;font-weight:bold;color:#c04a6a;text-align:left;',
      'margin:0 0 6px;line-height:1.4">状态</div>',
      '<div style="font-size:14px;color:#333;text-align:left;margin:3px 0;',
      'white-space:pre-wrap;line-height:1.6">今天心情不错</div>',
      '</body></html>'
    ].join('\n');
    const h = await ev(`(() => {
      const r = stSbParseDoc(${JSON.stringify(BARE)});
      if (!r.ok) return { ok: false, why: r.why };
      stEditor.card.statusBar = stStatusBarFromRaw({
        theme: r.theme, width: r.width, shellExtra: r.shellExtra,
        shellOff: r.shellOff, blocks: r.blocks });
      const shell = stSbShellOpen(stEditor.card.statusBar);
      const norm = stSbNormCss(shell);
      const doc = stSbNormCss(stSbDocHtml());   // 块的颜色在 body 里，不在外壳标签里
      return {
        ok: true, shell: r.shell, off: r.shellOff, n: r.blocks.length,
        shellTag: shell.slice(0, 60),
        noBorder: norm.indexOf('border:') < 0,
        noBg: norm.indexOf('background:') < 0,
        noPad: norm.indexOf('padding:') < 0,
        noFont: norm.indexOf('font-family') < 0,
        noSize: norm.indexOf('font-size') < 0,
        hasColor: doc.indexOf('color:#333') >= 0 && doc.indexOf('color:#c04a6a') >= 0
      };
    })()`);
    check('解析成功', h.ok, true);
    check('认出「没有外壳」', h.shell, false);
    check('11 个外壳属性全关掉', h.off, v => Array.isArray(v) && v.length === 11, '11');
    check('生成的盒子没有边框', h.noBorder, true);
    check('生成的盒子没有底色', h.noBg, true);
    check('生成的盒子没有内边距', h.noPad, true);
    check('生成的盒子没有字体', h.noFont, true);
    check('生成的盒子没有字号', h.noSize, true);
    check('文字自己的颜色还在', h.hasColor, true);
    check('两个块都在', h.n, 2);

    // 反过来：按钮一按，主题外框回来
    const h2 = await ev(`(() => {
      stSbShellToggle();
      const sb = stEditor.card.statusBar;
      const shell = stSbShellOpen(sb);
      const norm = stSbNormCss(shell);
      const on = norm.indexOf('border:1pxsolid') >= 0 && norm.indexOf('padding:') >= 0;
      stSbShellToggle();
      return { on: on, off: sb.shellOff.length,
        backOff: stSbNormCss(stSbShellOpen(sb)).indexOf('border:') < 0 };
    })()`);
    check('点一下 → 主题外框回来', h2.on, true);
    check('再点一下 → 又关掉', h2.backOff, true);

    // ============ I. 零报错 ============
    console.log('\n== I. 控制台 ==');
    check('没有页面报错', consoleErrors, v => v.length === 0,
      consoleErrors.slice(0, 3).join(' | '));
    check('confirm 只弹了预期次数',
      (await ev('window.__dlg || []')).concat(DIALOGS).length, v => v >= 1, '>=1');

  } catch (err) {
    fail++; fails.push('运行异常');
    console.log('❌ 运行异常: ' + (err && err.stack ? err.stack : err));
  } finally {
    try { if (srv) srv.close(); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
    // ⚠ profile 目录要自己删 —— 不删的话每跑一次就多一个（实测堆到 873 个 / 14.5 GB）
    try { require('child_process').spawn(process.execPath, ['-e', 'require("fs").rmSync(process.argv[1],{recursive:true,force:true,maxRetries:0})', profile], { detached: true, stdio: 'ignore' }).unref(); } catch (e) {}
  }

  console.log(`\n===== 第四轮：${pass} 通过 / ${fail} 失败 =====`);
  if (fails.length) { console.log('失败项：'); fails.forEach(f => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
})();
