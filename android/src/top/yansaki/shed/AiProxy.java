package top.yansaki.shed;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 替页面把「跨域发不出去」的请求代发出去。
 *
 * <h2>为什么需要它</h2>
 * 产品本身就是完整的 Vertex AI 客户端 —— 快速模式（{@code x-goog-api-key}）和完整模式
 * （Service Account → {@code crypto.subtle} 签 RS256 JWT → 换 access token）都实现了。
 * 缺的**不是协议，是「浏览器不许跨域直连」**。而 CORS 是**浏览器施加的规则**，
 * 原生 HTTP 里根本没有这个概念 ⇒ 只要把请求挪到原生层发，这个限制就整个消失，
 * 连预检（OPTIONS）都不必存在。
 *
 * <h2>⚠⚠ 为什么这个类不 import 任何 android.*</h2>
 * 因为它要能被**桌面 JVM 真跑起来**。
 * 封装层里最难查的就是「看起来对、但只有装到手机上才知道对不对」的那部分；
 * 而这个类承载了转发逻辑的**全部**：URL、请求头、请求体、分块读取、状态码、错误映射、取消。
 * 只依赖 {@code java.net} 的话，就能配一个本地 HTTP 服务器在桌面上端到端跑一遍
 * （见 {@code tools/test-aiproxy/}），把「契约两侧对得上」变成实测而不是信念。
 * ⇒ 线程、WebView、{@code evaluateJavascript} 这些才留给 {@link MainActivity}。
 *
 * <h2>⚠ 分块必须真的分块</h2>
 * SSE 的价值就在**边收边显示**。所以这里读一块吐一块，绝不 {@code readAllBytes()}。
 * 同时必须显式要 {@code Accept-Encoding: identity} —— 否则 HttpURLConnection 会自己加上
 * gzip 并做**透明解压**，而透明解压会把流式缓冲成一整块，表现就是「回复要等全部生成完才出现」。
 */
public final class AiProxy {

    private AiProxy() { }

    /**
     * 回调。方法都在**后台线程**上被调用。
     *
     * ⚠ 回调里**不要做重活**（比如直接 evaluateJavascript）—— 见 MainActivity 的做法：
     *   切回 UI 线程再派发。
     */
    public interface Sink {
        /**
         * 响应头到了（状态码 + 响应头）。
         *
         * ⚠⚠ 必须**单独**一个回调，不能等读完再一起给。
         *   因为页面在 {@code await fetch()} 之后**立刻**读 {@code resp.ok} / {@code resp.status}
         *   （见产品里 stAiRequest 的 `if (!resp.ok) { … resp.text() … }`）。
         *   要是把状态码并到最后一起回，那 fetch 的 Promise 就得等到**整个回复生成完**才 resolve
         *   —— 表现是「点了发送，界面卡住几十秒，然后一次性出现全部文字」，
         *   看起来像卡死，而且错误状态码也失去了「立刻可读」的意义。
         */
        void onHead(int status, String b64Headers);

        /** 响应体的一个字节块，base64 编码。 */
        void onChunk(String b64);

        /** 正文读完了。 */
        void onDone();

        /** 连都没连上 / 中途断了 / 被取消。message 直接给人看。 */
        void onFail(String message);
    }

    /**
     * 取消句柄。页面在超时或用户点「停止」时会 abort，
     * 没有它原生线程会一直挂到读超时（180 秒）才退出。
     *
     * ⚠ 取消是**尽力而为**：靠 {@code disconnect()} 把 socket 关掉，让阻塞中的 read 抛异常。
     *   这是 Android HttpURLConnection 上通行的做法，但不是规范保证的行为。
     */
    public static final class Handle {
        private volatile HttpURLConnection conn;
        private volatile boolean cancelled;

        public void cancel() {
            cancelled = true;
            HttpURLConnection c = conn;
            if (c != null) {
                try { c.disconnect(); } catch (Exception ignored) { }
            }
        }

        public boolean isCancelled() { return cancelled; }

        void bind(HttpURLConnection c) {
            conn = c;
            // ⚠ 竞态：可能刚 bind 就被取消了。补一次，否则这次取消会丢掉。
            if (cancelled && c != null) {
                try { c.disconnect(); } catch (Exception ignored) { }
            }
        }
    }

    /**
     * 允许走这个桥的域名（后缀匹配）。
     *
     * ⚠ 白名单而不是「全都放行」：这个桥绕过了浏览器的一切同源策略，
     *   放开就等于把整个网络能力交给页面。多一项就多一份风险，所以逐条写清楚为什么在。
     *
     * ⚠ 区域端点长这样：{@code us-central1-aiplatform.googleapis.com}
     *   —— 标签里是**连字符**不是点，所以只能后缀匹配，不能精确匹配。
     *
     * ⚠⚠ 这是白名单的**唯一**一份实现。垫片那边不抄一份，而是通过
     *   {@code YanSakiNative.aiAllowed(url)} 问这里。见 shim/ai-fetch-shim.js 的注释。
     */
    private static final String[] ALLOW_SUFFIX = {
            "aiplatform.googleapis.com",          // Vertex AI（全球端点 + 各区域端点）
            "oauth2.googleapis.com",              // 完整模式换 access token
            "generativelanguage.googleapis.com",  // 产品里另一个 Google 供应商（原生 Gemini 协议）
            "127.0.0.1",                          // 本机网关（「开源网关塞进 APK」那条路要用）
            "localhost",
    };

