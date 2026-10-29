// 一次性探针：每个 AI 调用点的 token 用量（发送 / 应答分开）到底对不对。
//
// ⚠ 这里**不桩 streamChat / stAiChat**，而是桩最底层的 fetch，把三家协议的
//   真实响应形状喂进去 —— 因为「用量从哪取」正是这次要验的东西，桩在
//   stAiChat 那一层就等于把被测代码整段跳过了（六之三十三：断言要打在
//   真正决定行为的那一步）。
//
// 判据一律成对：有 usage 时**不许**出现 ≈，没 usage 时**必须**出现 ≈。
const PAGE_FILE = process.env.PROBE_PAGE || 'G:/saki/saki.html';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { spawn } = require('child_process');
const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const red = [];
function ck(name, actual, expect) {
  const a = JSON.stringify(actual), e = JSON.stringify(expect);
  if (a === e) { pass++; console.log('  ✅ ' + name); }
  else { fail++; red.push(name); console.log('  ❌ ' + name + '\n       实际 ' + a + '\n       期望 ' + e); }
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      }
    });
  }
  send(method, params = {}, sessionId, timeout = 30000) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const tm = setTimeout(() => { this.pending.delete(id); rej(new Error('timeout ' + method)); }, timeout);
      this.pending.set(id, { res: v => { clearTimeout(tm); res(v); }, rej: e => { clearTimeout(tm); rej(e); } });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
    });
  }
}

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-probe-usage-'));
  console.log('profile:', profile);
  const port = 9683;
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`], { stdio: 'ignore' });
  const srv = http.createServer((req, rep) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const f = path.join(path.dirname(PAGE_FILE), u === '/' ? path.basename(PAGE_FILE) : u.replace(/^\/+/, ''));
    fs.readFile(f, (e, buf) => {
      if (e) { rep.writeHead(404); rep.end('x'); return; }
      rep.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      rep.end(buf);
    });
  });
  await new Promise(r => srv.listen(9043, '127.0.0.1', r));

  let wsUrl = null;
  for (let i = 0; i < 80; i++) {
    try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch (e) {}
    if (wsUrl) break; await sleep(250);
  }
  const ws = new WebSocket(wsUrl); await new Promise(r => ws.addEventListener('open', r));
  const cdp = new CDP(ws);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const SID = (await cdp.send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await cdp.send('Page.enable', {}, SID);
  await cdp.send('Runtime.enable', {}, SID);
  // ⚠ 视口别小于 600 —— 027 那条 @media 会把 #ai-card 整个 display:none，
  //   于是所有 rect 都是 0（踩过：上一轮探针截出白板）
  await cdp.send('Emulation.setDeviceMetricsOverride',
    { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false }, SID);

  const errors = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push((d.exception && d.exception.description) || d.text);
    }
  });

  const ev = async e => {
    const r = await cdp.send('Runtime.evaluate',
      { expression: e, returnByValue: true, awaitPromise: true }, SID);
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception
        ? r.exceptionDetails.exception.description : r.exceptionDetails.text);
    }
    return r.result.value;
  };
  const waitFor = async (expr, ms) => {
    for (let i = 0; i < (ms || 20000) / 200; i++) {
      let ok = false;
      try { ok = await ev(expr); } catch (e) {}
      if (ok) return true;
      await sleep(200);
    }
    return false;
  };

  try {
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:9043/' }, SID);
    const ready = await waitFor(`typeof stAiRequest === 'function' && typeof sendAiMessage === 'function'`);
    ck('A1 页面就绪（stAiRequest / sendAiMessage 在）', ready, true);
    if (!ready) throw new Error('页面没起来');

    // —— 桩：最底层 fetch。__reply 可以是对象，也可以是 (第几次, body) => 对象 ——
    await ev(`
      window.__reqs = [];
      window.__reply = { json: {} };
      window.fetch = async function(url, opt){
        var body = null;
        try { body = JSON.parse(opt && opt.body); } catch(e){}
        window.__reqs.push({ url: String(url), body: body });
        var r = window.__reply;
        if (typeof r === 'function') r = r(window.__reqs.length, body);
        if (r.status && r.status !== 200) {
          return new Response(r.text || 'stub error', { status: r.status });
        }
        if (r.sse != null) {
          var enc = new TextEncoder();
          var st = new ReadableStream({ start: function(c){ c.enqueue(enc.encode(r.sse)); c.close(); } });
          return new Response(st, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
        }
        return new Response(JSON.stringify(r.json), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
      // 把 AI 卡片展开 —— 折叠着的时候 .ai-collapse-wrapper 是 0fr，所有 rect 都是 0
      var card = document.getElementById('ai-card');
      if (card) { card.classList.remove('ai-collapsed'); card.classList.remove('ai-settings-collapsed'); }
      1`);

    const setCfg = (provider, baseUrl, stream) => ev(`
      aiConfig.provider = ${JSON.stringify(provider)};
      aiConfig.baseUrl = ${JSON.stringify(baseUrl)};
      aiConfig.apiKey = 'stub-key';
      aiConfig.model = 'stub-model';
      aiConfig.maxTokens = 256;
      aiConfig.stream = ${stream ? 'true' : 'false'};
      delete aiConfig.proto;
      1`);

    // 发一句话，等回复落地
    const say = async (text) => {
      await ev(`(function(){
        document.getElementById('ai-input').value = ${JSON.stringify(text)};
        return sendAiMessage();
      })()`);
      await sleep(60);
    };
    // 最后一条带用量标签的气泡，读它的文字 / 布局
    const lastUsage = () => ev(`(function(){
      var ws = [].slice.call(document.querySelectorAll('#ai-messages > .ai-msg'));
      var w = null;
      for (var i = ws.length - 1; i >= 0; i--) { if (ws[i].querySelector('.ai-usage')) { w = ws[i]; break; } }
      if (!w) return null;
      var u = w.querySelector('.ai-usage');
      var b = w.querySelector('.ai-bubble');
      var ur = u.getBoundingClientRect(), br = b.getBoundingClientRect(), wr = w.getBoundingClientRect();
      return {
        text: u.textContent,
        below: ur.top >= br.bottom - 1,
        fullWidth: Math.abs(ur.width - wr.width) < 2,
        color: getComputedStyle(u).color,
        data: w.dataset.usage || ''
      };
    })()`);

    console.log('\n— B. 非流式 OpenAI（顶层 usage）—');
    await setCfg('openai', 'https://api.openai.com/v1', false);
    await ev(`window.__reqs = []; window.__reply = { json: {
      choices: [{ message: { content: '收到啦' } }],
      usage: { prompt_tokens: 1234, completion_tokens: 567, total_tokens: 1801 }
    } }; 1`);
    await say('第一条');
    let u1 = await lastUsage();
    ck('B1 标签文字（发送 / 应答分开、千分位用空格）', u1 && u1.text, '发送 1 234 / 应答 567 tokens');
    ck('B2 标签在气泡下方（自己一行）', u1 && u1.below, true);
    ck('B3 标签占满整行（flex-basis:100% 生效）', u1 && u1.fullWidth, true);
    ck('B4 dataset 存的是结构化的一份（切会话靠它还原）', u1 && JSON.parse(u1.data || '{}'),
      { in: 1234, out: 567, total: 1801, estimated: false });
    ck('B5 用户气泡没有用量标签（对照组）',
      await ev(`document.querySelectorAll('#ai-messages > .ai-msg.from-user .ai-usage').length`), 0);

    const lightColor = u1 && u1.color;
    await ev(`document.body.classList.add('retro-mode'); 1`);
    const retroColor = await ev(`(function(){
      var u = document.querySelector('#ai-messages .ai-usage');
      return u ? getComputedStyle(u).color : '';
    })()`);
    await ev(`document.body.classList.remove('retro-mode'); 1`);
    ck('B6 复古模式换了颜色（不是沿用浅色那套）', retroColor !== lightColor, true);

    console.log('\n— C. 流式 OpenAI（要显式点名才带 usage）—');
    await setCfg('openai', 'https://api.openai.com/v1', true);
    await ev(`window.__reqs = []; window.__reply = { sse:
      'data: ' + JSON.stringify({ choices: [{ delta: { content: '你' } }] }) + '\\n\\n' +
      'data: ' + JSON.stringify({ choices: [{ delta: { content: '好' } }] }) + '\\n\\n' +
      'data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 900, completion_tokens: 42, total_tokens: 942 } }) + '\\n\\n' +
      'data: [DONE]\\n\\n'
    }; 1`);
    await say('第二条');
    let u2 = await lastUsage();
    ck('C1 请求体点名了 stream_options.include_usage', await ev(`(function(){
      var r = window.__reqs[0];
      return !!(r && r.body && r.body.stream_options && r.body.stream_options.include_usage === true);
    })()`), true);
    ck('C2 最后一帧的 usage 被读到（不是只靠估算）', u2 && u2.text, '发送 900 / 应答 42 tokens');
    ck('C3 有真用量时不带 ≈', u2 && u2.text.indexOf('≈') < 0, true);

    console.log('\n— D. Anthropic 流式：用量拆成两条事件 —');
    await setCfg('anthropic', 'https://api.anthropic.com/v1', true);
    await ev(`window.__reqs = []; window.__reply = { sse:
      'data: ' + JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 2000, output_tokens: 0 } } }) + '\\n\\n' +
      'data: ' + JSON.stringify({ type: 'content_block_delta', delta: { text: '嗨' } }) + '\\n\\n' +
      'data: ' + JSON.stringify({ type: 'message_delta', usage: { output_tokens: 300 } }) + '\\n\\n'
    }; 1`);
    await say('第三条');
    let u3 = await lastUsage();
    ck('D1 input 来自 message_start、output 来自 message_delta（逐字段取 max）',
      u3 && u3.text, '发送 2 000 / 应答 300 tokens');
    // 这一条是核心：写成「后一条覆盖前一条」的话，message_delta 里没有 input_tokens，
    // 合并后这里会变成「发送 0」—— 而 D1 只比整串，D2 专门盯这个数字
    ck('D2 发送不是 0（覆盖式实现在这里会露馅）', u3 && u3.text.indexOf('发送 0 ') < 0, true);

    console.log('\n— E. Gemini（usageMetadata）—');
    await setCfg('gemini-native', 'https://generativelanguage.googleapis.com', false);
    await ev(`window.__reqs = []; window.__reply = { json: {
      candidates: [{ content: { parts: [{ text: '喵' }] } }],
      usageMetadata: { promptTokenCount: 800, candidatesTokenCount: 120, totalTokenCount: 920 }
    } }; 1`);
    await say('第四条');
    let u4 = await lastUsage();
    ck('E1 gemini 的 usageMetadata 也认', u4 && u4.text, '发送 800 / 应答 120 tokens');

    console.log('\n— F. 服务商不给 usage ⇒ 估算，并且必须标出来 —');
    await setCfg('openai', 'https://api.openai.com/v1', false);
    await ev(`window.__reqs = []; window.__reply = { json: { choices: [{ message: { content: '没有用量字段的回复' } }] } }; 1`);
    await say('第五条');
    let u5 = await lastUsage();
    ck('F1 估算值前面带 ≈', !!(u5 && u5.text.indexOf('发送 ≈') === 0), true);
    ck('F2 估算标记也进了 dataset（切会话不丢）', !!(u5 && JSON.parse(u5.data || '{}').estimated), true);
    ck('F3 对照：C2 那条没有 ≈（两种状态真的不同）', u2 && u2.text.indexOf('≈') < 0, true);

    console.log('\n— G. 400 兜底：反代不认识 stream_options —');
    await setCfg('openai', 'https://api.openai.com/v1', true);
    await ev(`window.__reqs = []; window.__reply = function(n, body){
      if (n === 1) return { status: 400, text: 'unknown field stream_options' };
      return { sse: 'data: ' + JSON.stringify({ choices: [{ delta: { content: '好' } }] }) + '\\n\\n' +
                    'data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 77, completion_tokens: 7 } }) + '\\n\\n' };
    }; 1`);
    await say('第六条');
    let u6 = await lastUsage();
    ck('G1 400 之后重发了一次（一共 2 次请求）', await ev(`window.__reqs.length`), 2);
    ck('G2 重发的那一次没有 stream_options', await ev(`(function(){
      var r = window.__reqs[1];
      return !!(r && r.body && !('stream_options' in r.body));
    })()`), true);
    ck('G3 兜底之后用量照样拿到了', u6 && u6.text, '发送 77 / 应答 7 tokens');

    console.log('\n— H. 切会话不能把用量弄丢 —');
    const before = u6 && u6.text;
    const switched = await ev(`(function(){
      var n0 = aiSessStore.list.length;
      newAiConversation();
      var n1 = aiSessStore.list.length;
      var prev = aiSessStore.list.filter(function(s){ return s.id !== aiSessStore.active; })[0];
      if (!prev) return { ok: false, why: '没有上一段可切' };
      aiSessSwitch(prev.id);
      var ws = [].slice.call(document.querySelectorAll('#ai-messages > .ai-msg'));
      var w = null;
      for (var i = ws.length - 1; i >= 0; i--) { if (ws[i].querySelector('.ai-usage')) { w = ws[i]; break; } }
      return {
        ok: true,
        n0: n0, n1: n1,
        text: w ? w.querySelector('.ai-usage').textContent : null,
        count: document.querySelectorAll('#ai-messages .ai-usage').length
      };
    })()`);
    ck('H1 新会话确实建出来了（切走的前提）', !!(switched && switched.n1 > switched.n0), true);
    ck('H2 切回来标签还在', switched && switched.text, before);
    ck('H3 整段恢复出来的标签数 > 1（不是只恢复最后一条）', !!(switched && switched.count > 1), true);
    // 对照组：新会话里一条都没有
    const freshCount = await ev(`(function(){
      var s = aiSessCreate();
      aiSessStore.active = s.id;
      aiSessRestore(s, false);
      return document.querySelectorAll('#ai-messages .ai-usage').length;
    })()`);
    ck('H4 空白会话里没有标签（对照组）', freshCount, 0);

    console.log('\n— I. Code 页（Agent 每轮各记一份）—');
    await setCfg('openai', 'https://api.openai.com/v1', false);
    const code = await ev(`(async function(){
      window.__reqs = []; window.__reply = { json: {
        choices: [{ message: { content: '改好了' } }],
        usage: { prompt_tokens: 900, completion_tokens: 60, total_tokens: 960 }
      } };
      var cfg = stAiCfg();
      var plan = stAiRequest(cfg, [{ role: 'user', content: '改一下描述' }], { stream: false });
      var data = await stCodeFetch(plan, cfg);
      var snap = stAiUsageSnapshot();
      var htmlNew = stCodeMsgHtml({ role: 'assistant', content: '改好了', usage: snap });
      var htmlOld = stCodeMsgHtml({ role: 'assistant', content: '老消息' });
      return {
        in: stAiUsage() ? stAiUsage().in : -1,
        out: stAiUsage() ? stAiUsage().out : -1,
        hasTag: htmlNew.indexOf('st-code-usage') >= 0,
        text: htmlNew.indexOf('发送 900 / 应答 60 tokens') >= 0,
        oldClean: htmlOld.indexOf('st-code-usage') < 0
      };
    })()`);
    ck('I1 stCodeFetch 之后用量落在状态里', [code && code.in, code && code.out], [900, 60]);
    ck('I2 Agent 那一轮渲染出用量徽标', !!(code && code.hasTag && code.text), true);
    ck('I3 老会话（没有 usage 字段）不渲染空徽标（对照组）', code && code.oldClean, true);

    console.log('\n— J. 编写器状态行的拼接 —');
    const j = await ev(`(function(){
      stAiUsageReset();
      stAiUsageNote('openai', { usage: { prompt_tokens: 1500, completion_tokens: 250 } });
      return {
        bare: stAiUsageWith(''),
        withMsg: stAiUsageWith('要了 5 条，模型给了 4 条。'),
        suffix: stAiUsageSuffix(),
        none: stAiUsageReset() || stAiUsageWith('')
      };
    })()`);
    ck('J1 没有别的提示时不留开头那个点', j && j.bare, '发送 1 500 / 应答 250 tokens');
    ck('J2 有提示时拼成一句', j && j.withMsg, '要了 5 条，模型给了 4 条。 · 发送 1 500 / 应答 250 tokens');
    ck('J3 状态行后缀以「 · 」开头', j && j.suffix, ' · 发送 1 500 / 应答 250 tokens');
    ck('J4 没有用量时返回空串（调用方不用自己判）', j && j.none, '');

    console.log('\n— K. 运行时异常 —');
    ck('K1 全程零异常', errors.length, 0);
    if (errors.length) errors.slice(0, 5).forEach(e => console.log('     ' + String(e).split('\n')[0]));
  } catch (e) {
    fail++; red.push('探针本身崩了');
    console.log('  ❌ 探针崩了：' + (e && e.message ? e.message : e));
  } finally {
    console.log('\n========== ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
    if (red.length) console.log('红：' + red.join(' | '));
    try { ws.close(); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
    try { srv.close(); } catch (e) {}
    // ⚠ profile 用前台删（spawn(detached) 删不掉、rmSync 会卡死整层，见 RULES 六之八十六）
  }
  process.exit(fail ? 1 : 0);
})();
