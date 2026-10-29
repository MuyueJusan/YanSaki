// 一次性探针：ai 聊天「历史会话 / 切换人设 / 导出」到底成不成。
// 判据一律「发生了」+「不该发生」成对出现，且对照组必须真的不同（RULES 六之二十六）。
const PAGE_FILE = 'G:/saki/saki.html';
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-probe-sess-'));
  console.log('profile:', profile);
  const port = 9681;
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
  await new Promise(r => srv.listen(9041, '127.0.0.1', r));

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
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:9041/' }, SID);
    const ready = await waitFor(`typeof aiSessStore === 'object' && typeof newAiConversation === 'function'`);
    ck('页面就绪（aiSessStore 存在）', ready, true);
    if (!ready) throw new Error('页面没起来');

    // 桩：不联网也能走完整的「发送 → 回复 → 存档」那条真路
    await ev(`window.streamChat = async function(msgs, onDelta){
        var t = '这是桩回复A'; if (onDelta) onDelta(t); return t; }; 1`);
    // 桩：拦下载，拿到 blob 好读内容
    await ev(`window.stDownload = function(name, blob){ window.__dl = { name: name, blob: blob }; }; 1`);

    console.log('\n— A. 初始状态 —');
    ck('A1 面板 DOM 存在', await ev(`!!document.getElementById('ai-hist-panel')`), true);
    ck('A2 历史按钮存在', await ev(`!!document.getElementById('ai-hist-btn')`), true);
    ck('A3 启动后已有 1 段会话', await ev(`aiSessStore.list.length`), 1);
    ck('A4 开局只有开场白、chatHistory 为空', await ev(`chatHistory.length`), 0);
    ck('A5 开场白气泡存在（不该是空聊天框）',
      await ev(`document.querySelectorAll('#ai-messages > .ai-msg').length`), 1);
    ck('A6 开场白不进模型上下文（没有 historyRole）',
      await ev(`!!document.querySelector('#ai-messages > .ai-msg').dataset.historyRole`), false);

    console.log('\n— A2. 点「应用」不能补出第二句开场白 —');
    const a7 = await ev(`(function(){
        var before = document.querySelectorAll('#ai-messages > .ai-msg').length;
        aiConfig.apiKey = 'k'; aiConfig.model = 'm';
        document.getElementById('ai-api-key').value = 'k';
        setAiModelOption('m');
        applyAiSettings();
        return { before: before,
                 after: document.querySelectorAll('#ai-messages > .ai-msg').length };
      })()`);
    ck('A7 应用之后气泡数没变（不会多一句开场白）', a7.after, a7.before);
    ck('A8 对照 —— 点之前确实有开场白（否则 A7 是空对空）', a7.before, 1);

    console.log('\n— B. 发一条消息，看有没有真的存进 aiChatSessions —');
    await ev(`(function(){ var i=document.getElementById('ai-input'); i.value='第一句话'; sendAiMessage(); return 1; })()`);
    const done = await waitFor(`aiBusy === false && chatHistory.length >= 2`);
    ck('B1 一轮对话跑完', done, true);
    await sleep(300);
    const b2 = await ev(`(function(){
        var raw = localStorage.getItem('aiChatSessions');
        if (!raw) return { noKey: true };
        var d = JSON.parse(raw);
        var s = d.list.filter(function(x){ return x.id === d.active; })[0] || {};
        return { n: (s.msgs||[]).length, roles: (s.msgs||[]).map(function(m){return m.role;}),
                 hist: (s.msgs||[]).filter(function(m){return m.inHist;}).map(function(m){return m.content;}),
                 title: s.title, pid: !!s.pid };
      })()`);
    ck('B2 会话里存下了 3 条气泡（开场白 + 你 + AI）', b2.n, 3);
    ck('B3 角色序列对', b2.roles, ['assistant', 'user', 'assistant']);
    ck('B4 进上下文的是那两条（开场白不算）', b2.hist, ['第一句话', '这是桩回复A']);
    ck('B5 标题取自第一句用户消息', b2.title, '第一句话');
    ck('B6 人设快照有 pid', b2.pid, true);
    // 对照：失败气泡不该被存（这里没有失败，所以数量必须是 0 —— 先造一条失败再验）
    ck('B7 没有失败气泡', await ev(`document.querySelectorAll('#ai-messages .ai-bubble.failed').length`), 0);

    console.log('\n— C. 新对话 → 换人设 → 切回来（人设必须跟着回来） —');
    const c1 = await ev(`(function(){
        aiConfig.promptPreset = 'cat';
        aiConfig.systemPrompt = findPromptPreset('cat').prompt;
        aiPersist(); aiSessSaveCurrent();
        var a = aiSessStore.active;
        newAiConversation();
        var b = aiSessStore.active;
        return { a: a, b: b, n: aiSessStore.list.length,
                 changed: a !== b,
                 msgsA: (aiSessStore.list.filter(function(x){return x.id===a;})[0]||{}).msgs.length };
      })()`);
    ck('C1 新建了一段（active 换了）', c1.changed, true);
    ck('C2 一共 2 段', c1.n, 2);
    ck('C3 旧那段的气泡还在（没被新对话清掉）', c1.msgsA, 3);
    ck('C4 新对话里只剩开场白', await ev(`chatHistory.length`), 0);

    // 换成人设 B
    const c5 = await ev(`(function(){
        selectPromptPreset('princess');
        aiSessSaveCurrent();
        return { preset: aiConfig.promptPreset,
                 sysHead: document.getElementById('ai-system-prompt').value.slice(0, 8) };
      })()`);
    ck('C5 当前人设已换成 princess（对照组：切之前确实不同）', c5.preset, 'princess');

    // 切回 A
    const c6 = await ev(`(function(){
        aiSessSwitch(${JSON.stringify(c1.a)});
        return { preset: aiConfig.promptPreset,
                 sysEq: document.getElementById('ai-system-prompt').value === findPromptPreset('cat').prompt,
                 chip: (document.querySelector('#ai-preset-row .ai-preset-chip.active')||{dataset:{}}).dataset.preset,
                 active: aiSessStore.active === ${JSON.stringify(c1.a)},
                 msgs: document.querySelectorAll('#ai-messages > .ai-msg').length,
                 hist: chatHistory.length,
                 hasText: document.getElementById('ai-messages').textContent.indexOf('第一句话') >= 0,
                 retryHooked: (function(){
                    var w = document.querySelectorAll('#ai-messages > .ai-msg');
                    var last = w[w.length-1];
                    return !!(last && last.dataset.historyRole === 'assistant'
                              && last.dataset.historyContent === '这是桩回复A');
                 })() };
      })()`);
    ck('C6 人设切回来了（aiConfig.promptPreset）', c6.preset, 'cat');
    ck('C7 系统提示词那格也跟着换了', c6.sysEq, true);
    ck('C8 预设小圆点高亮跟着换', c6.chip, 'cat');
    ck('C9 active 指回旧会话', c6.active, true);
    ck('C10 气泡恢复了 3 条', c6.msgs, 3);
    ck('C11 上下文恢复了 2 条', c6.hist, 2);
    ck('C12 正文里能看到「第一句话」', c6.hasText, true);
    ck('C13 恢复的气泡带 historyRole（否则「重试」会失效）', c6.retryHooked, true);
    // 对照：切之前那段（princess）现在应该已经是空会话
    ck('C14 对照 —— 新那段确实没被写进旧段', await ev(
      `(aiSessStore.list.filter(function(x){return x.id!==${JSON.stringify(c1.a)};})[0]||{msgs:[]}).msgs.length`), 1);

    console.log('\n— D. 导出 —');
    const d1 = await ev(`(async function(){
        aiExportSession('', 'md');
        var t = await window.__dl.blob.text();
        return { name: window.__dl.name, type: window.__dl.blob.type,
                 head: t.slice(0, 12), hasUser: t.indexOf('**你**') >= 0,
                 hasMsg: t.indexOf('第一句话') >= 0,
                 persona: t.indexOf('猫猫 Saki') >= 0 };
      })()`);
    ck('D1 .md 文件名', /^ai-chat-.+-\d{8}-\d{4}\.md$/.test(d1.name), true);
    ck('D2 开头是标题', d1.head.indexOf('# AI 对话记录') === 0, true);
    ck('D3 有你/AI 的角色标记', d1.hasUser, true);
    ck('D4 正文含消息', d1.hasMsg, true);
    ck('D5 人设名写进去了', d1.persona, true);

    const d2 = await ev(`(async function(){
        aiExportSession('', 'json');
        var t = await window.__dl.blob.text();
        var o = JSON.parse(t);
        return { name: window.__dl.name, kind: o.kind, n: o.messages.length,
                 hasPersona: !!(o.persona && o.persona.systemPrompt) };
      })()`);
    ck('D6 .json 文件名', /\.json$/.test(d2.name), true);
    ck('D7 kind 标记', d2.kind, 'ai-chat');
    ck('D8 JSON 里 3 条消息', d2.n, 3);
    ck('D9 JSON 带完整人设快照', d2.hasPersona, true);

    console.log('\n— E. 面板显隐 / 边界 / 复古 —');
    ck('E1 默认不显示（computed display）',
      await ev(`getComputedStyle(document.getElementById('ai-hist-panel')).display`), 'none');
    // ⚠⚠ 先把卡片展开。`#ai-card` 默认带 `ai-collapsed`，`.ai-collapse-wrapper` 是
    //   `grid-template-rows: 0fr` ⇒ **高度 0**。在 0×0 的盒子里比边界，
    //   `p.top >= c.top - 1` 这类判据**永远为真**（踩过：第一版 E3 就是空对空）
    await ev(`(function(){
        var c = document.getElementById('ai-card');
        c.classList.remove('ai-collapsed');
        c.classList.remove('ai-settings-collapsed');
        c.classList.remove('ai-adv-collapsed');
        return 1; })()`);
    await sleep(600);   // 等 0.35s 的 grid-template-rows 过渡走完
    await ev(`toggleAiHistory(true); 1`);
    await sleep(200);
    ck('E2 打开后 display 是 flex',
      await ev(`getComputedStyle(document.getElementById('ai-hist-panel')).display`), 'flex');
    const e3 = await ev(`(function(){
        var p = document.getElementById('ai-hist-panel').getBoundingClientRect();
        var c = document.getElementById('ai-chat').getBoundingClientRect();
        return { cw: Math.round(c.width), ch: Math.round(c.height),
                 pw: Math.round(p.width), ph: Math.round(p.height),
                 inside: p.left >= c.left - 1 && p.right <= c.right + 1 &&
                          p.top >= c.top - 1 && p.bottom <= c.bottom + 1,
                 rows: document.querySelectorAll('.ai-hist-row').length };
      })()`);
    // 判据链：先「这帧已经布局」，再「铺满」，最后才「没出界」。
    // 顺序反了的话，前一条红不红都能让后一条绿得毫无意义
    ck('E3 聊天框确实有尺寸（否则下面两条是空对空）',
      e3.cw > 100 && e3.ch > 100, true);
    ck('E4 面板宽高跟聊天框一致（真的铺满）',
      [Math.abs(e3.pw - e3.cw) <= 2, Math.abs(e3.ph - e3.ch) <= 2], [true, true]);
    ck('E5 面板没出界', e3.inside, true);
    ck('E6 列表里 2 行', e3.rows, 2);
    await ev(`document.body.classList.add('retro-mode'); 1`);
    ck('E7 复古模式下面板底色是 Win98 灰',
      await ev(`getComputedStyle(document.getElementById('ai-hist-panel')).backgroundColor`), 'rgb(192, 192, 192)');
    await ev(`document.body.classList.remove('retro-mode'); toggleAiHistory(false); 1`);
    ck('E8 关掉后回到 none',
      await ev(`getComputedStyle(document.getElementById('ai-hist-panel')).display`), 'none');

    console.log('\n— F. 刷新之后记忆还在（这才是「记忆」） —');
    const activeBefore = await ev(`aiSessStore.active`);
    const presetBefore = await ev(`aiConfig.promptPreset`);
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:9041/' }, SID);
    const ready2 = await waitFor(`typeof aiSessStore === 'object' && typeof newAiConversation === 'function'`);
    ck('F1 重新加载就绪', ready2, true);
    const f2 = await ev(`(function(){
        return { n: aiSessStore.list.length,
                 active: aiSessStore.active,
                 msgs: document.querySelectorAll('#ai-messages > .ai-msg').length,
                 hasText: document.getElementById('ai-messages').textContent.indexOf('第一句话') >= 0,
                 hist: chatHistory.length,
                 preset: aiConfig.promptPreset };
      })()`);
    ck('F2 会话条数还是 2', f2.n, 2);
    ck('F3 还是上次那段（active 一致）', f2.active, activeBefore);
    ck('F4 气泡恢复了', f2.msgs, 3);
    ck('F5 内容对', f2.hasText, true);
    ck('F6 上下文对', f2.hist, 2);
    // ⚠ 这里的关键语义：刷新时**不拿旧快照盖当前配置**，只恢复消息
    ck('F7 人设沿用「现在生效的那份」，没被旧快照覆盖', f2.preset, presetBefore);

    console.log('\n— H. 酒馆角色卡那条路（需求里点名的另一半） —');
    // 卡片形状要完整 —— renderTavernCard 会读 c.tags / c.spec / c.firstMes，
    // 少一个就当场抛（那是探针造的数据不全，不是产品坏）
    await ev(`window.__mkCard = function(name, desc, greet){
        return { name: name, description: desc, personality: '温和', scenario: '测试场景',
                 mesExample: '', systemPrompt: '', postHistoryInstructions: '', creatorNotes: '',
                 spec: 'v2', creator: '', characterVersion: '', tags: [],
                 firstMes: greet, alternateGreetings: [] }; }; 1`);
    const h1 = await ev(`(function(){
        aiConfig.tavernEnabled = true;
        aiConfig.promptEnabled = false;
        aiConfig.tavernCard = window.__mkCard('甲卡', '甲卡的描述', '甲卡的开场白');
        // 世界书用产品自己的解析器造，别手搓 —— 条目形状（keys / decorators / hash）
        // 手写少一个字段，renderTavernLore 就当场抛
        aiConfig.tavernLore = parseWorldBook({ name: '甲书', entries: [
            { uid: 1, key: ['甲'], keysecondary: [], content: '甲的世界书条目',
              comment: '条目1', constant: false, selective: false, disable: false,
              position: 0, depth: 4, role: 0 } ] }, '甲书');
        aiConfig.tavernTimed = { sticky: {}, cooldown: {}, msgCount: 7 };
        persistTavern();
        aiSessSaveCurrent();
        var a = aiSessStore.active;
        var pidA = aiSessStore.personas[(aiSessStore.list.filter(function(x){return x.id===a;})[0]||{}).pid];
        return { a: a, label: aiSessPersonaLabel(pidA),
                 personas: Object.keys(aiSessStore.personas).length };
      })()`);
    ck('H1 快照标签认出角色卡 + 世界书', h1.label, '🎭 甲卡 · 世界书 1 条');

    const h2 = await ev(`(function(){
        newAiConversation();
        aiConfig.tavernCard = window.__mkCard('乙卡', '乙卡的描述', '乙卡的开场白');
        aiConfig.tavernLore = null;
        aiConfig.tavernTimed = { sticky: {}, cooldown: {}, msgCount: 0 };
        persistTavern();
        aiSessSaveCurrent();
        return { name: aiConfig.tavernCard.name,
                 personas: Object.keys(aiSessStore.personas).length };
      })()`);
    ck('H2 对照 —— 现在生效的是乙卡（跟甲卡不同）', h2.name, '乙卡');

    const h3 = await ev(`(function(){
        aiSessSwitch(${JSON.stringify(h1.a)});
        return { name: (aiConfig.tavernCard||{}).name,
                 tavern: aiConfig.tavernEnabled,
                 prompt: aiConfig.promptEnabled,
                 checked: document.getElementById('ai-tavern-enabled').checked,
                 cardShown: document.getElementById('ai-tavern-card').textContent.indexOf('甲卡') >= 0,
                 lore: (aiConfig.tavernLore && aiConfig.tavernLore.entries || []).length,
                 clock: aiConfig.tavernTimed.msgCount };
      })()`);
    ck('H3 角色卡切回来了', h3.name, '甲卡');
    ck('H4 酒馆开关跟着回来', h3.tavern, true);
    ck('H5 「系统提示词已关」也跟着回来', h3.prompt, false);
    ck('H6 面板上的勾也同步了', h3.checked, true);
    ck('H7 角色卡面板真的重画成甲卡', h3.cardShown, true);
    ck('H8 世界书跟着回来（1 条）', h3.lore, 1);
    ck('H9 世界书冷却时钟跟着会话走（7）', h3.clock, 7);
    // 去重：换一份人设只应该多出一份快照；切回去不该再多
    ck('H10 换成乙卡只多出 1 份快照', h2.personas, h1.personas + 1);
    ck('H11 切回甲卡没有再多一份（快照按内容去重）',
      await ev(`Object.keys(aiSessStore.personas).length`), h2.personas);

    console.log('\n— G. 不该发生的事 —');
    ck('G1 全程没有未捕获异常', errors, []);
    ck('G2 没有残留的 loading 气泡',
      await ev(`document.querySelectorAll('#ai-messages .ai-bubble.loading').length`), 0);

    console.log('\n========== ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
    if (red.length) console.log('红：\n  - ' + red.join('\n  - '));
  } catch (e) {
    fail++;
    console.log('\n💥 探针自己炸了：' + e.message);
    console.log('（这不算产品失败，但也不能当通过）');
  } finally {
    try { chrome.kill(); } catch (e) {}
    try { srv.close(); } catch (e) {}
    console.log('\n收尾完成。profile 留给外面删：' + profile);
  }
})();
