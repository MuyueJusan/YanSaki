package top.yansaki.shed.nativeui;

import android.os.Handler;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;

/**
 * 原生 AI 调用：三种协议的 SSE 流式解析。
 *
 * <p>⚠⚠ 为什么这里能直连而网页不能：网页被 **CORS** 挡（Google / Anthropic 不给浏览器 origin
 * 发 `Access-Control-Allow-Origin`），所以 APK 里要注入 fetch 垫片走 {@code AiProxy}。
 * 而 {@code HttpURLConnection} 是原生 HTTP，**没有 CORS 这个概念** ⇒ 这里直接连，
 * 不需要经过 AiProxy，也不需要那个垫片。
 *
 * <p>⚠ 三种协议的差别不只是 URL，**SSE 的帧格式完全不同**：
 * <pre>
 *   openai      data: {"choices":[{"delta":{"content":"…"}}]}   … data: [DONE]
 *   anthropic   event: content_block_delta
 *               data: {"type":"content_block_delta","delta":{"text":"…"}}
 *   gemini      data: {"candidates":[{"content":{"parts":[{"text":"…"}]}}]}
 * </pre>
 * ⇒ 分成三条解析路径，别想着「抽一个通用的 delta 提取器」—— 那样三边都读不懂。
 *
 * <p>⚠ 协议 id 由页面推过来（{@code __ys_providers} 的第 4 项），**Java 里不抄一份服务商表**：
 * 抄了就是第二份真相源，加一家服务商要记着改两处。
 */
public final class ChatApi {

    /** 一条待发的消息。 */
    public static final class Msg {
        public final String role;   // user / assistant
        public final String text;

        public Msg(String role, String text) {
            this.role = role;
            this.text = text;
        }
    }

    /** 这次请求用的配置（已经从 apiGlobalCfg / aiConfig 里挑好了）。 */
    public static final class Cfg {
        public String proto = "openai";
        public String baseUrl = "";
        public String apiKey = "";
        public String model = "";
        public boolean stream = true;
        public double temperature = 0.7;
        public int maxTokens = 1024;
    }

    /** 回调。⚠ 全部在主线程上抛。 */
    public interface Sink {
        void onDelta(String text);

        void onDone(String full);

        void onError(String msg);
    }

    /** 一次请求的句柄，用来「停止」。 */
    public static final class Job {
        private volatile boolean cancelled;
        private HttpURLConnection conn;

        public void cancel() {
            cancelled = true;
            try {
                if (conn != null) conn.disconnect();
            } catch (Exception ignore) {
            }
        }

        public boolean isCancelled() {
            return cancelled;
        }
    }

    private static final Handler UI = new Handler(Looper.getMainLooper());

    private ChatApi() {
    }

