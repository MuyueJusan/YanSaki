/*
 * ai-fetch-shim.js —— 注入到 WebView 里的 fetch 垫片。
 *
 * 为什么需要它
 * ------------
 * 产品本身就是完整的 Vertex AI 客户端：快速模式（x-goog-api-key）和完整模式
 * （Service Account → crypto.subtle 签 RS256 JWT → 换 access token）都实现了。
 * 缺的**不是协议，是「浏览器不许跨域直连」**。
 *
 * 而 CORS 是**浏览器施加的规则** —— 原生 HTTP 里根本没有这个概念。
 * 所以只要把请求从「浏览器网络栈」挪到「原生代码」，这个限制就整个消失，
 * 连预检（OPTIONS）都不用管。
 *
 * ⚠⚠ 为什么不走 WebViewClient.shouldInterceptRequest
 *   ① CORS 到底作不作用于「拦截出来的合成响应」，我没法在本机实测（本机所有
 *      *.googleapis.com 都被代理挡死，http=000）；
 *   ② 预检请求是网络服务发起的，**会不会也走 shouldInterceptRequest 我不确定**；
 *   ③ 它必须在后台线程**同步**返回，流式响应只能靠 PipedInputStream 硬撑。
 *   三条都指向同一件事：那条路的正确性依赖我没法验证的行为。
 *   而这条路是**范畴性地**没有 CORS —— 请求根本没经过浏览器网络栈。
 *
 * ⚠⚠ 白名单不在这个文件里
 *   垫片通过 native.aiAllowed(url) 问原生「这个域名能不能走桥」。
 *   这样**白名单只有一份实现**（AiProxy.ALLOW_SUFFIX），两边不可能漂。
 *   要是这里再抄一份，改了 Java 忘了改 JS 的表现是「请求被垫片接管了，
 *   却报『不在白名单』」—— 能查，但纯属自找。
 *
 * ⚠ 契约：Java → JS 一律走 base64
 *   chunk / head / fail 的字符串参数全部是 base64。原因是转义：
 *   响应体里必然有 \r、\n、引号，还有 U+2028 / U+2029（这两个在 JS 字符串字面量里
 *   是**换行**，会让 evaluateJavascript 整条语法错误）。手写 JSON 转义迟早漏一个，
 *   base64 则没有这个问题。JS → Java 方向不用管：@JavascriptInterface 传的是真参数，
 *   不经过字符串拼接。
 */
