package top.yansaki.shed.nativeui;

import android.app.Activity;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.animation.OvershootInterpolator;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import top.yansaki.shed.MainActivity;
import top.yansaki.shed.R;

/**
 * 「新界面」—— APK 专属的原生 Material 3 Expressive 壳。
 *
 * <p>⚠⚠ 这一整套<b>只存在于 APK</b>：它在 {@code android/} 里，网页版（{@code main} 分支的
 * {@code saki.html}）一个字节都没有。入口是在网页版左上那个下拉菜单里注入的
 * 「✨ 新界面」按钮（见 {@code shim/native-entry.js}）。
 *
 * <p>结构照 M3 的 scaffold：
 * <pre>
 *   ┌───────────────────────────┐
 *   │ kicker（labelMedium/primary）│  ← 小字
 *   │ 大标题（headlineMedium）     │  ← large top app bar
 *   ├───────────────────────────┤
 *   │                           │
 *   │      内容区（可滚动）        │
 *   │                           │
 *   ├───────────────────────────┤
 *   │  ◉ 时钟    ○ 接口   ○ 设置  │  ← navigation bar（药丸指示器）
 *   └───────────────────────────┘
 * </pre>
 *
 * <p>⚠ 底部导航是**手搓的**：框架里没有 BottomNavigationView（那是 Material Components 的），
 * 所以用 LinearLayout + 一块 {@code bg_m3_nav_indicator} 药丸拼出来。选中态三件事一起变：
 * 指示器出现、图标换 onSecondaryContainer、文字换 onSurface —— 只改其中一件会显得「没选中」。
 */
public class NativeShellActivity extends Activity {

    private TextView kickerView;
    private TextView titleView;
    private FrameLayout content;
    private LinearLayout navbar;

    private Screen[] screens;
    private final NavItem[] items = new NavItem[3];
    /** 每一屏建好的视图，只建一次。⚠ 见 {@link #select} 里的注释。 */
    private final View[] built = new View[3];
    private int current = -1;

    /** 导航条上的一项。 */
    private static final class NavItem {
        View root;
        View indicator;
        TextView icon;
        TextView label;
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);

        screens = new Screen[]{
                new ClockScreen(this),
                new ApiScreen(this),
                new SettingsScreen(this)
        };

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(M3.color(this, R.color.md_surface));

        root.addView(buildAppBar(), new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        content = new FrameLayout(this);
        LinearLayout.LayoutParams clp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
        root.addView(content, clp);

        root.addView(buildNavBar(), new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, M3.dp(this, 80)));

