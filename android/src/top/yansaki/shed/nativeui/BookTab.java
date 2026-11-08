package top.yansaki.shed.nativeui;

import android.content.Context;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.UUID;

import top.yansaki.shed.R;

/**
 * 世界书（卡片编写器里的「世界书」页）。
 *
 * <p>⚠⚠ 条目字段照 {@code normalizeLoreEntry()}（js/218）来，**一条 45 个**。
 * 这里只做「改得到的那些」，其余**原样留在条目对象里** —— 所以每个字段都必须是
 * 「读出来 → 改 → put 回去」，**不能**新建一个只含本页字段的对象再替换整个条目：
 * 那样 {@code sticky / cooldown / scanDepth / characterFilter / triggers} 这些
 * 在网页里配过的东西会被静默清空，而导出时看不出来。
 *
 * <p>⚠ 位置（position）照 {@code WI_POS}：0 角色定义之前 / 1 之后 / 4 按深度插入。
 * 其余几档（作者注释、示例对话、Outlet）在原生里先不给 —— 给了也没有对应的说明文字，
 * 用户选了不知道为什么没效果。**值仍然原样保留**，只是这一页改不到。
 *
 * <p>⚠ 两级结构（列表 ⇄ 条目编辑）在**本类内部**切换，不动外壳的二级页：
 * 卡片页本身已经是底部导航的一项，再套一层 Activity/二级页会让「返回」变成三层。
 */
public class BookTab {

    private static final int POS_BEFORE = 0;
    private static final int POS_AFTER = 1;
    private static final int POS_DEPTH = 4;

    private final Context ctx;
    private final JSONObject card;
    private final Runnable onChanged;
    private final FrameLayout host;

    /** -1 = 列表；否则是正在编辑的条目下标。 */
    private int editing = -1;

    public BookTab(Context c, JSONObject card, Runnable onChanged) {
        this.ctx = c;
        this.card = card;
        this.onChanged = onChanged;
        this.host = new FrameLayout(c);
    }

    /** 每次都从存储里的 card 重新读，保证不会拿着一份过期的数组。 */
    public View build() {
        render();
        return host;
    }

    private void render() {
        host.removeAllViews();
        View v = editing < 0 ? buildList() : buildEntry(editing);
        host.addView(v, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        M3.popIn(host);
    }

    private JSONArray entries() {
        JSONArray a = card.optJSONArray("bookEntries");
        if (a == null) {
            a = new JSONArray();
            try {
                card.put("bookEntries", a);
            } catch (Exception ignore) {
            }
        }
        return a;
    }

    private void changed() {
        if (onChanged != null) onChanged.run();
    }

    // ────────────────────────── 列表 ──────────────────────────

    private View buildList() {
        ScrollView sv = new ScrollView(ctx);
        sv.setClipToPadding(false);
        int p = M3.dp(ctx, 20);
        sv.setPadding(p, M3.dp(ctx, 8), p, M3.dp(ctx, 28));
        LinearLayout col = new LinearLayout(ctx);
        col.setOrientation(LinearLayout.VERTICAL);
        sv.addView(col, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        col.addView(M3.section(ctx, "世界书"));
        LinearLayout c1 = M3.card(ctx);
        c1.addView(CardForm.field(ctx, "名字（空着导出时用「角色名 的世界书」）",
                card.optString("bookName", ""), new CardForm.OnText() {
                    @Override
                    public void onText(String v) {
                        try {
                            card.put("bookName", v);
                        } catch (Exception ignore) {
                        }
                        changed();
                    }
                }));
        c1.addView(CardForm.area(ctx, "描述", card.optString("bookDescription", ""), 2,
                new CardForm.OnText() {
                    @Override
                    public void onText(String v) {
                        try {
                            card.put("bookDescription", v);
                        } catch (Exception ignore) {
                        }
                        changed();
                    }
                }), M3.gap(ctx, 12));
        col.addView(c1, M3.gap(ctx, 8));

        JSONArray arr = entries();
        col.addView(M3.section(ctx, "条目（" + arr.length() + " 条）"));

        LinearLayout list = M3.card(ctx);
        list.setPadding(M3.dp(ctx, 6), M3.dp(ctx, 6), M3.dp(ctx, 6), M3.dp(ctx, 6));
        if (arr.length() == 0) {
            list.addView(CardForm.note(ctx, "还没有条目。条目就是「说到某个词时，把这段设定塞进上下文」。"));
        }
        for (int i = 0; i < arr.length(); i++) {
            final int idx = i;
            JSONObject e = arr.optJSONObject(i);
            if (e == null) continue;
            list.addView(entryRow(e, idx));
        }
        col.addView(list, M3.gap(ctx, 8));

        col.addView(CardForm.button(ctx, "＋ 新建条目", 1, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                addEntry();
            }
        }), M3.gap(ctx, 12));

        col.addView(CardForm.note(ctx,
                "⚠ 这一版能改：关键词 / 副关键词 / 正文 / 常驻 / 选择性 / 顺序 / 位置 / 深度 / "
                        + "概率 / 分组。其余（递归、时间效果、扫描深度、角色过滤）原样保留，"
                        + "但要在旧界面里改。"));
        return sv;
    }

