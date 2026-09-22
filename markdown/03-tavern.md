# 03 · 酒馆模式（SillyTavern 兼容层）

> 对应代码：JS `5549–9050`，CSS `946–1462`、`2190–2420`
>
> 目标：**在角色卡 / 世界书 / 作者注释 / 用户人设 / 提示词预设这五块上，做到与纯净版 SillyTavern 无差异**。所有语义都对着 ST 源码核对过，不是照着文档猜的。

---

## 一、总开关与互斥

`tavernEnabled()` 读 `aiConfig.tavernEnabled`。

| 开关 | 开时做什么 |
|---|---|
| 开酒馆模式 | `promptEnabled = false`；清空 + 锁住「用户人设」里除昵称外的所有输入项；还没聊过就换成角色卡的开场白 |
| 开原系统提示词 | `tavernEnabled = false` |

**锁「用户人设」**（`tavernLockUserMacro()` / `applyUserMacroLock()`）：

| 项 | 处理 |
|---|---|
| 你的昵称 `userName` | **留着，可改**（唯一例外，人设描述取的就是它） |
| `charName` / `addressStyle` / `addressAffix` / `addressTemplate` / `addressInject` | 清空 + `disabled` |
| 宏开关 `userMacroEnabled` | 锁成 **`true`** |

宏开关锁成 `true` 而不是 `false`：昵称要靠宏开关才会展开，清成 `false` 等于把昵称也一起废了。

锁逻辑放在 **`syncUserMacroUI()`** 里而不是只挂在 `onTavernToggle` 上 —— 「刷新时酒馆模式本来就是开的」这条路也要走一遍，否则会把上次存的旧值原样留着。

**退出酒馆模式不还原**（用户明确要「清除」）。

---

## 二、角色卡

### 导入

三种入口：

| 入口 | 处理器 | 接受 |
|---|---|---|
| 酒馆面板「📇 导入角色卡」 | `onCardFilePicked()` | PNG / JSON |
| 世界书面板「导入世界书」 | `onLoreFilePicked()` | JSON |
| 编写器「📇 当前卡」 | `stLoadFromTavern()` | 读当前 `aiConfig.tavernCard` |

### PNG 卡解析

`readPngTextChunks(buf)` → `decodePngCardChunk(rec)`。

支持的 PNG 文本块：

| 块类型 | 说明 |
|---|---|
| `tEXt` | 未压缩 |
| `zTXt` | zlib 压缩（`DecompressionStream('deflate')`） |
| `iTXt` | 国际化文本块，压缩标志 + 语言标签 |

关键字优先级：`ccv3` > `chara` / `ccv2`。

内容是 **base64(UTF-8 JSON)**，也兼容直接塞裸 JSON 的情况。

> ⚠️ **已知坑**：`readPngTextChunks(buf)` 里 `new DataView(u8.buffer, u8.byteOffset, u8.byteLength)` —— 不能写 `new DataView(buf)`。`DataView` 只接受 `ArrayBuffer`，而编辑器内部传的是 `Uint8Array`，会直接抛 `TypeError`。

### 卡格式（V1 / V2 / V3）

`parseCharacterCard(raw, lenient)`：

- `lenient = false`（酒馆模式）：必须「看起来像张卡」—— 至少命中一个角色卡字段名，否则抛错
- `lenient = true`（编写器）：只要求有名字，其余可空

| 版本 | 结构 |
|---|---|
| V1 | 扁平：`name` / `description` / `personality` / `scenario` / `first_mes` / `mes_example` / `creatorcomment` |
| V2 | `{spec:'chara_card_v2', spec_version:'2.0', data:{…}}` |
| V3 | `{spec:'chara_card_v3', spec_version:'3.0', data:{…}}`，data 是 V2 超集 |

解析出的卡对象字段（`normalizeCard`）：

```
spec / name / description / personality / scenario / mesExample
systemPrompt / postHistoryInstructions
creator / characterVersion / creatorNotes / tags
firstMes / alternateGreetings
```

### 卡片面板（`renderTavernCard()`）

