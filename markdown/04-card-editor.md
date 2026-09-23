# 04 · SillyTavern 角色卡编写器

> 对应代码（行号**会漂**，跳转请 `grep` 横幅原文，别照抄数字）：
> HTML —— 入口卡片 `#st-card` 在 `5421` 行、浮层 `#st-overlay` 在 `5460` 行；
> CSS —— `2355` 行起（`SillyTavern 角色卡编写器` 多行大横幅），到 `4106` 行的
> `Code（Agent）页` 横幅为止；
> JS —— 编写器的函数一律 `st*` 前缀，`const ST_TABS` 在 `14200` 行、
> `function stInit()` 在 `14255` 行、`function stSbParseDoc()` 在 `10123` 行。
> ⚠ 「当前卡名」那条链是 `renderStCard()`（`14366`）→ `stRenderNavName()`（`14358`）——
> 后者把名字同步给手机菜单里那个标注（`#mobile-nav-name`，在面板内、「角色卡编写器」下面），
> 见 02 的「手机比例下的入口菜单」。
>
> 功能：新建 / 编辑 / 改写角色卡，导出 PNG 或 JSON。左侧 **15 个选项卡**，可折叠。

---

## 一、入口与浮层

### 折叠入口卡片（`#st-card`）

```
🃏 SillyTavern 角色卡编写器              [⛶] [▲]
当前草稿：<名字>
```

- 点标题或 ⛶ → `openStEditor()` 全屏打开
- **「当前草稿」单独占一行**，且在 `.ai-collapse-wrapper` **外面** —— 收起来也看得见
- 这一行**不能**塞进标题栏：页面是 500 px 窄栏，标题 355 px + 按钮 105 px 已快占满，塞进去会把标题挤到换行，长名字时标签自己会被压成省略号

#### 展开键（`[▲]` → `toggleStArea()`）

按钮里那个箭头是 `.st-toggle-icon`，**照日历 `.toggle-icon` / AI 卡 `.ai-toggle-icon` 抄**：
同一个 `▲` 字形、同一套 `cubic-bezier(0.4, 0, 0.2, 1)`、同样转 180°、同样 **0.35s**。
折叠态写在容器上（`#st-card` 加 `ai-collapsed`），箭头靠
`.st-container.ai-collapsed .st-toggle-icon { transform: rotate(-180deg); }` 翻过去。

⚠⚠ **这套规则曾经整个漏掉**，而漏掉的形状很阴：
卡片**复用了 `.ai-*` 那套折叠机制**（容器 `ai-collapsed` + `.ai-collapse-wrapper`），
所以**折叠区自己动得好好的，只有箭头一动不动**。
⇒ **「内容收起来了没有」根本抓不到它** —— 必须**单独断言箭头**。
`_probe-stcard-anim.js` 实测修复前：箭头 `transform` 取值数 = **1**（从头到尾 `none`），
而卡片高度照样是 `92 → 259` 的渐变。守卫是 `smoke.js` 里那 8 条（含一个展开态对照组）。

⚠ **别把它跟浮层顶栏那个 `≡ 选项卡` 混为一谈** —— 那是**另一个**展开键（`stToggleTabs()` /
`stSyncTabsCollapsed()`），机制完全不同（`flex-basis` + 挂在祖先 `.st-shell` 上的 class）。
两个都叫「展开键」，但**改一个不会修另一个**；`_reverse8.js` 的探针 A/B 与 C 就是分开守它们的。

### 全屏浮层（`#st-overlay` → `#st-shell`）

```
#st-topbar      🃏 角色卡编写器 ｜ 副标题 ｜ ≡ 选项卡 📥 导入 📇 当前卡 ✚ 新建 ✕
#st-status      常驻提示条（导入 / 导出反馈）
.st-body
├── #st-tabs    左侧选项卡栏（可折叠成图标栏）
└── #st-panes   内容区（一次只渲染当前那一页）
```

- `position: fixed` 铺满视口，`z-index` 高于小游戏弹窗
- 打开时 `document.body.style.overflow = 'hidden'`
- 关闭方式：Esc / 点空白 / ✕

#### 折叠 / 展开键（顶栏那个 `≡ 选项卡`）

按钮里除了文字还有一个**会转的箭头**（`.st-tabs-ico`），折叠时 `rotate(-180deg)`。
⚠ **这套是照日历的 `.toggle-icon` 抄的**：同一个 `▲` 字形、同一套
`cubic-bezier(0.4, 0, 0.2, 1)`、同样 180°、同样 **0.35s**。

两条容易踩的：

- ⚠ **折叠态挂在 `.st-shell` 上，不是挂在 `.st-tabs` 上。** 展开键在**顶栏**，跟左侧栏是
  **堂兄弟** —— rail 自己的 class 驱动不了它。（日历那边图标就在容器**里面**，所以能挂容器。）
- ⚠ **箭头的时长必须跟左侧栏 `flex-basis` 那条一致。** 原来栏是 `0.22s ease`、而箭头
  **压根没有过渡**（按钮连子元素都没有）⇒ 折叠前后长得一模一样，是个不反映状态的死按钮。
  两边不同步的观感就是「动画不对」。

写进 DOM 只有**一处**：`stSyncTabsCollapsed()`（`stToggleTabs` / `renderStTabs` 都只调它）。
⚠ **别把 `classList.toggle` 再散回调用点** —— 漏掉任何一处的症状都是「状态 / 动画不对」，
而那是最难查的一类。守卫在 `smoke.js` 的「编写器：展开键」那 10 条里（含一个展开态对照组）。

---

## 二、十五个选项卡（`ST_TABS`）

| 顺序 | id | 图标 | 标签 | 管什么 |
|---|---|---|---|---|
| 1 | `name` | 📛 | 名字 | `name` + V3 的 `nickname` |
| 2 | `spec` | 🏷 | 类型 | V1 / V2 / V3 三选一 + 结构预览 |
| 3 | `desc` | 📝 | 角色描述 | `description` / `personality` / `scenario` / `mes_example` |
| 4 | `sys` | ⚙ | 系统提示词 | `system_prompt` / `post_history_instructions` / `depth_prompt` |
| 5 | `meta` | ℹ | 元信息 | 作者 / 版本 / 标签 / 备注 / 来源 |
| 6 | `ai` | 🤖 | AI 助手 | 给编写器用的 AI 配置（世界书扩写 / 开场白生成共用） |
| 7 | `book` | 📖 | 世界书 | 世界书名字 + 描述 + 条目（页顶挂 AI 扩写面板） |
| 8 | `greet` | 💬 | 开场白 | 主开场白 + 备选 + 群聊专用（页顶挂 AI 生成面板） |
| 9 | `regex` | 🔧 | 正则 | `regex_scripts`，五种生效范围 |
| 10 | `th` | 🧩 | 酒馆助手 | `tavern_helper` 脚本库 |
| 11 | `mvu` | 🧮 | MVU | 变量框架：检测 / 一键添加 / 可视化变量树 |
| 12 | `sb` | 🎨 | 状态栏 | 状态栏外观：图层 / 画布 / 属性，像编辑 PPT |
| 13 | `code` | ⌨ | Code | **Agent 会话**：模型调工具直接改卡，左边实时看 JSON |
| 14 | `persona` | 🎭 | 人设生成器 | 写一句设定，AI 按一份**可自定义的模板**逐项填好，生成一整份人设（见 §十六） |
| 15 | `export` | 💾 | 导出 | PNG / JSON + JSON 预览 + 自检 |

⚠ **`persona` 排在 `code` 后面**（用户指定），别按「它产出的东西是角色描述」顺手挪回
`desc` 旁边 —— 那是个看起来更合理的错位。⚠ 另外**本章的节号顺序跟这张表不一致**
（§十六 人设生成器 在 §十七 Code **之前**）：节号按「功能先来后到」排，表按选项卡顺序排，
两者不必对齐，改一处别顺手去改另一处。

**左侧栏折叠**：`#st-tabs` 加 `.st-tabs-collapsed` → 桌面宽度塌成 **46 px**，只剩图标
（标签仍在 DOM 里，靠 CSS 隐藏）。

**窄屏（≤760px）不做横向翻转** —— 收窄成 **62 px** 竖排（图标在上文字在下），
折叠后 **40 px**。这是按「选项卡放置在左侧」的需求做的，**不随断点改变位置**。

竖排后 `.st-tab-count` 徽章会掉到文字下面占一整行，所以钉到右上角（`position: absolute`）。

---

## 三、草稿模型

### 结构（`stEditor`）

```js
{
  open, tab, tabsCollapsed,
  card,             // 草稿本体（stBlankCard() 的形状）
  avatar, avatarName,
  raw,              // 导入的原始 JSON（只在本次会话里留着）
  rawBook,          // 导入的原始 character_book（兜住书级字段）
  rawTh,            // 导入的原始 tavern_helper（兜住 variables）
  srcName,          // 来源文件名
  dirty, msg, lastExport,
  mvuOwn,           // 这张卡的 MVU 归不归本编辑器管（结构改动要不要回写）
  mvuSel, mvuOpen   // MVU 大纲的选中节点 / 各容器的展开态
}
```

### `stBlankCard()` 字段

```
spec / name / nickname
description / personality / scenario / mesExample
systemPrompt / postHistoryInstructions
depthPrompt / depthPromptDepth / depthPromptRole
creator / characterVersion / creatorNotes / tags / source
creationDate / modificationDate
firstMes / alternateGreetings / groupOnlyGreetings
bookName / bookDescription / bookEntries
regex
thScripts
mvu                // { nodes: [...] } —— MVU 变量树
```

### 规范化（`stNormalizeDraft`）

从 localStorage 或导入结果读回来的一律过一遍，脏数据全兜住。

### 虚拟字段

界面上是「一行一个 / 逗号分隔」的文本框，存的是数组：

| 虚拟字段 | 实字段 |
|---|---|
| `tagsText` | `tags` |
| `keysText` | 条目的 `keys` |
| `secondaryKeysText` | 条目的 `secondaryKeys` |
| `trimStringsText` | 条目的 `trimStrings` |
| `namesText` | 条目的 `names` |
| `sourceText` | `source` |

### 三态数字

`null` = 跟随全局（`stSetTri`）。`ST_NULLABLE_NUM` 里的字段留空 = 不设。

> ⚠️ 判断**必须按字段名**，不能看当前值的类型。早期版本分支顺序是 `typeof cur === 'number'` 在 `cur === null` **前面**，所以 `sticky` 填过一次变成 number 之后，再清空走 number 分支，`Number('') === 0` 被吃成 0。

---

## 四、路径读写

控件上写的是路径字符串：

```
'card.name'
'card.bookEntries[2].keysText'
'card.regex[0].placement'
'card.thScripts[0].buttons[1].name'
```

`stResolve(path)` 解析成 `{ obj, key }`。

**为什么用路径而不是每个控件一个 handler**：条目 / 脚本是动态增删的，写死函数名会随数量爆炸。

### 相关函数

| 函数 | 说明 |
|---|---|
| `stGet(path)` | 读 |
| `stSet(path, value)` | 写（按字段类型分流：boolean / number / 三态 / 数组 / 字符串） |
| `stSetTri(path, state)` | 三态数字 |
| `stToggleIn(path, value, on)` | 数组里增删一个值（checkbox 组用） |
| `stSetList(path, i, value)` | 按序号写列表 |
| `stSetGreeting(i, value)` | 按序号写开场白 |
| `stSetListText(path, value)` | 写「一行一个」的文本框 |
| `stListText(path)` | 读回来 |
| `stSplitList(text)` | 按换行 / 逗号切 |
| `stAfterSet(path)` | 变更后处理 |

### `stAfterSet` 的分流（保光标）

改一下下拉框就整页重画的话，光标会飞。所以按路径分流：

| 路径模式 | 处理 |
|---|---|
| `card.bookEntries[i].(comment\|keysText\|enabled)` | 只刷那一行的摘要 |
| `card.regex[i].(scriptName\|placement)` | 只刷那一行的摘要 |
| `card.thScripts[...]` 的节点名 / 类型 | 只刷那一行的摘要 |
| `card.name` | `stRefreshNameChrome()`（顶栏副标题 + 折叠卡片摘要） |
| `card.spec` | `stRerender()` |
| `*.position` | `stRerender()`（`@D` 才有的深度 / 角色要跟着显隐） |
| 其余 | 只存不重画 |

`stRerender()` 重画但**保住现场**：展开的条目、滚动位置、焦点与光标。

> ⚠️ 越界写列表会撑出空洞：`arr[99] = 'x'` 让开场白变成 100 个 `null`，导出就是一堆空值。`stSetList` 里加了 `i < 0 || i >= arr.length` 直接 return。

---

## 五、卡格式

### V1 / V2 / V3

| 版本 | 结构 |
|---|---|
| V1 | 扁平，无 `spec` / `data` / `character_book` / `extensions`；作者备注叫 `creatorcomment` |
| V2 | `{spec:'chara_card_v2', spec_version:'2.0', data:{…}}` |
| V3 | `{spec:'chara_card_v3', spec_version:'3.0', data:{…}}`，data 是 V2 超集，多 `nickname` / `group_only_greetings` / `source` / `creation_date` / `modification_date` / `assets`；世界书条目多一个**必填** `use_regex` |

**V3 里 `character_book` 仍然存在**（规范没删）。

### `extensions` 里的东西

规范里**没有** `depth_prompt` / `regex_scripts` / `tavern_helper` —— 规范要求放进 `data.extensions`，ST 和酒馆助手也是这么放的：

```
data.extensions = {
    depth_prompt:   { prompt, depth, role },
    regex_scripts:  [ … ],
    tavern_helper:  { scripts: [ … ], variables: { … } },
    …其他原样保留
}
```

`stExtraExtensions()` 会把**导入卡里本编辑器不管的** extensions 字段原样带回去（先剔掉 `depth_prompt` / `regex_scripts` / `world` / `character_book` / `tavern_helper`，免得被旧值盖住）。

---

## 六、序列化

| 函数 | 输出 |
|---|---|
| `stCardToStJson()` | 统一入口，按 `card.spec` 分发 |
| `stBookToJson()` | `character_book`（数组形式） |
| `stEntryToBookJson(e)` | 单条世界书条目 |
| `stRegexToRaw(r)` | `regex_scripts` |
| `stThScriptToRaw(s)` / `stThFolderToRaw(f)` | `tavern_helper.scripts` |
| `stDraftFromStJson(raw, srcName)` | 反向：JSON → 草稿 |

### 世界书条目（`character_book`）字段映射

规范字段：

```
keys / content / enabled / insertion_order / case_sensitive / name / priority /
id / comment / selective / secondary_keys / constant / position / extensions
```

- **`position` 只有 `before_char` / `after_char` 两档**
- 本应用真实的**八种**位置写在 `extensions.position`
- V3 数组条目多一个必填 `use_regex`

### 往返保真

导入时把原始对象存在 `stEditor.raw` / `rawBook` / `rawTh`，导出时 `Object.assign` 回去，保证：

- `rawTh.variables` 原样保留（它是 `scripts` 的**兄弟字段**，丢掉会静默删掉用户的卡内变量）
- 不认识的 extensions 键存活

---

## 七、PNG 导出

### 数据块格式

```
tEXt 块：keyword\0base64(UTF-8 JSON)
```

- keyword：`ccv3`（V3）/ `chara`（V1·V2）/ `ccv2`
- 内容 base64 编码（也兼容直接塞裸 JSON 的读入）
- 块插在 **IEND 之前**（和 ST 的 `writeCharacterCardToPng` 一个位置）
- 重写时**先丢掉旧的** `chara` / `ccv3` / `ccv2` 块

### 相关函数

| 函数 | 说明 |
|---|---|
| `stCrc32(bytes)` | 标准 CRC32 |
| `stPngChunk(type, data)` | `length(4) + type(4) + data + crc(4)` |
| `stB64Utf8(str)` | UTF-8 安全的 base64 |
| `stPngTextChunk(keyword, jsonText)` | 组一个 `tEXt` |
| `stInjectCardChunk(pngBytes, keyword, jsonText)` | 遍历块、丢旧、插新 |
| `stPlaceholderPng()` | 没选头像时画 400×600 占位图 |
| `stAvatarPngBytes()` | 头像 → PNG 字节（非 PNG 的先光栅化） |
| `stRasterToPng(dataUrl)` | 任意图片 → PNG |
| `stCanvasToBytes(cv)` | canvas → 字节 |
| `stDownload(filename, blob)` | 触发下载 |
| `stSafeFileName(s)` | 去掉文件名非法字符 |

> ⚠️ **`readPngTextChunks(buf)` 的入参可能是 `ArrayBuffer` 也可能是 `Uint8Array`。**
> 必须写 `new DataView(u8.buffer, u8.byteOffset, u8.byteLength)`；写 `new DataView(buf)` 时
> `Uint8Array` 会直接抛 `TypeError`（导入走 `File.arrayBuffer()` 能过，编辑器内部走
> `Uint8Array` 就炸）。

---

## 八、导入

### 三种入口

| 入口 | 处理器 | 接受 |
|---|---|---|
| 顶栏「📥 导入」 | `stOnImportPicked(ev)` | 角色卡 PNG / JSON |
| 酒馆助手页「📥 导入脚本」 | `stOnThImportPicked(ev)` | 裸 Script / `{scripts:[…]}` / 整张卡 |
| 导出页「📁 选择图片」 | `stOnAvatarPicked(ev)` | 头像图片 |

### 「这是不是一张卡」的判断（`stLooksLikeCard`）

**必须有这道门。** 编辑器走的是 lenient 解析，`{"hello":"world"}` 也会被收下变成一张空卡，用户只会以为「导入没反应」。

规则：至少命中一个角色卡字段名，否则抛错、**草稿不动**。

### 导入后的反馈

`stOnImportPicked` 的 try 块里：解析 → `stEditor.card = card` → `stSaveDraft()`。

> ⚠️ **`stSaveDraft()` 保证不抛。** 它拆成薄壳（try/catch，异常时 `return false`）+ `stSaveDraftInner()`。
> 早期版本里它会在**卡已经装好之后**才炸，异常冒到外层 catch → 报「导入失败」——
> 用户会以为卡没进来，其实已经进来了（只是没存草稿）。

草稿没存住时仍报「✅ 已读入」，只追加「⚠ 卡太大，这次没能存进浏览器草稿，刷新会丢」。

---

## 九、世界书页（`stPaneBook`）

- 页顶挂着 **AI 批量扩写面板**（`stAiExpandPanel`，见「十五、AI 助手」）——
  它生成的是**新条目**，追加到末尾
- 每一条条目自己的展开区**顶上**还挂着一个 **AI 单条改写面板**（`stAiEntryPanel`），
  只改这一条，可选是否参考其他条目
- 世界书**名字** + **描述**（书级字段）
- 条目列表，每条可展开编辑：
  - 备注 / 关键词 / 正文
  - 位置（八种）/ 深度 / 角色
  - 概率 / 排序 / 分组 / 分组权重
  - 六种生效时机（`triggers`）
  - 扫描深度 / 黏性 / 冷却 / 延迟
  - 常驻 / 选择性 / 次关键词 / 四种 selectiveLogic
  - 大小写敏感 / 整词匹配 / 正则
  - 六个 `match*` 开关
- 条目操作：上移 / 下移 / 复制 / 删除
- 全部展开 / 全部收起（`stCollapseEntries`）

`stEntryContentRaw(e)` 负责正文的**装饰器往返** —— `@@activate` 之类的行在界面上单独一行显示，导出时拼回正文首部。

---

## 十、正则页（`stPaneRegex`）

`regex_scripts` 条目：

| 字段 | 说明 |
|---|---|
| `scriptName` | 名称 |
| `findRegex` / `replaceString` | 查找 / 替换 |
| `placement` | 生效范围（数组） |
| `disabled` | 停用 |
| `markdownOnly` / `promptOnly` / `runOnEdit` | 三个开关 |
| `substituteRegex` | 宏替换模式 |
| `trimStrings` | 修剪字符串 |
| `minDepth` / `maxDepth` | 深度范围 |

**五种生效范围**（`ST_REGEX_PLACEMENT`，0 = 只在界面显示，不给这个选项）：

| 值 | 名称 |
|---|---|
| 1 | 用户输入 |
| 2 | AI 输出 |
| 3 | 斜杠命令 |
| 4 | 世界书 |
| 5 | 思维链 |

> 本应用**不会执行**正则脚本，只是把它们写进卡里。界面上明说了这点。

---

## 十一、酒馆助手页（`stPaneTh`）

写的是 `data.extensions.tavern_helper`。

### 存储形状

```
data.extensions.tavern_helper = { scripts: [节点树], variables: {…} }
```

**键名是 `tavern_helper`（下划线）**，不是 `TavernHelper` / `JS-Slash-Runner`。

老键 `TavernHelper_scripts` / `TavernHelper_characterScriptVariables` 只读、不再写回。

`scripts` 是**树**不是平表：

- 顶层放 Script 和 Folder
- Folder 自己的 `scripts` 里**只放 Script**（不嵌套文件夹）

### 节点字段

**Script**：

```js
{ type:'script', enabled, name, id, content, info,
  button: { enabled, buttons: [{ name, visible }] },
  data, export_with: { data, button } }
```

**Folder**：

```js
{ type:'folder', enabled, name, id, icon, color, scripts:[…] }
```

| 字段 | 界面 |
|---|---|
| `name` | 脚本名 / 文件夹名 |
| `content` | 正文 textarea |
| `info` | 作者备注 |
| `data` | JSON 文本框（`dataText` 虚拟字段） |
| `button.enabled` | 「显示悬浮按钮」勾选 |
| `button.buttons` | 按钮列表（增删改名 + `visible`） |
| `export_with.data` | 「导出时带上 data」勾选 |
| `export_with.button` | 「导出时带上按钮」勾选 |
| `icon` | Font Awesome 类名 |
| `color` | CSS 颜色 |

### 六个语义坑

1. **停用文件夹 = 停用里面所有脚本** —— 文件夹的 `enabled` 是闸门，UI 上整块变灰
2. **`export_with` 是导出期过滤器，不是运行期开关** —— `data:false` 把 `data` 清空、`button:false` 把按钮清空。**只作用于序列化，绝不动草稿**（否则用户一点导出就把自己写的数据抹了）
3. **`variables` 是 `scripts` 的兄弟字段** —— 整块读进来整块写回去，否则会静默删掉用户的卡内变量
4. **单脚本分享 = 裸 Script 对象** —— `JSON.stringify(x, null, 2)`，文件名 `酒馆助手脚本-<name>.json`。**没有** `{type, version, data}` 外壳（自己加壳会产出扩展读不了的文件）。导入侧三种都认
5. **`type` 缺失或未知时按 Script 兜住**（扩展也这么干），但导出**总是显式写 `type`**
6. **本应用不执行脚本** —— 只是写进卡里，界面上明说

### 计数（`stThCountScripts`）

递归数脚本，**文件夹里的也算**。标题写「N 个顶层节点 · 共 M 个脚本 · 启用 K 个」。

### DOM id 命名

`stThDomId(path)` 把路径转成 id 片段，再交给 `stInput` / `stArea` 等控件助手。

> ⚠️ **控件助手自己会加 `st-` 前缀**，所以传进去的 id 不能再带 `st-`。
> 传 `st-th-0-content` 会变成 `st-st-th-0-content`。

---

## 十二、MVU 变量框架页（`stPaneMvu`）

MVU（Magical Variable Update）是酒馆助手的变量框架：AI 在回复末尾输出结构化指令，
框架解析后改写楼层的 `stat_data`。**本应用不执行 MVU**，只负责把它需要的东西写进卡里。

### 一键添加会加什么

| 类别 | 数量 | 落在哪 |
|---|---|---|
| 脚本 | 2 | `data.extensions.tavern_helper.scripts` —— `MVU`（本体）+ `Zod`（结构校验） |
| 世界书 | 4 | `data.character_book.entries` |
| 正则 | 5 | `data.extensions.regex_scripts` |
| 占位符 | 1 | `first_mes` 末尾追加 `<StatusPlaceHolderImpl/>`（原本为空则整条设成它） |

四条世界书的确切设置：

| 名字 | 深度 | 位置 | order | 常驻 | 启用 |
|---|---|---|---|---|---|
| `[InitVar]请勿打开` | 4 | `@D`(atDepth) | 200 | 是 | **否**（MVU 只读禁用状态的 initvar） |
| `变量列表` | 0 | `@D` | 200 | 是 | 是 |
| `[mvu_update]变量更新规则` | 0 | `@D` | 200 | 是 | 是 |
| `[mvu_update]变量输出格式` | 4 | `@D` | 200 | 是 | 是 |

五条正则：`对AI隐藏变量更新` / `变量更新中美化` / `变量更新美化` /
`对AI隐藏状态栏` / `状态栏界面`。

> ⚠️ 一键添加是**幂等**的 —— 再点一次只补缺的那几类，不重复添加。

### 检测（`stMvuDetect`）

8 个徽章：MVU 脚本 / Zod 脚本 / `[InitVar]` / 变量列表 / 更新规则 / 输出格式 /
状态栏占位符 / `正则 N/5`。按钮文案随状态变：

| 状态 | 按钮 |
|---|---|
| 什么都没有 | ⚡ 一键添加 MVU |
| 缺一部分 | ⚡ 补齐缺失的组件 ＋ 🗑 移除 MVU |
| 齐了 | 🗑 移除 MVU |
| 齐了但 Zod 读不回来 | 🔗 接管这张卡的 MVU ＋ 🗑 移除 MVU |

> ⚠️ **正则必须按脚本名认**，不能拿 `findRegex` 去 `test()` —— 那里存的是
> **源码字符串**（`<(update(?:variable)?)>`），匹配字面标签永远为假。
> 踩过：检测说「0/5」，移除只删得掉 5 条里的 2 条。

### 变量树与生成器

`card.mvu.nodes` 是一棵树，每个节点：

```
name / type / desc / value / int / min / max / options[] / children[]
```

`type` ∈ `ST_MVU_TYPES`：数值 / 文本 / 开关 / 枚举 / 对象 / 列表 / 动态表
（`ST_MVU_CONTAINER` 是后三种，可以挂子字段）。

三个生成器由结构实时算出：

- `stMvuZodCode()` → Zod 校验代码（含 `import` 与 `$(() => { registerMvuSchema(Schema); })`）
- `stMvuInitVarYaml()` → `[InitVar]` 的初始值 YAML
- `stMvuRulesYaml()` / `stMvuFormatYaml()` → 更新规则 / 输出格式 YAML

### 「编辑当前 MVU」的接管规则

判据只有一条：**卡里的 Zod 读不读得回来**（`stMvuZodParsed()`）。

| 情况 | 行为 |
|---|---|
| Zod 解析成功 | 反推成变量树，`mvuOwn = true`，结构改动自动回写 |
| Zod 解析失败 | **不接管**。结构可以编辑，但不回写；要覆盖必须用户点「接管」并确认 |

`stMvuParseZod()` 优先认 `registerMvuSchema(X)` 里那个标识符对应的 `z.object` 赋值；
没有 `registerMvuSchema` 时退一步找 `z.object` 赋值，但**必须只有一个候选** ——
多个候选说明认不准，宁可不管。

> ⚠️ 三件事都会静默销毁原作者的变量定义，都已堵死：
> ① 拿文件里**第一个** `z.object(` 当 schema（作者可能先写 `const Base = z.object({...})`）；
> ② 把「解析成空数组」当成「解析失败」（自己生成的 `z.object({})` 会被误判）；
> ③ `mvuOwn` 跨卡泄漏 —— 导入一张别人的 MVU 卡后仍是上一张的 `true`，而树是空的，
> 用户随手加一个变量就覆盖了原结构。`stMvuAfterLoad()` 负责在导入 / 载入后重判。

### 界面（`stMvuStatusHtml` / `stMvuOutlineHtml` / `stMvuInspectorHtml`）

左「变量大纲」+ 右「变量设置」两栏（`.st-mvu-split`）。窄屏堆成一栏。

- 大纲行：类型图标 · 变量名 · 类型标签 · 子字段数，容器可折叠
- 6 个「常用变量」快捷按钮（`ST_MVU_PRESETS`），加完**自动选中**
- 检查器字段随 `type` 变：数值出整数勾选 + 上下限 + 默认值；枚举出可选值列表；容器出「添加子字段」
- 底部 `<details>` 预览三种生成物

### DOM id 命名

`stMvuDomId(id)` = `'st-mvu-n-' + 去掉非法字符后取末 16 位`。

> ⚠️ 节点 id 是 uuid（含连字符），**不能**写成 `'st-mvu-' + id + '-field'` ——
> 那个元素不存在，断言会静默变成 `false`。

---

## 十三、MVU 状态栏外观页（`stPaneSb`）

> 对应代码：CSS `.st-sb-*`（`2836–3100` 一带），JS `stPaneSb` 起的整段「MVU 状态栏（外观）编辑器」

**这一页管什么**：聊天里那块状态栏长什么样。它在卡里**只是一条正则** —— MVU 五件套里
「状态栏界面」（`sbShow`）的 `replaceString`。所以「编辑外观」= 可视化地搭一段 HTML，
再写回那条正则。

### 数据模型（先于界面存在）

```
card.statusBar = {
  theme: 'dark' | 'light' | 'glass' | 'sakura' | 'terminal' | 'paper',
  width: 0,              // 0 = 自适应；>0 = 固定 px（上限 1200）
  shellExtra: '',        // 外壳上主题表达不了的声明（阴影 / 渐变…），追加在主题样式之后
  shellCls: '',          // 外壳元素上的 class（原稿的，生成器自己从不写）
  shellOff: [],          // 外壳上「原稿没写、生成器不该补」的属性名（见下文）
  pre: '', post: '',     // 围栏代码块**外面**的原文，写回时逐字节拼回去
  blocks: [ SbBlock ]    // 只存根层，子块挂在 row 的 children 上
}
SbBlock = { id, type, text, path, label, showLabel, showValue, min, max, count, icon,
            size, color, labelColor, emptyColor, valueColor, bold, align,
            height, gap, track,
            offX, offY,                                // ← 自由摆放的偏移（px）
            w, h,                                      // ← 显式尺寸（px，0 = 自适应）
            extra, extraInner, extraFill, wrapExtra,   // ← 「保原样」用的四层
            clsMap, clsOwn,                            // ← class 保原样（按 7 层）
            children }
```

`shellExtra` / `shellCls` / `shellOff` / 那四个 `*Extra` / `clsMap` / `clsOwn` 平时都是空的 ——
只有**解析别人的状态栏**时才会填上（见下文）。

`offX` / `offY` 和 `w` / `h` 是仅有的**默认就参与生成**的字段，但门槛都卡得很死：
**值为 0 时一条声明都不写**。这样「没动过的块」在产物里是逐字节干净的，第五轮那套逐字节 /
逐像素对照才成立（见「自由摆放」「调整大小」）。

⚠ `space` 块是例外：它的**高**不走 `h`，走它本来就有的 `height` 字段（那个字段在它身上
本来就是「高度」的意思，多开一个 `h` 只会让两个字段打架）。`w` 照常走 `w`。
`stSbSizeKeys(b)` 负责把这层差异收在一个地方。

