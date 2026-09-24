// 第九轮：**编写器的 AI 调用** —— 世界书扩写 + 开场白生成
//
// 这一轮的东西全是「要发网络请求」的，所以不能真连服务商。做法是把 window.fetch
// 整个换掉（Page.addScriptToEvaluateOnNewDocument，刷新之后桩还在），
// 按请求的 URL 形状判断对方是哪一套协议，然后回一份**形状正确**的假响应。
// 于是下面这些都能真的断言到：
//   · 请求发去了哪个 URL、带了什么头、body 长什么样（而不是「代码里写了」）
//   · 两种协议的流式增量能不能拼回原文
//   · 模型回一堆废话 + 围栏 + 尾逗号时能不能把 JSON 抠出来
//   · 生成结果落到卡里之后，条目的字段对不对
//
// 十二段：
//   A. 配置层：跟随 / 独立两种模式、协议推断、就绪判定、本机地址免 Key
//   B. 请求形状：OpenAI 走 /chat/completions、Anthropic 走 /messages
//      （system 提到顶层、首条必须是 user、连续同角色合并）
//   C. 模型列表：四种形状 + 去重排序 + 剥 models/ 前缀 + 空列表报错
//   D. 流式解析：两套 SSE 都能拼回原文，onDelta 每次都拿到累积全文
//   E. JSON 抠取：裸的 / 围栏 / 带寒暄 / 尾逗号 / 数组 / 坏 JSON
//   F. 扩写：提示词里有没有条数·要求·氛围·格式·素材；结果解析；套用进世界书
//   G. 开场白：注入顺序（停用跳过、Outlet 跳过、@D 按 depth 从大到小）
//      + 提示词带上注入预览 + 覆盖主开场白 / 追加备选
//   H. 隐私：API Key 不进卡、不进草稿、不进导出
//   I. 面板：AI 选项卡渲染、两个面板挂得上、复古皮肤下也在
//   J. 失败路径：401 / 500 / 网络不通 / 坏 JSON 都要给出能看懂的话
//   K. 草稿往返
//   L. 收尾零报错
//
// 跑法：node st-ai.js
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

const CANDIDATES = [8981, 8982, 8983, 8984];
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
// 装进页面里，按 URL 判断对方是哪一套协议，回一份形状正确的响应。
// 全程**不碰真网络**，所以断言的失败一定是被测代码的问题，不是网络抖
const MOCK_SRC = `
(function () {
  window.__aiCalls = [];
  window.__aiScript = { models: 'openai', reply: '你好', stream: true, fail: '' };
  const enc = new TextEncoder();
  function sseResponse(lines) {
    const stream = new ReadableStream({
      start(c) { lines.forEach(l => c.enqueue(enc.encode(l))); c.close(); }
    });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }
  function jsonResponse(obj, status) {
    return new Response(JSON.stringify(obj), { status: status || 200,
      headers: { 'Content-Type': 'application/json' } });
  }
  function textResponse(t, status) {
    return new Response(t, { status: status || 200 });
  }
  window.fetch = async function (url, init) {
    init = init || {};
    const u = String(url);
    let body = null;
    try { body = init.body ? JSON.parse(init.body) : null; } catch (e) {}
    window.__aiCalls.push({ url: u, method: init.method || 'GET',
      headers: init.headers || {}, body: body });
    const S = window.__aiScript;
    if (S.fail === 'network') throw new TypeError('Failed to fetch');
    if (S.fail === 'http401') return textResponse('{"error":{"message":"invalid api key"}}', 401);
    // —— 模型列表 ——
    if (/\\/models$/.test(u)) {
      if (S.models === 'openai') return jsonResponse({ object: 'list', data: [
        { id: 'gpt-4o' }, { id: 'gpt-4o-mini' }, { id: 'gpt-4o' }] });
      if (S.models === 'anthropic') return jsonResponse({ data: [
        { id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4' },
        { id: 'claude-haiku-4-20250514' }] });
      if (S.models === 'bare') return jsonResponse([
        { id: 'models/gemini-2.5-pro' }, { name: 'llama3' }]);
      if (S.models === 'alt') return jsonResponse({ models: [{ name: 'qwen-max' }, { name: 'qwen-plus' }] });
      return jsonResponse({ data: [] });
    }
    // —— 对话 ——
    const isAnth = /\\/messages$/.test(u);
    if (S.fail === 'http500') return textResponse('upstream boom', 500);
    if (isAnth) {
      if (S.stream) {
        const lines = [];
        for (let i = 0; i < S.reply.length; i += 5) {
          lines.push('event: content_block_delta\\ndata: ' + JSON.stringify({
            type: 'content_block_delta', index: 0,
            delta: { type: 'text_delta', text: S.reply.slice(i, i + 5) } }) + '\\n\\n');
        }
        lines.push('data: {"type":"message_stop"}\\n\\n');
        return sseResponse(lines);
      }
      return jsonResponse({ id: 'msg_1', type: 'message', role: 'assistant',
        content: [{ type: 'text', text: S.reply }], stop_reason: 'end_turn' });
    }
    if (S.stream) {
      const lines = [];
      for (let i = 0; i < S.reply.length; i += 5) {
        lines.push('data: ' + JSON.stringify({ choices: [{ delta: { content: S.reply.slice(i, i + 5) } }] }) + '\\n\\n');
      }
      lines.push('data: [DONE]\\n\\n');
      return sseResponse(lines);
    }
    return jsonResponse({ choices: [{ message: { role: 'assistant', content: S.reply } }] });
  };
})();
`;

