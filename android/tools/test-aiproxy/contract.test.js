'use strict';
/*
 * contract.test.js —— 契约测试的「JS 侧」。
 *
 * 它做的事：
 *   1. 把 Harness 用**真 AiProxy + 真 JsEvent** 录下来的那些行，**原样**回放给垫片；
 *   2. 断言页面侧 fetch 还原出来的字节，与本地服务器**真发出去**的字节逐字节一致；
 *   3. 断言「不该被拦的没被拦」「失败路径真的会失败」—— 也就是对照组。
 *
 * ⚠⚠ 为什么在 Node 里跑而不是 headless Chrome
 *   垫片只用到 ReadableStream / Response / Headers / TextDecoder / atob / DOMException
 *   —— 这些 Node 18+ 全是全局的。用 Node 就不必起浏览器、不必装依赖，
 *   而且跑的是**垫片源码本身**（不是它的复制品）。
 *
 * ⚠⚠ 为什么不检查「垫片能不能连上真 Google」
 *   本机所有 *.googleapis.com 都被代理挡死（实测 http=000），连不上。
 *   所以这里测的是**契约**：Java 发什么、JS 收什么、还原得对不对。
 *   「真的能调通 Vertex AI」这件事只能在能上外网的手机上验，本机验不了 ——
 *   这一点在 README 里明说了，不许含糊。
 *
 * 用法：node contract.test.js <workDir> <baseUrl>
 */
const fs = require('fs');
const path = require('path');

const WORK = process.argv[2];
const BASE = process.argv[3] || 'http://127.0.0.1:8791';

const SHIM = path.join(__dirname, '..', '..', 'shim', 'ai-fetch-shim.js');
const SHIM_SRC = fs.readFileSync(SHIM, 'utf8');

const fails = [];
function check(ok, msg) {
    console.log('   ' + (ok ? '✅' : '❌') + ' ' + msg);
    if (!ok) fails.push(msg);
}

/*
 * ⚠⚠ 看门狗：这是本文件里**最重要**的十行。
 *
 * 这个测试里大量出现 `await reader.read()`。如果事件因为任何原因没被投递（id 对不上、
 * 回放顺序错、垫片早期 return），那个 Promise 就永远不 settle ——
 * 而 Node 的事件循环一空就**以退出码 0 退出**。
 * 于是「测试什么都没跑」和「测试全过了」在退出码上**完全一样**。
 * 我第一次跑就踩了这个：JS 侧只打了 2 行就没了，run.sh 却报「全部通过」。
 *
 * 故意不 unref()：这个定时器要**撑着事件循环**，把「静默退出」变成「30 秒后大声报错」。
 */
const WATCHDOG_MS = Number(process.env.YS_WATCHDOG_MS) || 30000;
let reached = 0;
const watchdog = setTimeout(function () {
    console.error('❌ 测试挂住了（' + WATCHDOG_MS + 'ms 内没跑完，最后到达第 ' + reached + ' 段）。');
    console.error('   这**本身就是要报的错**：有 await 永远没 settle，');
    console.error('   通常意味着事件没投递到垫片（最可能是 id 对不上）。');
    process.exit(3);
}, WATCHDOG_MS);

/* ---------- 解析 Harness 录下来的事件 ---------- */
function parseEvents(file) {
    const cases = {};
    let cur = null;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (line.startsWith('=== case:')) {
            cur = line.slice('=== case:'.length).trim();
            cases[cur] = [];
        } else if (cur && line.trim().length) {
            cases[cur].push(line);
        }
    }
    return cases;
}

/* ---------- 造一个干净的「页面环境」，把垫片装进去 ---------- */
const SHIM_ARGS = ['window', 'location', 'atob', 'TextDecoder',
    'ReadableStream', 'Response', 'Headers', 'DOMException', 'URL'];
const shimFactory = new Function(...SHIM_ARGS, SHIM_SRC + '\nreturn true;');

