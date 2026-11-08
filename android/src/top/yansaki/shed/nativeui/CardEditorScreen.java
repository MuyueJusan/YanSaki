package top.yansaki.shed.nativeui;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import top.yansaki.shed.MainActivity;
import top.yansaki.shed.R;

/**
 * 角色卡编写器（原生）。
 *
 * <p>⚠⚠ **草稿跟网页是同一份**：键 {@code stCardDraft}，结构
 * {@code {v, tab, tabsCollapsed, homeClosed, srcName, mvuOwn, sbOwn, sbFree, card, raw?, rawTh?}}
 * （照 {@code js/255} 的 {@code stSaveDraftInner}）。所以手机上改一半、网页打开还是那一半。
 *
 * <p>⚠ 写回时**只改 card 里的字段**，其余键（{@code raw} / {@code rawTh} / {@code mvuOwn} …）
 * 原样带着走 —— 抹掉 {@code raw} 等于把「导入时留的原始 JSON」删了，导出就再也不无损。
 * ⚠ 也**不要**改 {@code tab}：那是网页界面的落点，原生这边自己记在内存里。
 *
 * <p>⚠ 16 个选项卡里这一版原生实现了 8 个（首页 / 名字 / 类型 / 角色描述 / 系统提示词 /
 * 元信息 / 开场白 / 导出）。其余 8 个**仍然列出来**，点进去是一张「在旧界面打开」的卡片 ——
 * 藏起来会让人以为功能没了。
 */
public class CardEditorScreen implements Screen {

    static final String[] TAB_IDS = {
            "home", "name", "spec", "desc", "sys", "meta", "ai", "book",
            "greet", "regex", "th", "mvu", "sb", "code", "persona", "export"
    };
    static final String[] TAB_LABELS = {
            "首页", "名字", "类型", "角色描述", "系统提示词", "元信息", "AI 助手", "世界书",
            "开场白", "正则", "酒馆助手", "MVU", "状态栏", "Code", "人设生成器", "导出"
    };

    /** 这一版真的做了的。⚠ 加一页就从这里加，别只改 builder。 */
    private static final List<String> NATIVE = Arrays.asList(
            "home", "name", "spec", "desc", "sys", "meta", "greet", "export");

    private final Context ctx;
    private final Store store;

    private JSONObject draft;
    private JSONObject card;
    private LinearLayout tabRow;
    private FrameLayout content;
    private String tab = "home";

    private final Handler saveH = new Handler(Looper.getMainLooper());
    private Runnable saveTask;

    public CardEditorScreen(Context c) {
        this.ctx = c;
        this.store = Store.get(c);
    }

    @Override
    public String title() {
        return "卡片";
    }

    @Override
    public String kicker() {
        return "角色卡编写器";
    }

    // ────────────────────────── 布局 ──────────────────────────

    @Override
    public View build() {
        load();

        LinearLayout root = new LinearLayout(ctx);
        root.setOrientation(LinearLayout.VERTICAL);

        HorizontalScrollView hs = new HorizontalScrollView(ctx);
        hs.setHorizontalScrollBarEnabled(false);
        hs.setClipToPadding(false);
        int p = M3.dp(ctx, 18);
        hs.setPadding(p, 0, p, M3.dp(ctx, 6));

        tabRow = new LinearLayout(ctx);
        tabRow.setOrientation(LinearLayout.HORIZONTAL);
        hs.addView(tabRow, new HorizontalScrollView.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(hs, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        content = new FrameLayout(ctx);
        root.addView(content, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        renderTabs();
        showTab(tab);
        return root;
    }

    private void renderTabs() {
        tabRow.removeAllViews();
        for (int i = 0; i < TAB_IDS.length; i++) {
            final String id = TAB_IDS[i];
            boolean on = id.equals(tab);
            TextView t = M3.text(ctx, TAB_LABELS[i], R.style.TextAppearance_M3_LabelLarge);
            t.setPadding(M3.dp(ctx, 14), M3.dp(ctx, 9), M3.dp(ctx, 14), M3.dp(ctx, 9));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.rightMargin = M3.dp(ctx, 8);
            t.setLayoutParams(lp);
            t.setClickable(true);
            t.setBackgroundResource(on ? R.drawable.bg_m3_chip_on : R.drawable.bg_m3_chip);
            t.setTextColor(M3.color(ctx, on
                    ? R.color.md_on_secondary_container : R.color.md_on_surface));
            // ⚠ 没做的那几个把文字调暗一点，但**照样能点**（点进去说清楚为什么）
            if (!NATIVE.contains(id)) t.setAlpha(0.62f);
            t.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    tab = id;
                    renderTabs();
                    showTab(id);
                }
            });
            tabRow.addView(t);
        }
    }