`clsMap` 与 `clsOwn` 都是按 7 层存的（`outer` / `label` / `value` / `inner` / `fill` /
`empty` / `wrap`）：

| 字段 | 存什么 |
|---|---|
| `clsMap[层]` | 原稿挂在那一层的 class 名 |
| `clsOwn[层]` | 原稿在那一层的内联 `style` 里**真正写过**哪些属性名 |

`clsOwn` 是 `stSbLook` 的判据：这一层带 class 时，生成器只放行属性名在这份名单里的声明 ——
其余的长相归 class（或归浏览器默认），内联一写就把它盖住了。

9 种块（`ST_SB_BLOCKS`）：

| type | 图标 | 干什么 | 用得到的字段 |
|---|---|---|---|
| `title` | 🅣 | 小标题 | `text` `size` `align` `color` `bold` |
| `text` | 🅰 | 一段文字（可插宏） | 同上 |
| `var` | 🔢 | 变量值（左标签右数值） | `path` `label` `showLabel` `showValue` `size` `align` `color` `labelColor` `bold` |
| `bar` | 📊 | 进度条 | `path` `label` `min` `max` `height` `showLabel` `showValue` `color` `track` `labelColor` `valueColor` |
| `dots` | ◉ | 圆点（星级） | `path` `label` `min` `max` `count` `icon` `size` `align` `color` `labelColor` `emptyColor` `valueColor` |
| `row` | ⬓ | 一行多列（**唯一的容器**） | `gap` `children` |
| `divider` | ─ | 分割线 | `color` |
| `space` | ␣ | 空白 | `height` |
| `html` | ⌨ | 高级 HTML 兜底 | `text`（原样写出） |

三个颜色字段是有来历的：一张手写的状态栏里，**显示名**、**没点亮那排圆点**、
**右边那个数值**是三处互相独立的颜色。只留一个 `color` 的话，解析回来必然有两处
被主题色顶掉。`var` 不需要 `valueColor` —— 它的 `color` 本来就是数值的颜色。

### 三栏界面

```
.st-sb-top        版式模板（6 个）｜ 主题（6 个色块 + 宽度）
.st-sb-split      图层 ｜ 画布 ｜ 属性
                  （窄屏 ≤760px 堆成一栏）
                  ↑ 左栏从上到下：图层 → 预制块 → 块库
.st-sb-canvas     方格纸底 + 真渲染的状态栏
.st-sb-frame      真机预览（iframe，340px 高，浅灰底）+ 运行时体检
```

**画布是真渲染** —— 直接调 `stSbBlockHtml(b, /*sample*/ true, theme)`，不是示意图。
唯一的差别是变量值用 `stSbSampleOf()` 出的**示例值**（`0` / `中间值` / `—`），
否则画布上只会是一串 `{{...}}`。

每个块外面套一层 `.st-sb-hit` 命中框：只加轮廓（hover 细线 / 选中粗线 / 拖拽半透明），
**不碰块自己的内联样式**。左上角的类型徽章靠 `:hover > .st-sb-badge` 显示。

画布底下还挂着一个 **真机预览 iframe** —— 用跟写进卡里完全同一套包装，
宏换成示例值、`sandbox` 故意不给 `allow-same-origin`。它是为了回答
「玩家那边到底长什么样、到底显示不显示」，画布本身回答不了（画布用的是编辑器的 CSS）。
详见「真机预览 + 运行时体检」。

### 预制块（`ST_SB_PREFABS` / `stSbUserPrefabs`）

**四个入口，管四件不同的事**，别混：

| 入口 | 粒度 | 动作 | 来源 |
|---|---|---|---|
| 版式模板（6 个） | 整张 | **整套换掉**画布 | 产品写死（`ST_SB_TEMPLATES`） |
| **预制块**（16 个） | 一整组 | **往里加**一段 | 产品写死（`ST_SB_PREFABS`） |
| 块库（9 个） | 单个原子块 | 往里加一块 | 产品写死（`ST_SB_BLOCKS`） |
| **我的预制块** | 一整组 | 往里加一段 | **用户自己攒的 + AI 生成的**（localStorage） |

第 5 条路是**让 AI 生成**一组（见下），但它不直接动画布 —— 生成的东西落进「我的预制块」，
再点一下才进画布。**生成的结果必须先能反悔。**

内置那 16 个按用途分 5 类（`ST_SB_PREFAB_CATS`）：生命与属性 · 物品与经济 · 关系 ·
世界与剧情 · 通用。覆盖的是常见场景：生命值 / 生命 + 魔力 / 三项属性 / 等级与经验 /
物品栏（整串 + 三格）/ 金钱与阶段 / 好感度（星级 / 进度条 / 完整 / **多人竖排 / 多人横排**）/
时间与地点 / 主角状态 / 标题 + 分割线 / 两列数值。

每个预制块是一个 `{ id, icon, name, cat, hint, build(v) }`，`build` 拿到的 `v` 是
`stSbPrefabApi()` 造的一套小工具：`v.blk(type, bind, extra)` 造块、`v.row(kids, gap)` 造分组、
`v.bind(keys, def, opt)` / `v.many(keys, defs, opt)` / `v.free(num, label)` 绑变量。

#### 变量怎么绑（这是这一块的全部难点）

`stSbPrefabBind` 按**关键词**在卡里的 MVU 变量树里找（变量名里含关键词就算命中），
找不到就用兜底路径。三条要记住的：

- ⚠ **兜底路径照常写出去**。作者还没建变量时，块先摆好、路径先填好，回头在 MVU 页建一个
  同名的就通了 —— 这比丢一块「未选变量」强得多（后者用户根本不知道该往里填什么）。
  代价是**兜底路径在画布上看起来完全正常**（示例值照样画得出来）⇒
  加完必须当面说一句（`stSbPrefabNote`：几个绑上了、几个还是默认路径），**不能静默**。
- ⚠ **变量自己的 `min` / `max` 优先**（`stSbPrefabRange`）。跟 `stSbAutoPick` 同一条理由：
  作者在 MVU 页设过 0~5 的条，到这儿不能变成 0~100，不然永远画不满。
- ⚠ **`extra` 先应用、`bind` 后应用** —— 绑到的范围必须赢。踩过一次：星级预制块的 `extra`
  里带了一句 `max: 5`（本来是给「没绑上」那条兜底路准备的），结果把变量自己的上限也盖掉了 ——
  卡里 0~100 的好感度被压成 0~5，值 50 直接顶满，五颗星永远全亮。
  **要固定范围就往 `bind` 的兜底参数里写，别往 `extra` 里写。**

**复数版（多人好感度）走另一个函数**：`stSbPrefabBindMany` 先把卡里**所有**命中关键词的变量
按树序捞出来，有几个用几个，不够的用兜底路径补齐。
⚠ 不能写成「循环调 N 次 `stSbPrefabBind`」—— 那 N 次会按同一个关键词各找一遍，
而 `used` 表只挡「同一条路径」，于是三个槽全绑到同一个变量上，**还不报错**。

#### 自己攒预制块

| 动作 | 行为 |
|---|---|
| 存 | 选中一块 → 存**那一块**（连子树）；没选中 → 存**整张画布**。画布空 / 没填名字 → 当面说一句，不静默 |
| 覆盖 | 同名 = 覆盖，先 `confirm` 问一句。**「改一个已有的预制块」就是「重新存一遍同名」**，不另开重命名入口 —— 少一个入口就少一处「到底改了哪个」的歧义 |
| 插 | 点一下加进画布。⚠ **路径不再按关键词重绑** —— 他当初存的就是这一组，自动改路径反而是「悄悄动了我的东西」 |
| 删 | 只删这一份；画布上已经加进去的块不受影响（confirm 里写明） |

存储：`localStorage['stSbPrefabs']`，`{ v: 1, list: [...] }`。**跨卡共用，不进草稿** ——
换一张卡打开，自己攒的那些还得在（这是它跟版式模板的第三点区别）。

⚠ 存进去之前走 `stSbCloneBlocks`（过 `stSbBlockFromRaw` 那份白名单 + 换新 id），
读回来再走一遍同一份白名单 —— **存和读只有一套字段口径**，中间没有第二套。
两处长度闸门：单个 40 KB（`ST_SB_PF_ITEM_BYTES`）、整份 160 KB（`ST_SB_PF_TOTAL_BYTES`）；
条数上限 60。写失败（配额满 / 隐私模式）**必须说出去** —— 静默失败的表现是
「点了保存、看着像成功、下次打开没了」。

⚠ 读的时候**先卡「是不是个对象」再交给 `stSbBlockFromRaw`**。那个函数对垃圾输入是宽容的
（返回一个空白块），放在草稿解析那儿正合适（宁可留个空块也别让整张卡读不出来），
但在这儿不行：一个「全是垃圾」的预制块会变成一份**装着两个空文字块**的幽灵，
名字还在列表里，点进去却什么都没有。

⚠ 预制块 id 一律洗成**纯字母数字**（`stSbPfId`）—— 它要直接塞进 `onclick` 的单引号里。

⚠ 「存为预制块」那格输入框里的名字存在 `stEditor.sbPfName`，**不留在 DOM 里**：
`stRerender()` 会把整个 pane 重建，只写在 input 上的话，选一下画布上的块就把刚敲的名字冲掉了。

**目视确认**（图都在 `_verify/shots/`）：`prefab-panel.png`（16 个按钮分 5 类 + 「我的预制块」）·
`prefab-result.png`（点「生命值」+「好感度（多人 · 竖排）」后的画布，横幅写着
「1/3 个变量绑上了现成的，其余是默认路径」）·
`prefab-mine-saved.png` / `-after-reload.png` / `-inserted.png`
（存 → **刷新整页条目还在** → 清空画布 → 插回来 **2 块，与存之前一模一样**）。

⚠ **截图脚本不放 `_verify/`** —— 那儿的 runner 会因为目录里多出**未分类的 `.js`** 直接报硬错误。
脚本放系统临时目录，产物才写 `_verify/shots/`。
⚠ 顺带一条：`hp` / `affdots` 这类预制块本来就是**单块**（不是分组），
所以「递归块数 == 根层块数」在它们身上是**对的**；**别一看见「没嵌套」就当 bug**，
先去数那个预制块该出几块。

#### 让 AI 生成一组（2026-09-21）

上面「自己攒」要用户一块一块拼。多了一条路：**写一句中文，让模型拼好一组**。

位置在状态栏页左栏、块库下面：一格描述 + 一个「✨ 生成」按钮（`stSbAiRowHtml`）。
生成的东西**不直接进画布**，而是存进「我的预制块」—— 生成的结果必须先能反悔，
再点一下才进画布。

整条链**复用编写器已有的 AI 调用**，没有另起一套配置或请求：
`stAiCfg()`（`follow` 跟对话页 / `own` 用编写器自己的）→ `stAiReady(cfg)` →
`stAiChat(messages, { stream: false })` → `stAiJsonOf(text)` 抠 JSON → `stSbAiParse`。

三个设计决定，都是踩过之后定下来的：

- **只要块，不要 HTML。** 模型回 `{ name, icon, blocks: [...] }`，每个块过 `stSbBlockFromRaw`
  那份白名单（跟「自己攒」同一套字段口径）。**不让模型回一整段 HTML 字符串** ——
  那等于把「解析别人的手写状态栏」那条最难的路再走一遍，而且整段 HTML 没法过字段白名单。
- **把卡里真实的变量路径喂进提示词。** 不喂的话它会编 `stat_data.生命值`，而卡里那个叫 `hp`，
  生成出来全是死路径。提示词里带 `stSbVarPaths()` 的前 80 条（路径 + 类型 + 范围）。
  卡里还没建变量时明说一句，让它自己起 `stat_data.xxx`，并告诉用户「建了同名变量就通」。
- **不覆盖同名的。** 撞名就加编号（`stSbAiUniqueName`：`战斗面板` → `战斗面板 2`）。
  AI 生成是异步的，弹 `confirm` 问「要覆盖吗」会很别扭；静默覆盖别人的东西更糟。

**清洗**（`stSbAiClean`）：过白名单之外，还要把**「解析别人的手写状态栏时用来保原样」**
的那几组字段一律归零 —— `offX/offY/w/h`（自由摆放偏移与尺寸）、
`extra/extraInner/extraFill/wrapExtra`、`clsMap/clsOwn`（7 层 class 映射）。
它们存在的意义是「别动原作者写的东西」，而这里生成的是**全新的块**，
模型瞎猜一个偏移只会把外观锁死。递归，`row` 里的子块一样过。

**封顶两道，各自独立**：一次最多 24 块（`ST_SB_AI_MAX_BLOCKS`，含子块）、最深 3 层
（`ST_SB_AI_MAX_DEEP`）。超深时是**摊平**（把子块提到同一层）而不是**砍掉子树** ——
砍掉会把内容一起丢（`row>row>row>row>文字` 砍完只剩三个空 row → 被判「空块」整份拒收，
用户看到「AI 生成失败」而他明明给了内容）。**丢层级可以，丢内容不行。**

⚠ **踩过的坑（套件 G 段抓的）**：一开始只判了块数（`if (count.n > 24)`），
结果一棵「块不多但很深」的树整个绕过深度上限（5 块、深 5 层，两个数都没超 24）——
深度上限形同虚设。**任何一个超了都要裁**，判据是 `n > MAX_BLOCKS || deep > MAX_DEEP`。

⚠ 忙态（`stEditor.sbPfAiBusy`）**从状态渲染**，不能用「只改 DOM」那种做法：
`stRerender()` 会把整个 pane 重建，「⏳ 生成中…」一重绘就没了。
描述那格同理，存在 `stEditor.sbPfAiDesc`（跟「存为预制块」的名字格一个理由）。

结果怎么报：`✅ AI 生成了预制块「X」（N 块，h/m 条路径对得上卡里的变量（剩下的建了同名变量就通））`。
⚠ 跟预制块插入那边**同一个口径** —— 要说清几个绑上了，不能只报「成功」。
一组里一个 `path` 都没有时就不提这个数（不提 `0/0`）。

**三件没做的事**（诚实交代）：

| 没做 | 为什么 |
|---|---|
| 生成前给人过目 | 直接落进「我的预制块」，不弹预览。多一步确认 = 多一步「算了不用了」，而存下来是**可删**的 |
| 流式进度 | 要的是 JSON，边吐边解析没意义（`stream: false`）。只有「生成中…」这一档 |
| 让模型回 HTML 片段 | 见上「只要块，不要 HTML」。`html` 块本身是允许的（它就在 9 种原子块里），但**块要一个一个给**，不是丢一整段 HTML 让它自己排版 |

**目视确认**：`_verify/shots/sb9-ai-prefab.png`。
**专项套件**：`_verify/sb-verify9.js`（123 条）+ 反向测试 `_verify/_reverse11.js`（4 个探针）。

### 交互

| 动作 | 实现 |
|---|---|
| 点画布上的块 | `stSbSelect` —— 块自己的 `onclick` 里 `stopPropagation`，点空白处才取消选中 |
| **双击** | `stSbDblClick` —— 选中 + 把光标送进右边对应的输入框（`title/text/html→-text`，`var/bar/dots→-label`，`space→-h`，`row→-gap`，`divider→-color`） |
| 拖动块挪位置 | 指针事件（`stSbPtrDown/Move/Up`）—— 见「自由摆放」。默认开 |
| **拖把手改大小** | 选中块后四角 / 四边各有一个把手（8 向），指针事件 `stSbResizeDown/Move/Up` —— 见「调整大小」 |
| 拖块换顺序 | HTML5 DnD，`stSbDragOver` 判落点、`stSbMoveTo` 真移动。**自由摆放关掉之后才轮到它** |
| 拖进分组 | 落在 `row` 的**上下 25% 以外**的中间区域 → `mode='in'`，横坐标决定插在第几列 |
| 拖到最末 | 画布底部的 `.st-sb-dropend` |
| 方向键 | `stSbNudgeKey` —— 挪位置：1px；Shift 按住 10px；**Alt 按住改尺寸**（1px，Shift 十档）；Escape 取消选中。要先把焦点送进舞台（`stSbStageFocus`） |
| 图层行 | 展开折叠 / 选中（复用 `.st-mvu-row` 那一套样式，复古皮肤跟着有） |
| 属性面板 | 按 `type` 出字段；**每种块都有「自由摆放 px」的 X / Y 两格**，外加「尺寸 px」的 W / H 两格（`space` 只有 W，它的高在「高度」那格）；底部「复制 / 删除」+「⬓ 用分组包住 / 解散分组 / ⇤ 移出分组」 |

### 拖放的四个坑

> 这一节讲的是 **HTML5 DnD** 那条路（自由摆放关掉、拖块换顺序时走它）。

1. **不能拖进自己的子树** —— `stSbHasBlock(target, dragId)` 先挡。不挡的话块会被摘下来
   再插回自己里面，整棵子树消失。
2. **先摘再定位目标** —— `stSbMoveTo` 里若先算目标下标再 `splice` 摘除，下标就错位了。
3. **`dragleave` 要判 `relatedTarget`** —— 从父级移到子元素上也会触发父级的 `dragleave`，
   不判的话指示线一路闪。`if (to && el.contains(to)) return;`
4. **子级 `dragover` 要 `stopPropagation`** —— 否则事件冒到父级，落点判定被外层覆盖。

### 自由摆放（像素级挪位置）

「拖块换顺序」和「把块挪 3px」是两件事，**用同一套手势做不出来** —— 所以做成互斥的开关
（`stSbFreeOn()`，默认**开**，跟着草稿存）：

| | 自由摆放：开 | 自由摆放：关 |
|---|---|---|
| 拖动 | `stSbPtrDown` 指针事件，位移落成 `offX`/`offY` | `stSbDragStart`，HTML5 DnD 换顺序 |
| `draggable` | `false`（主动让位） | `true` |
| 画布提示 | 「自由摆放 · 拖着块随手挪」 | 「结构排序 · 拖着块换顺序」 |

两道闸都留着的话，拖一下会「既挪位置又换顺序」，没人能预期那是什么结果。所以
`stSbDragStart` 在自由摆放开着时**主动 `preventDefault()` 并直接返回**，不记 `stSbDragId`。

**为什么是指针事件而不是 DnD：** HTML5 拖放拿不到连续位移 —— `drag` 事件只给屏幕坐标，
`drop` 之后你就跟元素失联了，做不出「跟手挪」和「松手前就实时看到结果」。

#### 生成物里写成什么

```css
position: relative; left: Xpx; top: Ypx;
```

**相对定位，不是绝对定位。** 绝对定位（`position:absolute`）会脱流，运行时那边后面的块
会整个塌上来 —— 那就不是「把这块挪一点」，而是把整张排版砸了。相对定位只挪自己，
后面的块一动不动，跟编辑器画布里的效果对得上。

**两个偏移都是 0 时一条声明都不写**（`stSbOffCss` 直接返回空串）。这条是硬要求：
第五轮那套「产物逐字节 / 逐像素对照」的前提就是「没动过的东西不许出现在产物里」。

单条为 0 时也不写那一条 —— `left:0px` 和「没有 `left`」在渲染上等价，但会白白多几个字节。

#### 拖动的手感

| 细节 | 值 | 为什么 |
|---|---|---|
| 起步阈值 | 3px | 低于它不算拖，只当点击选中 —— 否则手抖一下块就歪了 |
| 吸附 | 按住 **Shift** → 8px 网格 | 想对齐时用；不按就是 1px |
| 方向键 | 1px；**Shift+方向键** → 10px | 像素级微调 |
| 范围 | `±800`（`ST_SB_OFF_MAX`） | 防手滑把块甩到十万八千里外 |
| 指针捕获 | `setPointerCapture` | 拖到画布外面也不丢 |
| 实时反馈 | `stSbPtrPaint` 只改**这一个**元素 | 不重画整张画布，拖起来才跟手 |
| 落库时机 | 松手（`stSbPtrUp` → `stSbAfterOff`） | 拖动过程中不写 localStorage、不重写正则 |

`stSbPaintCanvas` 与 `stRerender` 都会**记住画布内部的 `scrollTop` / `scrollLeft`**
再还原 —— 否则每挪一下画布就弹回顶上。

#### 解析别人的卡：`left` / `top` 读得回来

`stSbReadOffset(el)` 只认**`position` 恰好是 `relative`** 的元素，而且只认 `px` 单位的
`left` / `top`。两个边界：

- **`static` 元素上的 `left` 是无效的。** 读成偏移等于我们凭空补一句 `position:relative`，
  把原本不起作用的声明**变得起作用** —— 那是改人家的稿。所以一律不当偏移，原样进 `extra` 带走。
- **`absolute` / `fixed` 是脱流写法。** 那是人家自己的排版手法（悬浮角标之类），
  也不能当偏移读 —— 同样原样带走。

读回来的偏移排在 `stSbOwnMaps` 差集**之前**：先把它从 `style` 里摘出去，否则同一句
`left:8px` 会既进 `offX` 又进 `extra`，生成时写两遍。

**「纯定位壳」要拆掉。** 手写稿里常见

```html
<div style="position:relative;left:8px"><table>…</table></div>
```

这个壳什么结构都不像，会被兜底成高级 HTML 块 —— 而壳里的表格也一起进去了。
下一轮生成时块自己又写一次 `position:relative;left:8px`，壳 + 块就是**两层**，再解析一遍
偏移翻倍（8 → 16），越存越歪。

`stSbOffOnlyWrapper` 认的就是这种壳：`div`/`span`、`position:relative`、
`style` 里**只有** `position` / `left` / `top` 三个键、且里面只有一个孩子。认出来就把壳拆掉，
偏移**加到里面那个块上**（`inner.offX += off.x`）。

⚠ 它必须排在 `stSbParseEl` 的**兜底之前**、但在**所有结构识别之后**。放到最前面会压过结构识别 ——
裹着一条轨道的定位壳本该被认成进度条，提前拆壳就把它拆成高级 HTML 块了。

### 调整大小（显式尺寸）

「挪位置」和「改大小」是两条独立的轴：`offX`/`offY` 管**在哪**，`w`/`h` 管**多大**。
默认都不写 —— 不写就是「跟着内容 / 容器走」，也就是浏览器自己算出来的那个尺寸。

#### 生成物里写成什么

```css
width: Npx; height: Npx;
```

单条为 0 时只写另一条；两条都是 0 时 `stSbSizeCss(b)` 返回空串，**一条都不写**。

**偏移和尺寸在画布上的挂载点不一样**（这就是 `stSbBlockHtml` 那个 `noOff` 参数存在的原因）：

| | 偏移 `offX`/`offY` | 尺寸 `w`/`h` |
|---|---|---|
| 写进卡里 / 真机预览 | 写在**块自己**身上 | 写在**块自己**身上 |
| 编辑器画布 | 挂在外面那层 `.st-sb-hit` 命中框上 | **也写在块自己身上** |

偏移挂命中框，是因为命中框就是拖动时跟手挪的那个元素；块本身再写一遍就成了挪两次。
尺寸不能照抄这个做法 —— 命中框是自动宽度的块级元素，把 `width` 写它身上**块不会跟着变**，
改了个寂寞。所以尺寸两边都写块自己，命中框另外补一句 `width:fit-content` 把轮廓贴回块上。

#### 只认 px

`stSbReadSize` 只读 `px` 单位的 `width` / `height`。`%` / `calc(...)` / `em` 一律不认，
原样进 `extra` 带走 —— 那多半是原稿的排版手法（`calc()` 撑满一行之类），换算成 px
再写回去等于把人家的响应式写法改成死的。

#### 判据是「生成器基线」，不是「有没有值」

`stSbReadSize(b, el, base)` 的第三个参数是 `stSbSizeBaseline(b, themeId)`：把 `w`/`h`
清成 0 生成一遍，读回最外层的 `width` / `height`。

**为什么非要比这一遍：** 分割线自己就写着 `height:1px`，那是**生成器写的**，不是用户设的。
不比基线的话它会被读成「用户把高度设成了 1px」，下一轮多写一条，差集还会把原来那条
抄进 `extra` —— 一条声明变两条，逐字节对照当场就红（实测就是这么红的，见 bug 表）。

顺带一个容易踩的坑：`stSbSizeNum` 的**下限是 1 不是 8**。手写稿里真有 `height:1px`
这种写法，读进来夹到 8 就等于把人家改样了。8 只是**拖动**时的地板（`ST_SB_SIZE_MIN`），
防手一抖把块拖成 0 宽或负数。

#### 分割线要特判

```js
const base = stSbSizeNum(b.h) ? '' : 'height:1px;';
```

设过高度就别再写生成器那句 `height:1px` —— 同属性写两遍，后面那句虽然会赢，产物里白多一条。

#### 八向把手

`ST_SB_HANDLES = ['nw','n','ne','e','se','s','sw','w']`，只在**选中的那一块**上渲染。
理由很实在：每块八个把手，画布上 6 个块就是 48 个小方块，指针永远不知道该抓哪个。

把手是 `.st-sb-hit` 的绝对定位子元素（`margin:-5px 0 0 -5px` 把中心对到角 / 边中点上），
`z-index` 抬到命中框之上。有把手的时候徽章往右让一格
（`.st-sb-hit.st-sb-hh > .st-sb-badge { left: 11px }`）—— 左上角那个把手正好压在徽章头上。

| 方向 | 动什么 |
|---|---|
| `e` / `w` | 只动宽 |
| `n` / `s` | 只动高 |
| 四角 | 宽高一起动 |

#### 拖动：按内容盒算，不是边框盒

`stSbMeasureEl(el, axis)` 量的是**内容盒**（边框盒 − padding − border）。

因为写出去的 `width` 就是内容盒宽度。拿 `getBoundingClientRect().width`（边框盒）当起点的话，
只要块有 padding，第一次拖就会**跳一下** —— 差的正好是那点 padding。

**西 / 北边拖动时位置跟着走。** 拖 `w` 把手往右 20px，视觉上左边收进去 20px：
宽少了 20，`offX` 得加 20。`stSbResizeCalc` 在夹紧之后**从夹紧后的 w/h 反推**位置，
而不是先算位置再夹 —— 否则拖到下限以下，块会一边缩一边继续往右跑。

| 细节 | 值 |
|---|---|
| 起步阈值 | 2px |
| 吸附 | 按住 **Shift** → 8px 网格 |
| 下限 / 上限 | 8px（拖动地板）/ 2000px（`ST_SB_SIZE_MAX`） |
| 实时反馈 | `stSbResizePaint` 只动这一个块 + 它的命中框 |
| 落库时机 | 松手（`stSbResizeUp` → `stSbResizeCommit` → `stSbAfterOff`） |

`stSbResizeCommit` 只写**这次真正动过的那几个轴** —— 拖 `e` 只动宽，`h` 一个字节都不碰。

#### `Alt` + 方向键

| 组合 | 步长 |
|---|---|
| `方向键` | 挪位置 1px |
| `Shift` + `方向键` | 挪位置 10px |
| `Alt` + `方向键` | 改尺寸 1px |
| `Alt` + `Shift` + `方向键` | 改尺寸 10px |

一次按键只碰一个轴。**没设过尺寸时先量出当前大小当起点**（`stSbMeasureEl`）——
不然 `0 → 1` 会把块瞬间缩成 1px 宽。

#### 复原

- 单块：属性面板里的「⤡ 恢复默认尺寸」→ `stSbSizeReset(id)`（`space` 回到 `height:8`）
- 全部：画布顶栏的「⤡ 尺寸复原」→ `stSbSizeResetAll()`，**不碰偏移**（挪位置是另一回事）

### 回写闸门（三层）

```
① stEditor.sbOwn            「本编辑器接管了这张卡的状态栏」
② stSbDetect().state        'none' / 'mine' / 'foreign'
③ stSbSync(force)           force=true 才跳过 ②
```

- `stSbDetect` 只按 `replaceString` 里有没有 `<!--MVU_STATUS_BAR:…-->` 判 —— `mine` = 本编辑器画的
- `stSbSync()`（不带 force）在 `state !== 'mine'` 时**直接返回 false**。只认 `sbOwn` 不够：
  接管之后卡里那条又被别人换成手写 HTML 时 `sbOwn` 还是 `true`，下一次改个字号就会把人家的
  整段覆盖掉
- 只有「🔗 接管并覆盖」和「⇧ 用画布覆盖卡里」走 `stSbSync(true)`

### 结构怎么带回去

生成的 HTML 里有一条注释：

```html
<!--MVU_STATUS_BAR:<base64 of JSON.stringify(card.statusBar)>-->
```

它放在 **`<body>` 里面**（紧跟 `<body>` 之后）—— 注释不是元素，运行时不会多渲染、
解析时不会多出块，对「围栏 + `<body></body>`」那两条判定毫无影响。

- **base64** 而不是裸 JSON —— 裸 JSON 里的 `-->` 会把注释提前截断
- `stSbAdopt()` 从这条正则反推回块列表；读不回来就不接管
- 导出的 PNG / JSON 带着它转一圈回来还能接着编辑
- 围栏代码块**外面**的原文（`pre` / `post`）在这条注释管不着的地方，
  由 `statusBar.pre` / `statusBar.post` 单独带着，写回时逐字节拼回去

### 卡里已经有手写的状态栏：解析它

结构注释只有本编辑器画的才有。**别人手写的那条（`foreign`）本来只能整段覆盖** ——
那等于让作者推倒重来。所以加了一条路：把它拆回块列表。

```
🔍 解析卡里现有的状态栏   →  stSbParseDoc(replaceString)  →  块列表 + 主题 + 宽度 + shellExtra
```

**核心原则：拆不动的地方原样留成「高级 HTML」块。**
宁可留一块看不懂的，也不能悄悄丢掉 —— 丢了他也看不出来，等发现时原稿已经没了。

识别只看**内联 `style` 的形状**，不做真正的 CSS 计算（`stSbParseEl`）：

| 认成 | 判据 |
|---|---|
| `bar` | `overflow:hidden` 的容器，里面那层宽度是 `calc()`；或裹着这样一个容器的 wrapper |
| `dots` | `span[position:relative]` 的最后一个子 `span` 是 `overflow:hidden` + `calc()` 宽度 |
| `row` | `display:flex`，且**每个**子元素都带 `flex` / `flex-grow` |
| `var` | 自己没直接文字，且有一个「整段就是一个宏」的直接子元素 |
| `divider` | `hr`，或有底色且高 ≤ 2px，或有 `border-top` |
| `space` | 空的、有 `height`、没有底色 |
| `title` | 有文字 + 加粗 +（没有 `pre-wrap` **或**带生成器的签名 `margin:0 0 6px` + `line-height:1.4`） |
| `text` | 有文字，其余情况 |
| `html` | 以上都不像 |

`title` 那条判据为什么要两个条件：生成器的标题带 `white-space:pre-wrap`（见下文的 `<br>`），
所以「加粗 + 没有 pre-wrap」只认得出**别人手写**的标题；自己生成的标题得靠
`margin` + `line-height` 那对签名认回来。少了后半条，自往返会把标题读成「加粗的文字块」，
字号再反推 `-2` 就整个缩水一圈。

几个**故意不拆**的情况（拆了就是丢东西）：

- **句子里带宏**（`今天是 {{…}}，天气不错`）→ 留给文字块。只有「整段就是一个宏」才算变量块，
  否则前后那半句话会被吃掉