function makeEnv(opts) {
    opts = opts || {};
    const win = {};
    const orig = [];
    win.fetch = function () {
        orig.push({ args: Array.prototype.slice.call(arguments) });
        return Promise.resolve(new Response('ORIGINAL-FETCH', { status: 200 }));
    };
    const live = {};        // id -> 待回放的事件行
    const calls = [];       // 记录垫片对原生桥说了什么

    win.YanSakiNative = {
        aiAllowed: function (u) {
            if (typeof opts.allowed === 'function') return opts.allowed(u);
            return true;
        },
        aiStart: function (id, url, method, headers, body) {
            calls.push({ kind: 'start', id: id, url: url, method: method,
                         headers: headers, body: body });
            const lines = (opts.events || []).slice();
            if (process.env.YS_DEBUG) console.log('   [dbg] aiStart id=' + id + ' lines=' + lines.length);
            if (opts.noReplay) return;
            // ⚠⚠ 必须把哨兵换成**垫片真实生成的 id**。
            //   Harness 录制时不知道这个 id（它是垫片自己编的 ysai1、ysai2…），所以录的是哨兵。
            //   要是这里忘了换，pending[真id] 里永远收不到事件 ⇒ Promise 不 settle ⇒
            //   事件循环空掉 ⇒ **Node 以退出码 0 退出** ⇒ 测试「通过」而什么都没测。
            //   我第一次跑就踩了这个，所以才同时加了下面的看门狗。
            for (const line of lines) {
                const fixed = line.replace('"__YS_ID__"', JSON.stringify(id));
                if (process.env.YS_DEBUG) console.log('   [dbg] 回放 ' + fixed.slice(0, 60));
                new Function('window', fixed)(win);
            }
        },
        aiAbort: function (id) {
            calls.push({ kind: 'abort', id: id });
        }
    };

    const location = { href: 'https://appassets.androidplatform.net/index.html' };
    shimFactory(win, location, atob, TextDecoder, ReadableStream, Response,
        Headers, DOMException, URL);
    return { win: win, orig: orig, calls: calls };
}

function expected(name) {
    return fs.readFileSync(path.join(WORK, 'expected', name + '.bin'));
}

async function readAll(resp) {
    const reader = resp.body.getReader();
    const parts = [];
    for (;;) {
        const r = await reader.read();
        if (r.done) break;
        parts.push(Buffer.from(r.value));
    }
    return { buf: Buffer.concat(parts), n: parts.length };
}