显示：名字、格式、作者、版本、内置世界书条数、标签、**开场白下拉**，以及七个可折叠字段（描述 / 性格 / 场景 / 示例对话 / 系统提示词 / 历史后指令 / 作者备注），每个显示字数。

**开场白切换**（`onTavernGreetingChange`）写 `tavernGreetingIndex`，并调 `refreshGreetingIfFresh()` —— 还没聊过就直接把当前那条开场白换掉。

`greetingList()` 把 `firstMes` + `alternateGreetings` 合成一个列表（第一条是主开场白）。

---

## 三、世界书

### 全局设置（对齐 ST 的 World Info 设置）

| 配置项 | ST 对应 | 默认 |
|---|---|---|
| `tavernScanDepth` | `world_info_depth` | 2 |
| `tavernRecursive` | `world_info_recursive` | false |
| `tavernIncludeNames` | `world_info_include_names` | true |
| `tavernCaseSensitive` | `world_info_case_sensitive` | false |
| `tavernMatchWholeWords` | `world_info_match_whole_words` | false |
| `tavernGroupScoring` | `world_info_use_group_scoring` | false |
| `tavernMinActivations` | `world_info_min_activations` | 0 |
| `tavernMinActivationsDepthMax` | `world_info_min_activations_depth_max` | 0 |
| `tavernMaxRecursionSteps` | `world_info_max_recursion_steps` | 0 |

> **没有 token 预算这一项。** ST 的 `world_info_budget` 是按 `maxContext` 的百分比算的，本应用没有 `maxContext` 概念。与其用一个拍脑袋的绝对值去截断，不如完全不截断（用户要求）。

### 条目字段

`normalizeLoreEntry(e, idx)` + `finalizeLoreEntry(entry)`，兼容 ST 的 snake_case 与老格式：

| 字段 | 说明 |
|---|---|
| `keys` / `secondaryKeys` | 主 / 次关键词 |
| `content` | 正文 |
| `comment` | 备注 |
| `enabled` | ST 用 `disable`；老格式用 `enabled: false` |
| `constant` | 常驻（不靠关键词） |
| `selective` + `selectiveLogic` | 次关键词逻辑 |
| `caseSensitive` / `matchWholeWords` | 覆盖全局设置 |
| `position` | 插入位置，见下表 |
| `depth` / `role` | `@D` 用的深度与角色 |
| `order` / `probability` / `useProbability` | 排序与概率 |
| `group` / `groupWeight` / `useGroupScoring` | 包含组 |
| `scanDepth` / `sticky` / `cooldown` / `delay` | 覆盖项 |
| `triggers` | 生效时机 |
| `matchPersonaDescription` 等六个 `match*` | 扫哪些卡字段 |
| `decorators` | 从正文首部解析出的 `@@` 指令 |
| `useRegex` | 关键词按正则解释（V3 数组条目必填） |

### 八种插入位置（`WI_POS`）

| 值 | 标记 | 名称 |
|---|---|---|
| 0 | `↑Char` | 角色定义之前 |
| 1 | `↓Char` | 角色定义之后 |
| 2 | `↑AT` | 作者注释之前 |
| 3 | `↓AT` | 作者注释之后 |
| 4 | `@D` | 按深度插入对话 |
| 5 | `↑EM` | 示例对话之前 |
| 6 | `↓EM` | 示例对话之后 |
| 7 | `Outlet` | 出口（需插件，不插入） |

顺序与 ST 条目编辑器的下拉一致（就是 `world_info_position` 枚举顺序）。

> **`↑AT` / `↓AT` 不是独立插入槽。** 它们夹的是**作者注释**的内容 —— ST 里是把这些条目拼进作者注释正文，再整体按作者注释的位置 / 深度 / 角色注入（`world-info.js:5268-5272`）。所以本应用必须有「作者注释」这个概念，否则这两个位置无处可依。

### 扫描流水线

