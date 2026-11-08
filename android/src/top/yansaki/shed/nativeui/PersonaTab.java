package top.yansaki.shed.nativeui;

import android.app.AlertDialog;
import android.content.Context;
import android.content.DialogInterface;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

import top.yansaki.shed.MainActivity;
import top.yansaki.shed.R;

/**
 * 人设生成器（卡片编写器里的「人设生成器」页）。
 *
 * <p>流程照 {@code js/302} 的 {@code stPersonaRun}：需求 + 模板正文 → 一次**非流式**请求 →
 * 结果是一整段文本 → 用户点「写入」才进卡（写进 {@code description}）。
 *
 * <p>⚠⚠ **模板正文和系统提示词都不在 Java 里**：它们由 {@code shim/store-shim.js}
 * 从页面推过来（{@code __ys_persona_tpls} / {@code __ys_persona_sys}）。
 * 那两段加起来快 300 行中文提示词，抄一份就是第二份真相源 —— 网页改一个字，
 * 原生这边就悄悄用旧的了，而且没有任何一层会报。
 *
 * <p>⚠ 模板库的存储语义（照 {@code js/301}）：
 * <ul>
 *   <li>内置 4 份是**常量**，改动存在 {@code stPersonaTplDefOv}（{@code {id: body}}）</li>
 *   <li>自定义库在 {@code stPersonaTpls}（{@code [{id,name,body}]}）</li>
 *   <li>当前选中在 {@code stPersonaTplId}</li>
 *   <li>⚠⚠ **内置那份清空 = 删掉覆盖键 ⇒ 回落出厂正文**（不是「用空模板」）；
 *       自定义那份清空就是空，生成时要报错</li>
 * </ul>
 */
public class PersonaTab {

    private static final String K_TPL_DEF_OV = "stPersonaTplDefOv";
    private static final String K_TPLS = "stPersonaTpls";
    private static final String K_TPL_ID = "stPersonaTplId";
    private static final String K_BUILTIN = "__ys_persona_tpls";
    private static final String K_SYS = "__ys_persona_sys";

    private final Context ctx;
    private final JSONObject card;
    private final Store store;
    private final Runnable onChanged;
    private final FrameLayout host;

    /** 需求 / 结果 / 上次写进世界书的条目 id —— 全是**会话级**，跟网页一致（不落盘）。 */
    private String req = "";
    private String out = "";
    private String lastBookId = "";

    private boolean busy;
    private ChatApi.Job job;

    public PersonaTab(Context c, JSONObject card, Store store, Runnable onChanged) {
        this.ctx = c;
        this.card = card;
        this.store = store;
        this.onChanged = onChanged;
        this.host = new FrameLayout(c);
    }

    public View build() {
        render();
        return host;
    }