    /**
     * 发一次请求。**立刻返回**，结果从 {@link Sink} 回来。
     *
     * @param system 系统提示词（可为空）。⚠ anthropic 要把它放在顶层 `system` 字段，
     *               不能塞进 messages —— 塞进去会被当成一条 user 消息。
     */
    public static Job send(final Cfg cfg, final String system, final List<Msg> history, final Sink sink) {
        final Job job = new Job();
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    String full = "gemini".equals(cfg.proto)
                            ? doGemini(cfg, system, history, job, sink)
                            : "anthropic".equals(cfg.proto)
                            ? doAnthropic(cfg, system, history, job, sink)
                            : doOpenai(cfg, system, history, job, sink);
                    if (job.isCancelled()) {
                        // 用户点了停止：已经吐出去的字留着，但不再回调 onDone
                        return;
                    }
                    final String f = full;
                    UI.post(new Runnable() {
                        @Override
                        public void run() {
                            sink.onDone(f);
                        }
                    });
                } catch (final Throwable e) {
                    if (job.isCancelled()) return;
                    UI.post(new Runnable() {
                        @Override
                        public void run() {
                            sink.onError(explain(e));
                        }
                    });
                }
            }
        }, "ys-chat");
        t.setDaemon(true);
        t.start();
        return job;
    }

    private static String explain(Throwable e) {
        String m = e.getMessage();
        if (m == null || m.length() == 0) m = e.getClass().getSimpleName();
        return m;
    }

    // ────────────────────────── openai ──────────────────────────

    private static String doOpenai(Cfg cfg, String system, List<Msg> history, Job job, Sink sink)
            throws Exception {
        JSONArray msgs = new JSONArray();
        if (system != null && system.length() > 0) {
            msgs.put(new JSONObject().put("role", "system").put("content", system));
        }
        for (Msg m : history) {
            msgs.put(new JSONObject().put("role", m.role).put("content", m.text));
        }
        JSONObject body = new JSONObject()
                .put("model", cfg.model)
                .put("messages", msgs)
                .put("temperature", cfg.temperature)
                .put("max_tokens", cfg.maxTokens)
                .put("stream", cfg.stream);

        HttpURLConnection c = open(join(cfg.baseUrl, "/chat/completions"), cfg);
        c.setRequestProperty("Authorization", "Bearer " + cfg.apiKey);
        return run(c, job, sink, cfg.stream, new Extractor() {
            @Override
            public String fromSse(JSONObject j) {
                JSONArray ch = j.optJSONArray("choices");
                if (ch == null || ch.length() == 0) return null;
                JSONObject d = ch.optJSONObject(0).optJSONObject("delta");
                return d == null ? null : d.optString("content", null);
            }

            @Override
            public String fromFull(JSONObject j) {
                JSONArray ch = j.optJSONArray("choices");
                if (ch == null || ch.length() == 0) return null;
                JSONObject m = ch.optJSONObject(0).optJSONObject("message");
                return m == null ? null : m.optString("content", null);
            }
        }, body);
    }

    // ────────────────────────── anthropic ──────────────────────────

    private static String doAnthropic(Cfg cfg, String system, List<Msg> history, Job job, Sink sink)
            throws Exception {
        JSONArray msgs = new JSONArray();
        for (Msg m : history) {
            // ⚠ anthropic 只认 user / assistant，且必须交替。这里不做合并 ——
            //   会话历史本来就是交替的（产品那边保证），硬合并反而会改语义。
            msgs.put(new JSONObject().put("role", m.role).put("content", m.text));
        }
        JSONObject body = new JSONObject()
                .put("model", cfg.model)
                .put("messages", msgs)
                .put("max_tokens", cfg.maxTokens)
                .put("temperature", cfg.temperature)
                .put("stream", cfg.stream);
        if (system != null && system.length() > 0) body.put("system", system);

        HttpURLConnection c = open(join(cfg.baseUrl, "/messages"), cfg);
        c.setRequestProperty("x-api-key", cfg.apiKey);
        c.setRequestProperty("anthropic-version", "2023-06-01");
        return run(c, job, sink, cfg.stream, new Extractor() {
            @Override
            public String fromSse(JSONObject j) {
                if (!"content_block_delta".equals(j.optString("type"))) return null;
                JSONObject d = j.optJSONObject("delta");
                return d == null ? null : d.optString("text", null);
            }

            @Override
            public String fromFull(JSONObject j) {
                JSONArray arr = j.optJSONArray("content");
                if (arr == null || arr.length() == 0) return null;
                StringBuilder sb = new StringBuilder();
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject p = arr.optJSONObject(i);
                    if (p != null) sb.append(p.optString("text", ""));
                }
                return sb.toString();
            }
        }, body);
    }

    // ────────────────────────── gemini ──────────────────────────

    private static String doGemini(Cfg cfg, String system, List<Msg> history, Job job, Sink sink)
            throws Exception {
        JSONArray contents = new JSONArray();
        for (Msg m : history) {
            // gemini 的 assistant 叫 model
            String role = "assistant".equals(m.role) ? "model" : "user";
            contents.put(new JSONObject()
                    .put("role", role)
                    .put("parts", new JSONArray().put(new JSONObject().put("text", m.text))));
        }
        JSONObject gen = new JSONObject()
                .put("temperature", cfg.temperature)
                .put("maxOutputTokens", cfg.maxTokens);
        JSONObject body = new JSONObject().put("contents", contents).put("generationConfig", gen);
        if (system != null && system.length() > 0) {
            body.put("systemInstruction",
                    new JSONObject().put("parts",
                            new JSONArray().put(new JSONObject().put("text", system))));
        }

        String path = "/models/" + cfg.model
                + (cfg.stream ? ":streamGenerateContent?alt=sse&key=" : ":generateContent?key=")
                + cfg.apiKey;
        HttpURLConnection c = open(join(cfg.baseUrl, path), cfg);
        return run(c, job, sink, cfg.stream, new Extractor() {
            @Override
            public String fromSse(JSONObject j) {
                return textOf(j);
            }

            @Override
            public String fromFull(JSONObject j) {
                return textOf(j);
            }

            private String textOf(JSONObject j) {
                JSONArray cand = j.optJSONArray("candidates");
                if (cand == null || cand.length() == 0) return null;
                JSONObject content = cand.optJSONObject(0).optJSONObject("content");
                if (content == null) return null;
                JSONArray parts = content.optJSONArray("parts");
                if (parts == null) return null;
                StringBuilder sb = new StringBuilder();
                for (int i = 0; i < parts.length(); i++) {
                    JSONObject p = parts.optJSONObject(i);
                    if (p != null) sb.append(p.optString("text", ""));
                }
                return sb.length() == 0 ? null : sb.toString();
            }
        }, body);
    }

    // ────────────────────────── 共用 ──────────────────────────

    private interface Extractor {
        String fromSse(JSONObject j);

        String fromFull(JSONObject j);
    }

    private static HttpURLConnection open(String url, Cfg cfg) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod("POST");
        c.setDoOutput(true);
        c.setConnectTimeout(20000);
        c.setReadTimeout(120000);
        c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        // ⚠ 不要 gzip：透明解压会把整个 SSE 缓冲成一整块，「流式」就没了，而且不报错。
        c.setRequestProperty("Accept-Encoding", "identity");
        c.setRequestProperty("Accept", cfg.stream ? "text/event-stream" : "application/json");
        return c;
    }

    private static String run(HttpURLConnection c, Job job, Sink sink, boolean stream,
                              Extractor ex, JSONObject body) throws Exception {
        job.conn = c;
        byte[] raw = body.toString().getBytes("UTF-8");
        c.setFixedLengthStreamingMode(raw.length);
        OutputStream out = c.getOutputStream();
        try {
            out.write(raw);
            out.flush();
        } finally {
            try {
                out.close();
            } catch (Exception ignore) {
            }
        }

        int code = c.getResponseCode();
        if (code < 200 || code >= 300) {
            // ⚠ 非 2xx 要读 errorStream：不然页面（这里是我们自己）只能显示「HTTP 400」，
            //   而真正的原因（模型名错 / key 失效 / 额度用完）全在被拒的正文里。
            String err = readAll(c.getErrorStream());
            throw new IOException("HTTP " + code + (err.length() > 0 ? "：" + trim(err) : ""));
        }

        if (!stream) {
            String all = readAll(c.getInputStream());
            JSONObject j = new JSONObject(all);
            String t = ex.fromFull(j);
            String text = t == null ? "" : t;
            if (text.length() > 0) {
                UI.post(deltaRunnable(sink, text));
            }
            return text;
        }

        StringBuilder sb = new StringBuilder();
        BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"));
        String line;
        while ((line = r.readLine()) != null) {
            if (job.isCancelled()) break;
            if (line.length() == 0) continue;
            if (!line.startsWith("data:")) continue;       // event: / id: / 注释行一律跳过
            String payload = line.substring(5).trim();
            if (payload.length() == 0 || "[DONE]".equals(payload)) continue;
            String piece;
            try {
                piece = ex.fromSse(new JSONObject(payload));
            } catch (Exception bad) {
                continue;                                   // 半行 / 非 JSON 的心跳，跳过
            }
            if (piece == null || piece.length() == 0) continue;
            sb.append(piece);
            UI.post(deltaRunnable(sink, piece));
        }
        try {
            r.close();
        } catch (Exception ignore) {
        }
        return sb.toString();
    }

    private static Runnable deltaRunnable(final Sink sink, final String piece) {
        return new Runnable() {
            @Override
            public void run() {
                sink.onDelta(piece);
            }
        };
    }

    private static String readAll(InputStream in) throws Exception {
        if (in == null) return "";
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
        try {
            in.close();
        } catch (Exception ignore) {
        }
        return new String(bos.toByteArray(), "UTF-8");
    }

    private static String trim(String s) {
        String t = s.replace('\n', ' ').trim();
        return t.length() > 300 ? t.substring(0, 300) + "…" : t;
    }

    /** 拼 URL：baseUrl 末尾的 `/` 和 path 开头的 `/` 只留一个。 */
    static String join(String base, String path) {
        String b = base == null ? "" : base.trim();
        while (b.endsWith("/")) b = b.substring(0, b.length() - 1);
        String p = path == null ? "" : path;
        if (!p.startsWith("/")) p = "/" + p;
        return b + p;
    }

    /** 给界面用：把历史转成待发列表（跳过空内容）。 */
    public static List<Msg> toMsgs(JSONArray arr) {
        List<Msg> out = new ArrayList<Msg>();
        if (arr == null) return out;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject m = arr.optJSONObject(i);
            if (m == null) continue;
            String role = m.optString("role", "");
            String text = m.optString("content", "");
            if (text.length() == 0) continue;
            if (!"user".equals(role) && !"assistant".equals(role)) continue;
            out.add(new Msg(role, text));
        }
        return out;
    }
}
