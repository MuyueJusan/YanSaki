// 第九轮：**AI 生成预制块** —— 写一句描述，让模型拼出一组块，存进「我的预制块」
//
// 要证的五件事：
//   ① 提示词里**真的**给了模型 9 种块类型 + 硬规则，而且**把卡里真实的变量路径喂了进去**
//      （不喂的话它只会一本正经地编 `stat_data.生命值`，而卡里叫 `hp`）
//   ② 回复的容错：围栏 / 寒暄 / 裸数组 / 缺字段 / 空块 / 根本不是 JSON —— 一条都不能崩
//   ③ **模型碰不到它不该碰的字段**（offX/offY/w/h/extra*/clsMap/clsOwn 一律归零），
//      而合法的外观字段要原样留住（对照组 —— 否则「清洗」可能只是把块清空）
//   ④ 结果**存进本机**（localStorage）、刷新还在、名字撞车**自动加编号而不是覆盖**
//   ⑤ 失败路径都有可读提示，且忙态一定归位
//
// 十段：
//   A. 装载与零报错
//   B. 那一行渲染出来了（输入框 / 按钮 / 描述进状态而不是只进 DOM）
//   C. 没配 AI 时不发请求、只给提示（配好之后作对照）
//   D. 提示词内容（块类型 / 硬规则 / 真实变量路径 / 范围 / 没变量时的兜底话术）
//   E. 解析容错（围栏 / 寒暄 / 裸数组 / 缺 blocks / 空块 / 非 JSON / 怪类型）
//   F. 清洗（不该碰的归零 + 该留的原样留住）
//   G. 封顶（块数 / 深度）
//   H. 落盘与刷新（存进去 / 刷新还在 / 同名加编号 / 存满拒收）
//   I. 绑定统计（几个路径对得上卡里的变量）
//   J. 失败路径 + 收尾零报错
//
// 跑法：node sb-verify9.js

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

const CANDIDATES = [8995, 8996, 8997, 8998];
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

// 假 fetch 的源码。用 addScriptToEvaluateOnNewDocument 装 —— **刷新之后桩还在**，
// 「刷新了预制块还在不在」那一段才立得住
const MOCK_SRC = `
window.__aiCalls = [];
window.__aiScript = { reply: '', fail: '', delay: 0 };
window.fetch = async function (url, init) {
  init = init || {};
  let body = null;
  try { body = init.body ? JSON.parse(init.body) : null; } catch (e) {}
  window.__aiCalls.push({ url: String(url), method: init.method || 'GET',
    headers: init.headers || {}, body: body });
  const S = window.__aiScript;
  if (S.delay) await new Promise(r => setTimeout(r, S.delay));
  if (S.fail === 'network') throw new TypeError('Failed to fetch');
  if (S.fail === 'http401') return new Response('{"error":{"message":"invalid api key"}}',
    { status: 401, headers: { 'Content-Type': 'application/json' } });
  const content = (S.fail === 'notjson') ? '我觉得这个想法挺不错的，不过我先聊聊别的。'
    : String(S.reply == null ? '' : S.reply);
  return new Response(JSON.stringify({ choices: [{ message: { content: content } }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } });
};
`;