    private void render() {
        host.removeAllViews();
        host.addView(buildPage(), new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        M3.popIn(host);
    }

    // ────────────────────────── 模板库 ──────────────────────────

    /** [id, 名字, 出厂正文] —— 由页面推过来。拿不到就是空（会明确报错，不静默）。 */
    private List<String[]> builtins() {
        List<String[]> out = new ArrayList<String[]>();
        String raw = store.get(K_BUILTIN, null);
        if (raw == null) return out;
        try {
            JSONArray a = new JSONArray(raw);
            for (int i = 0; i < a.length(); i++) {
                JSONArray e = a.optJSONArray(i);
                if (e == null || e.length() < 3) continue;
                out.add(new String[]{e.optString(0), e.optString(1), e.optString(2)});
            }
        } catch (Exception ignore) {
        }
        return out;
    }

    /** 自定义模板库。⚠ 它是一个**数组**（`[{id,name,body}]`），不是对象。 */
    private JSONArray customs() {
        String raw = store.get(K_TPLS, null);
        if (raw == null || raw.trim().length() == 0) return new JSONArray();
        try {
            return new JSONArray(raw);
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    private String currentId() {
        String id = store.get(K_TPL_ID, "");
        if (id == null || id.length() == 0) {
            List<String[]> b = builtins();
            return b.isEmpty() ? "" : b.get(0)[0];
        }
        return id;
    }

    private boolean isBuiltin(String id) {
        for (String[] b : builtins()) {
            if (b[0].equals(id)) return true;
        }
        return false;
    }

    private String nameOf(String id) {
        for (String[] b : builtins()) {
            if (b[0].equals(id)) return b[1];
        }
        JSONArray a = customs();
        for (int i = 0; i < a.length(); i++) {
            JSONObject t = a.optJSONObject(i);
            if (t != null && id.equals(t.optString("id"))) {
                String n = t.optString("name", "");
                return n.length() == 0 ? "（未命名模板）" : n;
            }
        }
        return id;
    }

    /** 当前正文。内置 = 覆盖值（非空）否则出厂；自定义 = 存的那份。 */
    private String bodyOf(String id) {
        for (String[] b : builtins()) {
            if (!b[0].equals(id)) continue;
            JSONObject ov = AiCfg.parse(store.get(K_TPL_DEF_OV, null));
            String o = ov == null ? "" : ov.optString(id, "");
            return o.trim().length() > 0 ? o : b[2];
        }
        JSONArray a = customs();
        for (int i = 0; i < a.length(); i++) {
            JSONObject t = a.optJSONObject(i);
            if (t != null && id.equals(t.optString("id"))) return t.optString("body", "");
        }
        return "";
    }

    /** 是否被改过（内置看**存储里有没有覆盖**，不拿内容跟常量比）。 */
    private boolean isOverridden(String id) {
        if (!isBuiltin(id)) return false;
        JSONObject ov = AiCfg.parse(store.get(K_TPL_DEF_OV, null));
        if (ov == null) return false;
        return ov.optString(id, "").trim().length() > 0;
    }

    /**
     * 存正文。
     *
     * <p>⚠⚠ 内置那份**清空 = 删掉覆盖键**（回落出厂正文）。写成空串的话，
     * 面板上会同时出现三种互相矛盾的说法：标签说「没改过」、框里是空的、点生成报「模板是空的」。
     */
    private void setBody(String id, String text) {
        if (isBuiltin(id)) {
            JSONObject ov = AiCfg.parse(store.get(K_TPL_DEF_OV, null));
            if (ov == null) ov = new JSONObject();
            try {
                if (text.trim().length() == 0) ov.remove(id);
                else ov.put(id, text);
            } catch (Exception ignore) {
            }
            String json = ov.toString();
            store.put(K_TPL_DEF_OV, json);
            MainActivity.pushToWeb(K_TPL_DEF_OV, json);
            return;
        }
        JSONArray a = customs();
        for (int i = 0; i < a.length(); i++) {
            JSONObject t = a.optJSONObject(i);
            if (t == null || !id.equals(t.optString("id"))) continue;
            try {
                t.put("body", text);
            } catch (Exception ignore) {
            }
        }
        String json = a.toString();
        store.put(K_TPLS, json);
        MainActivity.pushToWeb(K_TPLS, json);
    }

    private void setCurrentId(String id) {
        store.put(K_TPL_ID, id);
        MainActivity.pushToWeb(K_TPL_ID, id);
    }

    // ────────────────────────── 界面 ──────────────────────────

    private View buildPage() {
        ScrollView sv = new ScrollView(ctx);
        sv.setClipToPadding(false);
        int p = M3.dp(ctx, 20);
        sv.setPadding(p, M3.dp(ctx, 8), p, M3.dp(ctx, 28));
        LinearLayout col = new LinearLayout(ctx);
        col.setOrientation(LinearLayout.VERTICAL);
        sv.addView(col, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        // ── 模板 ──
        col.addView(M3.section(ctx, "模板"));
        LinearLayout c1 = M3.card(ctx);
        c1.addView(templateField());
        c1.addView(CardForm.area(ctx, "模板正文（每行以冒号结尾；内置模板清空 = 恢复出厂）",
                bodyOf(currentId()), 12, new CardForm.OnText() {
                    @Override
                    public void onText(String v) {
                        setBody(currentId(), v);
                        if (onChanged != null) onChanged.run();
                    }
                }), M3.gap(ctx, 12));
        col.addView(c1, M3.gap(ctx, 8));

        // ── 需求 ──
        col.addView(M3.section(ctx, "你想要什么样的人"));
        LinearLayout c2 = M3.card(ctx);
        c2.addView(CardForm.area(ctx, "一句话描述（例如「冷淡的吸血鬼女仆，喜欢红茶」）",
                req, 3, new CardForm.OnText() {
                    @Override
                    public void onText(String v) {
                        req = v;
                    }
                }));
        col.addView(c2, M3.gap(ctx, 8));

        // ── 生成 ──
        TextView go = CardForm.button(ctx, busy ? "生成中…" : "生成人设", 0,
                new View.OnClickListener() {
                    @Override
                    public void onClick(View v) {
                        if (busy) return;
                        generate();
                    }
                });
        if (busy) go.setAlpha(0.6f);
        col.addView(go, M3.gap(ctx, 16));

        if (out.length() == 0) {
            col.addView(CardForm.note(ctx,
                    "⚠ 这一版没搬「参考素材（从世界书挑条目喂给模型）」和「模板库的新建 / 另存 / 改名 / 删除」。"
                            + "模板正文和内置模板都能改，其余在旧界面里。"));
            return sv;
        }

        // ── 结果 ──
        col.addView(M3.section(ctx, "生成结果（可以直接改）"));
        LinearLayout c3 = M3.card(ctx);
        c3.addView(CardForm.area(ctx, "结果", out, 12, new CardForm.OnText() {
            @Override
            public void onText(String v) {
                out = v;
            }
        }));
        col.addView(c3, M3.gap(ctx, 8));

        col.addView(CardForm.button(ctx, "写入角色描述（整个替换）", 1,
                new View.OnClickListener() {
                    @Override
                    public void onClick(View v) {
                        applyReplace();
                    }
                }), M3.gap(ctx, 12));
        col.addView(CardForm.button(ctx, "追加到角色描述", 2, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                applyAppend();
            }
        }), M3.gap(ctx, 8));
        col.addView(CardForm.button(ctx, "追加成一条世界书条目", 2, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                applyBook();
            }
        }), M3.gap(ctx, 8));
        return sv;
    }