```
scanWorldInfo(history, isDryRun)
├── wiMakeBuffer(history, globalScanData)      深度缓冲 + 递归缓冲
├── wiMakeTimedEffects(history, entries)       黏性 / 冷却
├── wiCharacterFiltered(entry)                 按角色过滤
├── 初次扫描（SCAN_STATE.INITIAL）
│   └── 关键词匹配（主 + 次关键词 + selectiveLogic）
├── 递归扫描（SCAN_STATE.RECURSION）
├── 最小激活数扫描（SCAN_STATE.MIN_ACTIVATIONS）
└── wiFilterByInclusionGroups(...)             包含组筛选
```

`WI_SCAN_STATE = { NONE:0, INITIAL:1, RECURSION:2, MIN_ACTIVATIONS:3 }`。

**`isDryRun = true` 时不会推进黏性 / 冷却状态** —— 预览用的试算必须传 `true`，否则光打开面板就会把定时效果耗掉。

### 扫描缓冲区（`wiMakeBuffer`）

对齐 ST 的 `WorldInfoBuffer`：

- **深度缓冲**：下标 0 = 最新一条消息
- **递归缓冲**：递归扫描时把已激活条目的正文也纳入

`wiSpeakerName(role)` 给消息加 `角色名: ` 前缀（`includeNames` 打开时），扫描时连名字一起匹配。

### 全局扫描数据（`wiGlobalScanData()`）

除了聊天，还能一起扫的角色卡字段：

| 字段 | 来源 |
|---|---|
| `personaDescription` | **`personaText().trim()`** —— 用户人设描述正文 |
| `characterDescription` | 卡的 `description` |
| `characterPersonality` | 卡的 `personality` |
| `characterDepthPrompt` | 空（本应用不解析 `depth_prompt`） |
| `scenario` | 卡的 `scenario` |
| `creatorNotes` | 卡的 `creatorNotes` |
| `trigger` | 固定 `'normal'` |

> ⚠️ `personaDescription` 曾经错拿 `{{user}}` 的**名字**顶替。ST 那边取的是 `power_user.persona_description?.trim()`（`script.js:3412` → `4627`），已修正。

### 装饰器（`wiParseDecorators`）

正文首部的 `@@` 指令：

| 装饰器 | 作用 |
|---|---|
| `@@activate` | 强制激活 |
| `@@dont_activate` | 强制不激活 |

规则（照抄 ST）：

- 只有**正文以 `@@` 开头**时才解析
- `@@@` 前缀会被剥掉一层（`substring(1)`）
- 遇到**不认识**的装饰器 → 标记 `fallbacked`，后续的 `@@@` 行不再当作装饰器（保留在正文里）
- 遇到第一行不以 `@@` 开头的 → 从这里开始就是正文

### 定时效果（黏性 / 冷却）

- **键**：`wiStringHash(JSON.stringify(entry))` —— 只要求「条目一改、键就变」，算法不要求和 ST 一致
- **消息时钟**：`wiChatClock()` 读 `aiConfig.tavernTimed.msgCount`

> ⚠️ **不能用 `chatHistory.length` 当消息时钟。** 本应用会把历史截到 40 条，截断之后 `length` 不再增长，黏性 / 冷却就**永远不会过期**。所以用一个只增不减的计数器 `msgCount`，在 `wiBumpClock()` 里递增。

`wiResetTimed()` 清空全部定时状态 + `msgCount = 0`（新对话时调用）。

### 条目面板（`renderTavernLore()`）

顶部一行摘要：

```
📖 <世界书名字> · N 条 · 启用 M 条 · 本轮插入 K 条
```

下面一行**图例**（`.ai-tv-legend`），三种颜色的圆点对应条目的三种状态：

| 圆点 | 颜色 | 含义 |
|---|---|---|
| `<i>` | 绿 `#7ee08a` | 常驻（始终插入） |
| `<i class="key">` | 蓝 `#8fd0ff` | 关键词触发 |
| `<i class="live">` | 橙 `#ffb44d` | 本轮会插入 |

条目行上对应位置的圆点叫 `.ai-tv-dot`，配色一致。

其他：

- 折叠状态**按面板分别记**（`global` / `an` / `persona`），改一个不会把另一个带开
- 打开时跑一次 `scanWorldInfo(chatHistory, true)` 试算，把「本轮会插入 / 不会插入」标出来
- `wiEntryFacts(e)` 只列**真正设过**的字段，避免每个条目都堆一大片默认值
- 书里声明了、但 ST 不会自动采纳的全局设置，单独一条 `.ai-tv-declared` 提示（不静默覆盖用户的全局设置）

