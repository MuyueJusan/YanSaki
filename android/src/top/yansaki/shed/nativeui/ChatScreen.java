package top.yansaki.shed.nativeui;

import android.app.AlertDialog;
import android.content.Context;
import android.content.DialogInterface;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import top.yansaki.shed.MainActivity;
import top.yansaki.shed.R;

/**
 * AI 对话（原生）。
 *
 * <p>⚠⚠ **会话数据跟网页版是同一份**（键 {@code aiChatSessions}，结构照
 * {@code js/333b-ai-聊天-历史会话-导出与切换.js}）：
 * <pre>
 *   { v:1, active:"&lt;id&gt;", personas:{…},
 *     list:[ { id, title, at, pid, msgs:[{role,content}], timed:{…} } ] }
 * </pre>
 * ⇒ 两边可以接着聊。⚠ 所以**写回时不能只写自己认识的那几个字段** ——
 *   {@code personas} / {@code timed} / {@code pid} 这些是网页在用的，抹掉就等于把
 *   酒馆模式的人设快照和历史状态删了，而且不报错。
 *
 * <p>⚠ 提示词只发「第一段 + 系统提示词 + 会话历史」（用户选的档位）。
 * 酒馆模式 / 世界书 / 预设顺序**不在这一版**里，那些留在旧界面。
 */
public class ChatScreen implements Screen {

    private final Context ctx;
    private final Store store;

    private LinearLayout msgs;
    private ScrollView scroll;
    private EditText input;
    private TextView sendBtn;
    private TextView titleChip;

    private ChatApi.Job job;
    private TextView streamBubble;
    private StringBuilder streamBuf;

    public ChatScreen(Context c) {
        this.ctx = c;
        this.store = Store.get(c);
    }

    @Override
    public String title() {
        return "对话";
    }

    @Override
    public String kicker() {
        return ctx.getString(R.string.m3_chat_kicker);
    }

    // ────────────────────────── 布局 ──────────────────────────

