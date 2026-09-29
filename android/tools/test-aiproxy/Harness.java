import top.yansaki.shed.AiProxy;
import top.yansaki.shed.JsEvent;

import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;

/**
 * 桌面契约测试的「Java 侧」：用**真正的 {@link AiProxy}** 打本地假上游，
 * 把 {@link JsEvent} 产生的那行 JS **原样**录到文件里。
 *
 * ⚠⚠ 为什么必须用真的 AiProxy 和真的 JsEvent，而不是测试自己拼近似品
 *   这个测试要回答的是「契约两侧对得上吗」。
 *   如果测试自己拼一遍「大概长这样」的字符串喂给垫片，那测的是测试自己的想象，
 *   产品改坏了它照样绿。所以这里跑的就是产品那份代码 —— 这也是这两个类
 *   被刻意写成不 import android.* 的原因。
 *
 * 用法：java Harness <baseUrl> <outFile>
 */
public class Harness {

    private static final List<String> FAILS = new ArrayList<>();
    private static final StringBuilder OUT = new StringBuilder();

    public static void main(String[] args) throws Exception {
        String base = args[0];
        String outFile = args[1];

        // ---------- 1. /sse：真·分块流式 ----------
        List<String> lines = run("sse", base + "/sse",
                "POST",
                "content-type: application/json\nx-goog-api-key: TEST-KEY-123\n",
                "{\"contents\":[{\"parts\":[{\"text\":\"hi\"}]}],\"stream\":true}");

        int chunks = 0;
        int status = -1;
        for (String l : lines) {
            if (l.contains(".head(")) {
                status = Integer.parseInt(l.substring(l.indexOf("head(")).split(",")[1]);
            }
            if (l.contains(".chunk(")) chunks++;
        }
        check(status == 200, "/sse 状态码 = 200（实得 " + status + "）");
        check(chunks >= 2, "/sse 收到 >= 2 个分块（实得 " + chunks + "）—— 这是「真流式」的判据");

        // ---------- 2. /json：单块 ----------
        lines = run("json", base + "/json", "POST",
                "content-type: application/json\n", "{\"a\":1}");
        status = -1;
        for (String l : lines) {
            if (l.contains(".head(")) {
                status = Integer.parseInt(l.substring(l.indexOf("head(")).split(",")[1]);
            }
        }
        check(status == 200, "/json 状态码 = 200（实得 " + status + "）");

        // ---------- 3. /err：非 2xx 必须照样把正文吐出来 ----------
        lines = run("err", base + "/err", "POST",
                "content-type: application/json\n", "{}");
        status = -1;
        chunks = 0;
        for (String l : lines) {
            if (l.contains(".head(")) {
                status = Integer.parseInt(l.substring(l.indexOf("head(")).split(",")[1]);
            }
            if (l.contains(".chunk(")) chunks++;
        }
        check(status == 400, "/err 状态码 = 400（实得 " + status + "）");
        check(chunks >= 1, "/err **仍然**吐了正文分块（实得 " + chunks + "）"
                + " —— 非 2xx 时把正文丢掉，页面上就只剩「HTTP 400」这一句");

        // ---------- 4. /echo：请求侧没被转发过程改坏 ----------
        String reqBody = "{\"contents\":[{\"parts\":[{\"text\":\"往返检查 ✓\"}]}]}";
        run("echo", base + "/echo", "POST",
                "content-type: application/json\nx-goog-api-key: TEST-KEY-123\n"
                        + "x-ys-custom: hello\n",
                reqBody);

        // ---------- 5. GET /models ----------
        lines = run("models", base + "/models", "GET", "", "");
        status = -1;
        for (String l : lines) {
            if (l.contains(".head(")) {
                status = Integer.parseInt(l.substring(l.indexOf("head(")).split(",")[1]);
            }
        }
        check(status == 200, "GET /models 状态码 = 200（实得 " + status + "）");

        // ---------- 6. 白名单外必须被拒（「不该发生」的对照组）----------
        lines = run("blocked", "https://example.com/steal", "POST", "", "{}");
        boolean refused = false;
        for (String l : lines) {
            if (l.contains(".fail(")) refused = true;
        }
        check(refused, "白名单外的域名被拒绝（这条是「不该发生」的对照组 —— "
                + "少了它，「白名单生效」这件事没有任何证据）");

        // ---------- 7. 取消 ----------
        List<String> cl = new ArrayList<>();
        final AiProxy.Handle h = new AiProxy.Handle();
        Thread t = new Thread(() -> AiProxy.execute(base + "/sse", "POST",
                "content-type: application/json\n", "{}", new Recorder(cl), h));
        t.start();
        Thread.sleep(60);            // /sse 一共要 ~200ms，这时肯定还没读完
        h.cancel();
        t.join(8000);
        check(!t.isAlive(), "取消后原生线程退出了（没挂到 180 秒读超时）");
        boolean cancelled = false;
        for (String l : cl) {
            if (l.contains(".fail(")) cancelled = true;
        }
        check(cancelled, "取消走的是 fail 回调（实得 " + cl.size() + " 条事件）");
        OUT.append("=== case:cancel\n");
        for (String l : cl) OUT.append(l).append('\n');

        Files.write(Paths.get(outFile), OUT.toString().getBytes(StandardCharsets.UTF_8));

        System.out.println();
        if (FAILS.isEmpty()) {
            System.out.println("== Java 侧全部符合预期 ==");
            System.out.println("   事件已写到 " + outFile);
        } else {
            System.out.println("== ❌ Java 侧 " + FAILS.size() + " 条不符 ==");
            for (String f : FAILS) System.out.println("   - " + f);
            System.exit(1);
        }
    }

