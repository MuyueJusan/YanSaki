package top.yansaki.shed.nativeui;

import android.content.Context;
import android.text.InputType;
import android.view.Gravity;
import android.view.MenuItem;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import top.yansaki.shed.MainActivity;
import top.yansaki.shed.R;

/**
 * API 全局配置（原生）。
 *
 * <p>⚠⚠ 这里改的<b>就是</b>网页版「🔌 API 全局配置」那一份，键名 {@code apiGlobalCfg}，
 * 结构照抄 {@code js/208-API-全局配置-apiGlobal.js}。两边共用一个键，所以：
 * <ul>
 *   <li><b>读</b>：从镜像（{@link Store}）读；镜像由页面加载时推过来。</li>
 *   <li><b>写</b>：写镜像 + 回推 WebView。网页还活着就直接改它的 localStorage；
 *       不在就等它下次加载 —— 那条路径由 shim 在页面加载时把镜像<b>回灌</b>进 localStorage
 *       完成（见 {@code shim/store-shim.js} 的「回灌」段）。</li>
 * </ul>
 *
 * <p>⚠ 只改「本页认识的字段」，其余字段（models / firstSeg / authMode / project /
 * location / saJson）原样保留。整体覆盖会把这些静默清空 —— 而用户下次在网页里
 * 用 Vertex 完整模式时会发现配置没了，且看不出是谁清掉的。
 */
public class ApiScreen implements Screen {

    /** 镜像里存服务商清单的键。由 shim 从页面里读 {@code AI_PROVIDERS} 推过来。 */
    static final String K_PROVIDERS = "__ys_providers";

    /** 拿不到页面清单时的兜底。⚠ 故意只留 4 个 —— 兜底越全，越容易变成「第二份真相源」。 */
    private static final String[][] FALLBACK = {
            {"openai", "OpenAI", "https://api.openai.com/v1"},
            {"anthropic", "Anthropic Claude", "https://api.anthropic.com/v1"},
            {"gemini", "Google Gemini", "https://generativelanguage.googleapis.com/v1beta"},
            {"custom", "自定义", ""},
    };

    private final Context ctx;
    private final Store store;

    private String provider = "openai";
    private String[][] providers = FALLBACK;
    /** 下拉那一格里显示当前服务商名字的 TextView（点它弹出菜单）。 */
    private TextView providerValue;

    private EditText baseUrl;
    private EditText apiKey;
    private EditText model;
    private EditText maxTokens;
    private SeekBar temp;
    private TextView tempVal;
    private Switch stream;
    private boolean keyShown = false;

    private JSONObject orig;      // 上一次读到的原始配置（保留不认识的字段）

    public ApiScreen(Context c) {
        this.ctx = c;
        this.store = Store.get(c);
    }

    @Override
    public String title() {
        return "接口";
    }

    @Override
    public String kicker() {
        return "API 全局配置";
    }

