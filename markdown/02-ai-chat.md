# 02 · AI 对话

> 对应代码（⚠ 行号**会漂** —— 下面这几个数是旧轮次实测、之后往 `<style>` 里插过东西就没再跟，
> 跳转请 `grep` 横幅原文，别照抄数字）：HTML `3293–3518`，JS `4723–5360`、`11127–11483`，CSS `526–1660`

---

## 一、面板结构

```
#ai-card .ai-container（默认折叠）
├── .ai-header              🤖 AI 对话 ｜ ✚ 新对话 ｜ ⛶ 放大 ｜ ▲ 折叠
└── .ai-collapse-wrapper
    └── .ai-collapse-inner
        ├── .ai-settings-panel         ⚙ 模型设置（子折叠）
        │   ├── 供应商 / Base URL / API Key / 模型 / 拉取模型列表
        │   └── .ai-adv-inner（高级设置，再折叠）
        │       ├── 流式输出开关
        │       ├── 温度滑块 0–2
        │       ├── 最大 Token
        │       ├── 🎭 用户人设 · {{user}} 宏
        │       ├── 系统提示词预设（chip 行 + 正文编辑）
        │       └── 酒馆模式（角色卡 / 世界书 / 作者注释 / 人设 / 预设）
        └── .ai-chat
            ├── #ai-messages          消息列表
            └── .ai-input-row         输入框 + 发送按钮
```

三级折叠状态（挂在 `#ai-card` 上）：`ai-collapsed`（整体）、`ai-settings-collapsed`（模型设置）、`ai-adv-collapsed`（高级设置）。

---

## 二、供应商（`AI_PROVIDERS`）

**一张表管全站**（第十八轮合并）：编写器那份 `ST_AI_PROVIDERS` 现在**就是它**
（`const ST_AI_PROVIDERS = AI_PROVIDERS;`，见产品 16582 行）。以前是两份重复维护的清单，
加一个服务商要改两个地方 —— 漏一个就是「编写器下拉里有、取不到」。

**37 项**，分 6 组（下拉按 `<optgroup>` 分组）：

| 组 | 项 |
|---|---|
| 海外 | `openai` · `anthropic` · `xai` · `mistral` · `groq` · `together` · `fireworks` · `perplexity` · `cerebras` · `nvidia` · `openrouter` |
| 国产 | `deepseek` · `moonshot` · `glm` · `qwen` · `siliconflow` · `minimax` · `ark` · `hunyuan` · `qianfan` · `spark` · `stepfun` · `lingyi` |
| **国产 · 海外渠道** | `moonshot-intl` · `glm-intl` · `qwen-intl` · `qwen-us` · `qwen-hk` · `siliconflow-intl` · `minimax-intl` |
| Google | `gemini`（OpenAI 兼容层）· `gemini-native`（原生协议）· `vertex`（Vertex AI） |
| 本地 | `ollama` · `lmstudio` · `vllm` |
| 其他 | `custom`（**必须留末位**） |

⚠⚠ **海外渠道跟国内不是同一个端点，Key 也通常不通用**（拿国内 Key 打国际站会 401）。
所以它们是**独立条目**，不是「同一个服务商的两个字段」。清单见下表。

### 国产模型的海外渠道

| value | 端点 |
|---|---|
| `moonshot-intl` | `https://api.moonshot.ai/v1` |
| `glm-intl` | `https://api.z.ai/api/paas/v4`（Z.ai） |
| `qwen-intl` | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`（新加坡） |
| `qwen-us` | `https://dashscope-us.aliyuncs.com/compatible-mode/v1`（美国 · 弗吉尼亚） |
| `qwen-hk` | `https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1`（中国香港） |
| `siliconflow-intl` | `https://api.siliconflow.com/v1` |
| `minimax-intl` | `https://api.minimax.io/v1` |

### 三个字段，各有各的规矩

| 字段 | 规矩 |
|---|---|
| `value` / `label` / `baseUrl` | 直白 |
| `proto` | `openai`（默认）/ `anthropic` / `gemini`。⚠ **除了 `custom`，每一项都必须写死** |
| `group` | 下拉分组名。**组名顺序**在 `AI_PROVIDER_GROUPS` 里定；表里冒出新组名时会**接在已知组后面**（不会丢，只是排最后） |
| `custom: true` | **只能有一个，且必须留末位** —— `stAiProviderOf()` 找不到 value 时**兜底回最后一项** |

