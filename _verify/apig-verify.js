// 第十七轮：**API 全局配置** —— 主页按钮 + 配置弹窗 + 三处「跟随」的指向
//
// 这一轮把 API 配置从「两边各存一份」改成「一份全局 + 各自的副本」：
//   · 主页新按钮【🔌 API 全局配置】开弹窗，改的是键 `apiGlobalCfg`
//   · 【ai对话】默认「跟随全局」，也能切「独立配置」（自己那份在 aiConfig.own）
//   · 【角色卡编写器】的「跟随」**从【AI 对话】改指向全局**
//
// 套件的重点全在**分辨性**上：
//   ⚠⚠ 全局那份与对话那份必须**故意设成不同的值**。写成一样的话，
//      「读全局」和「读对话」读出来是同一个字符串 —— 把实现改回去照样全绿，
//      那几条断言等于没写（RULES 六之二十六）。
//
// 八段：
//   A. 主页按钮：位置（在小游戏按钮**上方**）、真按钮点开弹窗、命中测试
//   B. 弹窗字段 + 保存落盘 + 刷新往返
//   C. 一次性迁移：老 aiChatConfig ⇒ 全局配置（且不会二次覆盖）
//   D. 【ai对话】的配置来源：跟随时只读镜像、切独立、切回来
//   E. 编写器跟随的是**全局**，不是【ai对话】
//   F. 「第一段」归属：两边都从全局取
//   G. 失败路径：测试连接 / 获取模型
//   H. 收尾零报错
//
// 跑法：node apig-verify.js
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
function section(t) { console.log(`\n== ${t} ==`); }

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

const CANDIDATES = [8991, 8992, 8993, 8994];
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

// ===== 假 fetch =====
// 弹窗里的「获取模型列表 / 测试连接」是真发请求的。全程**不碰真网络**，
// 于是失败一定是被测代码的问题，不是网络抖
const MOCK_SRC = `
(function () {
  window.__aiCalls = [];
  window.__aiScript = { models: 'openai', fail: '' };
  function jsonResponse(obj, status) {
    return new Response(JSON.stringify(obj), { status: status || 200,
      headers: { 'Content-Type': 'application/json' } });
  }
  function textResponse(t, status) { return new Response(t, { status: status || 200 }); }
  window.fetch = async function (url, init) {
    init = init || {};
    const u = String(url);
    window.__aiCalls.push({ url: u, headers: init.headers || {} });
    const S = window.__aiScript;
    if (S.fail === 'network') throw new TypeError('Failed to fetch');
    if (S.fail === 'http401') return textResponse('{"error":"bad key"}', 401);
    if (/\\/models$/.test(u)) {
      if (S.models === 'openai') return jsonResponse({ object: 'list', data: [
        { id: 'gpt-4o' }, { id: 'gpt-4o-mini' }, { id: 'gpt-4o' }] });
      if (S.models === 'alt') return jsonResponse({ models: [{ name: 'qwen-max' }, { name: 'qwen-plus' }] });
      if (S.models === 'bare') return jsonResponse([
        { id: 'models/gemini-2.5-pro' }, { name: 'llama3' }]);
      return jsonResponse({ data: [] });
    }
    // 对话请求（非 /models）。⚠ 这一支是给「空响应要说原因」那几条用的 ——
    //   空串是个**合法**返回值，所以「被拦了」和「真的空回复」在调用方看来一模一样，
    //   只有把服务端给的原因翻出来才分得开（RULES 六之二十七）
    if (S.chat) {
      if (S.chat === 'geminiBlocked') return jsonResponse({ promptFeedback: { blockReason: 'SAFETY' } });
      if (S.chat === 'geminiSafety') return jsonResponse({ candidates: [{ finishReason: 'SAFETY' }] });
      if (S.chat === 'openaiFilter') return jsonResponse({
        choices: [{ finish_reason: 'content_filter', message: { content: '' } }] });
      if (S.chat === 'reallyEmpty') return jsonResponse({ candidates: [{ finishReason: 'STOP' }] });
    }
    return jsonResponse({ ok: true });
  };
})();
`;