- **带 `style` 的行内标签**（`<b style="color:red">`）→ 高级块。文字块存的是纯文本，
  压下去颜色就没了。无样式的 `<b>` 才允许压
- **`<table>` / `<tr>` / `<td>`** → 高级块。「光壳」规则（只有一个子元素、没文字、样式只有布局属性）
  原本会把表格拆散，所以判定收紧了：只认 `div` / `span`，且白名单里**不含 `width` / `height`**
- **`<style>` / `<script>`** → 高级块原样保留，并在报告里单独计数

⚠ 上表说的「看内联 `style` 的形状」对手写稿够用，对**靠 class 的稿子**不够 ——
那种稿子每一层的内联都是空的，样式全在 `<head><style>` 里。所以「外壳」的识别
放宽成三条判据，**满足一条**即算盒子：

1. 内联里有边框 / 圆角 / 内边距 / 底色
2. 有 class，且有子元素
3. 有子元素，且自己会退化成高级块（说明它不是靠结构认出来的）

另外 `stSbFindDeep`（「往下钻找深一点的结构」）必须**只在独苗路径才递归** ——
`kids.length === 1 && !stSbOwnText(el)`。一层里有多个元素时也往下钻的话，
整张 class 面板会被误认成里面那一行圆点块，其余内容全丢（bug 26）。

反解出来的数值也要对得上：

- 进度条 / 圆点的 `min` / `max` 从 `calc(({{…}} - 下限) / 跨度 * N)` 反解
- 圆点个数 = 底排那串字符的长度，字符 = 第一个字
- 字号：标题是 `font-size - 2`，进度条表头是 `font-size + 2`（对回生成器的写法）
- 颜色：**是主题自己那一套就不写进块**（`stSbThemeColorOr`），继续跟着主题走 ——
  这样换主题时整块会一起变，而不是被一堆硬编码颜色钉死

### 保原样：把「原稿有、生成器不产出」的声明差出来

结构认出来还不够。作者的进度条轨道是深紫、圆点间距 9px、文字带发光 —— 这些生成器
**画不出来**。只还原结构的话，接管之后他那些细节全被主题的默认值顶掉了，那还叫什么解析。

做法是**把块生成一遍再读回来当基准，做差集**（`stSbOwnMaps` / `stSbExtraOf` / `stSbKeepStyle`）：

```
原稿元素的内联 style  −  生成器给同一个块写出来的 style  =  必须原样保住的声明
```

拿生成器自己的产物当基准，好处是解析器和生成器**永远共用一套判据** —— 以后改了生成器
（加条 `border`、换个默认色），这里不用跟着改，差集自动就对得上。

差异按元素分层存，写出去时追加在生成器样式**之后**（同属性后者胜）：

| 字段 | 挂在哪 | 覆盖哪些块 |
|---|---|---|
| `extra` | 块最外层元素 | 全部 |
| `extraInner` | 内部那层「底」 | `bar` 的轨道 / `dots` 装圆点的那层 |
| `extraFill` | 内部那层「亮」 | `bar` 的填充 / `dots` 的亮点层 |
| `wrapExtra` | 分组里那层「列」容器 | 直接挂在 `row` 下的子块 |
| `track` | （`bar` 的轨道底色，是个正经字段不是 extra） | `bar` |

比较前把两边都压成「去空白 + 小写」（`stSbNormCss`），免得 `margin:3px 0` 和
`margin: 3px  0` 这种只是写法不同的被当成两回事，白白塞进 `extra`。
生成器**已经写过**的声明不记 —— 记了就是同一属性写两遍，用户之后在面板上改字号 / 颜色就改不动了。

`track` 单独拎成字段而不是塞 `extraInner`：这样它在属性面板上看得见、改得动。
只在原稿的值**不等于**默认那层半透明灰（`ST_SB_BAR_TRACK_DEFAULT`）时才存 ——
否则每次自往返都会往 `extraInner` 里塞一条我们自己写出来的声明。

**属性面板里「原样保留的样式」那一节**把每层摊开给作者看，每层配一个「✕ 丢掉这一层」。
不塞进可编辑输入框（那是原稿原文，改坏了不如丢掉重来），但必须让他**看得见、删得掉** ——
不然他会以为这些是编辑器自己长出来的。

### `<br>` 与换行

原稿里的 `<br>` 会被 `stSbTextKeepBreaks` 换成 `\n`（而不是靠 `textContent` 直接吃掉）。
生成器的文字 / 标题块写 `white-space:pre-wrap`，渲染出来断行一样。

但 `pre-wrap` **不是无条件写的**了（`stSbPreWrap`）。原稿带 class 时：

| 情况 | 写不写 `pre-wrap` | 为什么 |
|---|---|---|
| 文字里确实有换行（原稿的 `<br>`） | **必须写** | 不写，那个换行会被浏览器压成一个空格 —— 真丢内容 |
| 原稿内联里自己写过 `white-space` | 写 | 顺着原稿 |
| 都没有（原稿靠 CSS 或浏览器默认 `normal`） | **不写** | 凭空插一句 `pre-wrap` 就是改样子：多余空格不再合并、行尾空格会露出来 |

不带 class 的层照旧无条件写 —— 生成物一直是这么写的，改了会动到字节。

⚠ 由此引出一个必须挡的坑：**文字 / 标题块里「确实有换行」时，`white-space` 不能进 `extra`**。
原稿写 `white-space:normal` 的话，差集会把它记下来、追加在 `pre-wrap` 之后 ——
后者胜，换行当场就没了。`stSbKeepStyle` 里专门把这条滤掉（只在这一种情况下滤）。
没有换行的时候就不拦：原稿写 `nowrap` / `pre` 那是它的样子，得留着。

副作用：DOM 上少了一个 `<br>` 元素。所以验证时**不能按元素个数硬比**（见测试章）。

### 外壳：认主题 + 保留表达不了的样式

外壳（最外层那个带边框 / 内边距 / 底色的 `div`）拆成两半：

1. **底色决定主题**（`stSbThemeOfStyle`）。主题管的是**块内部**的默认色（正文 / 次要 / 强调），
   所以先按底色精确匹配（10 分），不行再看明暗（4 分），再看正文色 / 圆角 / 字体。
   报告里会说明是「底色一致」还是「按明暗挑的」
2. **主题表达不了的声明**（阴影 / 渐变 / 毛玻璃 / `backdrop-filter`…）进 `statusBar.shellExtra`，
   追加在主题样式**之后**（同属性后者胜，所以它盖住主题）。
   顶栏给一个可编辑的文本框 + 「🧹 按主题重画外壳」按钮

`background` 只在**是纯色**时才交给主题；`linear-gradient(...)` 这种原样进 `shellExtra`。

#### 反过来：外壳上「生成器总会写」的属性要能关掉

生成器**无条件**写这 11 条（`ST_SB_SHELL_PROPS`）：`border` `border-radius` `padding`
`margin` `background` `color` `font-size` `line-height` `font-family` `box-sizing` `text-align`。

原稿没写哪条，就把哪条记进 `statusBar.shellOff`，生成时跳过。不关的话：

- 一张**根本没有外框**的状态栏（顶层几个 `div` 平铺，没有那个带边框的壳）
  会被硬套上一个主题盒子 —— 边框、底色、内边距、字体全冒出来
- 一个只有边框、没写 `font-family` 的壳，会被塞上主题的字体

`shellOff` 装满了 11 条 = 外壳退化成一个裸 `div`。顶栏有个「▢ 不套主题外框」按钮
可以整组开关。报告里会说明「原稿没有外壳 → 不套主题盒子」。

### 解析报告与还原

解析不是「悄悄做完就算了」——它会在状态区留一条报告，接管前还会把同一份内容写进
`confirm()` 让作者先过一眼：

- 认出了几个块、几个原样保留
- **保住了多少条自定义样式**（`keptDecls`，含 class 层）
- **几层挂着 class**、其中几层「光靠 class」（长相完全归那段 CSS）
- 外壳认作哪套主题（「底色一致」还是「按明暗挑的」）、外壳有没有 class、有没有附加样式
- 卡里带了几个 `<style>`（其中几个在 `<head>` 里）
- 围栏外的原文有多少字
- 🚫 不满足运行时的渲染条件时（`runtimeWhy`）当面告知「玩家那边看不到它」；
  一段里有多个合格代码块时提醒「玩家那边可能一起冒出来」

三个自检（都在 `stSbParseDoc` 里算完再返回，调用方拿到的是带结论的结果）：

1. **文字对得上** —— 解析完立刻再生成一遍，比两边「看得见的文字」
   （`stSbVisibleText`，去掉 `<style>` 内容、宏的两种写法先归一化）。结构认错了这里第一个露馅
2. **保留的声明真的写进去了** —— 把 `extra` 那几层里的每条声明拿去在产物里找。
   追加在末尾、同属性后者胜，所以只要字符串在，浏览器就一定会用最后那条。
   这条把「我希望差集是对的」变成「验过了」（`keepOk` / `keepMiss`）
3. **class 真的写进去了** —— 逐层查 `class="…"` 在不在产物里，外加外壳那个（`missingCls`）

解析会**立刻覆盖卡里那条正则**（不覆盖的话 `sbOwn` 是 true 但 `state` 还是 `foreign`，
之后的编辑会静默不写回 —— 那更糟）。原稿留在模块级的 `stSbParseBackup` 里，
**本次会话内**可以点「↩ 还原解析前的 HTML」退回去。不进草稿：那是几百行 HTML，
塞进 localStorage 只会把草稿挤爆。

### 生成物的硬约束

1. ~~不能有 `<style>` / `<script>`~~ —— **这条是错的，已推翻。**
   运行时（酒馆助手）判定「这段代码要渲染成界面」只看两个条件，满足之后它是把代码
   当作**一个独立网页塞进 iframe**，`<style>` / `<script>` / 外链资源**全都可用**。
   生成器自己不用 class 是为了「不依赖外部定义、块自带长相」，不是为了绕过什么限制。
   详见下一节
2. **进度条 / 圆点用 `{{get_message_variable::…}}`**（裸值）—— 要参与 CSS 的 `calc()`，
   `format_` 会带单位，塞进 `calc()` 就是语法错误、整条声明被丢掉
3. **`calc()` 前面先给一个兜底值** —— `width:0%;width:calc((…))`。宏取不回来时落到 `0%`，
   而不是炸版

### 按运行时规则解析（`stSbFences` / `stSbRuntimeInfo`）

> 原样解析 = **实际游玩时 MVU 框架怎么解析，编辑器就怎么解析**。

运行时判定「消息里哪一段会被渲染成界面」的条件是**两条同时满足**：

1. 代码在 ```` ``` ```` 围栏里（`~~~` 也行）
2. 代码里**同时有 `<body>` 和 `</body>`**

满足就整段当独立网页渲染。于是编辑器必须**按同一套规则找块**：

| 情形 | 编辑器怎么办 |
|---|---|
| 有合格的围栏块 | 就解析那一个；多出别的合格块 → 报告里提醒「玩家那边可能一起冒出来」 |
| 有围栏、但里面没有 `<body></body>` | **照样解析** —— 作者明明写了东西，得先读进来才谈得上帮他修。报告里 🚫 说明「玩家那边看不到，只会看到源码」 |
| 连围栏都没有 | 同上，退到「整段原文」当 HTML 解析 |
| 围栏**外**还有文字 / 别的代码块 | 原样存进 `statusBar.pre` / `statusBar.post`，写回时逐字节拼回围栏外面。运行时看不见它们，但那是作者写的东西，一个字节都不能动 |

**不合格的原稿写回时会被补成合格包装** —— 顺手就修好了。属性面板上有两个 textarea
能直接改围栏外的原文。

`<head>` 里的 `<style>` / `<link>` 也捞出来当高级块（排在块列表**最前** —— 样式块之间
靠先后定胜负），报告里单独计数。

结构注释（`<!--MVU_STATUS_BAR:<base64>-->`，存 `JSON.stringify(card.statusBar)`）放在
**`<body>` 里面**：注释不是元素，运行时不会多渲染、解析时不会多出块，
对「围栏 + `<body></body>`」那两条判定毫无影响。

### class 保原样（`clsMap` / `clsOwn` / `stSbLook`）

既然运行时是真 iframe、`<style>` 照常生效，那「`<style>.hp-k{color:#a891b8}</style>` +
`<span class="hp-k">`」就是**完全正当**的写法。生成器自己从不写 class，
所以原稿上的 class 一定是作者挂的 —— 一丢，那段 CSS 整个落空，而且**不报错**，只是样子不对。

class 按**层**存（`clsMap`，7 层：`outer` / `label` / `value` / `inner` / `fill` / `empty` / `wrap`，
外壳另有 `shellCls`），写回时照原样贴回去。

光贴 class 还不够 —— **内联永远赢过 class**。生成器照主题写一串内联上去，
作者 `<style>` 里按 class 定的那几条就全白写了（而且同样不报错）。
所以：

```
clsOwn[层]  =  原稿在这一层的内联 style 里**真正写过**哪些属性名
stSbLook(b, 层, css)  =  这一层带 class 时，只放行属性名在 clsOwn 里的那些声明
```

⚠ 关键在**粒度**。一开始按「层」判（「这层有没有任何内联声明」），结果手写稿里
`<span class="hp-k" style="font-size:13px">` 这种「字号自己写、颜色靠 class」的层
整层都被放过，颜色照样被主题色盖掉。改成按**属性**判才对：
`font-size` 留（原稿写过），`color` 删（归 class）。

- 不带 class 的层原样返回 —— 生成物一直是这么写的，动它会动到字节
- 结构性声明（flex 布局 / `position` / `overflow` / `calc()` 宽度）**不走这里**，
  那些是这个块能不能画出来的前提，得照写
- 返回值末尾补回 `;`：调用方常常把这截拼在中间（后面还接别的声明），
  少了分号会拼成 `font-size:13pxjustify-content:center`
- 空串时整个 `style` 属性不写（`stSbStyleAttr`）—— 留个 `style=""` 会改变产物的字节

报告里会把账数出来：「原稿有 N 层挂着 class → 全部原样带回产物，其中 M 层自己没写内联样式」。

### 真机预览 + 运行时体检

画布是编辑器自己画的（用的是编辑器的 CSS），跟**玩家实际看到的东西**不是一回事。
所以画布下面另挂一个 `iframe`（`stSbFrameHtml` / `stSbPaintPreview`）：

- 用**跟写进卡里完全同一套包装**（`stSbPreviewDoc`，只差宏换成示例值、不带结构注释）
- `sandbox="allow-scripts allow-forms allow-popups"` —— **故意不给 `allow-same-origin`**，
  跟运行时一样是隔离的
- `vw` / `vh` 以这个 iframe 为准（只有 `min-height:*vh` 被官方特判成以视口为准）
- 改画布 → 240ms 防抖后重设 `srcdoc`；文档没变就不动它（免得打字时预览一直闪）

旁边一条「运行时体检」（`stSbRuntimeReportHtml`）实时说明这段代码在玩家那边**会不会显示**：

| 状态 | 文案 |
|---|---|
| 合格 | 会渲染，代码块在围栏里、有 `<body></body>` |
| 合格但不止一个 | 提醒「玩家那边可能一起冒出来」 |
| 不合格 | 🚫 玩家那边看不到它，只会看到源码；写回时会补成合格包装 |

⚠ 体检那句要**先刷**。`stSbPaintPreview` 里「文档没变就 return」原本排在刷体检之前 ——
改了围栏外的原文时预览文档不变，体检栏就永远停在旧文案上。

### 数值夹紧（`ST_SB_NUM_RANGE`）

`size` 8~40 / `height` 1~60 / `count` 1~20 / `gap` 0~60。**按字段名夹，不能走通用的
「夹到 >= 0」** —— 那套会把 `min` / `max` 的负区间塌成 0，进度条永远画满。
`min` / `max` 走 `stSet` 里那条 `isRange` 分支，允许为负、允许 null。

### 局部刷新：属性面板不能整块重画

`stAfterSet` 对状态栏的默认动作是「重写正则 + 重画画布 + 刷图层那一行」，
**不重画属性面板** —— 字号 / 间距是在输入框里一个字一个字敲的，重画会把光标顶掉。

代价是有两处得单独补：

- **换 `type`** → 检查器的字段整组换掉，只能 `stRerender()`
- **改 `color`** → 旁边那个「跟随主题」按钮要跟着出现 / 消失，走 `stSbRefreshColorBtn()`：
  只替换颜色输入框的**兄弟节点**，输入框本身不碰（`input[type=color]` 在部分浏览器里
  是边拖边触发 `input` 的，把元素换掉取色器会当场断）

### 两处防爆栈的保护

- `stSet()`：`typeof cur === 'object'` 的叶子一律**拒绝写入**。块对象 / 变量节点 /
  `statusBar` 本身被一个标量顶掉之后，这一层就变成字符串，之后所有按 id 找块的遍历都会崩
- `stSbLocate()` / `stSbChain()`：用「一个参数都不带」识别「从根找起」，
  递归进来时 `list` 不是数组就当成**空列表**。早先写成 `list || 根列表`，
  任何一块的 `children` 是假值都会把递归拉回根数组 → 原地转圈。
  再叠一道深度上限 40，真出现环也只是找不到

### DOM id 命名

`stSbDomId(id)` = `'st-sb-n-' + 去掉非法字符后取末 16 位`。
画布上的命中框用 `data-sb="<id>"`，**不用 id 属性** —— 同一块在图层里已经占了一个 id。

---

## 十四、导出页（`stPaneExport`）

### 导出前自检

| 检查 | 提示 |
|---|---|
| 没填名字 | 「还没填角色名，导出时会写成「未命名角色」」 |
| V1 且装不下东西 | 「V1 装不下 世界书 / 正则 / 酒馆助手脚本 / 备选开场白，导出会丢掉」 |
| 没选头像 | 「PNG 会画一张占位图（JSON 不受影响）」 |
| 有正则 | 「本应用不会执行正则脚本」 |
| 有脚本 | 「本应用不会执行酒馆助手脚本，要跑得在装了酒馆助手的 SillyTavern 里」 |

### 头像

- 显示预览 + 文件名 + 大小
- 超过 `ST_AVATAR_MAX`（900 KB）时警告：**草稿不会把它存进浏览器存储，刷新后要重选**

### 输出

| 按钮 | 行为 |
|---|---|
| 🖼 导出 PNG 角色卡 | `stExportPng()` —— 写 `ccv3` / `chara` 块 |
| 📄 导出 JSON | `stExportJson()` —— 按当前 `spec` 写 |

底部有 JSON 预览（字符数 + 估算 tokens）。

---

## 十五、AI 助手（`stPaneAi` / `stAiExpandPanel` / `stAiEntryPanel` / `stAiGreetPanel`）

编写器自己会调 AI 干三件事：**把设定扩写成世界书条目**（批量新增）、
**改写指定的某一条条目**（单条，可选是否参考别的条目）、**按世界书生成开场白**。
配置页是第 6 个选项卡；批量面板挂在世界书页顶，单条面板挂在每一条条目自己的展开区里，
开场白面板挂在开场白页顶。三者共用同一份配置与同一个模型。

### 配置：两套来源，二选一

| 模式 | 取哪份配置 | 存哪 |
|---|---|---|
| `follow`（默认） | 现读【AI 对话】选项卡的 `aiConfig` | 不存，那边改这边跟着变 |
| `own` | 自己的 `stAi` | `localStorage['stAiCfg']` |

**`follow` 是「现读」不是「复制」** —— 用户在 AI 对话页换完服务商，这边下次点生成就是新的，
不需要「同步一下」这种按钮。协议按 Base URL 猜（含 `anthropic` / `claude` → anthropic）。

⚠ **配置一律不进卡。** `stAi` 存在自己的 localStorage 键里，草稿（`stCardDraft`）和导出的
JSON 里都不会出现 API Key 的影子。验证套件里有一条专门盯这个。

### 「第一段」：永远排在发给模型的最前面

两处配置各有一个「第一段」输入框 —— 【AI 对话】的高级设置里一个（`aiConfig.firstSeg`），
【AI 助手】页一个（`stAi.firstSeg`，跟随模式下是**只读镜像**，显示的是 AI 对话那份）。

它跟各功能面板自己拼的 `system` / `user` 是两回事：那两个是程序按参数生成的，
这一段**原样排在最前面**。三个功能面板共用一条出口 `stAiPlanMessages(plan)`：

```
第一段（role = system，空着就整条不发）
任务提示词 system
任务与素材 user
```

| 决定 | 为什么 |
|---|---|
| 角色是 `system` 不是 `user` | Anthropic 的 `messages` 必须以 `user` 开头，`system` 会被 `stAiSplitSystem` 提到顶层；用 `user` 塞在最前面会变成「先说话再给指令」，而且 OpenAI 那边 `system` 也更合语义。**这是两条协议下都能排在最前面的唯一写法** |
| 空着时**一条消息都不发** | 跟状态栏那套「零值零字节」同一条铁律 —— 没填过的用户，产物一个字节都不该变 |
| 不受「系统提示词」「酒馆模式」开关影响 | 它插在 `buildRequestPlan` 两条 `return` **之前**，所以开不开酒馆都在最前 |
| 编写器里只认 `{{char}}` | 编写器没有「用户昵称」这个概念；`{{user}}` 原样留着比替换成「你」更诚实。AI 对话那边则跟系统提示词一样走 `applyUserMacros`（`{{user}}` + `{{char}}` 都换） |
| 改了不重画 | 跟 `stAiUiSet` 同一条规矩：一个字一个字敲的输入框，重画会把光标顶掉 |

### 提示词结构预览（`stAiMsgPreview`）

四处都能把「将要发给模型的那几条消息」按编号摊开：**AI 助手页**（骨架：三个固定槽位 +
真实的第一段内容，另两条标成占位）、**世界书批量扩写面板**、**单条改写面板**、
**开场白面板**（后三处是**带真实内容**的）。

每一条显示 `#编号` + `role` 徽章 + 名字 + 字数 + 正文（超过 6000 字截断并注明）。
第一段那一条带 `st-p-first` 橙色左边框 —— 用户一眼要看的就是「它确实在最前面」。

底下跟一句**协议说明**，因为两种协议下「谁在最前面」的表现不一样：

- OpenAI 兼容：几条按编号原样进 `messages`，第 0 条就是模型最先读到的
- Anthropic：几条 `system` 合并进顶层 `system` 字段，`messages` 里只剩 `user`

⚠ **展开状态故意不进 `stAiUi`**，靠 `<details>` 自己管。存进状态就意味着每次 toggle
都要 `stRerender()` 重建整个 pane，滚动位置当场丢掉；而这几个 plan 纯粹是字符串拼接，
算一遍很便宜，不值得为它换一次重画。有一条断言专门盯「展开预览不会改动持久化的面板参数」。

### 预设服务商（`ST_AI_PROVIDERS`）

13 个：OpenAI / Anthropic / DeepSeek / Moonshot / 智谱 GLM / 通义千问 / 硅基流动 /
Gemini（兼容层）/ xAI / OpenRouter / Mistral / Ollama / 自定义。

每条带一个 `proto` 字段 —— **只有 Anthropic 是 `'anthropic'`，其余全是 OpenAI 兼容**。
界面上可以手动顶掉（`stAi.proto`，空串 = 跟着服务商走）。

### 双协议

| | OpenAI 兼容 | Anthropic |
|---|---|---|
| 路径 | `{base}/chat/completions` | `{base}/messages` |
| 认证 | `Authorization: Bearer <key>` | `x-api-key: <key>` |
| 版本头 | — | `anthropic-version: 2023-06-01` |
| 浏览器直连 | — | `anthropic-dangerous-direct-browser-access: true` |
| system | 留在 `messages` 里 | 提到顶层 `system` 字段 |
| 流式增量 | `choices[0].delta.content` | `content_block_delta` → `delta.text` |
| 非流式正文 | `choices[0].message.content` | `content[]` 里 `type:'text'` 的块 |

Anthropic 的 `messages` 有两条硬约束，`stAiSplitSystem` / `stAiMergeRoles` 一次处理掉：
**必须以 `user` 开头**、**不能有连续的相同角色**（合并成一条）。

`stAiRequest(cfg, messages, opts)` 是纯函数 —— 请求长什么样**单独抽出来**，
验证套件才能直接断言 URL / 头 / 体，而不是去猜「代码里写了」。

### 模型列表

`stAiFetchModels` 认四种形状：`{data:[{id}]}` / `{data:[{id,display_name}]}` /
裸数组 / `{models:[{name}]}`；顺手剥掉 Gemini 兼容层的 `models/` 前缀，去重后排序。

⚠ **拉模型时不能要求先有模型**（`stAiReady(cfg, {needModel:false})`）——
那一步本来就是为了挑模型，要求先有就成了死循环。

### 从回复里抠 JSON（`stAiJsonOf`）

模型很爱干三件事，全得兜住：加 ``` 围栏、加前后寒暄、留尾逗号。

1. 有围栏就取围栏里（模型自己划了边界）
2. 直接 parse，失败就把 `,]` / `,}` 的尾逗号修掉再 parse
3. 还不行就从第一个 `{` / `[` 切到最后一个 `}` / `]`（前后挂着寒暄）
4. 都不行 → `{ ok:false, error }`，界面上给出「可以点『复制原始回复』看看它到底说了什么」

`stAiPickArray` 负责从 `{entries:[…]}` / `{greetings:[…]}` / 裸数组里取出数组。

### 世界书扩写（`stAiExpandPanel`）

| 参数 | 说明 |
|---|---|
| 素材来源 | `card` 角色卡设定 / `book` 已有世界书 / `free` 自由输入 |
| 扩写要求 | **14 个**可多选的预设 chip（详细化 / YAML 化 / 结构化 / 精简 / 补规则 / 埋暗线 / 优化关键词…）+ 自由输入 |
| 氛围 | 14 个预设（日常温馨 / 紧张悬疑 / 黑暗沉重 / 浪漫暧昧 / 赛博科幻…）+ ✎ 自定义 |
| 正文格式 | 7 种（纯文本 / YAML / JSON / Markdown / 分点列表 / 剧本对话 / 键值对） |
| 新增条数 | 1 ~ 20，**写进 system 当硬约束** |
| 避免重复 | 勾上就把已有条目摘要也喂给模型 |

模型要回一个固定形状的 JSON：

```json
{"entries":[{"comment":"…","keys":["…"],"secondary_keys":[],
             "content":"…","constant":false,"position":0,"depth":4,"order":100}]}
```

`stAiEntryFromAi` 把每个对象整成我们自己的条目结构。**认不出来的字段一律退回默认值** ——
宁可少写一个字段，也不能让一条脏数据把世界书页渲染炸掉。越界的 `position` / `depth` / `order`
全部夹紧；正文和关键词都空的条目直接丢掉（留着只会在页面上变成一条看不见内容的空壳）。

生成完是**预览**，不直接落卡：列出每条的类型 / 关键词 / 位置 / 正文，点「全部加入世界书」才 push 进去。

### 单条改写（`stAiEntryPanel`）

世界书里**每一条**条目自己带一个折叠面板（`.st-ai-box.st-ai-inline`），
只改这一条，别的条目一个字不动。

| 参数 | 说明 |
|---|---|
| 参考其他条目 | 开关。打开才把别的条目喂给模型，免得改出来的东西跟别处打架 |
| 参考范围 | 3 个 chip：`仅启用` / `全部` / `同分组`（条目没有 `group` 时这个 chip 不渲染） |
| 改写要求 | 跟批量扩写**同一套** **14 个**预设 chip + 自由输入 |
| 氛围 | 同一套 14 个预设 + 自定义 |
| 正文格式 | 同一套 7 种 |
| 只改正文 | 勾上 = 只把新正文写回去，关键词 / 位置 / 深度 / 顺序全部保持原样 |

生成完同样是**预览**，两个按钮二选一：**替换本条**（写回第 i 条）/ **追加为新条目**（插在它后面）。

模型要回**一个对象**（不是数组）：

```json
{"comment":"…","keys":["…"],"secondary_keys":[],
 "content":"…","constant":false,"position":0,"depth":4,"order":100}