⚠⚠ **`custom` 的 `proto` 故意留空**（`''`），意思是「**按 Base URL 猜**」。
这里踩过一次真 bug：原本给它写了 `proto: 'openai'`，于是用户「自定义」粘 Anthropic 的域名时，
`stAiProtoOf()`（决议）**先查表查到就不猜了** ⇒ 整条跳过 URL ⇒ 按 OpenAI 形状发出去 ⇒ 400。
**界面显示是对的，只有真发一次请求才看得出来。**

⇒ 加服务商时记住这条：**写死 `proto` 的是「这个端点只可能说一种话」的，剩下的交给猜。**

---

## 三、系统提示词预设（`AI_PROMPT_PRESETS`）

五个预设，每个自带 **人设提示词** + **开场白**，两者语气一致（选了「傲娇公主」不会还蹦出猫猫的开场白）。

| id | 名称 | 风格 |
|---|---|---|
| `cat` | 🐱 猫猫 Saki | 黏人的小猫，句尾爱带「喵」 |
| `shy` | 😖 社恐少女 Saki | 极度怕生，说话前排练三遍 |
| `tomboy` | 😎 假小子 Saki | 爽朗直率、讲义气 |
| `otokonoko` | 🎀 伪娘 Saki | 外表超可爱的男孩子 |
| `princess` | 👑 傲娇公主 Saki | 嘴上不认输，心里很在意 |

每个预设的字段：`id` / `label` / `desc` / `aliases` / `greeting` / `prompt`。

- **`aliases`** —— 兼容旧配置。老版本没存过预设 id，`detectPromptPreset(text)` 靠 `aliases` 里的内容把预设认回来，不用用户手动再点一次
- **`prompt`** —— 正文，里面可以用 `{{char}}` / `{{user}}` 宏
- **`greeting`** —— 开场白，见下面「开场白」一节

还有 `custom`（自定义）：`PRESET_CUSTOM = 'custom'`，用户自己写。

---

## 四、`{{user}}` 宏机制

这是模仿 SillyTavern 的 `{{user}}` / `{{char}}` 替换。

### 设置项

| 字段 | 控件 | 说明 |
|---|---|---|
| `userMacroEnabled` | 开关 | 总开关，关掉则宏原样返回 |
| `userName` | 文本框 | **你的昵称** |
| `charName` | 文本框 | AI 角色名 |
| `addressStyle` | 下拉 | 称呼方式 |
| `addressAffix` | 文本框 | 修饰词 |
| `addressTemplate` | 文本框 | 自定义模板 |
| `addressInject` | 开关 | 自动注入称呼指令 |

### 称呼方式（`buildUserAddress()`）

| style | 效果 | 例子（昵称 `阿月`，修饰词 `小`） |
|---|---|---|
| `plain` | 直接称呼昵称 | `阿月` |
| `prefix` | 前缀修饰 | `小阿月` |
| `suffix` | 后缀修饰 | `阿月酱` |
| `custom` | 自定义模板 | 模板 `{{user}}大人` → `阿月大人` |

昵称为空时返回空串。

### 展开（`applyUserMacros()`）

```js
text.split('{{user}}').join(ctx.address || '主人')
    .split('{{char}}').join(ctx.charName)
```

用 `split().join()` 而不是 `replace()` —— 后者只换第一个。

**酒馆模式下 `{{char}}` 取角色卡里的名字**，而不是设置里那个（`getMacroContext()` 里判断）。

### 称呼注入

`buildSystemPrompt()`：如果开了 `addressInject`，且原始提示词里**没有** `{{user}}`，就在末尾追加：

```
（请用「阿月」来称呼我。）
```

### 开场白里的宏（有个坑）

`appendAiGreeting()` 里**不能**用 `applyUserMacros()`：

```js
// 关掉宏之后 applyUserMacros 会原样返回，开场白里就会漏出 {{char}} 这种字面量
const addr = (ctx.enabled && ctx.address) ? ctx.address : '你';
greet = String(preset.greeting)
    .split('{{char}}').join(ctx.charName)     // {{char}} 永远展开
    .split('{{user}}').join(addr);            // {{user}} 只在宏开着时换
```

开场白是**给人看的文案**，`{{char}}` 永远要展开；`{{user}}` 在宏关闭时退化成「你」。

