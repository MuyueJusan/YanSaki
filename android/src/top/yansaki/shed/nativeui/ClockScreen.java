package top.yansaki.shed.nativeui;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

import top.yansaki.shed.R;

/**
 * 时钟 / 世界时间（原生）。
 *
 * <p>⚠ 时间一律走 {@link TimeZone} + {@link SimpleDateFormat}，<b>不</b>在 Java 里手算
 * 时区偏移 —— 手算会在夏令时切换的那两周错一小时，而且只在特定时区复现。
 *
 * <p>⚠ 秒针靠 {@link Handler} 每秒刷一次，必须在 {@link #onLeave()} 里停掉：
 * 不停的话离开这一屏之后它还在跑，Activity 销毁后继续持有 View ⇒ 泄漏 + 后台耗电。
 */
public class ClockScreen implements Screen {

    /** 世界时间那几格。⚠ 加一格就在这里加，别在 UI 里另写一份。 */
    private static final String[][] ZONES = {
            {"东京", "Asia/Tokyo"},
            {"纽约", "America/New_York"},
            {"伦敦", "Europe/London"},
            {"洛杉矶", "America/Los_Angeles"},
    };

    private final Context ctx;

    private TextView bigTime;
    private TextView bigDate;
    private TextView zoneName;
    private LinearLayout rows;
    private LinearLayout chipRow;

    private int picked = -1;          // -1 = 本地
    private Handler ticker;
    private Runnable tick;

    public ClockScreen(Context c) {
        this.ctx = c;
    }

    @Override
    public String title() {
        return "时钟";
    }

    @Override
    public String kicker() {
        return "Material 3 · Expressive";
    }

    @Override
    public View build() {
        ScrollView sv = new ScrollView(ctx);
        sv.setFillViewport(true);
        sv.setClipToPadding(false);
        int p = M3.dp(ctx, 20);
        sv.setPadding(p, 0, p, M3.dp(ctx, 28));

        LinearLayout col = new LinearLayout(ctx);
        col.setOrientation(LinearLayout.VERTICAL);
        sv.addView(col, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        // ── 大时钟 ──
        LinearLayout hero = M3.card(ctx);
        hero.setPadding(M3.dp(ctx, 22), M3.dp(ctx, 24), M3.dp(ctx, 22), M3.dp(ctx, 24));

        zoneName = M3.text(ctx, "", R.style.TextAppearance_M3_LabelMedium);
        zoneName.setTextColor(M3.color(ctx, R.color.md_primary));
        zoneName.setLetterSpacing(0.1f);
        zoneName.setAllCaps(true);
        hero.addView(zoneName);

        bigTime = M3.text(ctx, "00:00", R.style.TextAppearance_M3_DisplayLarge);
        bigTime.setPadding(0, M3.dp(ctx, 4), 0, 0);
        // ⚠ 等宽数字：不等宽的话秒数跳动时整行会左右抖
        bigTime.setTypeface(android.graphics.Typeface.MONOSPACE);
        bigTime.setTextSize(52f);
        hero.addView(bigTime);

        bigDate = M3.text(ctx, "", R.style.TextAppearance_M3_TitleMedium);
        bigDate.setTextColor(M3.color(ctx, R.color.md_on_surface_variant));
        bigDate.setPadding(0, M3.dp(ctx, 6), 0, 0);
        hero.addView(bigDate);

        col.addView(hero);

        // ── 世界时间 ──
        col.addView(M3.section(ctx, "世界时间"));

        chipRow = new LinearLayout(ctx);
        chipRow.setOrientation(LinearLayout.HORIZONTAL);
        HorizontalScrollView hs = new HorizontalScrollView(ctx);
        hs.setHorizontalScrollBarEnabled(false);
        hs.setClipToPadding(false);
        hs.addView(chipRow, new HorizontalScrollView.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        col.addView(hs);

        buildChips();

        rows = new LinearLayout(ctx);
        rows.setOrientation(LinearLayout.VERTICAL);
        col.addView(rows, M3.gap(ctx, 12));

        col.addView(M3.hint(ctx, ctx.getString(R.string.m3_clock_hint)));

        refresh();
        return sv;
    }

    private void buildChips() {
        chipRow.removeAllViews();
        addChip(ctx.getString(R.string.m3_clock_local), -1);
        for (int i = 0; i < ZONES.length; i++) addChip(ZONES[i][0], i);
    }

    private void addChip(String label, final int idx) {
        boolean on = idx == picked;
        TextView c = M3.text(ctx, label, R.style.TextAppearance_M3_LabelLarge);
        c.setBackgroundResource(on ? R.drawable.bg_m3_chip_on : R.drawable.bg_m3_chip);
        c.setTextColor(M3.color(ctx, on
                ? R.color.md_on_secondary_container : R.color.md_on_surface));
        c.setPadding(M3.dp(ctx, 16), M3.dp(ctx, 9), M3.dp(ctx, 16), M3.dp(ctx, 9));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.rightMargin = M3.dp(ctx, 8);
        c.setLayoutParams(lp);
        c.setClickable(true);
        c.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                picked = idx;
                buildChips();
                render();
            }
        });
        chipRow.addView(c);
    }

    @Override
    public void refresh() {
        render();
        if (ticker == null) {
            ticker = new Handler(Looper.getMainLooper());
            tick = new Runnable() {
                @Override
                public void run() {
                    render();
                    if (ticker != null) ticker.postDelayed(this, 1000L);
                }
            };
            ticker.postDelayed(tick, 1000L);
        }
    }

    private TimeZone zoneOf(int idx) {
        if (idx < 0) return TimeZone.getDefault();
        return TimeZone.getTimeZone(ZONES[idx][1]);
    }

    private String nameOf(int idx) {
        if (idx < 0) return ctx.getString(R.string.m3_clock_local);
        return ZONES[idx][0];
    }

    private void render() {
        if (bigTime == null) return;

        TimeZone tz = zoneOf(picked);
        Date now = new Date();

        SimpleDateFormat hm = new SimpleDateFormat("HH:mm:ss", Locale.getDefault());
        hm.setTimeZone(tz);
        bigTime.setText(hm.format(now));

        SimpleDateFormat dt = new SimpleDateFormat("yyyy年M月d日 EEEE", Locale.CHINA);
        dt.setTimeZone(tz);
        bigDate.setText(dt.format(now));

        zoneName.setText(nameOf(picked));

        // 世界时间清单：每次都重画（行数固定 4，开销可以忽略）
        rows.removeAllViews();
        SimpleDateFormat hh = new SimpleDateFormat("HH:mm", Locale.getDefault());
        for (int i = 0; i < ZONES.length; i++) {
            hh.setTimeZone(zoneOf(i));
            LinearLayout r = new LinearLayout(ctx);
            r.setOrientation(LinearLayout.HORIZONTAL);
            r.setGravity(Gravity.CENTER_VERTICAL);
            r.setPadding(M3.dp(ctx, 6), M3.dp(ctx, 7), M3.dp(ctx, 6), M3.dp(ctx, 7));

            TextView name = M3.text(ctx, ZONES[i][0], R.style.TextAppearance_M3_BodyLarge);
            r.addView(name, new LinearLayout.LayoutParams(
                    0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

            TextView t = M3.text(ctx, hh.format(now), R.style.TextAppearance_M3_TitleMedium);
            t.setTypeface(android.graphics.Typeface.MONOSPACE);
            r.addView(t);

            rows.addView(r);
        }
    }

    @Override
    public void onLeave() {
        if (ticker != null) {
            ticker.removeCallbacksAndMessages(null);
            ticker = null;
            tick = null;
        }
    }
}
