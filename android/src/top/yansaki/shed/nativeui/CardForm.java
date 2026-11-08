package top.yansaki.shed.nativeui;

import android.content.Context;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import top.yansaki.shed.R;

/**
 * 编写器用的表单控件：M3 outlined field / 多行域 / 芯片组 / 按钮。
 *
 * <p>⚠ 这些控件都**绑一个回调**，用户一改就往回调里送值。编写器是「边打边存」的，
 * 没有「保存」按钮 —— 那正是最容易丢东西的形态（用户以为自动存了，其实没有）。
 *
 * <p>⚠⚠ 回调必须在 {@code setText} **之后**才挂上：先挂后设会让「初始化」被当成
 * 「用户改了」，一进页面就把 dirty 置上、并且把默认值写回存储。
 */
public final class CardForm {

    /** 值变化回调。 */
    public interface OnText {
        void onText(String v);
    }

    private CardForm() {
    }

    private static final class Watcher implements TextWatcher {
        private final OnText cb;

        Watcher(OnText cb) {
            this.cb = cb;
        }

        @Override
        public void beforeTextChanged(CharSequence s, int a, int b, int c) {
        }

        @Override
        public void onTextChanged(CharSequence s, int a, int b, int c) {
        }

        @Override
        public void afterTextChanged(Editable s) {
            cb.onText(s == null ? "" : s.toString());
        }
    }

    /** 单行输入。返回外层容器（要拿 EditText 用 {@link #editOf}）。 */
    public static LinearLayout field(Context c, String label, String value, OnText cb) {
        return build(c, label, value, 1, cb, false);
    }

    /** 多行输入。{@code minLines} 是**最少显示几行**，不是最大。 */
    public static LinearLayout area(Context c, String label, String value, int minLines, OnText cb) {
        return build(c, label, value, minLines, cb, true);
    }

    private static LinearLayout build(Context c, String label, String value,
                                      int lines, OnText cb, boolean multi) {
        LinearLayout wrap = new LinearLayout(c);
        wrap.setOrientation(LinearLayout.VERTICAL);
        wrap.setBackgroundResource(R.drawable.bg_m3_field);
        wrap.setPadding(M3.dp(c, 14), M3.dp(c, 8), M3.dp(c, 14), M3.dp(c, 8));

        TextView l = M3.text(c, label, R.style.TextAppearance_M3_LabelSmall);
        l.setTextColor(M3.color(c, R.color.md_on_surface_variant));
        wrap.addView(l);

        EditText et = new EditText(c);
        et.setTextAppearance(R.style.TextAppearance_M3_BodyLarge);
        et.setBackground(null);
        et.setPadding(0, M3.dp(c, 2), 0, 0);
        et.setText(value == null ? "" : value);
        if (multi) {
            et.setInputType(InputType.TYPE_CLASS_TEXT
                    | InputType.TYPE_TEXT_FLAG_MULTI_LINE
                    | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
            et.setMinLines(lines);
            et.setGravity(Gravity.TOP | Gravity.START);
        } else {
            et.setInputType(InputType.TYPE_CLASS_TEXT);
            et.setSingleLine(true);
        }
        wrap.addView(et, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        // ⚠ 顺序：先 setText 再挂 watcher（见类注释）
        if (cb != null) et.addTextChangedListener(new Watcher(cb));
        return wrap;
    }

    /** 从 {@link #field} / {@link #area} 的返回值里取出 EditText（子 0 是 label，子 1 是输入框）。 */
    public static EditText editOf(View wrap) {
        if (wrap instanceof ViewGroup) {
            ViewGroup g = (ViewGroup) wrap;
            for (int i = 0; i < g.getChildCount(); i++) {
                if (g.getChildAt(i) instanceof EditText) return (EditText) g.getChildAt(i);
            }
        }
        return null;
    }

    /**
     * 芯片组（单选）。{@code ids} 与 {@code labels} 一一对应；{@code sel} 是当前选中的 id。
     */
    public static View chips(Context c, String label, final String[] ids, final String[] labels,
                             String sel, final OnText cb) {
        LinearLayout box = new LinearLayout(c);
        box.setOrientation(LinearLayout.VERTICAL);

        if (label != null) {
            TextView l = M3.text(c, label, R.style.TextAppearance_M3_LabelMedium);
            l.setPadding(0, 0, 0, M3.dp(c, 8));
            box.addView(l);
        }

        final LinearLayout row = new LinearLayout(c);
        row.setOrientation(LinearLayout.HORIZONTAL);
        android.widget.HorizontalScrollView hs = new android.widget.HorizontalScrollView(c);
        hs.setHorizontalScrollBarEnabled(false);
        hs.addView(row, new android.widget.HorizontalScrollView.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        box.addView(hs);

        final String[] cur = {sel};
        for (int i = 0; i < ids.length; i++) {
            final String id = ids[i];
            final TextView chip = M3.text(c, labels[i], R.style.TextAppearance_M3_LabelLarge);
            chip.setPadding(M3.dp(c, 14), M3.dp(c, 9), M3.dp(c, 14), M3.dp(c, 9));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.rightMargin = M3.dp(c, 8);
            chip.setLayoutParams(lp);
            chip.setClickable(true);
            chip.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    cur[0] = id;
                    for (int k = 0; k < row.getChildCount(); k++) {
                        TextView t = (TextView) row.getChildAt(k);
                        boolean on = id.equals(ids[k]);
                        t.setBackgroundResource(on ? R.drawable.bg_m3_chip_on : R.drawable.bg_m3_chip);
                        t.setTextColor(M3.color(c, on
                                ? R.color.md_on_secondary_container : R.color.md_on_surface));
                    }
                    cb.onText(id);
                }
            });
            boolean on = id.equals(sel);
            chip.setBackgroundResource(on ? R.drawable.bg_m3_chip_on : R.drawable.bg_m3_chip);
            chip.setTextColor(M3.color(c, on
                    ? R.color.md_on_secondary_container : R.color.md_on_surface));
            row.addView(chip);
        }
        return box;
    }

    /** M3 按钮（filled / tonal / outlined / text）。 */
    public static TextView button(Context c, String label, int kind, View.OnClickListener l) {
        TextView b = M3.text(c, label, R.style.TextAppearance_M3_LabelLarge);
        int bg = R.drawable.bg_m3_btn_filled;
        int fg = R.color.md_on_primary;
        if (kind == 1) {
            bg = R.drawable.bg_m3_btn_tonal;
            fg = R.color.md_on_secondary_container;
        } else if (kind == 2) {
            bg = R.drawable.bg_m3_btn_outlined;
            fg = R.color.md_primary;
        } else if (kind == 3) {
            bg = R.drawable.bg_m3_btn_text;
            fg = R.color.md_primary;
        }
        b.setBackgroundResource(bg);
        b.setTextColor(M3.color(c, fg));
        b.setGravity(Gravity.CENTER);
        b.setClickable(true);
        b.setFocusable(true);
        b.setPadding(M3.dp(c, 18), 0, M3.dp(c, 18), 0);
        b.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, M3.dp(c, 48)));
        b.setOnClickListener(l);
        return b;
    }

    /** 一行说明文字（bodySmall）。 */
    public static TextView note(Context c, String s) {
        TextView t = M3.text(c, s, R.style.TextAppearance_M3_BodySmall);
        t.setPadding(M3.dp(c, 2), M3.dp(c, 6), M3.dp(c, 2), 0);
        return t;
    }
}