另外，若预设开场白里没有 `{{user}}`，且宏开着，会在末尾补一句自我介绍。

---

## 五、请求流程

### 消息组装

```js
const messages = buildRequestPlan().messages;
```

`buildRequestPlan()` 根据模式分两条路：

- **普通模式** —— `system`（`buildSystemPrompt()`）+ 聊天历史
- **酒馆模式** —— 角色定义 / 世界书 / 作者注释 / 人设按位置与深度拼装，详见 [03-tavern.md](03-tavern.md)

### 传输

⚠ **第十八轮起不再自己拼请求了** —— 这一页原来有一份 OpenAI 专属的 URL / 头 / SSE 解析，
现在**全部并到共用协议层**（跟编写器同一套）。理由就是项目自己的规矩：协议细节散成两份的
那天，一定会出现「改了 A 忘了 B」。

| 函数 | 说明 |
|---|---|
| `aiEffectiveCfg()` | 把「配置来源」（跟随全局 / 独立）解析成一份 `cfg`，带上 `proto` |
| `nonStreamChat(messages)` | 走 `stAiRequest(cfg, …, {stream:false})` ⇒ `fetch` ⇒ `stAiFullText(proto, data)` |
| `streamChat(messages, onDelta)` | 同上但 `stream:true`，SSE 由共用的 `stAiSseText(proto, json)` 取增量 |

两者都：

- `stAiRequest()` 出 **URL / 头 / 体**（`plan`），`stAiPlanAuth()` 补异步那部分（Vertex 换 token）
- **`max_tokens` 只在 `> 0` 时才带上**（有些供应商不接受 0）
- 非 2xx 抛 `HTTP {status} {body 前 200 字}`
- ⚠ `streamChat` 还要防「**服务端不理会 `stream`、直接返一整段 JSON**」——
  那时 `resp.body.getReader` 根本不存在，退回按非流式解析（别在这里抛 `getReader is not a function`）

### 流式解析细节

```js
buffer += decoder.decode(value, { stream: true });   // 注意 { stream: true }
```

用 `{ stream: true }` 是因为多字节 UTF-8 字符可能被切在两个 chunk 之间，不加会出乱码。

按行解析，`data:` 前缀取 `slice(5).trim()`，跳过空串和 `[DONE]`，`JSON.parse` 失败静默忽略（单行坏掉不影响整条流）。

---

## 六、消息气泡

### 结构

```html
<div class="ai-msg from-ai" data-history-role="assistant" data-history-content="…">
    <div class="ai-bubble ai">回复内容</div>
    <div class="ai-msg-tools">
        <button class="ai-msg-btn" title="重新生成这条回复">↻</button>
    </div>
</div>
```

**历史内容挂在 `.ai-msg` 上**（不是气泡上），这样重试时可以只靠 DOM 还原「这条之前的对话」。

`setBubbleHistory(bubbleEl, role, content)` 负责写 `dataset`。

### 谁可重试

```js
const retryable = (opts.retryable !== undefined) ? opts.retryable : !isUser;
```

- 用户消息：不可重试
- AI 回复：可重试
- **开场白 / 欢迎语**：显式传 `retryable: false`（它不算真正的回复）

### 重试（`retryFrom(wrapEl)`）

1. 取出 `#ai-messages > .ai-msg` 全部
2. 找到点击的那条的下标
3. 保留前面的，丢掉这条及其之后
4. **只把真正进过历史的气泡**（有 `dataset.historyRole` 的）重建 `chatHistory` —— 欢迎语、失败的气泡都不算
5. 历史超过 40 条时只留最后 40 条
6. 重新请求

### 失败处理

请求抛异常时：

- 气泡加 `.failed` 类（显眼样式）
- 文字变成 `请求失败：{message}`
- **失败这条不进历史**（`chatHistory` 里没有），点旁边的 ↻ 就能重试

### 新对话（`newAiConversation()`）

1. 有消息时 `confirm` 确认
2. 卡片折叠着的话**先展开再清**（不然清空是看不见的）
3. `chatHistory = []` + **`wiResetTimed()`**（黏性 / 冷却从零开始）
4. 清空 DOM，重新插开场白
5. 聚焦输入框

`wiResetTimed()` 是关键：新对话等于新的聊天上下文，世界书的黏性 / 冷却状态必须重置。

