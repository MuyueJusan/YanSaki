// 存储桥（APK 专属）—— 把页面的 localStorage 镜像到原生，并把原生的改动回灌。
//
// ⚠⚠ 为什么需要它：原生界面读不到 WebView 的 localStorage（那是按 origin 存在 WebView
//   自己目录里的东西）。所以两边靠一份「镜像」对齐：
//     页面 → 原生：整份推一次 + 每次 setItem 写穿
//     原生 → 页面：原生写镜像时同时回推 WebView；WebView 不在就记在 pending 里，
//                  下次页面加载时由本脚本灌进去，并 reload 一次让它生效。
//
// ⚠ 顺序很重要：先处理 pending（那是原生改的、网页还不知道的），再整份推送。
//   反过来的话，页面会先用旧值覆盖镜像，原生的改动就丢了。
//
// ⚠ 注入时机是 onPageFinished —— 此时页面**已经**读完了自己的配置。所以「回灌」
//   必须靠一次 reload 才生效。⚠ 一定要有防循环的闸门（见下面 __ys_pending_done），
//   否则 pending 没清干净就会无限重载。
(function () {
    'use strict';
    var N = window.YanSakiNative;
    if (!N || typeof N.storeSync !== 'function') return;

    // ───────── 1. 回灌原生改过的键 ─────────
    var FLAG = '__ys_pending_applied';
    try {
        var pendRaw = N.storePending();
        var pend = pendRaw ? JSON.parse(pendRaw) : null;
        var keys = pend ? Object.keys(pend) : [];
        if (keys.length) {
            if (!sessionStorage.getItem(FLAG)) {
                for (var i = 0; i < keys.length; i++) {
                    try { localStorage.setItem(keys[i], pend[keys[i]]); } catch (e) { }
                }
                sessionStorage.setItem(FLAG, '1');
                location.reload();
                return;
            }
            // 已经 reload 过一次还是拿得到 pending ⇒ 说明回灌没生效，
            // 那就别再 reload 了（否则死循环），直接放弃并留痕。
            console.warn('[ys-store] pending 回灌后仍在，跳过重载');
        }
        sessionStorage.removeItem(FLAG);
    } catch (e) {
        console.warn('[ys-store] pending 处理失败', e);
    }

    // ───────── 2. 整份镜像 ─────────
    var dump = {};
    try {
        for (var k = 0; k < localStorage.length; k++) {
            var key = localStorage.key(k);
            dump[key] = localStorage.getItem(key);
        }
    } catch (e) { }

    // 顺带把服务商清单带给原生 —— 免得 Java 里再抄一份 19 个服务商的名字和地址
    // （抄了就是第二份真相源，加一家就得记着改两处）
    try {
        if (typeof AI_PROVIDERS !== 'undefined' && AI_PROVIDERS && AI_PROVIDERS.length) {
            dump.__ys_providers = JSON.stringify(AI_PROVIDERS.map(function (p) {
                // [id, 名字, 默认 baseUrl, 协议] —— 第 4 项是原生聊天要的：
                // 三种协议的 SSE 格式完全不同（openai / anthropic / gemini），
                // 抄一份到 Java 里就是第二份真相源，加一家服务商要记着改两处。
                return [p.value, p.label, p.baseUrl || '', p.proto || 'openai'];
            }));
        }
    } catch (e) { }

    // 人设生成器的**内置模板正文** + **系统提示词**也一起带过去。
    // ⚠ 不抄进 Java：那两段加起来快 300 行中文提示词，抄一份就是第二份真相源，
    //   网页那边改一个字，原生这边就悄悄用旧的了（而且没有任何一层会报）。
    try {
        if (typeof ST_PERSONA_TPLS_BUILTIN !== 'undefined' && ST_PERSONA_TPLS_BUILTIN) {
            dump.__ys_persona_tpls = JSON.stringify(
                ST_PERSONA_TPLS_BUILTIN.map(function (t) {
                    return [t.id, t.name, t.body];
                })
            );
        }
    } catch (e) { }
    try {
        if (typeof stPersonaSysPrompt === 'function') {
            dump.__ys_persona_sys = String(stPersonaSysPrompt() || '');
        }
    } catch (e) { }

    try { N.storeSync(JSON.stringify(dump)); } catch (e) { }

    // ───────── 3. 写穿 ─────────
    // ⚠ 改的是 Storage.prototype，不是 localStorage 这个实例：产品里有 76 处调用，
    //   逐处包一层必然会漏，而漏掉的那一处就是「改了、刷新后又变回去」。
    var SP = Storage.prototype;
    if (!SP.__ysPatched) {
        SP.__ysPatched = true;
        var rawSet = SP.setItem, rawRem = SP.removeItem, rawClr = SP.clear;

        SP.setItem = function (k, v) {
            rawSet.call(this, k, v);
            try { if (this === localStorage) N.storePut(String(k), String(v)); } catch (e) { }
        };
        SP.removeItem = function (k) {
            rawRem.call(this, k);
            try { if (this === localStorage) N.storeRemove(String(k)); } catch (e) { }
        };
        SP.clear = function () {
            rawClr.call(this);
            try { if (this === localStorage) N.storeClear(); } catch (e) { }
        };
    }
})();