---

## 四、作者注释（Author's Note）

**这不是插件，是 ST 的核心功能**，而且世界书的 `↑AT` / `↓AT` 夹的就是它。

### 配置

| 字段 | ST 对应 | 默认 |
|---|---|---|
| `tavernAnText` | 注释正文 | 空 |
| `tavernAnPosition` | `extension_prompt_types` | `1`（IN_CHAT） |
| `tavernAnDepth` | 深度 | 4 |
| `tavernAnRole` | 角色 | 0（system） |
| `tavernAnInterval` | 间隔（每 N 条用户消息插一次） | 1 |

`AN_POS = { inPrompt: 0, inChat: 1, beforePrompt: 2 }`（对齐 ST 的 `{ NONE:-1, IN_PROMPT:0, IN_CHAT:1, BEFORE_PROMPT:2 }`）。

### 是否插入（`anShouldInsert()`）

`anInterval()` 为 0 时不插；否则按用户消息数取模判断。

### 文本组装（`anBlockText(wi)`）

```
↑AT 条目 join('\n')  +  '\n'  +  人设（若位置=注释上/下）  +  '\n'  注释正文  +  '\n'  +  ↓AT 条目 join('\n')
```

然后 `.replace(/(^\n)|(\n$)/g, '')` 去掉首尾空行，再过 `applyCardMacros()` 展开宏。

**人设嵌套方向**（`personaRidesAn()` 为真时）：人设套在 ↑AT/↓AT **外面**：

```
上方 → ${persona}\n${↑AT}\n${AN}\n${↓AT}
下方 → ${↑AT}\n${AN}\n${↓AT}\n${persona}
```

依据是 ST 的调用顺序：`setFloatingPrompt()`(4619) → 世界书包 ↑AT/↓AT(`wi.js:5271`) → `addPersonaDescriptionExtensionPrompt()`(4684)。人设是**最后**包上去的。

> ⚠️ 这一步 ST **没有**再 `replace` 一次首尾换行，所以注释正文为空时会留一个尾换行，原样保留。

### 三种位置的行为

| 位置 | 行为 |
|---|---|
| `提示词之前` | 插在 `main` 槽**之前** |
| `提示词内` | 插在 `main` 槽**之后**、`charDescription` 之前 |
| `对话内` | 变成一条按深度注入的扩展提示词 |

---

## 五、用户人设描述（personaDescription）

对应 ST 的 `power_user.persona_description`。

### 正文来源：**你的昵称**

`personaRaw()` = `String(aiConfig.userName || '').trim()`。

酒馆模式下面板里那一栏是**只读镜像** —— `readonly` textarea + 标题写「你的昵称「X」· 位置」。要改正文，去上面的「🎭 用户人设」改昵称。

> 这是 app 侧的差异：ST 里人设描述是一段独立的长文本。本应用按用户要求把它简化成昵称。

### 五种位置（`PERSONA_POS`）

| 值 | 名称 | 行为 |
|---|---|---|
| 0 | 提示词内 | 走预设里 `personaDescription` 那个槽 |
| 1 | `AFTER_CHAR` | **废弃**，载入时归到 0（ST `personas.js:626` 就是这么迁移的） |
| 2 | 作者注释上方 | 拼进注释正文 |
| 3 | 作者注释下方 | 拼进注释正文 |
| 4 | 对话内 | 单独一条注入，用自己的深度 / 角色 |
| 9 | 不插入 | 关闭 |

默认：位置 `0`、深度 `2`、角色 `0`（对齐 `personas.js` 的 `DEFAULT_DEPTH` / `DEFAULT_ROLE` 与 `power-user.js:291-293`）。

### 四个坑（都从 ST 源码挖出来的）