    /** 域名在不在白名单里。{@link #execute} 会自己再查一遍 —— 垫片被绕过时这里仍然拦得住。 */
    public static boolean hostAllowed(String url) {
        String host = hostOf(url);
        if (host == null) return false;
        String h = host.toLowerCase(Locale.ROOT);
        for (String s : ALLOW_SUFFIX) {
            if (h.equals(s) || h.endsWith("." + s)) return true;
        }
        return false;
    }

    private static String hostOf(String url) {
        try {
            String h = new URL(url).getHost();
            return (h == null || h.isEmpty()) ? null : h;
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * ⚠⚠ 「后端放哪」的**唯一接缝**。
     *
     * <p>默认原样直连。要把请求转给**本机网关**（也就是把开源网关塞进 APK 的那条路，
     * nodejs-mobile 之类）时，只改这一个方法，例如：
     * <pre>
     *   return url.replace("https://aiplatform.googleapis.com", "http://127.0.0.1:4000");
     * </pre>
     * 页面侧一个字都不用改 —— 这正是「App 内原生转发」与「本机开源网关」能互为保底的原因：
     * 两者的**接缝是同一条**，区别只在接缝下游换成谁。
     */
    public static String upstream(String url) {
        return url;
    }

    /** 便捷重载：不关心取消。 */
    public static void execute(String url, String method, String headerBlock,
                               String body, Sink sink) {
        execute(url, method, headerBlock, body, sink, null);
    }

    /**
     * 同步执行一次请求，边读边通过 {@code sink} 吐出去。**会阻塞**，调用方自己起线程。
     *
     * @param headerBlock 请求头，一行一个 {@code name: value}（用 {@code \n} 分隔）。
     *                    走 {@code @JavascriptInterface} 传参，所以不需要任何转义处理。
     * @param handle      取消句柄，可为 null。
     */
    public static void execute(String url, String method, String headerBlock,
                               String body, Sink sink, Handle handle) {
        if (!hostAllowed(url)) {
            sink.onFail("这个域名不在白名单里，转发被拒绝：" + url);
            return;
        }
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(upstream(url)).openConnection();
            if (handle != null) handle.bind(conn);

            conn.setRequestMethod(method == null || method.isEmpty() ? "GET"
                    : method.toUpperCase(Locale.ROOT));
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(180000);
            conn.setInstanceFollowRedirects(true);

            // ⚠ 见类注释：不加这句，透明 gzip 解压会把 SSE 缓冲成一整块。
            conn.setRequestProperty("Accept-Encoding", "identity");

            for (String line : (headerBlock == null ? "" : headerBlock).split("\n")) {
                int i = line.indexOf(':');
                if (i <= 0) continue;
                String k = line.substring(0, i).trim();
                String v = line.substring(i + 1).trim();
                if (k.isEmpty()) continue;
                try {
                    conn.setRequestProperty(k, v);
                } catch (Exception ignored) {
                    // 有些头 HttpURLConnection 不许设（Host / Content-Length / Connection…）。
                    // 设不上就算了，不是错误 —— 别为此整条请求失败。
                }
            }

            if (body != null && !body.isEmpty()) {
                conn.setDoOutput(true);
                byte[] raw = body.getBytes(StandardCharsets.UTF_8);
                conn.setFixedLengthStreamingMode(raw.length);
                OutputStream out = conn.getOutputStream();
                try {
                    out.write(raw);
                    out.flush();
                } finally {
                    try { out.close(); } catch (IOException ignored) { }
                }
            }

            int status = conn.getResponseCode();

            // ⚠ 先吐头。页面要靠它决定「是不是错误」以及要不要读正文。
            sink.onHead(status, Base64.getEncoder().encodeToString(
                    headersBlock(conn).getBytes(StandardCharsets.UTF_8)));

            // ⚠ 非 2xx **不抛异常**：页面在 stAiRequest 里读 resp.text() 拿错误正文
            //   （Google 的错误 JSON 里才有真正的原因）。这里抛掉就等于把它丢了。
            InputStream in;
            try {
                in = conn.getInputStream();
            } catch (IOException e) {
                in = conn.getErrorStream();
            }

            if (in != null) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) {
                    if (handle != null && handle.isCancelled()) {
                        try { in.close(); } catch (IOException ignored) { }
                        sink.onFail("已取消");
                        return;
                    }
                    sink.onChunk(Base64.getEncoder().encodeToString(Arrays.copyOf(buf, n)));
                }
                try { in.close(); } catch (IOException ignored) { }
            }

            sink.onDone();

        } catch (Exception e) {
            if (handle != null && handle.isCancelled()) {
                sink.onFail("已取消");
                return;
            }
            String msg = e.getClass().getSimpleName() + ": " + e.getMessage();
            sink.onFail(msg == null ? "未知错误" : msg);
        } finally {
            if (conn != null) {
                try { conn.disconnect(); } catch (Exception ignored) { }
            }
        }
    }

    /** 响应头 → {@code name: value\n} 的文本块。 */
    private static String headersBlock(HttpURLConnection conn) {
        StringBuilder sb = new StringBuilder();
        try {
            for (Map.Entry<String, List<String>> e : conn.getHeaderFields().entrySet()) {
                if (e.getKey() == null) continue;           // 状态行，键是 null
                for (String v : e.getValue()) {
                    sb.append(e.getKey()).append(": ").append(v).append('\n');
                }
            }
        } catch (Exception ignored) { }
        return sb.toString();
    }
}