```

但模型习惯性包一层，所以 `stAiEntryRun` 把 `[{…}]` / `{entry:{…}}` / `{entries:[{…}]}`
三种包装都拆开认。

几条不能省的规矩：

- **状态按条目 `id` 记，不按下标**（`enOpenId` / `enPreview.id` / `enErrId` / `enMsgId`）。
  条目上移 / 下移 / 删除之后下标会漂，用下标记状态会让「展开的」和「报错的」跳到别人身上。
- **生成期间条目可能被删掉**，所以 `await` 回来之后要**按 id 重新找一遍**再往数组里写，
  找不到就给一句「这一条已经不在世界书里了」。
- **「参考其他条目」是三层过滤**（`stAiEntryRefRows`）：排除自己、排除空壳
  （没正文也没关键词，参考了等于没参考还白占额度）、再按范围过滤。
  `同分组` 在条目没有 `group` 时**静默退回「仅启用」**（`stAiEntryRefScope`）——
  不能给用户一个永远参考不到东西的选项。
- **不勾「只改正文」也要防空值覆盖**：模型给空 `keys` / 空 `comment` 就保留原来的，
  别把它偷懒的空数组当成「用户想清空」。
- **面板收着的时候一条参数都不渲染**。世界书动辄几十条，每条都铺开一整套
  （14 + 14 + 7 个 chip）光是按钮就上百个，而 `stRerender()` 每次都要整页重建一遍。
  展开状态靠 `ontoggle` 写回 `enOpenId`（**幂等** —— 新渲染出来的 `<details open>`
  也可能补一个 toggle 事件回来）。
- **错误 / 提示要认领到条目上**（`enErrId` / `enMsgId`）。不记的话，A 报的错会挂在 B 的面板上。

### 开场白生成（`stAiGreetPanel`）

「按世界书当时的深度和开放关闭状态」具体落在 `stAiInjectList()` 里：

1. `enabled === false` 的跳过（除非勾了「把已停用的也算进去」）
2. `position === Outlet` 的跳过 —— 运行时它也不插入正文
3. 正文为空的跳过
4. 先按位置分组：`↑Char → ↓Char → ↑AT → ↓AT → @D → ↑EM → ↓EM`
5. **`@D` 组内按 `depth` 从大到小** —— depth 是「插到倒数第几条消息之前」，
   数字越大离最后一条越远，所以排得越靠前
6. 同位置同深度再按 `order`，最后按原始下标，保证稳定

排好的顺序原样拼进提示词（`stAiInjectText`），面板上也能展开看。
开场时对话里只有这一条开场白，所以所有 `@D` 条目都会插在它之前 —— 这句话也写进提示词里了。

生成参数：段数 1~5、每段字数 100~3000、氛围（同一套预设）、额外要求、
写到哪（📌 覆盖主开场白 / ➕ 追加为备选）。

### 面板状态（`stAiUi`）

面板的参数**不是卡片数据**，单独存在 `stAiUi` 里（`localStorage['stAiUiCfg']`，不含任何密钥）。
`stRerender()` 会把整个 pane 的 innerHTML 重建一遍，输入框的值必须从状态里读回来，
否则用户敲一半就没了。

| 函数 | 什么时候用 |
|---|---|
| `stAiUiSet(k, v)` | 输入框 `oninput` —— **只写状态不重画**，重画会把光标顶掉 |
| `stAiUiSetR(k, v)` | 会让布局变样的控件（勾选「包含停用条目」要重排注入预览） |
| `stAiRepaint()` | 写状态 + `stRerender()`。chip 点击、换来源、换协议都走它 |
| `stAiRefreshCfgStatus()` | 只刷状态行 —— 模型名是在输入框里一个字一个字敲的 |

`<details class="st-ai-box">` 的展开状态也记在 `stAiUi`（`exOpen` / `grOpen` / `grShowInject`），
靠 `ontoggle` 写回 —— `stRerender` 只负责恢复 `.st-entry` 的 open，管不到它。

⚠ 持久化用**白名单** `ST_AI_UI_KEEP`，**读也按白名单**。曾经写成黑名单
（`if (k === 'running') return;`），而字段名其实是 `exRunning` / `grRunning` ——
于是一次「生成到一半刷新」就把 `exRunning: true` 存了下去，面板从此永远转圈、按钮按不动（bug 38）。
白名单的另一个好处：以后加新的运行时态字段，默认就是不存。

### 失败路径要说人话

- 401 / 500：带上状态码和响应体前 300 字符
- `Failed to fetch`：`stAiErrText` 翻译成三条排查建议（Base URL 写错 / CORS / 网络不通），
  Anthropic 那条专门点名 `anthropic-dangerous-direct-browser-access`
- 回复不是 JSON / 没有 `entries` / 解析出来全是空条目：各自一句能看懂的话
- 配置不全：**直接拦住不发请求**，并说清缺哪一项、去哪补

### DOM id 命名

`st-ai-provider` / `st-ai-proto` / `st-ai-base` / `st-ai-key` / `st-ai-model` /
`st-ai-model-list`（datalist）/ `st-ai-temp` / `st-ai-maxtok` / `st-ai-stream` /
`st-ai-cfg-status` / `st-ai-pull-btn` / `st-ai-test-btn` / `st-ai-firstseg`（第一段，跟随模式下只读）/
`st-ai-exfree` / `st-ai-exreq` / `st-ai-exmood` / `st-ai-excount` / `st-ai-exdepth` /
`st-ai-enreq-<i>` / `st-ai-enmood-<i>`（单条改写，**带条目下标** —— 每一条都有自己的一份）/
`st-ai-grmood` / `st-ai-grcount` / `st-ai-grlen` / `st-ai-grextra`。

---

## 十六、人设生成器（`stPanePersona`）

写一句设定 / 要求，AI 按一份**模板**逐项填好，生成一整份人设。跟「AI 助手」那三个面板
（世界书扩写 / 单条改写 / 开场白）是同一族：**生成的东西先给你过目、点一下才进卡**。

### 设计决定

1. **模板可改，存浏览器本地**（`localStorage` 键 `stPersonaTpl`），**不写进卡** ——
   跟 AI 配置同一条理由：它是用户自己的偏好，不是角色卡的一部分。
2. **生成结果不自动进卡。** 先在预览格里给你看、可以直接手改，点「写入」才进角色描述 ——
   「生成的东西必须先能反悔」，跟 §十三 的「AI 生成预制块」同一条规矩。
3. **写入前如果角色描述非空，弹 `confirm`。** 覆盖别人手写的内容是这一族里最不可逆的动作，
   不能静默做；追加那条路不用问（它不破坏已有内容）。
4. **「模板」那一块默认折叠起来**（第十二轮加的），**配置行**（`#st-persona-ai-status`，写着
   「当前生效：跟随全局…」）挪到它**下面**。模板有 42 行、文本框 `rows="14"`，摊开时面板太长；
   收起来之后一屏就能看完「要什么 → 生成 → 结果」。
   ⚠ 折叠态记在 `stEditor.personaTplOpen` 里、**不落盘** —— 落盘的话「默认折叠」只在第一次成立：
   用户展开过一次之后，以后每次打开编辑器都是摊开的。跟 `personaReq` / `personaOut` 一样当
   **会话级**面板状态。⚠ 切换时**只改 class，不调 `stRerender()`** —— 重绘会把整个 pane 重建，
   新元素一出生就带着最终样式，`grid-template-rows` 的过渡**没有起点**，动画会直接跳掉。
5. **生成器的「工作状态」贴在「✨ 生成人设」按钮正上方**（第十三轮加的，`#st-persona-msg`）。
   这些消息（「⏳ 正在让 AI 生成人设…」/「✅ 生成了 N 字符」/「❌ AI 生成失败…」）原本只往
   浮层**最上面**那条常驻条 `#st-status` 里写 —— 眼睛盯着按钮时它在视野外，**点了没反应，
   看着像坏了**。做法是给 `stExportMsg(text, kind, scope)` 加第三个参数：`scope: 'persona'`
   ⇒ 这条消息归人设页、进页内格，常驻条同时让位（**一条消息只出现在一个地方** —— 两边都写
   的话用户会看到同一句话两遍）。人设页没开着时自动退回常驻条，**消息不丢**。机制见 §十八。
   ⚠⚠ **别跟上面第 4 条那个「配置行」搞混**：`#st-persona-ai-status` 是「当前生效：跟随全局…」，
   建面板时算出来的静态行；`#st-persona-msg` 才是**工作状态**。**两个元素、两种语义**，
   面板上它们也确实挨在一起（配置行在模板折叠块下面、工作状态格在按钮上面，中间只隔几行）。
6. **生成结果可以存成一条世界书条目**（第十四轮加，第十五轮改取名来源）。结果区多一个
   「📖 追加到世界书」，点一下就用 `stBlankEntry()` 造一条新条目
   （`content` = 生成结果，`comment` 和 `keys` **都取生成结果里「姓名:」后面的字符**），
   `push` 进 `card.bookEntries` 后 `stSaveDraft()` + `stRerender()`。
   跟「追加到角色描述」同一条理由：**不覆盖任何东西，所以不弹 `confirm`**。
   ⚠ 一条既没有关键词、也不是常驻的条目**永远不会触发**，而「按钮点了、条目也建了、
   聊起来却像没生效」是最难查的一种坏 —— 所以取不到名字时**回落卡名**，两边都没有才留空。
   ⚠⚠ **回落必须说出来**：它把一次失败伪装成一次成功（条目照样建好、正文照样对、
   提示照样 `ok`），只有名字悄悄变成了卡名。所以提示会带上
   「生成结果里没有「姓名:」，用的是卡名」；两边都没有时降成 `warn` 并叫用户去补关键词。
   ⚠ 取值（`stPersonaNameFromOut`）只做**两种清洗**：归一 CRLF、剥行首 `- ` / `*` 和值两端的
   `*` / 反引号（模型偶尔整行加粗）。再多（截到第一个空格、去掉括号）会吃掉真正的名字，
   而那种错**看不出来**。
   ⚠ 别拿提示当判据 —— 那句「已追加到世界书（第 N 条）」报的是 `a.length`，
   `push` 真被拆掉时它**照样说成功**（`_reverse13.js` 的 R9 就是来钉这件事的）。
7. **「要不要拿角色卡名字当人物姓名」是个开关**（第十四轮加的）：`#st-persona-name-use`，
   放在「设定 / 要求」输入框**下面**（它跟要求一起构成**输入**，而不是跟生成按钮一起构成动作），
   默认**开**（卡名通常就是人物名）。关掉时 `stPersonaUserPrompt()` 里那一段
   「这张卡现在的名字」**整个不给**，让 AI 按用户写的设定自己起名。
   ⚠ **不是**「换个说法告诉它别用卡名」—— 不提就够了，提了反而把卡名**泄**给模型，
   而那正是用户想避免的。
   ⚠ 判据写成 `stEditor.personaNameUse !== false`，不是 `=== true`：没这个键的旧状态也按「开」算，
   否则升级上来的用户会突然发现卡名不再喂给 AI —— 一个**静默的行为变化**，
   而面板上那个勾选框照样显示「勾着」。跟 `personaTplOpen` 一样是**会话级**的、不落盘。
   ⚠ 卡里还没写名字时**不禁用**它（禁用看着像坏了），把事实写进标签：「（这张卡还没写名字）」。
8. **「追加到世界书」有一个跨点击的记账**（第十六轮加的）。点过一次之后再点，先弹一个
   **三选一**（`取消` / `覆盖` / `追加为新条目`），标题是「「<名字>」已经添加过了，请选择」。
   - 记账是 `stEditor.personaBookRef`，存的是**条目 `id`**，不是下标 —— 下标会被世界书页的
     增删改挪走。⚠ 世界书条目里**没有任何字段**能标出「这条是人设生成器写的」，所以只能自己记。
   - **覆盖**只改 `content` / `comment` / `keys`，条目对象本身留着（`id` 不变）⇒ 它还在原位，
     用户在世界书页里给它调过的启用开关 / 正则开关**不会被抹掉**。
   - **取消**等于什么都不做，**记账也不动** ⇒ 再点还会问。
   - **重新生成一份人设 ⇒ 记账清零**（在 `stPersonaRun()` 里），于是「第一次点直接追加、
     第二次点才问」—— 这就是需求里那句「重置计数，在第二次点击时再次显示」。
   - ⚠ 记账里那条**被用户在世界书页删了**时，当新条目处理，而且提示要**说出来**
     （「上一次那条已经不在了，这次当新条目」）—— 否则「点了却没弹窗」看着像记账失灵了。
   - ⚠ 弹窗**从状态渲染**（`stEditor.personaBookAsk`），不是凭空 `appendChild`：
     这样 `stRerender()` 重建面板时它不会掉、也不会出现两个。
   - ⚠ 它是 `position: fixed`，而 `#st-overlay` 带 `backdrop-filter`（**会改变 fixed 的包含块**）——
     正好 `#st-overlay` 是 `inset: 0`，所以弹窗仍然铺满视口。套件用**命中测试**
     （屏幕正中必须点到弹窗自己）钉住这件事：**量 rect 是量不出「被别的层盖住」的**。
   - ⚠ 弹窗里那三个按钮**不是一直都在**，所以套件点它们一律走**空安全**版本 ——
     直接 `.click()` 会在反向测试里抛 `TypeError`，套件当场炸掉、**连汇总行都没有**，那一针就白跑。
   - ⚠ 这段 CSS 放在 `<style>` **末尾是故意的**：往中间插会让后面所有锚点整体后移，
     而 README §2 那张锚点表是按行号写的。放末尾 = 零位移。
9. **四个按钮按下去都有反馈**（第十六轮加的），而且**都带人物名**：
   「已将「<名字>」写入角色描述」/「已将「<名字>」追加到角色描述」/
   「已将「<名字>」追加为新的世界书条目（第 N 条）」/「已复制「<名字>」的人设」。
   名字统一走 `stPersonaOutName(out)`（取「姓名:」，取不到回落卡名）——
   四个按钮说的是同一个人。⚠ 两处都没有时**整段省掉**，不印一对空引号（「已将「」写入…」）。

### 默认模板

`ST_PERSONA_TPL_DEFAULT` —— **逐字**照用户给的那一份，半角 / 全角冒号混用是原文如此
（`姓名:` 半角、`三围：` 全角）。**别「顺手统一」成一种**：它是给人看的填空稿。

```
基本信息: / 姓名: / 年龄: / 性别: / 身高: / 身份: / 背景故事:
外貌: / 发型: / 眼睛: / 肤色: / 脸型: / 体型: / 三围： / 气味：
衣着风格: / 校园/工作的日常装：/ - 风格： / - 标志性穿着： / - 配饰习惯：
休闲装: / - 风格： / - 标志性穿着： / - 配饰习惯：
居家服: / - 风格： / - 标志性穿着： / - 配饰习惯：
泳装： / 内衣：
性格: / 核心特质: / 恋爱特质: / 生活习惯: / 情绪表现:
愤怒时: / 高兴时: / 缺点弱点: / 喜好厌恶: / 喜欢: / 讨厌: / 补充：
```

共 **42 行 / 36 个字段** —— `风格`、`标志性穿着`、`配饰习惯` 各出现 3 次（三种装束各一份），
`stPersonaLabels()` 去重后算一项。

### 状态字段（都挂在 `stEditor` 上）

| 字段 | 是什么 |
|---|---|
| `personaReq` | 用户写的设定 / 要求（上限 2 000 字符） |
| `personaOut` | 生成结果（可手改，上限 20 000 字符） |
| `personaBusy` | 忙态 |
| `personaTpl` | 自定义模板。**`null` = 还没从 `localStorage` 读过**（懒加载） |
| `personaTplOpen` | 「模板」折叠块展开没有。**默认 `false`（收起）**，**不落盘**（见上面第 4 条） |
| `personaNameUse` | 要不要把角色卡名字当人物姓名。**默认 `true`**，**不落盘**（见上面第 7 条） |
| `personaBookRef` | 「追加到世界书」上一次写出的**条目 `id`**。**默认 `null`**，**不落盘**（见上面第 8 条）。存 id 不存下标 |
| `personaBookAsk` | 非 `null` = 正弹着三选一，值是 `{ name }`。**不落盘**、**从状态渲染**（见上面第 8 条） |

⚠ **模板清空 = 回到默认**（面板上就是这么写的），所以有两条容易写错的规矩：

- `stPersonaTplSet('')` 时**删键**（`removeItem`）而不是存空串 —— 存了空串，
  「现在用的是不是默认」就再也分不出来，下次打开会显示一份空模板。
- `stPersonaTpl()` 在内存值是空串时**也要回落到默认** —— 否则清空之后面板会同时出现
  三种互相矛盾的说法：标签写「（默认）」（它问的是 `localStorage`）、框里是空的、
  点生成又报「模板是空的」。⚠ 这条是**写回归套件时才发现的**，`_reverse13.js` 的 R1 盯着它。

「现在用的是不是默认」要**问 `localStorage`**（`stPersonaTplIsDefault()`），不能拿当前值跟
常量比 —— 用户把自定义模板改得跟默认一模一样时，两种说法都没错，但**显示要跟存储一致**。

### 函数

| 函数 | 干什么 |
|---|---|
| `stPersonaTpl()` / `stPersonaTplSet(v)` / `stPersonaTplReset()` | 读 / 写 / 恢复默认（懒加载 + 空则回落 + 清空删键） |
| `stPersonaTplIsDefault()` | 问 `localStorage`：现在用的是不是默认模板 |
| `stSyncPersonaTplOpen()` / `stPersonaTplToggle()` | 折叠态写进 DOM 的**唯一**一处（跟 `stSyncTabsCollapsed` 同一条理由：容器 class 与箭头分两处写，漏一处就「状态不对」）+ 点一下切换 |
| `stPersonaReqSet(v)` / `stPersonaOutSet(v)` | 写状态（带截断） |
| `stPersonaNameUse()` / `stPersonaNameUseSet(v)` | 读 / 写「要不要拿卡名当人物姓名」。**读**那一端是 `!== false`（旧状态也按「开」算），**写**那一端是 `v !== false` |
| `stPersonaLabels(tpl)` | 从模板里数「有哪些字段」。只认**以冒号结尾**的行：`/^[\s\-]*([^:：\n]{1,12})[:：]\s*$/`，`- 风格：` 认成「风格」，重复的只算一次。两个用途：面板上显示「N 项」+ 生成完数「模型漏了几项」 |
| `stPersonaSysPrompt()` / `stPersonaUserPrompt(req, tpl)` | 拼提示词。user 里带上**用户的要求原文 + 模板全文**，以及**开关打开时**「这张卡现在的名字」 |
| `stPersonaText(raw)` | **只做围栏清洗**（`\`\`\`` 包着就去掉）。⚠ 再多的「智能」清洗（比如删掉开头那句「好的，这是人设：」）会顺手吃掉真正的第一行，而那种错**看不出来** —— 输出照样有内容、照样能写进卡 |
| `stPersonaNameFromOut(text)` | 从生成结果里取**「姓名:」后面的字符**（半角 `:` / 全角 `：` 都认）。「追加到世界书」的备注和关键词都用它。⚠ 先把 CRLF 归一成 LF —— JS 的 `.` **不匹配 `\r`**、多行模式下 `$` 也不认 `\r`，不归一化就会**整行匹配不上**，症状是「名字悄悄取不到、回落成卡名」。⚠ 只剥行首 `- ` / `*` 和值两端的 `*` / 反引号 |
| `stPersonaOutName(out)` | 生成结果里的**人物名** + `fromOut` 标记（四个按钮的反馈都用它）。取「姓名:」，取不到回落**卡名**；⚠ `fromOut` 是给提示用的 —— 「用的是卡名」从结果文本里看不出来，必须说出来。两处都没有时 `name` 是空串，调用方把「」整段省掉 |
| `stPersonaBookRefEntry()` | 按 `id` 找「上一次那个世界书条目」。找不到（被用户删了）返回 `null` ⇒ 调用方当新条目处理并说出来 |
| `stPersonaRun()` | 主流程：校验 → 忙态 → `stAiChat` → 清洗 → **记账清零** → 进状态 → 报「对上了几项」 |
| `stPersonaApply(mode)` | `'replace'` 写入角色描述 / `'append'` 追加到角色描述 / `'book'` **转给 `stPersonaBookStart()`**（见上面第 6、8 条）。追加时描述本来是空的就当写入（不留空行开头）；替换非空描述前弹 `confirm` |
| `stPersonaBookStart()` | 「追加到世界书」的入口：上一次那条还在 ⇒ 弹三选一；不在 ⇒ 直接 `stPersonaBookWrite('new')` |
| `stPersonaBookWrite(action)` | `'new'` 追加为新条目 / `'overwrite'` **只改 content / comment / keys**、条目对象留着（`id` 不变）。写完把 `personaBookRef` 更新成这一条的 `id`、关掉弹窗 |
| `stPersonaBookAnswer(choice)` | 弹窗三个出口：`'overwrite'` / `'new'` 转给上面那个；**其余（含 `'cancel'`）什么都不做**（记账也不动） |
| `stPersonaCopy()` | `navigator.clipboard`，失败退回 `textarea` + `execCommand` |
| `stPanePersona()` | 面板本身 |

### DOM id

`st-persona-req` / `st-persona-name-use`（「把角色卡名字当人物姓名」勾选框，在要求输入框**下面**）/
`st-persona-tpl` / `st-persona-run` / `st-persona-tpl-reset` /
`st-persona-ai-status`（**配置行**：「当前生效：…」）/ `st-persona-msg`（**工作状态**，
在生成按钮正上方，由 `stPaintMsg()` 刷，默认 `display:none`）/ `st-persona-out`
（**有结果才渲染**）/ `st-persona-write` / `st-persona-append` / `st-persona-to-book`
（「📖 追加到世界书」，同上）/ `st-persona-copy`（同上）。

折叠那一组：`st-persona-tpl-fold`（外层，挂 `.st-fold` / `.st-fold-open`）/
`st-persona-tpl-toggle`（折叠头，带 `aria-expanded`）/ `st-persona-tpl-body`（被折叠的网格）。

三选一弹窗那一组（**只在 `personaBookAsk` 非 `null` 时才渲染**）：
`st-persona-book-ask`（`position: fixed` 的整屏遮罩）/ `st-persona-book-ask-title`（标题）/
`st-persona-book-cancel` / `st-persona-book-overwrite` / `st-persona-book-new`。
⚠ 这三个按钮**不是一直都在** —— 套件点它们必须走空安全版本（见上面第 8 条最后一条 ⚠）。
⚠ 折叠头里的标题**仍然带 `.st-sub` 类** —— 它是「这份是默认还是自定义」的可见标签，
而且 `persona-verify.js` 就是按 `.st-sub` 找它、读它的 `textContent`（换类名那些断言会红）。

### 提示词

系统提示词是 6 条硬规则：**只输出填好的人设本身**（不要解释 / 寒暄 / 围栏 / 模板以外的标题）·
**严格照模板的结构和顺序**（`- ` 子项保持缩进）· 模板里没有的字段不要自己加 ·
**每一格写实**（外貌 / 衣着给具体颜色材质款式，身高 / 三围给具体数字，不许「普通」「未知」）·
用中文 · 整份 ≤ 1 200 字。

生成完那条提示会报 **「模板 N 项里对上了 M 项」**，漏项时是 `warn` 并说出漏了几项 ——
跟预制块那边报「几条路径对得上」同一个口径：**只说「成功」的话，模型悄悄改写了标题用户是看不见的**。

---

## 十七、Code（Agent）页（`stPaneCode`）

编写器里唯一一个**会让模型动手改卡**的地方。跟「AI 助手」那三个面板的区别是：
那边是「生成一段文本，你点一下才落卡」；这里是**模型自己调工具去改**，改完左边立刻能看到。

⚠ **「第一段」默认不加，但可以开。** 那一条原本只属于 AI 对话和 AI 助手那三个面板
（见「十五、AI 助手」）。后来加了开关（在思维强度弹层的「其它」里，**默认关**）——
打开之后发出去的就是 `第一段 → system → messages → tools`，第一段排在最前面。
默认关的理由：这个开关一打开就改变了「模型读到的第一句话」，属于**用户得自己知道**的改动；
而且 Code 页原来就是不带，加开关不能顺手改掉老行为。

| 开关 | 发出去的样子 |
|---|---|
| 关（默认，老行为） | `system（Code 自己拼的那条）+ 会话消息 + tools` |
| 开 | `第一段（system）+ system（Code 自己拼的那条）+ 会话消息 + tools` |
| 开，但第一段是空的 | 和「关」一样 —— **不发空消息**（和 AI 助手那边一致） |

⚠ 文本**只有一处**：在【AI 助手】页那一格里编辑，Code 页这边只放开关、显示字数和一行
「去那边改」的提示。**一页存两处迟早分叉**（谁都不知道该信哪边）。
⚠ 复用 `stAiFirstSegText()` 而不是重写一遍 —— 它已经处理了 `{{char}}` 替换和「空着就不发」。
⚠ 插入点在 `stCodeSysMsgs`，那是 Code 页消息的**唯一出口**（`stCodeSend` 只调它一个）。

### 布局

| 位置 | 内容 |
|---|---|
| 左栏（42%） | 角色卡 JSON，实时刷新，带语法上色 + 复制按钮 |
| 右栏 | Agent 会话：消息流 + 底部输入框（Ctrl+Enter 发送） |
| 顶部工具条 | 🧩 当前 skill 列表（弹层里有「从链接导入」输入框）/ ➕ 新会话 / 🕘 历史会话 / 🧠 思维强度 |

⚠ 整页要占满 `.st-main` 的高度，所以进这一页时给 `#st-panes` 加 `.st-code-mode`
（关掉外层滚动 + `padding: 0`），让左右两栏各自滚。**这个 class 每次渲染都要重设** ——
`innerHTML` 换了之后它会丢。

**窄屏 / 竖屏**（`max-width: 900px` 或 `orientation: portrait and max-width: 1100px`）
自动变单栏，工具条上出现「📄 Code / 💬 Agent」分段控件。`stCodeViewSet()` 只改
`.st-code-split` 的 `data-view` 属性 + 按钮 class，**不重画** —— 重画会把会话滚动位置丢掉。

### 数据模型

```js
stCode = {
    // 运行时（不进 localStorage）
    running, abort, err, step, trash, flashTimer,
    skillBusy, skillErr, skillMsg, skillUrl,
    // stCodeUi
    think: 'mid',          // off | low | mid | high
    view: 'card',          // 窄屏看哪一栏
    open: {},              // 四个折叠菜单的展开状态
    autoApply: true,       // 工具是否真的落卡
    // stCodeMemo
    memo: '',              // 项目记忆，一行一条（纯文本，不是数组）
    // stCodeSkills
    skills: [{ name, desc, body, file, triggers: [] }],
    // stCodeSessions
    sessionId,
    sessions: [{ id, title, ts, msgs: [], tasks: [], autoSkills: [] }]
}
```

⚠ **`triggers` / `tasks` / `autoSkills` 都是「跟着上一级走」的**：
`triggers` 挂在 skill 上（跟着 `stCodeSkills`），`tasks` 与 `autoSkills` 挂在**会话**上
（跟着 `stCodeSessions`）。这样切会话时清单和「已自动加载过哪些 skill」都跟着切，
不会串台。三样**都不进角色卡**。

⚠ **`memo` 是纯文本不是数组**。行数（`stCodeMemoCount`）是现数出来的，
没有第二个「条数」字段要维护 —— 多一个字段就多一处能对不上的地方。

会话消息是**内部统一格式**，发出去之前才转成协议要的样子：

```js
{ role: 'system' | 'user' | 'assistant' | 'tool' | 'note',
  content: '文本',
  calls?: [{ id, name, args }],          // assistant 要调的工具
  toolResults?: [{ id, name, text }] }   // tool 的结果
```

`note` 是我们自己给用户看的一句话提示（「用满 4 步了」），**不发给模型** ——
`stCodeSysMsgs` 和 `stCodeMessagesFor` **两处**都要过滤，只堵一处会漏。

### 协议层：两套协议的工具消息不一样

| | OpenAI 兼容 | Anthropic |
|---|---|---|
| 工具表 | `[{type:'function', function:{name, description, parameters}}]` | `[{name, description, input_schema}]` |
| assistant 要调工具 | `message.tool_calls[]`，`arguments` 是 **JSON 字符串** | `content[]` 里 `{type:'tool_use', id, name, input}` |
| 工具结果 | `{role:'tool', tool_call_id, content}` | `{role:'user', content:[{type:'tool_result', tool_use_id, content}]}` |
| 流式 | **一律关掉** | 同左 |

⚠ **Anthropic 那条不能走 `stAiSplitSystem`** —— 那个函数假设 `content` 是字符串，
工具消息的 `content` 是块数组，塞进去会变成 `"[object Object]"`。Code 页有自己一套
`stCodeMessagesFor`。

⚠ **连续的 `tool_result` 必须并进同一条 user**：Anthropic 不允许两条连续的 user。
一次调两个工具时，第二条结果要 `concat` 进上一条的 content 数组，而不是新开一条。

⚠ **一轮里只记一条 assistant**：文字和 `tool_calls` 是同一条消息的两半。拆成两条的话
Anthropic 那边就是连续两条 assistant（400），OpenAI 那边也会因为「带 `tool_calls`
的消息后面没紧跟 `tool`」而报错。

工具入参还得兜两种脏形状：Anthropic 给对象、OpenAI 给 JSON 字符串，
而字符串里可能裹着 ` ``` ` 围栏 —— 走 `stAiJsonOf` 抠一遍，抠不动就原样放进 `__raw`。

`stAiEndpoint()` 是这一轮从 `stAiRequest` 里抽出来的：**「发去哪、带什么头」只有这一处**，
`stAiRequest` 和 `stCodeRequest` 共用它。协议细节散成两份的那天，一定会出现「改了 A 忘了 B」。

### 工具表（19 个内置 + 工具型 skill）

⚠ 发给模型的那份和执行时校验的那份**都从 `stCodeToolDefs()` 来** —— 它等于
「静态 19 个 + 工具型 skill 注册进来的那些」。分成两处写的那天一定会出现
「模型看得见、但调不动」，或者反过来。

| 工具 | 干什么 | 安全性 |
|---|---|---|
| `read_card` | 读整卡 / 读一个字段 | 大值走 `stCodeBrief` 给**形状摘要**；`regex` / `thScripts` / `statusBar` / `mvu` 一律指路到专用工具 |
| `write_text` | 整段替换一个文本字段 | **白名单 15 个字段**，路径段数 ≤ 2 |
| `write_list` | 数组字段 replace / append / remove | 白名单 4 个字段，写入前去重 |
| `list_world_entries` | 列条目（编号 / id / 备注 / 关键词 / 状态 / 正文头 50 字） | — |
| `read_world_entry` | 读一条 | — |
| `add_world_entry` | 新增一条 | 正文为空直接拒 |
| `update_world_entry` | 改一条 | **空值不覆盖** |
| `delete_world_entry` | 删一条 | **进回收站，用户可撤回** |
| `list_skills` | 列已导入的 skill | — |
| `read_skill` | 读一个 skill 的正文 | 支持部分匹配 |
| `fetch_url` | 抓一个 http(s) 地址的文本 | **地址闸门**（见下），唯一会联网的工具 |
| `set_tasks` | 把工作计划写成界面上的清单 | **整表替换**，不是增量；上限 24 条 |
| `remember` | 追加一条项目记忆 | 单条 200 字、总量 4000 字，满了**拒绝**而不是截断 |
| `read_doc` | 读状态栏的 HTML / MVU 的 Zod 全文 | 手写的状态栏给**原文**并说明改不了 |
| `write_doc` | 整份写回状态栏 / MVU | **解析失败一律报错退回**；`foreign` 状态栏拒绝 |
| `read_regex` | 列正则清单 / 读一条 | 读 MVU 那几条时标注「这条就是状态栏」 |
| `write_regex` | 增 / 改 / 删一条正则 | **MVU 装的那几条拒绝改写**，只允许改开关 |
| `read_th` | 列脚本清单 / 读一个正文 | 读 MVU / Zod 脚本时标注 |
| `write_th` | 增 / 改 / 删一个脚本 | **MVU 核心与 Zod 脚本拒绝改写**，只允许改开关 |

⚠ **`fetch_url` 是唯一一个「页面代模型去访问外部」的工具**，所以闸门要写死在
`stCodeUrlGuard` 里，而不是靠工具描述劝模型：① 只认 `http` / `https`；
② 拒 `localhost` / `127.0.0.1` / `10.` `172.16.` `192.168.` / `*.local` 这类内网与本机地址
（否则模型能被诱导去戳本机服务）；③ 只回文本，二进制和超大响应直接报错；
④ 结果照旧走 `ST_CODE_TOOL_CHARS` 截断。工具描述里也写明「**这是浏览器代你访问，不是你能上网**」
—— 不写清楚的话，模型会以为拉到的内容一定是真的，从而把它当权威来源引用。

⚠ **`write_text` 的路径必须走白名单**。放模型自由写路径等于给它一个
「把 `card` 整个写成字符串」的机会 —— `stSet` 只写标量叶子，写坏了整块都没了。

⚠ **`stCodeFillEntry` / `stCodeFillRegex` / `stCodeFillTh` 里空值一律不覆盖**
（`content` / `comment` / `keys` / `secondaryKeys`）。模型偷懒给个空串 / 空数组，
不该被当成「用户想清空」。这跟单条改写那条铁律是同一条。
**例外**：`replaceString` 和脚本 `content` 允许是空串 —— 「匹配到就删掉」是正当写法，
MVU 的「对AI隐藏变量更新」那条就是空替换。

⚠ **删掉的条目留在 `stCode.trash` 里**，工具条上出现「↶ 撤回删除 (N)」。
模型误删一条手写条目是很疼的，而它自己不会知道。
⚠ 回收站里装的是 **`{ kind, item }` 包装**而不是裸条目（`kind` ∈ `book` / `regex` / `th`）——
正则和脚本的删除也走这里，撤回时必须知道该放回哪个数组。`stCodeUndoDelete` 按
`kind` 分流；早期只存裸条目的草稿也兼容（认成 `book`）。

工具自己炸了**不能把 Agent 循环带下去** —— `stCodeTool` 包一层 try/catch，
把「炸了」当成一次工具结果喂回给模型，让它自己决定下一步。
超长的工具结果（> 12000 字）会截断再加一句「结果太长，已截断」。

### 那几样「不是普通字段」的东西住在哪

**这是这一块最容易搞错的地方**：状态栏和 MVU 都不是卡上的字段，它们**寄生在别的容器里**。

| 看起来像 | 实际住在 | 往返通道 |
|---|---|---|
| 状态栏外观 | 「状态栏界面」那条正则的 `replaceString` | `stSbDocHtml` ↔ `stSbParseDoc`（HTML） |
| MVU 变量结构 | 写着 `registerMvuSchema` 的那条酒馆助手脚本的 `content` | `stMvuZodCode` ↔ `stMvuParseZod`（Zod 源码） |

`card.statusBar` / `card.mvu` 只是**编辑器的工作副本**，靠 `stSbSync` / `stMvuSync` 写回去。
所以对**别人的卡**来说，直接读 `card.statusBar` 读到的是个假象 —— `read_card` 因此
对这四样一律指路，不给读。

⚠ **危险点：模型把它们当普通条目删掉 / 改掉，等于把状态栏、MVU 整个抹了，
而且它自己不会知道**（没有任何报错，卡看起来还是好的）。所以 `stCodeEntryGuard`
是第一道闸：认出「这是 MVU / 状态栏自己的东西」就拦住，并告诉它该走哪条路。

```
stCodeEntryGuard(kind, item)
  regex: stMvuRegexKind(item) 命中 →
           sbShow      → 拒绝（「这条就是状态栏本身」，指路 write_doc）
           hide/wait/done/sbHide → 拒绝（「MVU 装的」，指路 MVU 页）
  th   : content 含 MagVarUpdate     → 拒绝（「MVU 的核心」）
         content 含 registerMvuSchema → 拒绝（「MVU 的变量结构」，指路 write_doc）