    private View templateField() {
        LinearLayout box = new LinearLayout(ctx);
        box.setOrientation(LinearLayout.HORIZONTAL);
        box.setGravity(Gravity.CENTER_VERTICAL);
        box.setBackgroundResource(R.drawable.bg_m3_field);
        box.setPadding(M3.dp(ctx, 14), M3.dp(ctx, 8), M3.dp(ctx, 14), M3.dp(ctx, 8));
        box.setClickable(true);
        box.setFocusable(true);

        LinearLayout col = new LinearLayout(ctx);
        col.setOrientation(LinearLayout.VERTICAL);
        TextView l = M3.text(ctx, "用哪份模板", R.style.TextAppearance_M3_LabelSmall);
        l.setTextColor(M3.color(ctx, R.color.md_on_surface_variant));
        col.addView(l);

        String id = currentId();
        String nm = nameOf(id);
        if (isOverridden(id)) nm = nm + " · 已改";
        col.addView(M3.text(ctx, nm, R.style.TextAppearance_M3_BodyLarge));
        box.addView(col, new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        TextView arrow = M3.text(ctx, "▾", R.style.TextAppearance_M3_TitleMedium);
        arrow.setTextColor(M3.color(ctx, R.color.md_on_surface_variant));
        box.addView(arrow);

        final View anchor = box;
        box.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showTemplateMenu(anchor);
            }
        });
        return box;
    }

    private void showTemplateMenu(View anchor) {
        final List<String[]> all = new ArrayList<String[]>();
        for (String[] b : builtins()) all.add(new String[]{b[0], b[1]});
        JSONArray a = customs();
        for (int i = 0; i < a.length(); i++) {
            JSONObject t = a.optJSONObject(i);
            if (t == null) continue;
            all.add(new String[]{t.optString("id"), t.optString("name", "（未命名）")});
        }
        if (all.isEmpty()) {
            toast("没读到模板库 —— 先在网页里打开一次编写器");
            return;
        }

        PopupMenu pm = new PopupMenu(ctx, anchor);
        for (int i = 0; i < all.size(); i++) {
            pm.getMenu().add(0, i, i, all.get(i)[1]);
        }
        pm.setOnMenuItemClickListener(new PopupMenu.OnMenuItemClickListener() {
            @Override
            public boolean onMenuItemClick(android.view.MenuItem item) {
                int idx = item.getItemId();
                if (idx < 0 || idx >= all.size()) return false;
                setCurrentId(all.get(idx)[0]);
                render();
                return true;
            }
        });
        pm.show();
    }

    // ────────────────────────── 生成 ──────────────────────────

    private void generate() {
        String q = req.trim();
        if (q.length() == 0) {
            toast("先写一句你想要什么");
            return;
        }
        String tpl = bodyOf(currentId()).trim();
        if (tpl.length() == 0) {
            toast("模板是空的 —— 写点内容，或者切回一份内置模板");
            return;
        }
        String sys = store.get(K_SYS, "");
        if (sys == null || sys.trim().length() == 0) {
            toast("没拿到系统提示词 —— 先在网页里打开一次编写器，让它推过来");
            return;
        }
        ChatApi.Cfg cfg = AiCfg.resolve(store);
        if (cfg.apiKey.length() == 0) {
            toast("还没配 API 密钥 —— 去「设置 → 接口配置」填一个");
            return;
        }
        if (cfg.model.length() == 0) {
            toast("还没填模型名 —— 去「设置 → 接口配置」填");
            return;
        }
        // 人设比预制块长得多，下限给到 2048（照 js/302）
        cfg.maxTokens = Math.max(2048, cfg.maxTokens);
        cfg.stream = false;

        // 用户提示词：要求 + 现状 + 模板。⚠ 参考素材那一段这一版没有。
        StringBuilder up = new StringBuilder();
        up.append("用户的要求：").append(q).append("\n\n");
        String nm = card.optString("name", "").trim();
        if (nm.length() > 0) {
            up.append("## 这张卡的现状（跟它保持一致，别冲突）\n");
            up.append("这张卡现在的名字：").append(nm).append("\n\n");
        }
        up.append("## 模板（照它的结构逐项填）\n").append(tpl);

        List<ChatApi.Msg> msgs = new ArrayList<ChatApi.Msg>();
        msgs.add(new ChatApi.Msg("user", up.toString()));

        busy = true;
        render();
        job = ChatApi.send(cfg, sys, msgs, new ChatApi.Sink() {
            @Override
            public void onDelta(String t) {
                // 非流式：不会走到这里
            }

            @Override
            public void onDone(String full) {
                busy = false;
                job = null;
                String text = stripFences(full).trim();
                if (text.length() == 0) {
                    toast("模型返回了空内容，换个说法再试一次");
                    render();
                    return;
                }
                out = text;
                // 新结果跟旧条目没关系 ⇒ 记账清掉，下次「追加到世界书」重新问
                lastBookId = "";
                render();
            }

            @Override
            public void onError(String msg) {
                busy = false;
                job = null;
                toast("生成失败：" + msg);
                render();
            }
        });
    }

    /** 只做一种清洗：去掉整份被包进 ``` 围栏的情况（照 js/302 的 stPersonaText）。 */
    private String stripFences(String s) {
        String t = s == null ? "" : s.trim();
        if (!t.startsWith("```")) return t;
        int nl = t.indexOf('\n');
        if (nl < 0) return t;
        String body = t.substring(nl + 1);
        int end = body.lastIndexOf("```");
        if (end >= 0) body = body.substring(0, end);
        return body.trim();
    }

    // ────────────────────────── 写入 ──────────────────────────

    private void applyReplace() {
        String text = out.trim();
        if (text.length() == 0) return;
        String cur = card.optString("description", "");
        if (cur.trim().length() > 0) {
            new AlertDialog.Builder(ctx)
                    .setMessage("角色描述里已经有 " + cur.length() + " 个字符，写入会整个替换掉它。要继续吗？")
                    .setPositiveButton("替换", new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface d, int w) {
                            putDescription(out.trim());
                        }
                    })
                    .setNegativeButton("取消", null)
                    .show();
            return;
        }
        putDescription(text);
    }

    private void applyAppend() {
        String text = out.trim();
        if (text.length() == 0) return;
        String cur = card.optString("description", "");
        if (cur.trim().length() == 0) {
            putDescription(text);
            return;
        }
        putDescription(cur.replaceAll("\\s+$", "") + "\n\n" + text);
    }

    private void putDescription(String v) {
        try {
            card.put("description", v);
        } catch (Exception ignore) {
        }
        if (onChanged != null) onChanged.run();
        toast("已写入角色描述（" + v.length() + " 字符）");
    }

    private void applyBook() {
        final String text = out.trim();
        if (text.length() == 0) return;
        if (lastBookId.length() > 0 && findEntry(lastBookId) != null) {
            new AlertDialog.Builder(ctx)
                    .setMessage("上一次写进去的那条还在。要覆盖它，还是新建一条？")
                    .setPositiveButton("覆盖上次那条", new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface d, int w) {
                            writeBook(text, true);
                        }
                    })
                    .setNegativeButton("新建一条", new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface d, int w) {
                            writeBook(text, false);
                        }
                    })
                    .show();
            return;
        }
        writeBook(text, false);
    }

    private JSONObject findEntry(String id) {
        JSONArray a = card.optJSONArray("bookEntries");
        if (a == null) return null;
        for (int i = 0; i < a.length(); i++) {
            JSONObject e = a.optJSONObject(i);
            if (e != null && id.equals(e.optString("id"))) return e;
        }
        return null;
    }

    private void writeBook(String text, boolean overwrite) {
        JSONArray a = card.optJSONArray("bookEntries");
        if (a == null) {
            a = new JSONArray();
            try {
                card.put("bookEntries", a);
            } catch (Exception ignore) {
            }
        }
        JSONObject target = overwrite ? findEntry(lastBookId) : null;
        if (target == null) {
            target = BookTab.blankEntry();
            a.put(target);
            // 关键词给一个能触发的：取第一行 / 前 12 个字
            try {
                String head = text.split("\n")[0];
                if (head.length() > 24) head = head.substring(0, 24);
                JSONArray keys = new JSONArray();
                keys.put(head.trim());
                target.put("keys", keys);
                target.put("comment", "人设（生成）");
            } catch (Exception ignore) {
            }
        }
        try {
            target.put("content", text);
        } catch (Exception ignore) {
        }
        lastBookId = target.optString("id", "");
        if (onChanged != null) onChanged.run();
        toast(overwrite ? "已覆盖上次那条世界书条目" : "已追加成一条世界书条目");
    }

    private void toast(String s) {
        Toast.makeText(ctx, s, Toast.LENGTH_SHORT).show();
    }

    /** 离开这一页：把在跑的请求停掉。 */
    public void onLeave() {
        if (job != null) {
            job.cancel();
            job = null;
            busy = false;
        }
    }
}
