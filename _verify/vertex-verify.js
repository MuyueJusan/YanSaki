// 第十八轮：**服务商大扩充 + Vertex AI（两种验证模式）+ 手输模型名**
//
// 这一轮把服务商表从 7 项扩到 37 项 —— 加了海外模型，以及**国产模型的海外渠道**
// （Moonshot 国际站 / 智谱 Z.ai / 通义千问 新加坡·美国·中国香港 / 硅基流动 .com /
// MiniMax 国际站）。⚠ 海外渠道跟国内**不是同一个端点，Key 也不通用**。
// 同时把 `AI_PROVIDERS` 与编写器那份 `ST_AI_PROVIDERS` **合成同一张表**
// （以前两份重复维护，加一个服务商要改两个地方，漏一个就是「下拉里有、取不到」）。
//
// 新协议 `gemini`（原生 generateContent / streamGenerateContent）三条路：
//   · AI Studio 原生 —— generativelanguage.googleapis.com，头用 x-goog-api-key
//   · Vertex 快速模式（Express）—— 只填 API key，路径 /v1/publishers/google/models/…
//   · Vertex 完整模式（Service Account）—— 浏览器里用 WebCrypto 签 RS256 JWT 换
//     access token（oauth2.googleapis.com/token），路径带 projects/{p}/locations/{l}
//
// 十九段：
//   A. 页面加载零报错
//   B. 服务商表（合并 / 分组 / custom 留末位 / 只有 custom 允许不写死 proto）
//   C. 协议判定（⚠ 必须测 **resolver** `stAiProtoOf`，只测 `stAiGuessProto` 会漏）
//   C2. 半成品 cfg（全局面板 apigGather 不给 proto ⇒ 兜底那一步必须存在）
//   D. gemini URL 三条路（快速模式**不带** projects/，完整模式带）
//      + **列模型候选表**（⚠ v1 的 projects.locations.publishers.models **没有 list 方法**，
//        候选第一条必须是 v1beta1）+ `publisherModels` 字段的解析（第二十轮补的）
//   E. gemini 请求体 + 取文 + **safetySettings** + **空响应为什么**（第二轮补的）
//   F. Service Account 解析与换 token（假私钥必须抛错，不能静默成功）
//   G. 弹窗 UI：Vertex 显隐 + 手输模型名
//   G2. SA JSON 掩码态 + 「验证 JSON」分步（第二轮补的）
//   H. apigReadyCheck 的必填判据（两种模式各自的必填项 + project 派生）
//   I. 主页【ai对话】走共用协议层（第十七轮并过去的）
//   J. 收尾
//
// ⚠⚠ 这一轮最值得记的一条：**「猜」和「决议」是两步，断言要打在决议上**。
//   上一版只给 `stAiGuessProto`（猜）写了断言，它猜得全对；而真正决定请求形状的是
//   `stAiProtoOf`（决议：先查预设表，查到就**不再猜**）—— 预设表里给 custom 写了
//   `proto:'openai'`，于是「自定义 + 粘 Anthropic 域名」按 OpenAI 形状发出去，
//   而所有断言照样全绿。**量得没错，但量错了对象。**（RULES 六之三十三）
const PAGE_FILE = 'G:/saki/saki.html';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { spawn } = require('child_process');

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].find(p => fs.existsSync(p));
if (!CHROME) { console.log('找不到 Chrome / Edge'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const fails = [];
function check(name, actual, pred, expect) {
  const ok = typeof pred === 'function' ? pred(actual) : actual === pred;
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; fails.push(name); console.log(`  ❌ ${name}  actual=${JSON.stringify(actual)}  expect=${expect === undefined ? pred : JSON.stringify(expect)}`); }
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

(async () => {
  const PORT = 8997;
  const dir = path.dirname(PAGE_FILE), base = path.basename(PAGE_FILE);
  const srv = http.createServer((req, rep) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const f = path.join(dir, u === '/' ? base : u.replace(/^\/+/, ''));
    fs.readFile(f, (e, buf) => {
      if (e) { rep.writeHead(404); rep.end('nope'); return; }
      const ext = path.extname(f).toLowerCase();
      rep.writeHead(200, {
        'Content-Type': ext === '.html' ? 'text/html; charset=utf-8' : 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      rep.end(buf);
    });
  });
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  console.log(`静态服务 http://127.0.0.1:${PORT}`);

  // ⚠⚠ 端口**不能写死**。这一套原来是 `const cdpPort = 9711;` —— 全 `_verify/` 里
  //   **只剩它一个**还写死（其余 16 套都走下面这段「先真绑一下」）。连跑整套时上一轮
  //   Chrome 还没退干净就会占着 9711，症状是「连不上 CDP」，**跟被测页面一点关系都没有**。
  //   2026-09-24 整跑实测：它紧跟 `apig-verify.js`，报 `1 通过 / 1 失败`。
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-smoke-'));
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu',
    '--no-first-run', '--hide-scrollbars',
    `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`], { stdio: 'ignore' });

  let cdp = null, SID = null;
  const ev = async (expr, awaitPromise = false, timeout = 40000) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise }, SID, timeout);
    if (r.exceptionDetails) {
      throw new Error('页面异常: ' + (r.exceptionDetails.exception
        ? r.exceptionDetails.exception.description : r.exceptionDetails.text));
    }
    return r.result.value;
  };

  try {
    let wsUrl = null;
    for (let i = 0; i < 60 && !wsUrl; i++) {
      await sleep(250);
      try {
        const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
        const pg = list.find(t => t.type === 'page');
        if (pg) wsUrl = pg.webSocketDebuggerUrl;
      } catch (e) {}
    }
    if (!wsUrl) throw new Error('连不上 CDP');
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    cdp = new CDP(ws);
    const { targetInfo } = await cdp.send('Target.getTargets').then(r => ({
      targetInfo: r.targetInfos.find(t => t.type === 'page')
    }));
    SID = (await cdp.send('Target.attachToTarget', { targetId: targetInfo.targetId, flatten: true })).sessionId;
    await cdp.send('Page.enable', {}, SID);
    await cdp.send('Runtime.enable', {}, SID);
    const errs = [];
    cdp.on('Runtime.exceptionThrown', p => {
      errs.push(String(p.exceptionDetails.exception ? p.exceptionDetails.exception.description : p.exceptionDetails.text));
    });
    // ⚠⚠ 这里原来是**盲等** `await sleep(2500)` —— 全 `_verify/` 里只剩它一个不等真实事件。
    //   连跑整套时（本套前面已经起了十几轮 Chrome、主页还要 `@import` 拉 Google Fonts）
    //   2500 ms **不够**：页面还没跑完内联脚本 ⇒ 紧接着的 `ev('AI_PROVIDERS…')` 抛
    //   `ReferenceError` ⇒ `ev()` 直接 throw ⇒ 整套只剩 **`1 通过 / 1 失败`**。
    //   ⚠ 而那条**通过**的恰恰是 `加载后没有未捕获异常` —— 因为**什么都还没跑**，自然零异常。
    //     这就是「跑不了」和「坏了」长得一模一样的又一例：**汇总行完全看不出是加载没完成**。
    //   ⇒ 一律等**真实事件**（`Page.loadEventFired` + `document.fonts.ready`），别赌时间。
    //   ⚠ 故意**不留超时回落**：回落会把「加载卡住」伪装成「跑过去了」（那种失败更难查）。
    //     真卡住的话 `ev()` 自己的 40 s 超时会抛出来，是**响的**失败。
    const loaded = new Promise(res => cdp.on('Page.loadEventFired', res));
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/${base}` }, SID);
    await loaded;
    await ev(`document.fonts.ready.then(() => true)`, true);
    await sleep(300);

    section('A. 页面加载零报错');
    check('加载后没有未捕获异常', errs.length, 0, 0);
    if (errs.length) errs.forEach(e => console.log('     ' + e.slice(0, 200)));

    section('B. 服务商表');
    const prov = await ev(`(function(){
      const seen = {}; const groups = [];
      AI_PROVIDERS.forEach(p => { if (!seen[p.group]) { seen[p.group] = 0; groups.push(p.group); } seen[p.group]++; });
      return {
        n: AI_PROVIDERS.length,
        groups: groups,
        counts: seen,
        last: AI_PROVIDERS[AI_PROVIDERS.length - 1].value,
        aliasSame: ST_AI_PROVIDERS === AI_PROVIDERS,
        // ⚠ 这里**不能**断言「每项 proto 都非空」—— custom 故意留空，
        //   表示「按 Base URL 猜」（见预设表里的注释）。断言方向本身就是需求：
        //   改成「除了 custom，其余每项都必须写死 proto」才立得住
        // ⚠ 这段在**模板字符串里** ⇒ 注释里绝不能出现反引号（会提前结束字符串）
        noProto: AI_PROVIDERS.filter(p => !p.proto).map(p => p.value),
        hasProtoKey: AI_PROVIDERS.filter(p => !('proto' in p)).map(p => p.value),
        noLabel: AI_PROVIDERS.filter(p => !p.label).map(p => p.value),
        dupValues: (function(){
          const s = {}; const d = [];
          AI_PROVIDERS.forEach(p => { if (s[p.value]) d.push(p.value); s[p.value] = 1; });
          return d;
        })()
      };
    })()`);
    console.log('     ' + JSON.stringify(prov.counts));
    check('服务商数量 ≥ 30', prov.n, v => v >= 30, '>=30');
    // ⚠⚠ 文档里那句「服务商表（N 项」是**没人管的数字** —— 本轮就漂了
    //   （README 写 38、表里实际 37）。这里给它一个观察者：两处必须相等。
    //   读不到那句话**也算失败** —— 回落（找不到就当通过）是把失败伪装成成功
    {
      const md = fs.readFileSync('G:/saki/markdown/README.md', 'utf8');
      const m = md.match(/服务商表\*\*（(\d+) 项/);
      check('⚠⚠ README 写的服务商条数 == 表里实际条数（否则它每次加项都会静默漂）',
        m ? Number(m[1]) : null, prov.n, prov.n);
    }
    check('custom 在末位（stAiProviderOf 的兜底）', prov.last, 'custom');
    check('ST_AI_PROVIDERS 与 AI_PROVIDERS 是同一张表', prov.aliasSame, true);
    check('⚠ 只有 custom 允许不写死 proto（它是「按 URL 猜」）',
      prov.noProto.join(','), 'custom', 'custom');
    check('（对照）proto 这个**键**每一项都要有（漏写键 = 拼错字段名）',
      prov.hasProtoKey.length, 0, 0);
    check('每项都有 label', prov.noLabel.length, 0, 0);
    check('value 无重复', prov.dupValues.length, 0, 0);
    check('含「国产 · 海外渠道」分组', prov.groups.indexOf('国产 · 海外渠道') >= 0, true);
    check('含 Google 分组', prov.groups.indexOf('Google') >= 0, true);

    section('C. 协议判定');
    const proto = await ev(`(function(){
      return {
        aiStudioNative: stAiProtoOf('gemini-native', 'https://generativelanguage.googleapis.com'),
        compatLayer: stAiProtoOf('gemini', 'https://generativelanguage.googleapis.com/v1beta/openai'),
        vertex: stAiProtoOf('vertex', 'https://aiplatform.googleapis.com'),
        anthropic: stAiProtoOf('anthropic', 'https://api.anthropic.com/v1'),
        deepseek: stAiProtoOf('deepseek', 'https://api.deepseek.com/v1'),
        customGeminiUrl: stAiGuessProto('https://aiplatform.googleapis.com', 'custom'),
        customCompatUrl: stAiGuessProto('https://generativelanguage.googleapis.com/v1beta/openai', 'custom'),
        customPlain: stAiGuessProto('https://api.example.com/v1', 'custom'),
        // ⚠⚠ 上面三条走的是**猜**（stAiGuessProto），而真正决定发什么形状的是
        //    **resolver**（stAiProtoOf）。只测猜 = 量错了对象 —— 上一版就是这里
        //    给 custom 写了 proto:'openai'，resolver 于是**整条跳过 URL**，
        //    粘 Anthropic 域名也按 openai 发，而这三条照样全绿
        resCustomGemini: stAiProtoOf('custom', 'https://aiplatform.googleapis.com'),
        resCustomAnthropic: stAiProtoOf('custom', 'https://api.anthropic.com/v1'),
        resCustomPlain: stAiProtoOf('custom', 'https://api.example.com/v1'),
        resCustomCompat: stAiProtoOf('custom', 'https://generativelanguage.googleapis.com/v1beta/openai'),
        // ⚠⚠ 这两条是**专门给预设表里那个 proto 字段造的观察者**。
        //   没有它们的话那个字段等于没人看着：上面每一条的 baseUrl 里都带
        //   anthropic / aiplatform / generativelanguage 这类关键词，**光靠猜也能猜对** ——
        //   把 stAiProtoOf 里「先查表」那一步删掉，整套照样全绿。
        //   空 baseUrl 时猜不出来（只能给 openai），**只有表能答**（RULES 六之三十一）
        // ⚠ 这段在**模板字符串里** ⇒ 注释里绝不能出现反引号（会提前结束字符串）
        resEmptyVertex: stAiProtoOf('vertex', ''),
        resEmptyAnthropic: stAiProtoOf('anthropic', ''),
        resEmptyGeminiNative: stAiProtoOf('gemini-native', '')
      };
    })()`);
    console.log('     ' + JSON.stringify(proto));
    check('AI Studio 原生 → gemini', proto.aiStudioNative, 'gemini');
    check('⚠ Gemini 兼容层 → openai（不能误判成 gemini）', proto.compatLayer, 'openai');
    check('Vertex → gemini', proto.vertex, 'gemini');
    check('Anthropic → anthropic', proto.anthropic, 'anthropic');
    check('DeepSeek → openai', proto.deepseek, 'openai');
    check('自定义 + aiplatform 域名 → gemini', proto.customGeminiUrl, 'gemini');
    check('⚠ 自定义 + 兼容层域名 → openai', proto.customCompatUrl, 'openai');
    check('自定义 + 普通域名 → openai', proto.customPlain, 'openai');
    // —— 下面这四条才是真正决定请求形状的那条链 ——
    check('⚠⚠ resolver：自定义 + aiplatform → gemini', proto.resCustomGemini, 'gemini');
    check('⚠⚠ resolver：自定义 + Anthropic 域名 → anthropic', proto.resCustomAnthropic, 'anthropic');
    check('resolver：自定义 + 普通域名 → openai', proto.resCustomPlain, 'openai');
    check('⚠⚠ resolver：自定义 + 兼容层 → openai', proto.resCustomCompat, 'openai');
    // ⚠ 空 baseUrl 时猜不出来（stAiGuessProto('') 只能给 openai）⇒ 这三条只有预设表答得上来。
    // ⚠⚠ 但**只有第三条是真的「只有表能答」**：`stAiGuessProto(baseUrl, provider)`
    //    **也会看 provider 这个名字** —— vertex / anthropic 这两个名字本身就是关键词，
    //    URL 空着也猜得对。它们绿着**不能**证明「表被查过」。
    //    `gemini-native` 这个名字里既没有 generativelanguage、也没有 aiplatform/vertex
    //    ⇒ 猜不出来 ⇒ 只有表能答。
    //    ⚠ 这一条是反向测试 R3 找出来的：原来三条都写着「只有表能答」，一注入才发现
    //      两条是假的。**说法比断言更容易骗人** —— 名字里写的主张也要有人验
    check('空 Base URL：vertex 仍判成 gemini（值里带 vertex，猜也能猜到）',
      proto.resEmptyVertex, 'gemini');
    check('空 Base URL：anthropic 仍判成 anthropic（值里带 anthropic，猜也能猜到）',
      proto.resEmptyAnthropic, 'anthropic');
    check('⚠⚠ 空 Base URL：gemini 原生仍判成 gemini（值里没关键词 ⇒ **只有表能答**）',
      proto.resEmptyGeminiNative, 'gemini');

    section('C2. 半成品 cfg（全局面板 apigGather 不给 proto）');
    const ensure = await ev(`(function(){
      // apigGather() 返回的对象里**没有 proto** —— 全局面板的「获取模型」和
      // 「测试连接」就是拿这种对象调 stAiFetchModels / stAiRequest 的。
      // 少了兜底，gemini / vertex 会按 openai 发出去（Bearer 打 Google）
      const a = { provider:'vertex', baseUrl:'https://aiplatform.googleapis.com',
                  model:'gemini-2.5-flash', apiKey:'K', authMode:'key', location:'global' };
      const b = { provider:'gemini-native', baseUrl:'https://generativelanguage.googleapis.com' };
      const c = { provider:'custom', baseUrl:'https://api.anthropic.com/v1' };
      const before = [a, b, c].map(x => String(x.proto)).join('/');
      stAiEnsureProto(a); stAiEnsureProto(b); stAiEnsureProto(c);
      const sa = { provider:'vertex', baseUrl:'https://aiplatform.googleapis.com', model:'gemini-2.5-flash',
                   apiKey:'', authMode:'sa', project:'my-proj', location:'us-central1' };
      stAiEnsureProto(sa);
      return { before: before, after: [a.proto, b.proto, c.proto].join('/'),
               planUrl: stAiRequest(a, [{role:'user',content:'hi'}], { stream:false }).url,
               saUrl: stAiRequest(sa, [{role:'user',content:'hi'}], { stream:false }).url,
               saNeedsToken: stAiRequest(sa, [{role:'user',content:'hi'}], { stream:false }).needsToken,
               saPlanKey: String(stAiRequest(sa, [{role:'user',content:'hi'}], { stream:false })
                   .headers['x-goog-api-key']),
               saPlanBearer: !!stAiRequest(sa, [{role:'user',content:'hi'}], { stream:false })
                   .headers.Authorization,
               planKey: stAiRequest(a, [{role:'user',content:'hi'}], { stream:false }).headers['x-goog-api-key'],
               planBearer: !!stAiRequest(a, [{role:'user',content:'hi'}], { stream:false }).headers.Authorization };
    })()`);
    check('补之前 proto 是空的（对照组：证明这一步真的做了事）', ensure.before, 'undefined/undefined/undefined');
    check('⚠ vertex 半成品补成 gemini', ensure.after.split('/')[0], 'gemini');
    check('⚠ gemini 原生半成品补成 gemini', ensure.after.split('/')[1], 'gemini');
    check('⚠ 自定义半成品按 URL 补成 anthropic', ensure.after.split('/')[2], 'anthropic');
    // ⚠ 快速模式（Express）的路径**不带 projects/**，只有完整模式才带 ——
    //   这里曾经断言错成「一定带 projects/」，红的是断言不是产品
    check('⚠ 补完之后是 Vertex 快速模式的 URL 形状（publishers/google/models，不带 projects）',
      /^https:\/\/aiplatform\.googleapis\.com\/v1\/publishers\/google\/models\/gemini-2\.5-flash:generateContent$/.test(ensure.planUrl), true);
    check('（对照）快速模式的 URL 里**不**出现 projects/', /projects\//.test(ensure.planUrl), false);
    check('⚠ 完整模式的 URL 带 projects / locations',
      /^https:\/\/us-central1-aiplatform\.googleapis\.com\/v1\/projects\/my-proj\/locations\/us-central1\/publishers\/google\/models\/gemini-2\.5-flash:generateContent$/.test(ensure.saUrl), true);
    check('⚠ 完整模式要标 needsToken（调用方才知道去换 token）', ensure.saNeedsToken, true);
    // ⚠ 完整模式的 plan 里**一个鉴权头都不该有** —— token 是 stAiPlanAuth 后来加的。
    //   要是顺手把 API Key 也塞进去，请求会带着一个无效 Key + 没有 token 发出去，
    //   服务端报的还是含糊的 401（看着像「Key 填错了」，其实是模式选错了）
    check('⚠ 完整模式的 plan 里**不**带 x-goog-api-key（Key 那一栏本来是空的）',
      ensure.saPlanKey, 'undefined');
    check('（对照）完整模式的 plan 里也**不**带 Authorization（token 还没换）',
      ensure.saPlanBearer, false);
    check('⚠ 补完之后带的是 x-goog-api-key（不是 Bearer）', ensure.planKey, 'K');
    check('（对照）补完之后**不**带 Authorization', ensure.planBearer, false);

    section('D. gemini URL 三条路');
    const urls = await ev(`(function(){
      const mk = o => Object.assign({ provider:'vertex', proto:'gemini', baseUrl:'https://aiplatform.googleapis.com',
        model:'gemini-2.5-flash', apiKey:'K', authMode:'key', project:'', location:'global' }, o);
      return {
        studio: stAiGeminiUrl({ provider:'gemini-native', proto:'gemini', model:'gemini-2.5-flash' }, 'gemini-2.5-flash', false),
        studioStream: stAiGeminiUrl({ provider:'gemini-native', proto:'gemini' }, 'gemini-2.5-flash', true),
        vxKey: stAiGeminiUrl(mk({}), 'gemini-2.5-flash', false),
        vxKeyStream: stAiGeminiUrl(mk({}), 'gemini-2.5-flash', true),
        vxSa: stAiGeminiUrl(mk({ authMode:'sa', project:'my-proj', location:'us-central1' }), 'gemini-2.5-flash', false),
        vxSaGlobal: stAiGeminiUrl(mk({ authMode:'sa', project:'my-proj', location:'global' }), 'gemini-2.5-flash', false),
        models: stAiGeminiModelsUrl(mk({})),
        modelUrls: stAiGeminiModelsUrls(mk({})),
        modelUrlsSa: stAiGeminiModelsUrls(mk({ authMode:'sa', project:'p', location:'europe-west4' })),
        modelUrlsStudio: stAiGeminiModelsUrls({ provider:'gemini-native', proto:'gemini' }),
        modelIdsPublisher: stAiModelIds({ publisherModels: [
          { name: 'publishers/google/models/gemini-2.5-pro' },
          { name: 'publishers/google/models/gemini-2.5-flash' },
          { name: 'publishers/google/models/gemini-2.5-pro' } ] }),
        hints: ST_GEMINI_MODEL_HINTS.slice(0, 3),
        stripModels: stAiGeminiModel('models/gemini-2.5-pro'),
        stripGoogle: stAiGeminiModel('google/gemini-2.5-pro'),
        stripBoth: stAiGeminiModel('publishers/google/models/gemini-2.5-pro')
      };
    })()`);
    console.log('     ' + JSON.stringify(urls, null, 1).split('\n').join('\n     '));
    check('AI Studio 原生 URL', urls.studio,
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    check('AI Studio 流式带 alt=sse', urls.studioStream,
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse');
    check('Vertex 快速模式 URL（无 projects 段）', urls.vxKey,
      'https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash:generateContent');
    check('Vertex 快速模式流式', urls.vxKeyStream,
      'https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash:streamGenerateContent?alt=sse');
    check('Vertex 完整模式 URL（带 projects/locations）', urls.vxSa,
      'https://us-central1-aiplatform.googleapis.com/v1/projects/my-proj/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent');
    check('⚠ location=global 时端点**不带地区前缀**', urls.vxSaGlobal,
      'https://aiplatform.googleapis.com/v1/projects/my-proj/locations/global/publishers/google/models/gemini-2.5-flash:generateContent');
    // ⚠⚠ 列模型：**v1 的 `projects.locations.publishers.models` 没有 `list` 方法**
    //   （官方 REST 目录里那条资源只有 computeTokens / countTokens / embedContent /
    //     generateContent / predict / rawPredict / stream*），v1 的 `publishers.models`
    //   也只有 `get`。真正有 `list` 的是 **v1beta1 的 `publishers.models`**。
    //   ⇒ 断言写成「顺序 + 条数」，不然「只留一条错的」也能过
    check('（兼容壳）stAiGeminiModelsUrl 就是候选表的第一条', urls.models, urls.modelUrls[0]);
    check('⚠ 列模型候选：第一条是 v1beta1（v1 那条没有 list 方法）',
      urls.modelUrls[0], 'https://aiplatform.googleapis.com/v1beta1/publishers/google/models');
    check('⚠ 列模型候选：快速模式只有 1 条（没有 project 就拼不出带 project 的路径）',
      urls.modelUrls.length, 1);
    check('⚠ 列模型候选：完整模式 3 条（v1beta1 无 project / v1beta1 带 project / v1 垫底）',
      urls.modelUrlsSa.length, 3);
    check('⚠ 列模型候选：v1 那条只能垫底',
      urls.modelUrlsSa[2],
      'https://europe-west4-aiplatform.googleapis.com/v1/projects/p/locations/europe-west4/publishers/google/models');
    check('⚠ 列模型候选：AI Studio 只有一条（不做多路径尝试）',
      urls.modelUrlsStudio.join('|'), 'https://generativelanguage.googleapis.com/v1beta/models');
    // ⚠⚠ Vertex 回的字段叫 `publisherModels` —— 少了这一支，URL 蒙对了也得到空列表，
    //   报出来是「返回里没有模型」，看着像「这个账号没权限」。去重 + 剥前缀也要一起对
    check('⚠⚠ 列模型解析：认 publisherModels，剥掉 publishers/google/models/ 前缀并去重',
      urls.modelIdsPublisher.join(','), 'gemini-2.5-flash,gemini-2.5-pro');
    check('⚠ 列不出来时有内置候选兜底（不是白名单，只是起点）',
      urls.hints.length, v => v >= 3, '>=3');
    check('剥 models/ 前缀', urls.stripModels, 'gemini-2.5-pro');
    check('剥 google/ 前缀', urls.stripGoogle, 'gemini-2.5-pro');
    check('剥 publishers/google/models/ 前缀', urls.stripBoth, 'gemini-2.5-pro');

    section('E. gemini 请求体 + 取文');
    const body = await ev(`(function(){
      const cfg = { provider:'gemini-native', proto:'gemini', model:'m', apiKey:'K',
        temperature:0.5, maxTokens:1024, baseUrl:'https://generativelanguage.googleapis.com' };
      const plan = stAiRequest(cfg, [
        { role:'system', content:'SYS-A' },
        { role:'user', content:'U1' },
        { role:'assistant', content:'A1' },
        { role:'user', content:'U2' }
      ], { stream:false, temperature:0.5, maxTokens:1024 });
      const onlySys = stAiRequest(cfg, [{ role:'system', content:'only' }], { stream:false });
      const firstAsst = stAiRequest(cfg, [{ role:'assistant', content:'hi' }], { stream:false });
      return {
        url: plan.url, proto: plan.proto, needsToken: plan.needsToken,
        keyHeader: plan.headers['x-goog-api-key'],
        hasAuthz: !!plan.headers['Authorization'],
        ct: plan.headers['Content-Type'],
        sys: plan.body.systemInstruction,
        contents: plan.body.contents,
        gc: plan.body.generationConfig,
        onlySysContents: onlySys.body.contents,
        firstAsstContents: firstAsst.body.contents,
        text: stAiFullText('gemini', { candidates:[{ content:{ parts:[{text:'AB'},{text:'CD'},{thought:true}] } }] }),
        sse: stAiSseText('gemini', { candidates:[{ content:{ parts:[{text:'X'}] } }] }),
        empty: stAiFullText('gemini', {}),
        blocked: stAiFullText('gemini', { promptFeedback:{ blockReason:'SAFETY' } }),
        // 安全阈值（照抄酒馆的 GEMINI_SAFETY / VERTEX_SAFETY）
        safety: plan.body.safetySettings,
        safetyVertex: stAiRequest(Object.assign({}, cfg, { provider:'vertex', authMode:'key',
          baseUrl:'https://aiplatform.googleapis.com' }), [{role:'user',content:'hi'}], {stream:false})
          .body.safetySettings,
        // 「为什么一个字都没有」—— 空响应必须说得出原因
        whyBlocked: stAiWhyEmpty('gemini', { promptFeedback:{ blockReason:'SAFETY' } }),
        whyNoCand: stAiWhyEmpty('gemini', {}),
        whySafety: stAiWhyEmpty('gemini', { candidates:[{ finishReason:'SAFETY' }] }),
        whyMax: stAiWhyEmpty('gemini', { candidates:[{ finishReason:'MAX_TOKENS' }] }),
        whyStop: stAiWhyEmpty('gemini', { candidates:[{ finishReason:'STOP' }] }),
        whyFilter: stAiWhyEmpty('openai', { choices:[{ finish_reason:'content_filter' }] }),
        whyRefusal: stAiWhyEmpty('anthropic', { stop_reason:'refusal' })
      };
    })()`);
    check('gemini plan 带 x-goog-api-key', body.keyHeader, 'K');
    check('gemini 快速模式**不**带 Authorization', body.hasAuthz, false);
    check('gemini plan 标了 needsToken=false', body.needsToken, false);
    check('system 抽进 systemInstruction', body.sys && body.sys.parts[0].text, 'SYS-A');
    check('contents 三条（system 不在里面）', body.contents.length, 3);
    check('assistant 映射成 model', body.contents[1].role, 'model');
    check('user 保持 user', body.contents[2].role, 'user');
    check('generationConfig.temperature', body.gc.temperature, 0.5);
    check('generationConfig.maxOutputTokens', body.gc.maxOutputTokens, 1024);
    check('⚠ 只有 system 时 contents 仍非空', body.onlySysContents.length, 1);
    check('⚠ 只有 system 时补的第一条是 user', body.onlySysContents[0].role, 'user');
    check('⚠ 首条是 assistant 时补一条 user 在前面', body.firstAsstContents[0].role, 'user');
    check('取文只挑有 text 的 part', body.text, 'ABCD');
    check('SSE 取文', body.sse, 'X');
    check('空响应取文不炸', body.empty, '');
    check('被安全拦截时取文不炸', body.blocked, '');
    // ⚠⚠ safetySettings：不发它 Gemini 就按**默认策略**拦，角色扮演很容易撞上，
    //   而表现是 candidates 根本不存在 ⇒ 前端拿到空串、看着像「AI 没说话」
    check('⚠ 请求体带 safetySettings（不发就会被默认策略拦）',
      body.safety, v => Array.isArray(v) && v.length === 5, '5 条');
    // ⚠⚠ 取元素一律 `(x || [])` —— 注入把它整个删掉时，`undefined.every` 会抛，
    //   套件会**当场炸掉、连汇总行都没有**，反向测试拿不到「红了几条」，
    //   那一针就等于白跑（RULES 六之二十六：新断言要崩不掉）。
    // ⚠⚠ **但 `[].every(...)` 恒为 `true`** —— 光加 `|| []` 会把这条变成
    //   「**天生为真**」：整个字段被删掉时它**照样绿**（第十九轮反向测试 R3 实测：
    //   注入删掉 `body.safetySettings` 之后，这一条没红，而它名字里写的正是这件事）。
    //   ⇒ 形状必须是「**数出来跟期望比**」：字段没了 ⇒ 0 ≠ 5 ⇒ 红；
    //     阈值写错 ⇒ 少于 5 条是 OFF ⇒ 红。**既崩不掉、也不会永远为真。**
    check('⚠ 阈值全是 OFF（照抄酒馆，不是 BLOCK_NONE）',
      (body.safety || []).filter(x => x && x.threshold === 'OFF').length, 5);
    check('⚠ Vertex 比 AI Studio 多 5 类（含 JAILBREAK）',
      body.safetyVertex, v => Array.isArray(v) && v.length === 10, '10 条');
    check('⚠ Vertex 那份里有 HARM_CATEGORY_JAILBREAK',
      (body.safetyVertex || []).some(x => x.category === 'HARM_CATEGORY_JAILBREAK'), true);
    // 空响应必须说得出原因（空串是合法返回值，「被拦」和「真空」本来长得一样）
    check('⚠ 提示词被拦 → 说出 blockReason', body.whyBlocked,
      v => !!v && v.indexOf('SAFETY') >= 0, '含 SAFETY');
    check('⚠ 没有 candidates → 也说得出原因', body.whyNoCand, v => !!v, '非空');
    check('⚠ finishReason=SAFETY → 说出被中断', body.whySafety,
      v => !!v && v.indexOf('SAFETY') >= 0, '含 SAFETY');
    check('⚠ MAX_TOKENS → 明说是被截断', body.whyMax,
      v => !!v && v.indexOf('MAX_TOKENS') >= 0, '含 MAX_TOKENS');
    check('（对照）正常 STOP 不算错，返回空串', body.whyStop, '');
    check('⚠ OpenAI 的 content_filter 也说得出来', body.whyFilter,
      v => !!v && v.indexOf('content_filter') >= 0, '含 content_filter');
    check('⚠ Anthropic 的 refusal 也说得出来', body.whyRefusal,
      v => !!v && v.indexOf('refusal') >= 0, '含 refusal');

    section('F. Service Account 解析与换 token');
    const sa = await ev(`(async function(){
      const out = {};
      out.badJson = stAiSaParse('{ not json');
      out.missing = stAiSaParse('{"type":"service_account","project_id":"p"}');
      out.ok = stAiSaParse(JSON.stringify({ type:'service_account', project_id:'proj-1',
        client_email:'a@b.iam.gserviceaccount.com', private_key:'-----BEGIN PRIVATE KEY-----\\nxx\\n-----END PRIVATE KEY-----\\n',
        token_uri:'https://oauth2.googleapis.com/token' }));
      out.hasCrypto = !!(window.crypto && crypto.subtle);
      // 私钥是假的 ⇒ 必须**报错**而不是静默成功
      try { await stAiSaAccessToken(JSON.stringify({ client_email:'a@b.c', private_key:'-----BEGIN PRIVATE KEY-----\\nAAAA\\n-----END PRIVATE KEY-----\\n' })); out.threw = false; }
      catch (e) { out.threw = true; out.msg = String(e && e.message || e).slice(0,80); }
      return out;
    })()`, true);
    check('坏 JSON → ok=false', sa.badJson.ok, false);
    check('缺 client_email/private_key → ok=false', sa.missing.ok, false);
    check('完整 JSON → ok=true 且解析出 email', sa.ok.ok && sa.ok.email, 'a@b.iam.gserviceaccount.com');
    check('token_uri 默认值兜底', sa.ok.tokenUri, 'https://oauth2.googleapis.com/token');
    check('环境有 WebCrypto', sa.hasCrypto, true);
    check('假私钥必须抛错（不能静默成功）', sa.threw, true);
    // ⚠ 只查「抛没抛」不够：把 importKey 的错误吞掉，后面 `subtle.sign(key=null)`
    //   照样会抛 —— `threw` 还是 true，而用户看到的是一句
    //   「parameter 2 is not of type CryptoKey」的天书。所以还要查**说的是不是那件事**
    //   （这条是反向测试反过来找出来的：那一针原本**无可观测效果**）
    check('⚠ 报的错要说清是**私钥**读不出来（不能是后面某步顺带炸的）',
      /私钥/.test(sa.msg), true);
    console.log('     抛的是：' + sa.msg);

    section('G. 弹窗 UI：Vertex 显隐 + 手输模型');
    await ev(`openApiGlobalModal()`);
    await sleep(200);
    const ui1 = await ev(`(function(){
      const box = document.getElementById('apig-vertex-box');
      return {
        modalOpen: document.getElementById('apiGlobalModal').classList.contains('active'),
        boxHidden: box.hidden,
        boxDisplay: getComputedStyle(box).display,
        modelTag: document.getElementById('apig-model').tagName,
        modelListTag: document.getElementById('apig-model-list').tagName,
        providerOptgroups: document.querySelectorAll('#apig-provider optgroup').length,
        providerOptions: document.querySelectorAll('#apig-provider option').length
      };
    })()`);
    check('弹窗打开了', ui1.modalOpen, true);
    check('非 Vertex 服务商时 Vertex 块是 hidden', ui1.boxHidden, true);
    check('⚠ hidden 时 computed display 真的是 none（flex 没盖掉它）', ui1.boxDisplay, 'none');
    check('模型是 INPUT（可手输）', ui1.modelTag, 'INPUT');
    check('模型配了 DATALIST', ui1.modelListTag, 'DATALIST');
    check('服务商下拉有分组', ui1.providerOptgroups, v => v >= 5, '>=5');
    check('服务商选项数 ≥ 30', ui1.providerOptions, v => v >= 30, '>=30');

    // 切到 vertex
    const ui2 = await ev(`(function(){
      const sel = document.getElementById('apig-provider');
      sel.value = 'vertex';
      syncApigProviderUI();
      const box = document.getElementById('apig-vertex-box');
      const keyF = document.getElementById('apig-key-field');
      const projF = document.getElementById('apig-project-field');
      const saF = document.getElementById('apig-sa-field');
      const locF = document.getElementById('apig-location-field');
      return {
        boxHidden: box.hidden, boxDisplay: getComputedStyle(box).display,
        authMode: document.getElementById('apig-auth-mode').value,
        baseUrl: document.getElementById('apig-base-url').value,
        keyHidden: keyF.hidden, projHidden: projF.hidden, saHidden: saF.hidden, locHidden: locF.hidden
      };
    })()`);
    check('切到 Vertex 后块显示出来', ui2.boxHidden, false);
    check('显示时 display 是 flex', ui2.boxDisplay, 'flex');
    check('默认是快速模式', ui2.authMode, 'key');
    check('Base URL 自动填 Vertex 端点', ui2.baseUrl, 'https://aiplatform.googleapis.com');
    check('快速模式：API Key 格可见', ui2.keyHidden, false);
    check('快速模式：project 格隐藏', ui2.projHidden, true);
    check('快速模式：SA JSON 格隐藏', ui2.saHidden, true);
    check('区域格可见', ui2.locHidden, false);

    const ui3 = await ev(`(function(){
      document.getElementById('apig-auth-mode').value = 'sa';
      syncApigAuthUI();
      return {
        keyHidden: document.getElementById('apig-key-field').hidden,
        projHidden: document.getElementById('apig-project-field').hidden,
        saHidden: document.getElementById('apig-sa-field').hidden,
        note: document.getElementById('apig-vertex-note').textContent.slice(0, 30)
      };
    })()`);
    check('完整模式：API Key 格隐藏', ui3.keyHidden, true);
    check('完整模式：project 格显示', ui3.projHidden, false);
    check('完整模式：SA JSON 格显示', ui3.saHidden, false);
    console.log('     提示文案：' + ui3.note);

    section('G2. SA JSON 掩码态 + 「验证 JSON」分步');

    // 一份**形状正确**的假 Service Account（私钥是假的 ⇒ 第③步必然失败，
    // 正好用来验证「分步」真的会停在该停的地方）
    const FAKE_SA = await ev(`(function(){
      return JSON.stringify({ type:'service_account',
        client_email:'svc@demo.iam.gserviceaccount.com',
        private_key:'-----BEGIN PRIVATE KEY----- AAAA -----END PRIVATE KEY-----',
        token_uri:'https://oauth2.googleapis.com/token', project_id:'demo-proj' });
    })()`);

    const mask1 = await ev(`(function(){
      document.getElementById('apig-auth-mode').value = 'sa';
      syncApigAuthUI();
      document.getElementById('apig-sa').value = ${JSON.stringify(FAKE_SA)};
      apigSaDraft = ${JSON.stringify(FAKE_SA)};
      apigSaRender();
      const box = document.getElementById('apig-sa-masked');
      return {
        boxHidden: box.hidden,
        boxDisplay: getComputedStyle(box).display,
        taHidden: document.getElementById('apig-sa').hidden,
        who: document.getElementById('apig-sa-who').textContent,
        verifyBtn: !!document.getElementById('apig-verify-btn'),
        outHidden: document.getElementById('apig-verify-out').hidden,
        gathered: apigGather().saJson.length
      };
    })()`);
    check('⚠ 存过之后进掩码态（不把私钥摊在屏幕上）', mask1.boxHidden, false);
    check('掩码条真的是 flex 显示', mask1.boxDisplay, 'flex');
    check('⚠ 掩码时 textarea 藏起来', mask1.taHidden, true);
    check('⚠ 掩码条只说「存的是哪一份」（client_email · project_id）', mask1.who,
      v => v.indexOf('svc@demo.iam.gserviceaccount.com') >= 0 && v.indexOf('demo-proj') >= 0,
      '含邮箱与项目');
    check('「验证 JSON」按钮在 DOM 里', mask1.verifyBtn, true);
    check('验证结果区初始是 hidden', mask1.outHidden, true);
    // ⚠⚠ 这条盯的是**掩码态下保存会不会抹掉密钥**：apigGather 读的是 textarea，
    //   掩码只是 hidden、value 还在 ⇒ 拿得到。要是哪天改成「掩码时清空 textarea」，
    //   用户打开面板看一眼再点保存，密钥就没了 —— 而且没有任何报错
    check('⚠⚠ 掩码态下 apigGather 仍拿得到那份 JSON', mask1.gathered, v => v > 50, '>50');

    const mask2 = await ev(`(function(){
      apigSaEditMode();
      const ta = document.getElementById('apig-sa');
      return { taHidden: ta.hidden,
               boxHidden: document.getElementById('apig-sa-masked').hidden,
               stillHas: ta.value.length };
    })()`);
    check('「换一份」把 textarea 显出来', mask2.taHidden, false);
    check('（对照）掩码条同时藏起来', mask2.boxHidden, true);
    check('⚠ 「换一份」**不清空**已有内容（改主意直接保存不会丢）', mask2.stillHas, v => v > 50, '>50');

    // ① 语法错 ⇒ 只报 ①，不许往下走（也不许发任何网络请求）
    await ev(`(function(){
      document.getElementById('apig-sa').value = '{ 这不是 JSON';
      apigSaDraft = '{ 这不是 JSON';
      return apigVerifyJson();
    })()`, true);
    const v1 = await ev(`document.getElementById('apig-verify-out').textContent`);
    check('⚠ 语法错时报告 ① 并停下', v1, v => v.indexOf('①') >= 0 && v.indexOf('②') < 0,
      '只有 ①');
    check('语法错时指出「粘漏了 { 或 }」', v1, v => v.indexOf('JSON 不合法') >= 0, '含 JSON 不合法');

    // ② 合法 JSON 但缺字段 ⇒ 停在 ②
    await ev(`(function(){
      document.getElementById('apig-sa').value = '{"foo":1}';
      apigSaDraft = '{"foo":1}';
      return apigVerifyJson();
    })()`, true);
    const v2 = await ev(`document.getElementById('apig-verify-out').textContent`);
    check('⚠ 缺 client_email 时报告 ② 并停下', v2,
      v => v.indexOf('②') >= 0 && v.indexOf('③') < 0, '只有 ①②');
    check('② 的报错点名缺了哪个字段', v2, v => v.indexOf('client_email') >= 0, '含 client_email');

    // ③ 形状对了但私钥是假的 ⇒ 停在 ③，且**不许**说 ⑤（说明它没乱发网络请求）
    await ev(`(function(){
      document.getElementById('apig-sa').value = ${JSON.stringify(FAKE_SA)};
      apigSaDraft = ${JSON.stringify(FAKE_SA)};
      return apigVerifyJson();
    })()`, true);
    const v3 = await ev(`document.getElementById('apig-verify-out').textContent`);
    check('⚠ 假私钥时报告 ③ 并停下', v3,
      v => v.indexOf('③') >= 0 && v.indexOf('④') < 0, '只到 ③');
    check('⚠ ①② 在假私钥下是绿的（证明前两步真的跑过了）', v3,
      v => v.indexOf('① JSON 合法') >= 0 && v.indexOf('② 必填字段齐') >= 0, '含 ① ②');
    check('⚠ 没走到换 token 那一步（前四步是纯本地的）', v3, v => v.indexOf('access token') < 0,
      '不含 access token');

    section('H. apigReadyCheck 的必填判据');
    const ready = await ev(`(function(){
      // ⚠⚠ 必须用**形状正确**的假 Service Account JSON。早先这里用的是 '{}'，
      //   那连 client_email 都没有 —— stAiSaParse 第一步就把它拒了，
      //   于是「缺 project」「配齐」这两条**测的都是「JSON 本身不合法」**，
      //   跟 project 一点关系没有（两条一起假绿，改了 project 逻辑也不红）
      const saBase = { type:'service_account',
        client_email:'svc@my-proj.iam.gserviceaccount.com',
        private_key:'-----BEGIN PRIVATE KEY-----\\\\nAAAA\\\\n-----END PRIVATE KEY-----\\\\n',
        token_uri:'https://oauth2.googleapis.com/token' };
      const saWithProj = JSON.stringify(Object.assign({ project_id:'my-proj' }, saBase));
      const saNoProjJson = JSON.stringify(saBase);
      const base = { provider:'vertex', proto:'gemini', baseUrl:'https://aiplatform.googleapis.com',
        model:'gemini-2.5-flash', apiKey:'', authMode:'key', project:'', location:'global', saJson:'' };
      return {
        keyNoKey: apigReadyCheck(Object.assign({}, base)),
        keyOk: apigReadyCheck(Object.assign({}, base, { apiKey:'K' })),
        keyNoModel: apigReadyCheck(Object.assign({}, base, { apiKey:'K', model:'' })),
        saNoJson: apigReadyCheck(Object.assign({}, base, { authMode:'sa' })),
        saNoProj: apigReadyCheck(Object.assign({}, base, { authMode:'sa', saJson:saNoProjJson })),
        saOk: apigReadyCheck(Object.assign({}, base, { authMode:'sa', saJson:saWithProj })),
        // 新增：project 的**派生**行为（酒馆的 getProjectIdFromServiceAccount）
        saDerived: stAiVertexProject({ authMode:'sa', saJson:saWithProj, project:'' }),
        saTypedWins: stAiVertexProject({ authMode:'sa', saJson:saWithProj, project:'typed-p' }),
        plainNoKey: apigReadyCheck({ provider:'openai', proto:'openai', baseUrl:'https://api.openai.com/v1', apiKey:'', model:'m' }),
        plainOk: apigReadyCheck({ provider:'openai', proto:'openai', baseUrl:'https://api.openai.com/v1', apiKey:'k', model:'m' }),
        localNoKey: apigReadyCheck({ provider:'ollama', proto:'openai', baseUrl:'http://localhost:11434/v1', apiKey:'', model:'m' })
      };
    })()`);
    check('快速模式缺 Key → 报错', ready.keyNoKey, v => !!v && v.indexOf('API Key') >= 0, '含 API Key');
    check('快速模式配齐 → 通过', ready.keyOk, '');
    check('缺模型名 → 报错', ready.keyNoModel, v => !!v && v.indexOf('模型') >= 0, '含 模型');
    check('完整模式缺 JSON → 报错', ready.saNoJson, v => !!v && v.indexOf('Service Account') >= 0, '含 Service Account');
    check('完整模式缺 project → 报错', ready.saNoProj, v => !!v && v.indexOf('project') >= 0, '含 project');
    check('完整模式配齐 → 通过', ready.saOk, '');
    // ⚠ 这两条是**本轮新行为**的观察者：project 不再要求手填，改成从 SA JSON 的
    //   project_id 派生（酒馆的 getProjectIdFromServiceAccount）。删掉派生那一步就红
    check('⚠ 完整模式：project 从 SA JSON 自动派生', ready.saDerived, 'my-proj');
    check('⚠ 完整模式：手填的 project 优先于 JSON 里的', ready.saTypedWins, 'typed-p');
    check('普通服务商缺 Key → 报错', ready.plainNoKey, v => !!v, '非空');
    check('普通服务商配齐 → 通过', ready.plainOk, '');
    check('本地地址可以不填 Key', ready.localNoKey, '');

    // ⚠⚠ H2 是**补一个覆盖缺口**：`apigReadyCheck`（全局面板）被测了，而
    //   `stAiReady`（编写器 / 【ai对话】那条路）**一条断言都没有**。
    //   而这一轮最硬的 bug 恰好在它里面：完整模式下 `apiKey` **本来就是空的**
    //   （鉴权走 Service Account 换的 token），通用那条「没填 Key」检查会把它拦下
    //   ⇒ 完整模式**永远跑不起来**，而且**没有任何断言会红**。
    section('H2. stAiReady 的 Vertex 分支（完整模式 apiKey 本来就是空的）');
    const ready2 = await ev(`(function(){
      const sa = JSON.stringify({ type:'service_account',
        client_email:'svc@demo.iam.gserviceaccount.com',
        private_key:'-----BEGIN PRIVATE KEY----- AAAA -----END PRIVATE KEY-----',
        token_uri:'https://oauth2.googleapis.com/token', project_id:'demo-proj' });
      const base = { mode:'own', provider:'vertex', proto:'gemini',
        baseUrl:'https://aiplatform.googleapis.com', model:'gemini-2.5-flash',
        apiKey:'', authMode:'key', project:'', location:'global', saJson:'' };
      return {
        saOk: stAiReady(Object.assign({}, base, { authMode:'sa', saJson:sa })),
        saNoJson: stAiReady(Object.assign({}, base, { authMode:'sa' })),
        keyNoKey: stAiReady(Object.assign({}, base)),
        keyOk: stAiReady(Object.assign({}, base, { apiKey:'K' })),
        noModel: stAiReady(Object.assign({}, base, { apiKey:'K', model:'' })),
        // 项目派生在 stAiReady 里也要生效（跟 apigReadyCheck 同一套判据）
        saNoProjAtAll: stAiReady(Object.assign({}, base, { authMode:'sa',
          saJson: JSON.stringify({ type:'service_account',
            client_email:'svc@demo.iam.gserviceaccount.com',
            private_key:'-----BEGIN PRIVATE KEY----- AAAA -----END PRIVATE KEY-----',
            token_uri:'https://oauth2.googleapis.com/token' }) }))
      };
    })()`);
    check('⚠⚠ 完整模式（apiKey 空 + SA JSON 齐）→ 通过（别被「没填 Key」拦下）',
      ready2.saOk.ok, true);
    check('⚠ 完整模式缺 SA JSON → 明说是 Service Account',
      ready2.saNoJson.why, v => v.indexOf('Service Account') >= 0, '含 Service Account');
    check('（对照）快速模式缺 Key → 照样报错', ready2.keyNoKey.ok, false);
    check('（对照）快速模式配齐 → 通过', ready2.keyOk.ok, true);
    check('（对照）缺模型名 → 报错', ready2.noModel.ok, false);
    check('⚠ 完整模式：JSON 里没 project_id 也没手填 → 明说缺项目',
      ready2.saNoProjAtAll.why, v => !!v && v.indexOf('project') >= 0, '含 project');

    section('I. 主页【ai对话】走共用协议层');
    const eff = await ev(`(function(){
      // 故意把 provider 设成 gemini-native，看 aiEffectiveCfg 认不认
      const keep = JSON.parse(JSON.stringify(aiConfig));
      aiConfig.provider = 'gemini-native';
      aiConfig.baseUrl = 'https://generativelanguage.googleapis.com';
      aiConfig.apiKey = 'KK';
      aiConfig.model = 'gemini-2.5-flash';
      const cfg = aiEffectiveCfg();
      const plan = stAiRequest(cfg, [{ role:'user', content:'hi' }], { stream:false });
      const r = { proto: cfg.proto, url: plan.url, key: plan.headers['x-goog-api-key'] };
      Object.keys(keep).forEach(k => { aiConfig[k] = keep[k]; });
      return r;
    })()`);
    check('aiEffectiveCfg 认出 gemini 协议', eff.proto, 'gemini');
    check('主页对话也拼得出 gemini URL', eff.url,
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    check('主页对话带 x-goog-api-key', eff.key, 'KK');

    section('J. 收尾');
    await ev(`closeApiGlobalModal()`);
    await sleep(150);
    const tail = await ev(`(function(){
      const bad = [];
      document.querySelectorAll('#apiGlobalModal [id]').forEach(el => {
        if (el.id.indexOf('apig-') === 0 && !el.closest('#apiGlobalModal')) bad.push(el.id);
      });
      return { bad: bad, dupApigIds: (function(){
        const s = {}; const d = [];
        document.querySelectorAll('#apiGlobalModal [id]').forEach(el => { if (s[el.id]) d.push(el.id); s[el.id] = 1; });
        return d;
      })() };
    })()`);
    check('apig-* 元素都在弹窗内', tail.bad.length, 0, 0);
    check('弹窗内无重复 id', tail.dupApigIds.length, 0, 0);
    check('全程无未捕获异常', errs.length, 0, 0);
    if (errs.length) errs.slice(0, 5).forEach(e => console.log('     ' + e.slice(0, 200)));

  } catch (e) {
    fail++;
    console.log('\n💥 套件自身出错：' + (e && e.stack || e));
  } finally {
    try { if (cdp) cdp.ws.close(); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
    await sleep(400);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
    try { srv.close(); } catch (e) {}
  }

  console.log(`\n===== 第十八轮（服务商扩充 + Vertex AI）：${pass} 通过 / ${fail} 失败 =====`);
  if (fails.length) { console.log('失败项：'); fails.forEach(f => console.log('  ❌ ' + f)); }
  process.exit(fail ? 1 : 0);
})();