---

## 七、放大模式

`toggleAiMaximize()` 切换 `#ai-card.ai-maximized` + `body.ai-max-on`。

- **手机设备**：铺满整个浏览器窗口
- **电脑**：按窗口百分比垂直显示（带宽度上限），桌面端竖向居中

进入放大时：

- 记下原来的三级折叠状态到 `aiMaxPrevState`
- 强制展开整体、收起设置面板与高级设置（把高度让给聊天）
  ⚠ **这条对「手机比例下的全屏」同样成立** —— 手机用户点菜单进来之后，设置 / 高级是**折着**的，
  要自己点开才能摸到酒馆面板。外部那套视觉验证就被它坑过一次：面板折进
  `height: 0; overflow: hidden` 的容器里，**整块被裁掉**，而 `getBoundingClientRect()`
  **不受裁切影响**、照旧返回真实尺寸 ⇒ 触控尺寸断言**全绿**却什么都看不见（假绿，见 README §7）。
- 隐藏「展开 / 折叠」按钮（避免把内容折进去）

退出时还原 `aiMaxPrevState`。

背景遮罩挂在 `body` 的伪元素上，不新增 DOM 节点。

### 手机比例下的入口菜单

窄屏 / 极扁窗口（判据 `(max-width: 600px), (max-height: 480px)` —— `max-height` 那条兜住
**手机横屏**，844×390 时宽度会被误判成桌面）下，`#ai-card` 与 `#st-card` 被收进左上角一个按钮
（`#mobile-nav`），点开才露出这两个入口。

- ⚠⚠ **隐藏规则是 `#ai-card:not(.ai-maximized)` —— `:not()` 不能省。** 放大态就是靠给这张卡加
  `.ai-maximized` 变成 `position: fixed; inset: 0` 的；写裸的 `#ai-card { display: none }`
  会把全屏一起压掉，表现是「点进全屏什么都不出来」，而 **class 照样加得上**
  ⇒ **只断言 class 抓不到，必须断言 computed `display`**（`smoke.js` 里有一条专门盯它）。
- 点「AI 对话」走 `mobileOpenAi()`：**手机比例下直接进全屏**，复用已有的 `toggleAiMaximize()`
  （它在 ≤600px 时本来就是铺满整个浏览器窗口），并用 `!isAiMaximized()` 兜住它的 **toggle 语义** ——
  否则「已经全屏时再点一次」会变成退出全屏。不先展开内嵌卡片：窄屏上它本来就没多少可用高度。
- 点「角色卡编写器」走 `mobileOpenSt()` → `openStEditor()`（那张卡片本来就只是个入口）。
- 点空白处收起（点在菜单自己身上不算）；`resize` 一旦离开断点也收起 ——
  免得留下一个「已经显示不出来了、状态却还开着」的菜单。
- `z-index: 850`：低于放大遮罩 `900` / `#gameModal` `1000` / 编写器浮层 `1200`。
- ⚠ **判据在三处必须逐字一致**：CSS 那条 `@media`、JS 的 `MOBILE_NAV_MQ`、`smoke.js` 的断言。
  不一致会出现「按钮显示着、点了没反应」这种**只在某个宽度区间才复现**的鬼影。
- **复古模式**：按钮 / 菜单框 / 菜单项 / 卡名标注都照 **Win98 / Win2000 的下拉菜单**来
  （`body.retro-mode .mobile-nav-*`）。立体感只靠 `border-color` 的四个角 ——
  **凸起**（按钮 / 菜单框）= 上左亮 `#fff` + 下右暗 `#808080`；**凹陷**（卡名标注，状态栏那种
  只读质感）= 反过来；高亮一律 **海军蓝底白字**（`#000080`）；圆角全部归零 —— 那个年代没有圆角。
  ⚠ **边框 / 底色不能挂在 `.mobile-nav-panel` / `.mobile-nav-inner` 上** ——
  那两个是折叠动画的容器（`grid-template-rows: 0fr`），收起来时高度是 0，
  而 `border` 与 `padding` **不进**那条账 ⇒ 菜单关着也会在左上角留一道灰条。
  所以另起一个 `.mobile-nav-box` 当画框（`smoke.js` 里有一条专门盯这个盒子）。