(async () => {
  await pickPort();
  log(`静态服务 http://127.0.0.1:${HTTP_PORT}`);
  const cdpPort = await (async () => {
    for (let i = 0; i < 80; i++) {
      const p = 9600 + Math.floor(Math.random() * 800);
      const free = await new Promise(res => {
        const probe = http.createServer();
        probe.on('error', () => { try { probe.close(); } catch (e) {} res(false); });
        probe.listen(p, '127.0.0.1', () => probe.close(() => res(true)));
      });
      if (free) return p;
      await sleep(40);
    }
    return 9600;
  })();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-apig-'));
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu',
    '--no-first-run', '--hide-scrollbars',
    `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`], { stdio: 'ignore' });

  let cdp = null, SID = null, srv = null;
  const VP = { width: 1440, height: 900, mobile: false };
  const ev = async (expr, awaitPromise = false, timeout = 40000) => {
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
  const reload = async () => {
    const loaded = new Promise(res => cdp.on('Page.loadEventFired', res));
    await cdp.send('Page.reload', {}, SID);
    await loaded;
    await ev(`document.fonts.ready.then(() => true)`, true);
    await sleep(420);
  };
  const setScript = o => ev(`(Object.assign(window.__aiScript, ${JSON.stringify(o)}), true)`);

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
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__dlg = [];
        window.confirm = function (m) { window.__dlg.push(String(m)); return true; };`
    }, SID);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK_SRC }, SID);
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
    await reload();
    log('页面加载完成');

    check('假 fetch 装上了', await ev(`typeof window.fetch === 'function' && Array.isArray(window.__aiCalls)`), true);

    // ================= A. 主页按钮 =================
    section('A. 主页按钮：位置、点开、命中测试');

    // ⚠ 认 **id**，不认「按文字 findIndex」—— 下标会随别的按钮插进来而漂，
    //   而且 `indexOf` 找不到时返回 -1，位置断言会**天然成立**。
    //   DOM 顺序改用 `compareDocumentPosition`（不靠下标）。
    const btns = await ev(`(function(){
      const nw = document.getElementById('api-global-btn');
      const gm = document.getElementById('game-entry-btn');
      if (!nw || !gm) return { ok: false };
      const pos = nw.compareDocumentPosition(gm);
      return {
        ok: true,
        isBodyChild: nw.parentElement === document.body && gm.parentElement === document.body,
        // 4 = DOCUMENT_POSITION_FOLLOWING ⇒ gm 排在 nw **之后** ⇒ nw 在上方
        after: !!(pos & 4),
        classes: String(nw.className || ''),
        label: (nw.textContent || '').trim()
      };
    })()`);
    check('两个按钮都在（#api-global-btn / #game-entry-btn）', btns.ok, true, true);
    check('两个按钮都是 body 的直属子节点', btns.isBodyChild, true, true);
    check('【API 全局配置】排在【小游戏】**上方**（DOM 顺序在前）', btns.after, true, true);
    check('按钮文案是「🔌 API 全局配置」', /API 全局配置/.test(btns.label), true, true);
    check('按钮带着 .game-entry-btn 那套间距（跟小游戏按钮同款）',
      /game-entry-btn/.test(btns.classes), true, true);

    check('弹窗初始是关着的', await ev(`document.getElementById('apiGlobalModal').classList.contains('active')`), false);

    // 走**真按钮**
    await ev(`document.getElementById('api-global-btn').click()`);
    await sleep(400);
    check('点真按钮 ⇒ 弹窗打开', await ev(`document.getElementById('apiGlobalModal').classList.contains('active')`), true);
    check('弹窗打开后有尺寸', await ev(`(function(){
      const c = document.querySelector('#apiGlobalModal .game-card');
      return c ? Math.round(c.getBoundingClientRect().height) > 200 : false; })()`), true);

    // ⚠ 量 rect 量不出「被别的层盖住」⇒ 用**命中测试**：屏幕正中必须点到弹窗自己
    const hit = await ev(`(function(){
      const el = document.getElementById('apiGlobalModal');
      const h = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      if (!h) return 'NOTHING';
      return el.contains(h) ? 'OK' : ('OTHER:' + h.tagName + '.' + h.className);
    })()`);
    check('弹窗真的盖在屏幕正中（命中测试）', hit, 'OK');
    await shot('apig-modal.png');

    await ev(`document.querySelector('#apiGlobalModal .close-game-btn').click()`);
    await sleep(350);
    check('点关闭 ⇒ 弹窗收起', await ev(`document.getElementById('apiGlobalModal').classList.contains('active')`), false);

    // ================= B. 弹窗字段 + 保存 =================
    section('B. 弹窗字段 + 保存落盘 + 刷新往返');

    const fields = await ev(`(function(){
      const ids = ['apig-provider','apig-base-url','apig-api-key','apig-model','apig-stream',
        'apig-temperature','apig-max-tokens','apig-first-seg','apig-fetch-btn','apig-test-btn',
        // 第十七轮加的：模型候选表 + Vertex 那几格（authMode / project / location / SA JSON）
        // ⚠ 它们平时是 hidden 的，但**必须在 DOM 里** —— 漏了就只会在切到 Vertex 时才炸
        // ⚠ id 一律现 grep 取真值，别照抄别猜
        // ⚠ 这段在**模板字符串里** ⇒ 注释里绝不能出现反引号（会提前结束字符串，
        //   报的是「missing ) after argument list」，看着跟注释毫无关系）
        'apig-model-list','apig-auth-mode','apig-project','apig-location','apig-sa',
        'apig-location-list','apig-vertex-box','apig-vertex-note',
        'apig-key-field','apig-project-field','apig-location-field','apig-sa-field',
        // 第十九轮加的：SA JSON 掩码条 + 「验证 JSON」按钮 + 分步结果区
        'apig-sa-masked','apig-sa-who','apig-verify-btn','apig-verify-out'];
      return ids.filter(id => !document.getElementById(id));
    })()`);
    check('弹窗字段齐全（缺的会列在这里）', fields.join(','), '', '');

    await ev(`openApiGlobalModal()`);
    await sleep(300);

    // 用真控件填一套「全局」值
    await ev(`(function(){
      const sel = document.getElementById('apig-provider');
      sel.value = 'custom'; syncApigProviderUI();
      document.getElementById('apig-base-url').value = 'https://global.test/v1';
      document.getElementById('apig-api-key').value = 'sk-GLOBAL-1';
      // ⚠ 模型控件是 input + datalist（可以手输）—— 往 input 上写 innerHTML 是**没用的**
      //   （不报错、也不生效）。要灌候选就灌 datalist，要选值就写 input.value
      document.getElementById('apig-model-list').innerHTML =
        '<option value="m-global"></option>';
      document.getElementById('apig-model').value = 'm-global';
      document.getElementById('apig-stream').checked = false;
      document.getElementById('apig-temperature').value = '0.3';
      document.getElementById('apig-max-tokens').value = '777';
      document.getElementById('apig-first-seg').value = '全局第一段';
      return true; })()`);
    await ev(`document.querySelector('#apiGlobalModal .apig-btn-primary').click()`);
    await sleep(300);

    check('保存后内存里的全局配置变了', await ev(`apiGlobal.apiKey + '|' + apiGlobal.model`), 'sk-GLOBAL-1|m-global');
    check('保存后落盘到 apiGlobalCfg',
      await ev(`((JSON.parse(localStorage.getItem('apiGlobalCfg') || 'null')) || {}).apiKey`), 'sk-GLOBAL-1');
    check('温度 / 上限 / 流式都存对了',
      await ev(`(function(){ const g = JSON.parse(localStorage.getItem('apiGlobalCfg') || 'null') || {};
        return g.temperature + '/' + g.maxTokens + '/' + g.stream; })()`), '0.3/777/false');
    check('第一段也进了全局配置', await ev(`apiGlobal.firstSeg`), '全局第一段');
    check('保存后状态行说「已保存」', await ev(`/已保存/.test(document.getElementById('apig-status').textContent)`), true);
    // ⚠ 系统提示词**不该**被吸进全局配置 —— 那是【ai对话】自己的事
    check('全局配置里没有 systemPrompt', await ev(`apiGlobal.systemPrompt === undefined`), true);

    await ev(`closeApiGlobalModal()`);
    await sleep(300);
    await reload();
    check('刷新后全局配置还在（落盘往返）', await ev(`apiGlobal.apiKey`), 'sk-GLOBAL-1');

    // ================= C. 一次性迁移 =================
    section('C. 一次性迁移：老 aiChatConfig ⇒ 全局配置');

    const LEGACY = {
      provider: 'moonshot', baseUrl: 'https://api.moonshot.cn/v1',
      apiKey: 'sk-legacy-OLD', model: 'kimi-k2',
      temperature: 1.2, maxTokens: 3333, stream: false,
      firstSeg: '老配置的第一段',
      systemPrompt: '老系统提示词', promptEnabled: true
    };
    await ev(`(function(){
      localStorage.clear();
      localStorage.setItem('aiChatConfig', ${JSON.stringify(JSON.stringify(LEGACY))});
      return true; })()`);
    await reload();

    check('迁移：全局的 Key 取自老配置', await ev(`apiGlobal.apiKey`), 'sk-legacy-OLD');
    check('迁移：全局的模型取自老配置', await ev(`apiGlobal.model`), 'kimi-k2');
    check('迁移：全局的第一段取自老配置', await ev(`apiGlobal.firstSeg`), '老配置的第一段');
    check('迁移：温度 / 上限 / 流式都搬过去了',
      await ev(`apiGlobal.temperature + '/' + apiGlobal.maxTokens + '/' + apiGlobal.stream`), '1.2/3333/false');
    check('迁移：默认就是「跟随全局」', await ev(`aiConfig.followGlobal`), true);
    check('迁移：生效值 == 老配置（外观一点没变）',
      await ev(`aiConfig.apiKey + '|' + aiConfig.model`), 'sk-legacy-OLD|kimi-k2');
    check('迁移：已经落盘了 apiGlobalCfg（不是每次重新播种）',
      await ev(`!!localStorage.getItem('apiGlobalCfg')`), true);
    check('迁移：独立那份也播种了（切过去不会一片空白）', await ev(`(aiConfig.own || {}).apiKey`), 'sk-legacy-OLD');

    // 二次载入：用户后来在全局面板改过的东西**不许**被老配置盖回去
    await ev(`(function(){ apiGlobal.apiKey = 'sk-EDITED-AFTER'; apiGlobalPersist(); return true; })()`);
    await reload();
    check('二次载入：改过的全局值不被老配置盖回去', await ev(`apiGlobal.apiKey`), 'sk-EDITED-AFTER');
    check('二次载入：生效值跟着全局走', await ev(`aiConfig.apiKey`), 'sk-EDITED-AFTER');

    // ================= D. 【ai对话】的配置来源 =================
    section('D. 【ai对话】：跟随全局 / 独立配置');

    await ev(`(function(){ apiGlobal.apiKey = 'sk-GLOBAL-1'; apiGlobal.model = 'm-global';
      apiGlobal.baseUrl = 'https://global.test/v1'; apiGlobal.provider = 'custom';
      apiGlobal.firstSeg = '全局第一段'; apiGlobalPersist(); aiApplyEffective();
      syncAiCfgSourceUI(); return true; })()`);

    check('默认跟随全局', await ev(`aiConfig.followGlobal`), true);
    check('跟随按钮高亮',
      await ev(`document.querySelector('#ai-cfg-src .ai-src-btn[data-follow="1"]').classList.contains('ai-src-on')`), true);
    check('独立按钮没高亮',
      await ev(`document.querySelector('#ai-cfg-src .ai-src-btn[data-follow="0"]').classList.contains('ai-src-on')`), false);
    check('折叠时也能看见来源（角标写着「跟随全局」）',
      await ev(`/跟随全局/.test(document.getElementById('ai-src-badge').textContent)`), true);

    // ⚠ 跟随时那批 API 控件必须是**真 disabled** ——
    //   不是「能改、但下次刷新又变回去」的假输入框（产品里已有明确立场）
    check('跟随时 API 控件是真 disabled（6 个全查）', await ev(`(function(){
      const ids = ['ai-provider','ai-api-key','ai-model','ai-stream','ai-temperature','ai-max-tokens'];
      return ids.filter(id => !document.getElementById(id).disabled).join(','); })()`), '', '');
    check('跟随时「获取模型」也点不动', await ev(`document.getElementById('ai-fetch-btn').disabled`), true);
    check('跟随时「第一段」也锁着', await ev(`document.getElementById('ai-first-seg').disabled`), true);
    check('跟随时给了「打开 API 全局配置」的出口',
      await ev(`document.getElementById('ai-cfg-src-hint').style.display !== 'none'`), true);
    check('跟随时输入框里显示的是全局那份',
      await ev(`document.getElementById('ai-api-key').value`), 'sk-GLOBAL-1');

    // 改全局 ⇒ 对话的**生效值**跟着变（走真实保存路径，不是直接调函数）
    await ev(`openApiGlobalModal()`);
    await sleep(250);
    await ev(`(function(){
      document.getElementById('apig-api-key').value = 'sk-GLOBAL-2';
      document.getElementById('apig-model-list').innerHTML =
        '<option value="m-global-2"></option>';
      document.getElementById('apig-model').value = 'm-global-2';
      return true; })()`);
    await ev(`document.querySelector('#apiGlobalModal .apig-btn-primary').click()`);
    await sleep(300);
    await ev(`closeApiGlobalModal()`);
    await sleep(250);
    check('改全局 ⇒ 对话的生效值跟着变（读 aiConfig）', await ev(`aiConfig.apiKey`), 'sk-GLOBAL-2');
    check('改全局 ⇒ 对话的模型也跟着变', await ev(`aiConfig.model`), 'm-global-2');
    check('改全局 ⇒ 对话输入框的镜像也刷新了',
      await ev(`document.getElementById('ai-api-key').value`), 'sk-GLOBAL-2');

    // 切「独立配置」（走真按钮）
    await ev(`document.querySelector('#ai-cfg-src .ai-src-btn[data-follow="0"]').click()`);
    await sleep(250);
    check('切独立：控件解锁（6 个全查）', await ev(`(function(){
      const ids = ['ai-provider','ai-api-key','ai-model','ai-stream','ai-temperature','ai-max-tokens'];
      return ids.filter(id => document.getElementById(id).disabled).join(','); })()`), '', '');
    check('切独立：第一段解锁', await ev(`document.getElementById('ai-first-seg').disabled`), false);
    check('切独立：角标改口', await ev(`/独立/.test(document.getElementById('ai-src-badge').textContent)`), true);
    check('切独立：出口提示收起来了',
      await ev(`document.getElementById('ai-cfg-src-hint').style.display`), 'none');
    check('切独立：落盘了 followGlobal=false',
      await ev(`((JSON.parse(localStorage.getItem('aiChatConfig') || 'null')) || {}).followGlobal`), false);

    // 在独立模式里改 Key，走真「保存」按钮
    await ev(`(function(){ document.getElementById('ai-api-key').value = 'sk-CHAT-OWN'; return true; })()`);
    await ev(`[...document.querySelectorAll('#ai-card button.ai-btn')].filter(b => b.textContent.trim() === '保存')[0].click()`);
    await sleep(250);
    check('独立：自己的那份（own）记下了新 Key', await ev(`(aiConfig.own || {}).apiKey`), 'sk-CHAT-OWN');
    check('独立：生效值用的是自己那份', await ev(`aiConfig.apiKey`), 'sk-CHAT-OWN');
    // ⚠ 对照：全局那份**一点没动** —— 这才证明得了「两边真的分开了」
    check('（对照）全局那份没被独立配置改掉', await ev(`apiGlobal.apiKey`), 'sk-GLOBAL-2');

    // 切回跟随
    await ev(`document.querySelector('#ai-cfg-src .ai-src-btn[data-follow="1"]').click()`);
    await sleep(250);
    check('切回跟随：生效值回到全局那份', await ev(`aiConfig.apiKey`), 'sk-GLOBAL-2');
    check('切回跟随：独立那份还留着（没被冲掉）', await ev(`(aiConfig.own || {}).apiKey`), 'sk-CHAT-OWN');
    check('切回跟随：控件重新上锁', await ev(`document.getElementById('ai-api-key').disabled`), true);

    // ⚠⚠ 跟随模式下**改系统提示词**（跟 API 配置毫无关系）也不许把独立那份冲掉。
    //   为什么这条非有不可：`persistSystemPrompt()` 在跟随模式下照样会跑
    //   （改预设 / 改提示词都会调它），而它里面会走一次 own 同步。
    //   同步要是**无条件**的，用户那份独立配置就会在这里被全局值静默替换 ——
    //   画面上什么都看不出来，只有下次切到「独立配置」才发现自己填的 Key 没了。
    await ev(`(function(){
      document.getElementById('ai-system-prompt').value = '改一下系统提示词';
      persistSystemPrompt(); return true; })()`);
    await sleep(200);
    check('跟随：改系统提示词不会冲掉独立那份', await ev(`(aiConfig.own || {}).apiKey`), 'sk-CHAT-OWN');
    check('跟随：改系统提示词也不会把生效值带歪', await ev(`aiConfig.apiKey`), 'sk-GLOBAL-2');

    // ================= D2. 模型框能手输 + Vertex 那几格的交代 =================
    section('D2. 【ai对话】：模型能手输 / Vertex 在独立模式下的交代');

    // ⚠ 这一格第十八轮从**死下拉**改成 input + datalist。断言要打在
    //   「控件类型」和「手输的值真能存下来」上 —— 只测「元素存在」的话，
    //   改回 <select> 照样绿（「获取模型」之外一个模型都选不了）
    check('⚠ 模型框是 INPUT（能手输），不是下拉',
      await ev(`document.getElementById('ai-model').tagName`), 'INPUT');
    check('⚠ 模型框挂上了 datalist（候选来自它）',
      await ev(`document.getElementById('ai-model').getAttribute('list')`), 'ai-model-list');
    check('⚠ 候选（datalist）与当前值是两个元素，不能读混',
      await ev(`document.getElementById('ai-model').id !== document.getElementById('ai-model-list').id`), true);

    // 切到独立模式才改得动
    await ev(`document.querySelector('#ai-cfg-src .ai-src-btn[data-follow="0"]').click()`);
    await sleep(250);
    await ev(`(function(){ document.getElementById('ai-model').value = '手输的对话模型-abc'; return true; })()`);
    await ev(`[...document.querySelectorAll('#ai-card button.ai-btn')].filter(b => b.textContent.trim() === '保存')[0].click()`);
    await sleep(250);
    check('⚠ 手输一个候选里没有的模型名也能存下来（独立那份）',
      await ev(`(aiConfig.own || {}).model`), '手输的对话模型-abc');
    check('⚠ 而且立刻生效（读生效值）', await ev(`aiConfig.model`), '手输的对话模型-abc');

    // 选 Vertex ⇒ 这个面板**没有**「项目 / 位置 / 认证方式」那几格，得给一句交代
    await ev(`(function(){
      const sel = document.getElementById('ai-provider');
      sel.value = 'vertex'; syncAiProviderUI(); return true; })()`);
    await sleep(200);
    check('⚠ 独立 + Vertex ⇒ 出现「那几项沿用全局」的提示',
      await ev(`document.getElementById('ai-vertex-hint').style.display !== 'none'`), true);

    // ⚠⚠ 这个面板没有那四格的控件，但保存时 `getAiConfigFromInputs()` 返回的是
    //   **新对象**、`aiSyncOwnFromEffective()` 又拿它去 `apiGlobalPick()` ——
    //   漏带这四个字段 = 在【ai对话】点一次保存，独立那份的 Vertex 设置被打回默认。
    //   画面上什么都看不出来，只有真去用 Vertex 才炸（第十八轮修过）
    await ev(`(function(){
      aiConfig.project = 'my-proj-1'; aiConfig.location = 'us-central1';
      aiConfig.authMode = 'sa'; aiConfig.saJson = '{"client_email":"x@y.z"}';
      return true; })()`);
    await ev(`[...document.querySelectorAll('#ai-card button.ai-btn')].filter(b => b.textContent.trim() === '保存')[0].click()`);
    await sleep(250);
    check('⚠⚠ 独立：保存后 project 没被打回默认', await ev(`(aiConfig.own || {}).project`), 'my-proj-1');
    check('⚠⚠ 独立：保存后 location 没被打回默认', await ev(`(aiConfig.own || {}).location`), 'us-central1');
    check('⚠⚠ 独立：保存后 authMode 没被打回默认', await ev(`(aiConfig.own || {}).authMode`), 'sa');
    check('⚠⚠ 独立：保存后 saJson 没被打回默认', await ev(`(aiConfig.own || {}).saJson`), '{"client_email":"x@y.z"}');
    check('（对照）保存后模型名还是刚手输的那个（别把这条跟上面四条混成一条）',
      await ev(`(aiConfig.own || {}).model`), '手输的对话模型-abc');

    // 切回跟随 ⇒ 提示收起（跟随时整页都是全局的镜像，没什么可交代的）
    await ev(`document.querySelector('#ai-cfg-src .ai-src-btn[data-follow="1"]').click()`);
    await sleep(250);
    check('跟随 + Vertex ⇒ 提示收起',
      await ev(`document.getElementById('ai-vertex-hint').style.display`), 'none');
    check('（对照）切回跟随之后 provider 镜像的是全局那份（不是 vertex）',
      await ev(`document.getElementById('ai-provider').value`), 'custom');

    // ================= D3. 空响应要说得出原因 =================
    section('D3. 空响应要说得出原因（测的是**接线**，不只是函数返回值）');

    // ⚠⚠ 光断言 `stAiWhyEmpty()` 返回什么是不够的 —— 那只能证明**函数本身**对，
    //   没人保证调用方真的去问了它。这里走**真请求路径**：桩返回一个空响应，
    //   看 nonStreamChat / stAiChat 会不会把原因抛出来。
    //   把 `stAiChat` / `nonStreamChat` 里那段 `if (!full) { … why … }` 删掉，
    //   这一整节就全红 —— 那才是这条断言存在的意义
    // ⚠⚠ 协议要和桩返回的**响应形状**配套：喂 OpenAI 形状的响应、却把协议设成 gemini，
    //   那 stAiWhyEmpty 走的是 gemini 分支（读 promptFeedback / candidates）——
    //   报出来的原因当然不对。这不是产品的 bug，是**测试自己搭错了对象**
    const emptyWhy = async (script, provider, baseUrl) => {
      await setScript({ chat: script, fail: '', models: 'openai' });
      return ev(`(async function(){
        const keep = JSON.stringify(aiConfig);
        try {
          aiConfig.provider = ${JSON.stringify(provider)};
          aiConfig.baseUrl = ${JSON.stringify(baseUrl)};
          aiConfig.apiKey = 'KK';
          aiConfig.model = 'm';
          aiConfig.stream = false;
          try {
            await nonStreamChat([{ role: 'user', content: 'hi' }]);
            return '(没抛错)';
          } catch (e) { return (e && e.message) || String(e); }
        } finally { Object.assign(aiConfig, JSON.parse(keep)); }
      })()`, true);
    };
    const GEM = 'https://generativelanguage.googleapis.com';
    check('⚠ gemini 被安全策略拦 → 报出 blockReason（不是静默空串）',
      await emptyWhy('geminiBlocked', 'gemini-native', GEM), v => v.indexOf('SAFETY') >= 0, '含 SAFETY');
    check('⚠ gemini finishReason=SAFETY → 报出来',
      await emptyWhy('geminiSafety', 'gemini-native', GEM), v => v.indexOf('SAFETY') >= 0, '含 SAFETY');
    check('⚠ OpenAI content_filter → 报出来',
      await emptyWhy('openaiFilter', 'openai', 'https://api.openai.com/v1'),
      v => v.indexOf('content_filter') >= 0, '含 content_filter');
    // ⚠ 对照组：**真的**空回复（finishReason = STOP）不该被当成错误 ——
    //   没有这条的话，「见空就抛」也能把上面三条骗绿
    check('（对照）正常 STOP 但内容为空 → 不抛错，照常返回',
      await emptyWhy('reallyEmpty', 'gemini-native', GEM), '(没抛错)');

    // 编写器那条路（stAiChat）是**另一份实现** —— 同一个坑两份实现最容易只改一份
    await setScript({ chat: 'geminiBlocked', fail: '', models: 'openai' });
    const chatWhy = await ev(`(async function(){
      const cfg = { mode:'own', provider:'gemini-native', proto:'gemini', apiKey:'KK',
        baseUrl:'https://generativelanguage.googleapis.com', model:'m', temperature:0.7,
        maxTokens:256, stream:false };
      try { await stAiChat([{ role:'user', content:'hi' }], { cfg: cfg, stream:false }); return '(没抛错)'; }
      catch (e) { return (e && e.message) || String(e); }
    })()`, true);
    check('⚠ stAiChat 那条路也要问原因（两份实现，别只改一份）',
      chatWhy, v => v.indexOf('SAFETY') >= 0, '含 SAFETY');
    await setScript({ chat: '', fail: '', models: 'openai' });

    // ================= E. 编写器跟随的是全局 =================
    section('E. 【角色卡编写器】跟随的是全局，不是【ai对话】');

    await ev(`openStEditor()`);
    await sleep(250);

    // 先把【ai对话】切到独立，并把对话那套改成**第三组值**
    await ev(`document.querySelector('#ai-cfg-src .ai-src-btn[data-follow="0"]').click()`);
    await sleep(200);
    await ev(`(function(){
      document.getElementById('ai-api-key').value = 'sk-CHAT-THIRD';
      document.getElementById('ai-first-seg').value = '对话自己的第一段';
      return true; })()`);
    await ev(`[...document.querySelectorAll('#ai-card button.ai-btn')].filter(b => b.textContent.trim() === '保存')[0].click()`);
    await sleep(250);
    check('（准备）对话生效值现在是第三组', await ev(`aiConfig.apiKey`), 'sk-CHAT-THIRD');
    check('（准备）它跟全局确实不同', await ev(`aiConfig.apiKey !== apiGlobal.apiKey`), true);

    await ev(`(function(){ stAi.mode = 'follow'; stAiSave(); return true; })()`);
    const wcfg = await ev(`stAiCfg()`);
    check('编写器跟随：apiKey 取的是全局那份', wcfg.apiKey, 'sk-GLOBAL-2');
    check('编写器跟随：模型取的是全局那份', wcfg.model, 'm-global-2');
    check('编写器跟随：第一段取的是全局那份', wcfg.firstSeg, '全局第一段');
    check('编写器跟随：来源标签写「API 全局配置」',
      /跟随 API 全局配置/.test(await ev(`stAiModeLabel(stAiCfg())`)), true);
    // 对照：第三组确实存在且不同 —— 上面三条才证明得了「读的是全局」
    check('（对照）对话那套是第三组，跟全局不同',
      await ev(`aiConfig.apiKey + '|' + aiConfig.firstSeg`), 'sk-CHAT-THIRD|对话自己的第一段');

    // 切回跟随，别把后面的状态带歪
    await ev(`document.querySelector('#ai-cfg-src .ai-src-btn[data-follow="1"]').click()`);
    await sleep(200);
    check('切回跟随：编写器读到的还是全局那份', (await ev(`stAiCfg()`)).apiKey, 'sk-GLOBAL-2');

    // ================= F. 「第一段」归属 =================
    section('F. 「第一段」两边都从全局取');

    await ev(`(function(){ apiGlobal.firstSeg = '全局第一段哨兵'; apiGlobalPersist(); aiApplyEffective();
      syncAiCfgSourceUI(); return true; })()`);
    check('对话：firstSegText 用的是全局那段',
      await ev(`firstSegText()`), '全局第一段哨兵');
    check('对话：输入框里显示的也是全局那段',
      await ev(`document.getElementById('ai-first-seg').value`), '全局第一段哨兵');
    check('编写器（跟随）：stAiFirstSegText 用的也是全局那段',
      await ev(`stAiFirstSegText()`), '全局第一段哨兵');

    // 独立模式下，第一段归自己
    await ev(`document.querySelector('#ai-cfg-src .ai-src-btn[data-follow="0"]').click()`);
    await sleep(200);
    await ev(`(function(){ document.getElementById('ai-first-seg').value = '独立自己的第一段'; return true; })()`);
    await ev(`[...document.querySelectorAll('#ai-card button.ai-btn')].filter(b => b.textContent.trim() === '保存')[0].click()`);
    await sleep(250);
    check('独立：对话用自己那段', await ev(`firstSegText()`), '独立自己的第一段');
    check('独立：own 里记下了自己那段', await ev(`(aiConfig.own || {}).firstSeg`), '独立自己的第一段');
    check('（对照）全局那段没被动', await ev(`apiGlobal.firstSeg`), '全局第一段哨兵');
    check('独立：编写器跟随模式仍然读全局（它不跟对话跑）',
      (await ev(`stAiCfg()`)).firstSeg, '全局第一段哨兵');

    // 复原成跟随，收尾更干净
    await ev(`document.querySelector('#ai-cfg-src .ai-src-btn[data-follow="1"]').click()`);
    await sleep(200);
    check('复原：回到跟随全局', await ev(`aiConfig.followGlobal`), true);

    // ================= G. 失败路径 =================
    section('G. 弹窗的失败路径');

    await ev(`openApiGlobalModal()`);
    await sleep(250);

    await setScript({ fail: 'network' });
    await ev(`document.querySelector('#apiGlobalModal #apig-test-btn').click()`);
    await sleep(600);
    check('测试连接：网络不通要说人话',
      await ev(`/请求发不出去|Failed to fetch/.test(document.getElementById('apig-status').textContent)`), true);
    check('测试连接：说了 Base URL / CORS 这两个常见原因',
      await ev(`/Base URL/.test(document.getElementById('apig-status').textContent)`), true);

    await setScript({ fail: 'http401' });
    await ev(`document.querySelector('#apiGlobalModal #apig-test-btn').click()`);
    await sleep(600);
    check('测试连接：401 会报出状态码',
      await ev(`/401/.test(document.getElementById('apig-status').textContent)`), true);

    await setScript({ fail: '', models: 'openai' });
    await ev(`(window.__aiCalls = [], true)`);
    // ⚠ 先把输入框清空：apigFetchModels 会把**当前输入的值**前置进候选
    //   （免得手输过的名字被拉取冲掉）⇒ 不清空的话候选里会多一项，
    //   下面那些「精确相等」的断言就全错了 —— 红的是断言不是产品
    await ev(`document.getElementById('apig-model').value = ''`);
    await ev(`document.querySelector('#apiGlobalModal #apig-fetch-btn').click()`);
    await sleep(800);
    // ⚠ 模型控件现在是 input + datalist（**可以手输**，第十七轮改的）——
    //   候选读 datalist，当前值读 input，两处不是同一个元素。
    //   原来读的是 `.options`（只有 <select> 才有），改完控件就崩在这里
    const dlOpts = `[...document.getElementById('apig-model-list').options].map(o => o.value)`;
    check('获取模型：候选（datalist）里出现了拉到的模型',
      await ev(`${dlOpts}.join(',')`), 'gpt-4o,gpt-4o-mini');
    check('获取模型：去重了（4o 只出现一次）',
      await ev(`${dlOpts}.filter(v => v === 'gpt-4o').length`), 1);
    check('⚠ 模型框是 INPUT（能手输），不是下拉',
      await ev(`document.getElementById('apig-model').tagName`), 'INPUT');
    check('⚠ 模型框挂上了 datalist（候选来自它）',
      await ev(`document.getElementById('apig-model').getAttribute('list')`), 'apig-model-list');
    check('获取模型：请求发去了 /models',
      await ev(`window.__aiCalls.length && /\\/models$/.test(window.__aiCalls[window.__aiCalls.length-1].url)`), true);
    check('获取模型：带上了 Bearer 头',
      await ev(`window.__aiCalls[window.__aiCalls.length-1].headers.Authorization`), 'Bearer sk-GLOBAL-2');

    // 手输一个**不在候选里**的模型名 —— 这是新能力的核心，别只测「从列表里选」
    await ev(`document.getElementById('apig-model').value = '手输的模型名-xyz'`);
    await ev(`document.querySelector('#apiGlobalModal .apig-btn-primary').click()`);
    await sleep(300);
    check('⚠ 手输一个候选里没有的模型名也能存下来',
      await ev(`apiGlobal.model`), '手输的模型名-xyz');
    await ev(`document.getElementById('apig-model').value = ''`);

    // 另外两种返回形状也要认（复用 stAiModelIds 的收益，别只在一种形状上绿）
    await setScript({ models: 'alt' });
    await ev(`document.querySelector('#apiGlobalModal #apig-fetch-btn').click()`);
    await sleep(700);
    check('获取模型：认 `{ models: [...] }` 这种形状',
      await ev(`${dlOpts}.join(',')`), 'qwen-max,qwen-plus');

    await setScript({ models: 'bare' });
    await ev(`document.querySelector('#apiGlobalModal #apig-fetch-btn').click()`);
    await sleep(700);
    check('获取模型：认裸数组形状，且剥掉 models/ 前缀',
      await ev(`${dlOpts}.join(',')`), 'gemini-2.5-pro,llama3');

    // 空列表要报错，不能静默当成成功
    await setScript({ models: 'empty' });
    await ev(`document.querySelector('#apiGlobalModal #apig-fetch-btn').click()`);
    await sleep(700);
    check('获取模型：空列表要报错（不静默当成功）',
      await ev(`/❌/.test(document.getElementById('apig-status').textContent)`), true);

    await ev(`closeApiGlobalModal()`);
    await sleep(250);

    // ================= G2. 复古皮肤 =================
    section('G2. 复古皮肤（新弹窗也要跟着变）');

    await ev(`openApiGlobalModal()`);
    await sleep(300);
    // ⚠ 让新加的两块**真的可见**再量 —— 藏在 display:none 里的元素照样算得出
    //   computed background，但那就变成「量了个看不见的东西」
    await ev(`(function(){
      document.getElementById('apig-provider').value = 'vertex';
      syncApigProviderUI();
      document.getElementById('apig-auth-mode').value = 'sa';
      syncApigAuthUI();
      const sa = JSON.stringify({ type:'service_account',
        client_email:'svc@demo.iam.gserviceaccount.com',
        private_key:'-----BEGIN PRIVATE KEY----- AAAA -----END PRIVATE KEY-----',
        token_uri:'https://oauth2.googleapis.com/token', project_id:'demo-proj' });
      document.getElementById('apig-sa').value = sa;
      apigSaDraft = sa;
      apigSaRender();
      const out = document.getElementById('apig-verify-out');
      out.hidden = false; out.textContent = '① 占位';
      return true; })()`);
    await sleep(200);
    const skin = () => ev(`(function(){
      const btn = document.querySelector('#apiGlobalModal .apig-btn');
      const card = document.querySelector('#apiGlobalModal .game-card');
      const note = document.querySelector('#apiGlobalModal .apig-note');
      const masked = document.getElementById('apig-sa-masked');
      const vout = document.getElementById('apig-verify-out');
      return {
        btnBg: getComputedStyle(btn).backgroundColor,
        btnRadius: getComputedStyle(btn).borderTopLeftRadius,
        cardBg: getComputedStyle(card).backgroundColor,
        noteBg: getComputedStyle(note).backgroundColor,
        maskedBg: getComputedStyle(masked).backgroundColor,
        maskedRadius: getComputedStyle(masked).borderTopLeftRadius,
        voutBg: getComputedStyle(vout).backgroundColor,
        voutRadius: getComputedStyle(vout).borderTopLeftRadius
      };
    })()`);

    // ⚠ 先取**对照组**：不加 retro-mode 时**不该**是 Win98 灰、**不该**圆角归零。
    //   没有这两条的话，「复古生效了」那几条可以被「本来就长这样」骗过去
    const s0 = await skin();
    check('（对照）非复古：弹窗按钮不是 Win98 灰', s0.btnBg, v => v !== 'rgb(192, 192, 192)', '≠ #c0c0c0');
    check('（对照）非复古：弹窗按钮有圆角', s0.btnRadius, v => v !== '0px', '≠ 0px');
    check('（对照）非复古：掩码条不是纯白', s0.maskedBg, v => v !== 'rgb(255, 255, 255)', '≠ #fff');
    check('（对照）非复古：掩码条有圆角', s0.maskedRadius, v => v !== '0px', '≠ 0px');

    await ev(`document.body.classList.add('retro-mode')`);
    await sleep(250);
    const s1 = await skin();
    check('复古：弹窗按钮变 Win98 灰', s1.btnBg, 'rgb(192, 192, 192)');
    check('复古：弹窗按钮圆角归零', s1.btnRadius, '0px');
    check('复古：弹窗卡片也变 Win98 灰', s1.cardBg, 'rgb(192, 192, 192)');
    check('复古：说明块底色变白', s1.noteBg, 'rgb(255, 255, 255)');
    check('⚠ 复古：SA 掩码条也变白（别留一块浅绿毛玻璃）', s1.maskedBg, 'rgb(255, 255, 255)');
    check('⚠ 复古：SA 掩码条圆角归零', s1.maskedRadius, '0px');
    check('⚠ 复古：验证结果区也变白', s1.voutBg, 'rgb(255, 255, 255)');
    check('⚠ 复古：验证结果区圆角归零', s1.voutRadius, '0px');

    await ev(`document.body.classList.remove('retro-mode')`);
    await sleep(250);
    const s2 = await skin();
    check('退出复古：按钮复原', s2.btnBg, v => v !== 'rgb(192, 192, 192)', '≠ #c0c0c0');
    check('退出复古：圆角也回来了', s2.btnRadius, v => v !== '0px', '≠ 0px');
    check('⚠ 退出复古：掩码条也复原（底色不再纯白）', s2.maskedBg, v => v !== 'rgb(255, 255, 255)', '≠ #fff');
    check('⚠ 退出复古：验证结果区也复原', s2.voutBg, v => v !== 'rgb(255, 255, 255)', '≠ #fff');

    // ================= G3. Vertex 两种模式的字段显隐 =================
    // ⚠⚠ 这一段是**用户报的那个 bug 的回归测试**：
    //   `syncApigAuthUI` 里写了 `keyF.hidden = (mode === 'sa')`，逻辑一直是对的 ——
    //   但 `.ai-field { display: flex }` 会**盖掉** hidden 属性自带的 `display:none`
    //   （同权重时后者输），于是完整模式下「API Key」那一格**照样看得见**。
    //   ⇒ 只断言 `el.hidden === true` 是**看不出这个 bug 的**（属性确实设上了），
    //     必须断言 computed `display === 'none'`（真的没渲染）。
    section('G3. Vertex 两种模式：字段真的藏住了吗（断言 computed display，不是 hidden 属性）');

    await ev(`openApiGlobalModal()`);
    await sleep(300);
    const vis = () => ev(`(function(){
      const g = id => {
        const el = document.getElementById(id);
        if (!el) return '(没有这个元素)';
        return getComputedStyle(el).display;
      };
      return {
        authMode: document.getElementById('apig-auth-mode').value,
        key: g('apig-key-field'),
        proj: g('apig-project-field'),
        loc: g('apig-location-field'),
        sa: g('apig-sa-field'),
        box: g('apig-vertex-box')
      };
    })()`);

    // —— 完整模式（sa）：Key 那一格必须**真的**不渲染
    await ev(`(function(){
      document.getElementById('apig-provider').value = 'vertex';
      syncApigProviderUI();
      document.getElementById('apig-auth-mode').value = 'sa';
      syncApigAuthUI();
      return true; })()`);
    await sleep(200);
    const vs = await vis();
    check('⚠⚠ 完整模式：API Key 那一格**真的**藏住了（computed display = none）', vs.key, 'none');
    check('完整模式：project 那格显示出来', vs.proj, v => v !== 'none', '≠ none');
    check('完整模式：location 那格显示出来', vs.loc, v => v !== 'none', '≠ none');
    check('完整模式：Service Account 那格显示出来', vs.sa, v => v !== 'none', '≠ none');

    // —— 快速模式（key）：反过来，Key 必须显示、project/sa 必须藏住
    await ev(`(function(){
      document.getElementById('apig-auth-mode').value = 'key';
      syncApigAuthUI();
      return true; })()`);
    await sleep(200);
    const vk = await vis();
    check('（对照）快速模式：API Key 那一格**显示**（证明上一条不是「永远 none」）', vk.key, v => v !== 'none', '≠ none');
    check('快速模式：project 那格藏住（只有完整模式才要项目 ID）', vk.proj, 'none');
    check('快速模式：Service Account 那格藏住', vk.sa, 'none');
    check('⚠ 两种模式：location 都显示（快速模式下它也真的生效，不是摆设）', vk.loc, v => v !== 'none', '≠ none');

    // —— 非 Vertex 服务商：整块 Vertex 区域都不该占地方
    await ev(`(function(){
      document.getElementById('apig-provider').value = 'openai';
      syncApigProviderUI();
      return true; })()`);
    await sleep(200);
    const vo = await vis();
    check('非 Vertex：整块 Vertex 区域藏住', vo.box, 'none');
    check('（对照）非 Vertex：API Key 那一格显示', vo.key, v => v !== 'none', '≠ none');

    await ev(`closeApiGlobalModal()`);
    await sleep(250);

    // ================= G4. 列不出来也要能用 =================
    // ⚠⚠ 两件事一起测：
    //   ① **拉模型不该要求先有模型** —— 这一步本来就是为了挑模型（`needModel:false`）。
    //      全局面板原来漏了这个开关 ⇒ Vertex 下必须先手打一个模型名才能点
    //      「获取模型列表」，等于把这个按钮废掉（编写器那边一直带着这个开关）。
    //   ② 列不出来时**退回内置候选 + 明说原因**，绝不能把失败伪装成成功
    //      —— 用户报的正是「我已经开放代理，却还是显示【列模型失败】」，
    //      而那种一句「失败」的文案让他不知道该改什么。
    section('G4. 列不出来也要能用：不要求先有模型 + 退回内置候选 + 说出原因');

    await ev(`openApiGlobalModal()`);
    await sleep(300);
    // Vertex + 快速模式 + 有 Key + 有项目（这样候选是 3 条）+ **模型名故意留空**
    await ev(`(function(){
      document.getElementById('apig-provider').value = 'vertex';
      syncApigProviderUI();
      document.getElementById('apig-auth-mode').value = 'key';
      syncApigAuthUI();
      document.getElementById('apig-api-key').value = 'K';
      document.getElementById('apig-project').value = 'demo-proj';
      document.getElementById('apig-model').value = '';
      document.getElementById('apig-model-list').innerHTML = '';
      return true; })()`);
    await sleep(200);

    // 桩：所有请求都 401（模拟「这个接口不给列」/ 账号没那个权限）
    await setScript({ fail: 'http401', models: 'openai', chat: '' });
    await ev(`(window.__aiCalls = [], true)`);
    await ev(`document.querySelector('#apiGlobalModal #apig-fetch-btn').click()`);
    await sleep(1000);

    const g4 = await ev(`(function(){
      const st = document.getElementById('apig-status');
      return {
        status: st.textContent,
        cls: st.className,
        opts: [...document.getElementById('apig-model-list').options].map(o => o.value),
        tried: window.__aiCalls.filter(c => /\\/models$/.test(c.url)).length
      };
    })()`);
    check('⚠ 模型名留空也能点「获取模型列表」（不该被「请填模型名」拦下）',
      g4.tried, v => v >= 1, '至少发了 1 次请求');
    check('⚠ Vertex 列模型逐条试候选路径（这里 3 条全 401）', g4.tried, 3);
    check('⚠ 列不出来时退回内置候选（datalist 里真的有东西可选）',
      g4.opts.length, v => v >= 3, '>=3');
    check('⚠ 状态里**明说**是「列不出来」，不是装作成功',
      g4.status, v => v.indexOf('列不出来') >= 0, '含「列不出来」');
    check('⚠⚠ 还要说清「不影响对话」（否则用户会一直以为自己配错了）',
      g4.status, v => v.indexOf('不影响对话') >= 0, '含「不影响对话」');
    check('⚠ 状态是 warn 而不是 ok（失败不许伪装成成功）',
      g4.cls, v => v.indexOf('warn') >= 0, '含 warn');

    await ev(`closeApiGlobalModal()`);
    await sleep(250);
    await setScript({ fail: '', models: 'openai' });

    // ================= H. 收尾 =================
    section('H. 收尾');
    await ev(`(function(){ stAi.mode = 'follow'; stAiSave(); return true; })()`);
    await sleep(150);
    check('收尾：没有页面异常', consoleErrors.filter(e => /EXCEPTION/.test(e)).length, 0);
    check('全程零 console.error', consoleErrors.length, 0);
    if (consoleErrors.length) consoleErrors.slice(0, 5).forEach(e => console.log('    ' + e));

    console.log(`\n===== 第十七轮（API 全局配置）：${pass} 通过 / ${fail} 失败 =====`);
    if (fails.length) { console.log('失败项：'); fails.forEach(f => console.log('  · ' + f)); }
  } catch (e) {
    fail++;
    console.log('\n💥 套件自己崩了：' + (e && e.stack ? e.stack : e));
  } finally {
    try { if (cdp) await cdp.send('Browser.close', {}, SID); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
    try { if (srv) srv.close(); } catch (e) {}
    try { require('child_process').spawn(process.execPath, ['-e', 'require("fs").rmSync(process.argv[1],{recursive:true,force:true,maxRetries:0})', profile], { detached: true, stdio: 'ignore' }).unref(); } catch (e) {}
  }
  process.exit(fail ? 1 : 0);
})();