    @Override
    public View build() {
        LinearLayout root = new LinearLayout(ctx);
        root.setOrientation(LinearLayout.VERTICAL);

        scroll = new ScrollView(ctx);
        scroll.setClipToPadding(false);
        LinearLayout.LayoutParams slp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
        root.addView(scroll, slp);

        LinearLayout inner = new LinearLayout(ctx);
        inner.setOrientation(LinearLayout.VERTICAL);
        int p = M3.dp(ctx, 20);
        inner.setPadding(p, 0, p, M3.dp(ctx, 12));
        scroll.addView(inner, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        inner.addView(buildToolbar());

        msgs = new LinearLayout(ctx);
        msgs.setOrientation(LinearLayout.VERTICAL);
        inner.addView(msgs, M3.gap(ctx, 10));

        root.addView(buildInputBar());
        return root;
    }

    private View buildToolbar() {
        LinearLayout row = new LinearLayout(ctx);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);

        titleChip = M3.text(ctx, "", R.style.TextAppearance_M3_LabelLarge);
        titleChip.setBackgroundResource(R.drawable.bg_m3_chip);
        titleChip.setPadding(M3.dp(ctx, 14), M3.dp(ctx, 9), M3.dp(ctx, 14), M3.dp(ctx, 9));
        titleChip.setSingleLine(true);
        titleChip.setEllipsize(android.text.TextUtils.TruncateAt.END);
        titleChip.setClickable(true);
        titleChip.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                pickSession();
            }
        });
        row.addView(titleChip, new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        row.addView(iconButton("＋", new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                newSession();
            }
        }));
        row.addView(iconButton("⋯", new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                moreMenu();
            }
        }));
        return row;
    }

    private View iconButton(String label, View.OnClickListener l) {
        TextView b = M3.text(ctx, label, R.style.TextAppearance_M3_TitleMedium);
        b.setGravity(Gravity.CENTER);
        b.setBackgroundResource(R.drawable.bg_m3_btn_text);
        b.setClickable(true);
        b.setFocusable(true);
        b.setOnClickListener(l);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                M3.dp(ctx, 44), M3.dp(ctx, 44));
        lp.leftMargin = M3.dp(ctx, 4);
        b.setLayoutParams(lp);
        return b;
    }

    private View buildInputBar() {
        LinearLayout bar = new LinearLayout(ctx);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.BOTTOM);
        bar.setBackgroundColor(M3.color(ctx, R.color.md_surface_container));
        int p = M3.dp(ctx, 14);
        bar.setPadding(p, M3.dp(ctx, 10), p, M3.dp(ctx, 10));

        LinearLayout wrap = new LinearLayout(ctx);
        wrap.setBackgroundResource(R.drawable.bg_m3_field);
        wrap.setPadding(M3.dp(ctx, 14), M3.dp(ctx, 4), M3.dp(ctx, 14), M3.dp(ctx, 4));
        LinearLayout.LayoutParams wlp = new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        bar.addView(wrap, wlp);

        input = new EditText(ctx);
        input.setTextAppearance(R.style.TextAppearance_M3_BodyLarge);
        input.setBackground(null);
        input.setHint(ctx.getString(R.string.m3_chat_placeholder));
        input.setHintTextColor(M3.color(ctx, R.color.md_on_surface_variant));
        input.setInputType(InputType.TYPE_CLASS_TEXT
                | InputType.TYPE_TEXT_FLAG_MULTI_LINE
                | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        input.setMaxLines(5);
        input.setMinHeight(M3.dp(ctx, 44));
        input.setPadding(0, M3.dp(ctx, 8), 0, M3.dp(ctx, 8));
        wrap.addView(input, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        sendBtn = M3.text(ctx, ctx.getString(R.string.m3_chat_send),
                R.style.TextAppearance_M3_LabelLarge);
        sendBtn.setTextColor(M3.color(ctx, R.color.md_on_primary));
        sendBtn.setBackgroundResource(R.drawable.bg_m3_btn_filled);
        sendBtn.setGravity(Gravity.CENTER);
        sendBtn.setClickable(true);
        sendBtn.setFocusable(true);
        LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, M3.dp(ctx, 48));
        blp.leftMargin = M3.dp(ctx, 10);
        sendBtn.setPadding(M3.dp(ctx, 20), 0, M3.dp(ctx, 20), 0);
        bar.addView(sendBtn, blp);
        sendBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (job != null) {
                    stopStreaming();
                } else {
                    send();
                }
            }
        });

        return bar;
    }

    // ────────────────────────── 渲染 ──────────────────────────

    @Override
    public void refresh() {
        render();
    }

    private void render() {
        if (msgs == null) return;
        msgs.removeAllViews();

        JSONObject s = current();
        titleChip.setText(s == null ? ctx.getString(R.string.m3_chat_new) : titleOf(s));

        JSONArray arr = s == null ? null : s.optJSONArray("msgs");
        if (arr == null || arr.length() == 0) {
            TextView hint = M3.hint(ctx, ctx.getString(R.string.m3_chat_hint));
            hint.setPadding(M3.dp(ctx, 4), M3.dp(ctx, 24), M3.dp(ctx, 4), 0);
            msgs.addView(hint);
            return;
        }
        for (int i = 0; i < arr.length(); i++) {
            JSONObject m = arr.optJSONObject(i);
            if (m == null) continue;
            String text = m.optString("content", "");
            if (text.length() == 0) continue;
            addBubble("user".equals(m.optString("role")), text);
        }
        scrollDown();
    }

    private void addBubble(boolean isUser, String text) {
        LinearLayout row = new LinearLayout(ctx);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(isUser ? Gravity.END : Gravity.START);

        TextView b = M3.text(ctx, text, R.style.TextAppearance_M3_BodyLarge);
        b.setTextColor(M3.color(ctx, isUser
                ? R.color.md_on_primary_container : R.color.md_on_surface));
        b.setBackgroundResource(isUser
                ? R.drawable.bg_m3_bubble_user : R.drawable.bg_m3_bubble_ai);
        int p = M3.dp(ctx, 14);
        b.setPadding(p, M3.dp(ctx, 10), p, M3.dp(ctx, 10));
        b.setTextIsSelectable(true);

        int max = Math.round(ctx.getResources().getDisplayMetrics().widthPixels * 0.78f);
        // ⚠ 用 maxWidth，不写死宽度：短消息的气泡要贴着字，写死宽度会变成一条长条。
        b.setMaxWidth(max);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);

        row.addView(b, lp);
        msgs.addView(row, M3.gap(ctx, 8));
    }

    private void scrollDown() {
        if (scroll == null) return;
        scroll.post(new Runnable() {
            @Override
            public void run() {
                scroll.fullScroll(View.FOCUS_DOWN);
            }
        });
    }

    // ────────────────────────── 会话数据 ──────────────────────────

    /** 读整份会话存储。⚠ 解析失败返回一个**空的新结构**，不要把旧数据清掉（由调用方决定）。 */
    private JSONObject sessStore() {
        String raw = store.get("aiChatSessions", null);
        if (raw != null && raw.length() > 0) {
            try {
                JSONObject o = new JSONObject(raw);
                if (o.optJSONArray("list") != null) return o;
            } catch (Exception ignore) {
            }
        }
        JSONObject o = new JSONObject();
        try {
            o.put("v", 1).put("active", "").put("personas", new JSONObject())
                    .put("list", new JSONArray());
        } catch (Exception ignore) {
        }
        return o;
    }

    private JSONArray listOf(JSONObject st) {
        JSONArray a = st.optJSONArray("list");
        return a == null ? new JSONArray() : a;
    }

    /** 当前会话（只读渲染用）。⚠ 要**改**它必须用 {@link #activeIn} 拿同一份 st 里的对象。 */
    private JSONObject current() {
        return activeIn(sessStore());
    }

    /**
     * 在给定的 {@code st} 里找当前会话。
     *
     * <p>⚠⚠ 这个方法是必须的，别绕过它用 {@code current()} 去改：{@link #sessStore()} 每次
     * 都 `new JSONObject(raw)` 解析出一个**新对象**，所以「改 current() 拿到的那个、再
     * persist(sessStore()) 写回」= 改的是 A、写回的是 B ⇒ **改动静默丢失**，
     * 而且不报错（界面上刚发的消息还在，切个页就没了）。
     */
    private JSONObject activeIn(JSONObject st) {
        JSONArray list = listOf(st);
        String active = st.optString("active", "");
        for (int i = 0; i < list.length(); i++) {
            JSONObject s = list.optJSONObject(i);
            if (s != null && active.equals(s.optString("id"))) return s;
        }
        return list.length() > 0 ? list.optJSONObject(0) : null;
    }

    private String titleOf(JSONObject s) {
        String t = s.optString("title", "");
        return t.length() > 0 ? t : "未命名";
    }

    /** 写回。⚠ 只改 msgs / active / at，其它字段原样带着走。 */
    private void persist(JSONObject st) {
        String json = st.toString();
        store.put("aiChatSessions", json);
        MainActivity.pushToWeb("aiChatSessions", json);
    }

    /** 在**给定的** st 里找当前会话，没有就新建一个（同一份 st）。 */
    private JSONObject ensureIn(JSONObject st) {
        JSONObject s = activeIn(st);
        if (s != null) return s;
        return createIn(st);
    }

    private JSONObject createIn(JSONObject st) {
        JSONArray list = listOf(st);
        JSONObject s = new JSONObject();
        try {
            String id = "n" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
            s.put("id", id);
            s.put("title", "");
            s.put("at", System.currentTimeMillis());
            s.put("pid", "");
            s.put("msgs", new JSONArray());
            s.put("timed", new JSONObject().put("sticky", new JSONObject())
                    .put("cooldown", new JSONObject()).put("msgCount", 0));
            list.put(s);
            st.put("list", list);
            st.put("active", id);
        } catch (Exception ignore) {
        }
        return s;
    }

    private JSONObject newSession() {
        JSONObject st = sessStore();
        JSONObject s = createIn(st);
        persist(st);
        render();
        return s;
    }

    // ────────────────────────── 发送 ──────────────────────────

    private ChatApi.Cfg cfg() {
        return AiCfg.resolve(store);
    }

    /** 系统提示词 = 第一段 + 系统提示词，再把 {{user}} 换掉。 */
    private String systemPrompt() {
        JSONObject ai = parse(store.get("aiChatConfig"));
        if (ai == null) return "";
        StringBuilder sb = new StringBuilder();
        String first = ai.optString("firstSeg", "");
        if (first.length() > 0) sb.append(first);
        if (ai.optBoolean("promptEnabled", true)) {
            String sys = ai.optString("systemPrompt", "");
            if (sys.length() > 0) {
                if (sb.length() > 0) sb.append("\n\n");
                sb.append(sys);
            }
        }
        String user = ai.optString("userName", "");
        String out = sb.toString();
        if (user.length() > 0) out = out.replace("{{user}}", user);
        return out;
    }

    private void send() {
        String text = input.getText().toString().trim();
        if (text.length() == 0) return;

        ChatApi.Cfg c = cfg();
        if (c.apiKey.length() == 0) {
            toast(ctx.getString(R.string.m3_chat_need_key));
            return;
        }
        if (c.model.length() == 0) {
            toast(ctx.getString(R.string.m3_chat_no_model));
            return;
        }

        JSONObject st = sessStore();
        JSONObject s = ensureIn(st);

        try {
            JSONArray arr = s.optJSONArray("msgs");
            if (arr == null) {
                arr = new JSONArray();
                s.put("msgs", arr);
            }
            arr.put(new JSONObject().put("role", "user").put("content", text));
            if (s.optString("title", "").length() == 0) {
                s.put("title", text.length() > 18 ? text.substring(0, 18) + "…" : text);
            }
            s.put("at", System.currentTimeMillis());
        } catch (Exception ignore) {
        }

        input.setText("");
        persist(st);
        render();

        // 历史 = 这条会话里所有非空消息（含刚加的用户那条）
        List<ChatApi.Msg> history = ChatApi.toMsgs(s.optJSONArray("msgs"));
        String sys = systemPrompt();

        // 占位的 AI 气泡
        streamBuf = new StringBuilder();
        addBubble(false, ctx.getString(R.string.m3_chat_thinking));
        streamBubble = lastBubbleText();
        setBusy(true);
        scrollDown();

        job = ChatApi.send(c, sys, history, new ChatApi.Sink() {
            @Override
            public void onDelta(String t) {
                if (streamBubble == null) return;
                streamBuf.append(t);
                streamBubble.setText(streamBuf.toString());
                scrollDown();
            }

            @Override
            public void onDone(String full) {
                finishStream(full, false);
            }

            @Override
            public void onError(String msg) {
                finishStream("⚠ " + msg, true);
            }
        });
    }

    private TextView lastBubbleText() {
        if (msgs.getChildCount() == 0) return null;
        View row = msgs.getChildAt(msgs.getChildCount() - 1);
        if (!(row instanceof ViewGroup)) return null;
        ViewGroup g = (ViewGroup) row;
        if (g.getChildCount() == 0) return null;
        View v = g.getChildAt(0);
        return v instanceof TextView ? (TextView) v : null;
    }

    private void finishStream(String text, boolean isError) {
        job = null;
        setBusy(false);

        // ⚠⚠ 「一个字节都没收到」必须当成失败说出来。
        //   协议猜错（比如把 gemini 当 openai 解析）时，SSE 帧**照样是合法 JSON**，
        //   只是提取路径不匹配 ⇒ 循环跑完、full 是空串、没有任何异常。
        //   静默显示一个空气泡，看起来像「卡住了」，而真正的原因是解析没命中。
        if (!isError && text.length() == 0) {
            isError = true;
            text = "⚠ 没有收到任何内容 —— 可能是模型名不对，或者这个服务商的流式格式跟当前协议不匹配"
                    + "（接口页的「服务商」选对了没）。";
        }

        if (streamBubble != null) {
            streamBubble.setText(text);
            if (isError) streamBubble.setTextColor(M3.color(ctx, R.color.md_error));
            streamBubble = null;
        }

        JSONObject st = sessStore();
        JSONObject s = activeIn(st);
        // ⚠ 报错**不进会话**：那串「⚠ …」是我们自己写的提示，存进去之后
        //   它就成了上下文的一部分，下次发给模型会变成一句莫名其妙的用户内容。
        if (!isError && s != null && text.length() > 0) {
            try {
                JSONArray arr = s.optJSONArray("msgs");
                if (arr == null) {
                    arr = new JSONArray();
                    s.put("msgs", arr);
                }
                arr.put(new JSONObject().put("role", "assistant").put("content", text));
                s.put("at", System.currentTimeMillis());
            } catch (Exception ignore) {
            }
            persist(st);
        }
        streamBuf = null;
        scrollDown();
    }

    private void stopStreaming() {
        if (job != null) job.cancel();
        job = null;
        setBusy(false);
        if (streamBubble != null) {
            String partial = streamBuf == null ? "" : streamBuf.toString();
            streamBubble.setText(partial.length() == 0
                    ? ctx.getString(R.string.m3_chat_stopped)
                    : partial + "\n" + ctx.getString(R.string.m3_chat_stopped));
            // ⚠ 停下来也要把已经吐出来的字存进会话 —— 不存的话「看着有、切页就没了」
            JSONObject st = sessStore();
            JSONObject s = activeIn(st);
            if (s != null) {
                try {
                    JSONArray arr = s.optJSONArray("msgs");
                    if (arr == null) {
                        arr = new JSONArray();
                        s.put("msgs", arr);
                    }
                    if (partial.length() > 0) {
                        arr.put(new JSONObject().put("role", "assistant").put("content", partial));
                        s.put("at", System.currentTimeMillis());
                    }
                } catch (Exception ignore) {
                }
                persist(st);
            }
            streamBubble = null;
        }
    }

    private void setBusy(boolean busy) {
        if (sendBtn == null) return;
        sendBtn.setText(ctx.getString(busy ? R.string.m3_chat_stop : R.string.m3_chat_send));
        sendBtn.setBackgroundResource(busy
                ? R.drawable.bg_m3_btn_tonal : R.drawable.bg_m3_btn_filled);
        sendBtn.setTextColor(M3.color(ctx, busy
                ? R.color.md_on_secondary_container : R.color.md_on_primary));
    }

    // ────────────────────────── 会话操作 ──────────────────────────

    private void pickSession() {
        JSONObject st = sessStore();
        final JSONArray list = listOf(st);
        if (list.length() == 0) {
            newSession();
            return;
        }
        final String[] titles = new String[list.length() + 1];
        for (int i = 0; i < list.length(); i++) {
            JSONObject s = list.optJSONObject(i);
            String t = s == null ? "" : titleOf(s);
            int n = s == null ? 0 : (s.optJSONArray("msgs") == null ? 0 : s.optJSONArray("msgs").length());
            titles[i] = t + "  (" + n + ")";
        }
        titles[list.length()] = "＋ " + ctx.getString(R.string.m3_chat_new);

        new AlertDialog.Builder(ctx)
                .setTitle(R.string.m3_chat_pick)
                .setItems(titles, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int which) {
                        if (which == list.length()) {
                            newSession();
                            return;
                        }
                        JSONObject s = list.optJSONObject(which);
                        if (s == null) return;
                        JSONObject st2 = sessStore();
                        try {
                            st2.put("active", s.optString("id"));
                        } catch (Exception ignore) {
                        }
                        persist(st2);
                        render();
                    }
                })
                .show();
    }

    private void moreMenu() {
        String[] items = {
                ctx.getString(R.string.m3_chat_rename),
                ctx.getString(R.string.m3_chat_clear),
                ctx.getString(R.string.m3_chat_delete)
        };
        new AlertDialog.Builder(ctx)
                .setItems(items, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int which) {
                        if (which == 0) rename();
                        else if (which == 1) clearCurrent();
                        else deleteCurrent();
                    }
                })
                .show();
    }

    private void rename() {
        JSONObject s = current();
        if (s == null) return;
        final EditText et = new EditText(ctx);
        et.setText(s.optString("title", ""));
        et.setSingleLine(true);
        et.setPadding(M3.dp(ctx, 20), M3.dp(ctx, 12), M3.dp(ctx, 20), M3.dp(ctx, 12));

        new AlertDialog.Builder(ctx)
                .setTitle(R.string.m3_chat_rename)
                .setView(et)
                .setPositiveButton("确定", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int w) {
                        JSONObject st = sessStore();
                        JSONObject cur = activeIn(st);
                        if (cur == null) return;
                        try {
                            cur.put("title", et.getText().toString().trim());
                        } catch (Exception ignore) {
                        }
                        persist(st);
                        render();
                    }
                })
                .setNegativeButton("取消", null)
                .show();
    }

    private void clearCurrent() {
        JSONObject st = sessStore();
        JSONObject cur = activeIn(st);
        if (cur == null) return;
        try {
            cur.put("msgs", new JSONArray());
        } catch (Exception ignore) {
        }
        persist(st);
        render();
    }

    private void deleteCurrent() {
        JSONObject st = sessStore();
        JSONObject cur = activeIn(st);
        if (cur == null) return;
        String id = cur.optString("id");
        JSONArray list = listOf(st);
        JSONArray keep = new JSONArray();
        for (int i = 0; i < list.length(); i++) {
            JSONObject s = list.optJSONObject(i);
            if (s != null && !id.equals(s.optString("id"))) keep.put(s);
        }
        try {
            st.put("list", keep);
            st.put("active", keep.length() > 0
                    ? keep.optJSONObject(0).optString("id") : "");
        } catch (Exception ignore) {
        }
        persist(st);
        render();
    }

    // ────────────────────────── 小工具 ──────────────────────────

    private static JSONObject parse(String raw) {
        if (raw == null || raw.length() == 0) return null;
        try {
            return new JSONObject(raw);
        } catch (Exception e) {
            return null;
        }
    }

    private void toast(String s) {
        Toast.makeText(ctx, s, Toast.LENGTH_LONG).show();
    }

    @Override
    public void onLeave() {
        // ⚠ 离开这一屏要把在跑的请求停掉：不停的话它还在往一个已经不在屏幕上的
        //   TextView 里写，而且会一直占着网络和电。
        if (job != null) {
            job.cancel();
            job = null;
        }
    }
}
