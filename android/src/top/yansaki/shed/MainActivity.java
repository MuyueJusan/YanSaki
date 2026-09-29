package top.yansaki.shed;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URLConnection;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 「YanSaki的小屋」的 Android 封装：一个 WebView，页面来自 APK 内的 assets/。
 *
 * ⚠⚠ 本文件里最不能省的一段是 {@link #HOST} 那套「假域名 + shouldInterceptRequest」。
 *
 *   产品里 localStorage 用了 70 多处（选项卡状态、卡片草稿、状态栏、主题…）。
 *   如果直接 `loadUrl("file:///android_asset/index.html")`，页面的 origin 是
 *   **opaque origin**，`localStorage` 一访问就抛 SecurityError —— 表现是「设置全部存不住」，
 *   而且不报错到界面上，非常难查。
 *
 *   所以这里学 androidx.webkit 的 WebViewAssetLoader：用一个**保留域名**
 *   appassets.androidplatform.net，在 shouldInterceptRequest 里把请求换成读 assets。
 *   于是页面跑在真正的 https origin 上 ⇒ localStorage / fetch / FileReader 全部正常。
 *   纯 framework API，**不需要任何依赖**（Gradle 都不用）。
 *
 * ⚠ 另一处：导出。产品里所有导出都汇到 `stDownload(filename, blob)` →
 *   `URL.createObjectURL` + `<a download>` + `a.click()`。WebView 的 DownloadListener
 *   拿到 blob: URL 是**取不到内容**的。所以这里在页面加载完成后注入一小段脚本，
 *   把 `HTMLAnchorElement.prototype.click` 包一层：只拦「带 download 属性且 href 是 blob:」
 *   的那一下，读出字节丢给 {@link Bridge#saveFile}，其余原样放行。
 *   ⇒ **不改产品源码**，封装层自己消化差异。
 *
 * ⚠ 第三处：AI 跨域。产品本身就是完整的 Vertex AI 客户端（快速模式 / Service Account 完整模式
 *   都实现了），缺的**不是协议，是「浏览器不许跨域直连」**。
 *   CORS 是浏览器施加的规则，原生 HTTP 里没有这个概念 ⇒ 把请求挪到原生层发就没有了。
 *   做法同样是注入垫片（{@code shim/ai-fetch-shim.js}），包装 `window.fetch`：
 *   命中白名单的请求交给 {@link AiProxy} 代发，再用 ReadableStream 还原出
 *   `resp.ok / resp.status / resp.text() / resp.json() / resp.body.getReader()`。
 *   ⇒ 同样**不改产品源码**。
 *   ⚠ 为什么不用 `shouldInterceptRequest`：那条路的正确性依赖三个我没法在本机实测的行为
 *     （CORS 是否作用于合成响应 / 预检是否也走拦截 / 必须在后台线程同步返回）。
 *     详见 shim/ai-fetch-shim.js 顶部注释。
 */
public class MainActivity extends Activity {

    /** 保留域名（androidx 也用这个）。它不解析，全靠 shouldInterceptRequest 兜住。 */
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/index.html";

    private static final int REQ_FILE = 1001;
    private static final String TAG = "YanSakiShed";

    /** AI 转发垫片。由 build.sh 从 shim/ 拷进 assets/。 */
    private static final String SHIM_ASSET = "ys-ai-shim.js";

    private WebView web;
    private ValueCallback<Uri[]> fileCb;

    /**
     * 正在跑的转发请求：id → 取消句柄。
     * ⚠ 用 ConcurrentHashMap：`aiStart` 在 JS 桥线程上写，`aiAbort` 也从那边来，
     *   而收尾在后台线程上删 —— 三边并发。
     */
    private final Map<String, AiProxy.Handle> aiLive = new ConcurrentHashMap<String, AiProxy.Handle>();

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);

        web = new WebView(this);
        web.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.setBackgroundColor(Color.WHITE);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);        // ← localStorage。必须。
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        // 页面是按固定字号排版的仪表盘；跟随系统字体缩放会把布局撑散
        s.setTextZoom(100);
        // 别让 WebView 自己给页面叠暗色滤镜 —— 小屋有自己的 retro 皮肤
        if (Build.VERSION.SDK_INT >= 33) {
            s.setAlgorithmicDarkeningAllowed(false);
        } else if (Build.VERSION.SDK_INT >= 29) {
            s.setForceDark(WebSettings.FORCE_DARK_OFF);
        }

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (u == null || !HOST.equals(u.getHost())) return null;   // 外网请求照常放行
                String path = u.getPath();
                if (path == null || path.isEmpty() || "/".equals(path)) path = "/index.html";
                try {
                    InputStream in = getAssets().open(path.substring(1));
                    return new WebResourceResponse(mimeOf(path), "utf-8", in);
                } catch (IOException e) {
                    // ⚠ 别在这里返回 null —— null 会让 WebView 真的去 DNS 解析这个假域名，
                    //    然后报一个和真实原因（文件不存在）毫无关系的网络错误。
                    HashMap<String, String> h = new HashMap<String, String>();
                    return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                            h, new ByteArrayInputStream(("asset not found: " + path).getBytes()));
                }
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                v.evaluateJavascript(DOWNLOAD_SHIM, null);
                // ⚠ 顺序无关紧要（两者互不依赖），但都在 onPageFinished 里注入。
                //   安全性来自实测：产品**从不把 fetch 存进变量**（grep 过），
                //   所有调用点都是裸 fetch(...)，所以在这里换掉 window.fetch 一定生效。
                v.evaluateJavascript(readShim(), null);
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            // 没有 WebChromeClient 的话，页面里的 alert/confirm 会被**静默丢弃**
            // （产品里有 20 处），表现是「点了按钮没反应」。
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d(TAG, m.message() + " @" + m.lineNumber());
                return true;
            }

            // 产品里有 8 个 <input type="file">（导入卡片 / 头像 / 世界书…）
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb,
                                             FileChooserParams params) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE);
                    return true;
                } catch (Exception e) {
                    Log.w(TAG, "file chooser failed", e);
                    fileCb = null;
                    return false;
                }
            }
        });

        web.addJavascriptInterface(new Bridge(), "YanSakiNative");
        web.loadUrl(START_URL);
    }

    // ================= 返回键 =================
    // ⚠ 小屋是选项卡式 SPA，`canGoBack()` 基本都是 false ⇒ 从任何一页按返回都会直接退出。
    //    这是 v1 已知的粗糙点，不是 bug：要做到「先回首页」得让页面自己暴露一个钩子，
    //    那是产品改动，不该由封装层偷偷做。
    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == REQ_FILE) {
            if (fileCb != null) {
                fileCb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
                fileCb = null;
            }
            return;
        }
        super.onActivityResult(req, res, data);
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.removeJavascriptInterface("YanSakiNative");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    // ================= 导出落盘 =================

    /** 暴露给页面的桥：写文件（导出）+ 代发跨域请求（AI）。 */
    private class Bridge {
        @JavascriptInterface
        public void saveFile(final String name, final String b64) {
            final String safe = (name == null || name.trim().isEmpty()) ? "yansaki-export.bin"
                    : name.replaceAll("[\\\\/:*?\"<>|]+", "_");
            try {
                byte[] data = Base64.decode(b64, Base64.DEFAULT);
                saveToDownloads(safe, data);
                toastOnUi("已保存到「下载」：" + safe);
            } catch (Exception e) {
                Log.w(TAG, "saveFile failed", e);
                toastOnUi("保存失败：" + e.getClass().getSimpleName());
            }
        }

        /**
         * 垫片问「这个域名能不能走桥」。
         *
         * ⚠⚠ 白名单**只有 AiProxy 里那一份**。垫片不抄一份，就是为了不可能漂：
         *   两边各写一份的话，改了 Java 忘了改 JS 的表现是「请求被垫片接管了，
         *   却报『不在白名单』」—— 能查，但纯属自找。
         */
        @JavascriptInterface
        public boolean aiAllowed(String url) {
            return AiProxy.hostAllowed(url);
        }

        /**
         * 开始一次转发。**立刻返回**，真正的活在后台线程上。
         * 结果通过 {@code window.__ysAi.head/chunk/done/fail} 回推给垫片。
         *
         * ⚠ 这里绝不能同步做网络请求：这是 JS 桥线程，阻塞它会卡住整个页面。
         */
        @JavascriptInterface
        public void aiStart(final String id, final String url, final String method,
                            final String headers, final String body) {
            if (id == null || id.isEmpty()) return;
            final AiProxy.Handle h = new AiProxy.Handle();
            aiLive.put(id, h);

            Thread t = new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        AiProxy.execute(url, method, headers, body, new AiProxy.Sink() {
                            @Override
                            public void onHead(int status, String b64Headers) {
                                emit(JsEvent.head(id, status, b64Headers));
                            }

                            @Override
                            public void onChunk(String b64) {
                                emit(JsEvent.chunk(id, b64));
                            }

                            @Override
                            public void onDone() {
                                emit(JsEvent.done(id));
                            }

                            @Override
                            public void onFail(String msg) {
                                emit(JsEvent.fail(id, msg));
                            }
                        }, h);
                    } finally {
                        aiLive.remove(id);
                    }
                }
            }, "ys-ai");
            t.setDaemon(true);
            t.start();
        }

        /** 页面 abort 了（超时或用户点停止）⇒ 尽力把原生请求也停掉。 */
        @JavascriptInterface
        public void aiAbort(String id) {
            if (id == null) return;
            AiProxy.Handle h = aiLive.remove(id);
            if (h != null) h.cancel();
        }
    }

    /**
     * ⚠ Java → JS 那一行怎么拼**不在这里** —— 在 {@link JsEvent}。
     *   抽出去的理由是：那个类不 import android.*，所以桌面测试
     *   （tools/test-aiproxy/）能在真 JVM 上跑同一份实现，
     *   回放给垫片的字符串就是产品真正会发出的那些。
     */
    private void emit(final String js) {
        final WebView w = web;
        if (w == null) return;
        w.post(new Runnable() {
            @Override
            public void run() {
                if (web == null) return;
                try {
                    web.evaluateJavascript(js, null);
                } catch (Exception e) {
                    Log.w(TAG, "evaluateJavascript failed", e);
                }
            }
        });
    }

    /** 读垫片。读不到就注入一条会喊出来的脚本 —— 静默失效最难查。 */
    private String readShim() {
        try {
            InputStream in = getAssets().open(SHIM_ASSET);
            try {
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
                return new String(bos.toByteArray(), StandardCharsets.UTF_8);
            } finally {
                try { in.close(); } catch (IOException ignored) { }
            }
        } catch (IOException e) {
            Log.w(TAG, "读不到 " + SHIM_ASSET, e);
            return "console.error('" + SHIM_ASSET + " 读不到：AI 转发垫片没装上')";
        }
    }

    private void toastOnUi(final String msg) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show();
            }
        });
    }

    private void saveToDownloads(String name, byte[] data) throws IOException {
        ContentValues cv = new ContentValues();
        cv.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        cv.put(MediaStore.MediaColumns.MIME_TYPE, mimeOf(name));
        cv.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
        Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
        if (uri == null) throw new IOException("MediaStore 拒绝了插入（同名文件被占用？）");
        OutputStream out = getContentResolver().openOutputStream(uri);
        if (out == null) throw new IOException("拿不到输出流");
        try {
            out.write(data);
            out.flush();
        } finally {
            try { out.close(); } catch (IOException ignored) { }
        }
    }

    private static String mimeOf(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".gif")) return "image/gif";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".ttf")) return "font/ttf";
        if (p.endsWith(".txt")) return "text/plain";
        String guess = URLConnection.guessContentTypeFromName(path);
        return guess != null ? guess : "application/octet-stream";
    }

    /**
     * 页面加载完成后注入的下载垫片。
     *
     * ⚠ 拦截点选 `HTMLAnchorElement.prototype.click` 而不是 `stDownload`：
     *   后者是产品里的函数名，改名就失效，而且等于把封装层焊死在产品实现上。
     *   `a.click()` 是**浏览器 API**，产品的下载必然经过它。
     *
     * ⚠ 守卫必须两条同时成立（带 download 属性 **且** href 是 blob:），
     *   否则会把页面里其他用 a.click() 的地方一起吃掉。
     */
    private static final String DOWNLOAD_SHIM =
            "(function(){"
          + " if (window.__ysNativeHooked) return 'already';"
          + " window.__ysNativeHooked = true;"
          + " var orig = HTMLAnchorElement.prototype.click;"
          + " HTMLAnchorElement.prototype.click = function(){"
          + "   try {"
          + "     var href = this.getAttribute('href') || this.href || '';"
          + "     if (this.hasAttribute('download') && href.indexOf('blob:') === 0) {"
          + "       var name = this.getAttribute('download') || 'download.bin';"
          + "       fetch(href).then(function(r){ return r.blob(); }).then(function(b){"
          + "         var fr = new FileReader();"
          + "         fr.onload = function(){"
          + "           var s = String(fr.result), i = s.indexOf(',');"
          + "           window.YanSakiNative.saveFile(name, i >= 0 ? s.slice(i + 1) : s);"
          + "         };"
          + "         fr.readAsDataURL(b);"
          + "       })['catch'](function(e){ console.error('saveFile failed: ' + e); });"
          + "       return;"
          + "     }"
          + "   } catch (e) { console.error('shim: ' + e); }"
          + "   return orig.apply(this, arguments);"
          + " };"
          + " return 'hooked';"
          + "})()";
}