- **「正在编哪张卡」标注**（`#mobile-nav-name`）—— 在面板**里面**、紧跟在「角色卡编写器」
  那一项的**下面**。跟编写器卡片上的「当前草稿」是**同一份数据**（`stEditor.card.name`），
  由 `renderStCard()` → `stRenderNavName()` 写进来，别另找数据源。
  ⚠ 2026-09-20 第二十二轮从「按钮旁边、常显」挪进来的（用户要求）—— 判据也跟着**反过来**了：
  `smoke.js` 现在断言它**在面板里**、在编写器那一项**下面**、**菜单收起后命中测试摸不到它**。
  ⚠ 最后那条不能只量 `getBoundingClientRect()`：面板收起是 `grid-template-rows: 0fr`
  + `overflow: hidden`，**裁切不影响 rect** ⇒ 收起了 rect 照样非零（本项目踩过同款假绿）。
  而且它必须配「展开时摸得到」作对照，否则一个 `display:none` 写死的实现同样能过。
  没有草稿时靠 `:empty { display: none }` 整块收掉 —— 留个空壳的话它照样是个 flex 项，
  `margin-top` 会在菜单底部留一道空档。
  ⚠ **非复古下它刻意不做成盒子**：深色底会在这块浅色玻璃里成为唯一的暗块、把视觉权重抢过去；
  浅色底又跟上面两个菜单项长得一模一样、看着像第三个入口。最后用「**一条分隔线 + 居中说明文字**」，
  形状上就跟按钮区分开了（复古下另有覆盖，那边反而是个**凹陷的状态栏框**）。
- ⚠ **`.mobile-nav-item` 是 `<button>`，`display: flex` 下宽度按 fit-content 算、不会自己撑满**
  ⇒ 两个入口的右边缘是**锯齿状**的（看着像没做完）。修法不是给按钮写 `width: 100%`，
  而是把 `.mobile-nav-box` 做成纵向 flex，靠默认的 `align-items: stretch` 对齐到最宽那项 ——
  面板宽度本来就由最宽那项决定，所以不会反过来把自己撑大（`smoke.js` 有一条量等宽）。

---

## 八、状态栏与忙碌态

| 元素 | 说明 |
|---|---|
| `#ai-status` | 状态文字（`updateAiStatus(msg)`） |
| `#ai-temp-value` | 温度数值显示 |
| `#ai-stream-label` | 流式开关文字 |

`setAiBusy(busy)`：

- 禁用发送按钮
- 禁用所有 `.ai-msg-btn`（防止请求中重试）

`aiBusy` 为真时 `newAiConversation()` / `retryFrom()` 直接 return。

---

## 九、互斥：原系统提示词 ⇄ 酒馆模式

| 开关 | 开时做什么 |
|---|---|
| `ai-tavern-enabled` | `promptEnabled = false`，清空 + 锁住「用户人设」除昵称外的输入项，换开场白 |
| `ai-prompt-enabled` | `tavernEnabled = false` |

被关掉的那一块整体降透明度 + `pointer-events: none`（CSS 853 行）。

**开场白也受这个开关影响**：`promptEnabled === false` 时不使用预设自带开场白 —— 不然会出现「AI 说自己是猫猫 Saki，但猫猫的人设根本没发出去」的错位。

---

## 十、API 全局配置 与「配置来源」（第十七轮）

> 这一节跨三处界面：**主页的弹窗** + **本选项卡顶部的来源开关** + **编写器的 AI 助手**
> （后者见 `04-card-editor.md` 十五）。

### 一份真相源

| 名字 | 存哪 | 是什么 |
|---|---|---|
| `apiGlobal` | `localStorage['apiGlobalCfg']` | **全站唯一真相源**：服务商 / Base URL / Key / 模型 / 温度 / max_tokens / 流式 / **第一段** |
| `aiConfig.followGlobal` | `localStorage['aiChatConfig']` | 本选项卡的配置来源：`true`（默认）跟随全局 / `false` 用自己那份 |
| `aiConfig.own` | `localStorage['aiChatConfig']` | 「独立配置」时自己那一套 |

⚠⚠ **`aiConfig` 顶层那 8 个 API 字段是「生效值」，不是真相源。** 全站 40 多个读点
（`aiConfig.apiKey` / `aiConfig.model` …）**一行都没改**，只在两处刷新：载入时
（`initApiGlobal()`）与全局面板保存后（`saveApiGlobal()`），都走 `aiApplyEffective()`。
⇒ 为什么不用「每个读点按来源取」：40 多个点里漏一个，就是**一处静默的旧值** ——
那种错**不报错、界面也正常**，只有发出去的请求带着旧 Key。