```

⚠ **唯一的例外是「只改开关」**（`stCodeOnlyToggle`）。关掉一条 MVU 正则是正当需求，
而且生成器压根不管 `disabled` / `enabled`，不会打架。

⚠ **`stCodeOnlyToggle` 必须先要求 `mode === 'update'`**。只看「参数里有没有多余字段」
是不够的：`{mode:'delete', id:'状态栏界面'}` 的参数集合**恰好也在白名单里** ——
于是「删掉状态栏」会被放行。这不是理论问题，套件当场抓到过（E6）。

### 为什么正则 / 脚本按条目改，而状态栏 / MVU 整份替换

因为**容器的粒度不一样**：

- `card.regex[]` / `card.thScripts[]` 是**一列**，每一条都是独立的、用户自己写的东西。
  整列替换会**静默丢东西** —— 模型看不到的那几条会被它一起写没，而且没有报错。
  所以按条目操作（清单 → 读一条 → 增 / 改 / 删），它没提到的东西根本不会被碰到。
- 状态栏和 MVU 各自是**一份**。没有「第几条」这个概念，只能整份替换。
  改坏一整个状态栏比改坏一条世界书条目疼得多，所以解析失败一律**报错 + 原样退回**，
  绝不「尽力而为地写个大概进去」。

⚠ **`write_doc` 的 MVU 分支强制要求文本里有 `registerMvuSchema`**。作者常写
`const Base = z.object({…})` 再 `Base.extend({…})`，不指名的话很可能改到基底上去 ——
那是**静默销毁原作者的变量定义**。`stMvuParseZod` 也因此只在能定位到注册的那个
标识符时才解析。

⚠ **`stMvuParseZod` 的标识符要同时认 ASCII 和 CJK**（`ST_MVU_IDENT`）。中文社区的卡里
`const 角色 = z.object({…})` / `registerMvuSchema(角色)` 这种写法很常见；只写
`[A-Za-z_$]` 的话这类卡会**整个读不回来**，表现是「编辑器说认不出这张卡的 Zod」，
而用户完全不知道为什么，只会觉得「我这张卡明明是好的」。
把 `id` 插进 `RegExp` 之前要转义（`$` 在外面是行尾锚）。

### 大值给「形状摘要」，不硬截断

`stCodeBrief(v, max)`（`ST_CODE_BRIEF_CHARS = 3000`）：数组给「这个数组有 N 项、共 M 字」
+ 前 12 项的一行摘要；对象给键清单；字符串给开头。

⚠ **硬截断最坏的地方不是「少看到东西」，是模型看到的是一段看起来完整的 JSON** ——
它会当成全部，然后基于半截数据做决定。形状摘要至少让它知道自己没看到全部，
而且知道该去读哪一块。`read_card` 不带 `path`（整张卡）走的就是这条。

### 截断标记是一道闸门（`stCodeCutGuard`）

**读整份文档的那几个工具（`read_doc` / `read_card` / `read_regex` / `read_th` /
`read_skill` / `list_world_entries` / `read_world_entry` / `list_skills`）单独给
`ST_CODE_READ_CHARS = 32000`，其余工具还是 `ST_CODE_TOOL_CHARS = 12000`。**

⚠ **这一条是整套工具里唯一会无声损坏用户卡片的路径**：状态栏 HTML / Zod 源码轻松过
12000，`read_doc` 给出一截 → 模型「保持原样」把那截写回来 → `stSbParseDoc` 高高兴兴
解析这段**不完整但合法**的 HTML → 后半段块全没了，**全程没有任何一处报错**。

所以截断标记是常量（`ST_CODE_CUT_MARK`），而且是一道**闸门**：

| 位置 | 做什么 |
|---|---|
| `stCodeTool` | 结果超预算 → 切到 `cap` 再贴上标记（`cap` 由 `stCodeToolCap(name)` 定，只读给宽的那份） |
| `write_text` / `write_doc` | 见到标记**拒收**，并说清「读全了再写」 |
| `read_doc` | 带 `from` 参数分段接着读，一次给 `ST_CODE_DOC_CHUNK = 32000 - 600`（留余量放「第 N–M 字」「接着读 from=…」两行提示，否则刚切好的正文又被外面那层削一刀） |

⚠ 闸门要放在 `stCode.autoApply` 判断**之前** —— 关掉「真的改卡」时也得拦，
否则模型收到「只演示」的成功回执，以为写进去了，用户一开开关就丢数据。

⚠ 分段提示都放在**围栏外面** —— 模型要抄的是围栏里那段，提示抄进去就写脏了。

### system 提示词（`stCodeSystem`）

每次发请求现拼，按固定顺序：

| 节 | 内容 |
|---|---|
| 开头两句 | 「**你有工具，想改就直接改**，不要只给建议或只输出代码块」 |
| `## 怎么做` | 通用做法若干条，末条按思维强度选（`off` / `low` / `mid` / `high` 各一句） |
| `## 项目记忆` | 紧跟「怎么做」，**只在有记忆时出现** |
| `## 这张卡现在长什么样` | 名字、已填的文本字段、世界书条数、标签、**正则条数 / 脚本个数 / 状态栏有没有 / MVU 装没装** |
| `## 卡里那几样「不是普通字段」的东西住在哪` | 状态栏与 MVU 的落点、该用哪个工具、哪些写法会被拒 |
| `## 可用的 skill` / `## 已自动加载的 skill` | 见「skill 自动注入」 |
| `## 限制` | 步数上限、可写字段白名单、**正则 / 脚本 / 状态栏 / MVU 不在那份名单里** |

⚠ **卡里那几样必须报个数**。不报的话模型不知道卡里有没有，要么干脆不碰，
要么凭空去 `write_doc` 一个 —— **把已有的覆盖掉**。

⚠ **「限制」里要明说那四样不在字段白名单里**，否则模型会用 `write_text` 硬写
`statusBar` 之类的路径，撞上白名单被拒之后还得再猜一轮。

### Agent 循环（`stCodeSend`）

```
用户输入 → push user
  ↓ 循环（轮次上限 = steps + ST_CODE_READ_STEPS_MAX）
  发一次请求（非流式）
  ├─ 没有工具调用 → push assistant（没文字就 push 一条 note）→ 收尾
  └─ 有工具调用 → push 一条 assistant（文字 + calls）
                  每条工具 → 执行 → push 一条 tool 结果
                  → 继续下一轮
```

⚠ **非流式**。工具调用要拼成完整的一条消息，流式反而更麻烦（`tool_calls` 是分片来的）。
代价是等待期间看不到字，所以界面上给一个「正在思考 · 第 N 步」的闪烁气泡。

⚠ **只有「会动卡」的工具吃 `th.steps`**。`ST_CODE_READ_TOOLS` 里的只读工具不涨 `used`，
另配 `ST_CODE_READ_STEPS_MAX = 40` 兜住「一直读转圈」。不这么分的话，
「关」档才 4 步，读卡 + 读状态栏 + 读 Zod 就用掉 3 步，真正要改的那一下反而没预算了。

⚠ 循环里**必须 `for...of` + `await`**，不能 `forEach` —— 见下面「历史上修过的真 bug」。

### skill 怎么进来

浏览器读不了文件系统，所以一共**四条路**，都汇到同一个 `stCodeSkillsMerge`：

| 入口 | 怎么用 | 谁去取 |
|---|---|---|
| 📁 导入目录 | `webkitdirectory`，选 **skills 的上一层**，收里面所有 `SKILL.md` | 浏览器 |
| 📄 选文件 | 多选几个 `SKILL.md` / 工具型 `.js` | 浏览器 |
| 🔗 从链接导入 | 贴 `SKILL.md`（或工具型 `.js`）直链，或 GitHub 仓库 / 目录链接 | **页面**（`fetch`） |
| ⬇ 拖拽 | 把 `.md` / `.js` 文件或整个文件夹拖进 skill 面板 | 浏览器 |

`.md` 走 `stCodeSkillMeta` 解析 frontmatter（`name` / `description`）；**没有 frontmatter
的也能收** —— 拿正文第一个 `#` 标题当名字、第一段非标题文字当描述。
`.js` **必须带 `/*!MANIFEST*/` 才收**（仓库里普通 `.js` 太多：打包产物、配置，
全收进来就是一堆噪声）。同名以**后导入的**为准。

⚠ **仓库链接的树扫描只看 `SKILL.md`** —— 一个仓库里可能上百个 `.js`，全抓下来既要发
上百次请求，又基本全是打包产物。工具型 skill 是单个 `.js`，直接贴它那个文件的地址。

**从链接导入认四种形态**（`stCodeGhParts` 归一，用户复制地址栏里的东西是随机的）：

| 贴进来的 | 认成 | 怎么取 |
|---|---|---|
| `raw.githubusercontent.com/o/r/ref/路径` | 单个文件 | 直接拉 |
| `github.com/o/r/blob/ref/路径` | 单个文件 | 转成 raw |
| `github.com/o/r/tree/ref/目录` | 目录 | 走 API 列树，只挑路径以 `SKILL.md` 结尾的 |
| `github.com/o/r`（`/issues/3` 之类也当仓库根） | 仓库 | 先问一次 `default_branch`，再列树 |

⚠ **仓库根链接不能写死 `main`** —— 老仓库还是 `master`，写死就整个失败。得先问
`/repos/{o}/{r}` 拿 `default_branch`。

⚠ **未认证的 GitHub API 限流 60 次/小时**，所以这条要给出人话的错误，而不是把 403 原样抛出来。
单个文件的直链不走 API，不受这个限额。

⚠ **地址活在状态里（`stCode.skillUrl`），不能只放在 `<input>` 的 value 里** ——
`stCodeRepaint()` 会重建整个面板，一次重画（取回中、flash、别的面板动作）就把用户刚贴的
地址抹掉了。但它**不持久化**：地址里可能带私有仓库的 token，没必要留在磁盘上。

⚠ **导入的成败写 `stCode.skillErr` / `skillMsg`，不借 `stCode.err`** ——
后者只在会话为空时才渲染得出来，一旦有消息就静默丢了。

拖拽挂在**整个弹层**（`.st-code-pop`）上，不是挂在那行按钮上 —— 拖到面板任何位置都算。
`ondragover` 必须 `preventDefault()`，否则浏览器根本不触发 `ondrop`；
`ondragleave` 里要判断「是不是真的离开了容器」（`relatedTarget` 还在里面就不算），
不然子元素之间移动会疯狂闪。拖到面板**外面**要拦掉默认行为，否则浏览器会直接打开那个文件。

⚠ skill 存在 `localStorage` 里，**不进角色卡**（跟 AI 的 Key 一样）。
Agent 用 `list_skills` / `read_skill` 自己去读，不用用户手动贴。

### 两种 skill：知识型和工具型

⚠ **不是替换，是并存**：

| | `kind:'knowledge'`（默认，`.md`） | `kind:'tool'`（`.js` + manifest） |
|---|---|---|
| 怎么进来 | `SKILL.md` / 任意 `.md` | 开头有 `/*!MANIFEST {…}!*/` 的 `.js` |
| 干什么 | 正文**注入 system**，模型照着做 | **注册成一个工具**，模型直接调 |
| 谁执行 | 模型 | 沙盒 iframe |
| 碰得到卡吗 | 碰不到（它只是给模型的文字） | 默认碰不到；manifest 里申请 `card.read` / `card.write` 才碰得到 |
| 面板上 | 有触发词输入框 | 标 🧰，**不给**触发词框（它的 body 是源码，没有「正文进上下文」这回事）；申请了写就再标 `✏️ 能改卡`，申请了 `progress` 再标 `⏳ 能报进度` |

判别在 `stCodeSkillFromText` 一处：**先判工具**（一个 `.js` 里也可能有 frontmatter
式的东西，反过来判会把工具当知识，然后它就成了「一段没人看的说明书」）。

⚠ 两种在 system 里**必须分开讲**（`stCodeSystem` 把它们拆成 `toolSkills` /
`knowSkills`）—— 混在一起模型会去 `read_skill` 一个工具（读到的是源码），
或者把知识型当工具调（调不动）。`read_skill` 碰到工具型会**指回工具名**；
`stCodeSkillAuto` 的自动注入池也**只放知识型**。

⚠ 返回三态：skill 对象 / `{err}`（看得出是 skill 但装不了）/ `null`（不是 skill）。
中间那态不能省 —— 和 `null` 混起来，用户只会看到「一个能用的都没有」，然后回去猜。

### 工具型 skill 的沙盒

跑在 **`sandbox="allow-scripts"` 的 iframe** 里（**不给 `allow-same-origin`**），
文档自带 `default-src 'none'; script-src 'unsafe-inline'` 的 CSP。

⚠ **不用 Worker。** Worker 有 `fetch` / `importScripts` / `IndexedDB` / `WebSocket`，
而且**继承页面源** —— 它是「并发边界」，不是「安全边界」。

**下面四条是实测出来的**（Chrome，2026-09；探针跑完就删了）：

| 实测 | 结果 |
|---|---|
| 沙盒文档里 `fetch` | 被 CSP 挡掉（TypeError）✓ |
| `new Worker(blob:)` | 也被同一条 CSP 挡掉（`worker-src` 回落到 `default-src 'none'`） |
| 给 CSP 补 `worker-src blob:` | worker 起得来，但**它里面的 `fetch` 照样被挡**（CSP 会被 blob worker 继承）—— 所以真要用 Worker 也行，不过没必要 |
| **不透明源 = 跨源 → Chrome 把沙盒 iframe 放进另一个进程** | 里面死循环**不会**卡住父页面：实测父页面的 `setInterval` 照常跳，5e8 次空循环在沙盒里跑了 548ms 而父页面全程响应 |

⚠ 最后一条正是「超时掐得掉」（`ST_CODE_SANDBOX_MS = 5000`）的**依据**。它靠的是
**进程隔离，不是事件循环** —— 哪天浏览器不隔离了，超时就退化成「尽力而为」，
所以那个 timer 还是要留着（它是唯一能让 skill 卡住时给出提示的东西）。
`finish()` 里必须**拆掉 iframe**，否则死循环会一直烧 CPU 而用户什么都看不到。

契约：skill 定义 `function run(args) { … }`，`return` 值（或 Promise）就是工具结果。
`ST_CODE_SANDBOX_BOOT` 负责 `onmessage` → 调 `run` → `postMessage` 回来；
`postMessage` 前会把代码里的 `</script` 打断（不打断的话一个字符串常量就能提前闭合脚本，
那时候就不是「跑错了」，而是**跑别的去了**）。

### 工具型 skill 的权限：三层能力 + 一个「永远不给」

沙盒把 skill 关得**太死**了 —— 它连自己刚被调起来要干什么都读不到。所以给一条
**反向通道**：skill 里 `await host.call('read_card', {})`，父页面执行完把结果回信过去。

但「能给」和「该给」是两件事。能力按**危险程度**分层，manifest 里声明哪层就只给哪层：

| 能力 | 能调的工具 | 危险在哪 |
|---|---|---|
| `card.read` | `read_card` / `read_doc` / `read_regex` / `read_th` / `list_world_entries` / `read_world_entry` | 低 —— 它读到的东西**出不去**（CSP 断网），只能回给模型 |
| `card.write` | `write_text` / `write_list` / 世界书增删改 / `write_doc` / `write_regex` / `write_th` | **高 —— 真的会改用户的卡** |
| `progress` | **（空 —— 它不是一个工具）** | 低 —— 只能往用户界面写一行字；但有频率上限 |

⚠ `progress` 这一层在表里**故意映射到空数组**。它的通道是独立的 `__prog` 消息，
不走 `host.call`，所以它没有对应的工具名。它必须出现在 `ST_CODE_PERM_TOOLS` 的**键**里，
是因为 `stCodePermOfTool` / `stCodePermToolNames` 都从这张表取「这里有哪些能力」——
不在的话 `stCodeManifestOf` 会把申请了 `progress` 的 manifest 判成
「这里还没有这个能力」，用户拿到一个说不通的报错（功能明明刚加好）。
⚠ 反过来，`stCodePermToolNames` 里它**必须不出现** —— 拼进去会让 skill 去
`host.call('progress')`，那是个死路。

**三个「不给」，每一条都有理由：**

- ⚠ **`fetch_url` 永远不给**，任何能力层都没有它。它是唯一出网的通道，给了就等于把
  CSP 断网的意义抹掉一半 —— skill 能把刚读到的卡（私密角色设定）**拼进 URL 发到公网**。
  地址闸门挡的是「访问内网」，挡不住「把内容发出去」。**这是整套设计里最硬的一条。**
- ⚠ **`set_tasks` / `remember` 不给** —— 那是会话级的状态（任务清单 / 项目记忆），
  skill 用不上，给了只会污染。
- ⚠ **`read_skill` / `list_skills` 不给** —— 它们读的是**用户的 skill 库**，不是卡，
  所以不属于 `card.read`。这是**设计判断，不是漏登记**。

**闸门在哪：**

| 层 | 判断 | 为什么在这一层 |
|---|---|---|
| 导入（`stCodeManifestOf`） | 声明的 `perm` 里有宿主不认识的名字 → **拒收** | 硬装进去它调不到东西，只会给模型一堆失败，而用户不知道为什么 |
| 运行时（`stCodeSkillRun` 的 `onHost`） | ① 工具名在不在「能力 → 工具」表里 ② 这个 skill 申请到没有 ③ 次数上限 | ⚠ **不在沙盒里判断** —— 沙盒里的判断等于没判断（skill 能改自己的代码） |
| 底下 | 走的是**同一个 `stCodeToolRun`** | 另写一条写路径 = 把写白名单 / 回收站 / 「真的改卡」开关**全绕过去** |

⚠ **权限在导入那一刻定死，运行时不会临时给** —— 否则「申请」就成了摆设。
用户装一个带 `card.write` 的 skill，点「装」那一下就是明确同意，所以面板上必须
**一直标着** `✏️ 能改卡`（警示色），不能只在导入时提示一次。

⚠ **一次 run 最多 20 次宿主调用**（`ST_CODE_SANDBOX_RPC_MAX`）。不给上限的话
`while (1) { await host.call(...) }` 能在这 5 秒里把卡读上千遍 ——
**沙盒超时掐得掉沙盒，掐不掉父页面正在跑的那一串**。

⚠ 单次调用另有 `ST_CODE_SANDBOX_RPC_MS = 4000`（比总超时短），好让 skill 有机会
catch 到「这次调用失败了」然后自己决定怎么办，而不是整段一起被掐。

⚠ `host` 的 `onmessage` **必须先认回信分支**（`__hostRet`）再认 `__call` ——
反了的话回信会被当成一次新调用然后什么都不发生，**不报错，只是每个 `host.call` 都超时**。

⚠ 父页面收 RPC 时**也要验 `e.source === frame.contentWindow`** —— 页面上还有别的 iframe
（状态栏预览），不验的话它能冒充 skill 来调工具。

### skill 自报进度：为什么它和 `host.call` 不是同一条路

跑得久的 skill（逐条过 20 条世界书那种）在界面上是**没有任何反馈**的：
Agent 循环里工具是 `await` 串行的，每条工具跑完才重画一次界面。用户看到的是
「正在思考」一直转 —— 不知道是在干活还是卡死了。

所以给 skill 一条**单向**通道：`host.progress("第 3 / 20 条")`，
界面消息流下面实时换那一行。**它和 `host.call` 是两条不同的路**：

| | `host.call` | `host.progress` |
|---|---|---|
| 方向 | 请求-应答（等回信） | 单向（说完就走） |
| 返回值 | **Promise** | **`undefined`**（不是 Promise） |
| 占 RPC 预算吗 | 占（`ST_CODE_SANDBOX_RPC_MAX = 20`） | **不占** |
| 消息形状 | `{ __host: 1, id, name, args }` | `{ __prog: 1, id, text }` |
| 权限 | `card.read` / `card.write` | `progress` |

⚠ **为什么必须单开一条**：`host.call` 的预算是 20 次。一个逐条处理 50 项的 skill
光是报进度就把预算烧光，**真正要读卡的那一次调用反而被拒** ——
而「报进度」和「读卡」是两件完全不相干的事，共用一个额度说不通。

⚠ **返回值必须是 `undefined`，不能是 Promise**。返回 Promise 会诱导 skill 写
`await host.progress(...)`，等一个永远不来的结果 → 5 秒后整段被超时掐掉，
而 skill 的作者以为是自己算错了。面板文档里因此明写「**不用 await**」。

**两道自己的闸**（都在父页面 `onProg` 里）：

| 闸 | 值 | 不给会怎样 |
|---|---|---|
| 最小间隔 | `ST_CODE_PROG_MS = 120` | `for (var i=0;i<1e6;i++) host.progress(…)}` 能在 5 秒里让**父页面**重画几十万次 —— 沙盒自己不卡（不透明源 = 独立进程），卡的是父页面 |
| 总次数 | `ST_CODE_PROG_MAX = 200` | 单条超长文本刷屏 |
| 单条字数 | `ST_CODE_PROG_CHARS = 160`（**截断不拒收**） | 拒绝会让 skill 以为「我这条没报上去」而重试 |

⚠ 快了是**丢**，不是排队 —— 排队的话迟到的进度会盖掉新的。
⚠ `finish()` 里要**撤掉**那句进度（`stCodeProgressClear(id)`）：不撤的话它会挂在那儿，
而下一条消息已经进来了，看着像「还在跑第 7 条」。
⚠ 收尾只清**自己那条**（`stCode.prog.id` 比对）—— 上一个 run 超时被拆时可能有一条
`__prog` 还在路上，不认 id 的话它会显示成**这一次**的进度。

⚠ 渲染走 `stCodeProgressRefresh()`（只换那一行的 textContent），**不是** `stCodePaint()`：
一次 run 里可能来几十条，每来一条就把整个消息流 `innerHTML` 重建一遍，
用户往上翻的历史会被弹回底部。

**⚠ 改过卡要一路带 `touched` 回去。** Agent 循环是看 `r.touched` 才决定要不要
`stCodePaintJson()`（重画右侧那份卡 JSON）的。skill 走的是沙盒 → RPC → `stCodeToolRun`，
中间隔了两层 —— 不把 `touched` 逐层传上来，结果是：

> skill 说「我改好了」，卡里**真的改了**，而用户右边看到的还是**没更新的卡**。

所以 `stCodeSkillRun` 在 `onHost` 里记一笔（`touchedAny`），`finish()` 一起 resolve 出来，
`stCodeToolRun` 的 dyn 分支再原样返回。

**⚠ 失败信息里那句「卡没有动」不能无条件说。** skill 完全可能**先写成功、再自己抛异常**
（`host.call('write_text', …).then(() => { throw … })`）—— 这时候卡里**留着它的改动**。
说成「卡没有动」是最坏的那种假话：用户以为没动就不会去检查，改动就那么留在卡里。
所以按 `touched` 分流：改过就说「**已经改过卡了**」，没改才说「卡没有动」。

**⚠ `list_skills` / `read_skill` 也要说清能不能碰卡。** 模型据此决定「要不要自己先读一遍」
和「先调谁后调谁」（一个能改卡的工具，调用顺序就有意义了）。说成「读不到卡」的后果是
**放弃** —— 模型会得出「反正它读不到」，然后绕远路。

### skill 落盘（IndexedDB）

⚠ **为什么不用 localStorage**：配额 5MB 量级，而且**写失败是整个键一起失败** ——
用户导入一个新 skill，结果老的反而全没了。IndexedDB 没有这个量级的问题。

⚠ 但**内存里的 `stCode.skills` 才是唯一真相**：所有读路径（system 拼装 / `read_skill` /
面板渲染）都是同步的，不能为了异步存储把它们全改成 `await`。存储只在「导入 / 删除 /
清空」三处写，启动时读一次。

| 机制 | 为什么 |
|---|---|
| `stCodeSkillBackend` 记着当前后端（`idb` / `ls`），**只写一处** | 两边都写迟早分叉，而分叉之后没人知道该信哪边 |
| 降级时打标记 `stCodeSkillsLsDirty` | 不打的话：某次 IDB 临时抽风 → 这次写进 localStorage → 下次打开 IDB 又好了 → 读到的是**旧的那份**，新的悄无声息地没了 |
| 迁移**先写成功再删老键** | 反过来写失败就等于把用户的 skill 全删了，而且是静默的 |
| 所有存取排成**一条链**（`stCodeSkillChain`），写之前**先拍快照** | 不排的话「启动时那次读」和「导入时那次写」会互相插队，读回来的旧列表会盖掉刚导入的 |
| `stCodeSkillsLoad()` 记忆化（每页只读一次），`stCodeSend` 里 `await` 一下 | 不 await 的话「打开编辑器后马上点发送」会拿到空列表，表现是「刚导入的 skill 第一次不生效，第二次就好了」 |
| 打开超时 `ST_CODE_IDB_MS = 3000` | 隐私模式 / 被策略禁掉的环境**既不 onsuccess 也不 onerror**，会一直挂着 |
| 每次操作开完就 `close()` | 长连接占着库会让「另一个标签页想升级版本」永远 `blocked`，那种卡住没有任何提示 |

### skill 自动注入（触发词）

「只列名字、模型自己伸手读」是**概率性**的 —— 它可能该读没读、读了没照做，
或者拿不准时干脆自己动手。所以再加一条**确定性的**路：用户这句话命中触发词，
就把正文**直接拼进 system**，模型不看也得看。

| 环节 | 怎么定 |
|---|---|
| 触发词从哪来 | frontmatter 的 `triggers` / `trigger` / `keywords`（三种写法都认），逗号 / 顿号 / 斜杠 / 分号 / 竖线 / 换行都当分隔符 |
| 没写触发词 | **退回用 `name` 兜底** —— 名字本身就是最自然的触发词，零配置也能用起来 |
| 手动强制 | 输入里写 `@skill 名字`，命中就加载 |
| 面板上改 | 每个 skill 下面一个输入框（`stCodeSkillTrigSet`），逗号分隔 |

⚠ **单字触发词一律丢掉**（`stCodeTrigList` 里 `length >= 2` 的过滤）。一个「的」字
等于每条消息都命中 —— 那不是触发，是把整个 skill 常驻进上下文，白烧 token。

⚠ **命中结果是「累积」而不是「只算当前这句」**（`stCodeSkillAuto` 写在 `s.autoSkills` 上）。
用户说「改一下状态栏」（命中），接着说「再换个颜色」（不命中）—— 只算当前句的话
第二轮正文就掉了，模型会突然忘掉刚才那份说明。代价是上下文只增不减，所以配一个
总量上限 `ST_CODE_AUTO_CHARS`（24000 字）：**装不下就退回「只列名字」而不是硬塞**
（单个 skill 正文可以到 40000 字，一次塞好几个等于把上下文一次烧光）。

⚠ **结果要排序**（`localeCompare`）。让 system 的内容只跟「命中集合」有关，
不跟「用户按什么顺序提到它们」有关 —— 否则同一组 skill 会生成两种 system，
缓存和逐字节对照都跟着抖。

⚠ **已经删掉的 skill 要从名单里清出去**，否则它会一直占着 system 的位置。

`read_skill` 这条路**保留**：没命中触发词的、或者模型想再确认一遍的，仍然自己读。
system 里两节分开写：「可用的 skill」（只有名字 + 描述）和「已自动加载的 skill」
（正文，并注明**不用再 read_skill**）。

### 任务清单（`set_tasks`）

让过程**可见**。「像在推进」的感觉很大一部分来自「你能看见它在推进」，
而不是来自它真的更强。

- **整表替换，不是增量**。每次传完整清单 —— 增量语义会让「某一条被删了」无法表达，
  而模型更新清单时本来就容易漏掉删除。
- 状态只有三个：`pending` / `doing` / `done`（`ST_CODE_TASK_ST`），图标 `○ ◐ ●`。
- 上限 `ST_CODE_TASKS_MAX = 24` 条、单条 `ST_CODE_TASK_CHARS = 240` 字。
  **上限不是怕它写不下**，是怕模型把「每一步」都拆成一条，清单本身变成噪声。
- 存在**会话**上（`s.tasks`），跟着 `stCodeSessions` 一起持久化 —— 刷新后还在。

⚠ **脏数据要兜住**：空 `text` 的条目直接丢（模型偶尔塞一条占位的）、
未知 `status` 归 `pending`、裸字符串也当 `{text}` 收。**整表为空才报错**。

⚠ **清单默认展开**，而且判据写成 `stCode.open.tasks !== false`（不是真值判断）——
`open` 里还没这个键时要当**展开**，它是「正在进行中」的东西，藏起来就没意义了。

⚠ **刷新清单只能换那一块**（`stCodeTasksRefresh` 只改 `#st-code-tasks` 的 innerHTML），
**绝不能 `stCodeRepaint()`** —— 模型跑工具的时候用户可能正在输入框里打字，一重建字就没了。

### 项目记忆（`remember`）

把用户反复强调的偏好（「注释讲为什么」「过滤一律白名单」）存下来，每次注入 system，
省得每轮重复。存在 `localStorage['stCodeMemo']`，纯文本、一行一条，上限 4000 字。

- 面板：工具条第 4 个折叠菜单「📝 记忆 (N)」，里面一个 textarea + 清空按钮。
- 工具：`remember(text)`，模型在用户明确说「记住…」或反复强调时追加一条。
- 注入位置：**紧跟「## 怎么做」之后**，标题里明写「**优先于上面的通用做法**」——
  不这么写它就会被当成又一条泛泛的建议，模型照样按默认习惯来。

