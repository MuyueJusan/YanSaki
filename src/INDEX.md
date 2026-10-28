# src/ 模块索引

> **自动生成，别手改。** 每次 `node build.js` 都会重写这一份。
> 想改标题 → 改 `src/manifest.json` 里对应那条的 `title`；想加模块 → 在 manifest 里按顺序插一条。

共 **158** 个模块 / **33477** 行，拼成 `saki.html`（1704.6 KB）。

## 怎么改

1. 下面这张表里找到功能 → 打开那个文件（或者 `node build.js --where 关键字` 直接搜）。
2. 改完 `node build.js`。
3. 构建会拦住「绕过 src/ 直接改 saki.html」的情况，报错时按提示处理。

⚠ **顺序就是语义**：`manifest.json` 的数组顺序 = 拼装顺序。JS 顶层 `const`/`let`
不提升，文件末尾还有一段立即执行的启动代码，重排会直接坏。

## 模块

| # | 文件 | 行 | 标题 | 主要符号 |
|---:|---|---:|---|---|
| 1 | `000-HTML-头-doctype-meta-字体.html` | 11 | HTML 头 · doctype / meta / 字体 |  |
| 2 | `style/010-基础变量-像素字体-顶部控制栏-时钟-日历骨架.css` | 102 | 基础变量 · 像素字体 · 顶部控制栏 · 时钟 / 日历骨架 | `:root` `*` `.clock-container *:not(.digital-clock)` `body` `.top-controls-container` `.action-btn` `.action-btn:hover` …+1 |
| 3 | `style/011-API-全局配置弹窗.css` | 227 | 🔌 API 全局配置弹窗 | `.game-card.api-global-card` `.api-global-card .game-card-header` `.apig-body` `.apig-grid` `.apig-grid > .ai-field` `[hidden]` `.apig-vertex-box` …+21 |
| 4 | `style/012-ai对话-的-配置来源-开关.css` | 513 | 【ai对话】的「配置来源」开关 | `.ai-cfg-src` `.ai-src-btn` `.ai-src-btn:hover` `.ai-src-btn.ai-src-on` `.ai-cfg-src-hint` `.ai-src-open` `.ai-src-badge` …+59 |
| 5 | `style/013-AI-对话区域.css` | 258 | AI 对话区域 | `.ai-container` `.ai-header` `.ai-title` `.ai-toggle-icon` `.ai-container.ai-collapsed .ai-toggle-icon` `.ai-collapse-wrapper` `.ai-collapse-inner` …+31 |
| 6 | `style/014-SillyTavern-风格-user-宏设置.css` | 113 | SillyTavern 风格 {{user}} 宏设置 | `.ai-adv-divider` `.ai-adv-group` `.ai-adv-group-title` `.ai-switch-mini` `.ai-switch-mini .ai-switch-track` `.ai-switch-mini .ai-switch-thumb` `.ai-macro-body` …+12 |
| 7 | `style/015-系统提示词预设.css` | 49 | 系统提示词预设 | `.ai-preset-row` `.ai-preset-chip` `.ai-preset-chip:hover` `.ai-preset-chip.active` `.ai-preset-desc` |
| 8 | `style/016-酒馆模式-角色卡-世界书.css` | 590 | 酒馆模式 · 角色卡 / 世界书 | `.ai-hidden-file` `.ai-tavern-body` `.ai-tavern-body.ai-tavern-off` `.ai-tavern-actions` `.ai-tavern-status` `.ai-tavern-status.ok` `.ai-tavern-status.err` …+102 |
| 9 | `style/017-消息行-气泡-+-旁边的操作按钮-重试.css` | 469 | 消息行：气泡 + 旁边的操作按钮（重试） | `.ai-msg` `.ai-msg.from-user` `.ai-msg > .ai-bubble` `.ai-msg-tools` `.ai-msg-tools:focus-within` `.ai-msg-btn` `.ai-msg-btn:hover` …+54 |
| 10 | `style/018-复古模式下徽标跟着时钟走-绿字黑底那套-别让它还是白色的-白字压在.css` | 385 | 复古模式下徽标跟着时钟走（绿字黑底那套），别让它还是白色的 —— 白字压在 | `body.retro-mode .clock-day-offset` `body.retro-mode .tz-cell` `body.retro-mode .tz-toggle` `body.retro-mode .clickable-title` `body.retro-mode .clickable-title:hover` `body.retro-mode .cal-btn` `body.retro-mode .weekday-tag` …+70 |
| 11 | `style/019-SillyTavern-角色卡编写器.css` | 466 | SillyTavern 角色卡编写器 | `.st-container` `.st-toggle-icon` `.st-container.ai-collapsed .st-toggle-icon` `.st-title-click` `.st-title-click:hover` `.st-head-sub` `.st-head-sub:empty` …+67 |
| 12 | `style/020-折叠头-整行可点的按钮-箭头-+-原来的-.st-sub-标题-+-右侧一句.css` | 479 | 折叠头 = 整行可点的按钮：箭头 + 原来的 `.st-sub` 标题 + 右侧一句提示。 | `.st-fold-head` `.st-fold-head .st-sub` `.st-fold-ico` `.st-fold:not(.st-fold-open) .st-fold-ico` `.st-fold-hint` `.st-fold-head:hover .st-fold-hint` `.st-mod` …+66 |
| 13 | `style/021-三栏-图层-画布-属性-窄屏会竖过来-见下面的-@media.css` | 454 | 三栏：图层 / 画布 / 属性。窄屏会竖过来（见下面的 @media） | `.st-sb-split` `.st-sb-insp` `.st-sb-layers` `.st-sb-canvas` `.st-sb-slide-tag` `.st-sb-frame-wrap` `.st-sb-frame` …+62 |
| 14 | `style/022-输入框融进标签框里-没边框-没背景-光标就贴在最后一个标签后面.css` | 474 | 输入框融进标签框里：没边框、没背景，光标就贴在最后一个标签后面。 | `.st-field .st-tags-in:focus` `.st-empty` `.st-note` `.st-note.st-warn` `.st-note.st-bad` `.st-note code` `.st-status` …+61 |
| 15 | `style/023-编写器里的-AI-助手.css` | 348 | 编写器里的 AI 助手 | `.st-ai-box` `.st-ai-box > summary` `.st-ai-box > summary::-webkit-details-marker` `.st-ai-box > summary::before` `.st-ai-box[open] > summary::before` `.st-ai-box-body` `.st-ai-chips` …+49 |
| 16 | `style/024-Code-Agent-页.css` | 364 | Code（Agent）页 | `#st-panes.st-code-mode` `#st-panes.st-code-mode > .st-pane` `.st-code` `.st-code-bar` `.st-code-menu` `.st-code-menu > summary` `.st-code-menu > summary::marker` …+55 |
| 17 | `style/025-三种状态只靠颜色-+-图标区分-不换字号-换字号会让清单上下跳动.css` | 335 | 三种状态只靠颜色 + 图标区分，不换字号 —— 换字号会让清单上下跳动 | `.st-code-tasks li.st-tk-doing` `.st-code-tasks li.st-tk-done` `.st-code-foot` `.st-code-foot textarea` `.st-code-foot textarea:focus` `.st-code-skill` `.st-code-skill:last-child` …+50 |
| 18 | `style/026-AI-聊天窗口-放大-模式.css` | 113 | AI 聊天窗口「放大」模式 | `.ai-header-actions` `.ai-max-btn.active` `body.ai-max-on` `body.ai-max-on::before` `body .ai-container.ai-maximized` `body .ai-container.ai-maximized .ai-chat` `body .ai-container.ai-maximized .ai-messages` …+1 |
| 19 | `style/027-手机比例下的入口菜单.css` | 127 | 手机比例下的入口菜单 | `.mobile-nav` `.mobile-nav-btn` `.mobile-nav-btn:hover` `.mobile-nav-panel` `.mobile-nav-inner` `.mobile-nav.open .mobile-nav-panel` `.mobile-nav.open .mobile-nav-inner` …+5 |
| 20 | `style/028-复古模式-按钮-+-下拉菜单照-Win98-Win2000-的菜单来.css` | 132 | 复古模式：按钮 + 下拉菜单照 Win98 / Win2000 的菜单来 | `body.retro-mode .mobile-nav-btn` `body.retro-mode .mobile-nav-btn:hover` `body.retro-mode .mobile-nav-btn:active` `body.retro-mode .mobile-nav-name` `body.retro-mode .mobile-nav-box` `body.retro-mode .mobile-nav-item` `body.retro-mode .mobile-nav-item:hover` …+7 |
| 21 | `100-BODY-页面骨架与静态标记-含-script-开标签.html` | 662 | BODY · 页面骨架与静态标记（含 script 开标签） |  |
| 22 | `js/200-时钟-时区-日历-复古模式.js` | 390 | 时钟 / 时区 / 日历 / 复古模式 | `toggleRetroMode` `clockTimezone` `getClockTimeParts` `getClockDateParts` `getClockDayOffset` `updateClockDayOffset` `updateClock` …+18 |
| 23 | `js/201-街机小游戏-框架-支持选择列表-&-游戏切换.js` | 78 | 街机小游戏 框架 (支持选择列表 & 游戏切换) | `activeGameType` `keysPressed` `touchMoveState` `openCatGame` `closeCatGame` `showGameMenu` `launchGame` |
| 24 | `js/202-复古线框战机-整页游戏-用-iframe-装-挂载-卸载都要管.js` | 179 | 复古线框战机（整页游戏）—— 用 iframe 装，挂载 / 卸载都要管 | `shooterFrame` `stShooterMount` `stShooterFocus` `stShooterUnmount` `stShooterReset` `bindTouchButtonEvents` `drawPixelCat` …+3 |
| 25 | `js/203-游戏-1-Cat-Runner-横版奔跑.js` | 179 | 游戏 1：Cat Runner (横版奔跑) | `runnerState` `initRunnerGame` `handleRunnerAction` `runnerLoop` |
| 26 | `js/204-游戏-2-Cat-Doodle-Jump-涂鸦跳跃.js` | 188 | 游戏 2：Cat Doodle Jump (涂鸦跳跃) | `doodleState` `initDoodleGame` `handleDoodleTouchPress` `handleDoodleAction` `doodleLoop` `resetDoodleWorld` |
| 27 | `js/205-游戏-3-Cat-Parade-猫猫大游行-绝对方向控制-+-十字键.js` | 220 | 游戏 3：Cat Parade (猫猫大游行 - 绝对方向控制 + 十字键) | `paradeState` `GRID_SIZE` `PARADE_CATCH_RADIUS` `initParadeGame` `spawnWildCat` `setParadeDirection` `handleParadeTouchPress` …+2 |
| 28 | `js/206-AI-对话区域.js` | 85 | AI 对话区域 | `AI_PROVIDERS` `AI_PROVIDER_GROUPS` |
| 29 | `js/207-系统提示词预设.js` | 238 | 系统提示词预设 | `AI_PROMPT_PRESETS` `PRESET_CUSTOM` `findPromptPreset` `detectPromptPreset` `AI_DEFAULTS` `aiConfig` `aiConfigHadPresetKey` |
| 30 | `js/208-API-全局配置-apiGlobal.js` | 136 | API 全局配置（apiGlobal） | `API_GLOBAL_KEY` `API_GLOBAL_FIELDS` `API_GLOBAL_DEFAULTS` `apiGlobal` `apiGlobalPick` `apiGlobalNormalize` `apiGlobalLoad` …+5 |
| 31 | `js/209-迁移与载入.js` | 236 | —— 迁移与载入 —— | `customBaseUrlDraft` `chatHistory` `aiBusy` `aiFillProviderSelect` `aiProviderOptionsHtml` `initAiArea` `setAiModelOption` …+6 |
| 32 | `js/210-SillyTavern-风格-user-宏.js` | 192 | SillyTavern 风格 {{user}} 宏 | `escapeHtml` `buildUserAddress` `readUserMacroInputs` `persistUserMacro` `fillUserMacroInputs` `USER_MACRO_LOCK_IDS` `tavernLockUserMacro` …+7 |
| 33 | `js/211-系统提示词预设-面板与切换.js` | 70 | 系统提示词预设 · 面板与切换 | `renderPromptPresets` `syncPromptPresetUI` `selectPromptPreset` `onSystemPromptInput` `persistSystemPrompt` |
| 34 | `js/212-第一段.js` | 44 | —— 「第一段」—— | `firstSegText` `onFirstSegInput` `renderPromptUI` `onPromptToggle` |
| 35 | `js/213-酒馆模式-SillyTavern-角色卡-+-世界书.js` | 27 | 酒馆模式（SillyTavern 角色卡 + 世界书） | `WI_POS` `WI_POS_LABEL` `WI_POS_NAME` `WI_POS_ORDER` `WI_ROLE` `WI_ROLE_LABEL` `WI_SELECTIVE_LOGIC` |
| 36 | `js/214-作者注释-Author-s-Note.js` | 30 | 作者注释（Author's Note） | `AN_POS` `AN_POS_NAME` `AN_DEFAULT_DEPTH` `AN_DEFAULT_ROLE` `AN_DEFAULT_INTERVAL` `AN_LABEL` `PERSONA_POS` …+5 |
| 37 | `js/215-提示词预设-对齐-SillyTavern-的-Chat-Completion.js` | 81 | 提示词预设（对齐 SillyTavern 的 Chat Completion 预设） | `PM_INJECTION` `PM_INJECTION_NAME` `PM_DEFAULT_DEPTH` `PM_DEFAULT_ORDER` `PM_GENERATION_TYPE` `PM_MARKERS` `PM_APP_FILLED` …+3 |
| 38 | `js/216-世界书-SillyTavern-的常量-照抄-名字保持一致好对照源码.js` | 89 | 世界书：SillyTavern 的常量（照抄，名字保持一致好对照源码） | `WI_LOGIC` `WI_DEFAULT_DEPTH` `WI_DEFAULT_ORDER` `WI_DEFAULT_WEIGHT` `WI_MAX_SCAN_DEPTH` `WI_MAX_INJECTION_DEPTH` `WI_KNOWN_DECORATORS` …+10 |
| 39 | `js/217-粗略-token-估算.js` | 62 | 粗略 token 估算 | `estimateTokens` `escapeRe` `parseCharacterCard` |
| 40 | `js/218-世界书解析.js` | 177 | 世界书解析 | `normalizeLoreEntry` `parseWorldBook` `finalizeLoreEntry` |
| 41 | `js/219-PNG-角色卡-读-tEXt-iTXt-zTXt-数据块.js` | 81 | PNG 角色卡：读 tEXt / iTXt / zTXt 数据块 | `bytesToLatin1` `isPngBuffer` `readPngTextChunks` `decodePngCardChunk` |
| 42 | `js/220-角色卡编写器-数据模型.js` | 83 | 角色卡编写器：数据模型 | `ST_SPEC_LIST` `ST_SPEC_LABEL` `ST_SPEC_DESC` `ST_REGEX_PLACEMENT` `ST_REGEX_PLACEMENT_ORDER` `ST_DRAFT_KEY` `ST_AVATAR_KEY` …+8 |
| 43 | `js/221-酒馆助手-JS-Slash-Runner-脚本.js` | 185 | 酒馆助手（JS-Slash-Runner）脚本 | `ST_TH_FOLDER_ICON` `ST_TH_FOLDER_COLOR` `stBlankThScript` `stBlankThFolder` `stBlankThButton` `stBool` `stThDataText` …+9 |
| 44 | `js/222-MVU-Magical-Variable-Update.js` | 100 | MVU（Magical Variable Update） | `ST_MVU_SCRIPT_URL` `ST_MVU_ZOD_URL` `ST_MVU_PLACEHOLDER` `ST_MVU_SCRIPT_NAME` `ST_MVU_ZOD_NAME` `ST_MVU_INITVAR` `ST_MVU_VARLIST` …+12 |
| 45 | `js/223-MVU-状态栏-外观数据模型.js` | 143 | MVU 状态栏 · 外观数据模型 | `ST_SB_MARK` `ST_SB_BLOCKS` `ST_SB_BLOCK_LABEL` `ST_SB_BLOCK_ICON` `ST_SB_BLOCK_HINT` `ST_SB_CONTAINER` `ST_SB_ALIGN` …+4 |
| 46 | `js/224-预制块.js` | 179 | 预制块 | `ST_SB_PREFAB_CATS` `ST_SB_PREFABS` |
| 47 | `js/225-用户自己攒的预制块-localStorage.js` | 429 | —— 用户自己攒的预制块（localStorage）—— | `ST_SB_PF_KEY` `ST_SB_PF_MAX` `ST_SB_PF_ITEM_BYTES` `ST_SB_PF_TOTAL_BYTES` `stSbPfCache` `stSbPfId` `stSbUserPrefabs` …+16 |
| 48 | `js/226-AI-生成预制块.js` | 272 | AI 生成预制块 | `ST_SB_AI_MAX_BLOCKS` `ST_SB_AI_MAX_DEEP` `ST_SB_AI_DESC_MAX` `ST_SB_AI_STRIP_NUM` `ST_SB_AI_STRIP_STR` `stSbAiDescSet` `stSbAiClean` …+8 |
| 49 | `js/227-MVU-状态栏-块模型-取值-class-保留.js` | 463 | MVU 状态栏 · 块模型 / 取值 / class 保留 | `stSbAiRowHtml` `stBlankSbBlock` `stBlankStatusBar` `stSbBlockFromRaw` `stStatusBarFromRaw` `stSbLocate` `stSbCount` …+22 |
| 50 | `js/228-自由摆放-像素级偏移.js` | 34 | 自由摆放（像素级偏移） | `ST_SB_OFF_MAX` `stSbOffNum` `stSbOffCss` `stSbOffLabel` |
| 51 | `js/229-显式尺寸.js` | 459 | 显式尺寸 | `ST_SB_SIZE_MIN` `ST_SB_SIZE_MAX` `stSbSizeNum` `stSbSizeKeys` `stSbSizeRange` `stSbSizeCss` `stSbSizeLabel` …+22 |
| 52 | `js/230-反过来-把卡里那段-HTML-拆回块列表.js` | 326 | 反过来：把卡里那段 HTML 拆回块列表 | `ST_SB_RUNTIME_RULE` `stSbFences` `stSbRuntimeInfo` `stSbStripFence` `stSbStyleMap` `stSbMacroPaths` `stSbPx` …+19 |
| 53 | `js/231-保原样-把-原稿有-生成器不产出-的声明差出来.js` | 438 | 保原样：把「原稿有、生成器不产出」的声明差出来 | `stSbNormCss` `stSbOwnMaps` `stSbExtraOf` `stSbReadOffset` `stSbKeepStyle` `ST_SB_COL_STYLE` `ST_SB_EXTRA_KEYS` …+10 |
| 54 | `js/232-外壳样式拆成两半-主题表达得了的-→-交给主题-表达不了的.js` | 316 | 外壳样式拆成两半：主题表达得了的 → 交给主题；表达不了的 | `ST_SB_SHELL_DEFAULT` `stSbSplitShellStyle` `stSbParseDoc` `stSbNormalizeText` `stSbVisibleText` `stSbSync` `stMvuLocate` …+3 |
| 55 | `js/233-检测-一次扫清-7-类组件在不在.js` | 39 | —— 检测：一次扫清 7 类组件在不在 —— | `stMvuDetect` |
| 56 | `js/234-生成①-脚本内容.js` | 115 | —— 生成①：脚本内容 —— | `stMvuMvuScriptCode` `ST_MVU_SAFE_KEY` `stMvuQuote` `stMvuKey` `stMvuNumLit` `stMvuDefaultLit` `stMvuDefaultText` …+4 |
| 57 | `js/235-生成②-initvar-YAML.js` | 33 | —— 生成②：initvar YAML —— | `stMvuYamlScalar` `stMvuYamlNode` `stMvuInitVarYaml` |
| 58 | `js/236-生成③-变量更新规则-YAML-骨架.js` | 41 | —— 生成③：变量更新规则 YAML（骨架）—— | `stMvuRulesNode` `stMvuRulesYaml` |
| 59 | `js/237-固定模板-照-MVU-Maker-的-shared-templates.ts.js` | 57 | —— 固定模板（照 MVU Maker 的 shared/templates.ts 抄）—— | `stMvuVarListTemplate` `stMvuOutputFormatTemplate` |
| 60 | `js/238-正则五件套-用-String.raw-是因为正则里有-1-s.js` | 121 | —— 正则五件套。用 String.raw 是因为正则里有 \1 \/ \s， | `ST_MVU_RX_HIDE` `ST_MVU_RX_WAIT` `ST_MVU_RX_DONE` `ST_MVU_RX_HTML_WAIT` `ST_MVU_RX_HTML_DONE` `ST_MVU_RX_HTML_SB` `ST_MVU_RX_NAME` …+4 |
| 61 | `js/239-同步-结构是唯一事实来源.js` | 65 | —— 同步：结构是唯一事实来源 —— | `stMvuSync` `stMvuZodParsed` `stMvuAdopt` `stMvuAfterLoad` |
| 62 | `js/240-反推-从卡里已有的-Zod-脚本解析回变量树.js` | 242 | —— 反推：从卡里已有的 Zod 脚本解析回变量树 —— | `ST_MVU_IDENT` `stMvuParseZod` `stMvuPWs` `stMvuPExpect` `stMvuPReadParen` `stMvuPReadString` `stMvuPKey` …+5 |
| 63 | `js/241-一键添加-移除.js` | 338 | 一键添加 / 移除 | `stMvuRemoveScriptDeep` `stMvuInstall` `stMvuRemove` `stBlankCard` `stStr` `stStrList` `stNormalizeDraft` …+1 |
| 64 | `js/242-草稿-→-ST-JSON.js` | 265 | 草稿 → ST JSON | `stEntryContentRaw` `stEntryToBookJson` `stBookToJson` `stRegexToRaw` `stRegexFromRaw` `stExtraExtensions` `stThExtras` …+1 |
| 65 | `js/243-ST-JSON-→-草稿.js` | 94 | ST JSON → 草稿 | `ST_CARD_KEYS` `stLooksLikeCard` `stDraftFromStJson` |
| 66 | `js/244-角色卡编写器-PNG-写入.js` | 209 | 角色卡编写器：PNG 写入 | `ST_CRC_TABLE` `stCrc32` `stPngChunk` `stB64Utf8` `stPngTextChunk` `stInjectCardChunk` `stDataUrlToBytes` …+8 |
| 67 | `js/245-世界书扫描.js` | 615 | 世界书扫描 | `wiParseDecorators` `wiStringHash` `wiParseRegex` `wiScanDepth` `wiSpeakerName` `wiGlobalScanData` `wiChatClock` …+8 |
| 68 | `js/246-作者注释-插入位置与深度.js` | 65 | 作者注释 · 插入位置与深度 | `anInterval` `anShouldInsert` `anDepth` `anRole` `anPosition` `anBlockText` |
| 69 | `js/247-用户人设描述-personaDescription.js` | 42 | 用户人设描述（personaDescription） | `personaRaw` `personaText` `personaPosition` `personaDepth` `personaRole` `personaRidesAn` |
| 70 | `js/248-提示词预设-规范化-读写.js` | 130 | 提示词预设：规范化 / 读写 | `normalizePromptSlot` `presetOrderFromRaw` `normalizePromptPreset` `getActivePreset` `presetList` `presetNewId` `presetDuplicate` …+3 |
| 71 | `js/249-拼装提示词.js` | 361 | 拼装提示词 | `greetingList` `getActiveGreeting` `parseExampleMessages` `entryLabel` `applyDepthEntries` `buildRequestPlan` `presetMarkerText` |
| 72 | `js/250-酒馆模式-UI.js` | 351 | 酒馆模式 UI | `personaMirrorCache` `refreshPersonaMirror` `renderTavernUI` `renderTavernCard` `wiEntryFacts` `loreEntryHtml` `renderTavernLore` |
| 73 | `js/251-提示词预设面板.js` | 165 | 提示词预设面板 | `presetSlotHtml` `renderTavernPreset` `presetRefresh` |
| 74 | `js/252-预设-切换-增删-排序.js` | 137 | —— 预设：切换 / 增删 / 排序 —— | `onPresetSelect` `onPresetNameInput` `presetSaveCopy` `presetDelete` `presetAddSlot` `onPresetSlotToggle` `onPresetSlotMove` …+2 |
| 75 | `js/253-预设-导入.js` | 96 | —— 预设：导入 —— | `onPresetFilePicked` `renderTavernPreview` |
| 76 | `js/254-酒馆模式-导入-编辑.js` | 231 | 酒馆模式：导入 / 编辑 | `onCardFilePicked` `onLoreFilePicked` `enterTavernMode` `onTavernToggle` `refreshGreetingIfFresh` `onTavernGreetingChange` `TAVERN_BOOL_KEYS` …+9 |
| 77 | `js/255-角色卡编写器-UI.js` | 261 | 角色卡编写器：UI | `ST_TABS` `stEditor` `stInit` `stLoadDraft` `stSaveDraft` `stSaveDraftInner` `toggleStArea` |
| 78 | `js/256-页面上的那张小卡片.js` | 58 | 页面上的那张小卡片 | `stRenderNavName` `renderStCard` |
| 79 | `js/257-全屏浮层.js` | 156 | 全屏浮层 | `stIsOpen` `openStEditor` `closeStEditor` `stSyncTabsCollapsed` `stToggleTabs` `stSwitchTab` `stTabBadge` …+3 |
| 80 | `js/258-通用小控件.js` | 137 | 通用小控件 | `stInput` `stTags` `stArea` `stSelect` `stNum` `stCheck` `stCheckIn` …+2 |
| 81 | `js/259-编写器-AI-助手.js` | 278 | 编写器 · AI 助手 | `ST_AI_CFG_KEY` `ST_AI_UI_KEY` `ST_AI_PROVIDERS` `ST_AI_PROTO_LABEL` `ST_AI_DEFAULTS` `ST_AI_REQ_PRESETS` `ST_AI_MOOD_PRESETS` …+15 |
| 82 | `js/260-第一段-与-提示词结构预览.js` | 30 | 「第一段」与「提示词结构预览」 | `stAiFirstSegText` `stAiPlanMessages` |
| 83 | `js/261-提示词结构预览.js` | 159 | 提示词结构预览 | `stAiMsgPreview` `stAiPlanPreview` `stAiSkeletonPreview` `stAiIsLocal` `stAiNeedsKey` `stAiReady` `stAiModeLabel` …+1 |
| 84 | `js/262-消息整形.js` | 26 | —— 消息整形 —— | `stAiSplitSystem` `stAiMergeRoles` |
| 85 | `js/263-Google-原生-gemini-协议.js` | 256 | Google 原生（gemini）协议 | `stAiGeminiModel` `stAiVertexProject` `stAiIsVertex` `stAiGeminiLoc` `stAiGeminiHost` `stAiGeminiPath` `stAiGeminiUrl` …+9 |
| 86 | `js/264-Vertex-完整模式-Service-Account-⇒-access-t.js` | 605 | —— Vertex 完整模式：Service Account ⇒ access token —— | `stAiSaTokens` `stAiSaParse` `stAiB64Url` `stAiB64UrlText` `stAiPemToBuf` `stAiSaSummary` `stAiSaKeys` …+23 |
| 87 | `js/265-面板的界面状态.js` | 131 | —— 面板的界面状态 —— | `stAiUi` `stAiUiSet` `stAiUiSetR` `stAiRepaint` `stAiReqToggle` `stAiSourcePick` `stAiMoodPick` …+5 |
| 88 | `js/266-小控件.js` | 52 | 小控件 | `stAiChips` `stAiChipsMulti` `stAiMoodChips` `stAiReadonly` `stAiMoodText` `stAiStatusHtml` |
| 89 | `js/267-世界书的注入顺序.js` | 48 | 世界书的注入顺序 | `stAiInjectList` `stAiInjectText` |
| 90 | `js/268-扩写-拼提示词.js` | 70 | 扩写：拼提示词 | `stAiExpandPlan` |
| 91 | `js/269-开场白-拼提示词.js` | 44 | 开场白：拼提示词 | `stAiGreetPlan` |
| 92 | `js/270-生成结果预览.js` | 68 | 生成结果预览 | `stAiEntryPreviewHtml` `stAiGreetPreviewHtml` `stAiCopyRaw` |
| 93 | `js/271-AI-配置页.js` | 175 | AI 配置页 | `stPaneAi` `stAiFollowFields` `stAiOwnFields` `stAiModelField` |
| 94 | `js/272-世界书页-AI-扩写面板.js` | 102 | 世界书页：AI 扩写面板 | `stAiExpandPanel` |
| 95 | `js/273-开场白页-AI-生成面板.js` | 105 | 开场白页：AI 生成面板 | `stAiGreetPanel` |
| 96 | `js/274-动作.js` | 176 | 动作 | `stAiSetProvider` `stAiSetProto` `stAiSetBase` `stAiSetKey` `stAiSetModel` `stAiSetFirstSeg` `stAiSetNum` …+10 |
| 97 | `js/275-单条改写-只动世界书里指定的那一条.js` | 440 | 单条改写：只动世界书里指定的那一条 | `ST_AI_REF_SCOPES` `stAiEntryRefScope` `stAiEntryRefRows` `stAiEntryRefText` `stAiEntryBrief` `stAiEntryPlan` `stAiEnReqToggle` …+8 |
| 98 | `js/276-Code-Agent-页.js` | 55 | Code（Agent）页 | `ST_CODE_SESS_KEY` `ST_CODE_UI_KEY` `ST_CODE_SKILL_KEY` `ST_CODE_MAX_MSGS` `ST_CODE_MAX_SESS` `ST_CODE_TOOL_CHARS` `ST_CODE_READ_CHARS` …+7 |
| 99 | `js/277-工具型-skill-kind-tool.js` | 60 | —— 工具型 skill（kind:'tool'）—— | `ST_CODE_SKILL_KINDS` `ST_CODE_MANIFEST_RX` `ST_CODE_TOOLNAME_RX` `ST_CODE_SANDBOX_MS` `ST_CODE_SANDBOX_OUT` `ST_CODE_SANDBOX_PERM` `ST_CODE_PERM_TOOLS` …+2 |
| 100 | `js/278-进度上报-host.progress.js` | 188 | —— 进度上报（host.progress）—— | `ST_CODE_PROG_MS` `ST_CODE_PROG_MAX` `ST_CODE_PROG_CHARS` `ST_CODE_IDB_NAME` `ST_CODE_IDB_STORE` `ST_CODE_IDB_MS` `ST_CODE_SKILL_LS_DIRTY` …+19 |
| 101 | `js/279-skill-的落盘-IndexedDB-带-localStorage-降级.js` | 291 | skill 的落盘：IndexedDB，带 localStorage 降级 | `stCodeSkillBackend` `stCodeSkillWhy` `stCodeIdbOpen` `stCodeIdbOp` `stCodeSkillReadLs` `stCodeSkillAdopt` `stCodeSkillClearLs` …+15 |
| 102 | `js/280-工具表.js` | 353 | —— 工具表 —— | `ST_CODE_TOOLS` `stCodeToolDefs` `ST_GEMINI_SCHEMA_KEYS` `stCodeGeminiSchema` `stCodeToolsFor` |
| 103 | `js/281-内部统一消息格式.js` | 282 | —— 内部统一消息格式 —— | `stCodeMessagesFor` `stCodeRequest` `stCodeParseReply` `stCodeArgs` |
| 104 | `js/282-工具执行.js` | 47 | —— 工具执行 —— | `stCodeJsonText` `stCodeStrList` `stCodeGetPath` `stCodeSetPath` `stCodeFindEntry` |
| 105 | `js/283-遍历酒馆助手脚本-文件夹里的也算-带定位信息.js` | 203 | —— 遍历酒馆助手脚本（文件夹里的也算），带定位信息 —— | `stCodeEachTh` `stCodeThList` `stCodeFindRegex` `stCodeFindTh` `stCodeEntryGuard` `stCodeCutGuard` `stCodeBrief` …+3 |
| 106 | `js/284-Code-页-工具实现-读写-白名单.js` | 632 | Code 页 · 工具实现（读写 / 白名单） | `stCodeOnlyToggle` `stCodeToolRun` |
| 107 | `js/285-这次工具结果该给多少预算-抽成函数是为了只有一个判据.js` | 46 | 这次工具结果该给多少预算。抽成函数是为了只有一个判据 —— | `stCodeToolCap` `stCodeIsReadTool` `stCodeTool` |
| 108 | `js/286-Code-页-system-提示词-网络-停止.js` | 205 | Code 页 · system 提示词 / 网络 / 停止 | `stCodeSystem` `stCodeSysMsgs` `stCodeFetch` `stCodeStop` |
| 109 | `js/287-Agent-循环.js` | 130 | —— Agent 循环 —— | `stCodeSend` |
| 110 | `js/288-网络-fetch_url-工具-+-从链接导入-共用.js` | 197 | —— 网络（fetch_url 工具 + 「从链接导入」共用）—— | `stCodeUrlGuard` `stCodeReadCapped` `stCodeFetchRaw` `stCodeFetchText` `stCodeFetchJson` `stCodeGhParts` `stCodeGhRawUrl` …+2 |
| 111 | `js/289-skill-清单与触发器列举.js` | 60 | skill 清单与触发器列举 | `stCodeTrigList` `stCodeManifestOf` |
| 112 | `js/290-工具型-skill-的沙盒.js` | 463 | 工具型 skill 的沙盒 | `ST_CODE_SANDBOX_BOOT` `stCodeSandboxDoc` `stCodeSandboxN` `stCodePermOfTool` `stCodeSkillPermsOf` `stCodePermToolNames` `stCodeSkillRun` …+10 |
| 113 | `js/291-拖拽导入.js` | 97 | —— 拖拽导入 —— | `stCodeIsFileDrag` `stCodeDragOver` `stCodeDragLeave` `stCodeDragDrop` `stCodeImportDropped` `stCodeEntryFiles` `stFileDropGuardOn` …+1 |
| 114 | `js/292-从链接导入.js` | 60 | —— 从链接导入 —— | `stCodeSkillUrlSet` `stCodeImportUrl` `stCodeSkillDrop` `stCodeSkillClear` |
| 115 | `js/293-会话.js` | 136 | —— 会话 —— | `stCodeOpenSession` `stCodeDropSession` `stCodeViewSet` `stCodeThinkSet` `stCodeAutoApply` `stCodeUseFirstSeg` `stCodeMenuToggle` …+6 |
| 116 | `js/294-面板渲染.js` | 99 | 面板渲染 | `stCodeHighlight` `stCodeJsonHtml` `stCodeMsgHtml` `stCodeEmptyHtml` `stCodeLogHtml` `stCodeWhen` |
| 117 | `js/295-任务清单-set_tasks-工具画的.js` | 26 | —— 任务清单（set_tasks 工具画的）—— | `stCodeTasksRefresh` `stCodeTasksHtml` |
| 118 | `js/296-项目记忆.js` | 390 | —— 项目记忆 —— | `stCodeMemoCount` `stCodeMemoChars` `stCodeMemoLabel` `stCodeMemoCounter` `stCodeMemoSum` `stCodeMemoRefresh` `stCodeMemoSet` …+8 |
| 119 | `js/297-局部刷新.js` | 75 | —— 局部刷新 —— | `stCodePaint` `stCodePaintJson` `stCodeProgressShow` `stCodeProgressClear` `stCodeProgressHtml` `stCodeProgressRefresh` `stCodeRepaint` |
| 120 | `js/298-编写器-首页-home-选项卡.js` | 80 | 编写器 · 首页（home）选项卡 | `stHomeTime` `ST_HOME_BODY_FIELDS` `ST_HOME_MODULES` `stHomeModule` `stHomeFold` `stPaneHome` |
| 121 | `js/299-模块-①-头像-没头像就整块不渲染.js` | 39 | —— 模块 ①：头像。没头像就整块不渲染 —— | `stHomeBodyAvatar` `stHomeBodyOverview` |
| 122 | `js/300-模块-③-快捷动作-跟顶栏那几个按钮是同一批动作-只是收在一处.js` | 292 | —— 模块 ③：快捷动作。跟顶栏那几个按钮是同一批动作，只是收在一处 —— | `stHomeBodyActions` `stHomeBodyExtract` `stExtractAccept` `stExtractToggle` `stExtractSetAll` `stExtractImport` `stExtractClear` …+4 |
| 123 | `js/301-编写器-人设生成器.js` | 186 | 编写器 · 人设生成器 | `ST_PERSONA_TPL_KEY` `ST_PERSONA_REQ_MAX` `ST_PERSONA_TPL_MAX` `ST_PERSONA_OUT_MAX` `ST_PERSONA_LORE_MAX` `ST_PERSONA_TPL_DEFAULT` `stPersonaTpl` …+11 |
| 124 | `js/302-人设生成器-参考素材-世界书.js` | 392 | 人设生成器 · 参考素材（世界书） | `stPersonaPickKey` `stPersonaLoreSources` `stPersonaPickHas` `stPersonaLoreResolve` `stPersonaLoreBlock` `stPersonaPickToggle` `stPersonaPickHintText` …+16 |
| 125 | `js/303-人设生成器-写入-各选项卡.js` | 393 | 人设生成器 · 写入 / 各选项卡 | `stPersonaBookWrite` `stPersonaBookAnswer` `stPersonaCopy` `stPanePersona` `stPaneSys` `stPaneMeta` |
| 126 | `js/304-世界书.js` | 182 | 世界书 | `stPaneBook` `stEntryHtml` `entriesLen` `stCollapseEntries` |
| 127 | `js/305-开场白.js` | 59 | 开场白 | `stPaneGreet` |
| 128 | `js/306-正则.js` | 86 | 正则 | `stPaneRegex` `stRegexHtml` |
| 129 | `js/307-酒馆助手脚本.js` | 225 | 酒馆助手脚本 | `stThCountScripts` `stThDomId` `stThContainer` `stThOwnerPath` `stPaneTh` `stThNodeHtml` `stThScriptHtml` …+3 |
| 130 | `js/308-MVU-变量框架.js` | 402 | MVU 变量框架 | `ST_MVU_PRESETS` `stMvuPresetNode` `stMvuDomId` `stMvuAddNode` `stMvuQuickAdd` `stMvuSelect` `stMvuToggleOpen` …+11 |
| 131 | `js/309-MVU-状态栏-外观-编辑器.js` | 86 | MVU 状态栏（外观）编辑器 | `stSbDragId` `stSbDropAt` `stSbParseBackup` `stSbBlockById` `stSbDomId` `stSbIsBox` `stSbHasBlock` …+3 |
| 132 | `js/310-块操作.js` | 191 | 块操作 | `stSbAddBlock` `stSbSelect` `stSbStageFocus` `stSbDblClick` `stSbToggleOpen` `stSbDelBlock` `stSbMoveBlock` …+5 |
| 133 | `js/311-主题-版式.js` | 26 | 主题 / 版式 | `stSbSetTheme` `stSbApplyTemplate` |
| 134 | `js/312-接管-写回.js` | 221 | 接管 / 写回 | `stSbTakeOver` `stSbOverwrite` `stSbParseFromCard` `stSbRestoreParsed` `stSbWriteBack` |
| 135 | `js/313-画布.js` | 133 | 画布 | `stSbFreeOn` `stSbFreeSet` `stSbCanvasBlockHtml` `stSbCanvasEl` `stSbCanvasHtml` `stSbPaintCanvas` |
| 136 | `js/314-自由摆放-指针拖动.js` | 140 | 自由摆放：指针拖动 | `stSbPtr` `stSbSnapTo` `stSbMeasureEl` `stSbCanvasHitOf` `stSbPtrDown` `stSbPtrMove` `stSbPtrPaint` …+4 |
| 137 | `js/315-调整大小-八向把手.js` | 154 | 调整大小：八向把手 | `stSbRsz` `stSbResizeDown` `stSbResizeMove` `stSbResizePaint` `stSbResizeUp` `stSbResizeCommit` `stSbSizeReset` …+1 |
| 138 | `js/316-自由摆放-键盘微调.js` | 89 | 自由摆放：键盘微调 | `ST_SB_NUDGE` `stSbNudgeKey` `stSbSizeStep` `stSbNudge` `stSbOffReset` `stSbOffResetAll` |
| 139 | `js/317-真机预览.js` | 94 | 真机预览 | `stSbFrameHtml` `stSbPreviewTimer` `stSbSchedulePreview` `stSbPaintPreview` `stSbRuntimeCache` `stSbPaintRuntimeNote` `stSbRuntimeReportHtml` …+1 |
| 140 | `js/318-拖放.js` | 138 | 拖放 | `stSbClearDropHints` `stSbDragStart` `stSbDragEnd` `stSbDragOver` `stSbDragLeave` `stSbDragOverEnd` `stSbDrop` …+3 |
| 141 | `js/319-状态栏编辑器-面板渲染.js` | 377 | 状态栏编辑器 · 面板渲染 | `stPaneSb` `stSbShellExtraField` `stSbShellOff` `stSbShellField` `stSbShellToggle` `stSbClearShellExtra` `stSbStatusHtml` …+7 |
| 142 | `js/320-状态栏编辑器-检查器-预览-清颜色.js` | 351 | 状态栏编辑器 · 检查器 / 预览 / 清颜色 | `stSbClearColor` `stSbDropExtra` `stSbChildRows` `stSbInspectorHtml` `stSbPreviewHtml` |
| 143 | `js/321-导出.js` | 72 | 导出 | `stPaneExport` |
| 144 | `js/322-路径读写.js` | 75 | 路径读写 | `stResolve` `ST_TEXT_LIST` `ST_TEXT_LIST_JOIN` `stSplitList` `stListText` `stSetListText` |
| 145 | `js/323-关键词标签的手感-控件本体在-stTags-里.js` | 455 | 关键词标签的手感（控件本体在 stTags() 里） | `stTagHtml` `stTagsPaint` `stTagsFocus` `stTagsCommit` `stTagsPaste` `stTagsDel` `stTagsKey` …+18 |
| 146 | `js/324-结构操作-条目-开场白-正则.js` | 47 | 结构操作：条目 / 开场白 / 正则 | `stAddEntry` `stDelEntry` `stMoveEntry` `stDupEntry` |
| 147 | `js/325-世界书搜索与筛选.js` | 126 | 世界书搜索与筛选 | `ST_BOOK_FIND_DEF` `stBookFind` `stBookFindActive` `stBookFindMatch` `stBookFindIdx` `stBookFindSet` `stBookFindReset` …+2 |
| 148 | `js/326-世界书多选管理.js` | 387 | 世界书多选管理 | `stBookSelIds` `stBookSelIdx` `stBookSelPut` `stBookSelClear` `stBookSelToggle` `stBookSelAll` `stBookSelInvert` …+17 |
| 149 | `js/327-结构操作-酒馆助手脚本.js` | 152 | 结构操作：酒馆助手脚本 | `stThRevealNode` `stThAddScript` `stThAddFolder` `stThDelNode` `stThMoveNode` `stThDupNode` `stThAddButton` …+6 |
| 150 | `js/328-新建-导入-载入当前卡.js` | 171 | 新建 / 导入 / 载入当前卡 | `stNewCard` `stImportPick` `stExtractPick` `stOnImportPicked` `stLoadFromTavern` |
| 151 | `js/329-头像.js` | 45 | 头像 | `stReadDataUrl` `stPickAvatar` `stOnAvatarPicked` `stClearAvatar` |
| 152 | `js/330-导出-消息-文本-JSON-PNG.js` | 95 | 导出 · 消息 / 文本 / JSON / PNG | `stExportMsg` `stPaintMsg` `stExportNote` `stExportJson` `stExportPng` |
| 153 | `js/331-AI-聊天窗口放大.js` | 59 | AI 聊天窗口放大 | `aiMaxPrevState` `scrollAiMessagesToBottom` `toggleAiMaximize` `isAiMaximized` |
| 154 | `js/332-手机比例下的入口菜单.js` | 59 | 手机比例下的入口菜单 | `MOBILE_NAV_MQ` `mobileNavIsPhone` `setMobileNav` `toggleMobileNav` `closeMobileNav` `mobileOpenAi` `mobileOpenSt` |
| 155 | `js/333-API-全局配置弹窗.js` | 457 | 🔌 API 全局配置弹窗 | `apigBaseDraft` `apigProjectDraft` `apigLocationDraft` `apigSaDraft` `openApiGlobalModal` `closeApiGlobalModal` `apigLoadToUI` …+13 |
| 156 | `js/334-ai对话-的-配置来源-开关.js` | 413 | 【ai对话】的「配置来源」开关 | `setAiCfgSource` `syncAiCfgSourceUI` `refreshStAiCfgViews` `saveAiSettings` `applyAiSettings` `fetchModels` `setBubbleHistory` …+12 |
| 157 | `js/335-内嵌小游戏-ST_SHOOTER_SRC-自动生成-别手改.js` | 2361 | 内嵌小游戏 ST_SHOOTER_SRC（自动生成 · 别手改） | `ST_SHOOTER_SRC` `canvas` `ctx` `container` `SHIP_PRESETS` `selectedShipIdx` `gameState` …+63 |
| 158 | `900-HTML-尾-script-闭标签-body-html.html` | 3 | HTML 尾 · script 闭标签 / body / html |  |
