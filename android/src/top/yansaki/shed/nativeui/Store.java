package top.yansaki.shed.nativeui;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.util.Iterator;
import java.util.Map;

/**
 * 原生侧的「网页存储镜像」。
 *
 * <p>⚠⚠ 为什么需要它：网页把一切状态都存在 {@code localStorage} 里，而那是
 * <b>WebView 的存储</b>，原生代码碰不到（它按 origin 存在 WebView 自己的目录里）。
 * 所以这里留一份 <b>镜像</b>：
 * <ul>
 *   <li>页面每次加载完，{@code shim/store-shim.js} 把整份 localStorage 推过来
 *       （{@link #syncAll}）；</li>
 *   <li>页面里任何一次 {@code setItem} / {@code removeItem} 也写穿过来
 *       （{@link #put} / {@link #remove}）；</li>
 *   <li>原生界面只<b>读</b>镜像；写的时候两边都写（镜像 + 回推 WebView），
 *       回推由 {@code MainActivity} 负责，见 {@code NativeShellActivity#pushToWeb}。</li>
 * </ul>
 *
 * <p>⚠ 镜像不是真相源 —— 真相源永远是页面里的 localStorage。所以
 * {@link #syncAll} 是「整份替换」，不是合并：合并会让网页里删掉的键在原生这边
 * 永远留着，然后原生界面显示一堆用户早就删了的东西。
 */
public final class Store {

    private static final String SP = "ys_mirror";

    /**
     * 「原生改了、网页还不知道」的键。
     *
     * <p>⚠ 必须是**另一个** SharedPreferences：镜像那边 {@link #syncAll} 是整份 clear 再写，
     * 混在一起的话页面一加载就把待回灌的改动清掉了 —— 而那个清掉的动作不报错，
     * 表现是「在新界面改的 API Key 回到网页就没了」。
     */
    private static final String SP_PENDING = "ys_pending";

    private static Store inst;

    private final SharedPreferences sp;
    private final SharedPreferences pend;

    private Store(Context c) {
        sp = c.getApplicationContext().getSharedPreferences(SP, Context.MODE_PRIVATE);
        pend = c.getApplicationContext().getSharedPreferences(SP_PENDING, Context.MODE_PRIVATE);
    }

    public static synchronized Store get(Context c) {
        if (inst == null) inst = new Store(c);
        return inst;
    }

    public String get(String k) {
        return sp.getString(k, null);
    }

    public String get(String k, String def) {
        return sp.getString(k, def);
    }

    public void put(String k, String v) {
        sp.edit().putString(k, v).apply();
    }

    public void remove(String k) {
        sp.edit().remove(k).apply();
    }

    public void clearAll() {
        sp.edit().clear().apply();
    }

    /** 镜像里有多少条 —— 设置页用它证明「桥真的通了」，比「应该通了」有用。 */
    public int count() {
        return sp.getAll().size();
    }

    public Map<String, ?> all() {
        return sp.getAll();
    }

    /**
     * 整份替换。页面加载完时调一次。
     *
     * <p>⚠ 解析失败就<b>什么都不做</b>（保留上一份），不要清空 ——
     * 清空会让原生界面突然全空，看起来像「桥坏了」，而真正的原因是这一次的 JSON 有问题。
     */
    public void syncAll(String json) {
        if (json == null || json.length() == 0) return;
        try {
            JSONObject o = new JSONObject(json);
            SharedPreferences.Editor e = sp.edit();
            e.clear();
            Iterator<String> it = o.keys();
            while (it.hasNext()) {
                String k = it.next();
                String v = o.optString(k, "");
                e.putString(k, v);
            }
            e.apply();
        } catch (Exception ignore) {
            // 保留旧镜像
        }
    }

    // ────────────────────────── 待回灌 ──────────────────────────

    /** 网页不在时，把原生的改动记在这里，等它下次加载时灌回去。 */
    public void pendingPut(String k, String v) {
        pend.edit().putString(k, v).apply();
    }

    /**
     * 取走全部待回灌的键（取完即清）。
     *
     * <p>⚠ 是「取」不是「读」：不清的话页面每次加载都会重灌同一批值，
     * 于是用户在网页里改回去的东西下次又被改回来 —— 而且没有任何提示。
     */
    public String pendingTake() {
        JSONObject o = new JSONObject();
        try {
            for (Map.Entry<String, ?> e : pend.getAll().entrySet()) {
                Object v = e.getValue();
                o.put(e.getKey(), v == null ? "" : String.valueOf(v));
            }
        } catch (Exception ignore) {
        }
        pend.edit().clear().apply();
        return o.toString();
    }

    public boolean hasPending() {
        return !pend.getAll().isEmpty();
    }
}