    /** 跑一个用例，返回录到的 JS 行。 */
    private static List<String> run(String name, String url, String method,
                                    String headers, String body) {
        List<String> lines = new ArrayList<>();
        AiProxy.execute(url, method, headers, body, new Recorder(lines), null);
        OUT.append("=== case:").append(name).append('\n');
        for (String l : lines) OUT.append(l).append('\n');
        return lines;
    }

    /**
     * 把 Sink 回调转成 JsEvent 那一行 —— 和 MainActivity 里做的事完全一样。
     *
     * ⚠⚠ id 用**哨兵值**而不是真 id。
     *   因为真实 id 是**垫片自己生成的**（`ysai1`、`ysai2`…），Harness 在录制时根本不知道它。
     *   这里要是硬写一个 `t1`，回放时 `pending['t1']` 是 undefined ⇒ 事件被**全部丢弃** ⇒
     *   fetch 的 Promise 永远不 settle ⇒ Node 事件循环空了、**以退出码 0 退出** ⇒
     *   测试「通过」了，而它什么都没测。我第一次跑就踩了这个。
     *   所以：这里写哨兵，JS 侧把它替换成真实 id。
     *   哨兵里有下划线，而 base64 的字符集是 A-Za-z0-9+/= ⇒ 不可能撞车。
     */
    private static final String ID_SENTINEL = "__YS_ID__";

    private static class Recorder implements AiProxy.Sink {
        private final List<String> out;
        private final String id;

        Recorder(List<String> out) { this(out, ID_SENTINEL); }

        Recorder(List<String> out, String id) { this.out = out; this.id = id; }

        @Override public void onHead(int status, String b64Headers) {
            out.add(JsEvent.head(id, status, b64Headers));
        }
        @Override public void onChunk(String b64) {
            out.add(JsEvent.chunk(id, b64));
        }
        @Override public void onDone() {
            out.add(JsEvent.done(id));
        }
        @Override public void onFail(String msg) {
            out.add(JsEvent.fail(id, msg));
        }
    }

    private static void check(boolean ok, String msg) {
        System.out.println("   " + (ok ? "✅" : "❌") + " " + msg);
        if (!ok) FAILS.add(msg);
    }
}
