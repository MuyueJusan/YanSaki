package top.yansaki.shed.nativeui;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONObject;

import top.yansaki.shed.MainActivity;
import top.yansaki.shed.R;

/**
 * 设置 / 关于（原生）。
 *
 * <p>⚠ 这一屏有一半是「诚实清单」：还没迁成原生的功能在这里**明写出来**，并给一个
 * 直接跳过去的入口。比装作已经迁完、让用户在新界面里找不到功能要好得多。
 * 迁完一个就删一条 —— 这个清单应该越来越短。
 */
public class SettingsScreen implements Screen {

    private final Context ctx;
    private final Store store;

    private TextView mirrorVal;
    private TextView apiSummaryView;

    public SettingsScreen(Context c) {
        this.ctx = c;
        this.store = Store.get(c);
    }

    @Override
    public String title() {
        return "设置";
    }

    @Override
    public String kicker() {
        return "关于与入口";
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

        // ── 接口（二级页入口）──
        // ⚠ v1.8 起「接口」不再占底部导航：它配置一次就不常动，
        //   占一格导航不值；而「对话 / 时钟 / 设置」是天天用的。
        col.addView(M3.section(ctx, ctx.getString(R.string.m3_set_section_api)));
        LinearLayout c0 = M3.card(ctx);
        c0.setPadding(M3.dp(ctx, 8), M3.dp(ctx, 8), M3.dp(ctx, 8), M3.dp(ctx, 8));
        c0.addView(apiEntry());
        col.addView(c0, M3.gap(ctx, 8));

        // ── 关于 ──
        col.addView(M3.section(ctx, ctx.getString(R.string.m3_set_section_about)));
        LinearLayout c1 = M3.card(ctx);
        c1.addView(row(ctx.getString(R.string.m3_set_version), version()));
        c1.addView(M3.divider(ctx));
        mirrorVal = M3.text(ctx, "", R.style.TextAppearance_M3_TitleMedium);
        c1.addView(rowWith(ctx.getString(R.string.m3_set_mirror), mirrorVal));
        col.addView(c1, M3.gap(ctx, 8));

        // ── 外观 ──
        col.addView(M3.section(ctx, ctx.getString(R.string.m3_set_section_theme)));
        LinearLayout c2 = M3.card(ctx);
        TextView tn = M3.text(ctx, ctx.getString(R.string.m3_set_theme_note),
                R.style.TextAppearance_M3_BodyMedium);
        c2.addView(tn);
        col.addView(c2, M3.gap(ctx, 8));

        // ── 还没迁过来的功能 ──
        col.addView(M3.section(ctx, ctx.getString(R.string.m3_set_section_legacy)));
        col.addView(M3.hint(ctx, ctx.getString(R.string.m3_set_legacy_hint)));

        LinearLayout c3 = M3.card(ctx);
        c3.setPadding(M3.dp(ctx, 8), M3.dp(ctx, 8), M3.dp(ctx, 8), M3.dp(ctx, 8));

        // ⚠ 「🤖 AI 对话」已经从这份清单里删掉了 —— 它 v1.7 起是原生的一屏（底部导航第一项）。
        //   「🃏 角色卡编写器」v1.9 起也进了底部导航（16 个选项卡里 8 个已原生，
        //   剩下 8 个在那几页里各自有「在旧界面打开」的入口）。
        //   规矩是「迁完一个就删一条」，留着会让人以为还得回旧界面才能用。
        c3.addView(legacyItem(ctx.getString(R.string.m3_set_open_games), "openCatGame()"));
        col.addView(c3, M3.gap(ctx, 8));

        // ── 回旧界面 ──
        TextView back = M3.text(ctx, ctx.getString(R.string.m3_set_open_old),
                R.style.TextAppearance_M3_LabelLarge);
        back.setBackgroundResource(R.drawable.bg_m3_btn_tonal);
        back.setTextColor(M3.color(ctx, R.color.md_on_secondary_container));
        back.setGravity(Gravity.CENTER);
        back.setClickable(true);
        back.setFocusable(true);
        LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, M3.dp(ctx, 52));
        blp.topMargin = M3.dp(ctx, 20);
        back.setLayoutParams(blp);
        back.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                MainActivity.setPendingJs(null);
                ((NativeShellActivity) ctx).finish();
            }
        });
        col.addView(back);

        refresh();
        return sv;
    }

    /**
     * 「接口配置」那一行 —— 点进去是二级页（{@link ApiScreen}）。
     *
     * <p>⚠ 用 {@code openDetail} 而不是 startActivity：新界面只有一套 scaffold，
     * 二级页要复用同一个顶栏（带返回箭头）与动效，另起一个 Activity 会闪一下、
     * 而且返回时状态全丢。
     */
    private View apiEntry() {
        LinearLayout row = new LinearLayout(ctx);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setBackgroundResource(R.drawable.bg_m3_list_item);
        row.setClickable(true);
        row.setFocusable(true);
        int p = M3.dp(ctx, 14);
        row.setPadding(p, p, p, p);
        row.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                ((NativeShellActivity) ctx).openDetail(new ApiScreen(ctx));
            }
        });

        LinearLayout col = new LinearLayout(ctx);
        col.setOrientation(LinearLayout.VERTICAL);
        col.addView(M3.text(ctx, ctx.getString(R.string.m3_set_api_row),
                R.style.TextAppearance_M3_BodyLarge));
        apiSummaryView = M3.text(ctx, "", R.style.TextAppearance_M3_BodySmall);
        apiSummaryView.setPadding(0, M3.dp(ctx, 2), 0, 0);
        col.addView(apiSummaryView);
        row.addView(col, new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        TextView chev = M3.text(ctx, "›", R.style.TextAppearance_M3_TitleLarge);
        chev.setTextColor(M3.color(ctx, R.color.md_on_surface_variant));
        row.addView(chev);
        return row;
    }

    /** 摘要：服务商 · 模型。读不到就写「还没配」，别显示空白让人以为坏了。 */
    private String apiSummary() {
        String raw = store.get("apiGlobalCfg", null);
        if (raw == null) return ctx.getString(R.string.m3_set_api_none);
        try {
            JSONObject o = new JSONObject(raw);
            String prov = o.optString("provider", "");
            String model = o.optString("model", "");
            if (prov.length() == 0 && model.length() == 0) {
                return ctx.getString(R.string.m3_set_api_none);
            }
            return prov + (model.length() > 0 ? " · " + model : "");
        } catch (Exception e) {
            return ctx.getString(R.string.m3_set_api_none);
        }
    }

    private View row(String label, String value) {
        TextView v = M3.text(ctx, value, R.style.TextAppearance_M3_TitleMedium);
        return rowWith(label, v);
    }

    private View rowWith(String label, TextView value) {
        LinearLayout r = new LinearLayout(ctx);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setGravity(Gravity.CENTER_VERTICAL);
        r.setPadding(0, M3.dp(ctx, 6), 0, M3.dp(ctx, 6));
        TextView l = M3.text(ctx, label, R.style.TextAppearance_M3_BodyLarge);
        l.setTextColor(M3.color(ctx, R.color.md_on_surface_variant));
        r.addView(l, new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        r.addView(value);
        return r;
    }

    private View legacyItem(String label, final String js) {
        TextView t = M3.text(ctx, label, R.style.TextAppearance_M3_BodyLarge);
        t.setBackgroundResource(R.drawable.bg_m3_list_item);
        t.setPadding(M3.dp(ctx, 14), M3.dp(ctx, 14), M3.dp(ctx, 14), M3.dp(ctx, 14));
        t.setClickable(true);
        t.setFocusable(true);
        t.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                MainActivity.setPendingJs(js);
                ((NativeShellActivity) ctx).finish();
            }
        });
        return t;
    }

    private String version() {
        try {
            PackageInfo pi = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            return pi.versionName == null ? "?" : pi.versionName;
        } catch (Exception e) {
            return "?";
        }
    }

    @Override
    public void refresh() {
        if (mirrorVal != null) mirrorVal.setText(String.valueOf(store.count()));
        // ⚠ 从「接口配置」退回来时会走到这里 —— 摘要要跟着变，
        //   否则刚改完服务商、设置页还写着旧的那个。
        if (apiSummaryView != null) apiSummaryView.setText(apiSummary());
    }

    @Override
    public void onLeave() {
    }
}
