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
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URLConnection;
import java.util.HashMap;
import java.util.Locale;

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
 */
public class MainActivity extends Activity {

    /** 保留域名（androidx 也用这个）。它不解析，全靠 shouldInterceptRequest 兜住。 */
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/index.html";

    private static final int REQ_FILE = 1001;
    private static final String TAG = "YanSakiShed";

    private WebView web;
    private ValueCallback<Uri[]> fileCb;

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

    /** 暴露给页面的桥。只做一件事：把 base64 写成「下载」目录里的文件。 */
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