    @Override
    public View build() {
        ScrollView sv = new ScrollView(ctx);
        sv.setClipToPadding(false);
        int p = M3.dp(ctx, 20);
        sv.setPadding(p, 0, p, M3.dp(ctx, 28));

        LinearLayout col = new LinearLayout(ctx);
        col.setOrientation(LinearLayout.VERTICAL);
        sv.addView(col, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        // ── 连接 ──
        col.addView(M3.section(ctx, ctx.getString(R.string.m3_api_section_basic)));
        LinearLayout c1 = M3.card(ctx);

        // ── 服务商：**下拉选择** ──
        // ⚠ 原来是一排横向滚动的芯片。19 家服务商 ⇒ 要滑好几次才看得到「自定义」，
        //   而且当前选中的那个经常在屏幕外 —— 打开这一页根本看不出自己在用哪家。
        //   改成下拉：当前值固定在最上面，全部选项一次性列出来。
        c1.addView(buildProviderField());

        baseUrl = addField(c1, ctx.getString(R.string.m3_api_baseurl), InputType.TYPE_TEXT_VARIATION_URI);

        // 密钥：默认掩码 + 一个「显示 / 隐藏」文字按钮
        LinearLayout keyWrap = fieldWrap(ctx.getString(R.string.m3_api_key));
        apiKey = (EditText) keyWrap.getChildAt(1);
        apiKey.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        TextView eye = M3.text(ctx, ctx.getString(R.string.m3_api_show),
                R.style.TextAppearance_M3_LabelLarge);
        eye.setTextColor(M3.color(ctx, R.color.md_primary));
        eye.setPadding(M3.dp(ctx, 10), 0, 0, 0);
        eye.setClickable(true);
        eye.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                keyShown = !keyShown;
                apiKey.setInputType(InputType.TYPE_CLASS_TEXT
                        | (keyShown ? InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
                        : InputType.TYPE_TEXT_VARIATION_PASSWORD));
                apiKey.setSelection(apiKey.getText().length());
                eye.setText(ctx.getString(keyShown ? R.string.m3_api_hide : R.string.m3_api_show));
            }
        });
        ((LinearLayout) keyWrap.getChildAt(0)).addView(eye);
        c1.addView(keyWrap, M3.gap(ctx, 12));

        col.addView(c1, M3.gap(ctx, 8));

        // ── 模型 ──
        col.addView(M3.section(ctx, ctx.getString(R.string.m3_api_section_model)));
        LinearLayout c2 = M3.card(ctx);
        model = addField(c2, ctx.getString(R.string.m3_api_model), InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        col.addView(c2, M3.gap(ctx, 8));

        // ── 生成参数 ──
        col.addView(M3.section(ctx, ctx.getString(R.string.m3_api_section_gen)));
        LinearLayout c3 = M3.card(ctx);

        LinearLayout tempHead = new LinearLayout(ctx);
        tempHead.setOrientation(LinearLayout.HORIZONTAL);
        tempHead.setGravity(Gravity.CENTER_VERTICAL);
        TextView tempLabel = M3.text(ctx, ctx.getString(R.string.m3_api_temp),
                R.style.TextAppearance_M3_LabelMedium);
        tempHead.addView(tempLabel, new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        tempVal = M3.text(ctx, "0.7", R.style.TextAppearance_M3_TitleMedium);
        tempVal.setTextColor(M3.color(ctx, R.color.md_primary));
        tempHead.addView(tempVal);
        c3.addView(tempHead);

        temp = new SeekBar(ctx);
        temp.setMax(20);
        temp.setPadding(0, M3.dp(ctx, 6), 0, 0);
        temp.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar sb, int progress, boolean fromUser) {
                tempVal.setText(String.format(java.util.Locale.US, "%.1f", progress / 10.0));
            }

            @Override
            public void onStartTrackingTouch(SeekBar sb) {
            }

            @Override
            public void onStopTrackingTouch(SeekBar sb) {
            }
        });
        c3.addView(temp);

        maxTokens = addField(c3, ctx.getString(R.string.m3_api_maxtok), InputType.TYPE_CLASS_NUMBER);

        LinearLayout streamRow = new LinearLayout(ctx);
        streamRow.setOrientation(LinearLayout.HORIZONTAL);
        streamRow.setGravity(Gravity.CENTER_VERTICAL);
        streamRow.setPadding(0, M3.dp(ctx, 12), 0, 0);
        TextView sl = M3.text(ctx, ctx.getString(R.string.m3_api_stream),
                R.style.TextAppearance_M3_BodyLarge);
        streamRow.addView(sl, new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        stream = new Switch(ctx);
        streamRow.addView(stream);
        c3.addView(streamRow);

        col.addView(c3, M3.gap(ctx, 8));

        // ── 保存 ──
        TextView save = M3.text(ctx, ctx.getString(R.string.m3_api_save),
                R.style.TextAppearance_M3_LabelLarge);
        save.setBackgroundResource(R.drawable.bg_m3_btn_filled);
        save.setTextColor(M3.color(ctx, R.color.md_on_primary));
        save.setGravity(Gravity.CENTER);
        save.setClickable(true);
        save.setFocusable(true);
        LinearLayout.LayoutParams slp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, M3.dp(ctx, 52));
        slp.topMargin = M3.dp(ctx, 20);
        save.setLayoutParams(slp);
        save.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                save();
            }
        });
        col.addView(save);

        col.addView(M3.hint(ctx, ctx.getString(R.string.m3_api_note)));

        refresh();
        return sv;
    }

    // ────────────────────────── 小工具 ──────────────────────────

    /** 一个 M3 outlined field：上面 labelSmall，下面无边框 EditText。返回 EditText。 */
    private EditText addField(LinearLayout parent, String label, int inputType) {
        LinearLayout wrap = fieldWrap(label);
        EditText et = (EditText) wrap.getChildAt(1);
        et.setInputType(InputType.TYPE_CLASS_TEXT | inputType);
        parent.addView(wrap, M3.gap(ctx, 12));
        return et;
    }

    private LinearLayout fieldWrap(String label) {
        LinearLayout wrap = new LinearLayout(ctx);
        wrap.setOrientation(LinearLayout.VERTICAL);
        wrap.setBackgroundResource(R.drawable.bg_m3_field);
        wrap.setPadding(M3.dp(ctx, 14), M3.dp(ctx, 8), M3.dp(ctx, 14), M3.dp(ctx, 8));

        LinearLayout head = new LinearLayout(ctx);
        head.setOrientation(LinearLayout.HORIZONTAL);
        head.setGravity(Gravity.CENTER_VERTICAL);
        TextView l = M3.text(ctx, label, R.style.TextAppearance_M3_LabelSmall);
        l.setTextColor(M3.color(ctx, R.color.md_on_surface_variant));
        head.addView(l, new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        wrap.addView(head);

        EditText et = new EditText(ctx);
        et.setTextAppearance(R.style.TextAppearance_M3_BodyLarge);
        et.setBackground(null);
        et.setPadding(0, M3.dp(ctx, 2), 0, 0);
        et.setSingleLine(true);
        wrap.addView(et);
        return wrap;
    }

    /**
     * 「服务商」那一格：长得像输入框，点开是下拉菜单。
     *
     * <p>⚠ 用 {@link PopupMenu} 而不是再手搓一个列表：19 项超过一屏，PopupMenu 自带滚动，
     * 而且点外面就关。自己拼一个 LinearLayout 弹窗要处理「点外面关闭」「超出屏幕」
     * 「返回键」，全是重复劳动。
     */
    private View buildProviderField() {
        LinearLayout box = new LinearLayout(ctx);
        box.setOrientation(LinearLayout.HORIZONTAL);
        box.setGravity(Gravity.CENTER_VERTICAL);
        box.setBackgroundResource(R.drawable.bg_m3_field);
        box.setPadding(M3.dp(ctx, 14), M3.dp(ctx, 8), M3.dp(ctx, 14), M3.dp(ctx, 8));
        box.setClickable(true);
        box.setFocusable(true);

        LinearLayout col = new LinearLayout(ctx);
        col.setOrientation(LinearLayout.VERTICAL);

        TextView l = M3.text(ctx, ctx.getString(R.string.m3_api_provider),
                R.style.TextAppearance_M3_LabelSmall);
        l.setTextColor(M3.color(ctx, R.color.md_on_surface_variant));
        col.addView(l);

        providerValue = M3.text(ctx, providerLabel(provider), R.style.TextAppearance_M3_BodyLarge);
        providerValue.setPadding(0, M3.dp(ctx, 2), 0, 0);
        col.addView(providerValue);
        box.addView(col, new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        TextView arrow = M3.text(ctx, "▾", R.style.TextAppearance_M3_TitleMedium);
        arrow.setTextColor(M3.color(ctx, R.color.md_on_surface_variant));
        box.addView(arrow);

        final View anchor = box;
        box.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showProviderMenu(anchor);
            }
        });
        return box;
    }

    private void showProviderMenu(View anchor) {
        PopupMenu pm = new PopupMenu(ctx, anchor);
        for (int i = 0; i < providers.length; i++) {
            // ⚠ itemId 直接存下标：用 label 当 id 的话，两家同名（或改名）就选错了
            pm.getMenu().add(0, i, i, providers[i][1]);
        }
        pm.setOnMenuItemClickListener(new PopupMenu.OnMenuItemClickListener() {
            @Override
            public boolean onMenuItemClick(MenuItem item) {
                int idx = item.getItemId();
                if (idx < 0 || idx >= providers.length) return false;
                pickProvider(idx);
                return true;
            }
        });
        pm.show();
    }

    private void pickProvider(int idx) {
        provider = providers[idx][0];
        // 换服务商时把接口地址跟着换成它的默认值 —— 但**只在地址是空的、
        // 或者正好等于另一个服务商的默认地址**时才换，用户自己填过的别覆盖
        String def = providers[idx].length > 2 ? providers[idx][2] : null;
        if (def != null && def.length() > 0) {
            String cur = baseUrl.getText().toString().trim();
            if (cur.length() == 0 || isDefaultUrl(cur)) baseUrl.setText(def);
        }
        if (providerValue != null) providerValue.setText(providerLabel(provider));
    }

    /** 当前服务商显示的名字。查不到就原样显示 id —— 别显示空白让人以为没选。 */
    private String providerLabel(String id) {
        for (String[] p : providers) {
            if (p[0].equals(id)) return p[1];
        }
        return id;
    }

    private boolean isDefaultUrl(String u) {
        for (String[] p : providers) {
            if (p[2] != null && p[2].equals(u)) return true;
        }
        return false;
    }

    // ────────────────────────── 数据 ──────────────────────────

    @Override
    public void refresh() {
        // 1) 服务商清单：优先用页面推过来的那份
        String pj = store.get(K_PROVIDERS, null);
        if (pj != null) {
            try {
                JSONArray a = new JSONArray(pj);
                String[][] list = new String[a.length()][];
                for (int i = 0; i < a.length(); i++) {
                    JSONArray e = a.optJSONArray(i);
                    if (e == null || e.length() < 2) continue;
                    list[i] = new String[]{
                            e.optString(0),
                            e.optString(1),
                            e.length() > 2 ? e.optString(2) : ""};
                }
                if (list.length > 0 && list[0] != null) providers = list;
            } catch (Exception ignore) {
            }
        }

        // 2) 配置本体
        String raw = store.get("apiGlobalCfg", null);
        orig = null;
        if (raw != null && raw.length() > 0) {
            try {
                orig = new JSONObject(raw);
            } catch (Exception ignore) {
            }
        }
        JSONObject o = orig != null ? orig : new JSONObject();

        provider = o.optString("provider", "openai");
        baseUrl.setText(o.optString("baseUrl", ""));
        apiKey.setText(o.optString("apiKey", ""));
        model.setText(o.optString("model", ""));
        maxTokens.setText(String.valueOf(o.optInt("maxTokens", 1024)));
        double t = o.optDouble("temperature", 0.7);
        temp.setProgress((int) Math.round(t * 10));
        tempVal.setText(String.format(java.util.Locale.US, "%.1f", t));
        stream.setChecked(o.optBoolean("stream", true));

        if (providerValue != null) providerValue.setText(providerLabel(provider));
    }

    private void save() {
        try {
            JSONObject o = orig != null ? new JSONObject(orig.toString()) : new JSONObject();
            o.put("provider", provider);
            o.put("baseUrl", baseUrl.getText().toString().trim());
            o.put("apiKey", apiKey.getText().toString().trim());
            o.put("model", model.getText().toString().trim());
            o.put("temperature", Math.round(temp.getProgress()) / 10.0);
            String mt = maxTokens.getText().toString().trim();
            o.put("maxTokens", mt.length() == 0 ? 1024 : Integer.parseInt(mt));
            o.put("stream", stream.isChecked());

            String json = o.toString();
            store.put("apiGlobalCfg", json);
            orig = o;

            // 回推网页（网页还活着才有效）
            MainActivity.pushToWeb("apiGlobalCfg", json);
            Toast.makeText(ctx, ctx.getString(R.string.m3_api_saved), Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            Toast.makeText(ctx, "保存失败：" + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    @Override
    public void onLeave() {
    }
}