(async () => {
  await pickPort();
  log(`静态服务 http://127.0.0.1:${HTTP_PORT}`);
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-stai-'));
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

  // —— 页内小工具 ——
  const clearCalls = () => ev(`(window.__aiCalls = [], true)`);
  const calls = () => ev(`window.__aiCalls`);
  const lastCall = () => ev(`(function(){ const c = window.__aiCalls; return c.length ? c[c.length-1] : null; })()`);
  const setScript = o => ev(`(Object.assign(window.__aiScript, ${JSON.stringify(o)}), true)`);
  const resetScript = () => ev(`(window.__aiScript = { models: 'openai', reply: '你好', stream: true, fail: '' }, true)`);
  // own 模式下最快的一套配置
  const useOwn = (provider, model, proto) => ev(`(function(){
    stAi.mode = 'own'; stAi.provider = ${JSON.stringify(provider)};
    stAi.model = ${JSON.stringify(model)}; stAi.proto = ${JSON.stringify(proto || '')};
    stAi.apiKey = 'sk-own-AAA'; stAi.baseUrl = 'https://my.gateway.test/v1';
    stAi.stream = true; stAiSave(); return stAiCfg(); })()`);

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
    // 页内的 confirm 换成同步桩（CDP 那条路实测会竞态，见 sb-verify 系列的注释）
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__dlg = [];
        window.confirm = function (m) { window.__dlg.push(String(m)); return true; };`
    }, SID);
    // 假 fetch 必须**每次新文档都装**，否则刷新之后就漏回真网络了
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK_SRC }, SID);
    cdp.on('Page.javascriptDialogOpening', p => {
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

    check('假 fetch 装上了', await ev(`typeof window.fetch === 'function' && Array.isArray(window.__aiCalls)`), true);

    // ================= A. 配置层 =================
    section('A. 配置层：跟随（API 全局配置）/ 独立 两种模式');
    await ev('openStEditor()');
    await sleep(200);

    check('默认是「跟随」', await ev(`stAi.mode`), 'follow');

    // ⚠⚠ 跟随目标从【AI 对话】改成【API 全局配置】之后，这两边必须**故意设成不同的值**：
    //   要是 aiConfig 与 apiGlobal 写着同一串，那「读全局」和「读对话」读出来一模一样，
    //   把实现改回 aiConfig 照样全绿 —— 下面那 6 条就等于没写（六之二十六）
    await ev(`(function(){
      apiGlobal.provider = 'deepseek';
      apiGlobal.baseUrl = 'https://api.deepseek.com/v1';
      apiGlobal.apiKey = 'sk-global-KKK';
      apiGlobal.model = 'deepseek-chat';
      apiGlobal.temperature = 0.5; apiGlobal.maxTokens = 2048;
      // 【ai对话】那边故意写另一套 —— 编写器跟不跟随都**不该**受它影响
      aiConfig.provider = 'openai';
      aiConfig.baseUrl = 'https://api.openai.com/v1';
      aiConfig.apiKey = 'sk-chat-XXX';
      aiConfig.model = 'gpt-4o';
      aiConfig.temperature = 1.9; aiConfig.maxTokens = 111;
      return true; })()`);
    let cfg = await ev(`stAiCfg()`);
    check('跟随：provider 取的是全局配置', cfg.provider, 'deepseek');
    check('跟随：baseUrl 取的是全局配置', cfg.baseUrl, 'https://api.deepseek.com/v1');
    check('跟随：apiKey 取的是全局配置', cfg.apiKey, 'sk-global-KKK');
    check('跟随：model 取的是全局配置', cfg.model, 'deepseek-chat');
    check('跟随：温度取的是全局配置', cfg.temperature, 0.5);
    check('跟随：上限取的是全局配置', cfg.maxTokens, 2048);
    check('跟随：DeepSeek 判成 OpenAI 协议', cfg.proto, 'openai');
    // ⚠ providerLabel 是**服务商**的名字（DeepSeek），「跟随谁」要看 stAiModeLabel
    check('跟随：来源标签写的是「API 全局配置」',
      /跟随 API 全局配置/.test(await ev(`stAiModeLabel(stAiCfg())`)), true);
    // 对照：对话那套确实不同 —— 上面 6 条才证明得了「读的是全局」
    check('（对照）对话那套是另一组值', await ev(`aiConfig.apiKey + '/' + aiConfig.model`), 'sk-chat-XXX/gpt-4o');

    await ev(`(function(){
      apiGlobal.baseUrl = 'https://api.anthropic.com/v1';
      apiGlobal.provider = 'custom'; return true; })()`);
    check('跟随：Anthropic 的 Base URL 自动判成 anthropic 协议',
      (await ev(`stAiCfg()`)).proto, 'anthropic');
    await ev(`(function(){
      apiGlobal.baseUrl = 'https://api.deepseek.com/v1';
      apiGlobal.provider = 'deepseek'; return true; })()`);

    check('跟随：就绪判定通过', (await ev(`stAiReady(stAiCfg())`)).ok, true);

    await ev(`(function(){ apiGlobal.apiKey = ''; return true; })()`);
    let rdy = await ev(`stAiReady(stAiCfg())`);
    check('跟随：缺 Key 会被拦住', rdy.ok, false);
    check('跟随：缺 Key 的话里提到「API 全局配置」', /API 全局配置/.test(rdy.why), true);
    // 对照：提示里**不该**再让人去【AI 对话】页 —— 那是旧指向，留着就是把用户支错地方
    check('跟随：缺 Key 的话里不再提「AI 对话」', /AI 对话/.test(rdy.why), false);

    await ev(`(function(){ stAi.mode = 'own'; stAi.provider = 'openai';
      stAi.model = ''; stAi.apiKey = 'sk-own-AAA'; stAiSave(); return true; })()`);
    rdy = await ev(`stAiReady(stAiCfg())`);
    check('独立：缺模型会被拦住', rdy.ok, false);
    check('独立：缺模型的话里提到「AI 助手」', /AI 助手/.test(rdy.why), true);

    cfg = await useOwn('openai', 'gpt-4o', '');
    check('独立：OpenAI 预设的 Base URL', cfg.baseUrl, 'https://api.openai.com/v1');
    check('独立：OpenAI 预设的协议', cfg.proto, 'openai');
    check('独立：就绪判定通过', (await ev(`stAiReady(stAiCfg())`)).ok, true);

    cfg = await useOwn('anthropic', 'claude-sonnet-4-20250514', '');
    check('独立：Anthropic 预设的 Base URL', cfg.baseUrl, 'https://api.anthropic.com/v1');
    check('独立：Anthropic 预设的协议', cfg.proto, 'anthropic');

    cfg = await useOwn('openai', 'gpt-4o', 'anthropic');
    check('独立：协议可以被手动顶成 anthropic', cfg.proto, 'anthropic');
    cfg = await useOwn('anthropic', 'claude-x', 'openai');
    check('独立：协议也可以被顶回 openai', cfg.proto, 'openai');

    cfg = await useOwn('custom', 'my-model', '');
    check('独立：自定义服务商用自己填的 Base URL', cfg.baseUrl, 'https://my.gateway.test/v1');
    check('独立：自定义默认走 OpenAI 协议', cfg.proto, 'openai');

    cfg = await useOwn('ollama', 'qwen2.5:7b', '');
    check('独立：Ollama 指向本机 11434', cfg.baseUrl, 'http://localhost:11434/v1');
    await ev(`(function(){ stAi.apiKey = ''; stAiSave(); return true; })()`);
    check('独立：本机地址不要求 Key', (await ev(`stAiReady(stAiCfg())`)).ok, true);
    check('本机地址判定', await ev(`[stAiIsLocal('http://localhost:11434/v1'),
      stAiIsLocal('http://127.0.0.1:8000/v1'), stAiIsLocal('https://api.openai.com/v1')].join(',')`),
      'true,true,false');

    check('预设表里有 Anthropic', await ev(`ST_AI_PROVIDERS.some(p => p.value === 'anthropic')`), true);
    check('预设表里只有 Anthropic 是 anthropic 协议',
      await ev(`ST_AI_PROVIDERS.filter(p => p.proto === 'anthropic').map(p => p.value).join(',')`),
      'anthropic');
    check('预设服务商数量', await ev(`ST_AI_PROVIDERS.length`), n => n >= 10, '>=10');

    // ================= B. 请求形状 =================
    section('B. 请求形状：两套协议');
    await useOwn('openai', 'gpt-4o-mini', '');
    let plan = await ev(`(function(){
      const c = stAiCfg();
      return stAiRequest(c, [
        { role: 'system', content: 'SYS' },
        { role: 'user', content: 'U1' }
      ], { stream: true, temperature: 0.3, maxTokens: 777 }); })()`);
    check('OpenAI：URL 拼到 /chat/completions', plan.url, 'https://api.openai.com/v1/chat/completions');
    check('OpenAI：带 Bearer 头', plan.headers['Authorization'], 'Bearer sk-own-AAA');
    check('OpenAI：body.model', plan.body.model, 'gpt-4o-mini');
    check('OpenAI：body.stream', plan.body.stream, true);
    check('OpenAI：body.temperature', plan.body.temperature, 0.3);
    check('OpenAI：body.max_tokens', plan.body.max_tokens, 777);
    check('OpenAI：system 留在 messages 里', plan.body.messages.length, 2);
    check('OpenAI：messages[0].role', plan.body.messages[0].role, 'system');

    await useOwn('anthropic', 'claude-sonnet-4-20250514', '');
    plan = await ev(`(function(){
      const c = stAiCfg();
      return stAiRequest(c, [
        { role: 'system', content: 'SYS-A' },
        { role: 'system', content: 'SYS-B' },
        { role: 'user', content: 'U1' },
        { role: 'user', content: 'U2' },
        { role: 'assistant', content: 'A1' }
      ], { stream: false, temperature: 0.9, maxTokens: 1234 }); })()`);
    check('Anthropic：URL 拼到 /messages', plan.url, 'https://api.anthropic.com/v1/messages');
    check('Anthropic：带 x-api-key 而不是 Bearer', plan.headers['x-api-key'], 'sk-own-AAA');
    check('Anthropic：没有 Authorization 头', plan.headers['Authorization'], undefined);
    check('Anthropic：带 anthropic-version', plan.headers['anthropic-version'], '2023-06-01');
    check('Anthropic：带浏览器直连头',
      plan.headers['anthropic-dangerous-direct-browser-access'], 'true');
    check('Anthropic：system 提到顶层', plan.body.system, 'SYS-A\n\nSYS-B');
    check('Anthropic：messages 里没有 system',
      plan.body.messages.every(m => m.role !== 'system'), true);
    check('Anthropic：连续同角色被合并成一条 user',
      plan.body.messages.filter(m => m.role === 'user').length, 1);
    check('Anthropic：合并后 user 的内容', plan.body.messages[0].content, 'U1\n\nU2');
    check('Anthropic：非流式时不带 stream 字段', plan.body.stream, undefined);
    check('Anthropic：max_tokens 是必填且写对了', plan.body.max_tokens, 1234);

    plan = await ev(`(function(){
      const c = stAiCfg();
      return stAiRequest(c, [{ role: 'assistant', content: 'A0' }], { stream: true }); })()`);
    check('Anthropic：首条不是 user 时补一条占位 user',
      plan.body.messages[0].role, 'user');

    plan = await ev(`(function(){
      const c = Object.assign({}, stAiCfg(),
        { baseUrl: 'https://x.test/v1/', proto: 'openai' });
      return stAiRequest(c, [{ role: 'user', content: 'x' }], { stream: false }); })()`);
    check('Base URL 结尾多一条斜杠也不会拼出 //',
      plan.url, 'https://x.test/v1/chat/completions');

    // ================= C. 模型列表 =================
    section('C. 模型列表：四种形状');
    await useOwn('openai', 'gpt-4o', '');
    await setScript({ models: 'openai' });
    let ids = await ev(`stAiFetchModels(stAiCfg())`, true);
    check('OpenAI 形状：拿到 2 个（去重）', ids.length, 2);
    check('OpenAI 形状：排序', ids.join(','), 'gpt-4o,gpt-4o-mini');
    let c0 = await lastCall();
    check('拉模型走的是 GET /models', c0.url, 'https://api.openai.com/v1/models');
    check('拉模型带 Bearer', c0.headers['Authorization'], 'Bearer sk-own-AAA');

    await useOwn('anthropic', 'claude-sonnet-4-20250514', '');
    await setScript({ models: 'anthropic' });
    ids = await ev(`stAiFetchModels(stAiCfg())`, true);
    check('Anthropic 形状：从 data[].id 取', ids.length, 2);
    check('Anthropic 形状：内容', ids[0], 'claude-haiku-4-20250514');
    c0 = await lastCall();
    check('Anthropic 拉模型带 x-api-key', c0.headers['x-api-key'], 'sk-own-AAA');

    await setScript({ models: 'bare' });
    ids = await ev(`stAiFetchModels(stAiCfg())`, true);
    check('裸数组形状：id 与 name 都认', ids.length, 2);
    check('裸数组形状：剥掉 models/ 前缀', ids.join(','), 'gemini-2.5-pro,llama3');

    await setScript({ models: 'alt' });
    ids = await ev(`stAiFetchModels(stAiCfg())`, true);
    check('{models:[{name}]} 形状', ids.join(','), 'qwen-max,qwen-plus');

    await setScript({ models: 'empty' });
    let err = await ev(`stAiFetchModels(stAiCfg()).then(() => '', e => e.message)`, true);
    // ⚠⚠ 这里原来断言的是 `/没返回任何模型/` —— 那是**旧文案**。产品现在抛的是
    //   `返回里没有模型（字段名对不上？）`（`stAiFetchModelsOnce` 里那句）。
    //   旧串**在产品里只剩一处注释**了 ⇒ `grep -c` 会骗人（注释让「这个串还在」看着成立），
    //   所以**光 grep 产品查不出来**，只能靠「跑一遍看它红」。
    //   ⚠ 断言**过时**的后果跟「断言永真」正好相反：产品没问题、套件**一直红**，
    //     而红久了就没人看 —— 第二十一轮整跑才把它翻出来（`st-ai.js` 341 通过 / 2 失败）。
    //   ⚠ 判据故意**不写死整句** —— 写死整句的话下次纯文案微调又要来改一遍，
    //     而那种「永远在报的检查」最后会被无视。要守住的是两件事：
    //     ① 它**拒绝**（不静默返回空数组）；② 报的错说的是「**没有模型**」这件事，
    //     不是别的什么解析错 / 网络错。
    check('空列表会拒绝（不静默返回空数组）', err !== '', true);
    check('空列表的报错说的是「没有模型」', err, e => /模型/.test(String(e)), '含「模型」');

    await useOwn('openai', '', '');
    await setScript({ models: 'openai' });
    await clearCalls();
    await ev(`stAiPullModels()`, true);
    check('面板上的「获取模型列表」写进了 stAi.models', await ev(`stAi.models.length`), 2);
    check('本来没选模型时会默认选第一个', await ev(`stAi.model`), 'gpt-4o');

    // ================= D. 流式解析 =================
    section('D. 流式解析：两套 SSE');
    const REPLY = '一二三四五六七八九十甲乙丙丁';
    await setScript({ reply: REPLY, stream: true });
    await useOwn('openai', 'gpt-4o', '');
    await clearCalls();
    let out = await ev(`stAiChat([{ role: 'user', content: 'hi' }], { cfg: stAiCfg() })`, true);
    check('OpenAI SSE：拼回原文', out, REPLY);
    c0 = await lastCall();
    check('流式请求 body.stream = true', c0.body.stream, true);

    await useOwn('anthropic', 'claude-x', '');
    await clearCalls();
    out = await ev(`stAiChat([{ role: 'system', content: 'S' }, { role: 'user', content: 'hi' }], { cfg: stAiCfg() })`, true);
    check('Anthropic SSE：拼回原文', out, REPLY);
    c0 = await lastCall();
    check('Anthropic 流式也走 /messages', /\/messages$/.test(c0.url), true);
    check('Anthropic 流式 body.stream = true', c0.body.stream, true);

    // 非流式：**配置里的 stream 也得关掉**，客户端才会走 resp.json() 那条路。
    // 只把 mock 切成 JSON、客户端还在按 SSE 读的话，会安静地拿到空串
    await setScript({ reply: REPLY, stream: false });
    await useOwn('openai', 'gpt-4o', '');
    await ev(`(stAi.stream = false, stAiSave(), true)`);
    out = await ev(`stAiChat([{ role: 'user', content: 'hi' }], { cfg: stAiCfg() })`, true);
    check('OpenAI 非流式：取 choices[0].message.content', out, REPLY);
    c0 = await lastCall();
    check('非流式请求 body.stream = false', c0.body.stream, false);
    await useOwn('anthropic', 'claude-x', '');
    await ev(`(stAi.stream = false, stAiSave(), true)`);
    out = await ev(`stAiChat([{ role: 'user', content: 'hi' }], { cfg: stAiCfg() })`, true);
    check('Anthropic 非流式：拼 content[] 里的 text 块', out, REPLY);
    await ev(`(stAi.stream = true, stAiSave(), true)`);

    await setScript({ reply: REPLY, stream: true });
    await useOwn('openai', 'gpt-4o', '');
    const deltaInfo = await ev(`(function(){
      window.__deltas = [];
      return stAiChat([{ role: 'user', content: 'hi' }], { cfg: stAiCfg(),
        onDelta: t => window.__deltas.push(t) }).then(() => ({
          n: window.__deltas.length,
          last: window.__deltas[window.__deltas.length - 1],
          first: window.__deltas[0] })); })()`, true);
    check('onDelta 被多次调用', deltaInfo.n > 1, true);
    check('onDelta 每次给的是累积全文', deltaInfo.last, REPLY);
    check('onDelta 第一次比最后一次短', deltaInfo.first.length < deltaInfo.last.length, true);

    // ================= E. JSON 抠取 =================
    section('E. JSON 抠取边界');
    const jt = async (s) => ev(`stAiJsonOf(${JSON.stringify(s)})`);
    let j = await jt('{"entries":[]}');
    check('裸 JSON', j.ok, true);
    j = await jt('```json\n{"a":1}\n```');
    check('```json 围栏', j.ok && j.value.a, 1);
    j = await jt('```\n{"a":2}\n```');
    check('无语言标记的围栏', j.ok && j.value.a, 2);
    j = await jt('好的，这是结果：\n{"a":3}\n希望有帮助！');
    check('前后带寒暄、没有围栏', j.ok && j.value.a, 3);
    j = await jt('{"a":[1,2,3,],}');
    check('尾逗号被修掉', j.ok && j.value.a.length, 3);
    j = await jt('[{"x":1},{"x":2}]');
    check('裸数组', j.ok && j.value.length, 2);
    j = await jt('```json\n[{"x":1},]\n```');
    check('围栏 + 数组 + 尾逗号', j.ok && j.value.length, 1);
    j = await jt('前面一段话\n```json\n{"entries":[{"content":"甲"}]}\n```\n后面一段话');
    check('围栏 + 寒暄', j.ok && j.value.entries[0].content, '甲');
    j = await jt('这不是 JSON');
    check('坏 JSON：ok = false', j.ok, false);
    check('坏 JSON：有错误信息', String(j.error).length > 0, true);
    j = await jt('');
    check('空回复：ok = false', j.ok, false);
    check('空回复：错误信息是「回复是空的」', j.error, '回复是空的');
    j = await jt('{"a":"含\\"引号\\"和\\n换行"}');
    check('字符串里的转义和换行不破坏解析', j.ok && j.value.a.indexOf('换行') > 0, true);

    // ================= F. 扩写 =================
    section('F. 世界书扩写');
    await ev(`(function(){ stEditor.card.bookEntries = [];
      stEditor.card.name = '测试角色';
      stEditor.card.description = '一个在雨夜里捡到猫的侦探。';
      stEditor.card.personality = '沉默、心软。';
      stEditor.card.scenario = '城市边缘的旧公寓。';
      return true; })()`);

    const EXPAND_REPLY = JSON.stringify({
      entries: [
        { comment: '雨夜侦探', keys: ['侦探', '雨夜', '旧公寓'], secondary_keys: ['主角'],
          content: 'key: detective\nname: 雨夜侦探', constant: true, position: 0, depth: 4, order: 100 },
        { comment: '猫', keys: '猫\n黑猫，三花', content: '一只总在窗台等他的黑猫。',
          constant: false, position: 4, depth: 3, order: 120 },
        { comment: '旧公寓', keys: ['旧公寓', '楼梯'], content: '墙皮剥落，电梯常年坏着。',
          constant: false, position: 1, depth: 9, order: 90 }
      ]
    });

    await useOwn('openai', 'gpt-4o', '');
    // 这一轮走**非流式**（配置关掉 stream + mock 回 JSON），
    // 流式那条路在 G 段走 —— 两套都要从真实入口过一遍
    await ev(`(stAi.stream = false, stAiSave(), true)`);
    await setScript({ reply: EXPAND_REPLY, stream: false });
    await ev(`(function(){
      stAiUi.exReq = ['detail','yaml']; stAiUi.exReqFree = '每条都要有触发条件';
      stAiUi.exSource = 'card'; stAiUi.exCount = 3; stAiUi.exMood = 'tense';
      stAiUi.exFormat = 'yaml'; stAiUi.exKeepBook = true;
      stAiUi.exPreview = null; stAiUi.exErr = ''; stAiUi.exMsg = ''; stAiUi.exRaw = '';
      return true; })()`);

    const ep = await ev(`stAiExpandPlan()`);
    check('提示词：条数写进了 system', ep.system.indexOf('正好 3 个') >= 0, true);
    check('提示词：要求「详细化」进了 user', ep.user.indexOf('展开写透') >= 0, true);
    check('提示词：要求「YAML 化」进了 user', ep.user.indexOf('YAML') >= 0, true);
    check('提示词：自由要求也进了 user', ep.user.indexOf('每条都要有触发条件') >= 0, true);
    check('提示词：氛围进了 user', ep.user.indexOf('紧张悬疑') >= 0, true);
    check('提示词：格式进了 user', ep.user.indexOf('缩进两个空格') >= 0, true);
    check('提示词：角色卡设定进了 user', ep.user.indexOf('雨夜里捡到猫') >= 0, true);
    check('提示词：性格也进了 user', ep.user.indexOf('沉默、心软') >= 0, true);
    check('提示词：要求输出 JSON', ep.system.indexOf('"entries"') >= 0, true);
    check('提示词：要求里带了条数约束', ep.system.indexOf('正好 3 个') >= 0, true);

    await ev(`(stAiUi.exSource = 'free', stAiUi.exFree = '一个会说话的闹钟', true)`);
    const ep2 = await ev(`stAiExpandPlan()`);
    check('自由输入模式下素材用的是自由文本', ep2.user.indexOf('会说话的闹钟') >= 0, true);
    await ev(`(stAiUi.exSource = 'card', true)`);

    await clearCalls();
    await ev(`stAiExpandRun()`, true);
    check('扩写：没报错', await ev(`stAiUi.exErr`), '');
    check('扩写：解析出 3 条', await ev(`stAiUi.exPreview.length`), 3);
    check('扩写：没触发「条数不符」提示', await ev(`stAiUi.exMsg`), '');
    const prev = await ev(`stAiUi.exPreview`);
    check('扩写：常驻标记保留', prev[0].constant, true);
    check('扩写：位置保留', prev[1].position, 4);
    check('扩写：深度保留', prev[1].depth, 3);
    check('扩写：顺序保留', prev[2].order, 90);
    check('扩写：关键词数组原样', prev[0].keys.join(','), '侦探,雨夜,旧公寓');
    check('扩写：关键词字符串被拆开', prev[1].keys.join(','), '猫,黑猫,三花');
    check('扩写：次关键词', prev[0].secondaryKeys.join(','), '主角');
    check('扩写：正文保留', prev[2].content, '墙皮剥落，电梯常年坏着。');
    check('扩写：id 是新的（不是 undefined）', typeof prev[0].id === 'string' && prev[0].id.length > 0, true);
    check('扩写：默认启用', prev[0].enabled, true);

    await ev(`stAiExpandApply()`);
    check('套用后世界书有 3 条', await ev(`stEditor.card.bookEntries.length`), 3);
    check('套用后预览清空', await ev(`stAiUi.exPreview`), null);
    check('套用后给了成功提示', /已加入 3 条/.test(await ev(`stAiUi.exMsg`)), true);
    check('套用后卡片标记为脏', await ev(`stEditor.dirty`), true);

    // 字段夹紧 + 脏数据
    const clean = await ev(`(function(){
      return [
        stAiEntryFromAi({ content: 'x', position: 99, depth: -5, order: -1 }),
        stAiEntryFromAi({ content: '   ', keys: [], constant: false }),
        stAiEntryFromAi(null),
        stAiEntryFromAi([1,2]),
        stAiEntryFromAi({ content: 'y', position: 4, depth: 3, order: 50, enabled: false })
      ].map(e => e === null ? null : ({ p: e.position, d: e.depth, o: e.order, en: e.enabled })); })()`);
    check('越界的 position 被夹回 0', clean[0].p, 0);
    check('负 depth 被夹成 0', clean[0].d, 0);
    check('负 order 被夹成 0', clean[0].o, 0);
    check('空条目被丢掉（第 2 条）', clean[1], null);
    check('null 被丢掉', clean[2], null);
    check('数组被丢掉', clean[3], null);
    check('enabled:false 保留', clean[4].en, false);

    // 模型回了一堆废话
    await ev(`(function(){ stEditor.card.bookEntries = []; stAiUi.exPreview = null;
      stAiUi.exErr = ''; return true; })()`);
    await setScript({ reply: '好的，我来帮你扩写！\n\n```json\n' + EXPAND_REPLY + '\n```\n\n希望对你有帮助～', stream: false });
    await ev(`stAiExpandRun()`, true);
    check('带围栏 + 寒暄的回复照样解析出 3 条', await ev(`stAiUi.exPreview.length`), 3);

    await setScript({ reply: '{"entries":[{},{}]}', stream: false });
    await ev(`stAiExpandRun()`, true);
    check('全是空条目时给出可读的错误',
      /解析出来的条目全是空的/.test(await ev(`stAiUi.exErr`)), true);

    await setScript({ reply: '我不太明白你的意思。', stream: false });
    await ev(`stAiExpandRun()`, true);
    check('回复不是 JSON 时给出可读的错误',
      /没返回合法 JSON/.test(await ev(`stAiUi.exErr`)), true);
    check('坏回复也留着原文供复制', (await ev(`stAiUi.exRaw`)).length > 0, true);

    await ev(`stAiExpandClear()`);
    check('丢弃后预览为空', await ev(`stAiUi.exPreview`), null);

    // ================= G. 开场白 =================
    section('G. 开场白：注入顺序与生成');
    await ev(`(function(){
      const mk = o => Object.assign(stBlankEntry(), o);
      stEditor.card.bookEntries = [
        mk({ comment: '停用的', content: 'X-停用', enabled: false, position: 0, order: 100 }),
        mk({ comment: '出口的', content: 'X-出口', enabled: true, position: 7, order: 100 }),
        mk({ comment: '常驻的', content: 'X-常驻', enabled: true, position: 0, order: 100, constant: true }),
        mk({ comment: '深度2', content: 'X-深2', enabled: true, position: 4, depth: 2, order: 100 }),
        mk({ comment: '深度6', content: 'X-深6', enabled: true, position: 4, depth: 6, order: 100 }),
        mk({ comment: '深度6后', content: 'X-深6后', enabled: true, position: 4, depth: 6, order: 200 }),
        mk({ comment: '角色后', content: 'X-角色后', enabled: true, position: 1, order: 100 }),
        mk({ comment: '空正文', content: '   ', enabled: true, position: 0, order: 100 })
      ];
      return true; })()`);

    let rows = await ev(`stAiInjectList()`);
    check('注入：停用的被跳过', rows.some(r => r.e.comment === '停用的'), false);
    check('注入：Outlet 位置被跳过', rows.some(r => r.e.comment === '出口的'), false);
    check('注入：空正文被跳过', rows.some(r => r.e.comment === '空正文'), false);
    check('注入：剩下 5 条', rows.length, 5);
    check('注入：位置顺序 ↑Char → ↓Char → @D',
      rows.map(r => r.e.comment).join(','), '常驻的,角色后,深度6,深度6后,深度2');
    check('注入：@D 组内 depth 从大到小',
      rows.filter(r => r.e.position === 4).map(r => r.e.depth).join(','), '6,6,2');
    check('注入：同 depth 时按 order', rows[3].e.comment, '深度6后');

    rows = await ev(`stAiInjectList({ includeDisabled: true })`);
    check('勾上「包含停用」之后变成 6 条', rows.length, 6);
    check('勾上之后停用的排在最前（位置 ↑Char）', rows[0].e.comment, '停用的');

    const inj = await ev(`stAiInjectText(stAiInjectList())`);
    check('注入预览带位置标记', inj.indexOf('[1] ↑Char') >= 0, true);
    check('注入预览带常驻标记', inj.indexOf('· 常驻') >= 0, true);
    check('注入预览带关键词', inj.indexOf('关键词触发') >= 0, true);
    check('注入预览带深度', inj.indexOf('深度 6') >= 0, true);
    check('注入预览带正文', inj.indexOf('X-深6') >= 0, true);

    await ev(`(function(){
      stEditor.card.name = '测试角色'; stEditor.card.firstMes = '旧的';
      stEditor.card.alternateGreetings = [];
      stAiUi.grCount = 2; stAiUi.grLen = 500; stAiUi.grMood = 'daily';
      stAiUi.grExtra = '必须提到窗外的雨'; stAiUi.grIncOff = false;
      stAiUi.grPreview = null; stAiUi.grErr = ''; stAiUi.grMsg = ''; stAiUi.grRaw = '';
      return true; })()`);

    const gp = await ev(`stAiGreetPlan()`);
    check('开场白提示词：带上注入预览', gp.user.indexOf('X-常驻') >= 0, true);
    check('开场白提示词：带上停用之外的全部条目', gp.user.indexOf('X-深6后') >= 0, true);
    check('开场白提示词：停用的条目不在里面', gp.user.indexOf('X-停用') < 0, true);
    check('开场白提示词：Outlet 条目不在里面', gp.user.indexOf('X-出口') < 0, true);
    check('开场白提示词：段数进了 system', gp.system.indexOf('正好 2 个') >= 0, true);
    check('开场白提示词：字数进了 system', gp.system.indexOf('500 字') >= 0, true);
    check('开场白提示词：氛围进了 user', gp.user.indexOf('日常温馨') >= 0, true);
    check('开场白提示词：额外要求进了 user', gp.user.indexOf('窗外的雨') >= 0, true);
    check('开场白提示词：明确要求不要替玩家说话',
      gp.system.indexOf('不要替玩家说话') >= 0, true);
    check('开场白提示词：带上角色卡设定', gp.user.indexOf('测试角色') >= 0, true);

    await ev(`(stAiUi.grIncOff = true, true)`);
    const gp2 = await ev(`stAiGreetPlan()`);
    check('勾上「包含停用」后停用条目进提示词', gp2.user.indexOf('X-停用') >= 0, true);
    await ev(`(stAiUi.grIncOff = false, true)`);

    const GREET_REPLY = JSON.stringify({ greetings: ['*雨点敲在窗上。* 你回来了。', '第二条开场白，场景完全不同。'] });
    // 这一轮走**流式**，把「SSE 拼回来 → 抠 JSON → 落卡」整条链路串一遍
    await useOwn('openai', 'gpt-4o', '');
    await ev(`(stAi.stream = true, stAiSave(), true)`);
    await setScript({ reply: GREET_REPLY, stream: true });
    await ev(`stAiGreetRun()`, true);
    check('开场白：没报错', await ev(`stAiUi.grErr`), '');
    check('开场白：解析出 2 段', await ev(`stAiUi.grPreview.length`), 2);
    check('开场白：第一段内容对', (await ev(`stAiUi.grPreview`))[0], '*雨点敲在窗上。* 你回来了。');

    await ev(`stAiUi.grTarget = 'main'; stAiGreetApply();`);
    check('覆盖主开场白', await ev(`stEditor.card.firstMes`), '*雨点敲在窗上。* 你回来了。');
    check('覆盖模式不会动备选', await ev(`stEditor.card.alternateGreetings.length`), 0);
    check('覆盖后给了提示', /已覆盖主开场白/.test(await ev(`stAiUi.grMsg`)), true);

    await ev(`(function(){ stAiUi.grPreview = ['备选甲','备选乙']; stAiUi.grTarget = 'alt';
      stAiGreetApply(); return true; })()`);
    check('追加为备选', await ev(`stEditor.card.alternateGreetings.join('|')`), '备选甲|备选乙');
    check('追加后主开场白不动', await ev(`stEditor.card.firstMes`), '*雨点敲在窗上。* 你回来了。');

    // G 段后面 stAi.stream 是开着的，mock 也得跟着回 SSE，否则客户端读到的是空串
    await setScript({ reply: '{"greetings":[{"content":"对象形状的"}]}', stream: true });
    await ev(`stAiGreetRun()`, true);
    check('开场白是对象形状时也能取出来', (await ev(`stAiUi.grPreview`))[0], '对象形状的');

    await setScript({ reply: '{"greetings":["   ",""]}', stream: true });
    await ev(`stAiGreetRun()`, true);
    check('空字符串会被过滤掉并报错', /都是空的/.test(await ev(`stAiUi.grErr`)), true);
    await ev(`stAiGreetClear()`);

    // ================= H. 隐私 =================
    section('H. 隐私：API Key 不进卡');
    await ev(`(function(){
      stAi.mode = 'own'; stAi.apiKey = 'sk-SECRET-999'; stAi.provider = 'openai';
      stAi.model = 'gpt-4o'; stAiSave(); stSaveDraft(); return true; })()`);
    check('卡片 JSON 里没有 Key',
      (await ev(`JSON.stringify(stEditor.card)`)).indexOf('sk-SECRET-999') < 0, true);
    check('草稿里没有 Key',
      String(await ev(`localStorage.getItem('stCardDraft') || ''`)).indexOf('sk-SECRET-999') < 0, true);
    check('AI 配置里**有** Key（它本来就该存那儿）',
      String(await ev(`localStorage.getItem('stAiCfg') || ''`)).indexOf('sk-SECRET-999') >= 0, true);
    check('导出用的卡片 JSON 里也没有 Key',
      (await ev(`JSON.stringify(stEditor.card)`)).indexOf('apiKey') < 0, true);
    check('面板状态里也不放 Key',
      String(await ev(`JSON.stringify(stAiUi)`)).indexOf('sk-SECRET-999') < 0, true);

    // ================= I. 面板 =================
    section('I. 面板渲染');
    // ⚠ 这里是**写死的 16**，加 / 删选项卡必须同步改（完整清单见 smoke.js 文件头）。
    //   第二十一轮加 `home` 时漏了这一处，整跑才把它抓出来（341 通过 / 2 失败）。
    check('选项卡数量 16', await ev(`document.querySelectorAll('#st-tabs .st-tab').length`), 16);
    check('选项卡里有「AI 助手」', await ev(`!!Array.from(document.querySelectorAll('#st-tabs .st-tab'))
      .find(b => /AI 助手/.test(b.textContent))`), true);

    await ev(`stSwitchTab('ai')`);
    await sleep(150);
    check('AI 页渲染出来了', await ev(`!!document.getElementById('st-ai-cfg-status')`), true);
    check('AI 页有模式切换的两个 chip',
      await ev(`document.querySelectorAll('#st-panes .st-ai-chip').length`), 2);
    check('AI 页显示当前生效配置',
      /当前生效/.test(await ev(`document.getElementById('st-ai-cfg-status').textContent`)), true);
    check('AI 页有「获取模型列表」按钮', await ev(`!!document.getElementById('st-ai-pull-btn')`), true);
    check('AI 页有「测试连接」按钮', await ev(`!!document.getElementById('st-ai-test-btn')`), true);
    await shot('st-ai-config.png', '#st-panes .st-pane');

    await ev(`stAiModePick('own')`);
    await sleep(150);
    check('切到独立配置后出现服务商下拉', await ev(`!!document.getElementById('st-ai-provider')`), true);
    check('切到独立配置后出现协议下拉', await ev(`!!document.getElementById('st-ai-proto')`), true);
    check('切到独立配置后出现 Key 输入框', await ev(`!!document.getElementById('st-ai-key')`), true);
    check('切到独立配置后出现模型输入框', await ev(`!!document.getElementById('st-ai-model')`), true);
    // ⚠ 不写死数字：预设表每加一个服务商，写死的断言就会来收账
    //   （第十七轮从 13 涨到 30+，这条立刻红）。改成**跟表比**，另加一条下限
    const nProv = await ev(`ST_AI_PROVIDERS.length`);
    check('服务商下拉与预设表项数一致（不是写死的数字）',
      await ev(`document.getElementById('st-ai-provider').options.length`), nProv, nProv);
    check('服务商预设 ≥ 30（含海外渠道与 Google 系）', nProv, v => v >= 30, '>=30');
    check('⚠ 预设里有 Vertex（proto = gemini）',
      await ev(`(ST_AI_PROVIDERS.find(p => p.value === 'vertex') || {}).proto`), 'gemini');
    check('⚠ 自定义那条**不**写死 proto（要按 Base URL 猜）',
      await ev(`String((ST_AI_PROVIDERS.find(p => p.value === 'custom') || {}).proto)`), '');
    await shot('st-ai-own.png', '#st-panes .st-pane');

    await ev(`stAiModePick('follow')`);
    await sleep(150);
    check('切回跟随后服务商下拉消失', await ev(`!!document.getElementById('st-ai-provider')`), false);

    await ev(`stSwitchTab('book')`);
    await sleep(150);
    check('世界书页挂了扩写面板', await ev(`!!document.querySelector('#st-panes .st-ai-box')`), true);
    check('扩写面板标题',
      /AI 扩写条目/.test(await ev(`document.querySelector('#st-panes .st-ai-box > summary').textContent`)), true);
    await ev(`stAiUi.exOpen = true; stAiRepaint();`);
    await sleep(150);
    check('展开后能看到要求 chip',
      await ev(`document.querySelectorAll('#st-panes .st-ai-chip').length > 10`), true);
    check('展开后能看到条数输入框', await ev(`!!document.getElementById('st-ai-excount')`), true);
    check('展开后能看到来源 chip', await ev(`!!document.querySelector('#st-panes .st-ai-chip')`), true);
    await shot('st-ai-expand.png', '#st-panes .st-pane');

    await ev(`stSwitchTab('greet')`);
    await sleep(150);
    check('开场白页挂了生成面板', await ev(`!!document.querySelector('#st-panes .st-ai-box')`), true);
    check('开场白面板标题',
      /AI 生成开场白/.test(await ev(`document.querySelector('#st-panes .st-ai-box > summary').textContent`)), true);
    await ev(`stAiUi.grOpen = true; stAiRepaint();`);
    await sleep(150);
    check('展开后有注入预览的折叠块',
      await ev(`document.querySelectorAll('#st-panes .st-ai-box').length`), 2);
    check('注入预览的折叠标题上也带条数（收起来也看得见）',
      /展开注入预览/.test(await ev(`document.querySelectorAll('#st-panes .st-ai-box > summary')[1].textContent`)), true);
    check('注入预览标题里有「5 条参与」',
      /5 条参与/.test(await ev(`document.querySelectorAll('#st-panes .st-ai-box > summary')[1].textContent`)), true);
    await shot('st-ai-greet.png', '#st-panes .st-pane');

    await ev(`document.body.classList.add('retro-mode')`);
    await sleep(120);
    const retro = await ev(`(function(){
      const b = document.querySelector('#st-panes .st-ai-box');
      const c = document.querySelector('#st-panes .st-ai-chip');
      return { box: b ? getComputedStyle(b).borderTopLeftRadius : 'x',
               chip: c ? getComputedStyle(c).borderTopLeftRadius : 'x' }; })()`);
    check('复古皮肤下 AI 面板是方角', retro.box, '0px');
    check('复古皮肤下 chip 也是方角', retro.chip, '0px');
    await shot('st-ai-retro.png', '#st-panes .st-pane');
    await ev(`document.body.classList.remove('retro-mode')`);

    // ================= J. 失败路径 =================
    section('J. 失败路径');
    await ev(`stSwitchTab('ai')`);
    await useOwn('openai', 'gpt-4o', '');
    await setScript({ fail: 'http401' });
    await ev(`stAiTestConn()`, true);
    let st = await ev(`document.getElementById('st-ai-cfg-status').textContent`);
    check('401 会被报出来', /连接失败/.test(st), true);
    check('401 的错误里带状态码', /401/.test(st), true);

    await setScript({ fail: 'http500' });
    await ev(`stAiTestConn()`, true);
    st = await ev(`document.getElementById('st-ai-cfg-status').textContent`);
    check('500 会被报出来', /500/.test(st), true);

    await setScript({ fail: 'network' });
    await ev(`stAiTestConn()`, true);
    st = await ev(`document.getElementById('st-ai-cfg-status').textContent`);
    check('网络不通时给出排查建议', /CORS|Base URL/.test(st), true);

    await setScript({ fail: 'http401', models: 'openai' });
    await ev(`stAiPullModels()`, true);
    st = await ev(`document.getElementById('st-ai-cfg-status').textContent`);
    check('拉模型失败也会报出来', /获取模型失败/.test(st), true);

    await resetScript();
    await setScript({ reply: '{"entries":[]}', stream: true });
    await ev(`stSwitchTab('book')`);
    await ev(`stAiUi.exErr = ''; stAiExpandRun()`, true);
    check('没有 entries 数组时报可读的错',
      /没有条目数组/.test(await ev(`stAiUi.exErr`)), true);

    // 配置不全时不该发请求
    await ev(`(function(){ stAi.mode = 'own'; stAi.apiKey = ''; stAi.provider = 'openai';
      stAi.model = 'gpt-4o'; stAiSave(); return true; })()`);
    await clearCalls();
    await ev(`stAiUi.exErr = ''; stAiExpandRun()`, true);
    check('缺 Key 时直接拦住不发请求', (await calls()).length, 0);
    check('缺 Key 时面板给出原因', /API Key/.test(await ev(`stAiUi.exErr`)), true);

    // ================= K. 草稿往返 =================
    section('K. 草稿往返');
    await ev(`(function(){
      stAi.mode = 'own'; stAi.apiKey = 'sk-KKK'; stAi.provider = 'deepseek';
      stAi.model = 'deepseek-chat'; stAi.temperature = 1.1; stAi.maxTokens = 8192;
      stAi.models = ['deepseek-chat','deepseek-reasoner']; stAiSave();
      stAiUi.exReq = ['tighten','zh']; stAiUi.exCount = 7; stAiUi.exMood = 'dark';
      stAiUi.exFormat = 'md'; stAiUi.grLen = 900; stAiUi.grTarget = 'alt';
      stAiUi.enReq = ['yaml']; stAiUi.enRefScope = 'all'; stAiUi.enKeepMeta = false;
      stAiUi.enRef = false; stAiUi.enOpenId = 'not-an-id';
      // 故意把「运行时态」也填上 —— 这几个**一个都不许被存下去**。
      // 存了 exRunning 就是一个永远转圈、按钮按不动的面板
      stAiUi.exRunning = true; stAiUi.grRunning = true; stAiUi.enRunning = true;
      stAiUi.exErr = '不该被存下来'; stAiUi.grMsg = '也不该'; stAiUi.enMsg = '更不该';
      stAiUi.exRaw = '原始回复也不该'; stAiUi.exPreview = [stBlankEntry()];
      stAiUi.grPreview = ['也不该']; stAiUi.enPreview = { id: 'x', entry: stBlankEntry() };
      stAiUi.enRaw = '单条改写的原始回复也不该';
      stAiSaveUi(); return true; })()`);
    const uiSaved = await ev(`localStorage.getItem('stAiUiCfg')`);
    check('面板参数存了', /"exCount":7/.test(uiSaved), true);
    check('单条改写的参数也存了', /"enRefScope":"all"/.test(uiSaved), true);
    check('运行时态一个都没存',
      /exRunning|exErr|exMsg|exRaw|exPreview|grRunning|grPreview|enRunning|enErr|enMsg|enRaw|enPreview/
        .test(uiSaved), false);
    loaded = new Promise(res => cdp.on('Page.loadEventFired', res));
    await cdp.send('Page.reload', {}, SID);
    await loaded;
    await sleep(500);
    check('刷新后独立配置还在', await ev(`stAi.provider + '/' + stAi.model + '/' + stAi.apiKey`),
      'deepseek/deepseek-chat/sk-KKK');
    check('刷新后温度还在', await ev(`stAi.temperature`), 1.1);
    check('刷新后模型列表还在', await ev(`stAi.models.join(',')`), 'deepseek-chat,deepseek-reasoner');
    check('刷新后面板参数还在', await ev(`stAiUi.exReq.join(',') + '|' + stAiUi.exCount + '|' +
      stAiUi.exMood + '|' + stAiUi.exFormat`), 'tighten,zh|7|dark|md');
    check('刷新后开场白参数还在', await ev(`stAiUi.grLen + '|' + stAiUi.grTarget`), '900|alt');
    check('刷新后预览不会残留', await ev(`stAiUi.exPreview`), null);
    check('刷新后开场白预览也不会残留', await ev(`stAiUi.grPreview`), null);
    check('刷新后 running 不会卡住', await ev(`stAiUi.exRunning`), false);
    check('刷新后开场白的 running 也不会卡住', await ev(`stAiUi.grRunning`), false);
    check('刷新后错误信息不会残留', await ev(`stAiUi.exErr`), '');
    check('刷新后原始回复不会残留', await ev(`stAiUi.exRaw`), '');
    check('刷新后单条改写的参数还在',
      await ev(`stAiUi.enReq.join(',') + '|' + stAiUi.enRefScope + '|' +
        stAiUi.enKeepMeta + '|' + stAiUi.enRef + '|' + stAiUi.enOpenId`),
      'yaml|all|false|false|not-an-id');
    check('刷新后单条改写的预览不会残留', await ev(`stAiUi.enPreview`), null);
    check('刷新后单条改写的 running 也不会卡住', await ev(`stAiUi.enRunning`), false);
    check('刷新后单条改写的错误不会残留', await ev(`stAiUi.enErr`), '');
    check('刷新后单条改写的原始回复不会残留', await ev(`stAiUi.enRaw`), '');

    await ev('openStEditor()');
    await sleep(200);
    await ev(`stSwitchTab('ai')`);
    await sleep(150);
    check('刷新后 AI 页照常渲染', await ev(`!!document.getElementById('st-ai-cfg-status')`), true);
    check('刷新后模型下拉里有拉取过的模型',
      await ev(`document.getElementById('st-ai-model-list').options.length >= 2`), true);

    // ================= L. 单条改写 =================
    section('L. 世界书单条改写（可选参考其他条目）');
    // 造一本有讲究的世界书：停用的、空壳的、带分组的各来一条 ——
    // 「参考其他条目」这个开关到底参考到了谁，全靠这几条才能测出边界
    await ev(`(function(){
      const mk = o => Object.assign(stBlankEntry(), o);
      stEditor.card.bookEntries = [
        mk({ comment: '雨夜侦探', keys: ['侦探','雨夜'], content: '他总在雨夜里出门，口袋里揣着一只湿透的猫。',
             position: 0, order: 100, enabled: true }),
        mk({ comment: '旧公寓', keys: ['公寓'], content: '墙皮剥落，电梯常年坏着。',
             position: 1, order: 90, enabled: false }),
        mk({ comment: '黑猫', keys: ['黑猫'], content: '一只总在窗台等他的黑猫。',
             position: 4, depth: 3, order: 120, enabled: true, group: '日常' }),
        mk({ comment: '同组伙伴', keys: ['伙伴'], content: '楼下便利店的店员。',
             position: 0, order: 100, enabled: true, group: '日常' }),
        mk({ comment: '空壳', keys: [], content: '', enabled: true })
      ];
      stAiUi.enOpenId = ''; stAiUi.enPreview = null; stAiUi.enErr = ''; stAiUi.enMsg = '';
      stAiUi.enRunning = false; stAiUi.enRunId = ''; stAiUi.enRaw = '';
      // 上一段把 enRef 设成了 false，这里必须掰回来 —— 不然「同分组」那几个
      // chip 根本不会渲染，断言会红在一个跟被测代码无关的地方
      stAiUi.enRef = true; stAiUi.enRefScope = 'on'; stAiUi.enKeepMeta = true;
      stSwitchTab('book');
      return stEditor.card.bookEntries.length; })()`);
    await sleep(200);
    // ⚠ mock 的形状必须跟着配置里的 stream 走。上一段结束时 stAi.stream 是开着的，
    // 而下面要回的是 JSON body —— 不改的话客户端会按 SSE 去读一个 JSON，
    // **安静地拿到空串**（不报错），错误信息还长得像模型没说话
    await ev(`(stAi.stream = false, stAiSave(), true)`);
    check('每个条目都挂了自己的 AI 面板',
      await ev(`document.querySelectorAll('#st-panes .st-ai-box.st-ai-inline').length`), 5);
    check('默认都收着', await ev(`document.querySelectorAll('#st-panes .st-ai-box.st-ai-inline[open]').length`), 0);
    check('收着的时候一条参数都不渲染（省 DOM）',
      await ev(`document.querySelectorAll('#st-entry-0 .st-ai-box .st-ai-chip').length`), 0);

    // —— 展开 / 收起 ——
    await ev(`document.querySelector('#st-entry-0 .st-ai-box > summary').click()`);
    await sleep(160);
    check('展开后记住了是哪一条',
      await ev(`stAiUi.enOpenId === stEditor.card.bookEntries[0].id`), true);
    check('展开后参数渲染出来了',
      await ev(`document.querySelectorAll('#st-entry-0 .st-ai-box .st-ai-chip').length > 10`), true);
    check('没有分组的条目不显示「同分组」',
      await ev(`/同分组/.test(document.querySelector('#st-entry-0 .st-ai-box').textContent)`), false);

    await ev(`document.querySelector('#st-entry-2 .st-ai-box > summary').click()`);
    await sleep(160);
    check('换一条展开，上一条自动收起来',
      await ev(`document.querySelectorAll('#st-panes .st-ai-box.st-ai-inline[open]').length`), 1);
    check('带分组的条目能看到「同分组」',
      await ev(`/同分组/.test(document.querySelector('#st-entry-2 .st-ai-box').textContent)`), true);

    await ev(`document.querySelector('#st-entry-2 .st-ai-box > summary').click()`);
    await sleep(160);
    check('收起后状态清空', await ev(`stAiUi.enOpenId`), '');

    // —— 「参考其他条目」到底参考到了谁 ——
    const refs = await ev(`(function(){
      const L = stEditor.card.bookEntries;
      return {
        on: stAiEntryRefRows(L[0], 'on').map(r => r.e.comment),
        all: stAiEntryRefRows(L[0], 'all').map(r => r.e.comment),
        same: stAiEntryRefRows(L[2], 'same').map(r => r.e.comment),
        self: stAiEntryRefRows(L[0], 'all').some(r => r.i === 0),
        empty: stAiEntryRefRows(L[0], 'all').some(r => r.e.comment === '空壳')
      }; })()`);
    check('仅启用：停用的条目不算', refs.on.join(','), '黑猫,同组伙伴');
    check('仅启用：空壳也不算（参考了等于没参考）', refs.empty, false);
    check('全部：停用的也进来了', refs.all.join(','), '旧公寓,黑猫,同组伙伴');
    check('永远不含自己', refs.self, false);
    check('同分组：只剩同一个包含组的', refs.same.join(','), '同组伙伴');
    check('没有分组时选「同分组」会退回「仅启用」', await ev(`(function(){
      const L = stEditor.card.bookEntries;
      stAiUi.enRefScope = 'same';
      const s = stAiEntryRefScope(L[0]);
      stAiUi.enRefScope = 'on';
      return s; })()`), 'on');

    // —— 提示词 ——
    await ev(`(function(){
      stAiUi.enReq = ['detail','yaml']; stAiUi.enReqFree = '保留原来的关键词';
      stAiUi.enMood = 'tense'; stAiUi.enFormat = 'yaml';
      stAiUi.enRef = true; stAiUi.enRefScope = 'on'; stAiUi.enKeepMeta = true;
      return true; })()`);
    const eplan = await ev(`stAiEntryPlan(stEditor.card.bookEntries[0])`);
    check('提示词：要改的那条正文整段进去了', eplan.user.indexOf('他总在雨夜里出门') >= 0, true);
    check('提示词：原关键词也进去了', eplan.user.indexOf('侦探、雨夜') >= 0, true);
    check('提示词：原位置 / 顺序也进去了', eplan.user.indexOf('顺序 100') >= 0, true);
    check('提示词：参考条目进去了', eplan.user.indexOf('黑猫') >= 0, true);
    check('提示词：停用的条目没被参考', eplan.user.indexOf('旧公寓') < 0, true);
    check('提示词：改写要求进去了', eplan.user.indexOf('展开写透') >= 0, true);
    check('提示词：自由要求进去了', eplan.user.indexOf('保留原来的关键词') >= 0, true);
    check('提示词：氛围进去了', eplan.user.indexOf('紧张悬疑') >= 0, true);
    check('提示词：格式进去了', eplan.user.indexOf('缩进两个空格') >= 0, true);
    check('提示词：勾了「只改正文」会告诉模型照抄字段',
      eplan.user.indexOf('照抄原条目') >= 0, true);
    check('提示词：system 要求**单个对象**，不是数组',
      eplan.system.indexOf('不要包成数组') >= 0, true);
    check('提示词：plan 带着目标条目的 id', eplan.id, await ev(`stEditor.card.bookEntries[0].id`));

    await ev(`(stAiUi.enRef = false, true)`);
    const eplan2 = await ev(`stAiEntryPlan(stEditor.card.bookEntries[0])`);
    check('关掉「参考其他条目」后提示词里就没有别的条目了',
      eplan2.user.indexOf('【其他世界书条目') < 0, true);
    await ev(`(stAiUi.enRef = true, true)`);

    // —— 生成 ——
    const EN_REPLY = JSON.stringify({
      comment: '雨夜侦探', keys: ['侦探', '雨夜', '湿透的猫'], secondary_keys: ['主角'],
      content: '雨点砸在铁皮雨棚上。他把外套裹紧，口袋里那只猫动了一下。',
      constant: true, position: 0, depth: 4, order: 100
    });
    await setScript({ reply: EN_REPLY, stream: false });
    await clearCalls();
    await ev(`stAiEntryRun(0)`, true);
    check('单条改写：没报错', await ev(`stAiUi.enErr`), '');
    check('单条改写：只发了一次请求', (await calls()).length, 1);
    check('单条改写：预览认领到了第 1 条',
      await ev(`stAiUi.enPreview.id === stEditor.card.bookEntries[0].id`), true);
    check('单条改写：正文解析出来了',
      await ev(`stAiUi.enPreview.entry.content.indexOf('铁皮雨棚') >= 0`), true);
    check('单条改写：面板上出现了预览卡片',
      await ev(`!!document.querySelector('#st-entry-0 .st-ai-card')`), true);
    check('单条改写：出现了「替换本条」',
      await ev(`/替换本条/.test(document.querySelector('#st-entry-0 .st-ai-box').textContent)`), true);
    check('单条改写：预览上标了字数变化',
      await ev(`/字 → /.test(document.querySelector('#st-entry-0 .st-ai-box').textContent)`), true);

    // —— 套用：只改正文 ——
    await ev(`(stAiUi.enKeepMeta = true, stAiEntryApply(0, 'replace'), true)`);
    check('只改正文：正文换了',
      await ev(`stEditor.card.bookEntries[0].content.indexOf('铁皮雨棚') >= 0`), true);
    check('只改正文：关键词保持原样',
      await ev(`stEditor.card.bookEntries[0].keys.join(',')`), '侦探,雨夜');
    check('只改正文：备注保持原样',
      await ev(`stEditor.card.bookEntries[0].comment`), '雨夜侦探');
    check('只改正文：顺序保持原样',
      await ev(`stEditor.card.bookEntries[0].order`), 100);
    check('套用后预览清空', await ev(`stAiUi.enPreview`), null);
    check('套用后给了提示', /第 1 条已经换成新的/.test(await ev(`stAiUi.enMsg`)), true);
    check('套用后卡片标记为脏', await ev(`stEditor.dirty`), true);

    // —— 套用：全套字段都按模型的来 ——
    await setScript({ reply: EN_REPLY, stream: false });
    await ev(`stAiEntryRun(0)`, true);
    await ev(`(stAiUi.enKeepMeta = false, stAiEntryApply(0, 'replace'), true)`);
    check('全套字段：关键词也换了',
      await ev(`stEditor.card.bookEntries[0].keys.join(',')`), '侦探,雨夜,湿透的猫');
    check('全套字段：次关键词也换了',
      await ev(`stEditor.card.bookEntries[0].secondaryKeys.join(',')`), '主角');
    check('全套字段：常驻标记也换了',
      await ev(`stEditor.card.bookEntries[0].constant`), true);

    // —— 空值不许覆盖 ——
    await setScript({ reply: JSON.stringify({ content: '第二版正文。', keys: [] }), stream: false });
    await ev(`stAiEntryRun(0)`, true);
    await ev(`(stAiUi.enKeepMeta = false, stAiEntryApply(0, 'replace'), true)`);
    check('模型给空关键词时不覆盖原来的',
      await ev(`stEditor.card.bookEntries[0].keys.join(',')`), '侦探,雨夜,湿透的猫');
    check('正文照常换掉',
      await ev(`stEditor.card.bookEntries[0].content`), '第二版正文。');

    // —— 追加为新条目 ——
    await setScript({ reply: EN_REPLY, stream: false });
    await ev(`stAiEntryRun(1)`, true);
    await ev(`stAiEntryApply(1, 'append')`);
    check('追加：多了一条', await ev(`stEditor.card.bookEntries.length`), 6);
    check('追加：插在被改的那条后面',
      await ev(`stEditor.card.bookEntries[2].comment`), '雨夜侦探');
    check('追加：新条目的 id 是全新的（不能和源条目撞）', await ev(`(function(){
      const L = stEditor.card.bookEntries;
      const ids = L.map(e => e.id);
      return ids.length === new Set(ids).size; })()`), true);
    check('追加后面板跟着新条目走',
      await ev(`stAiUi.enOpenId === stEditor.card.bookEntries[2].id`), true);

    // —— 生成期间条目被删掉 ——
    await setScript({ reply: EN_REPLY, stream: false });
    await ev(`(function(){
      stAiUi.enErr = ''; stAiUi.enErrId = '';
      stAiEntryRun(3);                          // 故意不 await
      stEditor.card.bookEntries.splice(3, 1);   // 生成期间把它删了
      return true; })()`);
    await sleep(600);
    check('生成期间条目被删 → 给出可读的错',
      /已经不在世界书里/.test(await ev(`stAiUi.enErr`)), true);
    check('这个错认领到了被删的那一条（不会串到别的条目上）',
      await ev(`stAiUi.enErrId.length > 0`), true);
    await ev(`(stAiUi.enOpenId = stEditor.card.bookEntries[0].id, stRerender(), true)`);
    check('别的条目的面板上看不到这个错',
      await ev(`/已经不在世界书里/.test(document.querySelector('#st-entry-0 .st-ai-box').textContent)`), false);

    // —— 脏回复 ——
    await setScript({ reply: '我不想改，就这样挺好。', stream: false });
    await ev(`stAiEntryRun(0)`, true);
    check('非 JSON 回复给出可读错误',
      /没返回合法 JSON/.test(await ev(`stAiUi.enErr`)), true);
    check('坏回复留着原文供复制', (await ev(`stAiUi.enRaw`)).length > 0, true);
    check('有「复制原始回复」按钮',
      await ev(`/复制原始回复/.test(document.querySelector('#st-entry-0 .st-ai-box').textContent)`), true);

    await setScript({ reply: '{"entry":' + EN_REPLY + '}', stream: false });
    await ev(`stAiEntryRun(0)`, true);
    check('包成 {entry:{}} 也认', await ev(`!!stAiUi.enPreview`), true);

    await setScript({ reply: '[' + EN_REPLY + ']', stream: false });
    await ev(`stAiEntryRun(0)`, true);
    check('模型习惯性包成裸数组也认', await ev(`!!stAiUi.enPreview`), true);

    await setScript({ reply: '{"entries":[' + EN_REPLY + ']}', stream: false });
    await ev(`stAiEntryRun(0)`, true);
    check('包成 {entries:[{}]} 也认', await ev(`!!stAiUi.enPreview`), true);

    await setScript({ reply: '{"content":"   ","keys":[]}', stream: false });
    await ev(`stAiEntryRun(0)`, true);
    check('空条目给出可读错误',
      /解析出来的条目是空的/.test(await ev(`stAiUi.enErr`)), true);

    await ev(`stAiEntryClear()`);
    check('丢弃后预览为空', await ev(`stAiUi.enPreview`), null);
    check('丢弃后错误也清了', await ev(`stAiUi.enErr`), '');

    // —— 批量面板要指路，别让人以为只能新增 ——
    check('批量面板上写了「想只改某一条」的指路',
      await ev(`/想只改某一条/.test(document.querySelector('#st-panes').textContent)`), true);

    // 截图：面板长在 .st-entry-body 里，所以条目本身也得展开才看得见
    await ev(`(function(){
      stAiUi.enOpenId = stEditor.card.bookEntries[0].id;
      stRerender();
      const el = document.getElementById('st-entry-0');
      if (el) el.open = true;
      return true; })()`);
    await sleep(300);
    await ev(`document.querySelector('#st-entry-0').scrollIntoView({ block: 'start' })`);
    await sleep(200);
    const shotEntry = await cdp.send('Page.captureScreenshot', { format: 'png' }, SID);
    fs.writeFileSync(path.join(SHOTS, 'st-ai-entry.png'), Buffer.from(shotEntry.data, 'base64'));
    console.log(`  📸 st-ai-entry.png (${Math.round(Buffer.from(shotEntry.data, 'base64').length / 1024)} KB)`);

    // ================= N. 第一段 + 提示词结构预览 =================
    section('M. 第一段（永远在最前）与提示词结构预览');

    // 全程用同一个哨兵串 —— 断言里看到它就知道拿到的确实是「第一段」
    const SEG = 'N段哨兵-7f3a：这是一段角色扮演对话。';
    // 独立配置 + **关流式**。⚠ mock 的形状和配置里的 stream 必须一起改：
    // 客户端按 SSE 去读一个 JSON body 会**安静地拿到空串**（不报错），
    // 这个坑在本套件里已经咬过两次了
    const ownNS = (provider, model, proto) => ev(`(function(){
      stAi.mode = 'own'; stAi.provider = ${JSON.stringify(provider)};
      stAi.model = ${JSON.stringify(model)}; stAi.proto = ${JSON.stringify(proto || '')};
      stAi.apiKey = 'sk-own-AAA'; stAi.baseUrl = 'https://my.gateway.test/v1';
      stAi.stream = false; stAiSave(); return true; })()`);

    // —— N1. 空着 = 一条都不多 ——
    await ev(`(function(){
      stAi.mode = 'own'; stAi.firstSeg = ''; stAiSave();
      aiConfig.firstSeg = '';
      return true; })()`);
    check('第一段默认是空的', await ev(`stAiCfg().firstSeg`), '');
    check('空着时一条额外消息都不产生', await ev(`stAiPlanMessages(stAiExpandPlan()).length`), 2);
    check('空着时第 0 条就是任务提示词',
      await ev(`stAiPlanMessages(stAiExpandPlan())[0].label`), '任务提示词 system');

    // —— N2. 填了就一定排在第 0 条 ——
    await ev(`(stAi.firstSeg = ${JSON.stringify(SEG)}, stAiSave(), true)`);
    check('填了之后多出一条', await ev(`stAiPlanMessages(stAiExpandPlan()).length`), 3);
    check('它排在第 0 条', await ev(`stAiPlanMessages(stAiExpandPlan())[0].content`), SEG);
    check('它的角色是 system', await ev(`stAiPlanMessages(stAiExpandPlan())[0].role`), 'system');
    check('它被打了 first 标', await ev(`stAiPlanMessages(stAiExpandPlan())[0].first`), true);
    check('任务提示词退到第 1 条',
      await ev(`stAiPlanMessages(stAiExpandPlan())[1].label`), '任务提示词 system');
    check('user 还是排最后', await ev(`stAiPlanMessages(stAiExpandPlan())[2].role`), 'user');
    check('单条改写的消息顺序一样',
      await ev(`stAiPlanMessages(stAiEntryPlan(stEditor.card.bookEntries[0]))[0].content`), SEG);
    check('开场白的消息顺序一样',
      await ev(`stAiPlanMessages(stAiGreetPlan())[0].content`), SEG);

    // —— N3. 真的发出去的请求体（两套协议都要） ——
    await ownNS('openai', 'gpt-4o', '');
    await setScript({ reply: EXPAND_REPLY, stream: false });
    await clearCalls();
    await ev(`stAiExpandRun()`, true);
    const oc = await lastCall();
    check('OpenAI 体里第 0 条就是第一段', oc.body.messages[0].content, SEG);
    check('OpenAI 体里第 0 条角色是 system', oc.body.messages[0].role, 'system');
    check('OpenAI 体里一共 3 条', oc.body.messages.length, 3);

    await ownNS('anthropic', 'claude-x', '');
    await setScript({ reply: EXPAND_REPLY, stream: false });
    await clearCalls();
    await ev(`stAiExpandRun()`, true);
    const ac = await lastCall();
    check('Anthropic 的 messages 只剩 user（两条 system 被提走）', ac.body.messages.length, 1);
    check('Anthropic 顶层 system 以第一段开头', ac.body.system.indexOf(SEG), 0);
    check('Anthropic 顶层 system 里也还有任务提示词',
      ac.body.system.indexOf('只输出一个 JSON 对象') > 0, true);

    // —— N4. 宏 ——
    await ev(`(function(){
      stEditor.card.name = '雨夜侦探';
      stAi.firstSeg = '请用 {{char}} 的口吻说话。'; stAiSave();
      return true; })()`);
    check('编写器里 {{char}} 换成角色卡名字',
      await ev(`stAiFirstSegText()`), '请用 雨夜侦探 的口吻说话。');

    await ev(`(function(){
      aiConfig.firstSeg = '你是 {{char}}，正在跟 {{user}} 说话。';
      aiConfig.charName = '小雨'; aiConfig.userName = '小夜';
      aiConfig.userMacroEnabled = true;
      return true; })()`);
    check('AI 对话里 {{char}} / {{user}} 都换掉',
      await ev(`firstSegText()`), '你是 小雨，正在跟 小夜 说话。');
    await ev(`(function(){ aiConfig.firstSeg = ${JSON.stringify(SEG)}; return true; })()`);

    // —— N5. follow 现读全局配置 / own 自己一套 ——
    // ⚠ 同样把两份设成**不同**的字符串，否则分不出读的是哪一份
    await ev(`(function(){
      stAi.mode = 'follow'; stAiSave();
      apiGlobal.firstSeg = '来自全局配置的第一段';
      aiConfig.firstSeg = '来自 AI 对话的第一段';
      return true; })()`);
    check('跟随模式现读全局配置那段', await ev(`stAiCfg().firstSeg`), '来自全局配置的第一段');
    await ev(`stAiSetFirstSeg('想偷偷写进去')`);
    check('跟随模式下写不进 stAi（它是只读镜像）',
      await ev(`stAi.firstSeg`), '请用 {{char}} 的口吻说话。');
    await ev(`(function(){ stAi.mode = 'own'; stAiSave(); return true; })()`);
    check('切回独立配置读的是自己那份',
      await ev(`stAiCfg().firstSeg`), '请用 {{char}} 的口吻说话。');
    // 后面几段都要看哨兵串，这里把两份都掰回来（⚠ 全局那份也要 —— 跟随模式现读它）
    await ev(`(function(){
      stAi.firstSeg = ${JSON.stringify(SEG)}; stAiSave();
      apiGlobal.firstSeg = ${JSON.stringify(SEG)};
      aiConfig.firstSeg = ${JSON.stringify(SEG)}; persistSystemPrompt();
      return true; })()`);

    // —— N6. AI 对话那条路（buildRequestPlan） ——
    await ev(`(function(){
      aiConfig.firstSeg = ${JSON.stringify(SEG)};
      aiConfig.tavernEnabled = false; aiConfig.promptEnabled = true;
      return true; })()`);
    let mp = await ev(`buildRequestPlan().messages`);
    check('AI 对话：第一段排在最前', mp[0].content, SEG);
    check('AI 对话：它的角色是 system', mp[0].role, 'system');
    check('AI 对话：它在 layout 里的 kind 是 first（酒馆预览靠它标色）',
      await ev(`buildRequestPlan().layout[0].kind`), 'first');
    await ev(`(aiConfig.promptEnabled = false, true)`);
    mp = await ev(`buildRequestPlan().messages`);
    check('关掉系统提示词之后第一段仍然在（不受那个开关影响）', mp[0].content, SEG);
    await ev(`(aiConfig.promptEnabled = true, true)`);

    // —— N7. 提示词结构预览：四处都挂上了 ——
    await ev(`(stSwitchTab('ai'), true)`);
    await sleep(200);
    const skel = await ev(`(function(){
      const d = document.querySelector('#st-panes .st-ai-pv'); return d ? d.textContent : ''; })()`);
    check('AI 助手页有「提示词结构预览」', /提示词结构预览/.test(skel), true);
    check('AI 助手页的骨架是三个槽位',
      await ev(`document.querySelectorAll('#st-panes .st-ai-pv .st-ai-pmsg').length`), 3);
    check('骨架第 0 条是第一段（带 st-p-first）',
      await ev(`document.querySelector('#st-panes .st-ai-pv .st-ai-pmsg')
        .className.indexOf('st-p-first') >= 0`), true);
    check('骨架里放的是第一段的真实内容',
      await ev(`document.querySelector('#st-panes .st-ai-pv .st-ai-pmsg .st-ai-pbody').textContent`),
      SEG);
    check('骨架里注明了两条占位槽位的来源',
      await ev(`/由各功能面板自己拼/.test(document.querySelector('#st-panes .st-ai-pv').textContent)`),
      true);
    check('预览带协议说明',
      await ev(`/OpenAI 兼容|Anthropic/.test(document.querySelector('#st-panes .st-ai-pv').textContent)`),
      true);
    check('AI 助手页有「第一段」输入框（独立配置下可写）',
      await ev(`(function(){ const t = document.getElementById('st-ai-firstseg');
        return !!t && !t.readOnly; })()`), true);

    await ev(`(stSwitchTab('book'), true)`);
    await sleep(200);
    await ev(`(stAiUi.exOpen = true, stRerender(), true)`);
    await sleep(240);
    check('世界书批量扩写面板有预览',
      await ev(`!!document.querySelector('#st-panes .st-ai-pv')`), true);
    check('扩写预览里第一段在最前',
      await ev(`document.querySelector('#st-panes .st-ai-pv .st-ai-pmsg .st-ai-pbody').textContent`),
      SEG);
    check('扩写预览带的是真实的 system 正文',
      await ev(`/只输出一个 JSON 对象/.test(document.querySelector('#st-panes .st-ai-pv').textContent)`),
      true);
    check('扩写预览带的是真实的 user 正文',
      await ev(`/【素材】/.test(document.querySelector('#st-panes .st-ai-pv').textContent)`), true);

    // 截图：扩写面板摊开的样子（顺带证明预览里是**真内容**，不是占位）
    await ev(`(function(){
      const pvs = document.querySelectorAll('#st-panes .st-ai-pv');
      if (pvs.length) pvs[0].open = true;
      return true; })()`);
    await sleep(240);
    await ev(`(function(){ const b = document.querySelector('#st-panes .st-ai-box');
      if (b) b.scrollIntoView({ block: 'start' }); return true; })()`);
    await sleep(200);
    await cdp.send('Emulation.setDeviceMetricsOverride',
      { width: 1440, height: 1250, deviceScaleFactor: 1, mobile: false }, SID);
    await sleep(220);
    const shotEx = await cdp.send('Page.captureScreenshot', { format: 'png' }, SID);
    fs.writeFileSync(path.join(SHOTS, 'st-ai-expand-prompt.png'), Buffer.from(shotEx.data, 'base64'));
    console.log(`  📸 st-ai-expand-prompt.png (${Math.round(Buffer.from(shotEx.data, 'base64').length / 1024)} KB)`);
    await cdp.send('Emulation.setDeviceMetricsOverride',
      { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, SID);
    await sleep(150);

    await ev(`(function(){
      stAiUi.enOpenId = stEditor.card.bookEntries[0].id; stRerender(); return true; })()`);
    await sleep(240);
    check('单条改写面板有预览',
      await ev(`!!document.querySelector('#st-entry-0 .st-ai-pv')`), true);
    check('单条改写的预览里第一段也在最前',
      await ev(`document.querySelector('#st-entry-0 .st-ai-pv .st-ai-pmsg .st-ai-pbody').textContent`),
      SEG);
    check('单条改写的预览带的是「要改写的条目」',
      await ev(`/【要改写的条目】/.test(document.querySelector('#st-entry-0 .st-ai-pv').textContent)`),
      true);

    await ev(`(stSwitchTab('greet'), true)`);
    await sleep(200);
    check('开场白面板也有预览',
      await ev(`!!document.querySelector('#st-panes .st-ai-pv')`), true);
    check('开场白预览里第一段在最前',
      await ev(`document.querySelector('#st-panes .st-ai-pv .st-ai-pmsg .st-ai-pbody').textContent`),
      SEG);

    // —— N8. 预览的展开状态**不进** stAiUi ——
    const uiBefore = await ev(`localStorage.getItem('stAiUiCfg')`);
    await ev(`(function(){ const d = document.querySelector('#st-panes .st-ai-pv');
      if (d) d.open = true; return true; })()`);
    await sleep(240);
    check('展开预览不会改动持久化的面板参数',
      await ev(`localStorage.getItem('stAiUiCfg')`), uiBefore);
    check('预览的展开状态没有混进 stAiUi 白名单',
      await ev(`ST_AI_UI_KEEP.filter(k => /ShowPrompt|Preview/.test(k)).length`), 0);
    check('展开预览之后没有页面异常',
      consoleErrors.filter(e => /EXCEPTION/.test(e)).length, 0);

    // —— N9. 隐私：第一段不进卡、不进草稿 ——
    await ev(`(function(){ stAi.firstSeg = ${JSON.stringify(SEG)}; stAiSave();
      aiConfig.firstSeg = ${JSON.stringify(SEG)};
      persistSystemPrompt();   // aiConfig 是内存对象，不落盘的话 localStorage 里还是旧的
      stSaveDraft(); return true; })()`);
    check('第一段不进角色卡', await ev(`JSON.stringify(stEditor.card).indexOf('N段哨兵') >= 0`), false);
    check('第一段不进草稿',
      await ev(`(localStorage.getItem('stCardDraft') || '').indexOf('N段哨兵') >= 0`), false);
    check('第一段存在自己的配置键里',
      await ev(`(localStorage.getItem('stAiCfg') || '').indexOf('N段哨兵') >= 0`), true);
    check('AI 对话那份存在 aiChatConfig 里',
      await ev(`(localStorage.getItem('aiChatConfig') || '').indexOf('N段哨兵') >= 0`), true);

    // —— 截图：把骨架预览摊开 ——
    await ev(`(stSwitchTab('ai'), true)`);
    await sleep(200);
    await ev(`(function(){ const d = document.querySelector('#st-panes .st-ai-pv');
      if (d) d.open = true; return true; })()`);
    await sleep(260);
    // 预览嵌在编写器浮层里，浮层自己带滚动容器 —— 直接用高一点的视口整屏截，
    // 比按元素高度量（量出来的是浮层外的那一层）稳
    await ev(`(function(){ const d = document.querySelector('#st-panes .st-ai-pv');
      if (d) d.scrollIntoView({ block: 'center' }); return true; })()`);
    await sleep(200);
    await cdp.send('Emulation.setDeviceMetricsOverride',
      { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false }, SID);
    await sleep(220);
    const shotFs = await cdp.send('Page.captureScreenshot', { format: 'png' }, SID);
    fs.writeFileSync(path.join(SHOTS, 'st-ai-firstseg.png'), Buffer.from(shotFs.data, 'base64'));
    console.log(`  📸 st-ai-firstseg.png (${Math.round(Buffer.from(shotFs.data, 'base64').length / 1024)} KB)`);
    await cdp.send('Emulation.setDeviceMetricsOverride',
      { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, SID);
    await sleep(150);

    // ================= M. 收尾 =================
    section('N. 收尾');
    await ev(`stSwitchTab('book')`);
    await sleep(120);
    await ev(`stSwitchTab('greet')`);
    await sleep(120);
    await ev(`stSwitchTab('export')`);
    await sleep(120);
    await ev(`stSwitchTab('ai')`);
    await sleep(120);
    check('来回切选项卡没有页面异常', consoleErrors.filter(e => /EXCEPTION/.test(e)).length, 0);
    check('全程零 console.error', consoleErrors.length, 0);
    if (consoleErrors.length) consoleErrors.slice(0, 5).forEach(e => console.log('    ' + e));

    console.log(`\n===== 第九轮（AI 调用）：${pass} 通过 / ${fail} 失败 =====`);
    if (fails.length) { console.log('失败项：'); fails.forEach(f => console.log('  · ' + f)); }
  } catch (e) {
    fail++;
    console.log('\n💥 套件自己崩了：' + (e && e.stack ? e.stack : e));
  } finally {
    try { if (cdp) await cdp.send('Browser.close', {}, SID); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
    try { if (srv) srv.close(); } catch (e) {}
    // ⚠ **必须带 maxRetries**：Windows 上进程刚 kill 掉时 profile 目录还锁着，
    //   裸 `rmSync` 会 EBUSY 退出，而外面这层 catch 把它吞掉 —— **静默失败**。
    //   实测：不带重试时这一套每次全量都漏一个目录（其余 10 套补上重试后已不漏）。
    try { require('child_process').spawn(process.execPath, ['-e', 'require("fs").rmSync(process.argv[1],{recursive:true,force:true,maxRetries:0})', profile], { detached: true, stdio: 'ignore' }).unref(); } catch (e) {}
  }
  process.exit(fail ? 1 : 0);
})();