    private void showTab(String id) {
        content.removeAllViews();
        View v = NATIVE.contains(id) ? buildNative(id) : buildDeferred(id);
        content.addView(v, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        M3.popIn(content);
    }

    // ────────────────────────── 数据 ──────────────────────────

    /**
     * 读草稿。读不到就造一张空卡（字段照 {@code stBlankCard}）。
     *
     * <p>⚠ 空卡**不立刻落盘**：用户只是打开看了一眼就走的话，不该把网页那边
     * 的「还没有草稿」变成「有一张空草稿」。
     */
    private void load() {
        String raw = store.get("stCardDraft", null);
        draft = null;
        if (raw != null && raw.length() > 0) {
            try {
                JSONObject o = new JSONObject(raw);
                if (o.optJSONObject("card") != null) {
                    draft = o;
                    card = o.optJSONObject("card");
                }
            } catch (Exception ignore) {
            }
        }
        if (draft == null) {
            draft = new JSONObject();
            try {
                draft.put("v", 1);
                draft.put("tab", "home");
                draft.put("tabsCollapsed", false);
                draft.put("homeClosed", new JSONObject());
                draft.put("srcName", "");
                draft.put("mvuOwn", false);
                draft.put("sbOwn", false);
                draft.put("sbFree", true);
            } catch (Exception ignore) {
            }
            card = blankCard();
            try {
                draft.put("card", card);
            } catch (Exception ignore) {
            }
        }
    }

    /** 空卡。⚠ 字段名照 {@code stBlankCard()}，多一个少一个都会让网页那边读到 undefined。 */
    private JSONObject blankCard() {
        JSONObject c = new JSONObject();
        try {
            int now = (int) (System.currentTimeMillis() / 1000);
            c.put("spec", "v2");
            c.put("name", "");
            c.put("nickname", "");
            c.put("description", "");
            c.put("personality", "");
            c.put("scenario", "");
            c.put("mesExample", "");
            c.put("systemPrompt", "");
            c.put("postHistoryInstructions", "");
            c.put("depthPrompt", "");
            c.put("depthPromptDepth", 4);
            c.put("depthPromptRole", 0);
            c.put("creator", "");
            c.put("characterVersion", "");
            c.put("creatorNotes", "");
            c.put("tags", new JSONArray());
            c.put("source", new JSONArray());
            c.put("creationDate", now);
            c.put("modificationDate", now);
            c.put("firstMes", "");
            c.put("alternateGreetings", new JSONArray());
            c.put("groupOnlyGreetings", new JSONArray());
            c.put("bookName", "");
            c.put("bookDescription", "");
            c.put("bookEntries", new JSONArray());
            c.put("regex", new JSONArray());
            c.put("thScripts", new JSONArray());
            c.put("mvu", new JSONObject());
            c.put("statusBar", new JSONObject());
        } catch (Exception ignore) {
        }
        return c;
    }

    private String s(String k) {
        return card.optString(k, "");
    }

    private void put(String k, String v) {
        try {
            card.put(k, v);
        } catch (Exception ignore) {
        }
        touch();
    }

    private void putInt(String k, int v) {
        try {
            card.put(k, v);
        } catch (Exception ignore) {
        }
        touch();
    }

    /** 记一次修改：更新修改时间 + 排一次延迟保存。 */
    private void touch() {
        try {
            card.put("modificationDate", (int) (System.currentTimeMillis() / 1000));
        } catch (Exception ignore) {
        }
        if (saveTask != null) saveH.removeCallbacks(saveTask);
        saveTask = new Runnable() {
            @Override
            public void run() {
                flush();
            }
        };
        // ⚠ 防抖 500ms：每敲一个字都序列化 + 过桥的话，长文本输入会明显卡。
        saveH.postDelayed(saveTask, 500);
    }

    /** 立刻写盘 + 回推网页。 */
    private void flush() {
        if (draft == null || card == null) return;
        try {
            draft.put("card", card);
        } catch (Exception ignore) {
        }
        String json = draft.toString();
        store.put("stCardDraft", json);
        MainActivity.pushToWeb("stCardDraft", json);
    }

    // ────────────────────────── 各选项卡 ──────────────────────────

    private View buildNative(String id) {
        if ("home".equals(id)) return buildHome();
        if ("name".equals(id)) return buildName();
        if ("spec".equals(id)) return buildSpec();
        if ("desc".equals(id)) return buildDesc();
        if ("sys".equals(id)) return buildSys();
        if ("meta".equals(id)) return buildMeta();
        if ("greet".equals(id)) return buildGreet();
        return buildExport();
    }

    /** 造一个「已经装在 ScrollView 里」的列。 */
    private LinearLayout columnInScroll(ScrollView[] holder) {
        ScrollView sv = new ScrollView(ctx);
        sv.setClipToPadding(false);
        int p = M3.dp(ctx, 20);
        sv.setPadding(p, M3.dp(ctx, 8), p, M3.dp(ctx, 28));
        LinearLayout col = new LinearLayout(ctx);
        col.setOrientation(LinearLayout.VERTICAL);
        sv.addView(col, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        if (holder != null) holder[0] = sv;
        return col;
    }

    private View buildHome() {
        ScrollView[] h = new ScrollView[1];
        LinearLayout col = columnInScroll(h);

        LinearLayout hero = M3.card(ctx);
        hero.setPadding(M3.dp(ctx, 20), M3.dp(ctx, 20), M3.dp(ctx, 20), M3.dp(ctx, 20));

        TextView avatar = M3.text(ctx, initial(), R.style.TextAppearance_M3_HeadlineMedium);
        avatar.setGravity(Gravity.CENTER);
        avatar.setBackgroundResource(R.drawable.bg_m3_chip_on);
        avatar.setTextColor(M3.color(ctx, R.color.md_on_secondary_container));
        LinearLayout.LayoutParams alp = new LinearLayout.LayoutParams(
                M3.dp(ctx, 72), M3.dp(ctx, 72));
        alp.bottomMargin = M3.dp(ctx, 14);
        hero.addView(avatar, alp);

        String nm = s("name");
        hero.addView(M3.text(ctx, nm.length() == 0 ? "（还没起名字）" : nm,
                R.style.TextAppearance_M3_HeadlineSmall));
        TextView specT = M3.text(ctx, specLabel(s("spec")), R.style.TextAppearance_M3_BodyMedium);
        specT.setPadding(0, M3.dp(ctx, 4), 0, 0);
        hero.addView(specT);

        col.addView(hero);

        // 统计
        col.addView(M3.section(ctx, "这张卡里有什么"));
        LinearLayout stats = M3.card(ctx);
        stats.addView(statRow("开场白", count("alternateGreetings") + 1 + " 条"));
        stats.addView(M3.divider(ctx));
        stats.addView(statRow("世界书条目", count("bookEntries") + " 条"));
        stats.addView(M3.divider(ctx));
        stats.addView(statRow("正则脚本", count("regex") + " 条"));
        stats.addView(M3.divider(ctx));
        stats.addView(statRow("酒馆助手脚本", count("thScripts") + " 条"));
        col.addView(stats, M3.gap(ctx, 8));

        col.addView(M3.section(ctx, "接下来"));
        col.addView(CardForm.button(ctx, "保存并同步到网页", 0, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                flush();
                toast("已保存");
            }
        }), M3.gap(ctx, 8));
        col.addView(CardForm.button(ctx, "去看导出", 1, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                tab = "export";
                renderTabs();
                showTab(tab);
            }
        }), M3.gap(ctx, 8));
        col.addView(CardForm.note(ctx,
                "⚠ 世界书 / 正则 / 酒馆助手 / MVU / 状态栏 / Code / AI 助手 / 人设生成器"
                        + " 这八页还没搬成原生，点上面那几个选项卡会给你一个「在旧界面打开」的入口。"));
        return h[0];
    }

    private String initial() {
        String nm = s("name").trim();
        return nm.length() == 0 ? "？" : nm.substring(0, 1);
    }

    private int count(String key) {
        JSONArray a = card.optJSONArray(key);
        return a == null ? 0 : a.length();
    }

    private View statRow(String label, String value) {
        LinearLayout r = new LinearLayout(ctx);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setGravity(Gravity.CENTER_VERTICAL);
        r.setPadding(0, M3.dp(ctx, 6), 0, M3.dp(ctx, 6));
        TextView l = M3.text(ctx, label, R.style.TextAppearance_M3_BodyLarge);
        l.setTextColor(M3.color(ctx, R.color.md_on_surface_variant));
        r.addView(l, new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        r.addView(M3.text(ctx, value, R.style.TextAppearance_M3_TitleMedium));
        return r;
    }

    private View buildName() {
        ScrollView[] h = new ScrollView[1];
        LinearLayout col = columnInScroll(h);
        col.addView(M3.section(ctx, "名字"));
        LinearLayout c1 = M3.card(ctx);
        c1.addView(CardForm.field(ctx, "角色名", s("name"), new CardForm.OnText() {
            @Override
            public void onText(String v) {
                put("name", v);
            }
        }));
        c1.addView(CardForm.field(ctx, "昵称（V3 才有）", s("nickname"), new CardForm.OnText() {
            @Override
            public void onText(String v) {
                put("nickname", v);
            }
        }), M3.gap(ctx, 12));
        col.addView(c1, M3.gap(ctx, 8));
        col.addView(CardForm.note(ctx, "名字会出现在导出文件里；空着导出时会被写成「未命名角色」。"));
        return h[0];
    }

    private String specLabel(String id) {
        if ("v1".equals(id)) return "V1（老式扁平卡）";
        if ("v3".equals(id)) return "V3（chara_card_v3）";
        return "V2（chara_card_v2）";
    }

    private View buildSpec() {
        ScrollView[] h = new ScrollView[1];
        LinearLayout col = columnInScroll(h);
        col.addView(M3.section(ctx, "规格"));
        LinearLayout c1 = M3.card(ctx);
        c1.addView(CardForm.chips(ctx, "导出成哪一版",
                new String[]{"v1", "v2", "v3"},
                new String[]{"V1", "V2", "V3"},
                s("spec").length() == 0 ? "v2" : s("spec"),
                new CardForm.OnText() {
                    @Override
                    public void onText(String v) {
                        put("spec", v);
                    }
                }));
        col.addView(c1, M3.gap(ctx, 8));

        col.addView(M3.section(ctx, "三版的区别"));
        LinearLayout c2 = M3.card(ctx);
        c2.addView(para("V1", "最老的一版，只有 name / description / personality / scenario / "
                + "first_mes / mes_example 这几个扁平字段。装不下世界书、正则、备选开场白 —— "
                + "选 V1 这些会丢。"));
        c2.addView(M3.divider(ctx));
        c2.addView(para("V2", "目前最通用的版本。在 V1 之上加了 creator / tags / creator_notes / "
                + "system_prompt / post_history_instructions / alternate_greetings，"
                + "以及内置世界书 character_book。"));
        c2.addView(M3.divider(ctx));
        c2.addView(para("V3", "在 V2 上继续加：nickname / source / group_only_greetings / "
                + "creation_date / modification_date / assets。"));
        col.addView(c2, M3.gap(ctx, 8));
        return h[0];
    }

    private View para(String title, String body) {
        LinearLayout box = new LinearLayout(ctx);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(0, M3.dp(ctx, 2), 0, M3.dp(ctx, 2));
        box.addView(M3.text(ctx, title, R.style.TextAppearance_M3_TitleSmall));
        TextView t = M3.text(ctx, body, R.style.TextAppearance_M3_BodyMedium);
        t.setPadding(0, M3.dp(ctx, 2), 0, 0);
        box.addView(t);
        return box;
    }

    private View buildDesc() {
        ScrollView[] h = new ScrollView[1];
        LinearLayout col = columnInScroll(h);
        col.addView(M3.section(ctx, "角色描述"));
        LinearLayout c1 = M3.card(ctx);
        c1.addView(CardForm.area(ctx, "description —— 她是谁", s("description"), 8,
                new CardForm.OnText() {
                    @Override
                    public void onText(String v) {
                        put("description", v);
                    }
                }));
        col.addView(c1, M3.gap(ctx, 8));

        col.addView(M3.section(ctx, "设定"));
        LinearLayout c2 = M3.card(ctx);
        c2.addView(CardForm.area(ctx, "personality —— 性格", s("personality"), 4,
                new CardForm.OnText() {
                    @Override
                    public void onText(String v) {
                        put("personality", v);
                    }
                }));
        c2.addView(CardForm.area(ctx, "scenario —— 场景", s("scenario"), 4,
                new CardForm.OnText() {
                    @Override
                    public void onText(String v) {
                        put("scenario", v);
                    }
                }), M3.gap(ctx, 12));
        c2.addView(CardForm.area(ctx, "mes_example —— 对话示例", s("mesExample"), 6,
                new CardForm.OnText() {
                    @Override
                    public void onText(String v) {
                        put("mesExample", v);
                    }
                }), M3.gap(ctx, 12));
        col.addView(c2, M3.gap(ctx, 8));
        return h[0];
    }

    private View buildSys() {
        ScrollView[] h = new ScrollView[1];
        LinearLayout col = columnInScroll(h);
        col.addView(M3.section(ctx, "系统提示词"));
        LinearLayout c1 = M3.card(ctx);
        c1.addView(CardForm.area(ctx, "system_prompt", s("systemPrompt"), 6,
                new CardForm.OnText() {
                    @Override
                    public void onText(String v) {
                        put("systemPrompt", v);
                    }
                }));
        c1.addView(CardForm.area(ctx, "post_history_instructions —— 历史之后插的话",
                s("postHistoryInstructions"), 4, new CardForm.OnText() {
                    @Override
                    public void onText(String v) {
                        put("postHistoryInstructions", v);
                    }
                }), M3.gap(ctx, 12));
        col.addView(c1, M3.gap(ctx, 8));

        col.addView(M3.section(ctx, "深度提示（depth_prompt）"));
        LinearLayout c2 = M3.card(ctx);
        c2.addView(CardForm.area(ctx, "内容（空着就不导出这一项）", s("depthPrompt"), 3,
                new CardForm.OnText() {
                    @Override
                    public void onText(String v) {
                        put("depthPrompt", v);
                    }
                }));
        c2.addView(CardForm.field(ctx, "深度（往回数几条）",
                String.valueOf(card.optInt("depthPromptDepth", 4)), new CardForm.OnText() {
                    @Override
                    public void onText(String v) {
                        try {
                            putInt("depthPromptDepth", Integer.parseInt(v.trim()));
                        } catch (Exception e) {
                            // 输入中途是空的 / 非数字：不动存储，等它变成数字
                        }
                    }
                }), M3.gap(ctx, 12));
        c2.addView(CardForm.chips(ctx, "角色",
                new String[]{"0", "1", "2"},
                new String[]{"system", "user", "assistant"},
                String.valueOf(card.optInt("depthPromptRole", 0)),
                new CardForm.OnText() {
                    @Override
                    public void onText(String v) {
                        try {
                            putInt("depthPromptRole", Integer.parseInt(v));
                        } catch (Exception ignore) {
                        }
                    }
                }), M3.gap(ctx, 12));
        col.addView(c2, M3.gap(ctx, 8));
        return h[0];
    }

    private View buildMeta() {
        ScrollView[] h = new ScrollView[1];
        LinearLayout col = columnInScroll(h);
        col.addView(M3.section(ctx, "元信息"));
        LinearLayout c1 = M3.card(ctx);
        c1.addView(CardForm.field(ctx, "creator —— 作者", s("creator"), new CardForm.OnText() {
            @Override
            public void onText(String v) {
                put("creator", v);
            }
        }));
        c1.addView(CardForm.field(ctx, "character_version —— 版本", s("characterVersion"),
                new CardForm.OnText() {
                    @Override
                    public void onText(String v) {
                        put("characterVersion", v);
                    }
                }), M3.gap(ctx, 12));
        c1.addView(CardForm.area(ctx, "creator_notes —— 给用的人看的说明",
                s("creatorNotes"), 4, new CardForm.OnText() {
                    @Override
                    public void onText(String v) {
                        put("creatorNotes", v);
                    }
                }), M3.gap(ctx, 12));
        col.addView(c1, M3.gap(ctx, 8));

        col.addView(M3.section(ctx, "标签"));
        LinearLayout c2 = M3.card(ctx);
        c2.addView(CardForm.field(ctx, "tags（用逗号分隔）", join("tags"), new CardForm.OnText() {
            @Override
            public void onText(String v) {
                putList("tags", v);
            }
        }));
        c2.addView(CardForm.field(ctx, "source（用逗号分隔）", join("source"), new CardForm.OnText() {
            @Override
            public void onText(String v) {
                putList("source", v);
            }
        }), M3.gap(ctx, 12));
        col.addView(c2, M3.gap(ctx, 8));
        col.addView(CardForm.note(ctx, "创建时间 / 修改时间由编辑器自动维护，不用手填。"));
        return h[0];
    }

    private String join(String key) {
        JSONArray a = card.optJSONArray(key);
        if (a == null) return "";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < a.length(); i++) {
            if (i > 0) sb.append(", ");
            sb.append(a.optString(i, ""));
        }
        return sb.toString();
    }

    private void putList(String key, String raw) {
        JSONArray a = new JSONArray();
        String[] parts = raw.split("[,，、\\n]");
        for (String p : parts) {
            String t = p.trim();
            if (t.length() > 0) a.put(t);
        }
        try {
            card.put(key, a);
        } catch (Exception ignore) {
        }
        touch();
    }

    private View buildGreet() {
        ScrollView[] h = new ScrollView[1];
        LinearLayout col = columnInScroll(h);
        col.addView(M3.section(ctx, "第一句"));
        LinearLayout c1 = M3.card(ctx);
        c1.addView(CardForm.area(ctx, "first_mes —— 开场白", s("firstMes"), 6,
                new CardForm.OnText() {
                    @Override
                    public void onText(String v) {
                        put("firstMes", v);
                    }
                }));
        col.addView(c1, M3.gap(ctx, 8));

        col.addView(M3.section(ctx, "备选开场白"));
        col.addView(buildListEditor("alternateGreetings", "备选开场白", 4));
        col.addView(M3.section(ctx, "群聊专用开场白"));
        col.addView(buildListEditor("groupOnlyGreetings", "群聊开场白", 3));
        return h[0];
    }

    /**
     * 字符串数组编辑器（开场白那三组用）。
     *
     * <p>⚠ 每条输入框**绑的是下标**，不是「当前第几条」这种会漂的东西；
     * 删除 / 新增时才整块重建。逐字重建会让光标每打一个字就跳走。
     */
    private View buildListEditor(final String key, String label, int lines) {
        LinearLayout box = new LinearLayout(ctx);
        box.setOrientation(LinearLayout.VERTICAL);

        JSONArray arr = card.optJSONArray(key);
        if (arr == null) arr = new JSONArray();

        LinearLayout listCard = M3.card(ctx);
        for (int i = 0; i < arr.length(); i++) {
            final int idx = i;
            LinearLayout item = new LinearLayout(ctx);
            item.setOrientation(LinearLayout.VERTICAL);
            item.addView(CardForm.area(ctx, label + " " + (i + 1), arr.optString(i, ""), lines,
                    new CardForm.OnText() {
                        @Override
                        public void onText(String v) {
                            setListItem(key, idx, v);
                        }
                    }));
            TextView del = CardForm.button(ctx, "删除这条", 3, new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    removeListItem(key, idx);
                    showTab(tab);
                }
            });
            del.setLayoutParams(new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, M3.dp(ctx, 40)));
            item.addView(del);
            listCard.addView(item, M3.gap(ctx, i == 0 ? 0 : 12));
        }
        if (arr.length() == 0) {
            listCard.addView(CardForm.note(ctx, "还没有。点下面的按钮加一条。"));
        }
        box.addView(listCard);

        box.addView(CardForm.button(ctx, "＋ 加一条", 1, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                JSONArray a = card.optJSONArray(key);
                if (a == null) a = new JSONArray();
                a.put("");
                try {
                    card.put(key, a);
                } catch (Exception ignore) {
                }
                touch();
                showTab(tab);
            }
        }), M3.gap(ctx, 12));
        return box;
    }

    private void setListItem(String key, int idx, String v) {
        JSONArray a = card.optJSONArray(key);
        if (a == null || idx < 0 || idx >= a.length()) return;
        try {
            a.put(idx, v);
        } catch (Exception ignore) {
        }
        touch();
    }

    private void removeListItem(String key, int idx) {
        JSONArray a = card.optJSONArray(key);
        if (a == null) return;
        JSONArray keep = new JSONArray();
        for (int i = 0; i < a.length(); i++) {
            if (i != idx) keep.put(a.optString(i, ""));
        }
        try {
            card.put(key, keep);
        } catch (Exception ignore) {
        }
        touch();
    }

    // ────────────────────────── 导出 ──────────────────────────

    private View buildExport() {
        ScrollView[] h = new ScrollView[1];
        LinearLayout col = columnInScroll(h);

        final String json = buildExportJson();
        col.addView(M3.section(ctx, "导出预览（" + specLabel(s("spec")) + "）"));

        LinearLayout c1 = M3.card(ctx);
        TextView pre = M3.text(ctx, json, R.style.TextAppearance_M3_BodySmall);
        pre.setTypeface(android.graphics.Typeface.MONOSPACE);
        pre.setTextIsSelectable(true);
        c1.addView(pre);
        col.addView(c1, M3.gap(ctx, 8));

        col.addView(CardForm.button(ctx, "复制 JSON", 0, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                try {
                    ClipboardManager cm = (ClipboardManager)
                            ctx.getSystemService(Context.CLIPBOARD_SERVICE);
                    cm.setPrimaryClip(ClipData.newPlainText("character card", json));
                    toast("已复制");
                } catch (Exception e) {
                    toast("复制失败：" + e.getMessage());
                }
            }
        }), M3.gap(ctx, 12));

        col.addView(CardForm.note(ctx,
                "⚠ 这一版的导出只覆盖核心字段：世界书（character_book）与 extensions 里的"
                        + "正则 / 酒馆助手 / MVU 是从导入时留的原始 JSON 原样带过去的，"
                        + "**在原生里改不了它们**。要完整导出（含 PNG 内嵌）请用旧界面。"));
        col.addView(CardForm.button(ctx, "用旧界面导出", 2, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                flush();
                MainActivity.setPendingJs("mobileOpenSt()");
                ((NativeShellActivity) ctx).finish();
            }
        }), M3.gap(ctx, 12));
        return h[0];
    }

    /**
     * 拼导出 JSON。
     *
     * <p>⚠ 起点是草稿里那份 {@code raw}（导入时留的原始 JSON），再覆盖本编辑器管的字段 ——
     * 这样 {@code extensions} 里不认识的键、{@code character_book} 都能原样带回去。
     * 白手起家拼一个「干净」的对象会让导入 → 导出的往返丢东西。
     */
    private String buildExportJson() {
        String spec = s("spec");
        if (!"v1".equals(spec) && !"v3".equals(spec)) spec = "v2";
        String name = s("name").trim();
        if (name.length() == 0) name = "未命名角色";

        try {
            JSONObject raw = draft.optJSONObject("raw");
            JSONObject rawData = raw == null ? null : raw.optJSONObject("data");

            if ("v1".equals(spec)) {
                JSONObject o = new JSONObject();
                o.put("name", name);
                o.put("description", s("description"));
                o.put("personality", s("personality"));
                o.put("scenario", s("scenario"));
                o.put("first_mes", s("firstMes"));
                o.put("mes_example", s("mesExample"));
                o.put("creatorcomment", s("creatorNotes"));
                o.put("avatar", "none");
                o.put("chat", "");
                o.put("talkativeness", "0.5");
                o.put("fav", false);
                o.put("tags", card.optJSONArray("tags") == null
                        ? new JSONArray() : card.optJSONArray("tags"));
                return o.toString(2);
            }

            JSONObject data = new JSONObject();
            data.put("name", name);
            data.put("description", s("description"));
            data.put("personality", s("personality"));
            data.put("scenario", s("scenario"));
            data.put("first_mes", s("firstMes"));
            data.put("mes_example", s("mesExample"));
            data.put("creator_notes", s("creatorNotes"));
            data.put("system_prompt", s("systemPrompt"));
            data.put("post_history_instructions", s("postHistoryInstructions"));
            data.put("alternate_greetings", card.optJSONArray("alternateGreetings") == null
                    ? new JSONArray() : card.optJSONArray("alternateGreetings"));
            data.put("tags", card.optJSONArray("tags") == null
                    ? new JSONArray() : card.optJSONArray("tags"));
            data.put("creator", s("creator"));
            data.put("character_version", s("characterVersion"));

            // extensions：从 raw 里原样搬，再补上本编辑器管的那一项
            JSONObject ext = new JSONObject();
            JSONObject rawExt = rawData == null ? null : rawData.optJSONObject("extensions");
            if (rawExt != null) {
                java.util.Iterator<String> it = rawExt.keys();
                while (it.hasNext()) {
                    String k = it.next();
                    ext.put(k, rawExt.opt(k));
                }
            }
            if (s("depthPrompt").length() > 0) {
                ext.put("depth_prompt", new JSONObject()
                        .put("prompt", s("depthPrompt"))
                        .put("depth", card.optInt("depthPromptDepth", 4))
                        .put("role", card.optInt("depthPromptRole", 0)));
            } else {
                ext.remove("depth_prompt");
            }
            data.put("extensions", ext);

            // 世界书：原样带过去（这一版不改它）
            if (rawData != null && rawData.optJSONObject("character_book") != null) {
                data.put("character_book", rawData.optJSONObject("character_book"));
            }

            JSONObject out = new JSONObject();
            out.put("spec", "v3".equals(spec) ? "chara_card_v3" : "chara_card_v2");
            out.put("spec_version", "v3".equals(spec) ? "3.0" : "2.0");
            if ("v3".equals(spec)) {
                data.put("nickname", s("nickname"));
                data.put("source", card.optJSONArray("source") == null
                        ? new JSONArray() : card.optJSONArray("source"));
                data.put("group_only_greetings", card.optJSONArray("groupOnlyGreetings") == null
                        ? new JSONArray() : card.optJSONArray("groupOnlyGreetings"));
                data.put("creation_date", card.optInt("creationDate", 0));
                data.put("modification_date", card.optInt("modificationDate", 0));
            }
            out.put("data", data);
            return out.toString(2);
        } catch (Exception e) {
            return "拼导出 JSON 失败：" + e;
        }
    }

    // ────────────────────────── 没搬的那几页 ──────────────────────────

    private View buildDeferred(String id) {
        ScrollView[] h = new ScrollView[1];
        LinearLayout col = columnInScroll(h);

        String label = TAB_LABELS[Arrays.asList(TAB_IDS).indexOf(id)];
        col.addView(M3.section(ctx, label));
        LinearLayout c1 = M3.card(ctx);
        c1.addView(M3.text(ctx, "这一页还没搬成原生。", R.style.TextAppearance_M3_TitleMedium));
        c1.addView(CardForm.note(ctx, deferredWhy(id)));
        col.addView(c1, M3.gap(ctx, 8));

        col.addView(CardForm.button(ctx, "在旧界面里打开编写器", 0, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                flush();
                MainActivity.setPendingJs("mobileOpenSt()");
                ((NativeShellActivity) ctx).finish();
            }
        }), M3.gap(ctx, 16));

        col.addView(CardForm.note(ctx,
                "⚠ 先把原生这边改的东西存下来再跳（已经存了），旧界面打开的就是同一份草稿。"));
        return h[0];
    }

    private String deferredWhy(String id) {
        if ("book".equals(id)) return "世界书编辑器（条目 / 激活规则 / 装饰器 / 多选管理）约 2000 行。";
        if ("regex".equals(id)) return "正则脚本编辑器（placement / 深度区间 / 替换链）约 400 行。";
        if ("th".equals(id)) return "酒馆助手脚本编辑器（树形结构 + 变量）约 600 行。";
        if ("mvu".equals(id)) return "MVU 变量框架（结构树 / 取值 / 初始化脚本）约 900 行。";
        if ("sb".equals(id)) return "状态栏外观编辑器（块模型 / 检查器 / 预览）约 900 行。";
        if ("code".equals(id)) return "Code（Agent）页：任务清单 / 读写白名单 / 技能库，约 900 行。";
        if ("persona".equals(id)) return "人设生成器（模板库 / 参考素材 / 写入各页）约 1500 行。";
        return "AI 助手（选段改写 / 生成预制块）约 500 行。";
    }

    // ────────────────────────── 杂项 ──────────────────────────

    private void toast(String s) {
        Toast.makeText(ctx, s, Toast.LENGTH_SHORT).show();
    }

    @Override
    public void refresh() {
        // ⚠ 不重读草稿：那会把用户正在打的内容冲掉。首次载入在 build() 里做。
    }

    @Override
    public void onLeave() {
        // ⚠ 离开必须立刻落盘：防抖那 500ms 里切走的话，最后几个字就没了。
        if (saveTask != null) saveH.removeCallbacks(saveTask);
        flush();
    }
}