    private View entryRow(JSONObject e, final int idx) {
        LinearLayout row = new LinearLayout(ctx);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setBackgroundResource(R.drawable.bg_m3_list_item);
        row.setPadding(M3.dp(ctx, 10), M3.dp(ctx, 12), M3.dp(ctx, 10), M3.dp(ctx, 12));
        row.setClickable(true);
        row.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                editing = idx;
                render();
            }
        });

        // 启用勾：点一下直接切，不用进去
        final Switch sw = new Switch(ctx);
        sw.setChecked(e.optBoolean("enabled", true));
        sw.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                JSONObject cur = entryAt(idx);
                if (cur == null) return;
                try {
                    cur.put("enabled", sw.isChecked());
                } catch (Exception ignore) {
                }
                changed();
            }
        });
        row.addView(sw);

        LinearLayout col = new LinearLayout(ctx);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(M3.dp(ctx, 6), 0, 0, 0);

        String title = e.optString("comment", "");
        if (title.length() == 0) {
            JSONArray keys = e.optJSONArray("keys");
            title = keys != null && keys.length() > 0 ? keys.optString(0, "") : "（未命名条目）";
        }
        TextView t = M3.text(ctx, title, R.style.TextAppearance_M3_BodyLarge);
        if (!e.optBoolean("enabled", true)) t.setAlpha(0.45f);
        col.addView(t);

        StringBuilder sub = new StringBuilder();
        if (e.optBoolean("constant")) sub.append("常驻");
        int pos = e.optInt("position", POS_BEFORE);
        if (sub.length() > 0) sub.append(" · ");
        sub.append(pos == POS_DEPTH ? "按深度" : pos == POS_AFTER ? "角色之后" : "角色之前");
        int nk = e.optJSONArray("keys") == null ? 0 : e.optJSONArray("keys").length();
        sub.append(" · ").append(nk).append(" 个关键词");
        TextView st = M3.text(ctx, sub.toString(), R.style.TextAppearance_M3_BodySmall);
        col.addView(st);

        row.addView(col, new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        TextView chev = M3.text(ctx, "›", R.style.TextAppearance_M3_TitleLarge);
        chev.setTextColor(M3.color(ctx, R.color.md_on_surface_variant));
        row.addView(chev);
        return row;
    }

    private JSONObject entryAt(int idx) {
        JSONArray a = entries();
        return a.optJSONObject(idx);
    }

    private void addEntry() {
        JSONArray a = entries();
        JSONObject e = blankEntry();
        a.put(e);
        changed();
        editing = a.length() - 1;
        render();
    }

    private void removeEntry(int idx) {
        JSONArray a = entries();
        JSONArray keep = new JSONArray();
        for (int i = 0; i < a.length(); i++) {
            if (i != idx) keep.put(a.optJSONObject(i));
        }
        try {
            card.put("bookEntries", keep);
        } catch (Exception ignore) {
        }
        changed();
        editing = -1;
        render();
    }

    private void duplicateEntry(int idx) {
        JSONObject src = entryAt(idx);
        if (src == null) return;
        try {
            JSONObject copy = new JSONObject(src.toString());
            copy.put("id", newId());
            copy.put("comment", src.optString("comment", "") + " 副本");
            JSONArray a = entries();
            a.put(copy);
            changed();
            editing = a.length() - 1;
            render();
        } catch (Exception ignore) {
        }
    }

    /**
     * 空条目。
     *
     * <p>⚠ 字段照 {@code normalizeLoreEntry({},0)} 的输出写全 —— 少写的那几个网页那边
     * 会补默认值，但**默认值可能跟这里想的不一样**（比如 selective 默认是 true）。
     * 写全了才不用去猜。
     */
    static JSONObject blankEntry() {
        JSONObject e = new JSONObject();
        try {
            e.put("id", newId());
            e.put("comment", "");
            e.put("content", "");
            e.put("keys", new JSONArray());
            e.put("secondaryKeys", new JSONArray());
            e.put("selective", true);
            e.put("selectiveLogic", 0);
            e.put("constant", false);
            e.put("enabled", true);
            e.put("useRegex", false);
            e.put("position", POS_BEFORE);
            e.put("depth", 4);
            e.put("role", 0);
            e.put("order", 100);
            e.put("probability", 100);
            e.put("useProbability", true);
            e.put("caseSensitive", JSONObject.NULL);
            e.put("matchWholeWords", JSONObject.NULL);
            e.put("useGroupScoring", JSONObject.NULL);
            e.put("excludeRecursion", false);
            e.put("preventRecursion", false);
            e.put("delayUntilRecursion", 0);
            e.put("scanDepth", JSONObject.NULL);
            e.put("group", "");
            e.put("groupWeight", 100);
            e.put("groupOverride", false);
            e.put("triggers", new JSONArray());
            e.put("characterFilter", new JSONObject()
                    .put("isExclude", false)
                    .put("names", new JSONArray())
                    .put("tags", new JSONArray()));
            e.put("sticky", JSONObject.NULL);
            e.put("cooldown", JSONObject.NULL);
            e.put("delay", JSONObject.NULL);
            e.put("outletName", "");
            e.put("matchPersonaDescription", false);
            e.put("matchCharacterDescription", false);
            e.put("matchCharacterPersonality", false);
            e.put("matchCharacterDepthPrompt", false);
            e.put("matchScenario", false);
            e.put("matchCreatorNotes", false);
            e.put("decorators", new JSONArray());
            e.put("hash", 0);
        } catch (Exception ignore) {
        }
        return e;
    }

    static String newId() {
        return "e" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    }

    // ────────────────────────── 单个条目 ──────────────────────────

    private View buildEntry(final int idx) {
        final JSONObject e = entryAt(idx);
        if (e == null) {
            editing = -1;
            return buildList();
        }

        ScrollView sv = new ScrollView(ctx);
        sv.setClipToPadding(false);
        int p = M3.dp(ctx, 20);
        sv.setPadding(p, M3.dp(ctx, 8), p, M3.dp(ctx, 28));
        LinearLayout col = new LinearLayout(ctx);
        col.setOrientation(LinearLayout.VERTICAL);
        sv.addView(col, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        // 顶上一行：返回 + 序号 + 复制 + 删除
        LinearLayout bar = new LinearLayout(ctx);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);

        TextView back = M3.text(ctx, "← 全部条目", R.style.TextAppearance_M3_LabelLarge);
        back.setTextColor(M3.color(ctx, R.color.md_primary));
        back.setPadding(0, M3.dp(ctx, 8), M3.dp(ctx, 12), M3.dp(ctx, 8));
        back.setClickable(true);
        back.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                editing = -1;
                render();
            }
        });
        bar.addView(back, new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        TextView dup = M3.text(ctx, "复制", R.style.TextAppearance_M3_LabelLarge);
        dup.setTextColor(M3.color(ctx, R.color.md_primary));
        dup.setPadding(M3.dp(ctx, 10), M3.dp(ctx, 8), M3.dp(ctx, 10), M3.dp(ctx, 8));
        dup.setClickable(true);
        dup.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                duplicateEntry(idx);
            }
        });
        bar.addView(dup);

        TextView del = M3.text(ctx, "删除", R.style.TextAppearance_M3_LabelLarge);
        del.setTextColor(M3.color(ctx, R.color.md_error));
        del.setPadding(M3.dp(ctx, 10), M3.dp(ctx, 8), 0, M3.dp(ctx, 8));
        del.setClickable(true);
        del.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                removeEntry(idx);
            }
        });
        bar.addView(del);
        col.addView(bar);

        // 触发条件
        col.addView(M3.section(ctx, "什么时候用这条"));
        LinearLayout c1 = M3.card(ctx);
        c1.addView(CardForm.field(ctx, "关键词（逗号分隔，命中任意一个就触发）",
                joinArr(e, "keys"), new CardForm.OnText() {
                    @Override
                    public void onText(String v) {
                        putList(e, "keys", v);
                    }
                }));
        c1.addView(CardForm.field(ctx, "副关键词（逗号分隔，配合「选择性」）",
                joinArr(e, "secondaryKeys"), new CardForm.OnText() {
                    @Override
                    public void onText(String v) {
                        putList(e, "secondaryKeys", v);
                    }
                }), M3.gap(ctx, 12));
        c1.addView(toggle("常驻（不看关键词，一直塞进去）", e.optBoolean("constant"),
                new BoolCb() {
                    @Override
                    public void onBool(boolean b) {
                        putBool(e, "constant", b);
                    }
                }), M3.gap(ctx, 12));
        c1.addView(toggle("选择性（要求关键词 + 副关键词同时命中）", e.optBoolean("selective", true),
                new BoolCb() {
                    @Override
                    public void onBool(boolean b) {
                        putBool(e, "selective", b);
                    }
                }), M3.gap(ctx, 4));
        c1.addView(toggle("启用", e.optBoolean("enabled", true), new BoolCb() {
            @Override
            public void onBool(boolean b) {
                putBool(e, "enabled", b);
            }
        }), M3.gap(ctx, 4));
        c1.addView(toggle("关键词按正则匹配（use_regex）", e.optBoolean("useRegex"), new BoolCb() {
            @Override
            public void onBool(boolean b) {
                putBool(e, "useRegex", b);
            }
        }), M3.gap(ctx, 4));
        col.addView(c1, M3.gap(ctx, 8));

        // 正文
        col.addView(M3.section(ctx, "塞进去的正文"));
        LinearLayout c2 = M3.card(ctx);
        c2.addView(CardForm.field(ctx, "标题（只是给你自己看的）", e.optString("comment", ""),
                new CardForm.OnText() {
                    @Override
                    public void onText(String v) {
                        try {
                            e.put("comment", v);
                        } catch (Exception ignore) {
                        }
                        changed();
                    }
                }));
        c2.addView(CardForm.area(ctx, "正文", e.optString("content", ""), 8,
                new CardForm.OnText() {
                    @Override
                    public void onText(String v) {
                        try {
                            e.put("content", v);
                        } catch (Exception ignore) {
                        }
                        changed();
                    }
                }), M3.gap(ctx, 12));
        col.addView(c2, M3.gap(ctx, 8));

        // 插到哪
        col.addView(M3.section(ctx, "插到哪里"));
        LinearLayout c3 = M3.card(ctx);
        c3.addView(CardForm.chips(ctx, "位置",
                new String[]{String.valueOf(POS_BEFORE), String.valueOf(POS_AFTER),
                        String.valueOf(POS_DEPTH)},
                new String[]{"角色之前", "角色之后", "按深度"},
                String.valueOf(posOf(e)), new CardForm.OnText() {
                    @Override
                    public void onText(String v) {
                        try {
                            e.put("position", Integer.parseInt(v));
                        } catch (Exception ignore) {
                        }
                        changed();
                    }
                }));
        c3.addView(CardForm.field(ctx, "深度（位置选「按深度」时才有用）",
                String.valueOf(e.optInt("depth", 4)), new CardForm.OnText() {
                    @Override
                    public void onText(String v) {
                        putInt(e, "depth", v);
                    }
                }), M3.gap(ctx, 12));
        c3.addView(CardForm.chips(ctx, "以谁的身份插入",
                new String[]{"0", "1", "2"},
                new String[]{"system", "user", "assistant"},
                String.valueOf(e.optInt("role", 0)), new CardForm.OnText() {
                    @Override
                    public void onText(String v) {
                        try {
                            e.put("role", Integer.parseInt(v));
                        } catch (Exception ignore) {
                        }
                        changed();
                    }
                }), M3.gap(ctx, 12));
        c3.addView(CardForm.field(ctx, "顺序（小的先插）",
                String.valueOf(e.optInt("order", 100)), new CardForm.OnText() {
                    @Override
                    public void onText(String v) {
                        putInt(e, "order", v);
                    }
                }), M3.gap(ctx, 12));
        col.addView(c3, M3.gap(ctx, 8));

        // 其它
        col.addView(M3.section(ctx, "其它"));
        LinearLayout c4 = M3.card(ctx);
        c4.addView(CardForm.field(ctx, "触发概率 %（100 = 每次都触发）",
                String.valueOf(e.optInt("probability", 100)), new CardForm.OnText() {
                    @Override
                    public void onText(String v) {
                        putInt(e, "probability", v);
                    }
                }));
        c4.addView(CardForm.field(ctx, "分组（同组只会进一条）",
                e.optString("group", ""), new CardForm.OnText() {
                    @Override
                    public void onText(String v) {
                        try {
                            e.put("group", v);
                        } catch (Exception ignore) {
                        }
                        changed();
                    }
                }), M3.gap(ctx, 12));
        col.addView(c4, M3.gap(ctx, 8));

        col.addView(CardForm.note(ctx,
                "⚠ 递归 / 时间效果（sticky、cooldown、delay）/ 扫描深度 / 角色过滤 这几组"
                        + "这一版改不到，值原样保留。"));
        return sv;
    }

    private int posOf(JSONObject e) {
        int p = e.optInt("position", POS_BEFORE);
        return (p == POS_AFTER || p == POS_DEPTH) ? p : POS_BEFORE;
    }

    // ────────────────────────── 小工具 ──────────────────────────

    private interface BoolCb {
        void onBool(boolean b);
    }

    /** 一行「说明 + Switch」。⚠ 点整行也能切，不然开关太小不好按。 */
    private View toggle(String label, boolean on, final BoolCb cb) {
        LinearLayout row = new LinearLayout(ctx);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(0, M3.dp(ctx, 6), 0, M3.dp(ctx, 6));

        TextView t = M3.text(ctx, label, R.style.TextAppearance_M3_BodyLarge);
        row.addView(t, new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        final Switch sw = new Switch(ctx);
        sw.setChecked(on);
        sw.setOnCheckedChangeListener(new android.widget.CompoundButton.OnCheckedChangeListener() {
            @Override
            public void onCheckedChanged(android.widget.CompoundButton b, boolean v) {
                cb.onBool(v);
            }
        });
        row.addView(sw);

        row.setClickable(true);
        row.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                sw.setChecked(!sw.isChecked());
            }
        });
        return row;
    }

    private String joinArr(JSONObject e, String key) {
        JSONArray a = e.optJSONArray(key);
        if (a == null) return "";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < a.length(); i++) {
            if (i > 0) sb.append(", ");
            sb.append(a.optString(i, ""));
        }
        return sb.toString();
    }

    private void putList(JSONObject e, String key, String raw) {
        JSONArray a = new JSONArray();
        String[] parts = raw.split("[,，、\\n]");
        for (String p : parts) {
            String t = p.trim();
            if (t.length() > 0) a.put(t);
        }
        try {
            e.put(key, a);
        } catch (Exception ignore) {
        }
        changed();
    }

    private void putBool(JSONObject e, String key, boolean b) {
        try {
            e.put(key, b);
        } catch (Exception ignore) {
        }
        changed();
    }

    /** 数字输入：中途是空的 / 非数字就**不动存储**，等它变成数字。 */
    private void putInt(JSONObject e, String key, String raw) {
        try {
            e.put(key, Integer.parseInt(raw.trim()));
            changed();
        } catch (Exception ignore) {
        }
    }
}