⚠ **输入时只存不重画**（`stCodeMemoSet`）：`oninput` 直接写状态与 localStorage 并更新
计数，**不 `stRerender()`** —— 重画会把 textarea 换掉，光标当场丢。同理
`stCodeMemoRefresh` 在元素正被聚焦时不写 `value`（模型追加记忆时用户可能正写着）。

⚠ **满了要拒绝，不能静默截断**。`next.length > ST_CODE_MEMO_CHARS` 时返回错误并告诉用户
去哪儿删 —— 截断会让「我以为记住了」变成「其实只记了一半」，比没记更坏。
同一句重复提交时**当成功**（模型很容易说两遍），不报错。

### 会话历史

存在 `localStorage['stCodeSessions']`，最多 40 个会话、单会话最多 400 条消息。
标题取第一条用户消息的头 24 个字。

⚠ **状态按会话 id 记，不按下标**（`sessionId`）。会话列表是会被增删和重排的。

⚠ **配额满了要能自己救回来**：`stCodeSaveSessions` 第一次失败时把最老的砍掉一半再试一次
—— 会话很长的时候很容易撑爆 5 MB。

### 局部刷新（不能动不动就 `stRerender`）

| 函数 | 干什么 |
|---|---|
| `stCodePaint()` | 只换 `#st-code-log` 的 innerHTML（**贴着底才自动滚到底**，用户在翻历史就别拽他） |
| `stCodePaintJson()` | 只换 `#st-code-json`，保留滚动位置 |
| `stCodeFlash(text)` | 只改工具条上那句话，5 秒后自己消失 |
| `stCodeRepaint()` | 整页重画（切会话 / 新会话 / running 变化时用），画完把草稿填回输入框、把会话滚到底 |

⚠ **绝不能每来一条消息就 `stRerender()`** —— 那会把输入框、滚动位置、菜单展开状态
一起重建掉。

### 折叠菜单的展开状态

记在 `stCode.open` 里，`ontoggle` 写回。⚠ **写回时绝对不能重画**：
`<details>` 的 toggle 事件是**异步排队**的，重画出来的 `<details open>` 还会再补一个
toggle 回来 —— 会打转。`stCodeMenuToggle` 是幂等的，所以真转一圈也无害。

---

## 十八、状态提示（`stPaintMsg`）

`stEditor.msg = { text, kind, scope }` 是**唯一真相**，`stExportMsg(text, kind, scope)` 写它，
`stPaintMsg()` 负责画。**两个去处**：

| `scope` | 画到哪 | 谁在用 |
|---|---|---|
| `''`（默认） | 常驻条 `#st-status`（浮层最上面，跨所有选项卡） | 全站默认 —— 绝大多数调用点 |
| `'persona'` | 人设页页内格 `#st-persona-msg`（贴在「✨ 生成人设」按钮正上方） | 只有人设生成器那十几处 |

⚠⚠ **一条消息只出现在一个地方。** `stPaintMsg()` 里的判据是
`show = !!m.text && !(inPane && pm)` —— `pm` 是「页内格此刻在不在 DOM 里」（`getElementById`）。
人设页开着 ⇒ 页内格接住、常驻条留空；切到别的选项卡 ⇒ 页内格不在 DOM 了 ⇒
**自动退回常驻条，消息不丢**。两边都写的话用户会看到同一句话两遍。

⚠ 页内格的 `kind` → class 映射：`bad` ⇒ `.st-bad`（红）、`warn` ⇒ `.st-warn`（琥珀）、
其余 ⇒ `.st-ok`（绿）。⚠ `st-ai-status` 的**默认**样式是蓝灰，绿是 `.st-ok` 给出来的 ——
少写那个 class 不会报错，只会「提示不绿了」。

**为什么要有常驻状态条**：提示原本只往导出页的 `#st-export-msg` 写，而那个节点只在「导出」页渲染时才存在；顶栏的「📥 导入」在任何选项卡下都能点，于是导入成功 / 失败**一点反馈都没有**。

**为什么还要页内格**（第十三轮加的）：常驻条在浮层**最上面**，而人设生成器的按钮在面板**下半部分**
—— 盯着按钮看的时候那条提示在视野外，点了没反应、看着像坏了。AI 助手页早就是这个思路
（它有自己的 `#st-ai-cfg-status` + `stAiSetStatus`），人设生成器只是跟上。

⚠ 反向测试：`_reverse13.js` 的 **R7** 拆常驻条的让位判定（消息在两处同时出现 ⇒ 恰好那两条
「常驻条是空的」变红）、**R8** 拆 `scope` 的存储（消息全退回常驻条 ⇒ 页内格那几条变红）。
上下游各一针 —— 因为「挪」和「再抄一份」在画面上很像，只打一头看不出来。

导出页**不再重复一份**（同一句话出现两遍是噪音）。

---

## 十九、持久化

| 键 | 内容 |
|---|---|
| `stCardDraft` | `{ v, tab, tabsCollapsed, srcName, card, raw?, rawBook?, rawTh? }` |
| `stCardAvatar` | 头像 data URL（超过 900 KB 不存） |
| `stAiCfg` | AI 助手的独立配置（`stAi`）。**含 API Key** —— 所以它跟卡片完全分家，草稿和导出里都没有 |
| `stAiUiCfg` | AI 面板的参数（`stAiUi`，要求 / 氛围 / 条数…）。**不含任何密钥**；预览、原始回复、running 这些都不存 |
| `stCodeUi` | Code 页的面板参数（思维强度 / 窄屏视图 / 菜单展开 / 是否真的改卡 / 当前会话 id） |
| `stCodeSkills` | 导入的 skill（名字 / 描述 / 正文 / **触发词**）。**不进角色卡** —— 跟 API Key 一个道理 |
| `stCodeSessions` | Code 页的会话历史（最多 40 个会话，单会话最多 400 条消息；每条会话还带**任务清单 `tasks`** 与**自动加载过的 skill 名单 `autoSkills`**）。**不进角色卡** |
| `stCodeMemo` | Code 页的**项目记忆**（用户长期要求，纯文本一行一条，上限 4000 字）。**不进角色卡** |

体积上限：

- `ST_RAW_KEEP_MAX = 200 KB` —— 原始 JSON
- `ST_TH_RAW_KEEP_MAX = 100 KB` —— 原始 `tavern_helper`（它跟 `raw` 重叠，给得小一档，免得两个都带上把草稿撑成两倍）

`stSaveDraft()` 超限时**退回「不带原始 JSON」再试一次**。

---

## 二十、历史上修过的真 bug

| # | 症状 | 根因 |
|---|---|---|
| 1 | PNG 导入直接抛异常 | `new DataView(buf)` 只吃 `ArrayBuffer`，编辑器内部传 `Uint8Array` |
| 2 | 三态数字清空不了 | 分支顺序按**值类型**判断，`Number('') === 0` 被吃成 0 |
| 3 | 越界写列表撑出空洞 | `arr[99] = 'x'` 让数组变成 100 个洞 |
| 4 | 随便一个 JSON 都能清空草稿 | 缺 `stLooksLikeCard()` 门 |
| 5 | 导入 / 导出提示会丢 | 提示只写进「导出」页那个节点 |
| 6 | 改名字不刷新顶栏与摘要 | 为保光标默认不重画 |
| 7 | 两个同名 `stRerender` | 早期版本成了死代码 |
| 8 | DOM id 被拼了两遍 | 控件助手自己加 `st-` 前缀 |
| 9 | 导入带 `tavern_helper` 的卡报 `ST_TH_RAW_KEEP_MAX is not defined` | **声明**没落地但**引用**落地了（并行编辑丢改动） |
| 10 | 导入报「导入失败」但其实成功了 | `stSaveDraft` 在卡装好之后才炸，异常冒到外层 catch |
| 11 | MVU 检测说「0/5 条正则」、移除漏删 | `ST_MVU_RX_TAG.test(findRegex)` —— 那里存的是**源码字符串**，永远不匹配 |
| 12 | 刚装完 MVU 再点「一键添加」弹「没有接管」 | 空 `z.object({})` 解析成 `[]` 被当成「解析失败」 |
| 13 | 解析器拿错 schema | 取的是文件里**第一个** `z.object(`，作者先写 `const Base = z.object({...})` 就中招 |
| 14 | 导入别人的 MVU 卡后随手一改就覆盖原结构 | `mvuOwn` 跨卡泄漏，而树是空的 |
| 15 | 状态条冒「反推出 0 个变量」 | 空 Zod 也报了消息 |
| 16 | 双击画布上的块，属性面板不出输入框、光标没处落 | `stSbDblClick` 忘了先写 `sbSel` 就 `stRerender()` —— 重画出来还是「没选中」那版。真实点击时靠前面那次 `click` 兜住了，程序化派发（或将来改掉 click 行为）就露馅 |
| 17 | 给状态栏块设完颜色，「跟随主题」按钮不出现，清不掉 | `stAfterSet` 为了保光标默认不重画面板，而颜色那格只有整页重画才会重建。补 `stSbRefreshColorBtn()`：只换颜色输入框旁边那一小格，**不碰输入框本身**（`input[type=color]` 边拖边触发 `input`，换掉元素取色器会当场断） |
| 18 | 状态栏块被写成了空字符串，随后整个页面爆栈 | `stSet()` 的兜底分支 `v = String(value)` 对**对象**也生效 —— 传错路径时直接把一个块对象（甚至 `statusBar` 本身）写成 `''`。加保护：`typeof cur === 'object'` 一律拒绝 |
| 19 | `RangeError: Maximum call stack size exceeded`（`stSbLocate` 自递归） | `stSbLocate` / `stSbChain` 用 `list \|\| 根列表` 兜底 —— 任何一块的 `children` 是假值时递归被拉回根数组，原地转圈。改成用「一个参数都不带」识别「从根找起」，再叠一道深度上限 40。第 18 条是它的**触发器**，两条一起修才彻底 |
| 20 | 解析自己的产物时，标题被读成「加粗的文字块」、字号缩水一圈 | 生成器给标题加了 `white-space:pre-wrap`（为了保住 `<br>`），而 `title` 的判据是「加粗 + **没有** `pre-wrap`」。补一条生成器的签名：`margin:0 0 6px` + `line-height:1.4` |
| 21 | 原稿的 `<br>` 在解析后消失，换行被吃掉 | `stSbTextOf` 用 `textContent`，`<br>` 本身没有文字、直接丢掉。补 `stSbTextKeepBreaks`：先把 `<br>` 换成哨兵字符，压完空白再换回 `\n`（生成物带 `pre-wrap`，渲染出同样的断行） |
| 22 | 原稿带 `white-space:normal` 时，`<br>` 换来的换行又被压掉 | 差集把 `white-space:normal` 记进了 `extra`、追加在 `pre-wrap` 之后（后者胜）。文字 / 标题块的 `white-space` 一律不许进 `extra` |
| 23 | 圆点的「点亮色」和「数值色」被绑成一个 | `b.color` 同时喂给亮点层和数值 span。原稿里这俩是两个颜色，解析回来必然错一个。拆出 `valueColor`（`bar` 的数值 span 同理） |
| 24 | 接管别人的卡之后结构注释丢了 → 立刻判成 `foreign`、拒绝写回 | `stSbDocHtmlOf` 重构时把 base64 注释弄丢了。补 `stSbMarkOf`，并把它放进 **`<body>` 里面** —— 注释不是元素，不影响「围栏 + `<body></body>`」那两条运行时判定，也不多出块 |
| 25 | 手写稿带 class 时，整张面板被判成「没有外壳」，内容全部错位 | 外壳识别只看**内联样式**。class 写法的样式全在 `<head><style>` 里。改成三条判据满足一条即算盒子：① 内联有边框 / 圆角 / 内边距 / 底色 ② 有 class 且有子元素 ③ 有子元素且自己会退化成高级块 |
| 26 | 有 class 的面板只认出 2 个块，其余内容全丢 | `stSbFindDeep` 太贪心：一层里有多个元素时也往下钻，把整张面板误认成里面那一行圆点块。改成只在「独苗路径」（`kids.length === 1 && !stSbOwnText(el)`）才递归 |
| 27 | class 保住了，但作者 `<style>` 里那条颜色还是被盖掉 | 内联永远赢过 class。`clsBare` 只在「这一层一条内联声明都没有」时闭嘴 —— 而手写稿里常是「字号自己写、颜色靠 class」，整层被放过。改成按**属性**粒度判（`clsOwn` + `stSbLook`） |
| 28 | 带 class 的标题凭空多出一条 `white-space:pre-wrap` | 抑制过头：`pre-wrap` 是生成器的固定写法，对「光靠 class」的层被无条件保留。改成只在**文字里确实有换行**（或原稿自己写过 `white-space`）时才写（`stSbPreWrap`） |
| 29 | 改了围栏外的原文，运行时体检栏不刷新 | `stSbPaintPreview` 里「文档没变就 `return`」排在刷体检之前 —— 而围栏外的原文不影响预览文档。把刷体检提到 `return` 之前，并加缓存避免无谓重排 |
| 30 | `style=""` 空属性破坏了逐字节自往返 | 有些层本来就可能一条声明都没有（被 `stSbLook` 全滤掉时）。补 `stSbStyleAttr`：空串就整个不写 |
| 31 | 自由摆放的「纯定位壳」拆早了，把进度条拆成了高级 HTML 块 | `stSbOffOnlyWrapper` 一开始插在 `stSbParseEl` 第 0 步（结构识别之前），于是裹着一条轨道的定位壳被提前拆壳。挪到**第 8 步（兜底之前）** —— 只有「什么结构都不像」的定位壳才拆 |
| 32 | 挪过位置的块再解析一遍，偏移会翻倍（8 → 16） | 定位壳没拆 → 块自己又写一次 → 壳 + 块两层。与第 31 条同源，靠 `stSbOffOnlyWrapper` 解决；`sb-verify6` 的 G 段专门量「壳只有一层、`16px` 一次都不出现」 |
| 33 | `left` / `top` 同时进了 `offX` 和 `extra`，生成时写两遍 | `stSbReadOffset` 必须排在 `stSbOwnMaps` 差集**之前**，先把这两条摘出去 |
| 34 | 分割线自己的 `height:1px` 被当成「用户设的尺寸」，产物里一条声明变两条、`extra` 里还多一份 | 那句是**生成器写的**，不是用户设的。① `stSbSizeNum` 下限从 8 改成 1（`1px` 不该被抬成 `8px`；8 只当拖动地板）；② 读回尺寸前先跟 `stSbSizeBaseline()` 比一遍，生成器本来就会写的一律不认；③ `divider` 分支在 `h` 非 0 时不再写那句 `height:1px` |
| 35 | 「获取模型列表」永远点不动：提示「还没选模型，去拉一下模型列表」 | 它复用了 `stAiReady`，而后者要求「必须已经选了模型」—— 可**这一步本来就是为了挑模型**，要求先有模型就成了死循环。给 `stAiReady` 加 `{needModel:false}`，只有拉模型那处传它 |
| 36 | 注入预览折叠着的时候完全看不出有几条会参与 | 条数只写在展开后的正文里。把「N 条参与」也放一份到 `<summary>` 上 |
| 37 | 切到「AI 助手」选项卡整页空白 | 只加了 `stPaneHtml` 里的 `case 'ai'`，**`ST_TABS` 那条没落地**（并行编辑丢改动，和第 9 条同一类）。选项卡里没有 `ai` 就切不过去。教训同第 9 条：改完逐条 `grep` 确认 |
| 38 | 生成到一半刷新页面，AI 面板永远停在「⏳ 生成中…」，按钮按不动 | `stAiSaveUi` 的持久化写成了**黑名单**：`if (k === 'running') return;`，而实际字段名是 `exRunning` / `grRunning` —— 一个都没匹配上，`exRunning: true` 连同 `exErr` / `exRaw` / `exPreview` 全被存了下去。改成白名单 `ST_AI_UI_KEEP`（**读也按白名单**，旧数据里已经存进去的也能被忽略） |
| 39 | 单条改写点氛围 / 格式 chip 毫无反应 | 复用了批量那套回调，而它们**把键名写死了**：`stAiMoodPick` 只认 `exMood` / `grMood`，`stAiFormatPick` 只写 `exFormat`。加 `enMood` 进白名单、另开一个 `stAiEnFormatPick`。**「写死了目标键名的共用回调」是静默失败的高发区** —— 调用方传对了参数，函数自己什么都不做，也不报错 |
| 40 | 加「第一段」时**同一批 5 处编辑里有 5 处没落盘**（`stAiSetFirstSeg` / `ST_AI_DEFAULTS.firstSeg` / `initAiArea` 回填 / 批量扩写的调用点 / 开场白面板的预览挂载） | 和 bug 9 / 37 同一类：工具报「成功」但字节没进文件。这次是靠 `static_check.js` 的「引用了但从没声明过」扫描（`MISSING: ['stAiSetFirstSeg']`）和验证套件（「OpenAI 体里第 0 条就是第一段」actual 是任务提示词）才发现的。**结论不变：一批编辑发出去之后必须逐条 `grep`，不要相信单次返回**。另外「同一处改动分散在两个地方」这种情况最容易漏 —— 比如 `stAiChat([...])` 有三个调用点，只改到两个 |
| 41 | Agent 一轮里「说了什么」和「要调哪些工具」被记成了**两条** assistant | 第一轮就有文字 + tool_calls 时，消息序列变成 `assistant, assistant, tool` —— Anthropic 不允许连续两条 assistant（直接 400），OpenAI 也会因为「带 `tool_calls` 的消息后面没紧跟 `tool`」而报错。**文字和 tool_calls 是同一条消息的两半**，合成一条。是套件的「消息序列」断言（`user,assistant,tool,assistant,tool,assistant`）抓出来的 |
| 42 | `stCodeFillEntry` 里注释写着「空值不覆盖」，但只有 `keys` / `secondaryKeys` 真的实现了 | 模型给空 `content` / 空 `comment` 时把原来的覆盖掉了 —— 一次 `update_world_entry({id, keys: [], comment: ''})` 就把条目的备注抹平。四个字段统一走「trim 之后为空就不写」 |
| 43 | 给用户看的一句话提示（`note`）被发给了模型 | `stCodeSysMsgs` 里过滤了 `note`，但 `stCodeMessagesFor` 里没有 —— **两处都要堵，只堵一处会漏**。Anthropic 那边还会把 `note` 当成 user 消息，直接触发「连续两条 user」 |
| 44 | `static_check.js` 的**标签配平一直在误报**（不是产品 bug，是检查自己的 bug） | 它直接对**整份文件**做正则数标签，于是：① `'<div' + cls + '>'` 这种拼法（状态栏生成器里有十几处）里 `<div` 后面紧跟引号，`(?=[\s>])` 数不到 → `<div>` 永远比 `</div>` 少；② 注释里写一句「靠 `<details>` 自己管」也被算成开标签。修法：**先摘掉 `<script>` / `<style>` 块再数 HTML 骨架**，JS 那半边另留一条窄检查（只看 `<details>`，先去行注释）。**改完必须反向测试**（故意注入一个多余 `<div>` / 少写一个 `</details>`，确认还能抓到） |
| 45 | 加「从链接导入」按钮之后，套件里「新会话是动作按钮」这条红了（`actual="从链接导入"`） | 断言用的是**位置选择器** `querySelectorAll('.st-code-bar .st-code-btn')[0]`。工具条里所有按钮 —— **包括弹层里的** —— 都在 `.st-code-bar` 里面，在弹层前面插一个新按钮，`[0]` 就换人了。改成按**它自己的类**抓（`.st-code-btn.st-main-btn`）。⚠ 凡是 `[...][0]` / `[n]` 形状的断言，都要先问一句「前面插一个元素会怎样」 |
| 46 | 修上面那条时，**同一批两条 Edit 里有一条没落盘**（第六次） | 和 9 / 37 / 40 是同一类。这次是 `grep` 复核当场抓到的 —— 文件里还是老的 `[0]` 写法，而工具返回的是「成功」。**这就是「改完必须 grep」的全部理由：工具说的「成功」和磁盘上的字节是两件事。** |
| 47 | 临时写的标签配平脚本**报了 4 处不配平**，实际是 0 处 | 脚本用 `.replace(/\/\/.*$/, '')` 去行注释。**`saki.html` 是 CRLF**，而 JS 里 `.` **不匹配 `\r`** —— `.*$` 到不了行尾，整条正则匹配失败，**注释一个字都没被剥掉**，4 行注释里的 `<details>` 被算成开标签。而且它**不报错**，只是安静地给出错的数。修法：先 `.replace(/\r\n/g, '\n')` 归一，或者用 `indexOf('//')` + `slice`（真 `static_check.js` 就是这么写的，天然 CRLF 安全）。⚠ **凡是用 `$` 锚定「行尾」的正则，都要先问一句「这文件是 CRLF 吗」** |
| 48 | `stCodeOnlyToggle` 只看「参数里有没有多余字段」，于是**「删掉状态栏」被放行** | `{mode:'delete', id:'状态栏界面'}` 的参数集合**恰好也在「只改开关」的白名单里** —— 于是那道专门用来拦住「别把状态栏删了」的闸门，被它自己放过去了。**判断必须同时看「意图」（`mode === 'update'`）和「参数」，只看参数就是在猜意图。** 套件里 E6 的「删『状态栏界面』被拒绝」当场抓到 |
| 49 | `read_card` 的指路写在了「字段不存在」分支里，等于**没写** | `regex` / `thScripts` / `statusBar` / `mvu` 都是卡里**真实存在**的字段，`stCodeGetPath` 查得到，所以永远走不到那个分支 —— 模型拿到的是一坨内部表示的 JSON（`statusBar` / `mvu` 那两份还只是**编辑器的工作副本**，对别人的卡来说压根不是卡里的东西）。指路要放在**解析之前**。套件里「`read_card` 读 regex 会被指向 `read_regex`」抓到 |
| 50 | 套件里两条**正则字面量写成了双反斜杠**（`/数组有 \\d+ 项/`、`/thScripts\\[2\\]/`） | 脑子里想着模板字符串，手上写的是正则字面量。`\\d` 在正则字面量里是「字面反斜杠 + d」，`\\[2\\]` 是「反斜杠 + 字符类 `[2]` + 反斜杠」—— 永远匹配不上。**改断言时别把两种转义规则混在一起** |
| 51 | `stMvuParseZod` 只认 ASCII 标识符，**中文卡整个读不回来** | 中文社区的卡里 `const 角色 = z.object({…})` + `registerMvuSchema(角色)` 很常见，而 `[A-Za-z_$]` 匹配不到 `角色`；退路「只有一个 `z.object` 赋值」也用同一个字符类，同样落空。表现是「编辑器说认不出这张卡的 Zod」，**用户完全不知道为什么，只会觉得「我这张卡明明是好的」**。修法：抽出 `ST_MVU_IDENT`（ASCII + `\u4e00-\u9fa5`）两处共用。⚠ 把 `id` 插进 `RegExp` 之前要转义（`$` 在外面是行尾锚）。是写 `write_doc` 的测试时用了中文标识符才撞出来的 |
| 52 | 套件里「关掉『真的改卡』时不写状态栏」这条红了，而**产品是对的** | 给的 HTML 是 `<div style="padding:4px">随便什么</div>` —— 一个**光秃秃的单层 div**，`stSbParseDoc` 把它认成**外壳**，于是块数 0，先被「没解析出块」那条拦下，根本走不到开关判断。⚠ **断言失败先想前提**：这条测的是「开关关掉时写不进去」，前提是「这段 HTML 本来写得进去」。改成外壳 + 一个子块就对了 |
| 53 | **`read_doc` 读到的是一截，`write_doc` 高高兴兴写回去了 —— 后半段静默没了**（本轮最重的一条） | 读工具和写工具共用同一个 `ST_CODE_TOOL_CHARS = 12000`，而状态栏 HTML / Zod 源码轻松过 12000。截断标记只是贴在文本尾巴上，`stSbParseDoc` 照样能解析那段**不完整但合法**的 HTML —— 于是后半段块全没了，**全程没有任何一处报错**。三处一起修：① 只读工具单独给 32000；② 截断标记抽成常量，`write_text` / `write_doc` 见到它就**拒收**（而且要在「真的改卡」开关**前面** —— 关着的时候也得拦，否则模型收到「只演示」的成功回执）；③ `read_doc` 加 `from` 参数，让它能真的分段读回来。⚠ 教训：**「读回来的东西」和「写回去的东西」一旦共用预算，就等于给了一条无声的破坏路径** |
| 54 | 只读工具也吃 `th.steps`，于是「关」档（4 步）读完卡就没预算改了 | `used++` 写在 `for (const c of calls)` 里，不分读写。读卡 + 读状态栏 + 读 Zod 就 3 步，真正要改的那一下反而轮不到。修法：`ST_CODE_READ_TOOLS` 里的工具不涨 `used`，另配一个 `ST_CODE_READ_STEPS_MAX` 兜住「一直读转圈」；轮次上限也从 `th.steps` 改成 `th.steps + ST_CODE_READ_STEPS_MAX`。⚠ **清单和工具表对不上时不会报错** —— 拼错一个名字，那条工具只是悄悄退回老行为。所以套件里加了一条**推导式**断言：凡是以 `read_` / `list_` 开头的工具都必须在只读清单里（以后加读工具忘登记会被抓到） |
| 55 | skill 落盘换 IndexedDB，一上来就是三个坑 | ① **只写一处**：后端由 `stCodeSkillBackend` 记着，写 IDB 成功就清掉 localStorage 的老键 —— 两边都写迟早分叉，而分叉之后没人知道该信哪边；② **降级要打标记**（`stCodeSkillsLsDirty`）：某次 IDB 临时抽风 → 这次写进 localStorage → 下次打开 IDB 又好了 → 读到的是**旧的那份**，新的悄无声息地没了；③ **迁移顺序不能反**：先写成功再删老键，反过来写失败就等于把用户的 skill 全删了。另外「启动读」和「导入写」要排成**一条链**，而且写之前**先拍快照** —— 不排的话读回来的旧列表会盖掉刚导入的，两边都不报错 |
| 56 | manifest 正则 `([\s\S]*?)\*\/` 把收尾的 `!` 一起捕获了 | `/*!MANIFEST {…}!*/` 里的 `!` 落在 `*/` 前面，懒惰匹配停在**最后一个能匹配 `*/` 的位置**之前，于是 JSON 变成 `{…}!` —— `JSON.parse` 报 `Unexpected non-whitespace character after JSON`，**完全看不出是正则的问题**。收尾写成 `\s*!?\*\/` |
| 57 | 「对象或 null」的两态契约，把「看得出是 skill 但装不了」静默吞掉了 | `stCodeSkillFromText` 原本只返回 skill 或 null。工具型 skill 的 manifest 写错时它返回 null，用户看到的是「一个能用的都没有」，然后回去猜哪儿错了。改成**三态**：skill 对象 / `{err}` / null（不是 skill），`stCodeImportFiles` 收 `errs` 一路带到面板上。⚠ 凡是「解析失败」和「这不是那种东西」**后果不同**的地方，都不能共用一个 null |
| 58 | 断言用后代选择器数菜单，新加的嵌套 `<details>` 被算进去了 | `document.querySelectorAll('.st-code-bar .st-code-menu').length === 4` —— skill 面板里新加的「格式说明」`<details>` 也在 `.st-code-bar` 里面，于是变成 5。换成直接子元素选择器 `.st-code-bar > .st-code-menu`。⚠ 和第 45 条（位置型选择器）是一家人：**选择器要窄到「只有目标会命中」**，宽一格就会在下次加东西时红 |
| 59 | `NODE_PATH` 写成 Git Bash 的 `/c/Users/…` 时，Node **不说路径不对** | 它继续报 `Cannot find module 'jsdom'` —— 看起来像「jsdom 没装」，会白白去查半天。必须是 `C:/Users/…` 或 `C://Users//…`。⚠ 和「黑名单字段名对不上」是同一类：**错的输入配上一句笼统的报错**，比明着报错难查得多 |
| 60 | **`write_text` 少给 `value` → 把字段静默清空，还回一个成功回执**（写 E10 的探针时撞出来的） | 原来是 `String(a.value == null ? '' : a.value)` —— 参数名少写一个、或者把 `text` 当成了参数名（`write_doc` 用的就是 `text`），结果**那个字段当场变成空串**，而返回的是「已写入 description（现在 0 字）」。发现它的过程本身就说明问题：探针里写错了参数名，断言 `卡真的被改了` 拿到的是 `""` —— 换成人写就是「设定被删了但没人知道」。修法：`value` 为 `undefined`/`null` 时**拒收**并说清要放在 `value` 里；⚠ **空串 `""` 仍然是合法值** —— 那是「故意清空」，和「忘了给」必须分开 |
| 61 | 套件里 `/^OK:/` 这种**行首锚**在包了一层的返回值上永远匹配不上 | 工具型 skill 的结果是 `skill「perm_read」返回：\nOK:…`（`stCodeToolRun` 的 dyn 分支给包了一层，好让模型知道这条结果是哪个 skill 出的）。9 条断言同时红，而**产品是对的**。改成 `/返回：\nOK:/` —— 顺便把「外面那层包装」也一起断言了。⚠ 和第 50 条（正则里混了模板字符串的转义）是一家人：**断言自己的形状也是要写对的**，红了先看断言 |
| 62 | skill 在沙盒里改了卡，**右侧那份卡 JSON 不重画** —— 用户看到的是没更新的卡 | Agent 循环是靠 `r.touched` 决定要不要 `stCodePaintJson()` 的。skill 走的是「沙盒 → RPC → `stCodeToolRun`」两层，`touched` 到 dyn 分支就断了，外层拿到的是 `''` → 不重画。表现是「skill 说改好了、卡里真的改了、用户右边看到的还是旧的」。修法：`stCodeSkillRun` 在 `onHost` 里记 `touchedAny`，`finish()` 一起 resolve，dyn 分支原样返回。⚠ 这一条**只能靠读代码发现** —— 工具结果是成功的，卡也真的变了，所有断言都绿。 |
| 63 | 失败信息里那句「卡没有动」是**假话**（skill 可能先写成功再抛异常） | `host.call('write_text', …).then(() => { throw … })` —— 写已经落进卡了，然后 skill 自己炸了，而错误信息照旧写「**卡没有动。**」。**这是最坏的一种假话**：用户以为没动就不会去检查，改动就那么留在卡里。修法：按 `touched` 分流 —— 改过就说「⚠ 它**已经改过卡了**，卡里留着它的改动」，没改才说「卡没有动」。⚠ 凡是「失败 ⇒ 什么都没发生」的推理，都要先问一句**「失败之前它做过什么」** |
| 64 | **推导式断言撞上例外**：`read_skill` / `list_skills` 以 `read_` / `list_` 开头，读的却是 **skill 库不是卡** | 只读清单是拿命名约定**推导**出来的（`/^(read_\|list_)/` 的名字都该在里面）—— 这个写法本身是对的，它专门用来抓「新加了工具忘了登记」。但这两条是**真的例外**。⚠ 修法**不是**把正则放宽：放宽之后，下一个**真的**漏登记的工具就会被当成「又一个例外」静默放过去，而那正是这条断言存在的理由。正确做法是**给例外起个名字**（`const NOT_CARD = ['read_skill','list_skills']`）再**单独**断言「它确实不在权限表里」—— 例外被显式写出来就还是可数的 |
| 65 | **判据和文案对不上**：system 承诺「只读工具不占改卡次数」，判据却只看静态名单（第 54 条的续集） | 54 条把只读工具从 `th.steps` 里豁免了，但判据写的是 `ST_CODE_READ_TOOLS.indexOf(...)` —— 一个**没申请 `card.write` 的工具型 skill**（掷骰子、算个数这种）不是 `read_*`，于是照吃一次改卡步数。**越纯算的 skill 越吃亏**，而用户看到的是「只读不算数」这句承诺。⚠ 这类问题**断言抓不到**：断言只测了我**想到**的那条路径（内置读工具），而「system 里写的那句话」从来没被当成被测对象。修法：`stCodeIsReadTool()` = 静态名单 **或**「没申请 `card.write` 的工具型 skill」，⚠ **故意保守** —— 申请了 `card.write` 的一律按改卡算，哪怕这次只读了一行（猜错方向的代价不对称：少算一步只是少改一次卡，多算一步会让用户以为「还能改」却发现改不动） |
| 67 | **静态检查读的是生成物 `blk0.js`** —— 改了 `saki.html` 忘了重新 extract，它会**对着旧代码给答案** | `check.js` 原来是 `readFileSync('blk0.js')`，而 `blk0.js` 是 `extract.js` 的产物。忘了跑 `extract.js` 就直接 `node check.js`，它检查的是**上一次**的源码 —— 而输出看起来**完全正常**（`MISSING: (none)` 一样会打出来，只是它检查的不是你刚改的那份）。**过时的输入比没有检查更坏**：它给你一个绿灯，而你没有任何线索知道那是旧的。修法：`check.js` 自己抽 `saki.html` 的内联 `<script>`（正则和 `extract.js` 同一套），解析改用 `vm.Script`（等价 `node --check`，但不用先生成文件）—— 于是**快路径从三条命令缩成一条** `node check.js`。⚠ 反向测试：造一份垃圾 `blk0.js`，`check.js` 的输出**逐字不变**（`_reverse5.js` 探针 A）—— **这才是「它真的不读那份文件」的证据**，光看代码不够。⚠ **续集（2026-09-20）**：那两份过期副本已删，探针改成**自己造、自己删** —— 它原来写的是「备份存在才还原」，文件本就不在时会**把垃圾留在目录里**（而且自己不说，下次整跑卡在「清单对账」那一关，看起来像套件坏了） |
| 68 | **约定不是闸门**：转义靠「三条渲染路径都记得调 `escapeHtml`」维持 | 查的时候确实全都调了，所以现状安全 —— 但那是**约定**：以后新加一条渲染路径，没人会提醒你。⚠ 这类「现状是对的」最难守，因为**没有失败可以复现**。修法：把不变量写成可判定的判据 —— 扫 `stCode*Html` / `stCodeHighlight` 的**函数体**，把已安全的包装（`escapeHtml` / `stCodeAttr` / `stCodeJsonText`）整段抹白，剩下的 `+ 变量` 是候选，候选的**多重集**必须跟显式白名单**逐字一致**。⚠ 两个设计选择都不是随意的：按「函数名 + 标识符名」而不是行号（行号会漂）；用**多重集**而不是集合（同一函数里再多一个裸插值，集合看不出来） |