1. **嵌套方向** —— 人设套在 ↑AT/↓AT **外面**（见上）
2. **人设会被注释连坐** —— 位置选「注释上/下」时，若这一轮注释不插（间隔没到），**人设也跟着不插**。对应 ST `script.js:3213` 那个 `&& shouldWIAddPrompt`
3. **对话内是独立的** —— 把预设里 `personaDescription` 那个槽关掉，对话内的人设照样注入
4. **桶内顺序按 key 字典序** —— `getExtensionPrompt` 是 `Object.keys().sort()`，大写排前面：
   `'2_floating_prompt'` < `'PERSONA_DESCRIPTION'` < `'customDepthWI_*'`

### 没有 `{{persona}}` 宏

ST 里**不存在** `{{persona}}` 宏（`script.js:4706` / `5367` 只是 text-completion 的 `storyString` 参数，whisperer 机制里没注册）。本应用也没造一个。

---

## 六、提示词预设（ST Chat Completion 预设的移植）

### 数据模型

```js
{
  id, name,
  prompts: [{ identifier, name, role, system_prompt, content, marker,
              injection_position, injection_depth, injection_order,
              forbid_overrides, injection_trigger, extension }],
  order:   [{ identifier, enabled }]
}
```

- `prompts[]` —— 槽位定义
- `order[]` —— 顺序 + 启用层（ST 里按角色 id 分，本应用只保留一份）

### 内置预设（`BUILTIN_PRESETS`）

照抄 ST 的 `Default.json`，但 **order 用代码里那份（`PromptManager.js:2087` 的 `promptManagerDefaultPromptOrder`）—— 12 项且 `personaDescription` 启用**。

> ST 的 `Default.json` 里 `character_id = 100000` 那份是 **11 项、漏了 `personaDescription`**（只有群聊那份 100001 有）。照 JSON 抄的话，默认预设下人设描述永远没有落脚点。

顺序：

```
main → worldInfoBefore → personaDescription → charDescription → charPersonality
→ scenario → (enhanceDefinitions 关闭) → nsfw → worldInfoAfter
→ dialogueExamples → chatHistory → jailbreak
```

**内置预设只读，一编辑就自动 fork 成用户副本**（`forkPresetIfBuiltin()`），免得把参考副本改坏。

### 槽位分类

| 分类 | 常量 | 成员 |
|---|---|---|
| 应用填（用户改不了） | `PM_APP_FILLED` | `worldInfoBefore` / `worldInfoAfter` / `charDescription` / `charPersonality` / `scenario` / `personaDescription` / `dialogueExamples` / `chatHistory` |
| 卡可覆盖 | `PM_CARD_OVERRIDABLE` | `main` / `jailbreak` |
| 纯预设内容 | —— | 其余（`nsfw` 等） |

`main` / `jailbreak` 既不是「应用填」也不是「纯预设内容」：内容能在预设里写，但角色卡自带的 `system_prompt` / `post_history_instructions` 会**覆盖**它（除非 `forbid_overrides: true`）。

### 绝对注入（`injection_position: 1`）

槽位标了绝对注入时，从顺序流里**摘出来**，按 `injection_depth` 注进对话历史。

`applyDepthEntries(history, injections)`：

1. 反转历史（下标 0 = 最新）
2. 深度升序
3. 同深度内 `injection_order` 降序
4. 同 order 内角色序 `[0,1,2]`（system → user → assistant）
5. 同角色内 `seq` 升序
6. `'\n'` 连接成**一条**消息
7. `rev.splice(d + totalInserted, 0, ...roleMessages)`
8. 反转回来

**`seq` 是桶内注册顺序**（对应 ST 的扩展提示词 key 字典序）：

| seq | 来源 | 对应 key |
|---|---|---|
| 0 | 预设的绝对注入槽 | —— |
| 1 | 作者注释 | `'2_floating_prompt'` |
| 2 | 用户人设描述 | `'PERSONA_DESCRIPTION'` |
| 3 | 世界书 `@D` | `'customDepthWI_*'` |

> **净效果**：`injection_order` 越**低**，在可见顺序里越**靠前**（因为是在反转数组里 splice 再反转回来）。同深度不同角色读回来是 `assistant → user → system`。

### 其他语义

