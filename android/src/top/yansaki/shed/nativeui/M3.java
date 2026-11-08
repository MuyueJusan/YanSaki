package top.yansaki.shed.nativeui;

import android.content.Context;
import android.graphics.Color;
import android.util.TypedValue;
import android.view.View;
import android.view.ViewGroup;
import android.view.animation.OvershootInterpolator;
import android.widget.LinearLayout;
import android.widget.TextView;

import top.yansaki.shed.R;

/**
 * Material 3 Expressive 的小工具箱。
 *
 * <p>⚠⚠ 这个类存在的理由：本项目**不引 AndroidX / Material 库**（构建链是
 * aapt2 → javac → d8，见 {@code res/values/styles.xml} 顶部）。所以 M3 里那些
 * 一行就能拿到的能力（dp、色角色、字阶、涟漪、弹簧动效、卡片）全部要自己写。
 *
 * <p>⚠ 只放**真正被两处以上用到**的东西。只在一屏里用一次的布局，写在那屏里，
 * 别往这里堆 —— 否则这里会变成第二个「什么都往里塞」的工具箱。
 */
public final class M3 {

    private M3() {
    }

    /** dp → px。M3 的间距/圆角/字号全是 dp/sp，代码里也一律用 dp 思考。 */
    public static int dp(Context c, float v) {
        return Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, v, c.getResources().getDisplayMetrics()));
    }

    public static int sp(Context c, float v) {
        return Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_SP, v, c.getResources().getDisplayMetrics()));
    }

    public static int color(Context c, int res) {
        return c.getColor(res);
    }

    /** 按 M3 字阶造一个 TextView。{@code style} 传 {@code R.style.TextAppearance_M3_*}。 */
    public static TextView text(Context c, CharSequence s, int style) {
        TextView t = new TextView(c);
        t.setText(s);
        if (style != 0) t.setTextAppearance(style);
        t.setIncludeFontPadding(false);
        return t;
    }

    /**
     * 段落小标题（M3 的 section header）：primary 色 + labelLarge + 上留白。
     * ⚠ 用 primary 而不是 onSurfaceVariant —— Expressive 靠这种小面积高饱和做节奏，
     * 全用中性色会显得整页是灰的。
     */
    public static TextView section(Context c, CharSequence s) {
        TextView t = text(c, s, R.style.TextAppearance_M3_LabelLarge);
        t.setTextColor(color(c, R.color.md_primary));
        t.setPadding(dp(c, 4), dp(c, 22), 0, dp(c, 8));
        return t;
    }

    /** 说明文字：bodySmall + onSurfaceVariant，左侧和卡片内容对齐。 */
    public static TextView hint(Context c, CharSequence s) {
        TextView t = text(c, s, R.style.TextAppearance_M3_BodySmall);
        t.setPadding(dp(c, 4), dp(c, 6), dp(c, 4), dp(c, 2));
        return t;
    }

    /** M3 filled card：28dp 圆角 + surfaceContainerLow + 极轻阴影。 */
    public static LinearLayout card(Context c) {
        LinearLayout l = new LinearLayout(c);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setBackgroundResource(R.drawable.bg_m3_card);
        l.setElevation(dp(c, 1));
        int p = dp(c, 18);
        l.setPadding(p, p, p, p);
        return l;
    }

    /** 一条 1dp 的分隔线（M3 用 outlineVariant，比纯黑 10% 更协调）。 */
    public static View divider(Context c) {
        View v = new View(c);
        v.setBackgroundColor(color(c, R.color.md_outline_variant));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, Math.max(1, dp(c, 1)));
        lp.topMargin = dp(c, 12);
        lp.bottomMargin = dp(c, 12);
        v.setLayoutParams(lp);
        return v;
    }

    /** 卡片之间的竖向间隔。 */
    public static LinearLayout.LayoutParams gap(Context c, int h) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(c, h);
        return lp;
    }

    /**
     * Expressive 的入场动效：子视图依次「弹上来」。
     *
     * <p>⚠ 用 {@link OvershootInterpolator} 而不是 Decelerate —— Expressive 的位移是
     * **有回弹**的，纯减速看起来像老 M3。回弹幅度压在 0.9，再大就会「晃」。
     *
     * <p>⚠ 必须先 {@code setAlpha(0)} 再 animate：只设 translationY 的话，
     * 动画开始前那一帧是全不透明的，会闪一下。
     */
    public static void staggerIn(ViewGroup g) {
        Context c = g.getContext();
        for (int i = 0; i < g.getChildCount(); i++) {
            final View v = g.getChildAt(i);
            v.setAlpha(0f);
            v.setTranslationY(dp(c, 18));
            v.animate()
                    .alpha(1f)
                    .translationY(0f)
                    .setStartDelay(60L + i * 45L)
                    .setDuration(420)
                    .setInterpolator(new OvershootInterpolator(0.9f))
                    .start();
        }
    }

    /** 单个视图的「弹出来」，用于切页。 */
    public static void popIn(View v) {
        Context c = v.getContext();
        v.setAlpha(0f);
        v.setTranslationY(dp(c, 12));
        v.setScaleX(0.97f);
        v.setScaleY(0.97f);
        v.animate()
                .alpha(1f).translationY(0f).scaleX(1f).scaleY(1f)
                .setDuration(320)
                .setInterpolator(new OvershootInterpolator(0.8f))
                .start();
    }

    /** 16 进制颜色 + 透明度，用于「同一颜色的不同深浅」（Expressive 常用 12%/20% 叠色）。 */
    public static int alpha(int color, float a) {
        return Color.argb(Math.round(255 * Math.max(0f, Math.min(1f, a))),
                Color.red(color), Color.green(color), Color.blue(color));
    }
}