(function () {
    'use strict';

    if (window.__ysAiHooked) return 'already';
    window.__ysAiHooked = true;

    var native = window.YanSakiNative;
    if (!native || typeof native.aiStart !== 'function') return 'no-bridge';

    var origFetch = window.fetch ? window.fetch.bind(window) : null;
    if (!origFetch) return 'no-fetch';

    function b64ToBytes(s) {
        var bin = atob(s);
        var out = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }

    function b64ToText(s) {
        return new TextDecoder().decode(b64ToBytes(s));
    }

    function parseHeaders(b64) {
        var h = new Headers();
        try {
            var lines = b64ToText(b64).split('\n');
            for (var i = 0; i < lines.length; i++) {
                var j = lines[i].indexOf(':');
                if (j <= 0) continue;
                try {
                    h.append(lines[i].slice(0, j).trim(), lines[i].slice(j + 1).trim());
                } catch (e) { /* 头名非法就跳过，别为此整条请求失败 */ }
            }
        } catch (e) { }
        return h;
    }

    /* 请求头 → "name: value\n" 文本块（@JavascriptInterface 传参，不需要转义） */
    function headerBlockOf(h) {
        var out = '';
        if (!h) return out;
        try {
            if (typeof h.forEach === 'function') {
                // Headers.prototype.forEach 的回调签名是 (value, key) —— 别写反
                h.forEach(function (v, k) { out += k + ': ' + v + '\n'; });
            } else if (Object.prototype.toString.call(h) === '[object Array]') {
                for (var i = 0; i < h.length; i++) out += h[i][0] + ': ' + h[i][1] + '\n';
            } else {
                for (var k in h) {
                    if (Object.prototype.hasOwnProperty.call(h, k)) out += k + ': ' + h[k] + '\n';
                }
            }
        } catch (e) { }
        return out;
    }

    function allowed(url) {
        try {
            return !!native.aiAllowed(url);
        } catch (e) {
            return false;   // 问不出来就当不允许，交回原生 fetch（失败至少是 CORS 那条老路）
        }
    }

    var pending = Object.create(null);

    /* Java → JS 的事件入口。native 侧用 evaluateJavascript 调它。 */
    window.__ysAi = {
        head: function (id, status, b64) {
            var p = pending[id];
            if (p) p.onHead(status, b64);
        },
        chunk: function (id, b64) {
            var p = pending[id];
            if (p) p.onChunk(b64);
        },
        done: function (id) {
            var p = pending[id];
            if (!p) return;
            delete pending[id];
            p.onDone();
        },
        fail: function (id, b64) {
            var p = pending[id];
            if (!p) return;
            delete pending[id];
            p.onFail(b64);
        }
    };

    var seq = 0;

    window.fetch = function (input, init) {
        var url = null;
        try {
            if (typeof input === 'string') url = input;
            else if (input && typeof input.url === 'string') url = input.url;
        } catch (e) { }

        if (!url) return origFetch(input, init);

        var abs;
        try {
            abs = new URL(url, location.href);
        } catch (e) {
            return origFetch(input, init);
        }

        if (!allowed(abs.href)) return origFetch(input, init);

        var opt = init || {};
        var method = String(opt.method || (input && input.method) || 'GET').toUpperCase();
        var headers = headerBlockOf(opt.headers || (input && input.headers));
        var body = opt.body;

        if (body !== undefined && body !== null && typeof body !== 'string') {
            // 产品里的 body 都是 JSON.stringify(...) 的结果。
            // 遇到 Blob / FormData / ReadableStream 就老实交回原生 fetch ——
            // 在这里假装能处理只会把「不支持」变成「静默发错」。
            return origFetch(input, init);
        }

        var id = 'ysai' + (++seq);
        var ctrl = null, closed = false;

        var stream = new ReadableStream({
            start: function (c) { ctrl = c; },
            cancel: function () { try { native.aiAbort(id); } catch (e) { } }
        });

        function push(bytes) {
            if (closed) return;
            try { ctrl.enqueue(bytes); } catch (e) { }
        }
        function close() {
            if (closed) return;
            closed = true;
            try { ctrl.close(); } catch (e) { }
        }
        function boom(msg) {
            if (closed) return;
            closed = true;
            try { ctrl.error(new Error(msg)); } catch (e) { }
        }

        var settle = { done: false, resolve: null, reject: null };
        var promise = new Promise(function (resolve, reject) {
            settle.resolve = resolve;
            settle.reject = reject;
        });

        /* ⚠ 状态码到了就立刻 resolve —— 页面紧接着读 resp.ok / resp.status。
              并到最后一起回会让「发送」看起来卡死几十秒。 */
        function resolveWith(status, hb64) {
            if (settle.done) return;
            settle.done = true;
            var h = parseHeaders(hb64);
            var noBody = (status === 204 || status === 205 || status === 304);
            try {
                settle.resolve(noBody
                    ? new Response(null, { status: status, headers: h })
                    : new Response(stream, { status: status, headers: h }));
            } catch (e) {
                // status 不在 200..599 时 Response 构造会抛错。把真状态塞进一个头里，
                // 至少不把「上游状态码异常」伪装成「请求失败」。
                try {
                    var h2 = new Headers(h);
                    h2.set('x-ys-upstream-status', String(status));
                    settle.resolve(new Response(stream, { status: 200, headers: h2 }));
                } catch (e2) {
                    settle.reject(new TypeError('垫片构造响应失败: ' + e2));
                }
            }
        }

        function abortWith(reason) {
            try { native.aiAbort(id); } catch (e) { }
            boom(reason);
            if (!settle.done) {
                settle.done = true;
                try {
                    settle.reject(new DOMException(reason, 'AbortError'));
                } catch (e) {
                    settle.reject(new Error(reason));
                }
            }
        }

        pending[id] = {
            onHead: function (status, hb64) { resolveWith(status, hb64); },
            onChunk: function (b64) { push(b64ToBytes(b64)); },
            onDone: function () {
                close();
                // 极端情况：一个字节正文都没有、头也没来过。别让 Promise 永远挂着。
                if (!settle.done) resolveWith(200, '');
            },
            onFail: function (b64) {
                var msg = b64 ? b64ToText(b64) : '未知错误';
                boom(msg);
                if (!settle.done) {
                    settle.done = true;
                    // 连接层面的失败在真 fetch 里也是 TypeError，保持一致
                    settle.reject(new TypeError(msg));
                }
            }
        };

        var sig = opt.signal || (input && input.signal);
        if (sig) {
            if (sig.aborted) {
                abortWith('aborted');
                return promise;
            }
            try {
                sig.addEventListener('abort', function () { abortWith('aborted'); });
            } catch (e) { }
        }

        try {
            native.aiStart(id, abs.href, method, headers, body == null ? '' : body);
        } catch (e) {
            delete pending[id];
            boom('native.aiStart 失败: ' + e);
            if (!settle.done) {
                settle.done = true;
                settle.reject(new TypeError('native.aiStart 失败: ' + e));
            }
        }

        return promise;
    };

    return 'hooked';
})();