(async function main() {
    const ev = parseEvents(path.join(WORK, 'events.txt'));
    console.log('   录到的用例：' + Object.keys(ev).join(', '));

    /* ================= 1. /sse：真流式 + 分块边界 + 多字节字符 ================= */
    console.log('\n== 1. /sse 流式往返 ==');
    reached = 1;
    {
        const env = makeEnv({ events: ev.sse });
        const resp = await env.win.fetch(BASE + '/sse', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-goog-api-key': 'TEST-KEY-123' },
            body: '{"contents":[]}'
        });
        check(resp.status === 200, 'resp.status = 200（实得 ' + resp.status + '）');
        check(resp.ok === true, 'resp.ok = true');
        if (process.env.YS_DEBUG) console.log('   [dbg] fetch 已返回 status=' + resp.status);
        const got = await readAll(resp);
        const want = expected('sse');
        check(got.buf.equals(want),
            '还原出的字节与服务器真发出去的逐字节一致（' + got.buf.length + ' 字节）');
        check(got.n >= 2, '分块边界被保住了：读到 ' + got.n + ' 块'
            + '（退化成 1 块就说明「流式」是假的）');
        // 切点故意落在多字节字符中间 —— 拼回来必须还是原来那些字
        const text = new TextDecoder().decode(got.buf);
        check(text.includes('你好') && text.includes('，世界') && text.includes('🌍'),
            '中文与 emoji 完好（切点在 UTF-8 序列中间也没坏）');
        check(text.includes('data: [DONE]'), 'SSE 结尾的 [DONE] 在');
        // 请求侧：垫片有没有把方法 / 头 / 正文如实交出去
        const c = env.calls.find(x => x.kind === 'start');
        check(c && c.method === 'POST', '交给原生的是 POST');
        check(c && /x-goog-api-key: TEST-KEY-123/.test(c.headers),
            '请求头被如实交出去（含 x-goog-api-key）');
        check(c && c.body === '{"contents":[]}', '请求正文被如实交出去');
        check(env.orig.length === 0, '没有落到原始 fetch（该拦的拦住了）');
    }

    /* ================= 2. /json：单块 + resp.json() ================= */
    console.log('\n== 2. /json 单块 + json() ==');
    reached = 2;
    {
        const env = makeEnv({ events: ev.json });
        const resp = await env.win.fetch(BASE + '/json', { method: 'POST', body: '{}' });
        check(resp.status === 200, 'resp.status = 200');
        const obj = await resp.json();
        check(obj && obj.candidates && obj.candidates[0].content.parts[0].text === '单块 JSON 回复',
            'resp.json() 解析出正确的结构（页面正是这么用的）');
        const want = expected('json');
        check(Buffer.from(JSON.stringify(obj), 'utf8').length > 0 && want.length > 0,
            '（对照）期望文件非空');
    }

    /* ================= 3. /err：非 2xx 的正文必须能读 ================= */
    console.log('\n== 3. /err 非 2xx ==');
    reached = 3;
    {
        const env = makeEnv({ events: ev.err });
        const resp = await env.win.fetch(BASE + '/err', { method: 'POST', body: '{}' });
        check(resp.status === 400, 'resp.status = 400（实得 ' + resp.status + '）');
        check(resp.ok === false, 'resp.ok = false');
        const txt = await resp.text();
        check(txt.includes('API key not valid'),
            '错误正文读得出来 —— 页面靠它显示「为什么被拒」，'
            + '丢了就只剩一句 HTTP 400');
    }

    /* ================= 4. /echo：请求侧往返 ================= */
    console.log('\n== 4. /echo 请求侧往返 ==');
    reached = 4;
    {
        const env = makeEnv({ events: ev.echo });
        const body = '{"contents":[{"parts":[{"text":"往返检查 ✓"}]}]}';
        const resp = await env.win.fetch(BASE + '/echo', {
            method: 'POST',
            headers: { 'content-type': 'application/json',
                       'x-goog-api-key': 'TEST-KEY-123',
                       'x-ys-custom': 'hello' },
            body: body
        });
        const seen = await resp.json();
        check(seen.method === 'POST', '服务器看到的是 POST');
        check(seen.headers['x-goog-api-key'] === 'TEST-KEY-123',
            '自定义头原样到达（x-goog-api-key）');
        check(seen.headers['x-ys-custom'] === 'hello', '第二个自定义头也在');
        check(seen.body === body, '正文逐字节到达（含中文与 ✓）');
        check(!('accept-encoding' in seen.headers) || seen.headers['accept-encoding'] === 'identity',
            'Accept-Encoding 是 identity —— 否则透明 gzip 会把流式缓冲成一整块');
    }

    /* ================= 5. GET /models ================= */
    console.log('\n== 5. GET /models ==');
    reached = 5;
    {
        const env = makeEnv({ events: ev.models });
        const resp = await env.win.fetch(BASE + '/models', { method: 'GET' });
        check(resp.status === 200, 'resp.status = 200');
        const c = env.calls.find(x => x.kind === 'start');
        check(c && c.method === 'GET', '交给原生的是 GET');
    }

    /* ================= 6. 对照组：不该拦的必须放行 ================= */
    console.log('\n== 6. 对照组：不该拦的必须放行 ==');
    reached = 6;
    {
        const env = makeEnv({ allowed: () => false, events: [] });
        const resp = await env.win.fetch('https://example.com/x', { method: 'POST', body: '{}' });
        const t = await resp.text();
        check(t === 'ORIGINAL-FETCH', '白名单外走的是**原始 fetch**（不是垫片）');
        check(env.orig.length === 1, '原始 fetch 被调用 1 次');
        check(env.calls.length === 0, '没有对原生桥说任何话');
    }
    {
        // 非字符串 body（Blob / FormData / ReadableStream）必须交回原生 fetch，
        // 不能在垫片里假装能处理 —— 那会把「不支持」变成「静默发错」
        const env = makeEnv({ events: [] });
        const resp = await env.win.fetch('https://aiplatform.googleapis.com/v1/x',
            { method: 'POST', body: new Uint8Array([1, 2, 3]) });
        const t = await resp.text();
        check(t === 'ORIGINAL-FETCH', '非字符串 body 交回原始 fetch');
        check(env.calls.length === 0, '没有对原生桥说任何话');
    }

    /* ================= 7. 失败路径 ================= */
    console.log('\n== 7. 失败路径 ==');
    reached = 7;
    {
        // 连都没连上：fail 在 head 之前 ⇒ fetch 的 Promise 必须 reject（和真 fetch 一样是 TypeError）
        const env = makeEnv({ events: [] , noReplay: true});
        const p = env.win.fetch('https://aiplatform.googleapis.com/v1/x',
            { method: 'POST', body: '{}' });
        const id = env.calls[0].id;
        new Function('window', 'window.__ysAi.fail(' + JSON.stringify(id) + ','
            + JSON.stringify(Buffer.from('Connection refused', 'utf8').toString('base64')) + ')'
        )(env.win);
        let err = null;
        try { await p; } catch (e) { err = e; }
        check(err instanceof TypeError, 'fail 在 head 之前 ⇒ Promise reject TypeError（实得 '
            + (err && err.name) + '）');
    }
    {
        // 已经出了头、正文读到一半断掉 ⇒ reader.read() 必须 reject
        const env = makeEnv({ events: [], noReplay: true });
        const p = env.win.fetch('https://aiplatform.googleapis.com/v1/x',
            { method: 'POST', body: '{}' });
        const id = env.calls[0].id;
        // 先用 head 让它 resolve
        new Function('window', 'window.__ysAi.head(' + JSON.stringify(id) + ',200,"")')(env.win);
        const resp = await p;
        check(resp.status === 200, 'head 先到 ⇒ Promise 立刻 resolve（状态码可读）');
        // 再断掉
        new Function('window', 'window.__ysAi.fail(' + JSON.stringify(id) + ','
            + JSON.stringify(Buffer.from('中途断了', 'utf8').toString('base64')) + ')')(env.win);
        let err = null;
        try { await readAll(resp); } catch (e) { err = e; }
        check(err !== null, '正文中途断掉 ⇒ reader.read() reject（实得 '
            + (err ? err.message : 'null') + '）');
    }
    {
        // abort
        const env = makeEnv({ events: [], noReplay: true });
        const ctl = new AbortController();
        const p = env.win.fetch('https://aiplatform.googleapis.com/v1/x',
            { method: 'POST', body: '{}', signal: ctl.signal });
        const id = env.calls[0].id;
        ctl.abort();
        let err = null;
        try { await p; } catch (e) { err = e; }
        check(err && err.name === 'AbortError', 'abort ⇒ reject AbortError（实得 '
            + (err && err.name) + '）');
        check(env.calls.some(x => x.kind === 'abort' && x.id === id),
            'abort 有告诉原生侧去停 —— 否则原生线程会挂到读超时才退出');
    }
    {
        // Harness 录下来的真实 cancel 用例（head + 若干 chunk + fail）
        const env = makeEnv({ events: ev.cancel });
        const p = env.win.fetch(BASE + '/sse', { method: 'POST', body: '{}' });
        let err = null;
        let resp = null;
        try {
            resp = await p;
        } catch (e) { err = e; }
        if (resp) {
            try { await readAll(resp); } catch (e) { err = e; }
        }
        check(err !== null, '真实取消用例（' + (ev.cancel || []).length
            + ' 条事件）以错误收场，没有伪装成「正常读完」');
    }

    /* ================= 汇总 ================= */
    clearTimeout(watchdog);
    check(reached === 7, '七段用例都跑到了（实得第 ' + reached + ' 段）—— '
        + '少了这条，「静默提前退出」就会伪装成通过');
    console.log();
    if (fails.length === 0) {
        console.log('== JS 侧全部符合预期 ==');
    } else {
        console.log('== ❌ JS 侧 ' + fails.length + ' 条不符 ==');
        for (const f of fails) console.log('   - ' + f);
        process.exit(1);
    }
})().catch(e => {
    // ⚠ 抛异常也要走汇总。
    //   要是这里直接 process.exit(2)，注入测试时就会「当场炸掉、连汇总行都没有」——
    //   那等于反向测试只证明了一半（看见红了，但不知道红了几条、红在哪）。
    //   本轮真的踩到过：注入「每块少一个字节」之后 /json 那段 resp.json() 抛了，
    //   套件当场退出，前面那两条红只留在被截断的输出里。
    clearTimeout(watchdog);
    check(false, '测试执行中断（停在第 ' + reached + ' 段）：' + (e && e.message));
    console.log();
    console.log('== ❌ JS 侧执行中断，第 ' + reached + ' 段之后没跑 ==');
    for (const f of fails) console.log('   - ' + f);
    process.exit(1);
});