- `main` 即使停用也会作为**相对插入的锚点**加进去（内容为空）
- 深度注入活在 `chatHistory` 这个集合里 —— **关掉 `chatHistory` 槽会连带丢掉绝对注入 + 作者注释 + `@D`**
- `scenario_format = "{{scenario}}"`、`personality_format = "{{personality}}"` → 三个槽是三条独立消息

### 面板（`renderTavernPreset()`）

下拉选预设 + 导入 JSON + 另存副本 + 删除；每个槽一行：启用勾选 / 上下移动 / 展开编辑（名称、内容、角色、插入方式、深度、优先级、禁止覆盖、删除）。

---

## 七、请求组装（`buildRequestPlan(opts)`）

```js
{
  layout,      // 预览用的逐条布局（含 label / kind / role / text）
  messages,    // 真正发给 API 的 messages
  worldInfo,   // 本轮扫描结果
  preset,      // 当前预设
  hasHistorySlot, hasMainSlot
}
```

流程：

1. 建 `bucketText` / `bucketLabel` 助手（世界书八个桶）
2. 算 `anText` / `anPos`、`exampleRows`（`↑EM` / `↓EM` 折进去）
3. 建 `injections` 数组（`@D` 条目 `order: PM_DEFAULT_ORDER, seq: 3`；作者注释 `seq: 1`；人设 `seq: 2`）
4. 遍历 `preset.order`：
   - 槽停用 / `injectionTrigger` 不匹配 → 跳过
   - 绝对注入 → push 进 `injections`（`seq: 0`）
   - `dialogueExamples` / `chatHistory` → 刷出示例对话 / 聊天历史
   - 普通槽 → 出一行；`main` 还要在前后夹作者注释
5. `parts` → `finalLayout`：`rows` / `exampleRows` / `applyDepthEntries(hist, injections)`

### `presetMarkerText(identifier, slot, ctx)`

决定每个槽的实际内容：

| identifier | 内容 |
|---|---|
| `main` | 卡的 `systemPrompt`（未 `forbid_overrides` 时）否则 `slot.content` |
| `jailbreak` | 卡的 `postHistoryInstructions` 否则 `slot.content` |
| `worldInfoBefore` / `worldInfoAfter` | 世界书桶 |
| `charDescription` / `charPersonality` / `scenario` | 卡字段 |
| `personaDescription` | **人设正文（仅位置 = 提示词内时）** |
| 其他 | `slot.content` |

---

## 八、结构预览（`renderTavernPreview()`）

把 `layout` 逐条画出来：角色标签（SYSTEM / USER / AI）、来源细类（`.p-main` / `.p-char` / `.p-example` / `.p-chat` / `.p-post`）、内容截断、字数。

底部有状态行汇总：世界书激活情况、`↑AT` / `↓AT` 条数、人设位置等。

---

## 九、状态与持久化

| 元素 | 说明 |
|---|---|
| `#ai-tavern-status` | 酒馆状态条（`setTavernStatus(msg, kind)`） |
| `aiConfig.tavernCard` | 当前角色卡 |
| `aiConfig.tavernLore` | 当前世界书（卡自带或单独导入） |
| `aiConfig.tavernTimed` | 黏性 / 冷却 / `msgCount` |

`persistTavern()` 写 `localStorage.aiChatConfig`。

`clearTavernData()` 清空卡与世界书。

`adoptBookSettings(book)` / `wiBookDeclaredNote(book)`：书里声明了、但 ST 不会自动采纳的全局设置，界面上单独提示（不静默覆盖用户的全局设置）。

---

## 十、测试关注点

- **新增「应用填」的槽会让 layout 行数变化**，`verify_tavern.js` 的 T27–T56 是硬编码下标，历史上已经因为加槽碎过三次，现在全部改成**相对锚点**断言（找哨兵字符串的下标再比较）
- 同深度不同角色的时间顺序是 `assistant → user → system`（ST 在倒序数组同一位置 splice 再倒回来）
- `verify_worldinfo.js` 的 D 段 / M 段也全是相对断言
- 改任何扫描逻辑都要跑 `verify_worldinfo.js`（157 条）
