package top.yansaki.shed.nativeui;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 「这次请求用哪份 API 配置」—— 原生侧唯一的一处解析。
 *
 * <p>⚠⚠ 抽出来是为了**只有一份**。对话页和人设生成器都要发请求，各写一份的话，
 * 改了「跟随全局 / 独立配置」的判断忘了另一边，表现是「对话能通、人设生成报没密钥」，
 * 而且看不出是配置问题。
 *
 * <p>规则（照 {@code js/334} 与 {@code js/208}）：
 * <ul>
 *   <li>{@code aiConfig.followGlobal === false} ⇒ 用 {@code aiConfig.own}</li>
 *   <li>否则用 {@code apiGlobalCfg}（「接口」页编辑的就是它）</li>
 * </ul>
 * 协议（openai / anthropic / gemini）从页面推过来的服务商表里查，**Java 里不抄一份**。
 */
public final class AiCfg {

    private AiCfg() {
    }

    public static ChatApi.Cfg resolve(Store store) {
        JSONObject g = parse(store.get("apiGlobalCfg", null));
        JSONObject ai = parse(store.get("aiChatConfig", null));

        boolean follow = true;
        JSONObject own = null;
        if (ai != null) {
            follow = !(ai.has("followGlobal") && !ai.optBoolean("followGlobal", true));
            own = ai.optJSONObject("own");
        }
        JSONObject eff = (follow || own == null) ? g : own;
        if (eff == null) eff = new JSONObject();

        ChatApi.Cfg c = new ChatApi.Cfg();
        c.baseUrl = eff.optString("baseUrl", "");
        c.apiKey = eff.optString("apiKey", "");
        c.model = eff.optString("model", "");
        c.stream = eff.optBoolean("stream", true);
        c.temperature = eff.optDouble("temperature", 0.7);
        c.maxTokens = eff.optInt("maxTokens", 1024);
        c.proto = protoOf(store, eff.optString("provider", "openai"));
        return c;
    }

    /** 从页面推过来的服务商表里查协议；查不到按 openai 兼容处理。 */
    static String protoOf(Store store, String provider) {
        String raw = store.get("__ys_providers", null);
        if (raw == null) return "openai";
        try {
            JSONArray a = new JSONArray(raw);
            for (int i = 0; i < a.length(); i++) {
                JSONArray e = a.optJSONArray(i);
                if (e == null || e.length() < 2) continue;
                if (provider.equals(e.optString(0))) {
                    String proto = e.length() > 3 ? e.optString(3, "openai") : "openai";
                    return proto.length() == 0 ? "openai" : proto;
                }
            }
        } catch (Exception ignore) {
        }
        return "openai";
    }

    static JSONObject parse(String raw) {
        if (raw == null || raw.length() == 0) return null;
        try {
            return new JSONObject(raw);
        } catch (Exception e) {
            return null;
        }
    }
}