> 第 9 条催生了 `static_check.js` 的**最后一项检查**：「引用了但从没声明过」的标识符扫描。
> 第 18 / 19 条是同一场事故的两半 —— 单修任何一条都只是把爆栈换成静默数据损坏。
> 第 31 / 32 条也是同一场事故的两半：壳没拆干净不会当场报错，只会让偏移**每一轮解析都翻一倍**，
> 存几次之后块就飘到屏幕外面去了。
> 第 34 条是「零值零字节」这条铁律第一次被**既有产物**撞到：新字段的中性值必须一条声明都不产出，
> 而分割线本来就有一条长得像中性值的 `height:1px`。
> 第 35 条是「复用校验函数」的经典陷阱：`stAiReady` 对「生成」是对的，对「拉模型」就是死循环 ——
> 共用的前置检查要能按调用方关掉其中一条。
> 第 37 条和第 9 条同源：**同一处改动分散在两个地方时，只有一处会落地**。
> 第 38 条是「黑名单持久化」的经典失败：**过滤条件的字段名跟真实字段名对不上时，
> 它一条都拦不住，而且不会报错**。这类地方一律用白名单。
> 第 39 条是同一种病的另一种长相：**回调把目标键名写死了**，调用方传对了参数、
> 函数自己静默什么都不做。凡是「多个面板共用一套 chip 回调」的地方都要留意这一条。
> 第 47 条又是「检查自己坏了」这一类，而且是**最阴的一种**：它不报错，只是给一个错的数。
> 一个偶尔说错话的检查，比一个明着报错的检查难发现得多 —— 因为你会去查被检查的代码，
> 而不是去查检查本身。**看到不配平，先确认检查自己是对的。**
> 第 40 条说明这类问题**在同一个文件里会反复出现**：9、37、40 是同一件事的三次。
> 第 41 / 42 / 43 条都是**协议约束在数据形状上留下的坑**，而且三条都是被套件里
> 「消息序列长什么样」和「空值不覆盖」这两条断言抓出来的 —— 这类断言看起来只是
> 「对一下字符串」，实际上在替服务端的 400 兜底。
> 第 44 条最特殊：**它修的不是产品，是检查工具本身**。一个稳定误报的检查，价值是负的 ——
> 它会训练人「这条红了不用管」，真正出问题那天就没人看了。而且**修完必须反向测试**：
> 把检查放松之后「变绿」什么都不能证明，你得先确认它**还看得见**。
> 第 53 / 54 条是同一件事的两半：**读回来的东西和写回去的东西共用一份预算**，
> 于是「读不全」直接变成「写坏」，而且全程不报错。第 53 条尤其要记住 ——
> 它是这一整套工具里**唯一一条会无声损坏用户卡片**的路径。
> 第 56 / 59 条是同一个教训的两种长相：**错的输入配上一句笼统的报错**，
> 报错指向的地方（JSON、jsdom）和真正出问题的地方（正则、路径风格）根本不是一处。
> 第 57 条是「两态契约」的经典失败：把「装不了」和「不是这东西」混成一个 null，
> 用户就只剩猜。
> 第 45 / 46 条是同一次改动的两半：**加功能顺手把断言打红了**，而红的原因不是产品坏了。
> 45 说明**位置型选择器是「加东西就红」的定时炸弹**（`[...][0]` 一律换成按自己的类抓）；
> 46 则是老问题第六次出现 —— 而且**这次是它先被 grep 抓住，才没有变成一个「看起来在测、
> 其实测错了对象」的假绿**。
> 详见 [README.md](README.md#7-验证体系)。

---

## 二十一、测试

> ⚠ **本节原先是「二十」，与上一节撞号**（两节都叫 `## 二十`）。2026-09-23 把本节改成二十一 ——
> 顺序上它是**最后**一节，改它只影响引用它的人，不动前一节的号。
> 同时把 `2026-09-21.md` / `CHANGELOG.md` 里那两处 `§二十 新增 sb-verify8.js 十段表` 改成 `§二十一`
> （**交叉引用是「指针」，不是历史事实** —— 指针要指对地方，数字类的历史记录才该原样留着）。
> 别改回去。

`verify_steditor.js` —— **520 条**，分 17 段：

| 段 | 内容 |
|---|---|
| A | 初始与摘要 |
| B | 开关浮层 |
| C | 左侧选项卡 |
| D | 十四个页面各自的控件 |
| E | 路径读写 |
| F | V1 · V2 · V3 序列化 |
| G | 世界书序列化 |
| H | 正则序列化 |
| I | PNG 数据块（CRC32 标准向量、注入、二次注入不堆块、两种入参） |
| J | 导出真的产出 |
| K | 导入 JSON · PNG + 往返 |
| L | 草稿持久化（含坏草稿） |
| M | 结构操作 |
| N | 与酒馆模式衔接 |
| O | 酒馆助手脚本（105 条） |
| P | MVU 变量框架（104 条：检测 / 一键添加 / 生成器 / 树操作 / 接管规则 / 持久化） |

真实 Chrome 里另有 `verify_tavern_visual.js` 的第 12 / 12b / 12c / 12d 段（浮层几何、十五个页签切换、移动端触控、复古皮肤、MVU 页）。

⚠ **这两个套件里的「选项卡数量 / 顺序」断言会跟着 `ST_TABS` 一起过时。** 加 `sb` / `ai` / `code`
三个选项卡时一共红了 **9 条**，都不是回归。但**不能只改数字**，因为过时有三种长相：

| 长相 | 位置 | 为什么只改数字不够 |
|---|---|---|
| 写死数量 | `verify_steditor` B6 / C1 / C12、`verify_tavern_visual` 折叠标签 / 移动端图标 | 直接改数字即可 |
| 写死**顺序与文案** | `verify_steditor` C2（标签文案）/ C3（id 列表）/ P69、`verify_tavern_visual` 的页签遍历 | 要把新页插进正确位置 |
| **遍历清单本身是字面量** | `verify_tavern_visual` 的 `[[id, marker], …]` | ⚠ **这条不会红** —— 它只是少走 3 页，静默降低覆盖。**这才是最危险的一种** |
| **正则「子串照样匹配」** | `st-code.js` 的 `/sb,code,export/`、`persona-verify.js` 的相邻距离断言 | ⚠⚠ **改了顺序却不红** —— `persona` 插进 `code` 后面之后，`ST_TABS.map(t=>t.id).join(',')` 变成 `…,sb,code,persona,export,…`，而 `/sb,code,export/` **照样匹配**（`sb,code` 还在，正则跑到 `export` 就不再看后面）⇒ 等于把 `persona` 从覆盖里静默漏掉。**顺序型断言别写成「子串在不在」，要么把整段列全，要么改成相邻距离**（`pi - ci === 1`）。⚠ 相邻距离型的那个数字**也是写死的**：`persona` 一挪，`pi - di === 1` 就变成 `11` —— 这种会红，但要**同时补一条反向对照**（`pi - di !== 1`），否则「位置其实没挪动」会被正断言掩盖 |

⚠ 还有一种**只有挪位置才会出现**的：**序数**。文档里写着「AI 助手是**第 7 个**选项卡」——
`persona` 一挪到 `code` 后面，`ai` 就变成**第 6 个**（`code` 从 14 变 13）。**静态检查一个字都看不见**
（载体有三处：`RULES.md` 的节标题、`04-card-editor.md` 正文、`MEMORY.md`）。
⇒ 挪项之后必须 `grep -rn "第 [0-9]* 个选项卡"`，每一个都**从产品实测**：

```bash
awk '/const ST_TABS = \[/,/^        \];/' saki.html | grep -o "id: '[a-z]*'" | cat -n
```

**别手算** —— 手算出来的正是那个会漂的东西。

⚠ 同一次还要重取 **README §2 的锚点表**：那段用户可见文案多了一行 ⇒ 它**后面**的锚点整体 +1
（实测 `5541→5542`、`5542→5543`、`5566→5567`、`5571→5572`、`5576→5577`，以及表外那三个
`#gameCard` / `#gameShooterWrap` / `#gameShooterFrameHost`）。核对交给 `_verify/_audit-anchors.js`
（只读，它自己会报「几行对不上」）。

第三种的修法是把清单补全，顺便把 `getElementById(marker)` 改成 `querySelector`（`#id` 与
`.class` 都认，状态栏页的关键控件 `.st-sb-top` 没有 id）。**加了新的「可枚举的东西」
（选项卡 / 行 / 列）之后，除了 grep 数量，还要 grep 字面量数组、顺序型的正则 / 距离、以及「第 N 个」序数。**

另外 `static_check.js` 的**标签配平**一直在误报（详见 bug 表尾注），这一轮顺手修好了 ——
它跟选项卡无关，是被这次改动**暴露**出来的。

**`_verify/sb-verify.js`** —— 状态栏外观页的专项验证，**84 条**（真 Chrome + CDP）：

| 段 | 内容 |
|---|---|
| A | 加载零报错 |
| B | 装 MVU 建出状态栏起点、选项卡就位 |
| C | 三栏布局、图层行数 == 画布命中框数 == 块数、产物满足运行时判定 |
| D | 全页无重复 DOM id |
| E / E2 | 点画布选中 / 双击把光标送进属性面板 |
| F | 改属性 → 立刻重写卡里那条正则 |
| G | **真拖放**排序（合成 `DragEvent` + `new DataTransfer()`） |
| H | 拖进分组、挡「拖进自己的子树」 |
| I | 用分组包住 / 解散（层数与深度） |
| J | 版式模板、主题、`calc()` 兜底 |
| K | 变量树 → 块的自动接线（`min`/`max` 取变量自己的） |
| L | 接管状态机：`foreign` 时不写回，点接管才覆盖 |
| M | base64 结构往返 |
| N | 宽度、空状态、从空状态恢复 |
| O | 数值夹紧（0→8、999→40） |
| P | 窄屏堆成一栏、块库按钮 ≥32px |
| Q / R / S | 复古皮肤下画布仍可点、截图、收尾零报错 |

另有 `_verify/extract.js`（把内联脚本抽成 `blk0.js`，**只给临时分析用** —— ⚠ **产物用完就删**：
两份过期副本已于 2026-09-20 清掉，`extract.js` 留着，一条命令就能再生）与
`_verify/check.js` —— **静态检查，不开浏览器，runner 里排第一个**，**5 项**：
① `SYNTAX`（`vm.Script` 只解析不执行，等价 `node --check`）② 内联 handler 引用的函数是否都声明过
（打印 `MISSING:`）③ 字面量 `id="st-…"` 有没有重复 ④ **`ST_` / `st` 前缀标识符引用过就必须声明过**
（打印 `UNDECLARED`）⑤ **`ESCAPE-GATE`**（见下）。
⚠ `check.js` **直接读 `saki.html`，不读 `blk0.js`** —— 见踩坑 #67。（目录里现在**没有** `blk0.js` 了。）

**第 4 项：从「手写清单」改成「推导式」** —— 它原来是 **45 个 `stSb*` 名字**逐个
`declared.has()`。手写清单有两个毛病：① 加了新函数要记得往里补，**它自己不会提醒你**
（本质上还是「约定」，而约定就是没人守的东西）；② 只覆盖清单里那 45 个，清单外漏声明的
名字一概看不见。现在改成扫全代码里 `ST_` / `st` 前缀的标识符，**引用过就必须声明过**。

⚠ **换之前先量**（一次性探针 `_probe-mine.js`，**跑完已删** —— 它只回答「45 个名字在不在引用
集合里」这一个问题，答案落在这段话里就够了，文件本身没有再留的必要）：那 45 个名字**全部**
都在引用集合里 → 推导式**完整覆盖**清单的意图（任一声明消失，当场红），覆盖面还从 45 扩到
**770 个名字**（`ST_` 前缀常量也一并进来了）。770 和外部 `static_check.js` 独立算出的数字
**恰好一致** —— 两套实现互相印证。

⚠ **这个数会一直涨**（写这段时是 758，几天后 766，09-20 第十八轮已是 **770**）—— 它是**当前快照**，不是常量。
要引用就现跑 `node _verify/check.js`，别照抄这里。

⚠ 两个必须做对的地方：**涂掉字符串 / 注释 / 正则**（`'stCodeSessions'` 这种字面量会被当成
引用；实测不涂是 639 个名字、涂了 631，差的 8 个全是字面量 / 注释里的字样，当前碰巧都在
声明集合里 —— 那是**运气**不是保证）；**排除属性访问**（`x.stFoo` 里那个 `stFoo` 不算，
判据看引用点前 40 字符是否以 `.` / `?.` 结尾）。

⚠ **两种「已声明」口径不能混用。** 第 2 项（内联 handler）**只要顶层声明** —— handler 在
全局作用域执行，把形参 / 解构 / 对象键也算成「已声明」只会**掩盖**真实的缺声明：
`const obj = { toggleTab: 1 }` 会让 `onclick="toggleTab()"` 在函数声明丢掉时照样过。
两个检查语义不同，各建各的 `declared`。

**转义闸门（`check.js` 第 5 项）** —— 不变量：`stCode*Html` / `stCodeHighlight` 这些
**构建 HTML 字符串**的函数，凡是把动态值拼进字符串的，都必须先过 `escapeHtml`
（它们渲染的是模型输出 / skill 输出 / 卡里的内容）。
判据：把已安全的包装整段抹白，剩下的 `+ 变量` 就是候选，候选的**多重集**必须跟
`check.js` 里的 `ESCAPE_ALLOW` 白名单**逐字一致**。
⚠ 按「函数名 + 标识符名」而不是行号 / 次序（那两个会漂）；用**多重集**而不是集合
（同一函数里再多一个裸插值，集合看不出来）；白名单**显式**，新加构建函数必须来改它。
反向测试在 `_verify/_reverse5.js`（拆转义 / 加新构建函数，闸门都必须红）。

**`_verify/sb-verify2.js`** —— 状态栏外观页的**补漏**轮，**62 条**（覆盖第一轮没碰到的面）：

| 段 | 内容 |
|---|---|
| A | 圆点块：自动挑数值变量、带上变量自己的 `min`/`max`、叠层裁切结构、`2×count` 个字符、`count` 夹到 20 |
| B | 分割线 / 间距 / 高级 HTML：线色、高度、高度 0 夹到 1、属性面板字段数 |
| C | 转义边界：只有「高级 HTML」原样透传，文字块的尖括号被转义、不漏真标签、未闭合标签不吃掉后面的块 |
| D | 颜色「跟随主题」+ **回归测试**：误传「整块路径」不许爆栈 / 不许把块写成标量；标量顶不掉 `statusBar` / 块列表 / `mvu` |
| E | 选中分组时从块库加点（新块进分组、根层不变） |
| F | 写回幂等（内容没变时 `stSbSync` 返回 `false`） |
| G | **刷新页面后草稿接着编辑**（块数 / 主题 / 宽度 / 接管标记 / 产物逐字节一致 / 停在状态栏页） |
| H | 从卡里 base64 反推读回结构，读回后重新生成产物逐字节一致 |
| I | 移除 MVU 后状态栏页不装死（识别为 `none`、画布给出口、`stSbSync` 返回 `false`） |
| J | 收尾零报错 |

**`_verify/smoke.js`** —— 全应用冒烟，**90 条**：15 个选项卡逐个切换都能渲染、
**两处「展开键」**（① 浮层顶栏 `≡ 选项卡`：箭头会转 + 与左侧栏时长一致 + 折叠态挂在 `.st-shell`
+ 重画后仍在；② **主页卡片的箭头**：箭头会转 + 与日历时长一致 + 折叠区自己有过渡 + 折叠态转 180°；
两组各带一个**展开态对照组**）、装 MVU →
建变量 → 套状态栏模板 → 写进正则一条龙、复古皮肤来回切、关闭再打开编写器、收尾零报错。
改 `stSet` 这类**公共**函数后必跑。

**`_verify/sb-verify3.js`** —— 「解析卡里已有的状态栏」，**99 条**：

| 段 | 内容 |
|---|---|
| A | **自往返**：6 个版式模板生成 → 抹掉结构注释变成「别人手写的」→ 解析回来，块结构 / 主题 / 文字全部一致，且没有一块退化成高级块 |
| B | 手写状态栏的逐元素识别：标题字号反推、变量路径、进度条 `min`/`max` 从 `calc` 反解、圆点个数从字符数来、分割线线色不写死、间距高度、一行多列、句子里带宏不拆散 |
| B | **认不出来的必须原样保留**：表格 / `<style>` / 老写法宏 `{{getvar::}}` 都要出现在生成物里 |
| C | 解析 → 接管 → 直接改已有元素（标题文字、变量显示名、进度条上限、圆点字符与个数）都立刻写回 |
| D | **还原**：`↩ 还原解析前的 HTML` 后卡里逐字节等于原稿、画布清空、回到 `foreign`，且能重新解析一遍 |
| E | 解析失败（纯文字没有元素）时不改卡、不接管、画布不动 |
| F | 边界：句子里的宏 → 文字块；带样式的行内标签 → 高级块；无样式的 → 文字块；裸壳拆开；表格不拆散；两层嵌套的一行多列 |
| G | 收尾零报错 |

A 段那个「自往返」是这套解析最有力的测试 —— 生成器和解析器互为逆运算，
任何一边改了而另一边没跟上，模板一跑就露馅。

**`_verify/sb-verify4.js`** —— 「尽可能按原样解析」，**101 条**：

| 段 | 内容 |
|---|---|
| A | 自往返的**最强形式**：产物 → 抹掉结构注释 → 解析 → 再生成，两段 **body 逐字节相同**；且不许凭空多出「保原样」的声明 |
| B | 手写稿里 12 条自定义声明逐条核对：外壳渐变 / 阴影、文字发光 + 字距 + 内边距、轨道底色（进 `track`）、轨道描边与额外圆角（进 `extraInner`）、填充层发光（进 `extraFill`）、圆点间距（`extraInner`）、亮点层发光（`extraFill`）、加粗分割线（`extra`）、列宽 `flex:2`（`wrapExtra`）、显示名颜色 / 未点亮颜色 / 数值颜色 |
| C | 解析后改已有元素（字号 / 对齐）→ 新值生效，**保下来的三条样式一条都不能掉** |
| D | 「✕ 丢掉这一层」：丢掉后产物里那条声明也没了；坏路径 / 坏字段名不许把 `statusBar` 或块写坏 |
| E | 属性面板：「原样保留的样式（N 层）」真的渲染进 DOM；`bar` 的「轨道底色」、`dots` 的三个颜色输入框里都是解析出来的值 |
| F | 走完整流程：报告里出现「原样保住 N 条自定义样式」、留得住原稿、解析结果自检通过 |
| G / G2 | 还原后卡里逐字节等于原稿；`<br>` 遇上 `white-space:normal` 时换行不能被吃掉 |
| H | 原稿**根本没有外壳** → 11 条外壳属性全关掉，生成的盒子没有边框 / 底色 / 内边距 / 字体 / 字号，但文字自己的颜色还在；按钮一点外框又能回来 |
| I | 收尾零报错 |

**`_verify/sb-verify5.js`** —— 「**按运行时规则**解析」，**62 条**（这是「原样解析」的语义准绳）：

| 段 | 内容 |
|---|---|
| A | 产物满足运行时的两条判定（在 ```` ``` ```` 围栏里 + 同时有 `<body>` / `</body>`）；base64 结构注释在 `<body>` **里面**；注释不产生额外块、不改判定 |
| B | 围栏**外**的原文（说明文字 / 别的代码块）逐字节往返、幂等 |
| C | **不合格的原稿照样解析**：有围栏但没 `<body></body>` / 连围栏都没有 —— 都能读成块，报告里 🚫 提示「玩家那边看不到」，写回时补成合格包装 |
| D | `<head>` 里的 `<style>` 不丢（捞成高级块、排在块列表最前、报告里计数）；class 不丢 |
| E | **真机预览**：真的是 iframe、跟写进卡里同一套包装、不带结构注释、`sandbox` 里**没有** `allow-same-origin`、`<style>` 生效、`<script>` 真的跑、`100vw` 以 iframe 为准、改画布联动、体检栏三种文案都对 |
| F | 收尾零报错、`confirm` 只弹了预期次数 |

E 段要进那个预览 iframe 得走 `Target.setAutoAttach`（见「测试时的坑」）。

**`_verify/sb-verify6.js`** —— 「**自由摆放**」，**93 条**：

| 段 | 内容 |
|---|---|
| A | 默认就是自由摆放；两套手势互斥（`draggable` 让位、`dragstart` 被 `preventDefault` 且不记 `stSbDragId`）；开关跟着草稿走 |
| B | **零偏移 = 零字节**：每一块的 `stSbOffCss` 都是空的、产物里一条 `left`/`top` 都没有 |
| C | **真指针拖动**（合成 `PointerEvent`）：3px 阈值内不算拖、拖动**过程中**元素就实时跟手、松手才落库、写回正则、往左上挪得出负值 |
| D | Shift 吸附 8px 网格（30 → 32、20 → 24） |
| E | 方向键 1px / Shift+方向键 10px / 方向键被拦下（页面不跟着滚）/ Escape 取消选中 |
| F | 归位：单块归位后产物里那两条消失；全部归位后一个歪的都不剩 |
| G | 解析别人的卡：`left:8px` / `top:-4px` 读回来、`extra` 里不重复记；`static` 上的 `left` 不当偏移（但也别丢、别凭空补 `position:relative`）；`absolute` 不当偏移；带定位壳的表格 → 高级块且**壳只有一层**、再解析一遍偏移不翻倍 |
| H | 挪过位置之后仍然满足运行时两条判定、重新生成逐字节相同、`stSbDetect` 还是 `mine`、**真机预览里那块也真的挪了**（`left:40px` / `top:6px`） |
| I | 存了再读：`offX`/`offY`/开关都还在，`draggable` 还是 `false`，产物里偏移也在 |
| J | 收尾零报错 |

C 段和 H 段是这一轮的核心证据：**C 证明能随手挪，H 证明挪了之后「按运行时规则解析」那套
一个字都没坏。**

**`_verify/sb-verify7.js`** —— 「**调整大小**」，**100 条**：

| 段 | 内容 |
|---|---|
| A | 属性面板多了「尺寸 px」的 W / H 两格（`space` 只有 W）；八向把手**只在选中那一块**上出现 |
| B | **零尺寸 = 零字节**：每一块的 `stSbSizeCss` 都是空的、产物里一条 `width`/`height` 都没有 |
| C | **真指针拖动**（合成 `PointerEvent`）：拖 `e` / `s` 只长自己（宽 / 高各长 37px），另一个轴一个字节都不动 |
| D | 拖 `w` / `n` 时**位置跟着走**（`offX` 加回等量）；拖过头夹在 8px 下限，且位置不再继续跑 |
| E | Shift 吸附 8px 网格 |
| F | `Alt` + 方向键改尺寸 1px、`Alt+Shift` 十档；没设过尺寸时**先量当前大小**当起点 |
| G | 「⤡ 恢复默认尺寸」与「全部归位」互不干扰（复原尺寸不动偏移，归位偏移不动尺寸） |
| H | 解析别人的卡：`px` 读得回来、`%` / `calc()` 原样带走不当尺寸、**分割线自己的 `height:1px` 不误读** |
| I | 挪过 + 调过大小之后运行时两条判定不塌、`stSbDetect` 还是 `mine`、真机预览里也生效 |
| J | **画布上量到的宽 == 真机预览里量到的宽**（内容盒对内容盒） |
| K | 存了再读：`w`/`h` 都还在，产物里尺寸也在 |
| L | 收尾零报错 |

J 段是这一轮的守门员：画布和真机预览是两套 CSS 环境（画布用编辑器的样式，预览是独立
iframe），只要有一边把 `width` 写错了地方 —— 比如写到了 `.st-sb-hit` 命中框上 ——
两边量出来的宽就对不上，当场红。

**`_verify/sb-verify8.js`** —— 「**预制块**」，**113 条**：

| 段 | 内容 |
|---|---|
| A | 装载与零报错（变量树清空 + 套空白模板，让后面每一段能自己说了算「卡里有哪些变量」） |
| B | 那一区渲染出来了：分类小标题 6 个（5 内置 + 我的）、按钮数 == `ST_SB_PREFABS.length`、块库 9 个没被挤掉、**遍历全部预制块逐个 `build`**（类型都在块库里、没有空分组）、**`extra` 盖不掉绑到的范围** |
| C | 卡里还没变量 → 走兜底路径 + `warn` 提示 + 图层行 / 命中框跟着涨 + 写进产物 |
| D | 建出变量再插 → 自动绑定，**用的是变量自己的 `min`/`max`** |
| E | 选中分组 → 进分组；不选中 → 落根上（两条都走**增量**判据） |
| F | 复数：三个槽各绑各的、路径互不相同、范围各是各的、横排版同理 |
| G | 存 / 插 / 覆盖 / 取消 / 删 / **刷新后还在** / 名字格扛得住重绘 / 插入的块 id 全唯一 |
| H | 边界：空画布、单块超 40 KB、localStorage 里的坏数据（逐条跳过 + 字段集仍等于空白块） |
| I | 窄屏：按钮一个不少、**没有 0 高的**（配「面板可见」作对照）、点击目标 ≥32px |
| J | 收尾零报错 |

这一轮有三条判据是**被反向测试逼出来重写的**，值得记下来：

- ⚠ **D / F 两段的变量名故意跟预制块的兜底名不一样**（`血量` 而不是 `生命值`、`小猫 / 小犬`
  而不是 `角色A / 角色B`）。第一版用同名的，于是「绑上了」和「没绑上」在路径、显示名上
  **长得一模一样** —— 那种断言**永远为真**，反向测试一注入（关键词匹配整个失效）它照样绿。
- ⚠ **E 段的对照组必须是增量**。第一版写的是绝对值（`root == eg.root + 2`），注入
  「永远落根上」之后它跟着红了 —— 那不是「对照组坏了」，是它被上游那次失败带塌了。
  改成「根层 +2 / 分组一块没多」之后，注入下**照样绿**，才叫真对照。
- ⚠ **反向测试的锚点必须落在同一行**：产品是 CRLF，带 `\n` 的多行锚点一次都匹配不上
  （`_reverse10.js` 的 R3 第一版命中 0 次）。

反向测试在 `_verify/_reverse10.js`，**5 个探针**（单个绑关键词失效 / 复数绑关键词失效 /
复数三槽全取 `hits[0]` / 克隆不换 id / 插入永远落根上），每个探针都断言
「**预期该红的恰好都红了 + 对照组一条都没红 + 没有预期之外的红**」，收尾核 `saki.html` 的 sha1。

**`_verify/sb-verify9.js`** —— 「**AI 生成预制块**」，**123 条**：

整条链要发网络请求，所以跟 `st-ai.js` 一个做法：`Page.addScriptToEvaluateOnNewDocument` 里
把 `window.fetch` 整个换掉，配 `window.__aiScript = { reply, fail, delay }` 与
`window.__aiCalls`（**刷新之后桩还在**）。⚠ 每次 `reload()` 之后要**重配一遍 `aiConfig`** ——
内存里改的没落过盘，刷新就回到 localStorage 那份，后面那条 `gen` 会红在
「还没配 Base URL」上，看着像功能坏了。

| 段 | 内容 |
|---|---|
| A | 装载与零报错（假 fetch 装上了、编辑器打开、MVU 已接管状态栏） |
| B | 那一行渲染出来了：输入框 / 按钮 / 分类小标题 / `placeholder` 有例子；**描述进状态 + 重绘后还在**（配对照组，证明不是只写在 DOM 上）；超长截到 120 |
| C | **没配 AI 就不发请求**（`callN() == 0`）+ 当面说清原因 + `warn` 样式 + 忙态没卡住；配好之后作对照 |
| D | 提示词：system 里 9 种块类型一个不少 +「只输出 JSON」+「不要发明字段名」+ `#rrggbb`；user 里**喂了卡里真实的变量路径与范围**（`stat_data.hp` / `0~150` / 负范围 `-100~100`）；卡里没变量时走兜底话术（配「不再列变量清单」作对照）；**非流式**（`stream:false`） |
| E | 解析容错：裸 JSON / ``` 围栏 / 前后寒暄 / 顶层直接数组 / 缺 `blocks` / 空数组 / **全是空块** / 非 JSON / 空回复 / 不认识的 `type` / 垃圾数值 |
| F | **清洗**：`offX/offY/w/h` + `extra/extraInner/extraFill/wrapExtra` + `clsMap/clsOwn` 一律归零（10 条）+ 递归到子块（2 条）；**配 9 条「合法外观字段留住了」作对照** |
| G | **封顶**：40 块裁到 24 且顺序不乱；深 5 层**摊到 3 层**、**块一块没少**、还是 `ok`、「太深了」那句还在（**行为判据，不只是数字**） |
| H | 落盘：存进「我的预制块」+ localStorage 形状 `{v:1,list:[…]}` + DOM 里也出现 + **刷新整页还在** + **同名加编号不覆盖** + 存满 60 拒收 |
| I | 绑定统计：一条真一条编 → `1/2`（且提「建了同名变量就通」）、两条都编 → `0/2`、**一组里没有 `path` 就不提这个数** |
| J | 失败路径：网络异常 / HTTP 401 / 回人话（非 JSON）/ 空 `blocks`；**失败之后还能再正常生成一次**（对照） |

⚠ **清库必须走 API**（`stSbPfStore([])`）—— 裸 `localStorage.removeItem` 清不掉内存里那份
`stSbPfCache`，于是「清空」之后读出来还是老列表，红得莫名其妙。
⚠ **填满 60 条时 `blocks` 不能是空的** —— `stSbUserPrefabs()` 会把「没有块」的条目**整条跳过**，
拿空块填满会得到 0 条，看着像 store 坏了，其实是测试喂错了东西。

这一轮有**两个真 bug 是这套件抓出来的**（详见上面「让 AI 生成一组」）：

- ⚠ **深度上限只在块数超了才生效** —— 一棵「块不多但很深」的树整个绕过它。
  判据必须是 `n > MAX_BLOCKS || deep > MAX_DEEP`，**任何一个超了都要裁**。
- ⚠ **裁剪按深度砍子树会把内容一起丢** —— `row>row>row>row>文字` 砍完只剩三个空 row，
  接着被判「空块」整份拒收。改成**摊平**（子块提到同一层）。**丢层级可以，丢内容不行。**

反向测试在 `_verify/_reverse11.js`，**4 个探针**（深度上限退化 / 清洗整段失效 /
同名不换编号 / 提示词不喂变量路径），判据跟 `_reverse10.js` 一样。

⚠ 这一套的反向测试比上一套**多一道闸门**：**探针点名的断言必须在基线里真的存在**。
两类静默失效都挡在这儿 ——

1. `red` 里有个不存在的名字 ⇒「预期该红的都红了」会**永远红**（于是你会去查产品）；
2. `green` 里有个不存在的名字 ⇒「对照组一条都没红」**天然成立** ——
   **对照组被悄悄削弱了，而探针照样全绿**。

**第一次跑就抓到 4 处**（3 处是断言名带前导空格、1 处抄错名，而抄错的那个正在 `green` 里）。
⇒ 名单对不上就**直接退出**，别浪费后面 4 次整跑。

⚠ 两个踩过的坑，都跟「把断言名抽出来」有关：

- **抽 ✅ 的名字要两边 `trim`**。`check()` 打的是 `  ✅ ` + 名字，而名字**自己可能带前导空格**
  （`check('  是摊平不是砍掉…')`）—— 正则里的 `\s+` 会把那个空格一起吃掉，抽出来的名字
  **少了两个空格**，而名单里手抄的是带空格的原文 ⇒ `indexOf` 永远 -1。
- **失败项的列表符两套件不一样**：`sb-verify8.js` 是 `  - 名字`，`sb-verify9.js` 是 `  · 名字`。
  照抄上一套的 `failsOf`（只剥 `-`）会一条都匹配不上 —— 而且表现为
  「对照组一条都没红 ✅ / 没有预期之外的红 ✅」，**看着像过了**。两个都要剥。

**`_verify/st-ai.js`** —— 「**编写器的 AI 调用**」，**336 条**：

这一轮的东西全都要发网络请求，所以**不能真连服务商**。做法是把 `window.fetch` 整个换掉
（`Page.addScriptToEvaluateOnNewDocument`，刷新之后桩还在），按 URL 形状判断对方是哪套协议，
再回一份**形状正确**的假响应。于是下面这些都能真的断言到，而不是「代码里写了」：

| 段 | 内容 |
|---|---|
| A | 配置层：`follow` 现读 AI 对话那套（改那边这边跟着变）、`own` 自己一套、协议按 Base URL 推断、就绪判定三种缺项、本机地址免 Key |
| B | 请求形状：OpenAI 走 `/chat/completions` + `Bearer`；Anthropic 走 `/messages` + `x-api-key` + `anthropic-version` + 浏览器直连头；system 提到顶层、首条补 `user`、连续同角色合并；结尾多一条斜杠不拼出 `//` |
| C | 模型列表四种形状（`{data:[{id}]}` / `{data:[{id,display_name}]}` / 裸数组 / `{models:[{name}]}`）、去重排序、剥 `models/` 前缀、空列表报错 |
| D | 流式：两套 SSE 都拼回原文；`onDelta` 每次给的是**累积全文**；非流式走 `resp.json()` 且请求体里 `stream:false` |
| E | JSON 抠取：裸的 / ``` 围栏（带不带语言标记）/ 前后寒暄 / 尾逗号 / 数组 / 坏 JSON / 空回复 / 字符串里的转义与换行 |
| F | 扩写：提示词里有没有条数·要求·氛围·格式·素材；结果解析（关键词字符串被拆开、位置深度顺序夹紧、空条目丢掉）；套用进世界书；模型回一堆废话也照样解析 |
| G | 开场白：注入顺序（**停用跳过、Outlet 跳过、`@D` 按 depth 从大到小**）；提示词带上注入预览；覆盖主开场白 / 追加备选 |
| H | **隐私**：API Key 不进卡、不进草稿、不进导出，但确实存在 `stAiCfg` 里 |
| I | 面板：15 个选项卡、AI 页渲染、两个面板挂得上、复古皮肤下方角 |
| J | 失败路径：401 / 500 / 网络不通 / 坏 JSON / 没有 `entries` / 配置不全时**不发请求** |
| K | 草稿往返：配置与面板参数都还在，预览不会残留、`running` 不会卡住 |
| L | **单条改写**：面板只渲染展开的那一条、参考范围三层过滤（排除自己 / 排除空壳 / 仅启用·全部·同分组）、没有分组时「同分组」退回「仅启用」、提示词里带原条目与参考条目、只改正文 / 全套字段两种套用、空值不覆盖、追加为新条目、生成期间条目被删的兜底、三种包装形状、错误只挂在所属条目上 |
| M | **「第一段」与提示词结构预览**：空着时一条额外消息都不产生、填了之后两套协议下都在最前（`messages[0]` / 顶层 `system` 开头）、`{{char}}`·`{{user}}` 两种宏语义、`follow` 现读 / `own` 自己一套且只读镜像写不进去、AI 对话那条路（含关掉系统提示词后仍在）、四处预览都挂上且第一段是 `#0`、展开预览不改动持久化状态、第一段不进卡不进草稿 |
| N | 收尾零报错 |

C 段和 J 段暴露过一个**真问题**：`stAiPullModels` 原本复用 `stAiReady`，而后者要求
「必须已经选了模型」—— 可「拉模型列表」这一步**本来就是为了挑模型**，要求先有模型就成了
死循环。修法是给 `stAiReady` 加 `{needModel:false}`。

**`_verify/st-code.js`** —— 「**Code（Agent）页**」，**670 条**：

跟 `st-ai.js` 同一套做法（换掉 `window.fetch`），但多一层：**按轮次喂脚本**。
第一轮回一个带 `tool_calls` 的响应、第二轮回纯文字，于是「中间那条 `tool` 消息确实带着
工具结果发回去了」这件事能被断言到 —— 这是「Agent 循环真的闭环了」的唯一硬证据。

| 段 | 内容 |
|---|---|
| A | 接线与布局：15 个选项卡里有 `code`、左右两栏、工具条的折叠菜单与动作按钮、窄屏分段控件 |
| B | 协议层：`stCodeRequest` 两套形状（`tools[].function` vs `tools[].input_schema`）、URL / 头 / 体；工具数量**从 `ST_CODE_TOOLS` 枚举**而不是写死 |
| C | 消息转换：工具消息怎么进两套协议（`tool_calls` / `tool_result`）、连续 `tool_result` 并进同一条 user、`note` 两处都过滤 |
| D | 回复解析：OpenAI `tool_calls[]` / Anthropic `tool_use` 块 → 统一的 `{text, calls[]}`；坏 JSON 的参数当空对象 |
| E | 工具执行：`read_card` 不传 path 给整卡、传了只给那一个字段；`write_text` / `write_list` 只认白名单，越权路径**报错而不是静默**；`write_list` 三种 mode；世界书工具（摘要不含全文、删除进回收站、`update` 空值不覆盖）；超长结果截断（**两档预算**：读整份文档的工具 32 000 字符、其余 12 000，且断言「名字以 `read_` / `list_` 开头的一定都在读名单里、写工具一个都不许混进去」） |
| E2 | **`fetch_url` 的地址闸门**：只认 http/https；`localhost` / `127.0.0.1` / `10.` `172.16.` `192.168.` / `*.local` 一律拒；二进制与超大响应报错；工具描述里写明「浏览器代你访问，不是你能上网」 |
| E3 | **`set_tasks`**：整表替换（旧的全没了）、没写 `status` 默认 `pending`、空 `text` 丢掉、未知 `status` 归 `pending`、裸字符串也收、整表为空报错、上限 24 条并说明丢了几条、**会话隔离**（新会话没有上一条的清单）、清单渲染 / 默认展开 / 进度摘要、跟着 `stCodeSessions` 持久化 |
| E4 | **项目记忆**：`remember` 追加成「- 」开头的列表行、同一句不重复记、空 `text` 报错、**注入 system** 且标题标明「优先于上面的通用做法」、没记忆时不出现那一节、**满了拒绝而不是截断**、面板上显示条数、输入框里是当前记忆、**不进卡也不进草稿** |
| E5 | **`read_doc` / `write_doc`**：状态栏给 body HTML、MVU 给 Zod 源码；写 MVU 之后卡里真的多了变量、`[InitVar]` 跟着重写；**没有 `registerMvuSchema` 拒绝**、认不出来的 Zod 拒绝、空 `text` 拒绝，**三种拒绝之后卡都没动**；状态栏写回之后 `stSbParseDoc` 能原样读回来（往返闭合）、块数与 `textOk` 对得上、解析不出块时拒绝；**手写的状态栏被认成 `foreign` 时 `write_doc` 拒绝、`read_doc` 给原文而不是编辑器那份默认的** |
| E6 | **`read_regex` / `write_regex` / `read_th` / `write_th`**：清单 / 按 id 读全文 / 按名字读 / 找不到报错；增（缺 `scriptName` / `findRegex` 报错、新正则默认启用）/ 改（**没传的字段不动**）/ 删（进回收站、`kind` 分流、撤回**没有**塞进世界书）；**闸门**：改或删 MVU 那几条正则被拒、改或删 MVU 核心与 Zod 脚本被拒、**只改开关放行**；文件夹里的脚本也读得到 / 改得到 / 删得到（只删夹里那个，不是把文件夹删了）；`read_card` 读这四样会**指路**而不说假话；整张卡走形状摘要而不是硬截断 |
| E7 | **截断标记闸门 + `read_doc` 分段接着读**：`stCodeToolCap` 两档取值、`write_text` / `write_doc` 在 `autoApply` **之前**就挡住带标记的正文（**卡没动**）、`read_doc` 的 `from` 从指定偏移接着读、读到尾会说明、提示语留在代码围栏**外面**；两组**派生**断言（`/^(read_\|list_)/` 的名字必须都已注册、读名单里不许出现 `write_` / `add_` / `update_` / `delete_`） |
| E8 | **skill 落盘：IndexedDB + 降级 + 老数据迁移**：后端判定进 `stCodeSkillBackend`、一次写入再读回、`localStorage` 里的老数据被**先迁后删**（不是先删）、IDB 打不开时降级回 `localStorage` 并留脏标记、下次打开看到脏标记先迁移、写失败给的是可读文案而不是异常、串行链保证「写 A 再写 B」不会交错、同一 payload 快照不被后续改动污染 |
| E9 | **工具型 skill：manifest → 注册成工具 → 沙盒里跑**：`/*!MANIFEST {…}!*/` 解析（**收尾那个 `!` 不许被吞进 JSON**）、名字正则 / 撞内置名 / 未知 `perm` / 缺 `description` 各自报错且说明原因；`stCodeToolDefs()` 是唯一真相源、`stCodeToolsFor` 两套协议都能映射；`kind:'tool'` 的 skill **不进**自动注入池、`list_skills` 标 `[工具]`、`read_skill` 指回工具名；沙盒里 `fetch` 被 CSP 挡、`new Worker(blob:)` 也被挡、**死循环不冻住父页面**（进程隔离，父页面 `setInterval` 照跳）、5 秒超时**一定**有回音、超时 / 出错后 iframe 一定被摘掉；返回值里的 `</script` 被转义 |
| E10 | **权限白名单**：能力表里 `card.read` / `card.write` 都在（**推导式**，不再写死整份清单 —— 加 `progress` 那一轮就是它逼着改的）、**推导式**断言（凡读卡的 `read_`/`list_` 工具都归在 `card.read`、凡 `write_`/`add_`/`update_`/`delete_` 都归在 `card.write`）、`read_skill`/`list_skills` 明确**不在**表里；**`fetch_url` / `set_tasks` / `remember` 一层都不给**；能力表里只有内置工具（沙盒调不到别的 skill，**不递归**）；已下线的能力名会被过滤（求交集，不直接信 manifest）；申请了没有的能力 → **导入就拒**且理由说清；三个探针（没申请 / 只读 / 只写）各自验证「通的通、拒的拒」、**写不等于读**、`fetch_url` 连 `card.write` 也调不到、**次数上限 20 次**（25 次里后 5 次被拒）；**没给 `value` 不许当空串写**（那会静默清空字段还回成功回执）；**改过卡要带 `touched` 回外层**（只读 / 什么都没动的不报）、**「写完才炸」不许说「卡没有动」**；面板上的 `✏️ 能改卡` 警示与「沙盒里能调：…」、system / `list_skills` / `read_skill` 三处都要说清它能不能碰卡；**导入那一刻就点名**（有 `card.write` 的 skill 装进来时直接列出名字、给「移除」这条退路，顶部闪的那句也带警告；**对照组**：纯算的 skill 不出现那条警告、闪的那句也不带）；**只读判据 `stCodeIsReadTool`** = 静态读名单 **或**「没申请 `card.write` 的工具型 skill」（⚠ 申请了 `card.write` 的一律按改卡算，哪怕这次只读了一行 —— 猜错方向的代价不对称） |
| E11 | **skill 自报进度（`host.progress`）**：`progress` 进了能力表、**映射到空工具列表**（它不是一个工具，走的是 `__prog`）、`stCodePermToolNames` **不**把它拼进工具名（拼了会诱导 skill 去 `host.call('progress')`，那是死路）、能力表与 `ST_CODE_SANDBOX_PERM` **是一份**（推导式对账，只有一边登记的后果是「申请得到但调不动」）；boot 里定义了 `host.progress`、记下了 `__rid`、且它发的是 `__prog` 而**不是** `__host`；真跑一个申请了 `progress` 的 skill → 两条进度都到宿主、**返回之后那句被撤掉**、**对照组**：进度文字没有混进给模型的工具返回文本；没申请的 → skill 照常成功、那句被丢掉且**一条都没显示**；狂刷 300 条 → run 不失败、被节流 + 次数上限挡住，**单独一条**断言「同一 tick 里连发的第二条会被丢」（只断言「少于 300」的话「全过但有 299 条」也会绿 —— 那条是这一条的对照组）；面板标 `⏳ 能报进度`、**不把只申请了进度的 skill 说成「读不到卡」**、文档里写明「不用 await」与「太快会被丢」 |
| F | **Agent 循环**：一轮多工具、多轮、**消息序列 `user,assistant,tool,assistant,tool,assistant`**（文字与工具调用合成一条 assistant）、改卡次数上限由思维强度决定、到上限就停、**只读工具不占改卡次数**（连读 6 次之后照样能写）、连读兜底 40 次、工具报错喂回模型而不是炸循环；**端到端**：模型调一个**工具型 skill** 改卡时循环真的重画了卡 JSON（`touched` 穿过沙盒那两层），外加**只读对照**证明那条断言不是恒真（实现里换掉 `stCodePaintJson` 计数，跑完还原）；**改卡预算的对照组**：连调 6 次**没申请 `card.write`** 的纯算 skill 之后照样改得动卡（system 承诺「只读不占步数」），而**申请了 `card.write`** 的 skill 照样 4 步就停 |
| G | 会话：新建 / 切换 / 删除 / 清空、标题取第一句、上限 40、刷新后还在 |
| H | skill：frontmatter 解析 + 无 frontmatter 的兜底、导入 / 移除 / 清空、非 `SKILL.md` 忽略、同名以后导入的为准、system 里列出可用 skill 并告诉模型用 `read_skill` |
| H2 | **从链接导入 + 拖拽导入**：四种链接形态归一（raw / blob / tree / 仓库根）、`default_branch` 探测、raw 地址里的空格被编码、真的从假 GitHub 导一次、拖拽挂在弹层上（`ondragover` 有 `preventDefault`）、地址活在状态里且**不进 localStorage**、拖到页面别处被拦住但不误拦非文件拖拽 |
| H3 | **skill 自动注入**：触发词切分（逗号 / 顿号 / 斜杠 / 分号，**单字丢掉**、上限 12）、frontmatter 的 `triggers` / `keywords`、没写触发词退回用名字兜底、命中就选中、**粘性**（第二句不命中时正文不掉）、`@名字` 强制加载、删掉的 skill 清出名单、`autoSkills` 排序稳定、**真发一轮**断言正文进了 system、不命中时只列名字、**超过总量上限退回只列名字不硬塞** |
| I | **「第一段」开关**：默认不带（老行为不变），打开后必须带、且必须排在最前（两条协议下都验）；空值不发；落盘与刷新往返；对照组：关着时那段有内容也不发 |
| J | 思维强度：四档、档位对应步数、写进 system、**不动 `temperature`**、安全开关（关掉「真的改卡」时提醒模型） |
| K | 隐私：skill / 会话 / 工具结果都不进卡、两个 `localStorage` 键各管各的（skill 那份已经搬进 IndexedDB，卡里和 `localStorage` 里都找不到）、复古皮肤下 Code 页还在 |
| L | 收尾零报错 |

⚠ **这张表里的段名必须和套件里的 `section(...)` 一字不差。** 之前它整体漂过一轮
（文档说 A 是协议，实际 A 是接线与布局），而**漂了不会红** —— 对照一下就知道了。

**`_verify/sb-keep-compare.js`** —— 「按原样解析」的终极证据，**32 条**。
把原稿和解析后重新生成的产物放进**同一个浏览器**，逐元素比对**渲染出来的**几何与计算样式
（位置 / 尺寸 / 颜色 / 背景图 / 阴影 / 字距 / 内边距 / 四边边框 / 圆角 / 字号 / 字重 /
对齐 / display / flex / gap / 行高 / white-space / overflow / 不透明度 / margin …），
再截同一块 500×1100 区域比 **PNG 字节**。

跑**两份形态完全不同的手写稿**（这是关键 —— 只跑一份会漏掉整整一类 bug）：

| 稿子 | 形态 | 期望「退化成高级块」上限 |
|---|---|---|
| `inline` | 处处内联 `style`，生成器画不出来的走 `extra` 那几层 | 0 |
| `class` | 样式全在 `<head>` 的 `<style>` 里，**每一层**靠 class 命中 | 3 |

class 稿里有两层容器（圆点行外层、分组列）本来就没有可识别的内联特征，**合理地**退成高级块 ——
所以上限是**按稿子分档**的（`maxRaw`），不能写成全局的「必须为 0」。第一版就是这么写的，
对 class 稿是假报警。

`class` 稿还要额外验三条（第一版全红，见 bug 24–28）：

- 原稿的 10 个 class 一个不少地出现在产物里（含外壳那个）
- `class` 层数与「光靠 class」层数数对了
- `stSbLook` 的语义单测：不带 class 原样返回 / 带 class 只留原稿写过的属性 /
  光靠 class 一条不写 / `pre-wrap` 三种情形

产出四份可以直接看的文件（每份稿子一对）：

- `_verify/shots/keep-compare-{inline,class}.html` —— 左原稿 / 右产物 并排对照，
  顶上一枚「完全一致 / N 处不同」的徽章
- `_verify/shots/keep-compare-{inline,class}.png` —— 同一页的截图

三条关键细节：

- **逐元素比对要跳过 `<br>` / `<style>` / `<script>`**：原稿的 `<br>` 被换成了文字块里的换行
  （配 `pre-wrap` 渲染出同样的断行），DOM 上少一个元素但画出来一模一样；
  `<style>` 原稿写在 `<head>` 里、产物把它搬成了 body 里的高级块，位置不同不影响渲染，
  但元素表会错位。比的是**渲染结果**，不是 DOM 形状。不跳过的话两边数组错位，后面几十条全是假的
- **像素比对才是终点**：几何 + 计算样式全对，也不代表画出来一样（子元素继承、层叠顺序、
  圆角裁剪都可能差）。截同一块区域比 PNG 字节，`===` 就完事。为此单独做两个极简页面
  （`px-{inline,class}-{a,b}.html`，一个 iframe 钉在左上角），各自截 `{x:0,y:0,width:500,height:1100}`
- **先把所有稿子解析完，再统一去对照页**：对照页会顶掉编辑器页面，
  交叉着来第二次解析时 `stSbParseDoc is not defined`

### 排查无限递归：给可疑函数装深度守卫

症状是 `RangeError: Maximum call stack size exceeded`，栈里只有同一个函数在自我调用、
看不出**是谁**把它调进来的（`Error.stackTraceLimit` 默认 10，外层帧全被截掉）。
逐句复现又常常不复现。做法是**原样重跑失败的验证脚本**，只在启动时把可疑函数换成一个带计数器的包装：

```js
stSbLocate = function (id, list, prefix) {
  window.__depth++;
  if (window.__depth > 25) {
    // 把当时的完整数据结构 dump 出来，异常消息里带上
    throw new Error('DEPTH>25 id=' + id + ' listIsArray=' + Array.isArray(list) +
      ' blocks=' + JSON.stringify(dumpBlocks()));
  }
  try { return window.__origLocate(id, list, prefix); } finally { window.__depth--; }
};
```

几个要点：

- 必须**原样重跑**，别自己重写一遍步骤 —— 逐句复现丢掉的往往正是触发条件
- `Error.stackTraceLimit = 300`，否则看不见真正的调用方
- 报错信息里带上「参数形状」比带上栈更有用（这次一眼看出 `listIsArray=false`）
- 包装函数要能被**内层递归**看到：`stSbLocate` 是顶层函数声明、挂在全局，
  所以内层 `stSbLocate(...)` 会走包装版，计数器才累得起来

### 测试时的坑

- 给文本框 / textarea 赋值要发 **`input`**（`stInput` / `stArea` 挂的是 `oninput`）；`<select>` / checkbox 才是 `change`
- `stSetGreeting(i,v)` / `stSetList(path,i,v)` 只管**已有槽位**，不会凭序号凭空造，测试得先 `stAddGreeting()` / `stAddListItem(path)`
- 内容区一次只渲染当前那一页，数条目卡片之前必须先 `stSwitchTab('book')`
- PNG 尾部是 `length(4) + "IEND"(4) + crc(4)`，最后 8 字节里类型名在**前** 4 个字节
- 量「元素可见 / 能点到」前先 `scrollIntoView`，否则 `elementFromPoint` 会量到别的元素
- MVU 检查器的控件 id 走 `stMvuDomId()`（`'st-mvu-n-' + 末 16 位`），不是 `'st-mvu-' + 节点id + '-字段'`
- **别把状态栏的「块路径」当「字段路径」用**：`stSbChain(id).slice(-1)[0].path` 拿到的是
  `card.statusBar.blocks[0]`，要再 `+ '.color'` 才是字段路径。少了后缀曾经把整块写成 `''`（bug 表 18 / 19）
- **赋值给错名字不会报错，只会静默什么都不做**：harness 里写成 `stSbSel = ''`
  （漏了 `stEditor.`）就凭空造了个游离全局，页面状态一点没变，而断言照样跑。
  写页面内代码时凡是改状态的赋值，都要确认它挂在对的对象上
- 页面会弹 `confirm()` 的地方（换版式、覆盖别人的状态栏）**别靠 CDP 的对话框自动应答**，
  用 `Page.addScriptToEvaluateOnNewDocument` 往页里装一个同步桩（记下调用、返回 `true`），
  再挂 `Page.javascriptDialogOpening` 当保底。CDP 那条路实测约 **20%** 会翻车：
  Chrome 会先一步把对话框撤掉，我们那句 `Page.handleJavaScriptDialog` 才到，回一个
  `-32602 No dialog is showing`，于是 `confirm()` 静默返回 `false`。症状极具误导性 ——
  红的是一个跟弹窗八竿子打不着的断言（`smoke.js` 的「产物里有进度条宏」），而且单跑不复现。
  **别再用空的 `.catch(() => {})` 吞掉它**，那正是它藏了整整一轮的原因
- **给块加字段会让旧断言的前提过时**，而失败信息往往完全指不到真正的原因。
  这一轮加 `w` / `h` 之后红了三处：①「分割线没有多余的文本框」数出来 2 个 —— 每种块都多了
  W / H 两格，得在断言里排除；②「保住的块数 ≥5」变成 4 —— 加粗分割线的 `height:2px`
  从「原样保留」**升级**成了正经字段 `h`，是行为变好不是回归；③「画布顶上有两个按钮」
  变成 3 —— 多了「⤡ 尺寸复原」。加字段时顺手把这三类断言都过一遍
- **测解析器最有效的办法是「自往返」**：拿自己的生成器产出当输入，抹掉只属于自己
  （结构注释）的标记，再解析回来比结构。生成器和解析器互为逆运算，任何一边改了
  而另一边没跟上，模板一跑就露馅 —— 比手写一堆 fixture 管用得多
- 「原样保留」类功能要断言**内容真的还在**（`indexOf('<table')`、`indexOf('.sb-x{color:red}')`），
  只断言「块类型是 `html`」是不够的 —— 那可能保留的是别的东西
- 断言一个容器的行数 / 命中框数之前，先确认**选择器真的命中了**：
  `#st-sb-layers` 这种 id 是我凭印象写的，容器上其实只有 class，于是 `0 === 0` 假通过
  （这次是 `0 === 12` 才被抓到）。查询类断言最好先单独打一次原始计数
- `stMvuInstall()` 是纯模型操作**不重画面板**，验 UI 得走 `stMvuInstallClick()`
- `data.extensions.regex_scripts` 里是 **camelCase**（`scriptName`），不是 `script_name`
- 视觉套件里多段共用同一个编辑器会话，卡里已经有东西 —— 断言要用**增量**而不是绝对值
- **拿页面里的字符串当断言对象时，先想清楚它是从哪生成的**：
  「文字自己的颜色还在」曾经去 `stSbShellOpen()` 的返回值里找块的颜色 ——
  那是外壳的**开标签**，块在 body 里。断言永远 false，还以为是真 bug
- 同一条：`stStatusBarFromRaw({...})` 少传一个字段（比如 `shellOff`）不会报错，
  只是行为悄悄退回默认。**解析 → 重建**这种链路要把 `stSbParseDoc` 的返回整份传进去
- 两个 iframe 并排做对照时，`getBoundingClientRect()` 是相对各自 iframe 视口的 ——
  布局一样坐标就一样，可以直接比。但**两边元素个数要先对齐**（跳过 `<br>` 这种
  「渲染等价、DOM 不等价」的差异），否则后面全是错位的假差异
- **`sandbox` 不给 `allow-same-origin` 的 iframe 是 OOPIF，父页面够不着它**。
  预览 iframe 故意不带 `allow-same-origin`（要跟运行时一致），于是
  `Page.getFrameTree` 里根本没有它，`contentDocument` 是 `null`。
  得开 `Target.setAutoAttach({autoAttach:true, flatten:true})`，监听
  `Target.attachedToTarget` 收下子 `sessionId`，之后 `Runtime.evaluate` 带上它才进得去
- **逐元素比对要跳过 `<style>` / `<script>`**，不只是 `<br>`：原稿写在 `<head>` 里的
  `<style>`，产物会把它搬成 body 里的高级块。CSS 是全文档生效的、位置不影响渲染，
  但两边的元素表会从那一格起全部错位（症状是 `tag: DIV ≠ STYLE` 刷屏）
- **同一份断言不能套在所有 fixture 上**。class 稿里有几个容器本来就没有可识别的内联特征、
  **合理地**退成高级块 —— 断言得按稿子分档（`maxRaw`），写成全局「必须为 0」就是假报警
- 在一个循环里既「解析稿子」又「去对照页比对」会互相顶掉页面：先导航到对照页之后
  再解析下一份，编辑器页面已经没了（`stSbParseDoc is not defined`）。
  拆成两段循环：先在编辑器页面把所有稿子解析完，再统一去对照页
- **`clsOwn` 这类「只在另一个字段非空时才被读」的字段，清理可以省**：
  丢 class 时不用管同一层的 `clsOwn`（class 一空它就是死数据），
  但要在代码里写清这层依赖 —— 不然下次有人改 `stSbLook` 就会踩
- **进了 OOPIF 之后「求值成功」不等于「文档就绪」**。改 `srcdoc` 会让 iframe 整篇重载，
  新文档还没解析完时 `document.body` 是 `null`，求值照样返回（拿到空 body）——
  而 `frameEval` 只在**抛异常**时重试，返回 `null` 它当成正经答案。症状是
  「真机预览里那块也挪了」随机挂，单独跑又过（`sb-verify6` 的 H 段就栽在这）。
  **改成轮询**：`for` 循环里 `sleep(200)` + `frameEval(...).catch(() => null)`，
  拿到目标状态才 `break`；表达式本身也写防御一点（`document.body ? … : null`）
- **连跑整套时，调试端口和 HTTP 端口都不能写死**。上一轮的 Chrome 还没退干净就会占着刚抽到的
  号，症状是「Chrome 调试端口没起来」/「连不上 CDP」—— 跟被测页面一点关系都没有，
  而且每次挂的套件都不一样（约 1/150）。改成**先真绑一下再定**：`http.createServer().listen(p)`
  绑得上才算数，绑不上就换一个。纯随机也不行，随机一样会撞上正在退出的那个
- **别把「上一次跑剩下的草稿」当成页面初始状态**。草稿在 `localStorage` 里，同一个浏览器实例里
  连着导航几轮，第二轮一进来就带着上一轮那张卡（`openStEditor()` 会把它读回来）。
  连轮次跑要么每轮 `localStorage.clear()`，要么每轮换一个 `--user-data-dir`
