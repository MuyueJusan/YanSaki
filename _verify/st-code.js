// 第十二轮：**Code（Agent）页** —— 会调工具的会话 + skill + 会话历史 + 双栏布局
//
// 这一轮的东西有两类要验：
//   ① 协议层（带 tools 的请求 / 两套协议的工具消息 / 回复解析）—— 用假 fetch 断言到字节
//   ② 真的会改卡的工具 —— 断言改完之后卡里是什么
//
// 假 fetch 装成「按脚本走」的形式：给一个队列，每次请求消费一步。
// 于是「先调工具、拿到结果、再说话」这个循环可以完整地跑一遍，
// 而不是只测「函数被调用了」。
//
// 二十一段（外加三小节）：
//   A. 接线与布局：选项卡、双栏、四个折叠菜单、窄屏切换
//   B. 协议层：两套协议的 URL / 头 / body.tools 形状
//   C. 消息转换：assistant 的 tool_calls / tool_use、tool 结果、连续合并
//   D. 回复解析：两套形状 + 围栏里的 arguments + 空回复
//   E. 工具执行：读卡 / 写字段（白名单）/ 世界书增删改查 / skill
//   E2. fetch_url：唯一会发网络请求的工具，带地址闸门
//   E3. set_tasks：任务清单跟着会话走，整表替换、脏数据兜底、不进卡
//   E4. 项目记忆：注入 system（标「优先于通用做法」）+ remember 工具
//   E5. read_doc / write_doc：状态栏与 MVU 的整份文本往返（解析失败一律拒绝）
//   E6. read_regex / write_regex / read_th / write_th：按条目改 +
//       **MVU 自己的正则 / 脚本挡住**（状态栏就住在那里，改 = 抹掉）
//   E7. 截断标记闸门 + read_doc 分段接着读（守「读一半写回一半」这个静默丢数据）
//   E8. skill 落盘：IndexedDB + 降级 + 老数据迁移
//   E9. 工具型 skill：manifest → 注册成工具 → **沙盒里跑**（摸不到卡、上不了网）
//   E10. 权限白名单：沙盒只能碰申请过的能力（**fetch_url 永远不给**、次数上限）
//   E11. skill 自报进度：host.progress 是**单向**通道（不吃 host.call 的 20 次预算），
//        没申请就被丢、狂刷有节流 + 次数上限、返回后那句进度要撤掉
//   F. Agent 循环：真跑一轮「调工具 → 拿结果 → 再说话」，卡确实被改了
//   G. 会话历史：新会话 / 切换 / 删除 / 刷新往返
//   H. skill：解析 frontmatter、导入、移除
//   H2. 从链接导入 / 拖拽导入
//   H3. skill 自动注入：触发词命中就把正文装进 system
//   I. **第一段**：默认不带（老行为不变），开关打开后必须带、且必须排在最前面
//      （含两种协议下的位置、空值不发、落盘与刷新往返）
//   J. 思维强度与安全开关
//   K. 隐私：skill / 会话 / 记忆 / 工具结果都不进卡
//   L. 收尾零报错
//
// 跑法：node st-code.js
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
  send(method, params = {}, sessionId, timeout = 40000) {
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
// 装进页面里。**按脚本走**：__aiScript.queue 是一串「这一步模型要干什么」，
// 每来一次请求消费一步，消费完就退回默认的纯文本回复。
// 于是「调工具 → 拿结果 → 再决定」这个循环能整条跑通。
const MOCK_SRC = `
(function () {
  window.__aiCalls = [];
  window.__aiScript = { queue: [], reply: '好的', fail: '', web: {} };
  function jsonResponse(obj, status) {
    return new Response(JSON.stringify(obj), { status: status || 200,
      headers: { 'Content-Type': 'application/json' } });
  }
  function textResponse(t, status) { return new Response(t, { status: status || 200 }); }

  // 一步 → 一套协议的响应体
  function build(step, isAnth) {
    const calls = Array.isArray(step.calls) ? step.calls : [];
    const text = String(step.text == null ? '' : step.text);
    if (isAnth) {
      const content = [];
      if (text) content.push({ type: 'text', text: text });
      calls.forEach((c, i) => content.push({
        type: 'tool_use', id: 'toolu_' + i, name: c.name, input: c.args || {} }));
      if (!content.length) content.push({ type: 'text', text: '' });
      return { id: 'msg_1', type: 'message', role: 'assistant', content: content,
        stop_reason: calls.length ? 'tool_use' : 'end_turn' };
    }
    const msg = { role: 'assistant', content: text };
    if (calls.length) {
      msg.tool_calls = calls.map((c, i) => ({
        id: 'call_' + i, type: 'function',
        // arguments 故意给**字符串**（真 OpenAI 就是这样）
        function: { name: c.name, arguments: JSON.stringify(c.args || {}) } }));
    }
    return { id: 'chatcmpl_1', object: 'chat.completion',
      choices: [{ index: 0, message: msg,
        finish_reason: calls.length ? 'tool_calls' : 'stop' }] };
  }

  window.fetch = async function (url, init) {
    init = init || {};
    const u = String(url);
    let body = null;
    try { body = init.body ? JSON.parse(init.body) : null; } catch (e) {}
    window.__aiCalls.push({ url: u, method: init.method || 'GET',
      headers: init.headers || {}, body: body });
    const S = window.__aiScript;
    // 先查「任意 URL → 文本」表：fetch_url 与「从链接导入」用它来假装公网。
    // 放在 LLM 分支**之前**，这样测试里注册过的地址一定命中，不会漏到协议判断里去
    const W = S.web || {};
    if (W[u]) {
      if (W[u].throw) throw new TypeError('Failed to fetch');
      return textResponse(String(W[u].body == null ? '' : W[u].body), W[u].status || 200);
    }
    if (S.fail === 'network') throw new TypeError('Failed to fetch');
    if (S.fail === 'http401') return textResponse('{"error":{"message":"invalid api key"}}', 401);
    if (S.fail === 'http500') return textResponse('upstream boom', 500);
    if (/\\/models$/.test(u)) return jsonResponse({ data: [{ id: 'gpt-4o' }] });

    const isAnth = /\\/messages$/.test(u);
    let step = S.queue.length ? S.queue.shift() : null;
    if (!step) step = { text: S.reply };
    if (step.raw) return jsonResponse(step.raw);
    return jsonResponse(build(step, isAnth));
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-stcode-'));
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
  const resetScript = () => ev(`(window.__aiScript = { queue: [], reply: '好的', fail: '' }, true)`);
  // 直接从 IndexedDB 里把 skill 那份读出来（测试专用 —— 页面自己的读路径是
  // stCodeSkillsLoad，它有「只读一次」的记忆化，不方便反复验）
  const idbSkillNames = () => ev(`stCodeIdbOp('readonly', s => s.get('skills'))
    .then(v => (v && Array.isArray(v.list)) ? v.list.map(x => x.name).join(',') : '')`, true);
  // 用「独立配置」+ 固定的假网关，跟 AI 助手那边隔开
  const useOwn = (proto, model) => ev(`(function(){
    stAi.mode = 'own'; stAi.provider = ${JSON.stringify(proto === 'anthropic' ? 'anthropic' : 'openai')};
    stAi.model = ${JSON.stringify(model)}; stAi.proto = ${JSON.stringify(proto)};
    stAi.apiKey = 'sk-code-AAA'; stAi.baseUrl = 'https://code.gateway.test/v1';
    stAi.temperature = 0.7; stAi.maxTokens = 4096;
    stAiSave(); return stAiCfg(); })()`);

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

    // ================= A. 接线与布局 =================
    section('A. 接线与布局');
    check('选项卡里有 code', await ev(`ST_TABS.some(t => t.id === 'code')`), true);
    // ⚠ 这条原来是 /sb,code,export/ —— persona 插进 code 后面之后，那个正则**照样匹配**
    //   （`sb,code` 还在，子串对得上），正则跑到 export 就不再看后面 ⇒ 等于把 persona
    //   从覆盖里静默漏掉。改成显式列出整段，多一个选项卡就当场红。
    check('code 排在 sb 和 export 之间、persona 紧跟其后',
      await ev(`ST_TABS.map(t => t.id).join(',')`), v => /sb,code,persona,export/.test(v), 'sb,code,persona,export');
    check('选项卡总数 15', await ev(`ST_TABS.length`), 15);

    await ev('openStEditor()');
    await sleep(200);
    await ev(`stSwitchTab('code')`);
    await sleep(250);

    check('切过去真的渲染了 Code 页', await ev(`!!document.querySelector('#st-panes .st-code')`), true);
    check('#st-panes 拿到了 st-code-mode（整页不滚，交给两栏各自滚）',
      await ev(`document.getElementById('st-panes').classList.contains('st-code-mode')`), true);
    check('左栏是角色卡 JSON', await ev(`!!document.querySelector('.st-code-card .st-code-json')`), true);
    check('右栏是 Agent 会话', await ev(`!!document.querySelector('.st-code-agent .st-code-log')`), true);
    check('JSON 里能看到卡的内容',
      await ev(`/spec/.test(document.querySelector('.st-code-json').textContent)`), true);
    check('JSON 上了色', await ev(`document.querySelector('.st-code-json .j-k') ? 1 : 0`), 1);
    check('JSON 里的字符串也上了色',
      await ev(`document.querySelector('.st-code-json .j-s') ? 1 : 0`), 1);
    check('JSON 里的数字也上了色',
      await ev(`document.querySelector('.st-code-json .j-n') ? 1 : 0`), 1);
    check('<details> 的默认小三角藏住了',
      await ev(`getComputedStyle(document.querySelector('.st-code-menu > summary'), '::marker').content`),
      v => v === 'none' || v === 'normal' || v === '""' || v === '', 'none');
    check('左栏有复制按钮', await ev(`/复制/.test(document.querySelector('.st-code-card .st-code-head').textContent)`), true);
    check('右栏底部是输入框 + 发送',
      await ev(`!!document.getElementById('st-code-input') && !!document.getElementById('st-code-send')`), true);

    // 工具条：四个折叠菜单 + 一个动作按钮（新会话不是菜单，是直接开一个）
    // ⚠ 菜单断言一律**按文案找**，不用 [0]/[1]/[2] 下标 —— 往工具条里插一个新菜单，
    //   下标全体后移，三条断言会一起红，而它们想说的其实只是「这几个菜单在」
    const hasMenu = async re => ev(
      `Array.from(document.querySelectorAll('.st-code-bar .st-code-menu > summary'))` +
      `.some(x => ${re}.test(x.textContent))`);
    // ⚠ 用 `>` 直接子元素：工具条里还嵌着别的 details（skill 面板里的格式说明），
    //   后代选择器会把它们也算进来
    check('工具条上的折叠菜单有四个',
      await ev(`document.querySelectorAll('.st-code-bar > .st-code-menu').length`), 4);
    check('有个菜单是「当前 skill 列表」', await hasMenu('/当前 skill 列表/'), true);
    check('有个菜单是「历史会话」', await hasMenu('/历史会话/'), true);
    check('有个菜单是「思维强度」', await hasMenu('/思维强度/'), true);
    check('有个菜单是「记忆」', await hasMenu('/记忆/'), true);
    // ⚠ 别用 [0] 这种位置选择器：工具条里的按钮会增减，而且弹层里的按钮
    //   也在 .st-code-bar 里面 —— 插一个新按钮进来，[0] 就换人了
    //   （加「从链接导入」时当场踩到：[0] 变成了它）。按**它自己的类**抓
    check('「新会话」是动作按钮，不是菜单',
      await ev(`(document.querySelector('.st-code-bar .st-code-btn.st-main-btn') || {}).textContent || ''`),
      v => /新会话/.test(v), '含「新会话」');
    check('「新会话」确实是个 button，不是 summary',
      await ev(`(document.querySelector('.st-code-bar .st-code-btn.st-main-btn') || {}).tagName || ''`), 'BUTTON');
    check('思维强度默认「中」', await ev(`stCode.think`), 'mid');

    check('展开状态写回了状态里（不重画，防打转）', await ev(`(function(){
      const d = Array.from(document.querySelectorAll('.st-code-bar .st-code-menu'))
        .filter(x => /当前 skill 列表/.test(x.querySelector('summary').textContent))[0];
      d.open = true; return true; })()`), true);
    await sleep(220);
    check('菜单展开后 stCode.open.skills 是 true', await ev(`stCode.open.skills`), true);
    check('展开菜单**没有**把整个 pane 重画掉（输入框还在）',
      await ev(`!!document.getElementById('st-code-input')`), true);

    await shot('st-code-split.png', '#st-panes .st-code');

    // 切回别的页，class 要摘掉
    await ev(`stSwitchTab('name')`);
    await sleep(220);
    check('切走后 st-code-mode 摘掉了',
      await ev(`document.getElementById('st-panes').classList.contains('st-code-mode')`), false);

    // 窄屏：单栏 + 切换
    await ev(`stSwitchTab('code')`);
    await sleep(200);
    await cdp.send('Emulation.setDeviceMetricsOverride',
      { width: 600, height: 900, deviceScaleFactor: 1, mobile: true }, SID);
    await sleep(320);
    check('窄屏下「Code / Agent」切换出现了',
      await ev(`getComputedStyle(document.querySelector('.st-code-view')).display`), 'flex');
    check('窄屏下默认只显示 Code 栏（data-view=card）',
      await ev(`getComputedStyle(document.querySelector('.st-code-agent')).display`), 'none');
    check('窄屏下 Code 栏是显示着的',
      await ev(`getComputedStyle(document.querySelector('.st-code-card')).display !== 'none'`), true);
    await ev(`stCodeViewSet('agent')`);
    await sleep(200);
    check('切到 Agent 之后 Code 栏藏起来',
      await ev(`getComputedStyle(document.querySelector('.st-code-card')).display`), 'none');
    check('Agent 栏显示出来',
      await ev(`getComputedStyle(document.querySelector('.st-code-agent')).display !== 'none'`), true);
    check('切换按钮的高亮跟着走',
      await ev(`document.querySelector('.st-code-vbtn.st-on').getAttribute('data-v')`), 'agent');
    check('切栏**没有**重画整页（滚动容器还在原处）',
      await ev(`!!document.getElementById('st-code-split')`), true);
    await shot('st-code-mobile.png', '#st-panes .st-code');
    await cdp.send('Emulation.setDeviceMetricsOverride',
      { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, SID);
    await sleep(280);
    await ev(`stCodeViewSet('card')`);

    // ================= B. 协议层 =================
    section('B. 协议层：两套协议的请求形状');
    await useOwn('openai', 'gpt-4o');
    let plan = await ev(`stCodeRequest(stAiCfg(), [{ role: 'user', content: 'x' }], {})`);
    check('OpenAI 走 /chat/completions', /\/chat\/completions$/.test(plan.url), true);
    check('OpenAI 用 Bearer', plan.headers['Authorization'], 'Bearer sk-code-AAA');
    check('OpenAI 的 tools 是 type:function 形状',
      plan.body.tools[0].type, 'function');
    check('OpenAI 的 tools 带 parameters', !!plan.body.tools[0].function.parameters, true);
    // ⚠ 数量从源码里枚举，别写死 —— 加一个工具就要回来改两处，而且忘了改也不会红
    check('OpenAI 的 tools 数量和工具表一致',
      plan.body.tools.length, await ev(`ST_CODE_TOOLS.length`));
    check('OpenAI 强制非流式（工具调用要拼完整消息）', plan.body.stream, false);
    check('OpenAI 带 tool_choice:auto', plan.body.tool_choice, 'auto');

    await useOwn('anthropic', 'claude-sonnet-4-20250514');
    plan = await ev(`stCodeRequest(stAiCfg(), [
      { role: 'system', content: 'sys' }, { role: 'user', content: 'x' }], {})`);
    check('Anthropic 走 /messages', /\/messages$/.test(plan.url), true);
    check('Anthropic 用 x-api-key', plan.headers['x-api-key'], 'sk-code-AAA');
    check('Anthropic 带 anthropic-version', plan.headers['anthropic-version'], '2023-06-01');
    check('Anthropic 带浏览器直连头',
      plan.headers['anthropic-dangerous-direct-browser-access'], 'true');
    check('Anthropic 的 tools 是 input_schema 形状',
      plan.body.tools[0].input_schema.type, 'object');
    check('Anthropic 的 tools 没有 type:function', plan.body.tools[0].type, undefined);
    check('Anthropic 把 system 提到顶层', plan.body.system, 'sys');
    check('Anthropic 的 messages 里没有 system',
      plan.body.messages.some(m => m.role === 'system'), false);
    check('Anthropic 的 messages 首条是 user', plan.body.messages[0].role, 'user');

    // ================= C. 消息转换 =================
    section('C. 消息转换：工具消息怎么进两套协议');
    const CONV = [
      { role: 'system', content: 'SYS' },
      { role: 'user', content: '帮我看看' },
      { role: 'assistant', content: '', calls: [{ id: 'c1', name: 'read_card', args: { path: 'name' } }] },
      { role: 'tool', content: '', toolResults: [{ id: 'c1', name: 'read_card', text: '空' }] }
    ];

    let oa = await ev(`stCodeMessagesFor('openai', ${JSON.stringify(CONV)})`);
    check('OpenAI：assistant 带 tool_calls', oa.messages[2].tool_calls.length, 1);
    check('OpenAI：arguments 是 JSON 字符串',
      oa.messages[2].tool_calls[0].function.arguments, '{"path":"name"}');
    check('OpenAI：tool 结果走 role:tool', oa.messages[3].role, 'tool');
    check('OpenAI：tool 结果带 tool_call_id', oa.messages[3].tool_call_id, 'c1');
    check('OpenAI：system 留在 messages 里', oa.messages[0].role, 'system');

    let an = await ev(`stCodeMessagesFor('anthropic', ${JSON.stringify(CONV)})`);
    check('Anthropic：system 收集到顶层', an.system, 'SYS');
    check('Anthropic：assistant 的 content 是块数组',
      Array.isArray(an.messages[1].content), true);
    check('Anthropic：块里有 tool_use', an.messages[1].content[0].type, 'tool_use');
    check('Anthropic：tool_use 的 input 是对象',
      an.messages[1].content[0].input.path, 'name');
    check('Anthropic：tool 结果走 user + tool_result', an.messages[2].role, 'user');
    check('Anthropic：tool_result 用 tool_use_id 对上',
      an.messages[2].content[0].tool_use_id, 'c1');

    // 连续两条 tool 结果必须并进同一条 user
    const CONV2 = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: '', calls: [
        { id: 'c1', name: 'read_card', args: {} }, { id: 'c2', name: 'list_skills', args: {} }] },
      { role: 'tool', content: '', toolResults: [{ id: 'c1', name: 'read_card', text: 'R1' }] },
      { role: 'tool', content: '', toolResults: [{ id: 'c2', name: 'list_skills', text: 'R2' }] }
    ];
    an = await ev(`stCodeMessagesFor('anthropic', ${JSON.stringify(CONV2)})`);
    check('Anthropic：两条连续 tool 结果并成一条 user', an.messages.length, 3);
    check('Anthropic：并起来那条里有两个块', an.messages[2].content.length, 2);
    check('Anthropic：没有连续的相同角色',
      await ev(`(function(){ const m = stCodeMessagesFor('anthropic', ${JSON.stringify(CONV2)}).messages;
        for (let i = 1; i < m.length; i++) if (m[i].role === m[i-1].role) return false;
        return true; })()`), true);

    // 首条必须是 user
    an = await ev(`stCodeMessagesFor('anthropic', [{ role: 'assistant', content: 'A' }])`);
    check('Anthropic：首条不是 user 会补一条', an.messages[0].role, 'user');

    // note 不发给模型
    const CONV3 = [{ role: 'user', content: 'a' }, { role: 'note', content: '这是给用户看的' }];
    oa = await ev(`stCodeMessagesFor('openai', ${JSON.stringify(CONV3)})`);
    check('给用户看的 note 不发给模型', oa.messages.length, 1);
    check('note 的内容确实没进去', /给用户看的/.test(JSON.stringify(oa)), false);

    // ================= D. 回复解析 =================
    section('D. 回复解析');
    let rep = await ev(`stCodeParseReply('openai', { choices: [{ message: {
      role: 'assistant', content: '我看看',
      tool_calls: [{ id: 'call_0', type: 'function',
        function: { name: 'read_card', arguments: '{"path":"name"}' } }] } }] })`);
    check('OpenAI：取到正文', rep.text, '我看看');
    check('OpenAI：取到一次工具调用', rep.calls.length, 1);
    check('OpenAI：工具名对', rep.calls[0].name, 'read_card');
    check('OpenAI：arguments 的字符串被解析成对象', rep.calls[0].args.path, 'name');
    check('OpenAI：id 保下来了', rep.calls[0].id, 'call_0');

    rep = await ev(`stCodeParseReply('anthropic', { content: [
      { type: 'text', text: '我看看' },
      { type: 'tool_use', id: 'toolu_9', name: 'list_skills', input: {} }],
      stop_reason: 'tool_use' })`);
    check('Anthropic：拼出正文', rep.text, '我看看');
    check('Anthropic：取到 tool_use', rep.calls[0].name, 'list_skills');
    check('Anthropic：id 保下来了', rep.calls[0].id, 'toolu_9');
    check('Anthropic：stop_reason 保下来了', rep.stop, 'tool_use');

    rep = await ev(`stCodeParseReply('openai', { choices: [{ message: {
      role: 'assistant', content: '',
      tool_calls: [{ id: 'c', function: { name: 'read_card',
        arguments: '\`\`\`json\\n{"path":"tags"}\\n\`\`\`' } }] } }] })`);
    check('带围栏的 arguments 也能解析出来', rep.calls[0].args.path, 'tags');

    rep = await ev(`stCodeParseReply('openai', { choices: [{ message: {
      role: 'assistant', content: '', tool_calls: [{ id: 'c',
        function: { name: 'read_card', arguments: '这不是 JSON' } }] } }] })`);
    check('完全不是 JSON 也不炸', rep.calls.length, 1);
    check('解析不了就原样放进 __raw', typeof rep.calls[0].args.__raw, 'string');

    rep = await ev(`stCodeParseReply('openai', {})`);
    check('空响应：没有正文', rep.text, '');
    check('空响应：没有工具调用', rep.calls.length, 0);

    // ================= E. 工具执行 =================
    section('E. 工具执行');
    await ev(`(function(){ stEditor.card = stBlankCard();
      stEditor.card.name = '雨夜侦探'; stEditor.card.description = '一个在雨夜工作的侦探。';
      stEditor.card.tags = ['悬疑', '都市'];
      return true; })()`);

    let r = await ev(`stCodeTool('read_card', {})`, true);
    check('read_card 不带 path 返回整张卡', r.ok, true);
    check('整卡 JSON 里有名字', /雨夜侦探/.test(r.text), true);

    r = await ev(`stCodeTool('read_card', { path: 'description' })`, true);
    check('read_card 带 path 只返回那个字段', r.text, '一个在雨夜工作的侦探。');

    r = await ev(`stCodeTool('read_card', { path: '不存在的字段' })`, true);
    check('读不存在的字段给 ok:false', r.ok, false);
    check('读不存在的字段会列出可用字段', /可写|可用字段/.test(r.text), true);

    r = await ev(`stCodeTool('write_text', { path: 'description', value: '改写后的描述。' })`, true);
    check('write_text 白名单内能写', r.ok, true);
    check('卡里真的变了', await ev(`stEditor.card.description`), '改写后的描述。');

    r = await ev(`stCodeTool('write_text', { path: 'mvu.nodes', value: 'x' })`, true);
    check('write_text 白名单外被拒绝', r.ok, false);
    check('拒绝理由里列出了可写字段', /可写的只有/.test(r.text), true);
    check('白名单外那次真的没写进去', await ev(`typeof stEditor.card.mvu.nodes`), 'object');

    r = await ev(`stCodeTool('write_text', { path: 'statusBar.blocks', value: 'x' })`, true);
    check('嵌套的危险路径也拦得住（段数 > 2）', r.ok, false);

    r = await ev(`stCodeTool('write_list', { path: 'tags', items: ['赛博朋克'] })`, true);
    check('write_list 默认 replace', await ev(`stEditor.card.tags.join(',')`), '赛博朋克');
    r = await ev(`stCodeTool('write_list', { path: 'tags', mode: 'append', items: ['悬疑', '赛博朋克'] })`, true);
    check('write_list append 会去重', await ev(`stEditor.card.tags.join(',')`), '赛博朋克,悬疑');
    r = await ev(`stCodeTool('write_list', { path: 'tags', mode: 'remove', items: ['悬疑'] })`, true);
    check('write_list remove', await ev(`stEditor.card.tags.join(',')`), '赛博朋克');
    r = await ev(`stCodeTool('write_list', { path: 'description', items: ['x'] })`, true);
    check('write_list 白名单外被拒绝', r.ok, false);

    // 世界书
    await ev(`(function(){ stEditor.card.bookEntries = []; return true; })()`);
    r = await ev(`stCodeTool('add_world_entry', { comment: '黑市', content: '黑市在下城区。', keys: ['黑市', '下城区'] })`, true);
    check('add_world_entry 成功', r.ok, true);
    check('世界书多了一条', await ev(`stEditor.card.bookEntries.length`), 1);
    check('条目的备注写进去了', await ev(`stEditor.card.bookEntries[0].comment`), '黑市');
    check('条目的关键词写进去了', await ev(`stEditor.card.bookEntries[0].keys.join(',')`), '黑市,下城区');

    r = await ev(`stCodeTool('add_world_entry', { content: '   ' })`, true);
    check('正文是空的条目会被拒', r.ok, false);

    r = await ev(`stCodeTool('list_world_entries', {})`, true);
    check('list_world_entries 能列出来', /黑市/.test(r.text), true);
    check('列表里带 id', /id=/.test(r.text), true);

    const eid = await ev(`stEditor.card.bookEntries[0].id`);
    r = await ev(`stCodeTool('read_world_entry', { id: ${JSON.stringify(eid)} })`, true);
    check('read_world_entry 按 id 读得到', /下城区/.test(r.text), true);

    r = await ev(`stCodeTool('update_world_entry', { id: ${JSON.stringify(eid)}, content: '黑市改过了。' })`, true);
    check('update_world_entry 成功', r.ok, true);
    check('正文被改了', await ev(`stEditor.card.bookEntries[0].content`), '黑市改过了。');
    check('没传的字段保持原样（关键词还在）',
      await ev(`stEditor.card.bookEntries[0].keys.join(',')`), '黑市,下城区');
    check('没传的字段保持原样（备注还在）',
      await ev(`stEditor.card.bookEntries[0].comment`), '黑市');

    // 空值不覆盖
    await ev(`stCodeTool('update_world_entry', { id: ${JSON.stringify(eid)}, keys: [], comment: '' })`, true);
    check('空 keys 不覆盖原来的', await ev(`stEditor.card.bookEntries[0].keys.join(',')`), '黑市,下城区');
    check('空 comment 不覆盖原来的', await ev(`stEditor.card.bookEntries[0].comment`), '黑市');

    // 按备注名找
    r = await ev(`stCodeTool('update_world_entry', { id: '黑市', order: 55 })`, true);
    check('按备注名也能找到条目', r.ok, true);
    check('order 写进去了', await ev(`stEditor.card.bookEntries[0].order`), 55);

    r = await ev(`stCodeTool('delete_world_entry', { id: ${JSON.stringify(eid)} })`, true);
    check('delete_world_entry 成功', r.ok, true);
    check('世界书空了', await ev(`stEditor.card.bookEntries.length`), 0);
    check('删掉的进了回收站', await ev(`stCode.trash.length`), 1);
    // ⚠ 回收站里装的是 { kind, item } 包装而不是裸条目 —— 正则 / 脚本的删除也走这里，
    //   撤回时必须知道该放回哪个数组。所以这里断言 item 那一层
    check('回收站里带 kind=book', await ev(`stCode.trash[0].kind`), 'book');
    check('回收站里那条正文是对的', await ev(`stCode.trash[0].item.content`), '黑市改过了。');

    // 撤回
    await ev(`stCodeUndoDelete()`);
    check('撤回之后世界书又有一条', await ev(`stEditor.card.bookEntries.length`), 1);
    check('撤回之后回收站空了', await ev(`stCode.trash.length`), 0);

    // skill 工具
    r = await ev(`stCodeTool('list_skills', {})`, true);
    check('没有 skill 时给的是能看懂的提示', /还没导入/.test(r.text), true);

    await ev(`(function(){
      stCode.skills = [{ name: '写开场白', desc: '怎么写出好开场白', body: '第一步……', file: 'x/SKILL.md' }];
      return true; })()`);
    r = await ev(`stCodeTool('list_skills', {})`, true);
    check('列 skill 带上名字和描述', /写开场白 —— 怎么写出好开场白/.test(r.text), true);

    r = await ev(`stCodeTool('read_skill', { name: '写开场白' })`, true);
    check('read_skill 拿到正文', /第一步/.test(r.text), true);
    r = await ev(`stCodeTool('read_skill', { name: '开场' })`, true);
    check('read_skill 支持部分匹配', r.ok, true);
    r = await ev(`stCodeTool('read_skill', { name: '不存在的' })`, true);
    check('找不到 skill 给 ok:false', r.ok, false);

    r = await ev(`stCodeTool('不存在的工具', {})`, true);
    check('不存在的工具给 ok:false', r.ok, false);
    check('并且列出可用工具', /可用工具/.test(r.text), true);

    // autoApply 关掉
    await ev(`(function(){ stCode.autoApply = false; return true; })()`);
    await ev(`(function(){ stEditor.card.creator = ''; return true; })()`);
    r = await ev(`stCodeTool('write_text', { path: 'creator', value: '不该写进去' })`, true);
    check('关掉「真的改卡」之后 write_text 不落卡', await ev(`stEditor.card.creator`), '');
    check('但会告诉模型这一步没生效', /只演示/.test(r.text), true);
    await ev(`(function(){ stCode.autoApply = true; return true; })()`);

    // 工具结果太长会截断。⚠ read_card 是**只读工具** —— 它拿的是 ST_CODE_READ_CHARS（32000）
    //   而不是 ST_CODE_TOOL_CHARS（12000）：这类结果是要被写回去的，
    //   截到 12000 就是「读一半 → 写一半」，后半段静默没了
    check('只读工具用宽预算（32000）',
      await ev(`stCodeToolCap('read_card')`), 32000);
    check('会改卡的工具仍然用 12000',
      await ev(`stCodeToolCap('write_text')`), 12000);
    // ⚠ 推导式断言：以后加 `read_` / `list_` 开头的工具忘了登记进只读清单会被抓到。
    //   漏登记的后果不报错 —— 那条工具只是悄悄退回「吃步数 + 12000 截断」
    check('read_/list_ 开头的工具都登记进了只读清单',
      await ev(`JSON.stringify(ST_CODE_TOOLS.map(t => t.name)
        .filter(n => /^(read_|list_)/.test(n) && ST_CODE_READ_TOOLS.indexOf(n) < 0))`), '[]');
    check('只读清单里没有写工具',
      await ev(`JSON.stringify(ST_CODE_READ_TOOLS.filter(n =>
        /^(write_|add_|update_|delete_)/.test(n)))`), '[]');
    r = await ev(`(async function(){ stEditor.card.description = 'x'.repeat(60000);
      const out = await stCodeTool('read_card', { path: 'description' });
      return [out.text.length, out.text.indexOf(ST_CODE_CUT_MARK) >= 0]; })()`, true);
    check('超长只读结果截在 32k 上，不是 12k', r[0] > 30000 && r[0] < 34000, true);
    check('截断时带上标记（模型看得见自己没读全）', r[1], true);
    await ev(`(function(){ stEditor.card.description = '旧描述'; return true; })()`);

    // ================= E2. fetch_url =================
    section('E2. fetch_url：唯一会发网络请求的工具（带地址闸门）');

    // ⚠ 别写死总数（加一个工具要回来改两处，而且忘了改只会在跑套件时才红）。
    //   断「这些名字都在」—— 加工具不会红，**删掉或改名会**
    const TOOL_NAMES = ['read_card', 'write_text', 'write_list', 'list_world_entries',
      'read_world_entry', 'add_world_entry', 'update_world_entry', 'delete_world_entry',
      'list_skills', 'read_skill', 'fetch_url', 'set_tasks', 'remember',
      'read_doc', 'write_doc', 'read_regex', 'write_regex', 'read_th', 'write_th'];
    check('工具表里该有的都在（' + TOOL_NAMES.length + ' 个）',
      await ev(`JSON.stringify(${JSON.stringify(TOOL_NAMES)}` +
        `.filter(n => !ST_CODE_TOOLS.some(t => t.name === n)))`), '[]');
    check('set_tasks 的 schema 里有 tasks 数组',
      await ev(`(function(){ const t = ST_CODE_TOOLS.filter(x => x.name === 'set_tasks')[0];
        return !!(t && t.schema && t.schema.properties && t.schema.properties.tasks
          && t.schema.required && t.schema.required.indexOf('tasks') >= 0); })()`), true);
    check('remember 的 schema 里有 text',
      await ev(`(function(){ const t = ST_CODE_TOOLS.filter(x => x.name === 'remember')[0];
        return !!(t && t.schema && t.schema.properties && t.schema.properties.text
          && t.schema.required && t.schema.required.indexOf('text') >= 0); })()`), true);
    check('fetch_url 在表里', await ev(`ST_CODE_TOOLS.some(t => t.name === 'fetch_url')`), true);
    check('两套协议都声明了 fetch_url', await ev(`(function(){
      const oa = stCodeToolsFor('openai').filter(t => t.function && t.function.name === 'fetch_url');
      const an = stCodeToolsFor('anthropic').filter(t => t.name === 'fetch_url' && t.input_schema);
      return oa.length + ',' + an.length; })()`), '1,1');
    check('工具描述里写明「你自己没有网络」',
      await ev(`ST_CODE_TOOLS.filter(t => t.name === 'fetch_url')[0].desc`),
      v => /没有网络/.test(v));

    // —— 地址闸门：**不发任何请求**，纯判据 ——
    // ⚠ 这是这次改动里最要紧的一组断言。模型能指挥**用户的浏览器**去访问任意地址，
    //   挡不住 localhost / 内网就等于开了一条「把用户本机别的东西读出来」的通道
    const guards = [
      ['http://localhost:8080/x', false, 'localhost'],
      ['http://127.0.0.1/x', false, '环回'],
      ['http://0.0.0.0/x', false, '0.0.0.0'],
      ['http://[::1]/x', false, 'IPv6 环回'],
      ['http://192.168.1.1/', false, '192.168 内网'],
      ['http://10.0.0.5/', false, '10.x 内网'],
      ['http://172.16.0.1/', false, '172.16 内网'],
      ['http://172.31.255.254/', false, '172.31 内网边界'],
      ['http://169.254.169.254/latest/meta-data/', false, '云元数据地址'],
      ['http://100.64.0.1/', false, '运营商级 NAT'],
      ['http://nas.local/x', false, '.local 主机名'],
      ['file:///etc/passwd', false, 'file 协议'],
      ['javascript:alert(1)', false, 'javascript 协议'],
      ['', false, '空地址'],
      ['not a url', false, '不是 URL'],
      ['https://example.com/doc.md', true, '正常公网 https'],
      ['http://172.32.0.1/', true, '172.32 在私网段之外'],
      ['https://raw.githubusercontent.com/o/r/main/a.md', true, 'raw 直链'],
    ];
    const guardGot = await ev(`(${JSON.stringify(guards.map(g => g[0]))}).map(u => stCodeUrlGuard(u).ok)`);
    guards.forEach((g, i) => check(`闸门 · ${g[2]}`, guardGot[i], g[1]));

    // —— 真的取一次（走假 fetch 的 web 表）——
    await setScript({ web: {
      'https://example.com/doc.md': { body: '# 文档\n这是正文。' },
      'https://example.com/big.md': { body: 'y'.repeat(20000) },
      'https://example.com/404.md': { status: 404, body: 'nope' },
      'https://example.com/boom.md': { throw: true }
    } });

    r = await ev(`stCodeTool('fetch_url', { url: 'https://example.com/doc.md' })`, true);
    check('fetch_url 取到正文', /这是正文/.test(r.text), true);
    check('结果里带上取的是哪个地址', /example\.com\/doc\.md/.test(r.text), true);

    r = await ev(`stCodeTool('fetch_url', { url: 'https://example.com/big.md' })`, true);
    check('超长正文被截断', r.text.length < 9000, true);
    check('并且标明截断了', /已截断/.test(r.text), true);

    r = await ev(`stCodeTool('fetch_url', { url: 'https://example.com/404.md' })`, true);
    check('404 给 ok:false', r.ok, false);
    check('404 的理由能看懂', /404/.test(r.text), true);

    r = await ev(`stCodeTool('fetch_url', { url: 'https://example.com/boom.md' })`, true);
    check('网络炸了给 ok:false', r.ok, false);

    r = await ev(`stCodeTool('fetch_url', { url: 'http://127.0.0.1/secret' })`, true);
    check('内网地址给 ok:false', r.ok, false);
    check('内网地址的理由能看懂', /内网|保留地址|本机/.test(r.text), true);

    // 关键一条：被闸门拒掉的地址**一次请求都不该发出去**
    await clearCalls();
    await ev(`stCodeTool('fetch_url', { url: 'http://192.168.1.1/admin' })`, true);
    check('被拒的地址没有产生任何真实请求',
      await ev(`window.__aiCalls.filter(c => /192\\.168/.test(c.url)).length`), 0);

    r = await ev(`stCodeTool('fetch_url', {})`, true);
    check('不给 url 给 ok:false', r.ok, false);

    // ================= F. Agent 循环 =================
    section('F. Agent 循环：真的跑一轮「调工具 → 拿结果 → 再说话」');
    await ev(`(function(){ stEditor.card = stBlankCard();
      stEditor.card.name = '雨夜侦探';
      stEditor.card.description = '旧描述';
      stCode.sessions = []; stCode.sessionId = ''; stCode.trash = [];
      stSwitchTab('code'); return true; })()`);
    await sleep(220);

    await resetScript();
    await setScript({ queue: [
      { text: '我先看一眼。', calls: [{ name: 'read_card', args: { path: 'description' } }] },
      { text: '我改好了。', calls: [{ name: 'write_text', args: { path: 'description', value: '新描述：一个在雨夜工作的侦探。' } }] },
      { text: '改完了，描述已经换成新的了。' }
    ] });
    await useOwn('openai', 'gpt-4o');
    await clearCalls();

    await ev(`(function(){ document.getElementById('st-code-input').value = '把描述写细一点'; return true; })()`);
    await ev(`stCodeSend()`, true);
    await sleep(300);

    check('卡真的被 Agent 改了', await ev(`stEditor.card.description`), '新描述：一个在雨夜工作的侦探。');
    check('一共发了三次请求（两轮工具 + 一轮收尾）', (await calls()).length, 3);
    const hist = await ev(`stCodeSession().msgs.map(m => m.role).join(',')`);
    check('消息序列是 user→assistant→tool→assistant→tool→assistant',
      hist, 'user,assistant,tool,assistant,tool,assistant');
    check('会话里有工具调用记录',
      await ev(`stCodeSession().msgs.filter(m => m.calls && m.calls.length).length`), 2);
    check('会话里有工具结果',
      await ev(`stCodeSession().msgs.filter(m => m.role === 'tool').length`), 2);
    check('工具结果里能看到真的读到了内容',
      await ev(`/旧描述/.test(JSON.stringify(stCodeSession().msgs))`), true);
    check('第二轮请求里带上了第一轮的工具结果',
      await ev(`(function(){ const c = window.__aiCalls[1];
        return c.body.messages.some(m => m.role === 'tool'); })()`), true);
    check('第二轮请求里带上了 assistant 的 tool_calls',
      await ev(`(function(){ const c = window.__aiCalls[1];
        return c.body.messages.some(m => m.tool_calls && m.tool_calls.length); })()`), true);
    check('会话标题取的是第一条用户消息',
      await ev(`stCodeSession().title`), '把描述写细一点');
    check('跑完 running 归位', await ev(`stCode.running`), false);
    check('跑完没有残留错误', await ev(`stCode.err`), '');
    check('发送按钮恢复可用', await ev(`document.getElementById('st-code-send').disabled`), false);

    await shot('st-code-agent.png', '#st-panes .st-code');

    // 工具报错也要喂回给模型，而不是把循环炸掉
    await resetScript();
    await setScript({ queue: [
      { calls: [{ name: 'write_text', args: { path: '不合法', value: 'x' } }] },
      { text: '那个字段不让写，我换个办法。' }
    ] });
    await clearCalls();
    await ev(`(function(){ document.getElementById('st-code-input').value = '乱写一个字段'; return true; })()`);
    await ev(`stCodeSend()`, true);
    await sleep(250);
    check('工具失败也把结果喂回去了（循环没断）', (await calls()).length, 2);
    check('失败的工具结果标成 ok:false',
      await ev(`(function(){ const t = stCodeSession().msgs.filter(m => m.role === 'tool');
        const last = t[t.length-1]; return last ? last.ok : null; })()`), false);
    check('失败之后 Agent 还是给出了收尾的话',
      await ev(`/换个办法/.test(JSON.stringify(stCodeSession().msgs))`), true);

    // 步数上限 —— ⚠ 这里必须用**会改卡**的工具。只读工具不吃步数（见下面那组），
    //   拿 list_skills 来试会一路读到「只读上限」才停，根本测不到 th.steps
    await resetScript();
    await ev(`(function(){ stCode.think = 'off'; return true; })()`);
    await setScript({ queue: Array.from({ length: 30 }, () => ({ calls: [{ name: 'set_tasks', args: { tasks: [{ text: '占位' }] } }] })) });
    await ev(`(function(){ stCode.sessions = []; stCode.sessionId = ''; return true; })()`);
    await ev(`(function(){ document.getElementById('st-code-input').value = '一直调工具'; return true; })()`);
    await ev(`stCodeSend()`, true);
    await sleep(250);
    check('「关」档最多 4 步改卡', await ev(`(function(){
      return stCodeSession().msgs.filter(m => m.role === 'tool').length; })()`), 4);
    check('用满步数会留一条提示', await ev(`(function(){
      return stCodeSession().msgs.some(m => m.role === 'note' && /用满/.test(m.content)); })()`), true);

    // 只读工具**不吃步数**：同是「关」档（4 步），连读 6 次之后照样能改卡。
    // ⚠ 这条是「读卡 + 读状态栏 + 读 Zod 就把预算用光、真正要改的那一下没预算了」的回归
    await resetScript();
    await setScript({ queue: [
      { calls: [{ name: 'read_card', args: {} }] },
      { calls: [{ name: 'read_card', args: {} }] },
      { calls: [{ name: 'read_regex', args: {} }] },
      { calls: [{ name: 'read_th', args: {} }] },
      { calls: [{ name: 'list_skills', args: {} }] },
      { calls: [{ name: 'read_card', args: {} }] },
      { calls: [{ name: 'write_text', args: { path: 'creator', value: '读完之后才写的' } }] },
      { text: '读完了，也写完了。' }
    ] });
    await ev(`(function(){ stEditor.card = stBlankCard(); stEditor.card.name = '只读不吃步数';
      stCode.sessions = []; stCode.sessionId = ''; stCode.autoApply = true; return true; })()`);
    await ev(`(function(){ document.getElementById('st-code-input').value = '先读再写'; return true; })()`);
    await ev(`stCodeSend()`, true);
    await sleep(350);
    check('「关」档连读 6 次之后**还能改卡**', await ev(`stEditor.card.creator`), '读完之后才写的');
    check('7 次工具调用全跑到了（6 读 + 1 写）', await ev(`(function(){
      return stCodeSession().msgs.filter(m => m.role === 'tool').length; })()`), 7);
    check('没有因为「用满步数」被提前叫停', await ev(`(function(){
      return stCodeSession().msgs.some(m => m.role === 'note' && /用满/.test(m.content)); })()`), false);

    // ⚠ 同理，**没申请 card.write 的工具型 skill 也是只读的** ——
    //   一句「用骰子算个随机数」不该吃掉一次改卡预算（system 里写的是
    //   「read_* 这类只读工具…不算在里面」，行为得跟它对得上）。
    //   它改不了卡，所以「吃预算」纯属白扣 —— 用户只会觉得「怎么才问两句就不动了」
    await ev(`(async function(){
      const src = [
        '/*!MANIFEST {"name":"just_compute","description":"纯算，不碰卡。"}!*/',
        'function run() { return "算好了"; }'
      ].join('\\n');
      const f = new File([src], 'just_compute.js', { type: 'text/javascript' });
      const r = await stCodeImportFiles([f]);
      await stCodeSkillsApply(r.found, r.js, '', r.errs);
      return true; })()`, true);
    await resetScript();
    await setScript({ queue: [
      { calls: [{ name: 'just_compute', args: {} }] },
      { calls: [{ name: 'just_compute', args: {} }] },
      { calls: [{ name: 'just_compute', args: {} }] },
      { calls: [{ name: 'just_compute', args: {} }] },
      { calls: [{ name: 'just_compute', args: {} }] },
      { calls: [{ name: 'just_compute', args: {} }] },
      { calls: [{ name: 'write_text', args: { path: 'creator', value: '算完之后写的' } }] },
      { text: '算完了，也写完了。' }
    ] });
    await ev(`(function(){ stEditor.card = stBlankCard(); stEditor.card.name = '纯算不吃步数';
      stCode.sessions = []; stCode.sessionId = ''; stCode.autoApply = true; return true; })()`);
    await ev(`(function(){ document.getElementById('st-code-input').value = '先算再写'; return true; })()`);
    await ev(`stCodeSend()`, true);
    await sleep(400);
    check('「关」档连调 6 次纯算 skill 之后**还能改卡**',
      await ev(`stEditor.card.creator`), '算完之后写的');
    check('纯算 skill 也没被「用满步数」叫停', await ev(`(function(){
      return stCodeSession().msgs.some(m => m.role === 'note' && /用满/.test(m.content)); })()`), false);

    // 对照组：**申请了 card.write 的 skill 照样要吃步数** ——
    // 不然「豁免」就是个白送的口子（任何 skill 只要不申请权限就无限调用）
    await ev(`(async function(){
      const src = [
        '/*!MANIFEST {"name":"can_write","description":"能改卡。","perm":["card.write"]}!*/',
        'function run() { return "什么都没干"; }'
      ].join('\\n');
      const f = new File([src], 'can_write.js', { type: 'text/javascript' });
      const r = await stCodeImportFiles([f]);
      await stCodeSkillsApply(r.found, r.js, '', r.errs);
      return true; })()`, true);
    await resetScript();
    await setScript({ queue: Array.from({ length: 8 }, () => ({ calls: [{ name: 'can_write', args: {} }] })) });
    await ev(`(function(){ stCode.sessions = []; stCode.sessionId = ''; return true; })()`);
    await ev(`(function(){ document.getElementById('st-code-input').value = '一直调那个能改卡的'; return true; })()`);
    await ev(`stCodeSend()`, true);
    await sleep(300);
    check('对照组：能改卡的 skill 照样吃步数，4 步就停', await ev(`(function(){
      return stCodeSession().msgs.some(m => m.role === 'note' && /用满/.test(m.content)); })()`), true);

    await ev(`(async function(){ stCode.skills = []; await stCodeSaveSkills(); return true; })()`, true);

    // 但只读也不能不限 —— 一直读转圈会被单独的上限叫停
    await resetScript();
    await setScript({ queue: Array.from({ length: 60 }, () => ({ calls: [{ name: 'list_skills', args: {} }] })) });
    await ev(`(function(){ stCode.sessions = []; stCode.sessionId = ''; return true; })()`);
    await ev(`(function(){ document.getElementById('st-code-input').value = '一直读'; return true; })()`);
    await ev(`stCodeSend()`, true);
    await sleep(500);
    check('一直读会在只读上限上停住（不是无限转圈）', await ev(`(function(){
      return stCodeSession().msgs.filter(m => m.role === 'tool').length; })()`), 40);
    check('叫停时给的是「连着读」那条提示', await ev(`(function(){
      return stCodeSession().msgs.some(m => m.role === 'note' && /连着读/.test(m.content)); })()`), true);

    await ev(`(function(){ stCode.think = 'mid'; return true; })()`);

    // HTTP 错误
    await resetScript();
    await setScript({ fail: 'http401' });
    await ev(`(function(){ stCode.sessions = []; stCode.sessionId = ''; return true; })()`);
    await ev(`(function(){ document.getElementById('st-code-input').value = '会失败'; return true; })()`);
    await ev(`stCodeSend()`, true);
    await sleep(200);
    check('401 会被记成错误', /HTTP 401/.test(await ev(`stCode.err`)), true);
    check('出错之后 running 也要归位', await ev(`stCode.running`), false);
    check('错误显示在会话里', await ev(`/HTTP 401/.test(document.getElementById('st-code-log').textContent)`), true);
    await resetScript();

    // 没配好就别发
    await ev(`(function(){ stAi.mode = 'own'; stAi.apiKey = ''; stAi.baseUrl = '';
      stAi.model = ''; stAiSave(); return true; })()`);
    await clearCalls();
    await ev(`(function(){ document.getElementById('st-code-input').value = '发不出去'; return true; })()`);
    await ev(`stCodeSend()`, true);
    await sleep(150);
    check('没配好时一次请求都不发', (await calls()).length, 0);
    check('没配好时给出的是能看懂的话', (await ev(`stCode.err`)).length > 0, true);
    await useOwn('openai', 'gpt-4o');

    // —— 端到端：模型调「工具型 skill」改卡，右侧卡 JSON 要跟着重画 ——
    // ⚠ 这一条**只能在循环这一层测**。`touched` 的路径是
    //   沙盒 → RPC → stCodeToolRun → stCodeTool → 循环，中间隔了两层；
    //   只在 `stCodeTool` 那一层断言（E10 做的）抓不到「循环没重画」，
    //   而那正是用户看得见的症状：skill 说改好了、卡里真的改了、右边还是旧的
    await ev(`(async function(){
      window.__jsonPaints = 0;
      window.__origPaintJson = stCodePaintJson;
      window.stCodePaintJson = function () {
        window.__jsonPaints++;
        return window.__origPaintJson.apply(this, arguments);
      };
      stCode.autoApply = true;
      stEditor.card = stBlankCard();
      stEditor.card.description = '循环测试前';
      stCode.sessions = []; stCode.sessionId = '';
      const src = [
        '/*!MANIFEST {"name":"loop_writer","description":"把描述改掉。","perm":["card.write"]}!*/',
        'function run(args) {',
        '  return host.call("write_text", { path: "description", value: "skill 从沙盒里改的" })',
        '    .then(function (v) { return "改好了：" + v; });',
        '}'
      ].join('\\n');
      const f = new File([src], 'loop_writer.js', { type: 'text/javascript' });
      const r = await stCodeImportFiles([f]);
      await stCodeSkillsApply(r.found, r.js, '', r.errs);
      return true; })()`, true);
    await resetScript();
    await setScript({ queue: [
      { calls: [{ name: 'loop_writer', args: {} }] },
      { text: '改完了。' }
    ] });
    await clearCalls();
    await ev(`(function(){ document.getElementById('st-code-input').value = '用那个工具改一下'; return true; })()`);
    await ev(`stCodeSend()`, true);
    await sleep(300);

    check('模型调工具型 skill，卡真的被改了',
      await ev(`stEditor.card.description`), 'skill 从沙盒里改的');
    check('而且循环重画了右侧的卡 JSON（touched 穿过了两层）',
      await ev(`window.__jsonPaints > 0`), true);

    // 对照组：只读的 skill 不该触发重画 —— 不然上面那条就是恒真的，等于没测
    await ev(`(async function(){
      window.__jsonPaints = 0;
      const src = [
        '/*!MANIFEST {"name":"loop_reader","description":"只读。","perm":["card.read"]}!*/',
        'function run() {',
        '  return host.call("read_card", {}).then(function (v) { return "读到了 " + String(v).length + " 字"; });',
        '}'
      ].join('\\n');
      const f = new File([src], 'loop_reader.js', { type: 'text/javascript' });
      const r = await stCodeImportFiles([f]);
      await stCodeSkillsApply(r.found, r.js, '', r.errs);
      return true; })()`, true);
    await resetScript();
    await setScript({ queue: [
      { calls: [{ name: 'loop_reader', args: {} }] },
      { text: '看完了。' }
    ] });
    await clearCalls();
    await ev(`(function(){ document.getElementById('st-code-input').value = '只看一眼'; return true; })()`);
    await ev(`stCodeSend()`, true);
    await sleep(250);
    check('对照组：只读的 skill 不触发重画（证明上面那条不是恒真）',
      await ev(`window.__jsonPaints`), 0);

    // 收拾干净：还原被替换的函数、清掉这两个探针
    await ev(`(async function(){
      window.stCodePaintJson = window.__origPaintJson;
      stCode.skills = []; await stCodeSaveSkills();
      return true; })()`, true);
    check('探针函数已还原（后续段落的断言不受影响）',
      await ev(`stCodePaintJson === window.__origPaintJson`), true);

    // ========== F2. Gemini / Vertex：明说「工具调用不支持」，不静默按 OpenAI 发 ==========
    section('F2. Gemini / Vertex 协议：工具调用不支持时要说出来');

    // ⚠ 第十八轮加了第三种协议 `gemini`（Gemini 原生 / Vertex），但 Code 页的
    //   Agent 工具调用只实现了 OpenAI 兼容 / Anthropic 两种形状
    //   （`stCodeToolsFor` / `stCodeMessagesFor` / `stCodeParseReply` 全按这两种写）。
    //   Gemini 的工具调用是**另一套形状**（`functionDeclarations`、parts 里的
    //   `functionCall` / `functionResponse`），这一版没做。
    //   ⇒ 必须在**发之前**拦住并说清楚。否则它会按 OpenAI 形状打 Google，
    //     回来的 400 跟「协议不对」看起来毫无关系 —— 用户只会怀疑 Key 或模型名
    await resetScript();
    await clearCalls();
    await ev(`(function(){
      stAi.mode = 'own'; stAi.provider = 'vertex'; stAi.proto = 'gemini';
      stAi.model = 'gemini-2.5-pro'; stAi.apiKey = 'sk-vertex-AAA';
      stAi.baseUrl = 'https://aiplatform.googleapis.com';
      stAiSave(); return true; })()`);
    check('（准备）cfg 走的是 gemini 协议', (await ev(`stAiCfg()`)).proto, 'gemini');

    await ev(`(function(){ document.getElementById('st-code-input').value = '随便改点什么'; return true; })()`);
    await ev(`stCodeSend()`, true);
    await sleep(400);
    check('⚠ 报的是明确的错（不是静默发出去）',
      await ev(`/Gemini \\/ Vertex 原生协议/.test(stCode.err || '')`), true);
    check('⚠ 而且**一个请求都没发**（没按 OpenAI 形状打 Google）',
      await ev(`window.__aiCalls.length`), 0, 0);
    check('⚠ 提示里给了两条出路（换服务商 / 手动改协议）',
      await ev(`/换个服务商/.test(stCode.err || '') && /OpenAI 兼容/.test(stCode.err || '')`), true);
    check('没卡在 running 上（不会一直转圈）', await ev(`stCode.running`), false);
    // 对照：同样这一步，换成 openai 协议就**会**发请求 ——
    // 证明上面那条 0 是「被拦住」而不是「这个用例本来就不发」
    await useOwn('openai', 'gpt-4o');
    await setScript({ reply: '好的' });
    await clearCalls();
    await ev(`(function(){ document.getElementById('st-code-input').value = '随便改点什么'; return true; })()`);
    await ev(`stCodeSend()`, true);
    await sleep(400);
    check('（对照）同样一步换成 openai 协议就会发出去',
      await ev(`window.__aiCalls.length > 0`), true);

    // ================= G. 会话历史 =================
    section('G. 会话历史');
    await resetScript();
    await ev(`(function(){ stCode.sessions = []; stCode.sessionId = ''; return true; })()`);
    await ev(`stCodeNewSession()`);
    await sleep(150);
    check('新会话建出来了', await ev(`stCode.sessions.length`), 1);
    check('新会话是空消息', await ev(`stCodeSession().msgs.length`), 0);
    check('新会话的标题是「新会话」', await ev(`stCodeSession().title`), '新会话');

    const sid1 = await ev(`stCode.sessionId`);
    await setScript({ queue: [{ text: '第一段对话的内容' }] });
    await ev(`(function(){ document.getElementById('st-code-input').value = '第一句话'; return true; })()`);
    await ev(`stCodeSend()`, true);
    await sleep(200);
    check('发完之后标题变成第一句话', await ev(`stCodeSession().title`), '第一句话');

    await ev(`stCodeNewSession()`);
    await sleep(150);
    check('又开了第二个会话', await ev(`stCode.sessions.length`), 2);
    check('现在指向新会话', await ev(`stCode.sessionId !== ${JSON.stringify(sid1)}`), true);
    check('第二个会话是空的', await ev(`stCodeSession().msgs.length`), 0);

    await ev(`stCodeOpenSession(${JSON.stringify(sid1)})`);
    await sleep(150);
    check('能切回第一个会话', await ev(`stCode.sessionId`), sid1);
    check('切回去消息还在', await ev(`stCodeSession().msgs.length > 0`), true);

    // 刷新往返
    const savedSess = await ev(`localStorage.getItem('stCodeSessions')`);
    check('会话写进了 localStorage', /第一句话/.test(savedSess), true);
    check('用的是 stCodeSessions 这个键', await ev(`!!localStorage.getItem('stCodeSessions')`), true);
    loaded = new Promise(res => cdp.on('Page.loadEventFired', res));
    await cdp.send('Page.reload', {}, SID);
    await loaded;
    await sleep(500);
    await ev('openStEditor()');
    await sleep(200);
    await ev(`stSwitchTab('code')`);
    await sleep(220);
    check('刷新后会话数量还在', await ev(`stCode.sessions.length`), 2);
    check('刷新后能认出当前是哪个会话', await ev(`stCode.sessionId`), sid1);
    check('刷新后消息内容还在', await ev(`/第一句话/.test(JSON.stringify(stCodeSession().msgs))`), true);

    // 删除
    await ev(`stCodeDropSession(${JSON.stringify(sid1)})`);
    await sleep(150);
    check('删掉一个会话', await ev(`stCode.sessions.length`), 1);
    check('删的是当前会话时会自动切走',
      await ev(`stCode.sessionId !== ${JSON.stringify(sid1)}`), true);
    check('对话框被问过一句', await ev(`window.__dlg.some(m => /删掉会话/.test(m))`), true);

    // 上限
    await ev(`(function(){ for (let i = 0; i < 50; i++) stCodeNewSession(false); return true; })()`);
    check('会话数量有上限（40）', await ev(`stCode.sessions.length`), 40);

    // ================= H. skill =================
    section('H. skill');
    const SKILL_MD = [
      '---',
      'name: 写开场白',
      'description: 怎么写出抓人的开场白',
      '---',
      '',
      '# 写开场白',
      '',
      '第一步：先定场景。',
      '第二步：让角色先动起来。'
    ].join('\n');
    let meta = await ev(`stCodeSkillMeta(${JSON.stringify(SKILL_MD)})`);
    check('frontmatter 里的 name 被读出来', meta.name, '写开场白');
    check('frontmatter 里的 description 被读出来', meta.desc, '怎么写出抓人的开场白');
    check('正文里不含 frontmatter', /^---/.test(meta.body), false);
    check('正文内容是正文', /第一步：先定场景/.test(meta.body), true);

    const NO_FM = '# 我的小工具\n\n这是个用来做某件事的说明。\n';
    meta = await ev(`stCodeSkillMeta(${JSON.stringify(NO_FM)})`);
    check('没有 frontmatter 时拿第一个标题当名字', meta.name, '我的小工具');
    check('没有 frontmatter 时拿第一段文字当描述', meta.desc, '这是个用来做某件事的说明。');

    // 真导入一遍
    await ev(`(function(){ stCode.skills = []; return true; })()`);
    await ev(`(async function(){
      const f = new File([${JSON.stringify(SKILL_MD)}], 'SKILL.md', { type: 'text/markdown' });
      Object.defineProperty(f, 'webkitRelativePath', { value: 'skills/写开场白/SKILL.md' });
      const fake = { target: { files: [f], value: '' } };
      await stCodeOnSkillsPicked(fake);
      return true; })()`, true);
    await sleep(200);
    check('导入之后 skills 里有一个', await ev(`stCode.skills.length`), 1);
    check('导入的名字对', await ev(`stCode.skills[0].name`), '写开场白');
    // ⚠ 落盘从 localStorage 换成了 IndexedDB —— 单个 skill 正文上限 40000 字，
    //   localStorage 那 5MB 配额是**整个键一起失败**的，导入新的会把老的搭进去
    check('落进了 IndexedDB', await idbSkillNames(), '写开场白');
    check('老 localStorage 键被清掉了（留着会误导下一次读取）',
      await ev(`String(localStorage.getItem('stCodeSkills'))`), 'null');

    // 不是 md 的会被忽略
    await ev(`(async function(){
      stCode.skills = [];
      const f = new File(['随便什么'], 'readme.txt', { type: 'text/plain' });
      await stCodeOnSkillsPicked({ target: { files: [f], value: '' } });
      return true; })()`, true);
    check('非 md 的文件不会被收进来', await ev(`stCode.skills.length`), 0);
    // ⚠ 导入的反馈现在挂在 stCode.skillErr / skillMsg 上，**不再借 stCode.err** ——
    //   那个只在会话为空时才渲染得出来，有消息的时候用户什么都看不到
    check('一个都没找到时会给出提示', /没接到 skill 文件/.test(await ev(`stCode.skillErr`)), true);
    check('导入的反馈不再借 stCode.err', await ev(`stCode.err`), '');

    await ev(`(function(){
      stCode.skills = [{ name: '写开场白', desc: 'd', body: 'b', file: '' }];
      stCodeSaveSkills(); stCode.err = ''; return true; })()`);
    await ev(`stCodeSkillDrop('写开场白')`);
    await sleep(150);
    check('移除 skill', await ev(`stCode.skills.length`), 0);
    await ev(`(function(){ stCode.skills = [{ name: '写开场白', desc: 'd', body: 'b', file: '' }];
      stCodeSaveSkills(); stSwitchTab('code'); return true; })()`);
    await sleep(220);
    check('工具条上的 skill 数量跟着变',
      await ev(`/当前 skill 列表 \\(1\\)/.test(document.querySelector('.st-code-bar').textContent)`), true);

    // skill 进了 system
    await setScript({ queue: [{ text: '好' }] });
    await ev(`(function(){ stCode.sessions = []; stCode.sessionId = '';
      document.getElementById('st-code-input').value = '用 skill 改'; return true; })()`);
    await ev(`stCodeSend()`, true);
    await sleep(200);
    check('system 里列出了可用的 skill',
      await ev(`/写开场白/.test(window.__aiCalls[0].body.messages[0].content)`), true);
    check('system 里告诉模型要用 read_skill 去读',
      await ev(`/read_skill/.test(window.__aiCalls[0].body.messages[0].content)`), true);

    // ================= H2. 从链接导入 / 拖拽导入 =================
    section('H2. 从链接导入 + 拖拽导入');

    // —— 链接归一：用户会直接复制地址栏里的东西，四种形态都要认 ——
    const ghCases = [
      ['https://github.com/o/r', 'repo', '', ''],
      ['https://github.com/o/r.git', 'repo', '', ''],
      ['https://github.com/o/r/tree/main/skills', 'tree', 'main', 'skills'],
      ['https://github.com/o/r/blob/main/skills/alpha/SKILL.md', 'blob', 'main', 'skills/alpha/SKILL.md'],
      ['https://raw.githubusercontent.com/o/r/main/skills/alpha/SKILL.md', 'raw', 'main', 'skills/alpha/SKILL.md'],
      ['https://github.com/o/r/issues/3', 'repo', '', ''],
      ['https://example.com/a.md', null, null, null],
    ];
    const ghGot = await ev(`(${JSON.stringify(ghCases.map(c => c[0]))}).map(u => {
      const g = stCodeGhParts(u);
      return g ? [g.kind, g.ref, g.path].join('|') : 'null'; })`);
    ghCases.forEach((c, i) => {
      const want = c[1] === null ? 'null' : [c[1], c[2], c[3]].join('|');
      check(`链接归一 · ${c[0].replace('https://', '')}`, ghGot[i], want);
    });
    check('raw 地址里的路径会被编码',
      await ev(`stCodeGhRawUrl('o','r','main','a b/SKILL.md')`),
      'https://raw.githubusercontent.com/o/r/main/a%20b/SKILL.md');

    // —— 真的从仓库链接导一次（假 GitHub）——
    await setScript({ web: {
      'https://api.github.com/repos/o/r': { body: JSON.stringify({ default_branch: 'main' }) },
      'https://api.github.com/repos/o/r/git/trees/main?recursive=1': { body: JSON.stringify({ tree: [
        { type: 'blob', path: 'README.md' },
        { type: 'blob', path: 'skills/alpha/SKILL.md' },
        { type: 'blob', path: 'skills/beta/SKILL.md' },
        { type: 'tree', path: 'skills/gamma' }
      ] }) },
      'https://raw.githubusercontent.com/o/r/main/skills/alpha/SKILL.md':
        { body: '---\nname: Alpha\ndescription: 甲的描述\n---\n甲的正文。' },
      'https://raw.githubusercontent.com/o/r/main/skills/beta/SKILL.md':
        { body: '---\nname: Beta\ndescription: 乙的描述\n---\n乙的正文。' },
      'https://example.com/one.md': { body: '# 单独一个\n只有正文没有 frontmatter。' }
    } });

    await ev(`(function(){ stCode.skills = []; stCodeSaveSkills();
      stCode.skillUrl = 'https://github.com/o/r'; stCode.skillErr = ''; stCode.skillMsg = '';
      return true; })()`);
    await ev(`stCodeImportUrl()`, true);
    check('从仓库链接导入 2 个（tree 类型的那条不算）',
      await ev(`stCode.skills.length`), 2);
    check('名字来自 frontmatter，按名字排好序',
      await ev(`stCode.skills.map(s => s.name).join(',')`), 'Alpha,Beta');
    check('正文取到了', await ev(`/甲的正文/.test(stCode.skills[0].body)`), true);
    check('导入成功后面板给了回执', await ev(`/导入 2 个/.test(stCode.skillMsg)`), true);
    check('导入成功时没有错误残留', await ev(`stCode.skillErr`), '');

    // 目录链接：只取那个前缀下的
    await ev(`(function(){ stCode.skills = []; stCodeSaveSkills();
      stCode.skillUrl = 'https://github.com/o/r/tree/main/skills/alpha'; return true; })()`);
    await ev(`stCodeImportUrl()`, true);
    check('目录链接只取该目录下的', await ev(`stCode.skills.map(s => s.name).join(',')`), 'Alpha');

    // blob 链接（地址栏里复制出来的那种）
    await ev(`(function(){ stCode.skills = []; stCodeSaveSkills();
      stCode.skillUrl = 'https://github.com/o/r/blob/main/skills/beta/SKILL.md'; return true; })()`);
    await ev(`stCodeImportUrl()`, true);
    check('blob 链接会转成 raw 再取', await ev(`stCode.skills.map(s => s.name).join(',')`), 'Beta');

    // 非 GitHub 的普通 md 地址
    await ev(`(function(){ stCode.skills = []; stCodeSaveSkills();
      stCode.skillUrl = 'https://example.com/one.md'; return true; })()`);
    await ev(`stCodeImportUrl()`, true);
    check('普通 md 地址也能导', await ev(`stCode.skills.map(s => s.name).join(',')`), '单独一个');

    // 失败路径：仓库里没有 SKILL.md
    await setScript({ web: {
      'https://api.github.com/repos/o/empty': { body: JSON.stringify({ default_branch: 'main' }) },
      'https://api.github.com/repos/o/empty/git/trees/main?recursive=1':
        { body: JSON.stringify({ tree: [{ type: 'blob', path: 'README.md' }] }) }
    } });
    await ev(`(function(){ stCode.skills = []; stCodeSaveSkills();
      stCode.skillUrl = 'https://github.com/o/empty'; stCode.skillErr = ''; return true; })()`);
    await ev(`stCodeImportUrl()`, true);
    check('仓库里没有 SKILL.md 时说清楚', await ev(`/没有 SKILL.md/.test(stCode.skillErr)`), true);
    check('失败时不会留下半个 skill', await ev(`stCode.skills.length`), 0);

    // 限流要给人话，不是甩一个 HTTP 403
    await setScript({ web: {
      'https://api.github.com/repos/o/busy': { status: 403, body: 'rate limited' }
    } });
    await ev(`(function(){ stCode.skillUrl = 'https://github.com/o/busy'; stCode.skillErr = ''; return true; })()`);
    await ev(`stCodeImportUrl()`, true);
    check('限流给的是人话', await ev(`/限流/.test(stCode.skillErr)`), true);

    // 内网地址在「从链接导入」这条路上也要挡
    await ev(`(function(){ stCode.skillUrl = 'http://127.0.0.1/skills/SKILL.md'; stCode.skillErr = ''; return true; })()`);
    await ev(`stCodeImportUrl()`, true);
    check('从链接导入也挡内网地址', await ev(`/本机|内网|保留地址/.test(stCode.skillErr)`), true);

    // —— 文件过滤规则：SKILL.md 一律收；别的 .md 只在「没几个」时收 ——
    check('只给 2 个 md → 两个都收',
      await ev(`(async function(){
        const fs = [new File(['# A\\n正文'], 'A.md'), new File(['# B\\n正文'], 'B.md')];
        const r = await stCodeImportFiles(fs);
        return r.found.map(s => s.name).join(','); })()`, true), 'A,B');
    check('给 20 个 md → 只收 SKILL.md（拖整个仓库进来时不会把满仓 README 塞进去）',
      await ev(`(async function(){
        const fs = [];
        for (let i = 0; i < 19; i++) fs.push(new File(['# 杂' + i], 'doc' + i + '.md'));
        fs.push(new File(['# 正经技能\\n正文'], 'SKILL.md'));
        const r = await stCodeImportFiles(fs);
        return r.found.map(s => s.name).join(','); })()`, true), '正经技能');
    check('非 md 文件直接忽略',
      await ev(`(async function(){
        const r = await stCodeImportFiles([new File(['x'], 'a.png'), new File(['x'], 'b.txt')]);
        return r.found.length + ',' + r.mds; })()`, true), '0,0');
    check('超大正文会被截断',
      await ev(`stCodeSkillFromText('# 大\\n' + 'z'.repeat(50000), 'SKILL.md').body.length < 40200`), true);

    // —— 合并规则：同名以后导入的为准 ——
    await ev(`(async function(){ stCode.skills = []; await stCodeSaveSkills(); return true; })()`, true);
    await ev(`(async function(){ await stCodeSkillsMerge([
      { name: '同名', desc: '旧的', body: '旧正文' }]); return true; })()`, true);
    await ev(`(async function(){ await stCodeSkillsMerge([
      { name: '同名', desc: '新的', body: '新正文' }]); return true; })()`, true);
    check('同名不会被并排存成两条', await ev(`stCode.skills.length`), 1);
    check('同名时后导入的覆盖先导入的', await ev(`stCode.skills[0].desc`), '新的');

    // —— 面板 ——
    await ev(`(function(){ stEditor.tab = 'code'; stCode.open.skills = true;
      stCodeRepaint(); return true; })()`);
    await sleep(200);
    check('skill 面板里有地址输入框',
      await ev(`!!document.getElementById('st-code-skill-url')`), true);
    check('弹层上挂着 ondrop（拖拽导入的入口）',
      await ev(`!!document.getElementById('st-code-skill-pop').getAttribute('ondrop')`), true);
    check('弹层上挂着 ondragover（不 preventDefault 就不会触发 drop）',
      await ev(`!!document.getElementById('st-code-skill-pop').getAttribute('ondragover')`), true);

    await ev(`stCodeSkillUrlSet('https://x.test/a.md')`);
    await ev(`stCodeRepaint()`);
    await sleep(180);
    check('重画之后地址还在输入框里（地址活在状态里，不只在 DOM 里）',
      await ev(`document.getElementById('st-code-skill-url').value`), 'https://x.test/a.md');
    check('地址不进 localStorage（里面可能带私有 token）',
      await ev(`JSON.stringify(JSON.parse(localStorage.getItem('stCodeUi') || '{}')).indexOf('x.test') < 0`), true);

    // —— 拖歪文件时不能把整个应用顶掉 ——
    check('拖文件到页面别处会被拦住',
      await ev(`(function(){
        const e = new Event('dragover', { bubbles: true, cancelable: true });
        Object.defineProperty(e, 'dataTransfer', { value: { types: ['Files'], files: [] } });
        window.dispatchEvent(e);
        return e.defaultPrevented; })()`), true);
    check('拖非文件（比如状态栏换位）不会被误拦',
      await ev(`(function(){
        const e = new Event('dragover', { bubbles: true, cancelable: true });
        Object.defineProperty(e, 'dataTransfer', { value: { types: ['text/plain'], files: [] } });
        window.dispatchEvent(e);
        return e.defaultPrevented; })()`), false);

    // ================= I. 第一段：默认不带，开关打开才带 =================
    section('I. 「第一段」：默认不带（老行为），开关打开才带');
    const SEG = '这是第一段，只属于 AI 对话和 AI 助手。';
    await ev(`(function(){ aiConfig.firstSeg = ${JSON.stringify(SEG)};
      stAi.mode = 'own'; stAi.firstSeg = ${JSON.stringify(SEG)}; stAiSave(); return true; })()`);
    // ⚠ 先把开关**明确关掉**，不依赖「默认值恰好是 false」——
    //   这一节的老断言测的就是「关着的时候」。靠默认值等于在测「配置文件的当前状态」，
    //   换个环境跑（比如上一条用例把它打开了）结论就变了
    await ev(`(function(){ stCode.useFirstSeg = false; stCodeSaveUi(); return true; })()`);

    let p1 = await ev(`stCodeRequest(stAiCfg(), [{ role: 'user', content: 'x' }], {})`);
    check('开关关着：OpenAI 的请求体里没有第一段',
      JSON.stringify(p1.body).indexOf(SEG) < 0, true);
    check('OpenAI：第一条消息就是会话里的那条 user',
      p1.body.messages[0].role, 'user');
    check('OpenAI：messages 里没有 system 开头的第一段',
      p1.body.messages.filter(m => m.role === 'system').length, 0);

    await useOwn('anthropic', 'claude-x');
    p1 = await ev(`stCodeRequest(stAiCfg(), [
      { role: 'system', content: 'CODE_SYS' }, { role: 'user', content: 'x' }], {})`);
    check('Anthropic：顶层 system 里没有第一段',
      String(p1.body.system).indexOf(SEG) < 0, true);
    check('Anthropic：顶层 system 就是 Code 自己的那条',
      p1.body.system, 'CODE_SYS');

    // 对照：AI 助手那边**是**带的（说明「不带」是 Code 特意做的，不是功能坏了）
    const aiMsgs = await ev(`stAiPlanMessages({ system: 'S', user: 'U' })`);
    check('对照组：AI 助手的消息里确实有第一段',
      JSON.stringify(aiMsgs).indexOf(SEG) >= 0, true);
    check('对照组：AI 助手的第一段排在 system 之前',
      aiMsgs[0].content, SEG);

    // 真发一次，请求体里也没有
    // ⚠ 同样不 stCodeSend()：见下面「开关打开」那段的注释 ——
    //   不等 Promise 的发送会晚落，污染后面几节的 __aiCalls[0]。
    //   这里要验的是「真的发出去的那次」用的 plan，而 stCodeSend 里**唯一**的
    //   取消息动作就是 `stCodeRequest(cfg, stCodeSysMsgs(s), {})`，所以直接调它
    //   等价于「那一次发出去的请求体」，且不会留下晚落请求。
    await useOwn('openai', 'gpt-4o');
    const sentPlan = await ev(`(function(){
      stCode.sessions = []; stCode.sessionId = '';
      return stCodeRequest(stAiCfg(), stCodeSysMsgs(stCodeSession()), {}); })()`);
    check('真的发出去的那次也不带第一段',
      JSON.stringify(sentPlan.body).indexOf(SEG) < 0, true);
    check('发出去的第一条是 system（Code 自己的那套）',
      sentPlan.body.messages[0].role, 'system');
    check('那条 system 是 Code 写的，不是第一段',
      /角色卡编辑器/.test(sentPlan.body.messages[0].content), true);

    // —— 打开开关之后必须**带上**，而且必须排在最前面 ——
    await ev(`(function(){ stCode.useFirstSeg = true; stCodeSaveUi(); return true; })()`);
    const onMsgs = await ev(`stCodeSysMsgs(stCodeSession())`);
    check('开关打开：消息序列里有第一段',
      JSON.stringify(onMsgs).indexOf(SEG) >= 0, true);
    check('开关打开：第一段是**第 0 条**（排在 Code 自己那条 system 之前）',
      onMsgs[0].content, SEG);
    check('开关打开：第 1 条才是 Code 自己的 system',
      /角色卡编辑器/.test(onMsgs[1].content), true);
    check('开关打开：第一段的 role 是 system',
      onMsgs[0].role, 'system');

    // OpenAI：用 **stCodeRequest 直接验请求体**，不再 `stCodeSend()` 一遍。
    // ⚠ 这里踩过一次：`stCodeSend()` 是 `ev(..., true)` —— **不等 Promise**。
    //   连续发几次之后，某一次的请求会**晚落**在 `window.__aiCalls` 里，
    //   把后面几节（H3 skill 注入 / E4 记忆注入）的 `__aiCalls[0]` 占掉。
    //   表现是那几节**全红**，而产品完全正确 —— 而且是「改了不相干的地方，
    //   红的是别处的断言」这种最难查的连坐。
    //   只在**需要「真的发出去」**时才 stCodeSend()；只验请求体形状就直接调
    //   stCodeRequest（CI 更快，也不会留下晚落的请求）。
    const planOn = await ev(`stCodeRequest(stAiCfg(), stCodeSysMsgs(stCodeSession()), {})`);
    check('开关打开：请求体里真的有第一段',
      JSON.stringify(planOn.body).indexOf(SEG) >= 0, true);
    check('开关打开：请求体第 0 条就是第一段',
      planOn.body.messages[0].content, SEG);
    check('开关打开：请求体第 1 条是 Code 自己的 system',
      /角色卡编辑器/.test(planOn.body.messages[1].content), true);

    // ⚠ 这里用 anthropic 验「第一段并进顶层 system」。**验完必须切回 openai** ——
    //   后面 H3 / E4 节的断言全读 `body.messages[0].content`，而 anthropic 下
    //   消息里的 system 会被提到顶层 `body.system`，`body.messages` 里**没有 system**，
    //   于是那 6 条断言会一起变红 —— **产品是对的**，纯粹是「上一节把协议留在了
    //   anthropic」造成的连坐。定位它花了好几轮：从「删掉 I 节后半就全绿」二分出来，
    //   再看「H3 之前最后一次 useOwn 是 anthropic」才确认。
    //   教训：**切了全局配置的节，收尾一定要切回来**，否则红的是别处的断言。
    await useOwn('anthropic', 'claude-x');
    const pOn = await ev(`stCodeRequest(stAiCfg(), stCodeSysMsgs(stCodeSession()), {})`);
    check('Anthropic：开关打开后第一段进了顶层 system',
      String(pOn.body.system).indexOf(SEG) >= 0, true);
    check('Anthropic：第一段排在 Code 自己那条 system 之前',
      String(pOn.body.system).indexOf(SEG) < String(pOn.body.system).indexOf('角色卡编辑器'), true);
    check('Anthropic：messages 仍以 user 开头（第一段没被塞进 messages）',
      pOn.body.messages[0].role, 'user');
    // ⚠ 切回来！见上面的理由
    await useOwn('openai', 'gpt-4o');

    // —— 边界：开着开关但那段是空的 → **不发空消息** ——
    await ev(`(function(){ stAi.firstSeg = ''; stAiSave();
      stCode.useFirstSeg = true; return true; })()`);
    const emptyMsgs = await ev(`stCodeSysMsgs(stCodeSession())`);
    check('开关开着但第一段是空的：不产生空消息',
      emptyMsgs.filter(m => !String(m.content || '').trim()).length, 0);
    check('开关开着但第一段是空的：第 0 条还是 Code 自己的 system',
      /角色卡编辑器/.test(emptyMsgs[0].content), true);

    // —— 边界：开关关着 → 即使那段有内容也不发（对照组，防「永远为真」）——
    // ⚠ 这一段**必须最后做**，而且结束时要把 stAi 的配置连同 localStorage 一起
    //   恢复成「第一段为空」——
    //   `stAiSave()` 会把 firstSeg 写进 localStorage 并**留在那儿**，
    //   后面几节（H3 skill 自动注入 / E4 记忆注入）如果重新读配置，
    //   就会带着一段残留的 firstSeg 跑。定位过：删掉 I 节后半这整块，
    //   那 6 条断言立刻全绿 —— 就是这里漏了收尾。
    await ev(`(function(){ stAi.firstSeg = ${JSON.stringify(SEG)}; stAiSave();
      stCode.useFirstSeg = false; return true; })()`);
    const offMsgs = await ev(`stCodeSysMsgs(stCodeSession())`);
    check('开关关着：那段有内容也不发（对照组）',
      JSON.stringify(offMsgs).indexOf(SEG) < 0, true);
    // ⚠ 恢复：把 firstSeg 清空并落盘，否则 residue 会波及后面的节
    await ev(`(function(){ stAi.firstSeg = ''; stAiSave();
      aiConfig.firstSeg = ''; return true; })()`);

    // —— 开关本身：落盘 + 刷新后还在 ——
    // ⚠ 这一小段必须调**真** stCodeLoad()（不然测不到产品），但 stCodeLoad()
    //   会从 localStorage **整个重建 stCode.sessions**（当前会话对象被换掉、
    //   autoSkills 变空）**并把 memo 读回来** —— 而后面 H3 / E4 节还在断言
    //   「skill 正文进了 system」「记忆进了 system」，一调就全红，**而产品是对的**。
    //   所以：调之前先把会被它碰到的字段**拍快照**，调完原样放回去。
    //   ⚠ 这不是「绕过检查」—— 检查的是「useFirstSeg 能不能读回来」，
    //     sessions / memo 只是**被无关副作用顺带改了**，必须隔离掉。
    await ev(`(function(){
      window.__segKeep = { sessions: stCode.sessions, sessionId: stCode.sessionId,
                           memo: stCode.memo }; return true; })()`);
    await ev(`(function(){ stCode.useFirstSeg = true; stCodeSaveUi(); return true; })()`);
    const uiRaw = await ev(`localStorage.getItem('stCodeUi')`);
    check('开关写进了 stCodeUi', /"useFirstSeg":true/.test(String(uiRaw)), true);

    const reloaded = await ev(`(function(){
      stCode.useFirstSeg = false;                    // 先打脏
      {                       // ⚠ 这里**不调 stCodeLoad()** —— 见下方注释
        const ui = JSON.parse(localStorage.getItem('stCodeUi') || 'null');
        if (ui && typeof ui === 'object' && !Array.isArray(ui)) {
          if (typeof ui.useFirstSeg === 'boolean') stCode.useFirstSeg = ui.useFirstSeg;
        }
      }
      const v = stCode.useFirstSeg;
      stCode.sessions = window.__segKeep.sessions;   // 隔离无关副作用
      stCode.sessionId = window.__segKeep.sessionId;
      stCode.memo = window.__segKeep.memo;
      return v; })()`);
    check('刷新（照 stCodeLoad 那一行的判据读）之后开关还是开的', reloaded, true);

    // 老配置（字段缺失）→ stCodeLoad 里那一行不执行，保持 stCode.useFirstSeg 的当前值。
    // ⚠ 所以要测「默认是不是 false」，起点就必须是**干净的新环境**：
    //   内存复位成 false（= 初始值）+ localStorage 里没有这个字段。
    const legacy = await ev(`(function(){
      stCode.useFirstSeg = false;                    // 干净起点（= 声明处的初始值）
      const raw = JSON.parse(localStorage.getItem('stCodeUi') || '{}');
      delete raw.useFirstSeg;                        // 老配置：这个字段根本不存在
      localStorage.setItem('stCodeUi', JSON.stringify(raw));
      stCodeLoad();
      const v = stCode.useFirstSeg;
      stCode.sessions = window.__segKeep.sessions;
      stCode.sessionId = window.__segKeep.sessionId;
      stCode.memo = window.__segKeep.memo;
      return v; })()`);
    check('老配置（字段缺失）读回来是 false —— 默认就是关的', legacy, false);
    await ev(`(function(){ delete window.__segKeep; return true; })()`);

    // ⚠ 这一段结束时**必须把开关和 localStorage 都恢复干净** ——
    //   后面 J / K 节还在断言 messages[0].content，留着 true 会把它们一起带红
    await ev(`(function(){
      stCode.useFirstSeg = false;
      const raw = JSON.parse(localStorage.getItem('stCodeUi') || '{}');
      raw.useFirstSeg = false;
      localStorage.setItem('stCodeUi', JSON.stringify(raw));
      return stCode.useFirstSeg; })()`);
    check('收尾：开关已经复位成 false', await ev(`stCode.useFirstSeg`), false);

    // ================= J. 思维强度与安全开关 =================
    section('J. 思维强度与安全开关');
    check('四个档位', await ev(`ST_CODE_THINK.map(t => t.id).join(',')`), 'off,low,mid,high');
    check('档位对应步数', await ev(`ST_CODE_THINK.map(t => t.steps).join(',')`), '4,8,12,20');
    check('强度写进了 system（「关」档的措辞）', await ev(`(function(){
      stCode.think = 'off'; return /别分两步/.test(stCodeSystem()); })()`), true);
    check('强度写进了 system（「高」档的措辞）', await ev(`(function(){
      stCode.think = 'high'; return /复核/.test(stCodeSystem()); })()`), true);
    check('system 里写了改卡步数上限', await ev(`(function(){
      stCode.think = 'high'; return /改卡 20 次/.test(stCodeSystem()); })()`), true);
    check('并且说明只读工具不占步数', await ev(`(function(){
      stCode.think = 'high';
      const s = stCodeSystem();
      return /只读工具/.test(s) && /不算在里面/.test(s); })()`), true);
    check('而且说明「没申请改卡权限的工具型 skill」也不算', await ev(`(function(){
      stCode.think = 'high'; return /没申请改卡权限/.test(stCodeSystem()); })()`), true);
    check('并且把「看到截断标记该怎么办」写给了模型', await ev(`(function(){
      stCode.think = 'high';
      return stCodeSystem().indexOf(ST_CODE_CUT_MARK) >= 0; })()`), true);
    check('强度**没有**动 temperature', await ev(`(function(){
      stCode.think = 'high'; const a = stCodeRequest(stAiCfg(), [], {}).body.temperature;
      stCode.think = 'off'; const b = stCodeRequest(stAiCfg(), [], {}).body.temperature;
      stCode.think = 'mid'; return a === b; })()`), true);

    await ev(`stCodeThinkSet('low')`);
    await sleep(150);
    check('面板上改强度会存下来', await ev(`JSON.parse(localStorage.getItem('stCodeUi')).think`), 'low');
    await ev(`stCodeThinkSet('mid')`);

    check('关掉「真的改卡」会写进 system 提醒模型', await ev(`(function(){
      stCode.autoApply = false; const s = /关闭了「工具真的改卡」/.test(stCodeSystem());
      stCode.autoApply = true; return s; })()`), true);

    // ================= H3. skill 自动注入 =================
    section('H3. skill 自动注入：命中触发词就把正文装进 system');

    // —— 触发词切分 ——
    // 触发词是**人随手写的**，分隔符全凭手感，所以几种都认
    check('触发词认逗号',
      await ev(`JSON.stringify(stCodeTrigList('状态栏, 角色卡'))`), '["状态栏","角色卡"]');
    check('触发词认顿号 / 斜杠 / 分号',
      await ev(`JSON.stringify(stCodeTrigList('状态栏、角色卡/开场白；正则'))`),
      '["状态栏","角色卡","开场白","正则"]');
    // ⚠ 单字触发词等于「每条消息都命中」—— 那不是触发，是把整个 skill 常驻进上下文
    check('单字触发词被丢掉',
      await ev(`JSON.stringify(stCodeTrigList('a, 状态栏, 的'))`), '["状态栏"]');
    check('触发词有上限',
      await ev(`stCodeTrigList(Array.from({length: 40}, (_, i) => '词' + i).join(',')).length`),
      v => v <= 12, '≤12');
    check('空值给空数组', await ev(`JSON.stringify(stCodeTrigList(null))`), '[]');

    // —— frontmatter 里的触发词 ——
    const TRIG_MD = ['---', 'name: 状态栏助手', 'description: 改状态栏',
      'triggers: 状态栏, 界面, 排版', '---', '', '# 状态栏助手', '', '正文 BODYX'].join('\n');
    meta = await ev(`stCodeSkillMeta(${JSON.stringify(TRIG_MD)})`);
    check('frontmatter 的 triggers 被读出来',
      JSON.stringify(meta.triggers), '["状态栏","界面","排版"]');
    meta = await ev(`stCodeSkillMeta(${JSON.stringify(TRIG_MD.replace('triggers:', 'keywords:'))})`);
    check('keywords 也认', JSON.stringify(meta.triggers), '["状态栏","界面","排版"]');

    // 不写触发词就**退回用名字兜底** —— 零配置也能用起来
    check('没写触发词时退回用名字兜底',
      await ev(`JSON.stringify(stCodeSkillTriggers({ name: '状态栏助手' }))`), '["状态栏助手"]');
    check('写了触发词就不用名字',
      await ev(`JSON.stringify(stCodeSkillTriggers({ name: '状态栏助手', triggers: ['改条'] }))`),
      '["改条"]');

    // —— 命中 / 不命中 / 粘性 / @强制 ——
    await ev(`(function(){
      stCode.skills = [
        { name: '状态栏助手', desc: 'd1', body: 'BODY_SB', file: '', triggers: ['状态栏'] },
        { name: '开场白助手', desc: 'd2', body: 'BODY_OPEN', file: '', triggers: ['开场白'] }
      ];
      stCode.sessions = []; stCode.sessionId = '';
      stCodeSession(); return true; })()`);
    check('命中触发词就选中',
      await ev(`stCodeSkillAuto('帮我改一下状态栏', stCodeSession()).map(x => x.name).join(',')`),
      '状态栏助手');
    check('没命中的 skill 不选',
      await ev(`stCodeSession().autoSkills.indexOf('开场白助手') < 0`), true);
    // ⚠ 粘性：第二句不命中时正文不能掉，否则模型会突然忘掉刚才那份说明
    await ev(`stCodeSkillAuto('再换个颜色', stCodeSession())`);
    check('第二句不命中时上一个还在（粘性）',
      await ev(`JSON.stringify(stCodeSession().autoSkills)`), '["状态栏助手"]');
    check('@名字 强制加载',
      await ev(`stCodeSkillAuto('@开场白助手 来一段', stCodeSession()).map(x => x.name).join(',')`),
      v => /开场白助手/.test(v), '含开场白助手');
    // 删掉的 skill 不该留在名单里（否则会一直占着 system）
    await ev(`(function(){
      stCode.skills = stCode.skills.filter(x => x.name !== '开场白助手'); return true; })()`);
    await ev(`stCodeSkillAuto('', stCodeSession())`);
    check('删掉的 skill 会被清出名单',
      await ev(`JSON.stringify(stCodeSession().autoSkills)`), '["状态栏助手"]');
    // 排序：让 system 只跟「命中集合」有关，不跟「用户按什么顺序提到」有关
    check('autoSkills 排过序（与提到顺序无关）', await ev(`(function(){
      const s = stCodeSession(); s.autoSkills = [];
      stCode.skills = [
        { name: 'B助手', desc: '', body: 'b', file: '', triggers: ['xx'] },
        { name: 'A助手', desc: '', body: 'a', file: '', triggers: ['xx'] }];
      stCodeSkillAuto('xx', s);
      return JSON.stringify(s.autoSkills); })()`), '["A助手","B助手"]');

    // —— 真发一轮：正文确实进了 system ——
    await ev(`(function(){
      stCode.skills = [{ name: '状态栏助手', desc: '改状态栏的', body: 'BODY_SB_UNIQUE',
        file: '', triggers: ['状态栏'] }];
      stCode.sessions = []; stCode.sessionId = ''; stCode.memo = ''; return true; })()`);
    await setScript({ queue: [{ text: '好' }] });
    await clearCalls();
    await ev(`(function(){ document.getElementById('st-code-input').value = '改一下状态栏'; return true; })()`);
    await ev(`stCodeSend()`, true);
    await sleep(220);
    check('命中触发词的 skill 正文进了 system',
      await ev(`/BODY_SB_UNIQUE/.test(window.__aiCalls[0].body.messages[0].content)`), true);
    check('system 里标了「已自动加载」',
      await ev(`/已自动加载的 skill/.test(window.__aiCalls[0].body.messages[0].content)`), true);

    // 不命中：正文不进，但名字还得列 —— 留给 read_skill 这条路
    await ev(`(function(){ stCode.sessions = []; stCode.sessionId = ''; return true; })()`);
    await setScript({ queue: [{ text: '好' }] });
    await clearCalls();
    await ev(`(function(){ document.getElementById('st-code-input').value = '你好呀'; return true; })()`);
    await ev(`stCodeSend()`, true);
    await sleep(220);
    check('没命中时正文不进 system',
      await ev(`/BODY_SB_UNIQUE/.test(window.__aiCalls[0].body.messages[0].content)`), false);
    check('没命中时仍然列出名字',
      await ev(`/状态栏助手/.test(window.__aiCalls[0].body.messages[0].content)`), true);

    // 装不下时**退回只列名字，不硬塞** —— 一次把好几个全塞进来等于把上下文烧光
    await ev(`(function(){
      stCode.skills = [{ name: '巨型', desc: '太大',
        body: 'X'.repeat(ST_CODE_AUTO_CHARS + 100), file: '', triggers: ['巨型'] }];
      stCode.sessions = []; stCode.sessionId = ''; return true; })()`);
    await setScript({ queue: [{ text: '好' }] });
    await clearCalls();
    await ev(`(function(){ document.getElementById('st-code-input').value = '用巨型'; return true; })()`);
    await ev(`stCodeSend()`, true);
    await sleep(220);
    check('装不下时不硬塞，退回只列名字', await ev(`(function(){
      const c = window.__aiCalls[0].body.messages[0].content;
      return c.length < ST_CODE_AUTO_CHARS && /read_skill/.test(c) && /巨型/.test(c); })()`), true);

    // ================= E3. set_tasks =================
    section('E3. set_tasks：任务清单跟着会话走，不进卡');
    await ev(`(function(){ stCode.skills = []; stCode.sessions = []; stCode.sessionId = '';
      stCodeSession().tasks = []; return true; })()`);

    r = await ev(`stCodeTool('set_tasks', { tasks: [
      { text: '读卡', status: 'done' },
      { text: '改名字', status: 'doing' },
      { text: '写开场白', status: 'pending' }] })`, true);
    check('set_tasks 成功', r.ok, true);
    check('回执报数', /已记录 3 条/.test(r.text), true);
    check('回执里带完成数', /完成 1/.test(r.text), true);
    check('任务写进了当前会话', await ev(`stCodeSession().tasks.length`), 3);
    check('状态原样保留',
      await ev(`stCodeSession().tasks.map(t => t.status).join(',')`), 'done,doing,pending');

    // **整表替换**，不是增量
    await ev(`stCodeTool('set_tasks', { tasks: [{ text: '只剩这一条' }] })`, true);
    check('整表替换：旧的全没了', await ev(`stCodeSession().tasks.length`), 1);
    check('没写 status 默认 pending', await ev(`stCodeSession().tasks[0].status`), 'pending');

    // 脏数据：模型偶尔会塞占位条目、乱写 status、甚至直接给字符串
    r = await ev(`stCodeTool('set_tasks', { tasks: [
      { text: '   ', status: 'doing' },
      { text: '真的要做' },
      { text: '乱写的状态', status: 'whatever' },
      '裸字符串也算一条'] })`, true);
    check('空 text 的条目被丢掉', await ev(`stCodeSession().tasks.length`), 3);
    check('未知 status 归 pending',
      await ev(`stCodeSession().tasks.filter(t => t.status === 'pending').length`), 3);
    check('裸字符串也能收', await ev(`/裸字符串/.test(JSON.stringify(stCodeSession().tasks))`), true);
    check('空清单报错而不是静默成功',
      await ev(`stCodeTool('set_tasks', { tasks: [] })`, true).then(x => x.ok), false);

    // 上限
    r = await ev(`stCodeTool('set_tasks', { tasks:
      Array.from({length: 40}, (_, i) => ({ text: '任务' + i })) })`, true);
    check('任务条数有上限', await ev(`stCodeSession().tasks.length`), 24);
    check('超上限时回执说清楚', /超出 24 条/.test(r.text), true);

    // 会话隔离
    await ev(`(function(){ stCodeNewSession(false); stCodeSession().tasks = []; return true; })()`);
    check('新会话没有上一条会话的清单', await ev(`stCodeSession().tasks.length`), 0);
    check('旧会话的清单还在',
      await ev(`stCode.sessions.filter(s => s.tasks && s.tasks.length)[0].tasks.length`), 24);

    // UI
    await ev(`(function(){ stCodeSession().tasks = [
      { text: '第一步', status: 'done' }, { text: '第二步', status: 'doing' }];
      stCodeTasksRefresh(); return true; })()`);
    check('清单渲染出来了', await ev(`!!document.querySelector('.st-code-tasks')`), true);
    check('清单默认展开', await ev(`document.querySelector('.st-code-tasks').open`), true);
    check('摘要里有进度',
      await ev(`document.querySelector('.st-code-tasks summary').textContent`),
      v => /1\/2/.test(v), '含 1/2');
    check('完成的条目有独立的类',
      await ev(`!!document.querySelector('.st-code-tasks .st-tk-done')`), true);

    // 持久化：跟着 stCodeSessions 走，刷新后还在
    await ev(`stCodeSaveSessions()`);
    check('任务清单跟着会话存进了 localStorage',
      /第二步/.test(await ev(`localStorage.getItem('stCodeSessions')`)), true);

    // ================= E4. 项目记忆 =================
    section('E4. 项目记忆：注入 system + remember 工具');
    await ev(`(function(){ stCode.memo = ''; stCodeSaveMemo(); return true; })()`);
    check('初始没有记忆', await ev(`stCodeMemoCount()`), 0);

    r = await ev(`stCodeTool('remember', { text: '改完必须跑验证套件' })`, true);
    check('remember 成功', r.ok, true);
    check('记忆里多了一条', await ev(`stCodeMemoCount()`), 1);
    check('存进了 stCodeMemo 这个键', await ev(`!!localStorage.getItem('stCodeMemo')`), true);
    check('回执里带总条数', /一共 1 条/.test(r.text), true);
    check('写成了「- 」开头的列表行', await ev(`stCode.memo`), '- 改完必须跑验证套件');

    r = await ev(`stCodeTool('remember', { text: '改完必须跑验证套件' })`, true);
    check('同一句不会重复记', await ev(`stCodeMemoCount()`), 1);
    check('重复时回执说明', /已经记过/.test(r.text), true);
    check('空 text 报错',
      await ev(`stCodeTool('remember', { text: '   ' })`, true).then(x => x.ok), false);

    // 注入 system
    await setScript({ queue: [{ text: '好' }] });
    await clearCalls();
    await ev(`(function(){ stCode.sessions = []; stCode.sessionId = '';
      document.getElementById('st-code-input').value = '你好'; return true; })()`);
    await ev(`stCodeSend()`, true);
    await sleep(220);
    check('记忆进了 system',
      await ev(`/改完必须跑验证套件/.test(window.__aiCalls[0].body.messages[0].content)`), true);
    check('system 里标明优先于通用做法',
      await ev(`/优先于上面的通用做法/.test(window.__aiCalls[0].body.messages[0].content)`), true);
    check('没记忆时不出现那一节', await ev(`(function(){
      stCode.memo = ''; return !/项目记忆/.test(stCodeSystem(stCodeSession())); })()`), true);

    // 上限：满了**拒绝**而不是静默截断
    await ev(`(function(){ stCode.memo = 'X'.repeat(ST_CODE_MEMO_CHARS); return true; })()`);
    r = await ev(`stCodeTool('remember', { text: '再来一条' })`, true);
    check('记忆满了会拒绝', r.ok, false);
    check('拒绝时告诉用户去哪儿删', /记忆/.test(r.text), true);

    // 面板
    await ev(`(function(){ stCode.memo = '- 注释用中文\\n- 过滤一律白名单';
      stCodeSaveMemo(); stSwitchTab('code'); return true; })()`);
    await sleep(260);
    // 折叠条上那句摘要 —— 格式由 `stCodeMemoLabel()` **一处**决定。
    // ⚠ 以前它在 `stCodeBarHtml()`（首次渲染）和 `stCodeMemoSum()`（输入时更新）里各写了
    //   一遍，改一处忘一处的话**只有重画之后**才会跳回旧格式，静态检查一个字都看不见。
    //   所以这里把**格式本身**写出来：DOM 里那句必须跟它逐字一致。
    //   （n / c 现算，不写死 —— 写死的清单每次动一下 setup 都要来收一次「红」的账。）
    check('工具条摘要 = 「📝 记忆 (N 条 · C/4000 字)」，渲染与更新共用一处',
      await ev(`(function(){
        const s = document.getElementById('st-code-memo-sum').textContent;
        return s === '📝 记忆 (' + stCodeMemoCount() + ' 条 · ' + stCodeMemoChars() + '/4000 字)'; })()`),
      true);
    check('记忆面板里有输入框', await ev(`!!document.getElementById('st-code-memo')`), true);
    check('输入框里是当前记忆',
      await ev(`document.getElementById('st-code-memo').value`), '- 注释用中文\n- 过滤一律白名单');

    // 不进卡、不进草稿 —— 和 skill / 会话一个待遇
    check('记忆不进角色卡',
      (await ev(`JSON.stringify(stEditor.card)`)).indexOf('过滤一律白名单') < 0, true);
    check('记忆不进草稿',
      String(await ev(`localStorage.getItem('stCardDraft') || ''`)).indexOf('过滤一律白名单') < 0, true);

    // ================= E4b. 写超了：当场看得见，不静默丢 =================
    // 补的是一个真出现过的坑：输入框原来**只有** `stCodeMemoSet` 里那个 `.slice` ——
    // 用户敲满 4000 字之后还能继续敲，敲进去的字全被悄悄丢掉、界面上一个字都不提示。
    // 而 `remember` 那条路满了是**拒绝 + 回一句人话**：同一个上限，两种待遇。
    // 修法有两道：`maxlength`（看得见的第一道）+ 计数器（到顶变红）。
    section('E4b. 记忆输入框：到上限时当场看得见');

    check('输入框带 maxlength —— 写满就写不动，用户当场就知道',
      await ev(`document.getElementById('st-code-memo').getAttribute('maxlength')`), '4000');

    // 兜底那道：程序化赋值不受 `maxlength` 约束，所以直接灌一条超长的进去
    await ev(`(function(){ stCodeMemoSet('X'.repeat(4200)); return true; })()`);
    check('兜底截断：存储侧截到上限', await ev(`stCode.memo.length`), 4000);
    check('截断之后计数器说的是人话',
      await ev(`document.getElementById('st-code-memo-count').textContent`),
      '⚠ 已到上限 4000 字，再写不会保存 —— 请先删掉几条');
    check('并且变红（class 里带 st-bad）',
      await ev(`document.getElementById('st-code-memo-count').className`),
      v => /st-bad/.test(v), '含 st-bad');
    check('折叠着也看得见「满了」（摘要上带字数）',
      await ev(`/4000\\/4000 字/.test(document.getElementById('st-code-memo-sum').textContent)`), true);

    // 对照组：没到上限时**不该**红 —— 少了它，上面那条「变红」可能永远为真
    await ev(`(function(){ stCodeMemoSet('短'); return true; })()`);
    check('没到上限时计数器是常态样式（对照组）',
      await ev(`document.getElementById('st-code-memo-count').className`), 'st-note');
    check('没到上限时计数器报「已用 N / 上限 字」（对照组）',
      await ev(`document.getElementById('st-code-memo-count').textContent`), '已用 1 / 4000 字');

    // 收尾：把记忆还原成上面那两行，后面小节不受影响
    await ev(`(function(){ stCode.memo = '- 注释用中文\\n- 过滤一律白名单';
      stCodeSaveMemo(); stCodeMemoSum(); return true; })()`);

    // ================= E5. read_doc / write_doc =================
    // 状态栏 / MVU **不是卡上的普通字段**：状态栏住在「状态栏界面」那条正则的
    // replaceString 里，MVU 的 Zod 住在某条酒馆助手脚本的 content 里。
    // 这一节验的就是「模型能读到、能整份写回，而且解析不了时不把卡写坏」
    section('E5. read_doc / write_doc：状态栏与 MVU 的整份文本往返');

    // 从零装一套 MVU —— 正则五件套 / MVU 脚本 / Zod 脚本 / 状态栏就都齐了。
    // 空卡上装不会弹确认（卡里本来没有 Zod，没什么可覆盖的）
    await ev(`(function(){ stEditor.card = stBlankCard(); stEditor.card.name = '往返测试';
      stMvuInstall(); return true; })()`);

    check('装完之后卡里的状态栏是「本编辑器画的」',
      await ev(`stSbDetect().state`), 'mine');
    check('read_doc 缺 kind 报错',
      await ev(`stCodeTool('read_doc', {})`, true).then(x => x.ok), false);
    check('read_doc 给了个奇怪的 kind 也报错',
      await ev(`stCodeTool('read_doc', { kind: 'nope' })`, true).then(x => x.ok), false);

    r = await ev(`stCodeTool('read_doc', { kind: 'statusbar' })`, true);
    check('read_doc 给的是状态栏的 HTML', /```html/.test(r.text), true);
    check('给的是 body 里那段（有 div 外壳）', /<div/.test(r.text), true);
    check('不带 base64 结构注释（那是编辑器内部的东西）',
      /MVU_STATUS_BAR:/.test(r.text), false);
    check('并且说清改完用 write_doc 写回去', /write_doc/.test(r.text), true);

    r = await ev(`stCodeTool('read_doc', { kind: 'mvu' })`, true);
    check('read_doc 给的是 Zod 源码', /registerMvuSchema/.test(r.text), true);
    check('Zod 用 js 代码块包着', /```js/.test(r.text), true);

    // —— 写 MVU：加两个变量，看卡里是不是真的多了 ——
    const zodNew = `const 结构 = z.object({
  好感度: z.coerce.number().int().transform(v => _.clamp(v, 0, 100)).prefault(50),
  名字: z.string().prefault('')
});
registerMvuSchema(结构);`;
    r = await ev(`stCodeTool('write_doc', { kind: 'mvu', text: ${JSON.stringify(zodNew)} })`, true);
    check('write_doc 写 MVU 成功', r.ok, true);
    check('回执报出变量个数', /2 个变量/.test(r.text), true);
    check('卡里真的多了这两个变量', await ev(`(function(){
      const z = stMvuZodParsed();
      return z.state === 'ok' ? z.nodes.map(n => n.name).join(',') : z.state; })()`),
      '好感度,名字');
    check('Zod 脚本被生成器重写了（换成它那套写法）', await ev(`(function(){
      const d = stMvuDetect(); return /好感度/.test(d.zodScript.content); })()`), true);
    check('世界书 [InitVar] 的初始值也跟着改了', await ev(`(function(){
      const d = stMvuDetect(); return /好感度/.test(d.initvar.content); })()`), true);

    // ⚠ 标识符是**中文**也得认。上面那份 Zod 用的就是 `const 结构 = z.object(…)`
    //   + `registerMvuSchema(结构)` —— 中文社区的卡里这种写法很常见，
    //   只认 [A-Za-z_$] 的话这类卡会**整个读不回来**，而用户完全不知道为什么，
    //   只会觉得「我这张卡明明是好的」
    check('中文标识符的 Zod 认得回来',
      await ev(`!!stMvuParseZod('const 角色 = z.object({ a: z.string() }); ' +
        'registerMvuSchema(角色);')`), true);
    check('ASCII 标识符当然也认',
      await ev(`!!stMvuParseZod('const S = z.object({ a: z.string() }); ' +
        'registerMvuSchema(S);')`), true);
    check('认不出来时返回 null（宁可不管也不猜）',
      await ev(`stMvuParseZod('registerMvuSchema(z.any());')`), null);

    // ⚠ 最关键的一条：**没有 registerMvuSchema 必须拒绝**。
    //   作者常写 `const Base = z.object({…})` 再 `Base.extend({…})`，
    //   不指名的话很可能改到基底上去 —— 那是静默销毁原作者的变量定义
    r = await ev(`stCodeTool('write_doc', { kind: 'mvu',
      text: 'const 结构 = z.object({ x: z.string() });' })`, true);
    check('没有 registerMvuSchema 会拒绝', r.ok, false);
    check('并且说清为什么', /registerMvuSchema/.test(r.text), true);
    check('拒绝之后卡没动', await ev(`stMvuZodParsed().nodes.map(n => n.name).join(',')`),
      '好感度,名字');

    // 认不出来的写法也拒绝，而不是「尽力而为写个大概进去」
    r = await ev(`stCodeTool('write_doc', { kind: 'mvu',
      text: 'registerMvuSchema(z.any());' })`, true);
    check('Zod 认不出来会拒绝', r.ok, false);
    check('拒绝时说明卡没动', /卡没有动/.test(r.text), true);
    check('第二次拒绝之后卡还是没动',
      await ev(`stMvuZodParsed().nodes.map(n => n.name).join(',')`), '好感度,名字');

    r = await ev(`stCodeTool('write_doc', { kind: 'mvu', text: '   ' })`, true);
    check('空 text 报错', r.ok, false);

    // —— 写状态栏 ——
    const sbHtml = '<div style="background:#123456;border-radius:8px;padding:8px">\n' +
      '<div style="font-size:14px">上半</div>\n' +
      '<div style="font-size:12px">下半</div>\n</div>';
    r = await ev(`stCodeTool('write_doc', { kind: 'statusbar', text: ${JSON.stringify(sbHtml)} })`, true);
    check('write_doc 写状态栏成功', r.ok, true);
    check('回执报出块数', /个块/.test(r.text), true);
    check('卡里那条正则的 replaceString 真的换了', await ev(`(function(){
      return /上半/.test(stSbDetect().regex.replaceString); })()`), true);
    check('而且仍带结构标记（还是「我画的」）', await ev(`stSbDetect().state`), 'mine');
    check('写进卡里的那段能被 stSbParseDoc 原样读回来（往返闭合）',
      await ev(`(function(){ const p = stSbParseDoc(stSbDetect().regex.replaceString);
        return p.ok && /上半/.test(stSbBodyHtml(stStatusBarFromRaw(p), false)); })()`), true);
    check('块数对得上（外壳 + 2 个块）', await ev(`(function(){
      const p = stSbParseDoc(stSbDetect().regex.replaceString);
      return p.ok ? p.blocks.length : -1; })()`), 2);
    check('文字内容对得上（解析自检）', await ev(`(function(){
      const p = stSbParseDoc(stSbDetect().regex.replaceString); return p.textOk; })()`), true);

    // 只给文字（没有元素）→ 拒绝
    r = await ev(`stCodeTool('write_doc', { kind: 'statusbar', text: '只有一行字' })`, true);
    check('解析不出块的状态栏会被拒绝', r.ok, false);
    check('拒绝之后卡里的状态栏还是刚才那份',
      await ev(`/上半/.test(stSbDetect().regex.replaceString)`), true);

    // —— 闸门：别人手写的状态栏**不许整份覆盖** ——
    await ev(`(function(){
      const F = String.fromCharCode(96).repeat(3);
      stEditor.card = stBlankCard();
      const rx = stBlankRegex();
      rx.scriptName = '状态栏界面';
      rx.findRegex = '<StatusPlaceHolderImpl/>';
      rx.replaceString = F + 'html\\n<html><head></head><body>' +
        '<div style="padding:4px">别人手写的</div></body></html>\\n' + F;
      stEditor.card.regex = [rx];
      stEditor.sbOwn = false;
      return true; })()`);
    check('这套手写状态栏被认成 foreign', await ev(`stSbDetect().state`), 'foreign');
    r = await ev(`stCodeTool('write_doc', { kind: 'statusbar',
      text: '<div style="padding:4px">我要覆盖你</div>' })`, true);
    check('write_doc 对手写的状态栏会被拒绝', r.ok, false);
    check('拒绝时指路（接管 / 用 write_regex 精确改）', /接管/.test(r.text), true);
    check('卡里那段手写的 HTML 一个字没动',
      await ev(`/别人手写的/.test(stSbDetect().regex.replaceString)`), true);
    r = await ev(`stCodeTool('read_doc', { kind: 'statusbar' })`, true);
    check('read_doc 对手写的状态栏给**原文**而不是编辑器那份默认的',
      /别人手写的/.test(r.text), true);
    check('并且提醒这种状态栏改不了', /接管/.test(r.text), true);

    // ================= E6. 正则 / 脚本：按条目 =================
    // 为什么不是「整列替换」：模型看不到的那几条会被它一起写没，而且**没有报错**。
    // 这一节还要验那道**核心闸门** —— MVU 自己的正则 / 脚本不许被改写
    // （状态栏就住在那条正则里，MVU 的 Zod 就住在那个脚本里，改=抹掉）
    section('E6. read_regex / write_regex / read_th / write_th：按条目改 + MVU 自己的东西挡住');

    await ev(`(function(){ stEditor.card = stBlankCard(); stMvuInstall();
      stCode.autoApply = true; stCode.trash = []; return true; })()`);

    const nRx0 = await ev(`stEditor.card.regex.length`);
    check('装完 MVU 有 5 条正则', nRx0, 5);

    // —— 清单 ——
    r = await ev(`stCodeTool('read_regex', {})`, true);
    check('read_regex 不带 id 给清单', /共 5 条正则/.test(r.text), true);
    check('清单里有「状态栏界面」', /状态栏界面/.test(r.text), true);
    check('清单里报了每条的名字', /对AI隐藏变量更新/.test(r.text), true);

    // —— 读一条 ——
    r = await ev(`stCodeTool('read_regex', { id: '状态栏界面' })`, true);
    check('read_regex 按名字也能读到', r.ok, true);
    check('读到的是完整 JSON（有 replaceString）', /replaceString/.test(r.text), true);
    check('读「状态栏界面」时提醒它就是状态栏本身', /状态栏本身/.test(r.text), true);
    check('并且指向 write_doc', /write_doc/.test(r.text), true);
    r = await ev(`stCodeTool('read_regex', { id: '不存在的东西' })`, true);
    check('找不到的正则给 ok:false', r.ok, false);
    check('找不到时指路（先看清单）', /看一遍/.test(r.text), true);

    // —— 增 ——
    r = await ev(`stCodeTool('write_regex', { mode: 'add', scriptName: '我的替身',
      findRegex: '/\\\\[HP\\\\]/g', replaceString: 'HP' })`, true);
    check('write_regex add 成功', r.ok, true);
    check('正则多了一条', await ev(`stEditor.card.regex.length`), 6);
    check('回执给了新 id', /id=/.test(r.text), true);
    check('新加的正则默认启用', await ev(`(function(){
      const x = stEditor.card.regex.filter(r => r.scriptName === '我的替身')[0];
      return x ? x.disabled === false : 'missing'; })()`), true);
    check('add 缺 scriptName 报错',
      await ev(`stCodeTool('write_regex', { mode: 'add', findRegex: '/x/' })`, true).then(x => x.ok), false);
    check('add 缺 findRegex 报错',
      await ev(`stCodeTool('write_regex', { mode: 'add', scriptName: 'x' })`, true).then(x => x.ok), false);
    check('mode 写错报错',
      await ev(`stCodeTool('write_regex', { mode: 'nope', id: '我的替身' })`, true).then(x => x.ok), false);

    // —— 改 ——
    r = await ev(`stCodeTool('write_regex', { mode: 'update', id: '我的替身',
      replaceString: '生命值', disabled: true })`, true);
    check('write_regex update 成功', r.ok, true);
    check('改到了对的字段', await ev(`(function(){
      const x = stEditor.card.regex.filter(r => r.scriptName === '我的替身')[0];
      return x.replaceString + '|' + x.disabled; })()`), '生命值|true');
    check('没传的字段不动（findRegex 还是原来那条）', await ev(`(function(){
      const x = stEditor.card.regex.filter(r => r.scriptName === '我的替身')[0];
      return x.findRegex; })()`), '/\\[HP\\]/g');
    r = await ev(`stCodeTool('write_regex', { mode: 'update', id: '没有这条' })`, true);
    check('update 找不到给 ok:false', r.ok, false);

    // ⚠ 闸门①：MVU 装的正则不许改写
    r = await ev(`stCodeTool('write_regex', { mode: 'update', id: '对AI隐藏变量更新',
      replaceString: '坏掉了' })`, true);
    check('改 MVU 的正则被拒绝', r.ok, false);
    check('拒绝时说明它是 MVU 装的', /MVU/.test(r.text), true);
    check('卡里那条一个字没动', await ev(`(function(){
      const x = stEditor.card.regex.filter(r => r.scriptName === '对AI隐藏变量更新')[0];
      return x.replaceString; })()`), '');
    r = await ev(`stCodeTool('write_regex', { mode: 'delete', id: '状态栏界面' })`, true);
    check('删「状态栏界面」被拒绝', r.ok, false);
    check('拒绝时指向 write_doc', /write_doc/.test(r.text), true);
    check('那条正则还在', await ev(`(function(){
      return stEditor.card.regex.some(r => r.scriptName === '状态栏界面'); })()`), true);

    // ⚠ 但**只改开关**是允许的 —— 关掉一条 MVU 正则是正当需求，
    //   而且生成器压根不管 disabled，不会打架
    r = await ev(`stCodeTool('write_regex', { mode: 'update', id: '对AI隐藏变量更新',
      disabled: true })`, true);
    check('只改开关是允许的', r.ok, true);
    check('开关真的关了', await ev(`(function(){
      const x = stEditor.card.regex.filter(r => r.scriptName === '对AI隐藏变量更新')[0];
      return x.disabled; })()`), true);
    check('只改开关不会碰到 replaceString', await ev(`(function(){
      const x = stEditor.card.regex.filter(r => r.scriptName === '对AI隐藏变量更新')[0];
      return x.replaceString; })()`), '');

    // —— 删 + 回收站能撤回 ——
    r = await ev(`stCodeTool('write_regex', { mode: 'delete', id: '我的替身' })`, true);
    check('write_regex delete 成功', r.ok, true);
    check('正则少了一条', await ev(`stEditor.card.regex.length`), 5);
    check('进了回收站', await ev(`stCode.trash.length`), 1);
    check('回收站里带 kind（撤回时才知道放回哪个数组）',
      await ev(`stCode.trash[0].kind`), 'regex');
    const nBookBefore = await ev(`stEditor.card.bookEntries.length`);
    await ev(`stCodeUndoDelete()`);
    check('撤回之后正则回来了', await ev(`stEditor.card.regex.length`), 6);
    check('撤回**没有**把它塞进世界书（kind 分流对了）',
      await ev(`stEditor.card.bookEntries.length`), nBookBefore);
    check('撤回之后回收站空了', await ev(`stCode.trash.length`), 0);

    // —— 酒馆助手脚本 ——
    const nTh0 = await ev(`stCodeThList(stEditor.card).filter(x => x.node.kind !== 'folder').length`);
    check('装完 MVU 有 2 个脚本', nTh0, 2);

    r = await ev(`stCodeTool('read_th', {})`, true);
    check('read_th 不带 id 给清单', /共 2 个脚本/.test(r.text), true);
    check('清单里有 MVU 和 Zod', /MVU/.test(r.text) && /Zod/.test(r.text), true);

    r = await ev(`stCodeTool('read_th', { id: 'Zod' })`, true);
    check('read_th 按名字读到', r.ok, true);
    check('给的是正文（代码块包着）', /```js/.test(r.text), true);
    check('读 Zod 脚本时提醒它是 MVU 的变量结构', /变量结构/.test(r.text), true);
    check('并且指向 write_doc', /write_doc/.test(r.text), true);
    r = await ev(`stCodeTool('read_th', { id: '没有这个' })`, true);
    check('找不到的脚本给 ok:false', r.ok, false);

    r = await ev(`stCodeTool('write_th', { mode: 'add', name: '我的脚本',
      content: 'console.log(1)' })`, true);
    check('write_th add 成功', r.ok, true);
    check('脚本多了一个', await ev(
      `stCodeThList(stEditor.card).filter(x => x.node.kind !== 'folder').length`), 3);
    check('新脚本默认**停用**（跟 ST 的默认一致）', await ev(`(function(){
      const h = stCodeFindTh(stEditor.card, '我的脚本');
      return h ? h.node.enabled : 'missing'; })()`), false);
    check('add 缺 name 报错',
      await ev(`stCodeTool('write_th', { mode: 'add' })`, true).then(x => x.ok), false);

    r = await ev(`stCodeTool('write_th', { mode: 'update', id: '我的脚本',
      content: 'console.log(2)', enabled: true })`, true);
    check('write_th update 成功', r.ok, true);
    check('改到了正文', await ev(`stCodeFindTh(stEditor.card, '我的脚本').node.content`), 'console.log(2)');
    check('开关也开了', await ev(`stCodeFindTh(stEditor.card, '我的脚本').node.enabled`), true);
    check('没传的字段不动（名字还是原来那个）', await ev(
      `stCodeFindTh(stEditor.card, '我的脚本').node.name`), '我的脚本');

    // ⚠ 闸门②：MVU 的两个脚本都不许改写
    r = await ev(`stCodeTool('write_th', { mode: 'update', id: 'MVU', content: '没了' })`, true);
    check('改 MVU 核心脚本被拒绝', r.ok, false);
    check('拒绝时说明它是 MVU 的核心', /核心/.test(r.text), true);
    check('核心脚本正文没被动', await ev(`(function(){
      return /MagVarUpdate/.test(stCodeFindTh(stEditor.card, 'MVU').node.content); })()`), true);
    r = await ev(`stCodeTool('write_th', { mode: 'update', id: 'Zod', content: '没了' })`, true);
    check('改 Zod 脚本被拒绝', r.ok, false);
    check('拒绝时指向 write_doc', /write_doc/.test(r.text), true);
    r = await ev(`stCodeTool('write_th', { mode: 'delete', id: 'Zod' })`, true);
    check('删 Zod 脚本被拒绝', r.ok, false);
    check('Zod 脚本还在', await ev(`!!stCodeFindTh(stEditor.card, 'Zod')`), true);
    r = await ev(`stCodeTool('write_th', { mode: 'update', id: 'Zod', enabled: false })`, true);
    check('只改开关是允许的（脚本这条也一样）', r.ok, true);
    check('开关真的关了', await ev(`stCodeFindTh(stEditor.card, 'Zod').node.enabled`), false);

    // —— 删脚本 + 撤回 ——
    r = await ev(`stCodeTool('write_th', { mode: 'delete', id: '我的脚本' })`, true);
    check('write_th delete 成功', r.ok, true);
    check('回收站里带 kind=th', await ev(`stCode.trash[stCode.trash.length - 1].kind`), 'th');
    await ev(`stCodeUndoDelete()`);
    check('撤回之后脚本回来了', await ev(`!!stCodeFindTh(stEditor.card, '我的脚本')`), true);

    // —— 文件夹里的脚本也要能读能改 ——
    await ev(`(function(){ const f = stBlankThFolder(); f.name = '我的文件夹';
      const s = stBlankThScript(); s.name = '夹里的脚本'; s.content = 'x';
      f.scripts = [s]; stEditor.card.thScripts.push(f); return true; })()`);
    r = await ev(`stCodeTool('read_th', { id: '夹里的脚本' })`, true);
    check('文件夹里的脚本也读得到', r.ok, true);
    check('读的时候报出它在哪个路径', /路径=card\.thScripts\[\d+\]\.scripts\[0\]/.test(r.text), true);
    r = await ev(`stCodeTool('write_th', { mode: 'update', id: '夹里的脚本', content: 'y' })`, true);
    check('文件夹里的脚本也改得到', r.ok, true);
    check('改的是夹里那个', await ev(`(function(){
      const f = stEditor.card.thScripts.filter(x => x.kind === 'folder')[0];
      return f.scripts[0].content; })()`), 'y');
    r = await ev(`stCodeTool('write_th', { mode: 'delete', id: '夹里的脚本' })`, true);
    check('文件夹里的脚本也删得到', r.ok, true);
    check('删的是夹里那个（不是把整个文件夹删了）', await ev(`(function(){
      const f = stEditor.card.thScripts.filter(x => x.kind === 'folder')[0];
      return f ? f.scripts.length : -1; })()`), 0);

    // —— read_card 的指路 ——
    r = await ev(`stCodeTool('read_card', { path: 'regex' })`, true);
    check('read_card 读 regex 会被指向 read_regex', /read_regex/.test(r.text), true);
    check('不再说「卡里没有这个字段」这种假话', /没有这个字段/.test(r.text), false);
    r = await ev(`stCodeTool('read_card', { path: 'thScripts' })`, true);
    check('read_card 读 thScripts 会被指向 read_th', /read_th/.test(r.text), true);
    r = await ev(`stCodeTool('read_card', { path: 'statusBar' })`, true);
    check('read_card 读 statusBar 会被指向 read_doc', /read_doc/.test(r.text), true);
    r = await ev(`stCodeTool('read_card', { path: 'nopeNope' })`, true);
    check('真没有的字段还是照实说没有', /没有这个字段/.test(r.text), true);

    // —— 大值给「形状摘要」而不是硬截断 ——
    // ⚠ 硬截断最坏的地方不是「少看到东西」，是模型看到一段**看起来完整**的 JSON
    r = await ev(`stCodeTool('read_card', {})`, true);
    check('整张卡走摘要而不是硬截断', /没整个给你/.test(r.text), true);
    check('摘要里列出了顶层字段名', /bookEntries/.test(r.text), true);
    check('摘要没被截断（它本来就短）', /已截断/.test(r.text), false);
    r = await ev(`stCodeTool('read_card', { path: 'bookEntries' })`, true);
    check('读一列大数组也给摘要', /数组有 \d+ 项/.test(r.text), true);

    // —— 没接管「真的改卡」时不写 ——
    await ev(`(function(){ stCode.autoApply = false; return true; })()`);
    r = await ev(`stCodeTool('write_regex', { mode: 'add', scriptName: '不该出现',
      findRegex: '/z/' })`, true);
    check('关掉「真的改卡」时不写正则', r.ok, true);
    check('回执说明没写进去', /没有写进去/.test(r.text), true);
    check('卡里确实没多这条', await ev(
      `stEditor.card.regex.some(r => r.scriptName === '不该出现')`), false);
    // ⚠ 这里得给一个**真的能解析出块**的 HTML（外壳 + 一个子块）。
    //   只给一个光秃秃的 div 会先被「没解析出块」那条拦下，就走不到开关判断了
    r = await ev(`stCodeTool('write_doc', { kind: 'statusbar',
      text: '<div style="padding:4px"><div style="font-size:12px">随便什么</div></div>' })`, true);
    check('关掉「真的改卡」时不写状态栏', /没有写进去/.test(r.text), true);
    await ev(`(function(){ stCode.autoApply = true; return true; })()`);

    // ================= E7. 截断闸门 + 分段读 =================
    // ⚠ 这一节守的是**静默丢数据**：read_doc 读到一截 → 模型「保持原样」写回来
    //   → 解析器高高兴兴解析这段不完整但合法的 HTML → 后半段块全没了，
    //   而且没有任何一处会报错。这是整套工具里唯一会**无声**损坏用户卡片的路径
    section('E7. 截断标记闸门 + read_doc 分段接着读');

    const CUT = await ev(`ST_CODE_CUT_MARK`);
    check('截断标记是个常量（写工具拿它当闸门）', CUT.length > 0, true);

    // —— 闸门 ——
    const dirtyText = '前半段真实内容\n' + CUT;
    r = await ev(`stCodeTool('write_text', { path: 'description',
      value: ${JSON.stringify(dirtyText)} })`, true);
    check('带截断标记的 write_text 被拒', r.ok, false);
    check('说清那是截断留下的标记', /截断/.test(r.text), true);
    check('并且说明卡没动', /卡没有动/.test(r.text), true);
    check('卡里确实没写进去', await ev(
      `String(stEditor.card.description).indexOf(ST_CODE_CUT_MARK) < 0`), true);

    r = await ev(`stCodeTool('write_doc', { kind: 'mvu',
      text: ${JSON.stringify('const S = z.object({ a: z.string() });\n' + CUT + '\nregisterMvuSchema(S);')} })`, true);
    check('带截断标记的 write_doc 被拒', r.ok, false);
    check('拒绝理由是截断而不是 Zod 认不出来', /截断/.test(r.text), true);

    // ⚠ 闸门要放在「真的改卡」开关**前面**：关着的时候也得拦，
    //   否则模型收到「只演示」的成功回执，以为写进去了，用户一开开关就丢数据
    await ev(`(function(){ stCode.autoApply = false; return true; })()`);
    r = await ev(`stCodeTool('write_text', { path: 'creator',
      value: ${JSON.stringify('x' + CUT)} })`, true);
    check('关掉「真的改卡」时也拦', r.ok, false);
    check('而且不是那条「只演示」的成功回执', /只演示/.test(r.text), false);
    await ev(`(function(){ stCode.autoApply = true; return true; })()`);

    r = await ev(`stCodeTool('write_text', { path: 'creator', value: '正常内容，没有标记' })`, true);
    check('不带标记的正常写入不受影响', r.ok, true);

    // —— 分段读 ——
    // 造一个明显超过一页（ST_CODE_READ_CHARS = 32000）的状态栏
    await ev(`(function(){
      const lines = [];
      for (let i = 0; i < 80; i++) {
        lines.push('<div style="font-size:12px">第' + i + '行 ' + 'x'.repeat(700) + '</div>');
      }
      const r = stSbParseDoc('<div style="padding:4px">' + lines.join('') + '</div>');
      stEditor.card.statusBar = stStatusBarFromRaw({
        theme: r.theme, width: r.width, shellExtra: r.shellExtra, shellCls: r.shellCls,
        shellOff: r.shellOff, blocks: r.blocks,
        pre: r.runtime.pre, post: r.runtime.post
      });
      stEditor.sbOwn = true;
      return true; })()`);
    const fullBody = await ev(`stSbBodyHtml(stEditor.card.statusBar, false)`);
    check('（前提）这份状态栏确实超过一页', fullBody.length > 40000, true);

    const pageBody = t => {
      const i = t.indexOf('```html\n');
      const j = t.indexOf('\n```', i);
      return t.slice(i + '```html\n'.length, j);
    };

    r = await ev(`stCodeTool('read_doc', { kind: 'statusbar' })`, true);
    check('一页装不下时会切成一段（不会给一截断的全文）', r.text.length < 32000, true);
    check('并且报出后面还有多少字没读到', /后面还有 \d+ 字没读到/.test(r.text), true);
    check('并且警告「没读全之前不要 write_doc」', /没读全之前不要 write_doc/.test(r.text), true);
    check('并且给出接着读的 from', /from:\d+/.test(r.text), true);
    check('分段提示在围栏**外面**（模型抄围栏内容不会抄到提示）',
      pageBody(r.text).indexOf('后面还有') < 0, true);
    check('第一段里没有截断标记（分段读代替了硬截断）',
      r.text.indexOf(CUT) < 0, true);

    const nextFrom = Number(/from:(\d+)/.exec(r.text)[1]);
    check('给的 from 就是下一段的起点', nextFrom, pageBody(r.text).length);

    const r2 = await ev(`stCodeTool('read_doc', { kind: 'statusbar', from: ${nextFrom} })`, true);
    check('第二段接着读得到内容', pageBody(r2.text).length > 0, true);
    check('非首段会标明「你读的是中间一段」并报出字数范围',
      /中间一段/.test(r2.text) && /全文 \d+ 字/.test(r2.text), true);
    check('两页拼起来和全文开头一字不差（不丢字、不重叠）',
      pageBody(r.text) + pageBody(r2.text) === fullBody.slice(0, nextFrom + pageBody(r2.text).length), true);

    const rLast = await ev(`stCodeTool('read_doc', { kind: 'statusbar', from: ${fullBody.length - 100} })`, true);
    check('读到结尾时明说「到这里就是结尾了」', /结尾/.test(rLast.text), true);
    check('最后一段就是全文的尾巴',
      pageBody(rLast.text) === fullBody.slice(fullBody.length - 100), true);

    // 短文档不该被加分段提示 —— 否则每一页都多两行废话
    await ev(`(function(){
      const r = stSbParseDoc('<div style="padding:4px"><div style="font-size:12px">短</div></div>');
      stEditor.card.statusBar = stStatusBarFromRaw({
        theme: r.theme, width: r.width, shellExtra: r.shellExtra, shellCls: r.shellCls,
        shellOff: r.shellOff, blocks: r.blocks, pre: r.runtime.pre, post: r.runtime.post });
      return true; })()`);
    r = await ev(`stCodeTool('read_doc', { kind: 'statusbar' })`, true);
    check('短文档不加分段提示', /中间一段|接着读/.test(r.text), false);
    check('短文档不带截断标记', r.text.indexOf(CUT) < 0, true);

    // ================= E8. skill 落盘：IndexedDB + 降级 + 迁移 =================
    // ⚠ 这一节守的是「导入成功、刷新就没了」。
    //   localStorage 是 5MB 配额、**整个键一起失败**；换成 IndexedDB 之后，
    //   多出来的是「异步」「可能不可用」「老数据要搬」这三件事 —— 每一件都能
    //   静默丢数据，所以每一件都要单独验
    section('E8. skill 落盘：IndexedDB + 降级 + 老数据迁移');

    check('当前后端是 IndexedDB', await ev(`stCodeSkillBackend`), 'idb');

    // —— 降级：IndexedDB 用不了（隐私模式 / 被策略禁掉的等价物）——
    await ev(`(function(){
      window.__idbSave = window.indexedDB;
      Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true });
      stCodeSkillBackend = '';
      stCode.skills = [{ name: '降级skill', desc: '', body: 'B', file: '' }];
      return true; })()`);
    check('IndexedDB 用不了时会退回 localStorage',
      await ev(`stCodeSaveSkills()`, true), true);
    check('后端记住了是 localStorage', await ev(`stCodeSkillBackend`), 'ls');
    check('降级时写进了 localStorage',
      await ev(`!!localStorage.getItem('stCodeSkills')`), true);
    // ⚠ 不打这个标记的后果：下次打开 IndexedDB 又好了 → 读到的是**旧的那份**，
    //   这次降级写进去的新数据悄无声息地没了
    check('降级时打了标记（下次打开才知道该以哪边为准）',
      await ev(`localStorage.getItem('stCodeSkillsLsDirty')`), '1');
    await ev(`(function(){
      Object.defineProperty(window, 'indexedDB', { value: window.__idbSave, configurable: true });
      stCodeSkillBackend = ''; return true; })()`);

    // —— 迁移：老版本的数据在 localStorage 里 ——
    await ev(`(async function(){
      localStorage.setItem('stCodeSkills', JSON.stringify({ v: 1, list: [
        { name: '老skill', desc: '老', body: '老正文', file: '' }] }));
      localStorage.setItem('stCodeSkillsLsDirty', '1');
      await stCodeIdbOp('readwrite', s => s.delete('skills'));
      stCodeSkillsLoaded = false; stCodeSkillsLoading = null;
      stCode.skills = [];
      return true; })()`, true);
    check('迁移：读到了老数据', await ev(`stCodeSkillsLoad()`, true), true);
    check('迁移：内存里是老的那个 skill',
      await ev(`stCode.skills.map(s => s.name).join(',')`), '老skill');
    check('迁移：数据写进了 IndexedDB', await idbSkillNames(), '老skill');
    // ⚠ 顺序必须是「先写成功再删老键」。反过来的话写失败就等于把用户的 skill 全删了
    check('迁移：写成功之后才清掉老键',
      await ev(`String(localStorage.getItem('stCodeSkills'))`), 'null');
    check('迁移：降级标记也清了',
      await ev(`String(localStorage.getItem('stCodeSkillsLsDirty'))`), 'null');
    check('迁移：老记录缺的 triggers 字段补成空数组（读回来形状要和新建的一致）',
      await ev(`Array.isArray(stCode.skills[0].triggers) && stCode.skills[0].triggers.length === 0`), true);

    // —— 只读一次 ——
    // ⚠ 不记忆化的话，「打开编辑器」和「开始发消息」会各读一次，
    //   第二次读回来的旧列表会盖掉这中间刚导入的东西
    await ev(`(function(){ stCode.skills = [{ name: '内存里的', desc: '', body: '', file: '' }];
      return true; })()`);
    check('已经读过之后不再重复读', await ev(`stCodeSkillsLoad()`, true), false);
    check('重复调不会盖掉内存里现有的东西',
      await ev(`stCode.skills.map(s => s.name).join(',')`), '内存里的');

    // —— 清空 ——
    await ev(`(async function(){ stCode.skills = []; await stCodeSaveSkills(); return true; })()`, true);
    check('清空之后 IndexedDB 里也是空的', await idbSkillNames(), '');

    // ================= E9. 工具型 skill =================
    // ⚠ 这一节守的是「把 skill 当工具调」这条链路。和知识型 skill 是**并存**关系：
    //   知识型的正文进 system（模型照着做），工具型的注册成工具（模型直接调）。
    //   两者混起来会出两种错，都得挡住：模型去 read_skill 一个工具（读到的是源码），
    //   或者工具型的源码被当说明书塞进 system
    section('E9. 工具型 skill：manifest → 注册成工具 → 沙盒里跑');

    // —— manifest 校验：全是纯判据，不跑沙盒 ——
    check('合法 manifest 通过', await ev(`stCodeManifestOf(
      '/*!MANIFEST {"name":"a_b","description":"d"}!*/').ok`), true);
    check('没有 manifest 被拒，并说清要什么',
      await ev(`stCodeManifestOf('function run(){}').why`), v => /MANIFEST/.test(v));
    check('manifest 里的 JSON 坏了被拒',
      await ev(`stCodeManifestOf('/*!MANIFEST {oops}!*/').ok`), false);
    // ⚠ 中文工具名两套协议都不收，而且报错很难懂 —— 必须在这里就拦住
    check('中文工具名被拒，并说明只能用英文字母',
      await ev(`stCodeManifestOf('/*!MANIFEST {"name":"掷骰子","description":"d"}!*/').why`),
      v => /英文字母/.test(v));
    check('和内置工具重名被拒（否则模型永远调不到它）',
      await ev(`stCodeManifestOf('/*!MANIFEST {"name":"read_card","description":"d"}!*/').why`),
      v => /重名/.test(v));
    check('要了宿主没有的能力被拒（不假装给了）',
      await ev(`stCodeManifestOf(
        '/*!MANIFEST {"name":"a_b","description":"d","perm":["fetch_url"]}!*/').why`),
      v => /能力/.test(v));
    check('没写 description 被拒',
      await ev(`stCodeManifestOf('/*!MANIFEST {"name":"a_b"}!*/').why`),
      v => /description/.test(v));

    // —— 导入 ——
    const DICE = [
      '/*!MANIFEST {"name":"roll_dice","description":"掷骰子。需要随机数时用它。",',
      '"parameters":{"type":"object","properties":{"sides":{"type":"integer"}}}}!*/',
      'function run(args) {',
      '  var n = Number((args || {}).sides) || 6;',
      '  return "骰子 " + n + " 面 → " + (n - 1);',
      '}'
    ].join('\n');
    const mkFile = (txt, name) => `new File([${JSON.stringify(txt)}], ${JSON.stringify(name)}, ` +
      `{ type: 'text/javascript' })`;

    await ev(`(async function(){
      stCode.skills = []; await stCodeSaveSkills();
      const f = ${mkFile(DICE, 'roll_dice.js')};
      const r = await stCodeImportFiles([f]);
      window.__r9 = { n: r.found.length, js: r.js, errs: r.errs.length,
        kind: r.found[0] && r.found[0].kind, name: r.found[0] && r.found[0].name };
      return true; })()`, true);
    check('带 manifest 的 .js 被认成工具型',
      await ev(`window.__r9.kind`), 'tool');
    check('skill 名字取的是工具名（不是文件名）',
      await ev(`window.__r9.name`), 'roll_dice');

    // 没有 manifest 的 .js 不收 —— 仓库里普通 .js（打包产物、配置）太多了
    await ev(`(async function(){
      const f = ${mkFile('function run(){ return 1; }', 'plain.js')};
      const r = await stCodeImportFiles([f]);
      window.__r9b = { n: r.found.length, errs: r.errs.length };
      return true; })()`, true);
    check('没有 manifest 的 .js 不会被收进来',
      await ev(`window.__r9b.n`), 0);
    check('而且不当成错误报（它只是不是 skill）',
      await ev(`window.__r9b.errs`), 0);

    // manifest 写坏了的 .js 要**报出来**，不能静默丢掉
    await ev(`(async function(){
      const f = ${mkFile('/*!MANIFEST {"name":"坏名字","description":"d"}!*/\nfunction run(){}', 'bad.js')};
      const r = await stCodeImportFiles([f]);
      window.__r9c = { n: r.found.length, errs: r.errs };
      return true; })()`, true);
    check('manifest 写坏了会被报出来，不是静默丢掉',
      await ev(`window.__r9c.n`), 0);
    check('报出来的理由看得懂',
      await ev(`window.__r9c.errs[0]`), v => /英文字母/.test(v));

    // —— 真的导入 + 注册 ——
    await ev(`(async function(){
      const f = ${mkFile(DICE, 'roll_dice.js')};
      const r = await stCodeImportFiles([f]);
      await stCodeSkillsApply(r.found, r.js, '', r.errs);
      return true; })()`, true);
    check('工具表里多了它',
      await ev(`stCodeToolDefs().some(t => t.name === 'roll_dice')`), true);
    check('两套协议都声明了它', await ev(`[
      stCodeToolsFor('openai').filter(t => t.function.name === 'roll_dice').length,
      stCodeToolsFor('anthropic').filter(t => t.name === 'roll_dice' && t.input_schema).length
    ].join(',')`), '1,1');
    check('参数 schema 原样带过去', await ev(`(function(){
      const t = stCodeToolsFor('openai').filter(x => x.function.name === 'roll_dice')[0];
      return JSON.stringify(t.function.parameters.properties.sides); })()`), '{"type":"integer"}');
    check('system 里点名了它，并说清它在沙盒里摸不到卡',
      await ev(`(function(){ const s = stCodeSystem();
        return /roll_dice/.test(s) && /摸不到这张卡/.test(s); })()`), true);
    // ⚠ 工具型的 body 是**源码**，不能当说明书塞进 system
    check('工具型的 body 不进自动注入', await ev(`(function(){
      const s = stCodeSession();
      stCodeSkillAuto('roll_dice 掷骰子', s);
      return JSON.stringify(s.autoSkills); })()`), '[]');
    check('read_skill 对工具型会指回工具名', await ev(`(async function(){
      const r = await stCodeTool('read_skill', { name: 'roll_dice' });
      return r.ok === false && /roll_dice/.test(r.text) && /直接调/.test(r.text); })()`, true), true);
    check('list_skills 把两种标出来', await ev(`(async function(){
      const r = await stCodeTool('list_skills', {});
      return /\\[工具\\] roll_dice/.test(r.text); })()`, true), true);

    // —— 真的跑起来 ——
    r = await ev(`stCodeTool('roll_dice', { sides: 20 })`, true);
    check('工具型 skill 真的跑起来了', r.ok, true);
    check('拿到了它的返回值', /骰子 20 面 → 19/.test(r.text), true);
    check('跑完沙盒被拆掉了（不留 iframe）',
      await ev(`document.querySelectorAll('iframe[sandbox="allow-scripts"]').length`), 0);

    // —— 它自己炸了要当成一次工具结果，而不是把循环带下去 ——
    const BOOM = '/*!MANIFEST {"name":"boom_tool","description":"故意抛异常。"}!*/\n' +
      'function run(){ throw new Error("故意的"); }';
    await ev(`(async function(){
      const f = ${mkFile(BOOM, 'boom_tool.js')};
      const r = await stCodeImportFiles([f]);
      await stCodeSkillsApply(r.found, r.js, '', r.errs);
      return true; })()`, true);
    r = await ev(`stCodeTool('boom_tool', {})`, true);
    check('skill 抛异常 → ok:false', r.ok, false);
    check('异常信息带回来了', /故意的/.test(r.text), true);
    check('并且说明卡没动', /卡没有动/.test(r.text), true);

    const NORUN = '/*!MANIFEST {"name":"no_run_tool","description":"没定义 run。"}!*/\nvar x = 1;';
    await ev(`(async function(){
      const f = ${mkFile(NORUN, 'no_run_tool.js')};
      const r = await stCodeImportFiles([f]);
      await stCodeSkillsApply(r.found, r.js, '', r.errs);
      return true; })()`, true);
    r = await ev(`stCodeTool('no_run_tool', {})`, true);
    check('没定义 run 会被说清约定', /没有定义 run/.test(r.text), true);

    // —— 沙盒到底关住了什么 ——
    // ⚠ 这一组是**整个特性存在的理由**：模型能指挥用户装一份 skill 进来，
    //   跑的就是别人写的代码。摸得到卡、摸得到 localStorage、上得了网，
    //   任何一条漏了都是「把用户的卡交出去」
    const PROBE = [
      '/*!MANIFEST {"name":"probe_env","description":"探一下沙盒里能摸到什么。"}!*/',
      'function run() {',
      '  var out = [];',
      '  out.push("card=" + (typeof stEditor));',
      '  try { out.push("parentDoc=" + (typeof self.parent.document)); }',
      '  catch (e) { out.push("parentDoc=throw"); }',
      '  try { localStorage.setItem("x", "1"); out.push("lsWrite=ok"); }',
      '  catch (e) { out.push("lsWrite=throw"); }',
      '  return fetch("https://example.com/x").then(',
      '    function () { out.push("net=ok"); return out.join(" | "); },',
      '    function () { out.push("net=blocked"); return out.join(" | "); });',
      '}'
    ].join('\n');
    await ev(`(async function(){
      const f = ${mkFile(PROBE, 'probe_env.js')};
      const r = await stCodeImportFiles([f]);
      await stCodeSkillsApply(r.found, r.js, '', r.errs);
      return true; })()`, true);
    r = await ev(`stCodeTool('probe_env', {})`, true);
    check('沙盒里摸不到页面的全局变量', /card=undefined/.test(r.text), true);
    check('沙盒里摸不到父页面的 document', /parentDoc=throw/.test(r.text), true);
    check('沙盒里写不了 localStorage', /lsWrite=throw/.test(r.text), true);
    check('沙盒里上不了网（CSP 把 fetch 挡掉）', /net=blocked/.test(r.text), true);
    check('异步 skill 的返回值也拿得到（它上面那条就是 Promise）', r.ok, true);

    // —— 超时 ——
    // ⚠ 实测过：不透明源 = 跨源 → Chrome 把沙盒 iframe 放进另一个进程，
    //   里面死循环卡不住父页面，所以这个 timer 真的掐得掉
    const HANG = '/*!MANIFEST {"name":"hang_tool","description":"永远不返回。"}!*/\n' +
      'function run(){ return new Promise(function () {}); }';
    await ev(`(async function(){
      const f = ${mkFile(HANG, 'hang_tool.js')};
      const r = await stCodeImportFiles([f]);
      await stCodeSkillsApply(r.found, r.js, '', r.errs);
      return true; })()`, true);
    const t9 = Date.now();
    r = await ev(`stCodeTool('hang_tool', {})`, true);
    check('永远不返回的会被超时掐掉', r.ok, false);
    check('超时给的是人话', /掐掉/.test(r.text), true);
    check('而且真的是等够了才掐（不是立刻失败）', Date.now() - t9 > 4000, true);
    check('掐完沙盒也拆掉了',
      await ev(`document.querySelectorAll('iframe[sandbox="allow-scripts"]').length`), 0);

    // —— 清掉，别影响后面的隐私那节 ——
    await ev(`(async function(){ stCode.skills = []; await stCodeSaveSkills(); return true; })()`, true);
    check('删掉之后工具表里也没了',
      await ev(`stCodeToolDefs().some(t => t.name === 'roll_dice')`), false);
    check('删掉之后调它会说「没有这个工具」',
      await ev(`stCodeTool('roll_dice', {}).then(r => r.ok)`, true), false);

    // ================= E10. 权限白名单 =================
    section('E10. 工具型 skill 的权限：沙盒只能碰申请过的能力');

    // ⚠ 这条原来写死 `["card.read","card.write"]` —— 加 `progress` 那一轮它红了。
    //   改成**推导式**：`card.read` / `card.write` 必须在，其余键必须都在
    //   `ST_CODE_PERM_TOOLS` 里（另一条断言查了「两边是一份」）。
    //   写死清单的代价就是每次加能力都要来改一次，而漏改的后果是
    //   「明明功能是对的，断言却红」—— 那种红最容易被当成噪音略过去
    check('读 / 改卡两层能力都在', await ev(
      `['card.read','card.write'].filter(k => ST_CODE_SANDBOX_PERM.indexOf(k) < 0).join(',')`), '');

    // ⚠ 这两条是**推导式**断言，不写死名单 —— 以后加个读卡工具忘了登记，这里会红。
    //   而「忘了登记」在运行时的表现是**静默退老行为**（那条工具调不动，但不报错）。
    //   ⚠ 唯一的例外是 `read_skill` / `list_skills` —— 它们读的是**用户的 skill 库**，
    //     不是卡，所以不属于 card.read。排除它们是**设计判断**，不是漏登记
    const NOT_CARD = ['read_skill', 'list_skills'];
    check('凡读卡的 read_ / list_ 工具都归在 card.read 里', await ev(`(function(){
      const r = ST_CODE_PERM_TOOLS['card.read'];
      const skip = ${JSON.stringify(NOT_CARD)};
      return ST_CODE_TOOLS.map(t => t.name).filter(n => /^(read_|list_)/.test(n))
        .filter(n => skip.indexOf(n) < 0)
        .filter(n => r.indexOf(n) < 0).join(','); })()`), '');
    check('凡 write_ / add_ / update_ / delete_ 开头的工具都归在 card.write 里', await ev(`(function(){
      const w = ST_CODE_PERM_TOOLS['card.write'];
      return ST_CODE_TOOLS.map(t => t.name).filter(n => /^(write_|add_|update_|delete_)/.test(n))
        .filter(n => w.indexOf(n) < 0).join(','); })()`), '');
    check('read_skill / list_skills 确实**不在**能力表里（读 skill 库不给沙盒）', await ev(`(function(){
      return Object.keys(ST_CODE_PERM_TOOLS).some(k =>
        ['read_skill','list_skills'].some(n => ST_CODE_PERM_TOOLS[k].indexOf(n) >= 0)); })()`), false);

    // ⚠ 这一条是整套权限设计的核心。给沙盒 fetch_url = 它能把刚读到的卡
    //   （私密角色设定）拼进 URL 发到任意公网地址，而 CSP 断网只挡它自己发请求，
    //   挡不住它指挥**父页面**去发
    check('fetch_url 不在任何一层能力里', await ev(`(function(){
      return Object.keys(ST_CODE_PERM_TOOLS).some(k =>
        ST_CODE_PERM_TOOLS[k].indexOf('fetch_url') >= 0); })()`), false);
    check('set_tasks / remember 也不给沙盒（那是会话级的东西）', await ev(`(function(){
      return Object.keys(ST_CODE_PERM_TOOLS).some(k =>
        ['set_tasks','remember'].some(n => ST_CODE_PERM_TOOLS[k].indexOf(n) >= 0)); })()`), false);
    check('能力表里只有内置工具（所以沙盒调不到别的 skill，不会递归）', await ev(`(function(){
      const builtin = ST_CODE_TOOLS.map(t => t.name);
      return Object.keys(ST_CODE_PERM_TOOLS)
        .reduce((a, k) => a.concat(ST_CODE_PERM_TOOLS[k]), [])
        .filter(n => builtin.indexOf(n) < 0).join(','); })()`), '');
    check('stCodePermOfTool 认得出归属', await ev(
      `[stCodePermOfTool('read_card'), stCodePermOfTool('write_text'), ` +
      `stCodePermOfTool('fetch_url'), stCodePermOfTool('roll_dice')].join('|')`),
      'card.read|card.write||');
    // 「只读 = 不占改卡次数」的判据。⚠ 它必须**同时**看静态名单和 skill 的权限 ——
    //   静态名单里没有工具型 skill，光看名单的话一个纯算的 skill 也会吃改卡预算
    check('stCodeIsReadTool：内置读工具是只读', await ev(
      `[stCodeIsReadTool('read_card'), stCodeIsReadTool('list_skills'), ` +
      `stCodeIsReadTool('read_doc')].join('|')`), 'true|true|true');
    check('stCodeIsReadTool：写工具不是', await ev(
      `[stCodeIsReadTool('write_text'), stCodeIsReadTool('add_world_entry'), ` +
      `stCodeIsReadTool('set_tasks'), stCodeIsReadTool('fetch_url')].join('|')`),
      'false|false|false|false');
    // ⚠ 求交集，不直接信 manifest —— 老草稿里可能存着早就下线的能力名
    check('已下线的能力名会被过滤掉', await ev(
      `JSON.stringify(stCodeSkillPermsOf({ tool: { perm: ['card.read','teleport'] } }))`),
      '["card.read"]');

    // —— 导入层：申请了没有的能力就拒，不假装给了 ——
    await ev(`(async function(){
      const f = ${mkFile('/*!MANIFEST {"name":"bad_perm","description":"d","perm":["net"]}!*/\n' +
        'function run(){}', 'bad_perm.js')};
      const r = await stCodeImportFiles([f]);
      window.__p0 = { n: r.found.length, errs: r.errs };
      return true; })()`, true);
    check('申请了没有的能力 → 导入就拒', await ev(`window.__p0.n`), 0);
    check('拒绝理由里说清现在能给哪两层', await ev(`window.__p0.errs[0]`),
      v => /card\.read/.test(v) && /card\.write/.test(v));

    // —— 三个探针：什么都没申请 / 只申请读 / 只申请写 ——
    const probeSrc = (name, perm, lines) => [
      '/*!MANIFEST ' + JSON.stringify({ name: name, description: '测权限用的。', perm: perm }) + '!*/'
    ].concat(lines).join('\n');

    const P_NONE = probeSrc('perm_none', [], [
      'function run() {',
      '  return host.call("read_card", {}).then(',
      '    function (v) { return "OK:" + String(v).slice(0, 30); },',
      '    function (e) { return "NO:" + e.message; });',
      '}'
    ]);

    const P_READ = probeSrc('perm_read', ['card.read'], [
      'function run(args) {',
      '  var step = String((args || {}).step || "");',
      '  if (step === "read") {',
      '    return host.call("read_card", {}).then(function (v) {',
      '      return "OK:" + (/name/.test(String(v)) ? "有名字" : "没名字");',
      '    }, function (e) { return "NO:" + e.message; });',
      '  }',
      '  if (step === "write") {',
      '    return host.call("write_text", { path: "description", value: "改到了" }).then(',
      '      function (v) { return "OK:" + v; }, function (e) { return "NO:" + e.message; });',
      '  }',
      '  if (step === "net") {',
      '    return host.call("fetch_url", { url: "https://example.com" }).then(',
      '      function (v) { return "OK:" + v; }, function (e) { return "NO:" + e.message; });',
      '  }',
      '  if (step === "other") {',
      '    return host.call("perm_write", {}).then(',
      '      function (v) { return "OK:" + v; }, function (e) { return "NO:" + e.message; });',
      '  }',
      // 25 次 —— 上限是 20，后 5 次该被拒
      '  if (step === "many") {',
      '    var n = 0, bad = 0;',
      '    var chain = Promise.resolve();',
      '    var one = function () {',
      '      return host.call("read_card", {}).then(',
      '        function () { n++; }, function () { bad++; });',
      '    };',
      '    for (var i = 0; i < 25; i++) chain = chain.then(one);',
      '    return chain.then(function () { return "ok=" + n + " 被拒=" + bad; });',
      '  }',
      '  return "没给 step";',
      '}'
    ]);

    const P_WRITE = probeSrc('perm_write', ['card.write'], [
      'function run(args) {',
      '  var step = String((args || {}).step || "");',
      '  if (step === "write") {',
      '    return host.call("write_text", { path: "description", value: "被 skill 改过" }).then(',
      '      function (v) { return "OK:" + v; }, function (e) { return "NO:" + e.message; });',
      '  }',
      '  if (step === "novalue") {',
      // ⚠ 少给 value 不许当成空串写进去（那会把字段清空，还回一个成功回执）
      '    return host.call("write_text", { path: "description" }).then(',
      '      function (v) { return "OK:" + v; }, function (e) { return "NO:" + e.message; });',
      '  }',
      '  if (step === "boom") {',
      // 先写成功、再自己炸 —— 这时候「卡没有动」是假话
      '    return host.call("write_text", { path: "description", value: "炸之前写的" })',
      '      .then(function () { throw new Error("写完才炸"); });',
      '  }',
      '  if (step === "read") {',
      '    return host.call("read_card", {}).then(',
      '      function (v) { return "OK:" + v; }, function (e) { return "NO:" + e.message; });',
      '  }',
      '  return "没给 step";',
      '}'
    ]);

    await ev(`(async function(){
      window.__desc0 = String(stEditor.card.description || "");
      stCode.autoApply = true;
      stCode.skills = []; await stCodeSaveSkills();
      const files = [
        ${mkFile(P_NONE, 'perm_none.js')},
        ${mkFile(P_READ, 'perm_read.js')},
        ${mkFile(P_WRITE, 'perm_write.js')}
      ];
      const r = await stCodeImportFiles(files);
      await stCodeSkillsApply(r.found, r.js, '', r.errs);
      return true; })()`, true);
    check('三个探针都装上了',
      await ev(`stCode.skills.filter(s => s.kind === 'tool').length`), 3);
    check('perm 存进了 skill（没有在导入路上丢掉）', await ev(
      `JSON.stringify(stCode.skills.filter(s => s.name === 'perm_read')[0].tool.perm)`),
      '["card.read"]');
    // 工具型 skill 的「只读」是按**权限**判的，不是按名单
    check('没申请 card.write 的 skill 算只读（不占改卡次数）', await ev(
      `[stCodeIsReadTool('perm_none'), stCodeIsReadTool('perm_read')].join('|')`), 'true|true');
    check('申请了 card.write 的 skill 不算只读（照样吃步数）', await ev(
      `stCodeIsReadTool('perm_write')`), false);

    // ⚠ 权限是**导入这一刻**给的，所以警告必须在这一刻出现 ——
    //   只在列表上挂个 ✏️ 徽章是不够的：用户点完「装」就走了
    check('导入带 card.write 的 skill 时，当场就说清它要改卡', await ev(
      `/card\\.write/.test(stCode.skillMsg) && /perm_write/.test(stCode.skillMsg)`), true);
    check('而且提示可以移除（给了退路）', await ev(
      `/移除/.test(stCode.skillMsg)`), true);
    check('顶部闪一下的那句也带上了警告', await ev(
      `(function(){ const e = document.getElementById('st-code-flash');
        return !!e && /能改卡/.test(e.textContent); })()`), true);
    // 提示条里有换行，不写 pre-wrap 的话整段会挤成一长行
    check('skill 提示条保留换行（white-space: pre-wrap）', await ev(`(function(){
      for (const ss of document.styleSheets) {
        let rules; try { rules = ss.cssRules; } catch (e) { continue; }
        for (const r of rules) {
          if (r.selectorText === '.st-code-skill-msg' && /pre-wrap/.test(r.style.whiteSpace)) return true;
        }
      }
      return false; })()`), true);

    // —— 什么都没申请：一律拒 ——
    r = await ev(`stCodeTool('perm_none', {})`, true);
    check('没申请能力 → 连读卡都调不动', /返回：\nNO:/.test(r.text), true);
    check('拒绝理由说清是「没申请」，不是「不存在」', /没有申请/.test(r.text), true);

    // —— 只申请了读 ——
    r = await ev(`stCodeTool('perm_read', { step: 'read' })`, true);
    check('申请了 card.read → 读卡通了', /返回：\nOK:/.test(r.text), true);
    check('而且真的拿到了卡的内容', /有名字/.test(r.text), true);

    r = await ev(`stCodeTool('perm_read', { step: 'write' })`, true);
    check('只有 card.read → 改卡被拒', /返回：\nNO:/.test(r.text), true);
    check('理由里点名缺的是 card.write', /card\.write/.test(r.text), true);
    check('而且说清「权限是导入时定的」', /导入那一刻定/.test(r.text), true);

    r = await ev(`stCodeTool('perm_read', { step: 'net' })`, true);
    check('就算申请了能力，fetch_url 还是调不到', /返回：\nNO:/.test(r.text), true);
    check('理由说清沙盒里根本没有这个能力', /没有「fetch_url」/.test(r.text), true);

    r = await ev(`stCodeTool('perm_read', { step: 'other' })`, true);
    check('调别的工具型 skill 会被拒（不递归）', /返回：\nNO:/.test(r.text), true);

    // —— 只申请了写：两层**不是包含关系** ——
    r = await ev(`stCodeTool('perm_write', { step: 'write' })`, true);
    check('申请了 card.write → 改卡通了', /返回：\nOK:/.test(r.text), true);
    check('卡真的被改了', await ev(`stEditor.card.description`), '被 skill 改过');
    r = await ev(`stCodeTool('perm_write', { step: 'read' })`, true);
    check('只有 card.write → 读卡反而被拒（写不等于读）', /返回：\nNO:/.test(r.text), true);
    check('拒绝理由里点名缺的是 card.read', /card\.read/.test(r.text), true);

    // ⚠ 少给 value 不许当成空串写进去 —— 那会把字段**静默清空**，还回一个成功回执。
    //   这一条是写 E10 的时候撞出来的：探针把参数名写成了 text，结果 description
    //   当场变成 ""，而工具返回的是「已写入 description（现在 0 字）」
    await ev(`stEditor.card.description = '别动我'`, true);
    r = await ev(`stCodeTool('perm_write', { step: 'novalue' })`, true);
    check('没给 value 被拒（不当成空串写）', /返回：\nNO:/.test(r.text), true);
    check('理由说清要放在 value 里', /value/.test(r.text), true);
    check('而且卡真的没动', await ev(`stEditor.card.description`), '别动我');

    // —— 改过卡要**带回 touched** ——
    // ⚠ 不带的话 Agent 循环不知道卡变了，右侧那份卡 JSON 就不重画，
    //   用户看到的是一张**没更新的卡**，而 skill 明明说它改好了
    r = await ev(`stCodeTool('perm_write', { step: 'write' })`, true);
    check('skill 里改到卡 → touched 一路带回外层', r.touched, 'skill');
    r = await ev(`stCodeTool('perm_read', { step: 'read' })`, true);
    check('只读的 skill 不报 touched', r.touched, '');
    r = await ev(`stCodeTool('perm_none', {})`, true);
    check('什么都没动的也不报 touched', r.touched, '');

    // ⚠ **先写成功、再自己炸** —— 这时候「卡没有动」是假话。
    //   用户以为没动就不会去检查，改动就那么留在卡里
    r = await ev(`stCodeTool('perm_write', { step: 'boom' })`, true);
    check('写完才炸的 skill 会被标成失败', r.ok, false);
    check('而且说清「已经改过卡了」，不说「卡没有动」',
      /已经改过卡了/.test(r.text) && !/卡没有动/.test(r.text), true);
    check('卡里确实留着它的改动', await ev(`stEditor.card.description`), '炸之前写的');
    check('这种情况下也带 touched 回去', r.touched, 'skill');

    // —— 次数上限 ——
    // ⚠ 不给上限的话 `while (1) { await host.call(...) }` 能在这 5 秒里把卡读上千遍 ——
    //   沙盒超时掐得掉**沙盒**，掐不掉父页面正在跑的那一串
    r = await ev(`stCodeTool('perm_read', { step: 'many' })`, true);
    check('一次 run 最多 20 次宿主调用，超的被拒', /ok=20 被拒=5/.test(r.text), true);

    // —— 面板与 system 上要看得见 ——
    check('面板上出现了「能改卡」的警示', await ev(
      `/能改卡/.test(stCodeSkillPopHtml())`), true);
    check('面板上列出了沙盒里能调的工具名', await ev(
      `(function(){ const h = stCodeSkillPopHtml();
        return /沙盒里能调/.test(h) && /read_card/.test(h); })()`), true);
    check('没申请能力的那个会说明「读不到卡」', await ev(
      `/读不到卡/.test(stCodeSkillPopHtml())`), true);
    check('system 里标明它自己也能读改卡', await ev(
      `/它自己也能读改卡/.test(stCodeSystem())`), true);
    check('system 里说清走的是同一套工具', await ev(
      `/同一套工具/.test(stCodeSystem())`), true);

    // ⚠ list_skills / read_skill 也要说清能不能碰卡 —— 模型据此决定
    //   「要不要自己先读一遍」和「先调谁后调谁」。说成「读不到卡」的后果是**放弃**
    check('list_skills 标出它能碰卡到什么程度', await ev(`(async function(){
      const t = (await stCodeTool('list_skills', {})).text;
      return /perm_write[^\\n]*card\\.write/.test(t) &&
             /perm_none[^\\n]*碰不到卡/.test(t); })()`, true), true);
    check('read_skill 对能碰卡的工具不说「读不到卡」', await ev(`(async function(){
      const t = (await stCodeTool('read_skill', { name: 'perm_read' })).text;
      return /card\\.read/.test(t) && !/碰不到卡/.test(t); })()`, true), true);
    check('read_skill 对纯计算的工具说「碰不到卡」', await ev(`(async function(){
      const t = (await stCodeTool('read_skill', { name: 'perm_none' })).text;
      return /碰不到卡/.test(t); })()`, true), true);

    // 对照组：纯算的 skill 不该出现那条警告 —— 不然它就成了「每次都说」的噪音，
    // 说多了用户就再也不看了（和「永远在报的检查」是同一个病）
    await ev(`(async function(){
      stCode.skills = []; await stCodeSaveSkills();
      const src = ['/*!MANIFEST {"name":"harmless","description":"纯算。"}!*/',
        'function run() { return 1; }'].join('\\n');
      const f = new File([src], 'harmless.js', { type: 'text/javascript' });
      const r = await stCodeImportFiles([f]);
      await stCodeSkillsApply(r.found, r.js, '', r.errs);
      return true; })()`, true);
    check('对照组：纯算的 skill 不会出现那条警告', await ev(
      `/card\\.write/.test(stCode.skillMsg)`), false);
    check('对照组：闪的那句也不带警告', await ev(
      `(function(){ const e = document.getElementById('st-code-flash');
        return !!e && !/能改卡/.test(e.textContent); })()`), true);

    // —— 收尾：还原卡，清掉探针 ——
    await ev(`(async function(){
      stEditor.card.description = window.__desc0;
      stCode.skills = []; await stCodeSaveSkills(); return true; })()`, true);

    // ================= E11. skill 自报进度（host.progress）=================
    // ⚠ 这条通道**不是 host.call**：它单向、不等回信、也不吃 ST_CODE_SANDBOX_RPC_MAX
    //   那 20 次预算。「报进度」和「读卡」共用一个额度说不通 —— 一个逐条处理 50 项的
    //   skill 光报进度就把预算烧光，真正要读卡那一下反而被拒
    section('E11. skill 自报进度：单向通道 + 自己的两道闸');

    // —— 纯判据：能力表 / 节流常量 ——
    check('progress 进了能力表（不然 manifest 那一关会把它判成「没有这个能力」）',
      await ev(`ST_CODE_SANDBOX_PERM.indexOf('progress') >= 0`), true);
    // ⚠ 它**不能**映射任何工具 —— 它走的是 __prog，不是 host.call。
    //   映射了的话 skill 会去 `host.call('progress')`，那是个死路
    check('progress 映射到空工具列表（它不是一个内置工具）',
      await ev(`JSON.stringify(ST_CODE_PERM_TOOLS['progress'])`), '[]');
    check('stCodePermToolNames 不会把 progress 拼进工具名（那是死路）',
      await ev(`stCodePermToolNames(['progress','card.read']).join('|')`), 'read_card|read_doc|' +
      'read_regex|read_th|list_world_entries|read_world_entry');
    // 推导式：能力表的每个键都要在 ST_CODE_SANDBOX_PERM 里，反之亦然。
    // ⚠ 只加一边的后果是「申请得到但调不动」或者「调得动但申请就被拒」，两边都不报错
    check('能力表和 ST_CODE_SANDBOX_PERM 是一份（不漏登记、不多登记）', await ev(`(function(){
      const a = Object.keys(ST_CODE_PERM_TOOLS).slice().sort().join(',');
      const b = ST_CODE_SANDBOX_PERM.slice().sort().join(',');
      return (a === b ? '' : a + ' vs ' + b); })()`), '');

    // —— 沙盒侧：boot 里真的有 host.progress ——
    check('沙盒 boot 里定义了 host.progress', await ev(
      `/progress: function/.test(ST_CODE_SANDBOX_BOOT)`), true);
    check('沙盒 boot 里记下了当前 run 的 id（进度要知道属于哪一次）', await ev(
      `/__rid = id/.test(ST_CODE_SANDBOX_BOOT)`), true);
    // ⚠ 这条是「别诱导 skill await 一个不存在的回信」：progress 必须**同步返回 undefined**
    check('host.progress 不发 __host 消息（那是 host.call 的形）', await ev(
      `/__prog: 1/.test(ST_CODE_SANDBOX_BOOT) && !/progress[\s\S]{0,200}__host: 1/.test(ST_CODE_SANDBOX_BOOT)`), true);

    // —— 真的跑起来：申请了 progress 的 skill 能报上来 ——
    // 节流窗口从产品里读，别写死 —— 写死的话改了常量这里会「因为错的理由」红
    const PROG_MS = Number(await ev(`ST_CODE_PROG_MS`));
    const mkProg = (name, perm, body) => probeSrc(name, perm, body);
    const P_PROG = mkProg('prog_yes', ['progress'], [
      'function run() {',
      '  host.progress("第一步");',
      // ⚠ 第二条要**等过节流窗口**（ST_CODE_PROG_MS）才发得出去 ——
      //   同一个 tick 里连发两条，第二条会被丢掉（那是设计，不是 bug）。
      //   探针里就得照规矩来，不然红的是断言自己
      '  return new Promise(function (res) {',
      '    setTimeout(function () {',
      '      host.progress("第二步");',
      '      res("报完了");',
      '    }, ST_CODE_PROG_MS_PLACEHOLDER);',
      '  });',
      '}'
    ].join('\n').replace('ST_CODE_PROG_MS_PLACEHOLDER', String(PROG_MS + 60)));
    const P_NOPROG = mkProg('prog_no', ['card.read'], [
      'function run() {',
      '  host.progress("我没申请，这句该被丢掉");',
      '  return "没申请也会照常返回";',
      '}'
    ]);
    await ev(`(async function(){
      stCode.skills = []; await stCodeSaveSkills();
      stCode.prog = null;
      window.__progSeen = [];
      // 拦一下显示函数，把每次上报记下来（真界面靠它，这里只验通道）
      const orig = stCodeProgressShow;
      window.__progOrig = orig;
      stCodeProgressShow = function (id, text) { window.__progSeen.push(text); return orig(id, text); };
      const files = [${mkFile(P_PROG, 'prog_yes.js')}, ${mkFile(P_NOPROG, 'prog_no.js')}];
      const r = await stCodeImportFiles(files);
      await stCodeSkillsApply(r.found, r.js, '', r.errs);
      return true; })()`, true);
    check('申请了 progress 的 skill 装上了', await ev(
      `stCode.skills.some(s => s.name === 'prog_yes')`), true);

    r = await ev(`stCodeTool('prog_yes', {})`, true);
    check('prog_yes 正常返回', r.ok, true);
    check('它报的两条进度都到了宿主', await ev(`JSON.stringify(window.__progSeen)`),
      '["第一步","第二步"]');
    check('返回之后进度那句话被撤掉了（不留在界面上）', await ev(`String(stCode.prog)`), 'null');
    // ⚠ 对照组：进度**不该**混进给模型的工具结果里 —— 它是给人看的
    check('对照组：进度文字没有混进工具返回给模型的文本', r.text.indexOf('第一步') < 0, true);

    // —— 没申请的：消息会被父页面丢掉，但**不报错、不影响返回值** ——
    await ev(`window.__progSeen = []`, true);
    r = await ev(`stCodeTool('prog_no', {})`, true);
    check('没申请 progress 的 skill 照常返回（不是错误）', r.ok, true);
    check('它那句进度被丢掉，一条都没显示', await ev(`JSON.stringify(window.__progSeen)`), '[]');

    // —— 节流：太快会被丢，不是排队 ——
    // ⚠ 不给闸的话 `for (var i=0;i<1e6;i++) host.progress('第'+i+'条')` 能在 5 秒里
    //   让父页面重画几十万次 —— 沙盒自己不卡（独立进程），卡的是父页面
    const P_FLOOD = mkProg('prog_flood', ['progress'], [
      'function run() {',
      '  for (var i = 0; i < 300; i++) host.progress("刷 " + i);',
      '  return "刷完了";',
      '}'
    ]);
    await ev(`(async function(){
      const f = ${mkFile(P_FLOOD, 'prog_flood.js')};
      const r = await stCodeImportFiles([f]);
      await stCodeSkillsApply(r.found, r.js, '', r.errs);
      window.__progSeen = []; return true; })()`, true);
    r = await ev(`stCodeTool('prog_flood', {})`, true);
    check('狂刷 300 条也不会把 run 弄失败', r.ok, true);
    // ⚠ 判据写成**上限**（<= 上限 且 远小于 300），不写死具体条数 ——
    //   具体条数取决于这 5 秒里机器多快，写死了这条断言会随机红
    check('狂刷会被节流 + 次数上限挡住（不是 300 条全过）', await ev(
      `window.__progSeen.length <= ST_CODE_PROG_MAX && window.__progSeen.length < 300`), true);
    // ⚠ 这一条是**上一条的对照组**：只断言「少于 300」的话，「全过但只有 299 条」
    //   也会绿。这里换成「同一个 tick 里连发两条，第二条必须被丢」——
    //   它证的是**节流这件事真的在发生**，而不只是「数量看着不多」
    check('同一 tick 里连发的第二条会被丢（节流真的在生效）',
      await ev(`window.__progSeen.length`), 1);
    // ⚠ 这条**不是**「skill 拿到的还是成功」的对照组 —— 那件事由上面那条 `r.ok` 覆盖。
    //   它测的是**另一件事**：节流闸只 `return` 不清（`stCodeProgressShow` 里
    //   `now - progLast < ST_CODE_PROG_MS` / `progN > ST_CODE_PROG_MAX` 都只是 return），
    //   所以「狂刷 300 条把 prog 刷满之后」进度仍然是**靠 `finish()` 收掉的**。
    //   ⚠ 标签必须说清判据在测什么：原标签承诺的是 `r.ok`，判据却是 `stCode.prog` ——
    //   读到标签的人会以为「丢 vs 失败」有对照组，实际没有。
    check('狂刷被节流之后，进度那句话同样被 finish 撤掉（闸只丢不清）',
      await ev(`String(stCode.prog)`), 'null');

    // —— 纯算的 skill 也能报进度（它读不到卡，但界面照样该有反应）——
    check('面板上标出「能报进度」', await ev(`(function(){
      const s = stCode.skills.filter(x => x.name === 'prog_yes')[0];
      const r = stCodeSkillPermsOf(s);
      return /progress/.test(JSON.stringify(r)); })()`), true);
    // ⚠ 这条是防「文案和行为对不上」：progress 不映射工具，按工具名拼那句话会漏掉它，
    //   面板于是把申请了进度的 skill 说成「读不到卡」，用户会以为它什么都做不了
    check('面板不会把「只申请了进度」的 skill 说成读不到卡', await ev(`(function(){
      const h = stCodeSkillPopHtml();
      return /能报进度/.test(h) && /只能往界面上报进度/.test(h); })()`), true);

    // —— 面板文档里要写清「不用 await」—— 写错的话 skill 会等一个不存在的回信 ——
    check('面板文档里说清了 host.progress 不用 await', await ev(`(function(){
      const h = stCodeSkillPopHtml();
      return /host\\.progress/.test(h) && /不用 await/.test(h); })()`), true);
    check('面板文档里说清了太快会被丢', await ev(
      `/太快会被丢/.test(stCodeSkillPopHtml())`), true);

    // —— 拒绝理由不能把 progress 说成工具（说了的话 skill 会去 host.call 它）——
    r = await ev(`stCodeTool('prog_yes', {})`, true);
    check('读完进度通道，工具本身仍然只吃它自己的权限', r.ok, true);

    // —— 收尾：还原被替换的显示函数 + 清干净 ——
    await ev(`(async function(){
      if (window.__progOrig) stCodeProgressShow = window.__progOrig;
      stCode.prog = null;
      stCode.skills = []; await stCodeSaveSkills(); return true; })()`, true);
    check('收尾后进度状态是干净的', await ev(`String(stCode.prog)`), 'null');

    // ================= K. 隐私 =================
    section('K. 隐私：skill / 会话 / 工具结果都不进卡');
    await ev(`(async function(){
      stCode.skills = [{ name: '秘密skill', desc: '不该进卡', body: 'SECRET_BODY', file: '' }];
      stCode.sessions = [{ id: 'x1', title: 'SECRET_TITLE', ts: Date.now(),
        msgs: [{ role: 'user', content: 'SECRET_MSG', ts: Date.now() }] }];
      stCode.sessionId = 'x1';
      await stCodeSaveSkills(); stCodeSaveSessions(); return true; })()`, true);
    await sleep(200);
    const cardJson = await ev(`JSON.stringify(stEditor.card)`);
    check('skill 不进角色卡', cardJson.indexOf('SECRET_BODY') < 0, true);
    check('会话不进角色卡', cardJson.indexOf('SECRET_MSG') < 0, true);
    check('会话标题也不进卡', cardJson.indexOf('SECRET_TITLE') < 0, true);

    const draft = await ev(`localStorage.getItem('stCardDraft') || ''`);
    check('草稿里没有 skill', draft.indexOf('SECRET_BODY') < 0, true);
    check('草稿里没有会话', draft.indexOf('SECRET_MSG') < 0, true);

    const exp = await ev(`(function(){ try {
      return (typeof stBuildExport === 'function') ? stBuildExport() : ''; }
      catch (e) { return ''; } })()`);
    check('导出里没有 skill', String(exp).indexOf('SECRET_BODY') < 0, true);

    check('两个 localStorage 键各管各的', await ev(`[
      !!localStorage.getItem('stCodeSessions'),
      !!localStorage.getItem('stCodeUi')].join(',')`), 'true,true');
    check('skill 单独住在 IndexedDB 里（会话 / 界面配置还是 localStorage）',
      await idbSkillNames(), '秘密skill');
    check('确认走的是 IndexedDB 后端（没有偷偷降级）',
      await ev(`stCodeSkillBackend`), 'idb');
    check('Code 的键跟 AI 助手的键不冲突', await ev(`[
      localStorage.getItem('stAiCfg') !== null,
      localStorage.getItem('stCodeUi') !== null].join(',')`), v => /^true,true$|^false,true$/.test(v), 'false,true');

    // 复古皮肤
    await ev(`stSwitchTab('code')`);
    await sleep(200);
    await ev(`(function(){ document.body.classList.add('retro-mode'); return true; })()`);
    await sleep(220);
    check('复古皮肤下 Code 页还在',
      await ev(`!!document.querySelector('#st-panes .st-code')`), true);
    check('复古皮肤下工具条有覆盖样式',
      await ev(`getComputedStyle(document.querySelector('.st-code-bar')).backgroundColor`), 'rgb(192, 192, 192)');
    await shot('st-code-retro.png', '#st-panes .st-code');
    await ev(`(function(){ document.body.classList.remove('retro-mode'); return true; })()`);

    // ================= L. 收尾 =================
    section('L. 收尾');
    await ev(`(function(){ stCode.skills = []; stCodeSaveSkills();
      stCode.sessions = []; stCode.sessionId = ''; stCodeSaveSessions(); return true; })()`);
    await ev(`closeStEditor()`);
    await sleep(250);
    check('关掉编写器不报错', true, true);
    await ev(`openStEditor()`);
    await sleep(250);
    check('再打开还活着', await ev(`!!document.getElementById('st-panes')`), true);

    const realErrors = consoleErrors.filter(e => !/favicon|net::ERR_FILE|Failed to load resource/i.test(e));
    check('零 console 报错' + (realErrors.length ? '  ← ' + realErrors.slice(0, 3).join(' | ') : ''),
      realErrors.length, 0);
  } catch (e) {
    fail++;
    fails.push('FATAL');
    console.log('\n💥 崩了：' + (e && e.stack || e));
  } finally {
    try { if (srv) srv.close(); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
    // ⚠ profile 目录要自己删 —— 不删的话每跑一次就多一个（实测堆到 873 个 / 14.5 GB）。
    //   这一套是最大的一份（单跑 33 s），漏一个就是几十 MB。
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); } catch (e) {}
  }

  console.log(`\n===== 第十二轮（Code / Agent）：${pass} 通过 / ${fail} 失败 =====`);
  if (fails.length) console.log('失败项：\n  · ' + fails.join('\n  · '));
  process.exit(fail ? 1 : 0);
})();