        setContentView(root);
        select(0);
    }

    // ────────────────────────── 顶栏 ──────────────────────────

    private View buildAppBar() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.VERTICAL);
        int l = M3.dp(this, 22), t = M3.dp(this, 14), r = M3.dp(this, 22), bt = M3.dp(this, 10);
        bar.setPadding(l, t, r, bt);

        kickerView = M3.text(this, "", R.style.TextAppearance_M3_LabelMedium);
        kickerView.setTextColor(M3.color(this, R.color.md_primary));
        kickerView.setLetterSpacing(0.12f);
        kickerView.setAllCaps(true);
        bar.addView(kickerView);

        titleView = M3.text(this, "", R.style.TextAppearance_M3_HeadlineMedium);
        titleView.setPadding(0, M3.dp(this, 2), 0, 0);
        bar.addView(titleView);

        return bar;
    }

    // ────────────────────────── 底部导航 ──────────────────────────

    private View buildNavBar() {
        LinearLayout wrap = new LinearLayout(this);
        wrap.setOrientation(LinearLayout.VERTICAL);
        wrap.setBackgroundColor(M3.color(this, R.color.md_surface_container));

        View line = new View(this);
        line.setBackgroundColor(M3.color(this, R.color.md_outline_variant));
        wrap.addView(line, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, Math.max(1, M3.dp(this, 1))));

        navbar = new LinearLayout(this);
        navbar.setOrientation(LinearLayout.HORIZONTAL);
        navbar.setGravity(Gravity.CENTER_VERTICAL);

        String[] icons = {"🕒", "🔌", "⚙️"};
        String[] labels = {
                getString(R.string.m3_nav_clock),
                getString(R.string.m3_nav_api),
                getString(R.string.m3_nav_settings)
        };

        for (int i = 0; i < icons.length; i++) {
            final int idx = i;
            NavItem it = new NavItem();

            LinearLayout item = new LinearLayout(this);
            item.setOrientation(LinearLayout.VERTICAL);
            item.setGravity(Gravity.CENTER);
            item.setClickable(true);
            item.setFocusable(true);
            item.setBackgroundResource(R.drawable.bg_m3_list_item);
            // ⚠ 这里**不能**用 lambda：javac 的 `-target 8` 会把 lambda 编成 invokedynamic，
            //   而 `java.lang.invoke.LambdaMetafactory` 不在 android.jar 里 ⇒
            //   `错误: 找不到符号 方法 metafactory(...)`，整个包编不出来。
            //   （2026-11-08 踩过：报错还被 grep 吞了，APK 拿旧代码照发。）
            item.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    select(idx);
                }
            });
            item.setLayoutParams(new LinearLayout.LayoutParams(0,
                    ViewGroup.LayoutParams.MATCH_PARENT, 1f));

            FrameLayout ind = new FrameLayout(this);
            ind.setBackgroundResource(R.drawable.bg_m3_nav_indicator);
            LinearLayout.LayoutParams ilp = new LinearLayout.LayoutParams(
                    M3.dp(this, 64), M3.dp(this, 32));
            item.addView(ind, ilp);

            TextView icon = M3.text(this, icons[i], 0);
            icon.setTextSize(17f);
            icon.setGravity(Gravity.CENTER);
            ind.addView(icon, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

            TextView label = M3.text(this, labels[i], R.style.TextAppearance_M3_LabelMedium);
            LinearLayout.LayoutParams llp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            llp.topMargin = M3.dp(this, 3);
            item.addView(label, llp);

            it.root = item;
            it.indicator = ind;
            it.icon = icon;
            it.label = label;
            items[i] = it;

            navbar.addView(item);
        }

        wrap.addView(navbar, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        return wrap;
    }

    // ────────────────────────── 切页 ──────────────────────────

    private void select(int idx) {
        if (idx == current) return;
        if (current >= 0) screens[current].onLeave();
        current = idx;

        for (int i = 0; i < items.length; i++) {
            NavItem it = items[i];
            boolean on = i == idx;
            it.indicator.setVisibility(on ? View.VISIBLE : View.INVISIBLE);
            it.icon.setTextColor(M3.color(this, on
                    ? R.color.md_on_secondary_container : R.color.md_on_surface_variant));
            it.label.setTextColor(M3.color(this, on
                    ? R.color.md_on_surface : R.color.md_on_surface_variant));
            if (on) {
                // ⚠ 指示器要有「弹出来」的过程：直接 setVisibility 会显得很硬，
                //   而 M3 Expressive 的选中反馈本来就是带弹簧的。
                it.indicator.setScaleX(0.7f);
                it.indicator.setScaleY(0.7f);
                it.indicator.animate().scaleX(1f).scaleY(1f)
                        .setDuration(260)
                        .setInterpolator(new OvershootInterpolator(1.4f))
                        .start();
            }
        }

        kickerView.setText(screens[idx].kicker() == null ? "" : screens[idx].kicker());
        titleView.setText(screens[idx].title());

        content.removeAllViews();
        // ⚠⚠ 视图只建一次，之后复用。
        //   每次切页都 build() 的话，用户在「接口」页填了一半的 Key、切去「设置」看一眼
        //   再切回来，填的东西就没了 —— 而且不报错、看着像「本来就没填」。
        //   （滚动位置同理。）
        if (built[idx] == null) built[idx] = screens[idx].build();
        content.addView(built[idx], new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        M3.popIn(content);
        screens[idx].refresh();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (current >= 0) screens[current].refresh();
    }

    @Override
    protected void onDestroy() {
        for (Screen s : screens) {
            try {
                s.onLeave();
            } catch (Exception ignore) {
            }
        }
        super.onDestroy();
    }

    // ────────────────────────── 与网页互通 ──────────────────────────

    /** 把一条键写回网页的 localStorage（网页还活着才有用；否则只留在镜像里）。 */
    void pushToWeb(String key, String value) {
        MainActivity.pushToWeb(key, value);
    }

    /** 关掉新界面，回到网页界面并执行一段 JS（用于「还没迁过来的功能」）。 */
    void openLegacy(String js) {
        MainActivity.setPendingJs(js);
        finish();
    }
}