⚠ **写 `aiChatConfig` 一律走 `aiPersist()`**（唯一入口）。`own` 快照只在用户**真的在本页改了**
那几个字段时才同步（`aiSyncOwnFromEffective()`，自带 `followGlobal === false` 守卫）——
放进 `aiPersist()` 无条件跑的话，**跟随模式下改一次系统提示词就会把用户那份独立配置静默冲掉**。

### 一次性迁移

`apiGlobalCfg` 不存在 ⇒ 用现有 `aiChatConfig` 的 API 字段 + 第一段**播种**，同时把 `own` 也播一份
（免得用户一切到「独立配置」就面对一片空白），`followGlobal` 默认 `true`。
⇒ 升级后外观与效果**跟升级前一模一样**，只是从此全局是唯一可改的地方。
⚠ 播种**只做一次**（`apiGlobalLoad()` 返回 `firstTime` 才落盘）—— 每次都播的话，
用户在全局面板改过的东西**会在下次刷新被老配置盖回去**。

### 界面

- 主页 **【🔌 API 全局配置】**（`#api-global-btn`，在【🐱 小游戏】**上方**）⇒ 弹窗 `#apiGlobalModal`
  （复用 `.modal-overlay` / `.game-card`，含复古皮肤覆盖）。里面：服务商 / Base URL / Key /
  模型（含**获取模型列表**）/ 流式 / 温度 / max_tokens / 第一段 + **测试连接** + **保存**。
  ⚠ 卡片是白底，而 `.ai-btn` / `.ai-switch-track` 是「白字 / 半透明白」—— 直接搬进来**看不见**，
  所以按弹窗作用域覆盖了一遍（`.apig-*` + `body.retro-mode` 那几条）。
- 本选项卡面板顶部两个按钮：**🔗 跟随 API 全局配置 / 🔑 独立配置**；折叠状态下也有角标显示当前来源。
- ⚠ 跟随时那批 API 控件是**真 `disabled`**（不是 readonly）—— **绝不留「能改、但下次刷新又变回去」
  的假输入框**；旁边给一个「打开 API 全局配置」的出口，`applyAiSettings()` 的缺项提示也会指到全局去。
- **全局配置里没有「系统提示词」** —— 那不是 API 配置，仍归本选项卡。

### 谁读哪一份

| 消费方 | 跟随 | 独立 |
|---|---|---|
| 本选项卡（对话 / `firstSegText()`） | `apiGlobal` | `aiConfig.own` |
| 编写器的 AI 助手（`stAiCfg()`） | `apiGlobal` | `stAi`（**它自己的**开关，与本页无关） |

⚠ 两个开关**互不影响**：本页切「独立配置」**不会**把编写器拖走。套件里有一条断言专门盯这个
（「独立：编写器**跟随模式**仍然读全局（它不跟对话跑）」—— ⚠ 断言名里那四个字是关键）。

---

## 十一、Gemini / Vertex AI 协议（第十八轮）

第三种协议 `gemini`（前两种是 `openai` 与 `anthropic`）。它跟另两种**形状差得远**，
所以没有塞进 `stAiEndpoint()`，而是单开一组函数：

| 函数 | 干什么 |
|---|---|
| `stAiIsVertex(cfg)` | 同一个协议分叉 AI Studio 与 Vertex（看预设表上的 `vertex: true`，或 Base URL 里有没有 `aiplatform` / `vertex`） |
| `stAiGeminiModel(model)` | 模型名归一：剥掉 `models/` / `google/` / `publishers/google/models/` 前缀（用户常连前缀一起抄，带前缀进 URL 会 404，而报错只说「模型不存在」） |
| `stAiGeminiHost(cfg)` | `global` ⇒ `https://aiplatform.googleapis.com`；其他 location ⇒ `https://{loc}-aiplatform.googleapis.com` |
| `stAiGeminiPath(cfg, model, action)` | 三条路的路径（见下） |
| `stAiGeminiUrl(cfg, model, stream)` | 拼上面两个 + `?alt=sse`（流式） |
| `stAiGeminiModelsUrl(cfg)` | 列模型的 URL |
| `stAiGeminiBody(cfg, messages, opts)` | OpenAI 形状的 `messages` → `contents` + `systemInstruction` + `generationConfig` |
| `stAiGeminiAuthHeaders(cfg)` | **可能是异步的**（完整模式要现换 token） |
| `stAiGeminiText(data)` | 取文：`candidates[0].content.parts[].text` |

