package top.yansaki.shed;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Locale;

/**
 * 把 {@link AiProxy.Sink} 的回调翻译成 {@code evaluateJavascript} 要执行的那一行 JS。
 *
 * <h2>⚠⚠ 这个类存在的唯一理由：不让「Java 侧怎么拼 JS」出现第二份实现</h2>
 * 它在 App 里跑，也在 {@code tools/test-aiproxy/} 的**桌面 JVM** 上跑
 * （所以它不 import 任何 {@code android.*}）。
 * 于是桌面测试回放给垫片的，就是**产品真正会发出的那些字符串**，
 * 而不是测试自己拼的近似品 —— 否则「契约两侧对得上」就退化成「我以为对得上」，
 * 而那正是这一类代码最容易骗过自己的地方。
 *
 * <h2>⚠ 为什么 Java → JS 一律走 base64</h2>
 * 响应体里必然有 {@code \r}、{@code \n}、引号，还有 U+2028 / U+2029 ——
 * 后两个在 JS 字符串字面量里是**换行**，会让整条 {@code evaluateJavascript} 语法错误，
 * 而且报错位置毫无线索。手写 JSON 转义迟早会漏一个；base64 的字符集是
 * {@code A-Za-z0-9+/=}，没有这个问题。
 * JS → Java 方向不用管：{@code @JavascriptInterface} 传的是真参数，不经过字符串拼接。
 */
public final class JsEvent {

    private JsEvent() { }

    public static String head(String id, int status, String b64Headers) {
        return "window.__ysAi&&window.__ysAi.head(" + jsStr(id) + "," + status + ","
                + jsStr(b64Headers) + ")";
    }

    public static String chunk(String id, String b64) {
        return "window.__ysAi&&window.__ysAi.chunk(" + jsStr(id) + "," + jsStr(b64) + ")";
    }

    public static String done(String id) {
        return "window.__ysAi&&window.__ysAi.done(" + jsStr(id) + ")";
    }

    /**
     * ⚠ 参数是**人话消息**，base64 在这里做。调用方（Sink 实现）不需要知道 base64 这件事 ——
     * 少一个「该 base64 却忘了」的机会。
     */
    public static String fail(String id, String message) {
        return "window.__ysAi&&window.__ysAi.fail(" + jsStr(id) + "," + jsStr(b64(message)) + ")";
    }

    /**
     * 把任意字符串包成 JS 字符串字面量。
     *
     * ⚠ 实际上这里只会收到 base64（见类注释），转义仍然写全，是为了
     *   「以后有人传了别的东西」时不会**静默**出错。
     */
    public static String jsStr(String s) {
        if (s == null) return "\"\"";
        StringBuilder sb = new StringBuilder(s.length() + 2);
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"':  sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                case '\u2028': sb.append("\\u2028"); break;
                case '\u2029': sb.append("\\u2029"); break;
                default:
                    if (c < 0x20) {
                        sb.append(String.format(Locale.ROOT, "\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        sb.append('"');
        return sb.toString();
    }

    /** ⚠ 用 java.util.Base64（不是 android.util）—— 这个类要在桌面 JVM 上跑。 */
    public static String b64(String s) {
        return Base64.getEncoder().encodeToString(
                (s == null ? "" : s).getBytes(StandardCharsets.UTF_8));
    }
}