(async () => {
  // 端口不能写死、也不能纯随机：连跑整套时上一轮 Chrome 还没退干净就会占着
  // 刚抽到的号，症状是「Chrome 调试端口没起来」—— 跟被测页面一点关系都没有。
  // 先试着真绑一下，绑得上才算数
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-sb9-'));
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu',
    '--no-first-run', '--hide-scrollbars',
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

  // —— 页面内的小工具 ——
  // 假 fetch 的控制面板：改回复 / 改失败模式 / 清空调用记录
  const script = (o) => ev(`(function(){ Object.assign(window.__aiScript, ${JSON.stringify(o)}); return true; })()`);
  const clearCalls = () => ev(`(window.__aiCalls = [], true)`);
  const callN = () => ev(`window.__aiCalls.length`);
  const lastCall = () => ev(`(function(){ const c = window.__aiCalls; return c.length ? c[c.length-1] : null; })()`);
  const msgText = () => ev(`(stEditor.msg && stEditor.msg.text) || ''`);
  const msgKind = () => ev(`(stEditor.msg && stEditor.msg.kind) || ''`);
  const mineList = () => ev(`stSbUserPrefabs().map(x => ({ id: x.id, name: x.name, icon: x.icon, n: x.blocks.length }))`);
  const rawStore = () => ev(`(function(){ try { return JSON.parse(localStorage.getItem('stSbPrefabs') || 'null'); } catch (e) { return 'BAD'; } })()`);
  // 走**真按钮**的 onclick，不是直接调函数 —— 要验的正是「按钮接对了没有」
  const clickGen = async () => {
    await ev(`(function(){ const b = document.getElementById('st-sb-pf-ai-btn'); if (b) b.click(); return !!b; })()`);
  };
  // 一次完整生成：填描述 → 点按钮 → 等 Promise 落地
  const gen = async (desc) => {
    await ev(`stSbAiDescSet(${JSON.stringify(desc)})`);
    await ev(`stSbAiPrefabRun()`, true, 40000);
  };
  // 直接调解析器（不走网络）—— E / F / G 三段用它，快且稳
  const parse = (text) => ev(`(function(){
    const r = stSbAiParse(${JSON.stringify(text)});
    return { ok: r.ok, name: r.name, icon: r.icon, why: r.why,
      n: stSbAiCount(r.blocks).n, deep: stSbAiCount(r.blocks).deep,
      blocks: r.blocks };
  })()`);
  const reload = async () => {
    const l = new Promise(res => cdp.on('Page.loadEventFired', res));
    await cdp.send('Page.reload', {}, SID);
    await l;
    await ev(`document.fonts.ready.then(() => true)`, true);
    await sleep(500);
  };
  // ⚠ 刷新之后 aiConfig 会回到 localStorage 里那份（我在内存里改的没存过），
  //   所以每次 reload 之后都得重配一遍 —— 否则后面那条 gen 会红在
  //   「还没配 Base URL」上，看着像功能坏了
  const configAi = () => ev(`(function(){
    aiConfig.provider = 'deepseek';
    aiConfig.baseUrl = 'https://api.deepseek.com/v1';
    aiConfig.apiKey = 'sk-test-KKK';
    aiConfig.model = 'deepseek-chat';
    aiConfig.temperature = 0.7;
    aiConfig.maxTokens = 2048;
    return true; })()`);

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
    // 页内的 confirm 一律换成同步桩（理由见 sb-verify8.js：走 CDP 应答约 20% 会翻车）
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__dlg = [];
        window.__confirmYes = true;
        window.confirm = function (m) { window.__dlg.push(String(m)); return window.__confirmYes !== false; };
        ${MOCK_SRC}`
    }, SID);
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

    await ev('openStEditor()');
    await ev(`stSwitchTab('mvu')`);
    await ev(`stMvuInstallClick()`);
    // 变量树清空 —— 后面每一段都要能自己说了算「卡里有哪些变量」
    await ev(`stEditor.card.mvu.nodes = []; stMvuSync(); stSaveDraft();`);
    await ev(`stSbApplyTemplate(5)`);        // 5 = 空白模板
    await ev(`stSwitchTab('sb')`);
    await sleep(250);

    // ============ A. 装载与零报错 ============
    console.log('\n== A. 装载与零报错 ==');
    check('页面无 console 错误', consoleErrors.filter(x => !/favicon/i.test(x)),
      v => v.length === 0, []);
    check('假 fetch 装上了', await ev(`typeof window.fetch === 'function' && Array.isArray(window.__aiCalls)`), true);
    check('编辑器已打开',
      await ev(`document.getElementById('st-overlay').classList.contains('active')`), true);
    check('MVU 已装、状态栏已接管', await ev(`stEditor.sbOwn`), true);

    // ============ B. 那一行渲染出来了 ============
    console.log('\n== B. 「让 AI 生成」那一行 ==');
    check('输入框在', await ev(`!!document.getElementById('st-sb-pf-ai')`), true);
    check('按钮在', await ev(`!!document.getElementById('st-sb-pf-ai-btn')`), true);
    check('按钮文案是「✨ 生成」',
      await ev(`document.getElementById('st-sb-pf-ai-btn').textContent.trim()`), '✨ 生成');
    check('按钮没被禁用', await ev(`document.getElementById('st-sb-pf-ai-btn').disabled`), false);
    check('分类小标题写了「让 AI 生成」',
      await ev(`[...document.querySelectorAll('.st-sb-pf-cat')].some(x => x.textContent.indexOf('让 AI 生成') === 0)`), true);
    check('placeholder 给了例子',
      await ev(`document.getElementById('st-sb-pf-ai').getAttribute('placeholder')`),
      v => /例如/.test(v), '含「例如」');

    // 描述必须**进状态**，不能只躺在 DOM 里 —— 否则重绘一次就没了
    await ev(`stSbAiDescSet('生命值和魔力')`);
    check('描述写进了状态', await ev(`stEditor.sbPfAiDesc`), '生命值和魔力');
    await ev(`stRerender()`);
    await sleep(150);
    check('重绘之后输入框里还是它（对照组：证明上一条不是白写的）',
      await ev(`document.getElementById('st-sb-pf-ai').value`), '生命值和魔力');
    const long = 'あ'.repeat(300);
    await ev(`stSbAiDescSet(${JSON.stringify(long)})`);
    check('超长描述被截到上限', await ev(`stEditor.sbPfAiDesc.length`), 120);

    // ============ C. 没配 AI 时不发请求 ============
    console.log('\n== C. 未配置 AI ==');
    await ev(`(function(){ aiConfig.baseUrl = ''; aiConfig.apiKey = ''; aiConfig.model = ''; return true; })()`);
    check('就绪判定先确认一下是「没配」', (await ev(`stAiReady(stAiCfg())`)).ok, false);
    await clearCalls();
    await ev(`stSbAiDescSet('随便')`);
    await gen('随便');
    check('没配就不发请求', await callN(), 0);
    check('而且当面说了为什么', await msgText(), v => /还没配|还没填|还没选/.test(v), '含「还没配/填/选」');
    check('提示是 warn 而不是 ok', await msgKind(), 'warn');
    check('忙态没有卡住', await ev(`stEditor.sbPfAiBusy`), false);

    // 配上，作对照
    await configAi();
    check('配好之后就绪判定通过', (await ev(`stAiReady(stAiCfg())`)).ok, true);

    // ============ D. 提示词内容 ============
    console.log('\n== D. 提示词 ==');
    // 先建两个真变量，看提示词里有没有把它们喂进去
    await ev(`(function(){
      stEditor.card.mvu.nodes = [
        { id: 'n1', name: 'hp', type: 'number', min: 0, max: 150, value: 80, children: [] },
        { id: 'n2', name: 'affection', type: 'number', min: -100, max: 100, value: 20, children: [] }
      ];
      stMvuSync(); stSaveDraft(); return true; })()`);
    await clearCalls();
    await script({ reply: JSON.stringify({ name: '测试', icon: '❤', blocks: [
      { type: 'bar', path: 'stat_data.hp', label: '生命', min: 0, max: 150 }
    ] }) });
    await gen('生命值进度条');
    const c1 = await lastCall();
    const msgs = (c1 && c1.body && c1.body.messages) || [];
    const sys = (msgs.filter(m => m.role === 'system')[0] || {}).content || '';
    const usr = (msgs.filter(m => m.role === 'user')[0] || {}).content || '';
    check('发了 system + user 两条', msgs.length, 2);
    check('请求是非流式的（要 JSON，不要边吐边解析）', (c1.body || {}).stream, false);
    check('system 里有「只输出 JSON」', sys, v => /只输出 JSON/.test(v), '含「只输出 JSON」');
    const TYPES = ['title', 'text', 'var', 'bar', 'dots', 'row', 'divider', 'space', 'html'];
    const missingT = TYPES.filter(t => sys.indexOf(t) < 0);
    check('system 里 9 种块类型一个不少', missingT, v => v.length === 0, []);
    check('system 里点名了「不要发明字段名」', sys, v => /不要发明字段名/.test(v), '含「不要发明字段名」');
    check('system 里要求颜色写 #rrggbb', sys, v => /#rrggbb/.test(v), '含「#rrggbb」');
    check('user 里有用户那句描述', usr, v => v.indexOf('生命值进度条') >= 0, true);
    check('user 里喂了卡里真实的变量路径 stat_data.hp', usr, v => v.indexOf('stat_data.hp') >= 0, true);
    check('user 里喂了第二个变量 stat_data.affection', usr, v => v.indexOf('stat_data.affection') >= 0, true);
    check('user 里带上了变量自己的范围 0~150', usr, v => /0~150/.test(v), '含「0~150」');
    check('负范围也照样带出来（-100~100）', usr, v => /-100~100/.test(v), '含「-100~100」');
    check('user 里说了当前主题', usr, v => /当前状态栏主题/.test(v), true);
    check('生成完忙态归位', await ev(`stEditor.sbPfAiBusy`), false);
    check('生成完按钮恢复可点', await ev(`document.getElementById('st-sb-pf-ai-btn').disabled`), false);

    // 卡里没变量时的兜底话术（**对照组**：跟有变量时的话不一样）
    await ev(`stEditor.card.mvu.nodes = []; stMvuSync(); stSaveDraft();`);
    await clearCalls();
    await script({ reply: JSON.stringify({ name: 'x', icon: 'x', blocks: [{ type: 'text', text: 'a' }] }) });
    await gen('随便来点');
    const c2 = await lastCall();
    const usr2 = (((c2.body || {}).messages) || []).filter(m => m.role === 'user')[0].content;
    check('卡里没变量时，明说「还没建变量」', usr2, v => /还没建变量/.test(v), true);
    // ⚠ 不能直接判「不含 stat_data.」—— 那段兜底话术**本身就写着** `stat_data.xxx`
    //   当例子。要判的是「没有变量清单」，所以按行首的 `- stat_data.` 认
    check('而且不再列变量清单', usr2, v => !/^- stat_data\./m.test(v), true);

    // ============ E. 解析容错 ============
    console.log('\n== E. 解析容错 ==');
    const okBody = JSON.stringify({ name: '战斗面板', icon: '⚔', blocks: [
      { type: 'title', text: '战斗' },
      { type: 'bar', path: 'stat_data.hp', label: '生命', min: 0, max: 150 }
    ] });
    let r = await parse(okBody);
    check('正常 JSON → ok', r.ok, true);
    check('名字取到了', r.name, '战斗面板');
    check('图标取到了', r.icon, '⚔');
    check('块数对得上', r.n, 2);

    r = await parse('```json\n' + okBody + '\n```');
    check('带 ```json 围栏 → 照样解析', r.ok, true);
    check('围栏里的名字也对', r.name, '战斗面板');

    r = await parse('好的，我来帮你设计一下：\n\n' + okBody + '\n\n希望你喜欢！');
    check('前后有寒暄 → 照样解析', r.ok, true);

    r = await parse(JSON.stringify([{ type: 'text', text: '裸数组' }]));
    check('顶层直接是数组 → 也收', r.ok, true);
    check('没有名字就用默认名', r.name, 'AI 预制块');
    check('没有图标就用默认图标', r.icon, '✨');

    r = await parse(JSON.stringify({ name: 'x', icon: 'x' }));
    check('没有 blocks → 不收', r.ok, false);
    check('  并说清是缺 blocks', r.why, v => /没有 blocks/.test(v), '含「没有 blocks」');

    r = await parse(JSON.stringify({ blocks: [] }));
    check('blocks 是空数组 → 不收', r.ok, false);

    r = await parse(JSON.stringify({ blocks: [{}] }));
    check('全是空块 → 不收（存下去就是个幽灵）', r.ok, false);
    check('  并说清是空块', r.why, v => /空的/.test(v), '含「空的」');

    r = await parse('这不是 JSON，我只是随便聊聊。');
    check('压根不是 JSON → 不收', r.ok, false);
    check('  并说清是 JSON 的问题', r.why, v => /合法 JSON/.test(v), '含「合法 JSON」');

    r = await parse('');
    check('空回复 → 不收', r.ok, false);

    r = await parse(JSON.stringify({ blocks: '不是数组' }));
    check('blocks 不是数组 → 不收', r.ok, false);

    r = await parse(JSON.stringify({ blocks: [{ type: 'blink', text: '怪类型' }] }));
    check('不认识的 type → 规范化成 text（不崩）', r.ok, true);
    check('  类型真的落到 text 上了', r.blocks[0].type, 'text');
    check('  内容还留着', r.blocks[0].text, '怪类型');

    r = await parse(JSON.stringify({ blocks: [{ type: 'bar', path: 'x', min: 'abc', max: null }] }));
    check('数值字段是垃圾 → 退默认值，不崩', r.ok, true);
    check('  min 退到 0', r.blocks[0].min, 0);
    check('  max 退到 100', r.blocks[0].max, 100);

    // ============ F. 清洗：模型不许碰的字段 ============
    console.log('\n== F. 清洗 ==');
    r = await parse(JSON.stringify({ blocks: [{
      type: 'bar', path: 'stat_data.hp', label: '生命', min: 0, max: 150,
      size: 15, color: '#ff0000', height: 12, bold: true,
      offX: 99, offY: 88, w: 300, h: 200,
      extra: 'color:red', extraInner: 'a', extraFill: 'b', wrapExtra: 'c',
      clsMap: { outer: 'evil' }, clsOwn: { outer: ['evil'] }
    }] }));
    const b0 = r.blocks[0];
    check('offX 被归零', b0.offX, 0);
    check('offY 被归零', b0.offY, 0);
    check('w 被归零', b0.w, 0);
    check('h 被归零', b0.h, 0);
    check('extra 被清空', b0.extra, '');
    check('extraInner 被清空', b0.extraInner, '');
    check('extraFill 被清空', b0.extraFill, '');
    check('wrapExtra 被清空', b0.wrapExtra, '');
    check('clsMap 被清空', b0.clsMap.outer, '');
    check('clsOwn 被清空', b0.clsOwn.outer.length, 0);
    // ⚠ 对照组：**合法的外观字段必须原样留住** —— 没有这一组，
    //   一个「把整个块清空」的实现同样能让上面 10 条全绿
    check('对照组：path 留住了', b0.path, 'stat_data.hp');
    check('对照组：label 留住了', b0.label, '生命');
    check('对照组：min 留住了', b0.min, 0);
    check('对照组：max 留住了（变量自己的范围）', b0.max, 150);
    check('对照组：size 留住了', b0.size, 15);
    check('对照组：color 留住了', b0.color, '#ff0000');
    check('对照组：height 留住了', b0.height, 12);
    check('对照组：bold 留住了', b0.bold, true);

    r = await parse(JSON.stringify({ blocks: [{
      type: 'row', gap: 10, children: [{ type: 'var', path: 'a', offX: 5, clsMap: { outer: 'e' } }]
    }] }));
    check('子块也被清洗过（递归，不是只看第一层）', r.blocks[0].children[0].offX, 0);
    check('子块的 clsMap 也被清了', r.blocks[0].children[0].clsMap.outer, '');
    check('子块的 path 留着（对照）', r.blocks[0].children[0].path, 'a');

    // ============ G. 封顶 ============
    console.log('\n== G. 封顶 ==');
    const many = { blocks: [] };
    for (let i = 0; i < 40; i++) many.blocks.push({ type: 'text', text: 't' + i });
    r = await parse(JSON.stringify(many));
    check('40 块被裁到上限 24 块', r.n, 24);
    check('裁完前 24 条顺序没乱', r.blocks[0].text, 't0');
    check('裁完第 24 条是 t23', r.blocks[23].text, 't23');

    const deep = { blocks: [{ type: 'row', children: [{ type: 'row', children: [
      { type: 'row', children: [{ type: 'row', children: [{ type: 'text', text: '太深了' }] }] }] }] }] };
    r = await parse(JSON.stringify(deep));
    check('嵌套 5 层被摊到深度 3', r.deep, 3);
    // ⚠ 这一条是**行为判据**，不只是数字：超深时是「把子块提上来」而不是「砍掉子树」。
    //   砍掉的话这块树会变成三个空 row → 整份被判「空块」拒收，
    //   用户看到的是「AI 生成失败」，而他明明给了内容。**丢层级可以，丢内容不行。**
    check('  是摊平不是砍掉 —— 5 块一块没少', r.n, 5);
    check('  没被裁成空（还是 ok）', r.ok, true);
    const deepTexts = await ev(`(function(){ const out = [];
      const w = bs => (bs || []).forEach(b => { if (b.text) out.push(b.text); w(b.children); });
      w(${JSON.stringify(r.blocks)}); return out; })()`);
    check('  「太深了」那句还在（真的没丢内容）', deepTexts.indexOf('太深了') >= 0, true);

    // ============ H. 落盘 ============
    console.log('\n== H. 落盘 ==');
    // ⚠ 清库必须**走 API** —— 裸 `localStorage.removeItem` 清不掉内存里那份
    //   `stSbPfCache`，于是「清空」之后读出来还是老列表，红得莫名其妙
    await ev(`stSbPfStore([])`);
    await clearCalls();
    await script({ reply: okBody });
    await gen('战斗面板');
    let mine = await mineList();
    check('存进了「我的预制块」', mine.length, 1);
    check('  名字对', mine[0].name, '战斗面板');
    check('  图标对', mine[0].icon, '⚔');
    check('  块数对', mine[0].n, 2);
    check('localStorage 里键的形状是 {v:1,list:[…]}', (await rawStore()).v, 1);
    check('DOM 里也出现那一条',
      await ev(`[...document.querySelectorAll('[onclick^="stSbAddUserPrefab("]')].some(b => b.textContent.indexOf('战斗面板') >= 0)`), true);
    check('提示说了「AI 生成了预制块」', await msgText(), v => /AI 生成了预制块/.test(v), true);
    check('提示里说了几个路径对得上（卡里没变量 → 0/1）',
      await msgText(), v => /0\/1/.test(v), '含「0/1」');

    await reload();
    await configAi();
    await ev('openStEditor()');
    await ev(`stSwitchTab('sb')`);
    await sleep(300);
    mine = await mineList();
    check('刷新整页之后还在', mine.length, 1);
    check('  名字还是那个', mine[0].name, '战斗面板');
    check('  块数也还是 2（往返没丢东西）', mine[0].n, 2);

    // 同名 → 加编号，**不覆盖**
    await clearCalls();
    await script({ reply: JSON.stringify({ name: '战斗面板', icon: '⚔', blocks: [{ type: 'title', text: '新的' }] }) });
    await gen('再来一个战斗面板');
    mine = await mineList();
    check('同名不覆盖，变成两条', mine.length, 2);
    check('  新的那条叫「战斗面板 2」', mine[1].name, '战斗面板 2');
    check('  旧的那条名字没动（对照组）', mine[0].name, '战斗面板');
    check('  旧的那条内容也没动（块数仍是 2）', mine[0].n, 2);
    check('  新的那条是新内容（1 块）', mine[1].n, 1);
    check('提示里说了名字重了', await msgText(), v => /加了编号/.test(v), true);

    // 存满 → 拒收
    await ev(`(function(){
      const list = [];
      // ⚠ blocks 不能是空的 —— stSbUserPrefabs() 会把「没有块」的条目**整条跳过**，
      //   拿空块填满会得到 0 条，看着像「store 坏了」，其实是测试喂错了东西
      for (let i = 0; i < ST_SB_PF_MAX; i++) {
        list.push({ id: 'fill' + i, name: 'F' + i, icon: 'x',
          blocks: [{ type: 'text', text: 'x' }] });
      }
      stSbPfStore(list); return stSbUserPrefabs().length; })()`);
    check('先塞满到上限', await ev(`stSbUserPrefabs().length`), 60);
    await clearCalls();
    await script({ reply: JSON.stringify({ name: '溢出', icon: 'x', blocks: [{ type: 'text', text: 'a' }] }) });
    await gen('再来一个');
    check('存满之后再生成 → 拒收，还是 60 条', await ev(`stSbUserPrefabs().length`), 60);
    check('  而且当面说了「存满」', await msgText(), v => /存满/.test(v), true);
    await ev(`stSbPfStore([])`);

    // ============ I. 绑定统计 ============
    console.log('\n== I. 绑定统计 ==');
    await ev(`(function(){
      stEditor.card.mvu.nodes = [
        { id: 'n1', name: 'hp', type: 'number', min: 0, max: 150, value: 80, children: [] }
      ];
      stMvuSync(); stSaveDraft(); return true; })()`);
    await clearCalls();
    await script({ reply: JSON.stringify({ name: '绑定测试', icon: '❤', blocks: [
      { type: 'bar', path: 'stat_data.hp', label: '生命', min: 0, max: 150 },
      { type: 'bar', path: 'stat_data.编的', label: '编的' }
    ] }) });
    await gen('一条真一条编');
    check('一条真一条编 → 报 1/2', await msgText(), v => /1\/2/.test(v), '含「1/2」');
    check('  并且提了「建了同名变量就通」', await msgText(), v => /同名变量/.test(v), true);

    await clearCalls();
    await script({ reply: JSON.stringify({ name: '全编', icon: 'x', blocks: [
      { type: 'bar', path: 'stat_data.a' }, { type: 'bar', path: 'stat_data.b' }
    ] }) });
    await gen('全编');
    check('两条都对不上 → 报 0/2', await msgText(), v => /0\/2/.test(v), '含「0/2」');

    // 纯文字块（没有 path）→ 不提绑定数，别硬凑一个 0/0
    await clearCalls();
    await script({ reply: JSON.stringify({ name: '纯文字', icon: 'x', blocks: [{ type: 'title', text: '只有字' }] }) });
    await gen('只有字');
    check('没有 path 的预制块就不提绑定数', await msgText(), v => !/\d\/\d/.test(v), '不含「N/N」');
    check('  但仍然说清存下来了', await msgText(), v => /AI 生成了预制块/.test(v), true);

    // ============ J. 失败路径 ============
    console.log('\n== J. 失败路径 ==');
    await clearCalls();
    await script({ fail: 'network', reply: '' });
    await gen('网络炸了');
    check('网络异常 → 提示里说失败了', await msgText(), v => /AI 生成失败/.test(v), true);
    check('  提示是 bad', await msgKind(), 'bad');
    check('  忙态归位（不然按钮永远转圈）', await ev(`stEditor.sbPfAiBusy`), false);

    await script({ fail: 'http401', reply: '' });
    await gen('鉴权炸了');
    check('HTTP 401 → 提示里有 401', await msgText(), v => /401/.test(v), true);

    await script({ fail: 'notjson', reply: '' });
    await gen('回的不是 JSON');
    check('回了段人话 → 提示里说 JSON 不合法', await msgText(), v => /合法 JSON/.test(v), true);

    await script({ fail: '', reply: JSON.stringify({ blocks: [] }) });
    await gen('空的');
    check('空 blocks → 提示里说「没有 blocks 数组」',
      await msgText(), v => /没有 blocks/.test(v), true);

    // 失败之后还能再来一次（**对照组**：证明失败没把状态弄脏）
    await script({ fail: '', reply: JSON.stringify({ name: '重来一次', icon: '✅', blocks: [{ type: 'text', text: 'ok' }] }) });
    await clearCalls();
    await gen('重来');
    check('失败之后还能正常生成', await msgText(), v => /AI 生成了预制块/.test(v), true);
    check('  确实发了请求', await callN(), v => v === 1, 1);

    await shot('sb9-ai-prefab.png');

    // ============ 收尾 ============
    console.log('\n== 收尾 ==');
    await ev(`stSwitchTab('name')`); await sleep(120);
    await ev(`stSwitchTab('sb')`); await sleep(120);
    await ev(`stSwitchTab('export')`); await sleep(120);
    check('来回切选项卡没有页面异常',
      consoleErrors.filter(e => /EXCEPTION/.test(e)).length, 0);
    check('全程零 console.error', consoleErrors.length, 0);
    if (consoleErrors.length) consoleErrors.slice(0, 5).forEach(e => console.log('    ' + e));

    console.log(`\n===== 第九轮（AI 生成预制块）：${pass} 通过 / ${fail} 失败 =====`);
    if (fails.length) { console.log('失败项：'); fails.forEach(f => console.log('  · ' + f)); }
  } catch (e) {
    fail++;
    console.log('\n💥 套件自己崩了：' + (e && e.stack ? e.stack : e));
  } finally {
    try { if (cdp) await cdp.send('Browser.close', {}, SID); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
    try { if (srv) srv.close(); } catch (e) {}
    // ⚠ **必须带 maxRetries**：Windows 上进程刚 kill 掉时 profile 目录还锁着，
    //   裸 `rmSync` 会 EBUSY 退出，而外面这层 catch 把它吞掉 —— **静默失败**
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); } catch (e) {}
  }
  process.exit(fail ? 1 : 0);
})();