### 三条路

| 路 | 端点 | 鉴权 |
|---|---|---|
| AI Studio 原生 | `https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent` | `x-goog-api-key` |
| Vertex **快速模式**（Express） | `https://aiplatform.googleapis.com/v1/publishers/google/models/{m}:generateContent` | `x-goog-api-key` |
| Vertex **完整模式**（Service Account） | `https://{loc}-aiplatform.googleapis.com/v1/projects/{proj}/locations/{loc}/publishers/google/models/{m}:generateContent` | `Authorization: Bearer {access_token}` |

⚠⚠ **快速模式的路径里没有 `projects/` 段** —— 它不是「少了参数的完整模式」，
是两个不同的端点。写错了报的是 404，看着像「模型名不对」。

⚠ 流式走 `:streamGenerateContent`，**必须带 `?alt=sse`**。不带的话服务端返的是
「一段一段的 JSON 数组」而不是 SSE，现有的按行解析一行都读不出来 —— 表现为
**「流式一直没输出，最后突然全出来」**。

### 请求体

- `system` 消息**抽出来**放进 `systemInstruction`（不是留在 `contents` 里）
- `assistant` → `model`（角色名不一样），其余 → `user`
- ⚠⚠ `contents` **非空**且**第一条必须是 `user`** —— 两条都不满足时服务端报的是
  `400 INVALID_ARGUMENT`，看起来像「请求体写错了」而不是「少了条消息」
- 采样参数在 `generationConfig` 里，上限字段叫 `maxOutputTokens`（不是 `max_tokens`）

### Vertex 完整模式：Service Account → access token

全程在**本机浏览器**里跑，私钥**不上传任何地方**：

1. `stAiSaParse()` 解析 Service Account JSON（缺 `client_email` / `private_key` 会明确报出来，
   并提示「确认粘的是密钥文件本身」）
2. `crypto.subtle.importKey('pkcs8', …, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])`
3. 签 RS256 JWT：header `{alg:'RS256',typ:'JWT'}`，claims `iss` / `scope`（`…/auth/cloud-platform`）/
   `aud`（`token_uri`）/ `iat` / `exp`
4. `POST {token_uri}`（默认 `https://oauth2.googleapis.com/token`），
   `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer` + `assertion={jwt}`
5. 拿到的 token **缓存在内存**（`stAiSaTokens`，**不落 localStorage**），
   提前 60 秒续一次；缓存键是 `client_email`（换一份 SA 立刻拿新的，不会串用上一个项目的 token）

⚠ 中文 / emoji 进 JWT 要先 `TextEncoder` 再 `btoa` —— 直接 `btoa(中文)` 抛 `InvalidCharacterError`。
⚠ 私钥读不出来时的报错**必须说清是「私钥」**：只查「抛没抛」的话，把 `importKey` 的错误吞掉、
后面 `subtle.sign(key = null)` 照样抛，用户看到的是 `parameter 2 is not of type CryptoKey` 这句天书。

### 三个「协议判定」的坑

1. ⚠⚠ **「猜」和「决议」是两步**。`stAiGuessProto(baseUrl, provider)` 是猜（看关键词），
   `stAiProtoOf(provider, baseUrl)` 是**决议**（先查预设表，查到就**不再猜**）。
   真正决定请求形状的是决议那一步 —— **断言要打在它上面**。
2. ⚠⚠ **Gemini 的 OpenAI 兼容层也含 `generativelanguage`** ⇒ 判 gemini 原生时必须**先排掉**
   路径里带 `/openai` 的那种，否则兼容层会被误判成原生协议（URL 拼不出来、头也不对）。
3. ⚠ **半成品 `cfg` 要兜底**：`apigGather()` / `getAiConfigFromInputs()` 返回的对象里**没有 `proto`**
   （协议是推导出来的）⇒ 一律过一遍 `stAiEnsureProto(cfg)`。少了这步，gemini / vertex 会被
   当成 openai 发出去（拿 Bearer 去打 Google、URL 里也不带模型名）。
