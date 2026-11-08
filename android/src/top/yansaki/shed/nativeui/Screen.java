package top.yansaki.shed.nativeui;

import android.view.View;

/**
 * 原生界面里的一屏。
 *
 * <p>⚠ 刻意做成「一次 build、之后只 refresh」的形状：{@code build} 只在第一次进这一屏时
 * 调一次，切走再切回来只调 {@link #refresh()}。这样切页不会丢滚动位置、也不会
 * 把输入框里没保存的内容抹掉 —— 那两件事都是「切个页回来东西没了」的经典来源。
 */
public interface Screen {

    /** 大标题（M3 large top app bar 的那一行）。 */
    String title();

    /** 标题上方那行小字（labelMedium，primary 色）。可为 null。 */
    String kicker();

    /** 造这一屏的根视图。只调一次。 */
    View build();

    /** 回到这一屏时刷新数据。可为空实现。 */
    void refresh();

    /** 离开这一屏时收尾（停定时器之类）。 */
    void onLeave();
}
