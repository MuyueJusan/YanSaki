# saki.html 项目文档

> 个人主页「YanSaki的小屋」——单文件 HTML 应用，无构建步骤，直接双击打开即可运行。
>
> - 入口文件：`G:\saki\saki.html`
> - 相对资源：`fonts/fusion-pixel-12px-proportional-ja.ttf`
> - 规模：约 **28 741 行**，约 **1 433 KB**（单文件，HTML + CSS + JS 全内联）

---

## 目录

| 文档 | 内容 |
|---|---|
| [README.md](README.md) | 本文件：总览、文件结构、启动流程、持久化、验证体系 |
| [01-clock-calendar.md](01-clock-calendar.md) | 时钟（含时区、复古模式）与交互式日历 |
| [02-ai-chat.md](02-ai-chat.md) | AI 对话：供应商、预设、`{{user}}` 宏、流式、重试 |
| [03-tavern.md](03-tavern.md) | 酒馆模式：角色卡、世界书、作者注释、用户人设、提示词预设 |
| [04-card-editor.md](04-card-editor.md) | SillyTavern 角色卡编写器（全屏浮层，15 个选项卡） |
| [05-games.md](05-games.md) | 小游戏：Cat Runner / Doodle Jump / Cat Parade |
| [06-fonts-theme.md](06-fonts-theme.md) | 字体（本地像素字体）与复古皮肤 |
| [CHANGELOG.md](CHANGELOG.md) | 更新与修复记录 |

---

## 1. 文件结构

```
G:\saki\
├── saki.html                 ← **唯一要改的文件**（全部代码内联）
│                               ⚠ 真品判据：**1 493 542 字节 / 29 213 行**（`sha1 d0bf0d34afef…`）。
│                                 旁边那几份「副本」字节数都很接近，别靠文件名认。
│                                 ⚠ **这个数会漂** —— 本行换过好几轮
│                                    （`1 467 029 / 65df7b0b` → `1 487 774 / ecb46ca8de99` → 现在这份），
│                                    每一版写进来的时候都是真的。那个 1 467 029 字节的版本
│                                    现在是**远端上一版 `index.html`**。
│                                    判据永远现量：`sha1sum saki.html`
├── index.html                ← **发布副本**，内容与 `saki.html` **逐字节相同**（在 git 里是同一个 blob）。
│                               ⚠ 站点发的是**它**（GitHub Pages 只认 `index.html`）⇒
│                                 **改完 `saki.html` 要顺手 `cp saki.html index.html`**，否则线上还是旧的。
│                                 ⚠ **别把它当独立文件改** —— 两边一分叉就没人知道哪份是对的。
├── .gitattributes            ← `* -text`：**绝不**做行尾转换（本项目混行尾，理由见本节末尾「仓库与发布」）
├── .gitignore                ← 排除 `.workbuddy-ai/`（记忆 / 凭据）与 `_verify/shots/`（每次重生成的截图）
├── saki - 副本.html           ┐
├── saki - 副本 (2).html       │
├── saki - 副本 (3).html       ├ ⚠⚠ **六份历史副本，没有一份是当前版**（sha1 互不相同）。
├── saki - 副本 (4).html       │
├── saki - 副本 (5).html       │
├── saki - 副本 (6).html       ┘   `(6)` 最像：**2026-09-21 实测**它跟「小游戏那一轮
│                                  **之前**的真品」**逐字节相同**（`sha1 c9189f3f…`）——
│                                  也就是说它是个**干净的回滚点**，但**不是**当前版。
│                                  ⚠ **别把 `(5)` 当最近的那个** —— 它现在只排第 2
│                                     （少 3 446 行 / 169 306 字节）。名字里的序号跟「离真品多近」
│                                     **没有任何关系** —— 只能按 `sha1sum` 认。
│                                  ⚠ 这些差值**每改一次真品就变大一点**，别当常数记；
│                                     判据永远是 `sha1sum`，不是「差不多大」。
├── saki.zip                  ← 2026-09-18 20:00 的打包留档（1 928 087 字节）
├── _audit-2026-09-20.md      ← 审查报告（**留着**，不是残留）
│                               ⚠ 原来的 `_disk.txt` / `_disk2.txt` / `_disk3.txt`（09-20 03:42~03:47
│                                 的一次性磁盘快照）**已于第十七轮删除** ——
│                                 `_disk3.txt` 是「tmpdir 里 12 个前缀」的唯一出处，
│                                 内容已并进本文 §7，删前先并档、不是直接丢。
├── _verify\                  ← 验证 harness（16 套 + 探针，见 §7）
├── fonts\
│   └── fusion-pixel-12px-proportional-ja.ttf
├── markdown\                 ← 本目录
├── fusion-pixel-font-12px-proportional-ttf-v2026.09.01\   ← 字体解压目录
│   ├── fusion-pixel-12px-proportional-ja.ttf
│   ├── fusion-pixel-12px-proportional-zh_hans.ttf         ← 简体变体（未使用，见 06）
│   ├── fusion-pixel-12px-proportional-zh_hant.ttf
│   ├── fusion-pixel-12px-proportional-ko.ttf
│   └── fusion-pixel-12px-proportional-latin.ttf
├── fusion-pixel-font-10px-monospaced-ttf-v2026.09.01\     ← 另一套（未使用）
├── fusion-pixel-font-*-v2026.09.01.zip                    ← 上面两套的原始压缩包
│                                                              （19.6 MB + 35.0 MB；
│                                                              解压目录都在，压缩包只是留档）
└── *.zip
```

⚠ **`saki - 副本*.html` 这一族是这份项目里最像「正确文件」的陷阱。**
项目铁律说「**留两份就一定有一份是错的**」—— 这里留了**六份**。它们**不是**任何脚本的目标
（`_verify/` 里 `PAGE` / `PAGE_FILE` / `ROOT` 全部指向 `G:/saki/saki.html`，已核过），
但人眼会认错。**删之前先备份，且要人点头。**

### 本目录里有两类文件：**文档** 和 **镜像**

上面 `01…06` / `README` / `CHANGELOG` 是文档，直接改。另外五份**不是文档，是镜像** ——
源头在别处，**改这里没有任何效果**（应用不读它们），只会让你以为记忆已经更新了：

| 本目录 | 源头 | 是什么 |
|---|---|---|
| `MEMORY.md` | `.workbuddy-ai/memory/MEMORY.md` | 项目长期笔记。**每次会话自动整份注入**，所以必须短。⚠ **别在文档里写死任何「上限」数字，连「目标大小」也别写**：流传的 `≈16.7 KB` / `15.5 KB 完整` / `18.4 KB 必截` 三个数**来自不同快照、彼此矛盾**（见当日日志「第十五轮」），而且**注入的快照会滞后于磁盘** ⇒ **用「磁盘上多少字节」反推会不会被截是错的**。⚠ 连**本文件自己**曾经写的「目标 ~11 KB」也**已经漂了**（写完两轮内就改了两次、还超了）⇒ **这里不写数**，只守行为：**每轮写完量字节数，涨了就删旧条**（删之前先确认那条没在 `RULES.md` 里重复）。⚠ **加新条前先删旧的**，别只往上堆 |
| `RULES.md` | `.workbuddy-ai/memory/RULES.md` | 同一份笔记的**展开版**（完整来龙去脉 + 函数名），按需读 |
| `YYYY-MM-DD.md` | `.workbuddy-ai/memory/YYYY-MM-DD.md` | 分段工作日志，**只追加** |
| `SKILL.md` | `~/.workbuddy-ai/skills/verify-single-file-html-app/SKILL.md` | 「怎么验证单文件 HTML 应用」的技能原文 |
| `SKILL-git-push.md` | `~/.workbuddy-ai/skills/git-push-existing-github-repo/SKILL.md` | 「把本地文件夹推进一个**已有**仓库」的技能原文（远端可能是在跑的线上站点、用 `reset --soft FETCH_HEAD` 代替 `--force`、转私有会让 Pages 变 404 等） |

放一份在这里是为了**跟着项目走**（`.workbuddy-ai/` 不一定跟仓库一起备份）。
代价是**会漂** —— 改完记忆或技能之后顺手同步一遍，**方向永远是「从源头拷过来」**：

```bash
cd /g/saki
for f in .workbuddy-ai/memory/*.md; do cp "$f" "markdown/$(basename "$f")"; done
cp "C:/Users/YanSaki/.workbuddy-ai/skills/verify-single-file-html-app/SKILL.md" markdown/SKILL.md
cp "C:/Users/YanSaki/.workbuddy-ai/skills/git-push-existing-github-repo/SKILL.md" markdown/SKILL-git-push.md
```

### 反向：在**新设备**上把技能与记忆装回去（`setup-dev.sh`）

`.workbuddy-ai/` 不进仓库，所以换一台机器 clone 下来之后，**技能和记忆都还没装** ——
而且镜像的**文件名 / 路径跟运行时对不上**（`SKILL-git-push.md` → `git-push-existing-github-repo/SKILL.md`），
手动 `cp` 很容易装错地方或者**装反方向**。仓库根的 `setup-dev.sh` 就干这件事：

```bash
bash setup-dev.sh              # 只看计划（默认，什么都不改）
bash setup-dev.sh --go         # 真装：只补本地没有的，已存在的一律不动
bash setup-dev.sh --go --force # 连已存在的也覆盖（在别的设备上改过、要拉回来时用）
```

⚠ **默认不覆盖是故意的** —— 记忆的真相源是**本地**（`markdown/` 才是副本），
在**写这份记忆的那台机器**上跑，覆盖等于把新内容冲掉。
⚠ 脚本**绝不碰** `.workbuddy-ai/git/credentials`；新设备第一次推送要自己配一次凭据
（见 `SKILL-git-push.md` 第 3 节 —— 凭据文件要放在被 gitignore 掉的目录里）。

### 仓库与发布（2026-09-23 接入）

`G:\saki`（工作副本）→ **push** → `github.com/MuyueJusan/YanSaki`（公开仓库，`main`）→ **GitHub Pages** → `https://yansaki.top/`

| 项 | 值 |
|---|---|
| 远端 | `https://github.com/MuyueJusan/YanSaki` —— **必须公开**，免费版 Pages 不支持私有仓库 |
| 部署 | `build_type = workflow` ⇒ 靠 **`.github/workflows/static.yml`** 把整个仓库根目录发出去 |
| 域名 | 仓库根的 `CNAME` = `yansaki.top`；`https_enforced = true` |
| 发布文件 | **`index.html`**（= `saki.html` 的逐字节副本，在 git 里是同一个 blob） |

⚠⚠ **`CNAME` 和 `static.yml` 都不能删** —— 删了域名断、站点不再更新。
⚠ 另外两条 workflow（`hugo.yml` / `jekyll-gh-pages.yml`）是 GitHub 建 Pages 时自动塞进来的**废件**：
`hugo.yml` **0 成 9 败**、`jekyll-gh-pages.yml` 3 成 5 败，每次 push 都跑、都红。
⚠⚠ **它们不是「纯噪声」—— 会真的把部署掐掉。** 三条 workflow **全部**
`on: push: branches:["main"]`、**全部** `concurrency: { group: "pages", cancel-in-progress: false }`；
而 GitHub 的语义是**新进入同一组的 run 会取消「已在排队（pending）」的那个**
（`cancel-in-progress: false` 只保证不打断**正在跑**的）⇒ 一次 push 同时触发三条 ⇒ **互相取消**，
谁恰好在 pending 谁死（实测两次：`68e9d84` / `4002051`，run 从 created 到 updated 只差 **1 秒**）。
**症状是「推送成功、线上没变」**，很容易误判成 CDN 缓存。
**判据**：被取消的 run `GET /actions/runs/<id>/jobs` 返回 **`total_count: 0`**
（一条 job 都没调度 ⇒ **不是**构建失败），且 `GET /deployments` 里最新那条**还停在更早的 sha**
（排队阶段被取消**根本不会创建 deployment**）。
**解锁**：`POST /actions/workflows/static.yml/dispatches {"ref":"main"}` ——
`workflow_dispatch` 只触发被点的那一条，独占并发组（实测 21 秒、7 个 step 全绿）。
**已处理（2026-09-23）**：两条都**停用**了（`disabled_manually`，用户选的是「停用」而不是「删」）——
不再被 push 触发 ⇒ 并发组不再被抢，而且**历史 run 记录保留着**（hugo.yml 0 成 9 败那些还在）。
想恢复任意一条：`PUT /actions/workflows/<文件名>/enable`。
诊断工具 `_verify/deploy-check.js`（只读）；细节见 `SKILL-git-push.md` §9 与 `RULES.md` 六之二十。

> ⚠⚠ **`git push` 绿 + 远端 blob 一致，只证明「仓库对了」，不证明「站点对了」。**
> 唯一的判据是**线上那个文件的字节算 sha1，跟本地比**：
> `node _verify/deploy-check.js`（线上 `index.html` vs 本地，逐字节；`--runs` 顺带查 Actions / deployment）。
> ⚠ 别用 HEAD 请求比字节数 —— HEAD 的 `content-length` 是压缩后的，要 GET。

**行尾**：`.gitattributes` 写死 `* -text`，**外加**本地 `core.autocrlf=false`，两道都要。
本仓库**混行尾**（`saki.html` / `index.html` 纯 CRLF；`markdown/` / `_verify/` 纯 LF），
而系统级 `core.autocrlf=true` 会把纯 LF 那批检出成 CRLF ⇒ 镜像 `cmp`、`sha1`、字节计数**全崩，
而且症状离现场很远**。判据是 `git ls-files --eol`（该跟磁盘一致），**不是**「我设过 `core.autocrlf=false`」。

**改完怎么发**：`cp saki.html index.html`（⚠ **别忘**，否则线上还是旧的）→ `git add -A` →
`git commit` → `git push`。凭据存在 `.workbuddy-ai/git/credentials`（**已 gitignore，永不入库**）。

⚠ **转私有是一次实测过的坑**：`PATCH {"private":false}` 改回来**不够** —— Pages 配置是被**删掉**的，
得 `POST /pages {build_type:"workflow"}` 重建 + `PUT /pages {cname}` 补域名 + 手动 dispatch 一次
`static.yml`，否则 `yansaki.top` 一直 404。细节见技能 `git-push-existing-github-repo`。

`saki.html` 内部结构（按行号）：

```
1     ~ 5180   <head> + <style>     全部 CSS（约 5 180 行，含 5180 的 </head>）
5181  ~ 5649   <body> 标记          手机菜单 / 时钟 / 日历 / AI 对话 / 编写器 / 浮层 / 游戏弹窗（469 行）
5650  ~ 28738  <script>              全部 JS（约 23 089 行）
28739 ~ 28741  </script> </body> </html>
```

规模：约 **28 741 行**，约 **1 433 KB**（单文件，HTML + CSS + JS 全内联）。

> ⚠ **这几个数字会漂。** 要重新取就一条命令，别凭印象写：
> ```bash
> cd /g/saki && wc -l saki.html && grep -n "^ *</head>\|^<body>\|^ *<script>\|^ *</script>\|^ *</body>\|^ *</html>" saki.html
> ```
>
> ⚠⚠ **从第二十四轮起，上面这条命令会多吐出 4 行 —— 它们在内联的游戏源码里面。**
> 第二十四轮把整份 `retro_vector_space_shooter` 内联成了 `ST_SHOOTER_SRC` 常量
> （一个跨 **2 354 行**的模板字面量，`26384 ~ 28737`，见 §7 的 `_mk-shooter-embed.js`），
> 那里面**自己也有** `</head>` / `<script>` / `</body>` / `</html>`。
> 实测现在匹配到 **10 行**，只有 6 行是真的：
>
> | 真（外层文档） | 假（游戏源码里的字符串） |
> |---|---|
> | `5180 </head>` · `5181 <body>` · `5650 <script>` · `28739 </script>` · `28740 </body>` · `28741 </html>` | `26508 </head>` · `26712 <script>` · `28736 </body>` · `28737 </html>\`;` |
>
> 判据：**真的那 6 行行尾没有反引号 / 分号**（`28737` 那行结尾是 `` </html>`; `` —— 那是常量的收尾）。
> 挑错了会**静默**得到一组错的区间（看起来完全正常）。
>
> ⚠ **`wc -l` 只会报 28 740** —— 末行 `</html>` 后面**没有换行**，所以它少算一行。
> 两个数都对（文件里确实有第 28 741 行），**别拿一个去「修」另一个**。
> ⚠ 上面那条命令里 `</head>` / `<script>` 这些**必须带 `^ *`** —— 它们在文件里是**缩进**的，
> 写成 `^</head>` 一条都匹配不到，而命令本身不会报错，只会**安静地少给你几行**。

⚠ **下面两张表里的行号都会漂** —— 往 CSS 里插一段，它后面所有区块的锚点整体后移。
别把行号当坐标用，只当「大概在哪个区间」；真要跳转就 `grep` 注释横幅的原文
（`grep -n "/\* .*<关键词>" saki.html`）。本文件的行号在每次大改之后都需要重新对齐。

---

## 2. body 顶层区块

| 行号 | 区块 | id / 类 |
|---|---|---|
| 5251 | **手机比例下的入口菜单**（窄屏 / 极扁窗口才出现） | `#mobile-nav` `.mobile-nav` |
| 5270 | 时钟卡片 | `#clock-tz-card` `.clock-container` |
| 5289 | 交互式日历卡片（默认折叠） | `#calendar-card` `.calendar-container.collapsed` |
| 5315 | AI 对话区域 | `#ai-card` `.ai-container` |
| 5560 | SillyTavern 角色卡编写器（折叠入口卡片） | `#st-card` `.st-container` |
| 5600 → 5601 | 编写器全屏浮层 | `#st-overlay` → `#st-shell` |
| 5625 | 小游戏入口按钮 | `.game-entry-btn` |
| 5630 | 贴贴按钮（外链） | `.hug-button` |
| 5635 | 小游戏 Modal | `#gameModal` |

> 小游戏弹窗**里面**的三个新锚点（第二十四轮加的，不在上表里 —— 上表只收 body 顶层）：
> `#gameCard` **5636** · `#gameShooterWrap` **5699** · `#gameShooterFrameHost` **5700**。

> ⚠ **这 9 个锚点是靠 `id="…"` 定位的，不靠注释横幅** —— 所以可以直接核对：
> `grep -n 'id="mobile-nav"\|id="clock-tz-card"\|id="calendar-card"\|id="ai-card"\|id="st-card"\|id="st-overlay"\|id="st-shell"\|id="gameModal"' saki.html`。
> ⚠ **它们**会**随每次往 `<head>` 里插 CSS 整体后移** —— 2026-09-20 第十八 / 十九轮
> 各往 CSS 里加了 ~20 行，第二十轮（手机菜单）加了 91 行，第二十一轮（手机菜单的复古适配
> + 卡名标注）又加了 ~110 行，第二十二轮（卡名挪进面板）净减 3 行，**第二十三轮（预制块）
> 加了 54 行**，**第二十四轮（小游戏内联 + 战机弹窗）加了 27 行** ⇒ 整张表还得重取一次。
> **别信记忆里的数字，现 `grep`。**
> ⚠ **第二十三轮实测：同一张 §3 表里出现了两种位移** —— 预制块的 CSS 分两处插（功能样式 +
> 复古覆盖），于是 `3614 / 3812` 是 **+43**、`4160` 往下是 **+54**。**按加法推必错。**
> 这一轮是靠 `_audit-anchors.js` 一次性把 17 行全指出来的（§2 九行 + §3 八行）。
> ⚠⚠ **第二十四轮实测：`_audit-anchors.js` 的软提示这次没响，`1890 复古模式覆盖` 是假绿。**
> 新增的 CSS 横幅就落在 1890（原文案里也有「复古」两个字）⇒ 硬判据「那一行是横幅 ✅」
> 照样通过、软提示「共享字 ≥ 2」也被 `复古` 两个字满足了。**真相是整段 §3 尾部
> 集体 +27**（`1917 / 2219 / 2382 / 2471 / 2581 / 2648 / 2840 / 2917 / 3121 / 3641 /
> 3839 / 4187 / 4771 / 4873 / 4890 / 4902 / 4958 / 4986 / 5113`）。
> ⇒ **审计工具报 ✅ 不等于对**，它只保证「那一行是个横幅」。名字跟正文对不上时还是得人看。
>
> ⚠⚠ **同一轮还踩了一次「抄了旧读数」**：文档里引用的 `check.js` 计数
> （`declared` 1019 → 987 / `886 → 859`）是**抽出 `stShooterFocus` 之前**量的 ——
> 那个函数在**内联源码之外**，所以 `function name(` 与 `declared` 两边各 **+1**。
> 现在真值是 **887 → 860 / declared 1020 → 988 / used 150 → 146**，
> 而且**闸门自己就会把这行打出来**（不用另写探针）：
>
> ```
> 内联游戏源码: 切掉 108651 字节；顶层 `function name(` 887 → 860；declared 1020 → 988；used 150 → 146
> ```
>
> ⇒ **工具的输出也是「当时的读数」，重构一次就作废。** 核文档数字要**重新跑一遍工具**，
> 不能抄上一次的输出 —— 这跟「行号会漂」是同一类病。
>
> ⚠⚠ **第十二轮（人设生成器折叠）实测：§2 整表 +58，§3 里是两种位移（+55 / +58）。**
> 折叠块的 CSS 插在 2810 附近、retro 补丁插在 3721 附近 ⇒ `2840…3641` 那几行 **+55**，
> `3839` 之后 **+58**。⚠ 同一轮还发现 §3 那串「多行大横幅」里的 `2355` **本来就是错的**
> （真值 2382）—— **这张表不是「算一次就永远对」，而且错的数会被反复抄下去**。
> ⇒ 改完产品**先跑 `_verify/_audit-anchors.js`**（只读），它一次把 §2 九行 + §3 八行全指出来；
> 拿它的输出**现 `grep`** 取真值，**别按加法推**。

---

## 3. CSS 分区

CSS 按功能分块，注释横幅可作导航锚点：

| 行号 | 区块 |
|---|---|
| 41 | 全局像素字体设置（`*` 基座） |
| 79 | 顶部控制栏 |
| 109 | 小游戏入口按钮 |
| 122 | 顶部标题 |
| 131 | 毛玻璃卡片基类 `.glass-card` |
| 144 | 时钟容器 |
| 162 / 209 | 时区切换开关 / 时区按钮网格 |
| 274 | 数字时钟 |
| 289 | 日历容器 |
| 526 | **AI 对话区域** |
| 673 | 模型设置子面板 |
| 749 | 流式 / 非流式开关 |
| 784 | **SillyTavern 风格 `{{user}}` 宏设置** |
| 897 | 系统提示词预设 |
| 946 | **酒馆模式 · 角色卡 / 世界书** |
| 1000 | 可折叠字段 |
| 1151 / 1153 | 来源细类配色（这条系统消息从哪来）/「第一段」单独配色 |
| 1194 | 世界书全局设置 |
| 1254 | 条目本轮会不会插入 |
| 1278 | 提示词预设：槽位列表 + 排序 / 编辑 |
| 1466 | 温度滑块 |
| 1482 | 聊天界面 |
| 1536 | 消息行：气泡 + 重试按钮 |
| 1632 | 贴贴按钮 |
| 1664 | Modal 弹窗 |
| 1747 / 1796 / 1814 / 1824 | 游戏列表 / Canvas / 触屏按键 / 十字键 |
| 1890 | **复古线框战机**（整页游戏：卡片放宽档 `.game-card--wide` + iframe 容器） |
| 1917 | **复古模式覆盖** |
| 2219 | 酒馆模式 · 复古皮肤 |
| 2382 | **SillyTavern 角色卡编写器**（多行大横幅） |
| 2471 / 2581 / 2648 | 全屏浮层 / 左侧选项卡 / 右侧内容 |
| 2895 | 条目 / 脚本卡片 |
| 2972 | MVU 变量框架 |
| 3176 | MVU 状态栏外观编辑器 |
| 3696 | 浮层复古皮肤 |
| 3897 | 编写器里的 AI 助手 |
| 4245 | **Code（Agent）页**（多行大横幅） |
| 4829 | Code 页 · 复古皮肤 |
| 4931 | **AI 聊天窗口「放大」模式**（多行大横幅） |
| 4948 / 4960 / 5016 | 遮罩 / 撑满高度 / 桌面居中 |
| 5044 | **手机比例下的入口菜单**（多行大横幅） |
| 5171 | **复古模式：手机菜单照 Win98 / Win2000**（多行大横幅） |

> 多行大横幅有好几处（2382 / 4245 / 4931 / 5044 / 5171）—— 它们是**多行**写法
> （`/* ====` 换行再写标题），单行横幅的提取脚本扫不到标题那一行，
> 所以 `_audit-anchors.js` 会取**整块**再找名字。
> 找它们要 `grep -n "SillyTavern 角色卡编写器\|Code（Agent）页\|手机比例下的入口菜单\|照 Win98"`。
>
> ⚠ **2355 之前的行号 2026-09-20 实测全部准确**；**之后的整段会随插入而漂**。
> ⚠ **别靠加法算** —— 插入点分散时每段的偏移量都不同。**2026-09-23 实测同一张表里两种位移**：
> `2840…3641` 那几行 **+55**（人设生成器折叠块的 CSS），`3839` 之后 **+58**
> （再多 3 行 = 复古皮肤下折叠头的补丁）。⚠ 上面这串多行横幅里的 `2355` 曾经也是错的
> （真值是 2382）—— **这张表从来不是「算一次就永远对」**。
> **一律重新 `grep`**，或者直接跑 `_verify/_audit-anchors.js`（只读，会指出哪几行对不上）。

---

## 4. 启动流程

`<script>` 末尾（约 25 292 行）：

```js
bindTouchButtonEvents();     // 小游戏触屏按键
renderTimezoneButtons();     // 时区按钮网格
updateClock();               // 立即画一次时钟
renderCalendar();            // 画日历
initAiArea();                // AI 配置回填 + 宏 + 预设 + 酒馆 UI
stInit();                    // 编写器：读草稿 + 首次渲染
setInterval(updateClock, 1000);
```

`initAiArea()` 会依次：

1. 填充供应商下拉框 → `syncAiProviderUI()`
2. 回填 API Key / 流式开关 / 温度 / 最大 Token / 系统提示词
3. **预设认领** —— 老配置没存过 `promptPreset` 时，按内容（`aliases`）把预设认回来，
   并顺手把老版默认提示词升级成带性格描述的完整版
4. `renderPromptPresets()` → `syncPromptPresetUI()` → `renderPromptUI()` → `renderTavernUI()`
5. `fillUserMacroInputs()` → `syncUserMacroUI()`（里面按酒馆模式决定锁不锁「用户人设」）
6. `setAiModelOption(aiConfig.model)`

> 注意：**配置的读取与清洗不在 `initAiArea()` 里**，而是在脚本求值阶段
> （`let aiConfig = { ...AI_DEFAULTS }` 之后紧跟的那几个 IIFE）。所以任何函数运行时
> 看到的 `aiConfig` 都已经是清洗过的。

---

## 5. 持久化

**`localStorage` 共 11 个键**（下表的 10 个 + 末行那个降级标记）：

> ⚠ **skill 正文不在 `localStorage` 里。** 它住在 **IndexedDB**（库 `saki-code`、表 `kv`），
> 只有「IDB 用不了」时才退回 `localStorage`，并顺手打上 `stCodeSkillsLsDirty` 脏标记。
> 见 §6 `stCode` 那一节。

| 键 | 内容 | 写入点 |
|---|---|---|
| `aiChatConfig` | 整个 `aiConfig` 对象（供应商 / 密钥 / 提示词 / 酒馆设置 / 宏设置 / 第一段） | `persistUserMacro()`、`persistSystemPrompt()`、`persistTavern()`、`onTavernSetting()` 等 |
| `clockTimezone` | 选中的时区 | `setClockTimezone()` |
| `stCardDraft` | 编写器草稿（含 `card`、`rawTh`、当前页、折叠态） | `stSaveDraft()` |
| `stCardAvatar` | 编写器头像 data URL（超过 900 KB 不存） | `stSaveDraftInner()` |
| `stAiCfg` | 编写器 AI 助手的**独立**配置（供应商 / 密钥 / 模型 / 温度 / 第一段） | `stAiSave()` |
| `stAiUiCfg` | 编写器 AI 面板的参数（要求 / 氛围 / 条数…，**不含密钥**） | `stAiSaveUi()` |
| `stCodeUi` | Code 页的界面状态（当前会话 id / 思维强度 / 分栏 / 手机端显示哪一栏 / 折叠菜单） | `stCodeSaveUi()` |
| `stCodeSessions` | **Code 页的会话历史**（含消息、工具调用记录、**任务清单 `tasks`**、**自动加载过的 skill 名单 `autoSkills`**；最多留 40 个会话） | `stCodeSaveSessions()` |
| `stCodeSkills` | 导入过的 skill（名字 / 描述 / 正文 / **触发词 `triggers`**）。⚠ **只在降级路里用** —— 主存是 IndexedDB（`saki-code` / `kv`），IDB 写成功后 `stCodeSkillClearLs()` 会把这个键**删掉** | `stCodeSaveSkills()` → `stCodeSkillWrite()` → `stCodeSkillWriteLs()` |
| `stCodeSkillsLsDirty` | 上面那条降级路的**脏标记**（`'1'`）。⚠ 不打的话 IDB 恢复后会读到旧的那份 | `stCodeSkillWriteLs()`（`stCodeSkillClearLs()` 清） |
| `stCodeMemo` | **Code 页的项目记忆**（用户长期要求，一行一条，上限 4000 字） | `stCodeSaveMemo()` |

**注意**：`localStorage` 里存着 API Key 与**完整的会话历史**（含角色卡正文片段）。
这是本地单机应用，不上传，但共用电脑时要留意 —— 尤其 `stCodeSessions` 会越攒越大。

---

## 6. 核心数据模型

### `aiConfig`（`AI_DEFAULTS`，6720 行；`let aiConfig` 在 6795 行）

分五组：

| 组 | 字段 |
|---|---|
| 连接 | `provider` / `baseUrl` / `apiKey` / `model` / `stream` / `temperature` / `maxTokens` |
| 提示词 | `systemPrompt` / `promptPreset` / `customPrompt` / `promptEnabled` / **`firstSeg`**（「第一段」，永远排在发给模型的最前面，空着就不发） |
| 酒馆 | `tavernEnabled` / `tavernCard` / `tavernLore` / `tavernGreetingIndex` / `tavernScanDepth` / `tavernRecursive` / `tavernIncludeNames` / `tavernCaseSensitive` / `tavernMatchWholeWords` / `tavernGroupScoring` / `tavernMinActivations` / `tavernMinActivationsDepthMax` / `tavernMaxRecursionSteps` |
| 作者注释 / 人设 / 预设 | `tavernAnText` / `tavernAnPosition` / `tavernAnDepth` / `tavernAnRole` / `tavernAnInterval`、`tavernPersonaPosition` / `tavernPersonaDepth` / `tavernPersonaRole`、`tavernPresetId` / `tavernPresets` / `tavernTimed` |
| 宏 | `userMacroEnabled` / `userName` / `charName` / `addressStyle` / `addressAffix` / `addressTemplate` / `addressInject` |

### `stAi` / `stAiUi`（编写器 AI 助手，`stAi` 在 14769 行、`stAiUi` 在 15387 行）

| 对象 | 字段 |
|---|---|
| `stAi`（存 `stAiCfg`） | `mode`（`follow` / `own`）/ `provider` / `proto`（`''` = 跟着服务商）/ `baseUrl` / `apiKey` / `model` / `models` / `temperature` / `maxTokens` / `stream` / `firstSeg`（只在 `own` 下生效，`follow` 时现读 `aiConfig.firstSeg`） |
| `stAiUi`（存 `stAiUiCfg`） | 扩写：`exOpen` / `exReq` / `exReqFree` / `exSource` / `exFree` / `exKeepBook` / `exCount` / `exMood` / `exMoodFree` / `exFormat` / `exDepth`；开场白：`grOpen` / `grCount` / `grMood` / `grMoodFree` / `grLen` / `grExtra` / `grIncOff` / `grTarget` / `grShowInject`；运行时态（**不持久化**）：`exRunning` / `exErr` / `exMsg` / `exRaw` / `exPreview` + `gr*` 同名一套 |

`stAiCfg()` 是**唯一**的取配置入口 —— `mode === 'follow'` 时现读 `aiConfig`，
`own` 时读 `stAi`，返回值统一带上解析好的 `proto` 与 `providerLabel`。

⚠ 这两个对象都**不属于卡片**，不进 `stCardDraft`，也不进导出。

### 互斥关系

`promptEnabled`（原系统提示词）与 `tavernEnabled`（酒馆模式）**互斥**：

- 开酒馆 → `promptEnabled = false`，并清空 + 锁住「用户人设」里除昵称外的所有输入项
- 开原提示词 → `tavernEnabled = false`

---

## 7. 验证体系

`C:\Users\YanSaki\WorkBuddy AI\2026-09-17-00-10-39\_verify\` 下有 **8 层验证**，改完代码必须全绿。

⚠ **这一套要 `jsdom`**，而它装在 managed workspace 里，**不在那个目录下**。
不指 `NODE_PATH` 会直接 `Cannot find module 'jsdom'`。

⚠ **`NODE_PATH` 必须是 Windows 风格的路径。** 写成 Git Bash 那种
`/c/Users/…/node_modules` 的话 Node **不会报「路径不对」**，而是继续
`Cannot find module 'jsdom'` —— 看起来就像「jsdom 没装」，会白白去查半天。
`C:/Users/…` 或 `C:\Users\…` 都行，`/c/Users/…` 不行。

```bash
cd "C:/Users/YanSaki/WorkBuddy AI/2026-09-17-00-10-39/_verify"
N="C:/Users/YanSaki/.workbuddy-ai/binaries/node/versions/22.22.2-2/node.exe"
export NODE_PATH="C:/Users/YanSaki/.workbuddy-ai/binaries/node/workspace/node_modules"
"$N" run-all.js
```

（`run-all.js` **自己也会设 `NODE_PATH`**，所以整跑时这句 `export` 可以不写 ——
它是留给「单独跑某一层」的时候用的。另外 `G:\saki\_verify\` 那 16 套是**零依赖**的，不用 `NODE_PATH`。）

### jsdom 层（7 个）

| 脚本 | 覆盖 | 断言数 |
|---|---|---|
| `static_check.js` | 静态：id 唯一（**155**）· `getElementById` 字面量引用存在（**105**）· 内联 handler 都有定义（**173**）· 标签配平（HTML 骨架 5 种 + JS 生成物里的 `<details>`）· 大括号配平（script + style）· **style 块提取没错位**（先摘 script 再找 style，见下）· 若干关键 CSS 规则存在 · **`ST_`/`st` 前缀标识符都声明过（812）** | **17 项** |
| `verify_tavern.js` | 酒馆模式整体流程 | 166 |
| `verify_exclusive.js` | 原提示词 / 酒馆模式互斥 | 80 |
| `verify_regression.js` | 通用回归 | 64 |
| `verify_worldinfo.js` | 世界书扫描（激活、递归、分组、黏性冷却、装饰器、`match*`） | 157 |
| `verify_preset.js` | 提示词预设（数据模型、规范化、拼装、注入、面板） | 273 |
| `verify_steditor.js` | 角色卡编写器（草稿模型、序列化、PNG、导入导出、酒馆助手、MVU） | 520 |

> ⚠ **表里那几个括号数字是「实测快照」，不是判据。** `static_check.js` 的计数是**推导**的
> （`共 ${ids.length} 个字面量`），它**不会因为数字变了而红** —— 只会安静地打个新数字出来。
> 于是这几个数**没人对就一直错着**。**已经错过两次**：
>
> | 快照 | id | `getElementById` | handler | `ST_`/`st` 名字 |
> |---|---|---|---|---|
> | README 最初抄的 | 148 | 99 | 163 | 770 |
> | 2026-09-21 实测（第 8 轮后） | **153** | **104** | **171** | **796** |
> | 2026-09-21 实测（第 9 轮后） | **155** | **105** | **173** | **812** |
>
> 第 8 轮那次，「`getElementById` 引用」**一个都没加** ⇒ 差的 5 个**全是旧漂移**。
> 第 9 轮这 4 个数的增量（+2 / +1 / +2 / +16）**都能对上本轮真正加的东西**：
> 2 个新 `id`（`st-sb-pf-ai` / `st-sb-pf-ai-btn`）、1 处新 `getElementById`、
> 2 个新内联 handler（`stSbAiDescSet` / `stSbAiPrefabRun`）、16 个新标识符。
> ⇒ **增量对得上，说明这次不是漂移，是真的加了东西。**
>
> ⚠ 这跟「写死清单的断言每次加东西都来收一次红的账」是**互补的两种病**：
> 写死会红（烦人，但看得见）；推导不红（安静，所以更坏）。
> **「检查是推导的」不等于「文档里抄的那个数是对的」** —— 加完功能要**重新取一次**这几个数。
>
> ⚠⚠ **还有一类更坏的：判据依赖「正则切在哪儿」。** 2026-09-21 这个脚本报过
> `style 块 #2 大括号配平 → depth:-1`，而那一轮**没碰 CSS**。数了输入才发现：
> 文件里 `<style` **23 次**、`</style>` 只有 **4 次** —— 多出来的全在 **JS 字符串**里
> （状态栏生成器要拼 `<style>` 出去），非贪婪正则把每个 `<style` 配到**下一个** `</style>`，
> 于是「块 #2 / #3 / #4」其实是**被切了一半的 JS 片段**，而片段没有理由括号配平。
> ⇒ 那个检查的红与绿**取决于两刀切在哪儿**，一直在通过**是运气不是证据**。
> 已修成「**先摘 `<script>` 再找 `<style>`**」并补了一道「提取本身对不对」的闸门
> （script 之外 `<style` / `</style>` 数量要相等且等于块数）⇒ `4 个 style 块` → **`1 个`**。
> **通则：任何「切块再检查」的脚本，都要配一条「切出来的东西对不对」的自检。**

运行方式：

```bash
cd "C:/Users/YanSaki/WorkBuddy AI/2026-09-17-00-10-39/_verify"
N="C:/Users/YanSaki/.workbuddy-ai/binaries/node/versions/22.22.2-2/node.exe"
"$N" run-all.js                    # 全部 8 层（含下面那个 Chrome 层）
"$N" run-all.js verify_preset.js   # 只跑指定的几层
```

**首选 `run-all.js`** —— 跟 `G:\saki\_verify\run-all.js` **同一套思路**（同名不同地，
所以两份各自独立、不互相 import）。**四件事**会让它退出码非 0：某层**没有可解析的收尾行**、
**目录里多出没分类的 `.js`**、任何失败项 > 0、**汇总行算出来是负数或分母为 0**
（`BAD-SUMMARY` —— 那是崩溃输出，不是结果；2026-09-21 加的，见上面 Chrome 层那段）。
⚠ 也**不写死期望总数**（理由同上）。
⚠ **本地那 16 套不需要这第四条**：它们的正则 `N 通过 / M 失败` 要求两边都是数字，
`-1/0 通过` 根本匹配不上 ⇒ 走的是「没有可解析的收尾行」那条硬错误。**格式不同，病也不同。**

> ⚠ 它**自己把 `NODE_PATH` 设好**（环境里已有就沿用，没有就自动指到标准位置并打印用的是哪个）。
> 这几层要 `jsdom`，忘了 export 会得到 `Cannot find module 'jsdom'` ——
> 那个错跟「断言失败」长得完全不一样，而且每次手敲很容易漏。
>
> ⚠ 这个目录的收尾格式跟 `_verify/` 那 16 套**又不一样**：这里是 `166/166 通过`
> （分母就是总数，所以能自己算出失败数），`static_check.js` 则是 `静态检查：全部通过`。
> ⚠ 以前的写法是 `… | tail -1` —— 最后一行确实打出来了，但**没有校验**：
> 崩掉的套件最后一行是一句栈信息，照样打出来，**看着不像失败**。
>
> ⚠ 反向测试在 `_reverse4.js`（注入未分类文件 / 让一层不出收尾，两道闸门都必须红）。

### 真实 Chrome 层（1 个）

`verify_tavern_visual.js` —— 用 CDP 驱动本机 Chrome（`--headless=new --remote-debugging-port`），
验证布局几何、触控尺寸、对比度、复古皮肤配色、移动端断点，并产出截图到 `../shots/`。

- 断言数：**371**（含两条「折叠 / 展开动画真的跑完了」—— 靠 `transitionend` 判定，
  ⚠ **不是** `sleep(350)`。那个固定值原来是照着 `0.22s` 配的，产品改成 `0.35s` 之后
  它正好落在边界上，量到的是**起始宽度** ⇒ 两条断言假红，而产品完全正确。
  换成 `transitionend` 之后，「过渡没跑起来」会走兜底超时**照样红** —— 反向测试验过：
  撤掉 `.st-tabs` 的 `transition`，**恰好这两条**变红，四条宽度断言仍绿）
- ⚠ **手机比例那两节（第 7 / 11 节）的「前提」在 2026-09-20 变过一次** —— 产品加了
  「手机比例下的入口菜单」之后，手机视口下 `#ai-card` 默认是 `display: none`（被收进左上角按钮），
  而**进全屏又会主动把设置 / 高级面板折起来**（`toggleAiMaximize()` 里那句「把高度让给聊天」）。
  折着的面板 `rect` 照旧是 2798 这种真实数字 —— `getBoundingClientRect()` **不受裁切影响** ——
  于是「触控尺寸 >= 32px / >= 44px」两条**假绿**，屏幕上却什么都没有。
  现在那两节走真实路径「进全屏 → 展开设置与高级面板」再量，并补了一道前提闸门
  **「酒馆面板没被折进零高度容器」**。⚠ 反向测试固化在 `_reverse-tv.js`（见 §7）。
- 跑一次约 60 s，**timeout 要放到 300 s**（跟在其他套件后面会被 120 s 掐掉）
- ⚠⚠ **2026-09-21 实测：这一层会「卡在导航」，看起来像产品坏了，其实是网络。**
  它 `Page.navigate` 之后等 `Page.loadEventFired`；而主页有一条 `@import` 拉 Google Fonts
  （3 个字族 → 24 个 `.woff2`），`load` 要等它们全部结束。当前网络下
  `fonts.googleapis.com` **一个请求就要约 4 s** ⇒ 原来的 **15 s** 不够，
  打 `等待事件超时: Page.loadEventFired`、`readyState` 停在 `interactive`（页面本身完全正常）。
  - **已修**：抽出 `NAV_LOAD_TIMEOUT = 60000`（两处导航都用它）。
    ⚠ 这是**网络**超时，不是动画超时 —— 别照动画那套（几百毫秒）配。
  - **先量网络，别先怀疑产品**：
    `curl -s -o /dev/null -w '%{time_total}\n' --max-time 12 'https://fonts.googleapis.com/css2?family=DotGothic16'`
  - **判是不是回归**：拿改动前的副本（`saki - 副本 (N).html`）跑同一个 harness ——
    两边都卡 = 网络；只有新的卡 = 回归。实测**两边都卡**；修超时之前重试第三次
    **371/371 通过（95.9 s）**。
  - ⚠ **修超时之前，`run-all.js` 会把这次失败骗过去**：崩溃后的收尾行是 `-1/0 通过`，
    被 `(\d+)\s*\/\s*(\d+)\s*通过` 啃成 `1/0`（`-` 不是数字）⇒ 失败数算成 **−1**、
    **照样打「✅ 全部通过」、退出码 0**，合计印成「1261 通过 / -1 失败」。
    ⇒ 已给 runner 加第四道硬错误（`fail < 0` 或分母为 0 ⇒ `BAD-SUMMARY`），见下。
  - 本层的 **371** 是外部合计 `1 631` 的唯一来源：`1 260`（6 个 jsdom 层）+ **371** = `1 631`。

```bash
"$N" verify_tavern_visual.js 2>&1 | tail -5
```

### 编写器专项：`G:\saki\_verify\`（16 个，共 2 234 条）

`verify_steditor.js` 覆盖了状态栏的**模型与序列化**，但界面 / 解析 / 渲染那一层要真浏览器才
验得动 —— 所以状态栏的专项套件放在 `saki.html` 旁边，都走 CDP 驱动本机 Chrome：

| 脚本 | 覆盖 | 断言数 |
|---|---|---|
| `check.js` | **静态检查**（零依赖、不开浏览器、runner 里排第一个）：内联 JS 能不能解析（`vm.Script`，等价 `node --check`，**不用先生成 `blk0.js`**）· 内联 handler 引用的函数都声明过（打印 `MISSING:`）· 重复的 `id="st-…"` 字面量 · **`ST_`/`st` 前缀标识符引用过就必须声明过**（打印 `UNDECLARED`；涂掉字符串 / 注释后扫，排除属性访问 —— **推导式，零手写清单**）· **转义闸门**（见下）· **内联游戏源码切掉闸门**（把 `ST_SHOOTER_SRC` 那段从第 1 / 2 / 4 项的文本里切掉，并打印切了多少字节 + 两套计数口径的差 —— 见 §1） | 5 |
| `sb-verify.js` | 状态栏外观页：三栏布局、命中框、拖放排序、模板、接管状态机、数值夹紧、窄屏、复古皮肤 | 84 |
| `sb-verify2.js` | 补漏：圆点块结构、转义边界、写回幂等、刷新后接着编辑、移除 MVU 后不装死 | 62 |
| `sb-verify3.js` | **解析卡里已有的状态栏**：自往返、逐元素识别、原样保留、接管后改已有元素、还原 | 99 |
| `sb-verify4.js` | **尽可能按原样解析**：逐字节自往返、12 条自定义声明逐条核对、丢掉某一层、没有外壳的稿子 | 101 |
| `sb-verify5.js` | **按运行时规则解析**：围栏 + `<body></body>`、不合格的原稿照样解析并修好、围栏外原文往返、真机预览 iframe | 62 |
| `sb-verify6.js` | **自由摆放**：零偏移零字节、真指针拖动与实时跟手、Shift 吸附、方向键微调、归位、`left`/`top` 回读与 `static`/`absolute` 边界、挪完仍然按运行时规则解析 | 93 |
| `sb-verify7.js` | **调整大小**：零尺寸零字节、八向把手、拖边只长一个轴、西/北边位置跟着走、Shift 吸附、`Alt`+方向键、尺寸复原与归位互不干扰、`%`/`calc` 不当尺寸、画布宽 == 真机预览宽 | 100 |
| `sb-verify8.js` | **预制块**（用块库里的原子块拼好的「一整组」，点一下整组进画布）：那一区的分类 / 按钮数 / 提示语、**遍历全部预制块逐个 `build`**（类型都在块库里、没有空分组）、**`extra` 盖不掉绑到的范围**、卡里没变量时走兜底路径 + `warn` 提示、建出变量后**自动绑定且用变量自己的 `min`/`max`**、选中分组就进分组（增量判据 + 对照组）、**复数（多人好感度）三个槽各绑各的、路径互不相同**、**自己攒预制块**（存 / 插 / 同名覆盖 / 取消覆盖 / 删 / 刷新后还在 / 名字格扛得住重绘）、**插入的块 id 全唯一**、边界（空画布 / 单块超 40 KB / localStorage 坏数据逐条跳过）、窄屏（**没有 0 高的**，配「面板可见」作对照）、收尾零报错 | 113 |
| `sb-verify9.js` | **AI 生成预制块**（写一句中文，让模型拼好一组，存进「我的预制块」）：那一行的渲染 + **描述进状态、重绘后还在**（配对照组）、**没配 AI 就不发请求**（配好作对照）、提示词里 9 种块类型一个不少 + **喂了卡里真实的变量路径与范围**（卡里没变量时走兜底话术）、解析容错（围栏 / 寒暄 / 裸数组 / 缺 `blocks` / 全是空块 / 非 JSON / 怪 type / 垃圾数值）、**清洗**（`offX/offY/w/h` + `extra` 四兄弟 + `clsMap/clsOwn` 一律归零，配 9 条「合法外观字段留住了」作对照，递归到子块）、**封顶**（40→24 且顺序不乱；深 5 层摊到 3 且**块一块没少**）、落盘（存 / 刷新后还在 / **同名加编号不覆盖** / 存满拒收）、绑定统计（`1/2` · `0/2` · 一组里没有 `path` 时不提 `N/N`）、失败路径（网络 / 401 / 非 JSON / 空 `blocks`，且失败后还能再生成一次）、收尾零报错 | 123 |
| `game-verify.js` | **小游戏「复古线框战机」**（把整份 `retro_vector_space_shooter` 内联进主页、在弹窗里玩）：**内联的那份跟源文件逐字节一致**（转义写错**不报错**，只会让游戏里某个正则 / 标签悄悄失效 —— 只有逐字节比对抓得住）、菜单第 4 项走**真按钮的 `onclick`** 能打开、iframe 里的游戏真的起来了（文档解析完 / 选机页可见 / **战机卡数 == 源码里的 `SHIP_PRESETS.length`**，推导式）、**焦点真的进了 iframe**（前提断言「页面本身聚焦」+ 真发一个 keydown 看它落到谁那儿 + **父页面没收到**作对照）、点战机卡真的能开局且**时长在涨**（不是静止画面）、**三条卸载路径**（返回菜单 / 切到别的游戏 / 关弹窗）都要把 iframe 摘掉 —— 那个游戏的 `gameLoop` 在非 PLAYING 态**照样 requeue**，所以「藏起来」和「摘掉」在画面上**一模一样**，摘完还要证 **rAF 真的停了**、宽卡片只对战机生效（拿同一个视口量普通小游戏的卡宽作对照）、三个老游戏一条没坏、收尾零报错 | 87 |
| `st-ai.js` | **编写器的 AI 调用**：配置两种来源、双协议请求形状、四种模型列表形状、两套 SSE 拼接、JSON 抠取边界、批量扩写 / **单条改写** / 开场白落卡、**「第一段」与提示词结构预览**、Key 不进卡、失败路径 | 336 |
| `persona-verify.js` | **人设生成器**（写一句设定 / 要求，AI 按一份模板逐项填好，生成一整份人设）：选项卡在不在 + **紧跟在 `code` 后面**（配一条反向对照：它**不再**挨着「角色描述」）+ **走真按钮**能切过去、面板元素齐全（含**反向对照**：还没生成时结果框与写入 / 追加 / 复制三个按钮**不该在**，空态要说话）、**默认模板逐字**等于用户给的那份（测试里**独立写一遍**，不引用产品常量 —— 拿常量比自己永远相等）+ **项数用另一套写法独立算一遍**（模板里半角 / 全角冒号**混着用**：全角那 9 项要认、`- 风格：` 要认成「风格」而不是「- 风格」、三个重复子项只算一项）、模板可改且**存进 localStorage**、**刷新还在**、**清空 = 回到默认模板（而且是删键不是存空串）**、超长截断、「恢复默认模板」按钮、**面板参数活在状态里**（走**真实 `oninput` 路径** + 重绘之后还在）、提示词里带上**用户原文 + 模板全文 + 这张卡现在的名字**、未配 AI 就不发请求、围栏清洗（**没包围栏的原样留着**作对照，洗多了会吃掉真正的第一行而看不出来）、**「模板 N 项里对上了 M 项」**（漏项 → `warn` 且说出漏了几项，全中 → `ok`）、**写入 / 追加**（空描述直接写、非空描述**必须弹 confirm**，答「不要」卡一点不动 / 答「要」才整个替换、追加不弹窗、描述是纯空白时追加不留空行、没有结果时只给提示不动卡）、复制、**忙态扛得过重绘**（重绘之后按钮还是「⏳ 生成中…」）、失败路径（网络不通 / 401 / 空回复 / 模型回寒暄），收尾零报错；**「模板」默认折叠**（收起时量**外层网格容器**自己 + 做**命中测试**，展开时把同样两样再量一遍 —— ⚠ 因为 `grid-template-rows: 0fr` 的**裁切不影响 `getBoundingClientRect()`**，里面 textarea 的 rect 照样满高，**拿 rect 当判据的话收起 / 展开量出来一模一样**，这条也留成对照断言记着）、**状态提示排在模板折叠块下面**（对照组盯的是「两个节点都在顺序表里找到了」，防 `indexOf` 找不到时返回 `-1` 让主断言**天然成立**）、折叠态**从状态渲染**（重绘之后还在，不是只活在 DOM 上）| 177 |
| `st-code.js` | **Code（Agent）页**：工具调用协议（两套）、19 个内置工具 + **工具型 skill 注册成工具**的行为与边界、**工具型 skill 的权限白名单**（三层能力、`fetch_url` 永远不给、次数上限、没给 `value` 不许当空串写）、**`fetch_url` 的地址闸门**、Agent 循环与消息序列、skill 四条导入路径（目录 / 选文件 / **从链接** / **拖拽**）+ **触发词自动注入正文**、**`set_tasks` 任务清单**、**项目记忆与 `remember`**、**`read_doc` / `write_doc` 的状态栏与 MVU 往返**、**`read_regex` / `write_regex` / `read_th` / `write_th` 按条目改 + MVU 自己的东西挡住**、**截断标记闸门与 `read_doc` 分段读**、**skill 落盘（IndexedDB + 降级 + 迁移）**、**工具型 skill 的沙盒**（摸不到卡 / 写不了 localStorage / 上不了网 / 超时掐得掉）、**skill 自报进度**（单向通道、没申请就被丢、节流 + 次数上限、返回后收走）、会话历史落盘、窄屏单栏切换、**「第一段」开关**（默认不带 / 打开后必须排在最前 / 空值不发 / 落盘往返）、JSON 只读不写、**记忆输入框写超了当场看得见**（`maxlength` + 计数器变红 + 折叠摘要带字数 —— 不静默丢字） | 670 |
| `sb-keep-compare.js` | **渲染级证据**：原稿 vs 产物逐元素比对计算样式 + 500×1100 区域 PNG 逐字节 | 32 |
| `smoke.js` | 全应用冒烟：15 个选项卡、装 MVU → 建变量 → 套模板 → 写进正则一条龙、**两处「展开键」**（全屏浮层顶栏 `≡ 选项卡` + **主页卡片的箭头**：箭头存在 / 有 transform 过渡 / 与参照物同时长 / 折叠态转 180° / 重画后仍在 + 两个展开态对照组）、**手机比例下的入口菜单**（切到 390×844 视口：两卡收起 + 时钟/日历作对照仍绿 / 点按钮展开 / 点「AI 对话」直接全屏 / **全屏时没被 `display:none` 压掉** / 切回桌面三件事复原）、**手机菜单的复古皮肤**（三个非复古对照组：按钮不是 Win98 灰 / 有圆角 / 菜单项不透明 → 加 `retro-mode` 后：按钮 `#c0c0c0` + 圆角归零 + 凸起立体边框、卡名标签 Win98 灰 + 凹陷边框、菜单框 Win98 灰 + 凸起、菜单项自己不带底色 + 圆角归零 → 鼠标移上去是海军蓝底白字 → 移开恢复 → 退出复古后按钮复原）、**「正在编哪张卡」标注**（跟编写器卡片的「当前草稿」是同一份数据：改 `card.name` 标注跟着变 + 改回原名作对照 + **在面板里** + **在「角色卡编写器」那一项下面** + **菜单收起后命中测试摸不到它**（配「展开时摸得到」作对照）+ 两个菜单项等宽） | 90 |

```bash
cd /g/saki/_verify
N="C:/Users/YanSaki/.workbuddy-ai/binaries/node/versions/22.22.2-2/node.exe"
"$N" run-all.js                # 全部 16 套：逐套打印 + 合计 + 清单对账
"$N" run-all.js st-code.js     # 只跑指定的几套（会大声提示这是部分结果）
```

**首选 `run-all.js`。** 它把「静默少走」变成了**硬错误** —— 下面三件事都会让它退出码非 0：

1. 某个套件**没产出一行能解析的汇总**（空白 = 错，这正是手工 `grep` 会漏掉的那种）；
2. **目录里多出没分类的 `.js`**（清单要跟目录对账 —— 枚举本身不完整时不会红，只会少走）；
3. 任何 `failed > 0`。

> ⚠⚠ **但它抓不到「某个套件只跑了一部分」。** 2026-09-20 实测：本地全套与外部 8 层**并行跑**
> 时，外部 Chrome 层只跑了 **1/371** 条（21.8 s，正常是 93.9 s）、汇总行照样能解析，
> runner 照样打 **「✅ 全部通过」**、退出码 0 —— 本地那套则被 **SIGTERM** 掐在 10 min 上。
> 这是「**故意不写死期望总数**」那条设计决策的**代价**（写死的话每次加断言都要改它，
> 迟早退化成「永远在报的检查」）—— 盲区是真实存在的，别当它不可能。
> ⇒ **两套 harness 一律串行跑**，各自给足 timeout（**≥ 900 s**）。
> ⇒ 跑完**拿逐套数字跟 §7 表里的断言数对一遍** —— 这是那张表除了「给人看」之外的**第二个用途**
> （`smoke.js` 90 / `st-code.js` 670 / 视觉层 371 …，对不上就是少走了）。

> ⚠ **为什么需要它**：汇总行**有两种格式** —— `sb-verify.js` / `sb-verify2.js` /
> `sb-verify3.js` / `smoke.js` 打 `N passed, N failed`，其余打 `N 通过 / N 失败`。
> 手工 `grep` 只匹配一种的话，那 4 套会**静默变成一行空白** —— 看起来像「没报错」，
> 实际是**压根没看它们的结果**（实测静默少了 4 套、**272 条**）。
>
> ⚠ 它**故意不写死「期望总数」** —— 写死的话每次加断言都要改它，迟早退化成
> 「永远在报的检查」（那种检查只会被无视）。它只**打印**总数，方便跟上面表里的数对照。
>
> ⚠ **这个 runner 自己也做过反向测试**（`_reverse3.js`）：注入一个未分类的 `.js`、
> 再让某个套件不产出汇总 —— 两道闸门都必须红。**检查本身也是代码，也要能证明它会红。**

这个目录里除了上面 16 套，还有几类**不是回归测试**的文件，别被名字绕进去：

| 文件 | 是什么 |
|---|---|
| `extract.js` | 从 `saki.html` 抽出内联 `<script>` 写成 `blk0.js`（**生成物**，大小跟着 `saki.html` 走 —— 别抄数字，要就现跑）。⚠ **只为临时分析服务** —— 检查已经不走它了（见下）。⚠ **产物用完就删、别留在目录里** —— 两份过期副本已于 2026-09-20 清掉 |
| `run-all.js` | **跑全部 16 套的 runner**，带「清单对账 + 汇总行解析 + 合计」。⚠ 它自己也在清单里（`NOT_A_SUITE`），否则会被自己对账拦下 |
| `_mk-shooter-embed.js` | **把小游戏源码内联进 `saki.html` 的生成器**（`_` 前缀，跑的是**产品文件本身**）。三档：不带参数 = 干跑（转换 + 往返自检 + 报告，**不写文件**）· `--go` = 真写（幂等，重跑就整段替换）· `--verify` = 只从 `saki.html` 抽出来跟源文件逐字节比。⚠ 内联要同时满足**两个解析器**（JS 的 + HTML 的），五条转义规则各挡一个坑，最阴的是 `\` → `\\`（不转义的话 `/\d+/` 静默变成 `/d+/`，游戏能开、正则全废）和 `<!--` → `<\!--`（HTML 词法器见到它进 escaped 态，此后 `</script` **不再算结束标签**）。⚠ 判据是**往返逐字节一致**，不是「能跑起来」—— 第一版就是靠它抓到 `<\/` 多吐了一个 `/`（`</script` 变成 `<//script`）。⚠ 改了游戏源文件就要重跑 `--go`，否则 `saki.html` 里留的是旧版本，而它**看起来完全正常** |
| `_probe-focus.js` | **「键盘怎么才能真的进 iframe」的一次性探针**：把五种聚焦写法逐个试过去，每种都打印父页面 `activeElement` / 子文档 `hasFocus()`，最后真发一个 `keydown` 看落到谁那儿。⚠ 结论：`contentWindow.focus()` **单独**在 `load` 里调**不生效**（父页面 `activeElement` 还是 `BODY`、子文档 `hasFocus()` 是 false，而游戏画面**看不出任何异常**）；关键是**时机** —— 挂上去（导航之前）就送焦点 |
| `sb-diag*.js` / `sb-zoom*.js` / `sb-shot-color.js` | 状态栏的一次性探针：解析中间态、放大看某个块、取某个元素的实际颜色 |
| `_probe-mobile-nav.js` | **手机菜单的一次性探针**（`_` 前缀，跑的是**产品本身**）：切到 390×844，可选加 `retro-mode`，出 `shots/mnav-<名字>-phone.png` / `-retro.png` 两张图，并打印菜单各层（`.mobile-nav` / 按钮 / `.mobile-nav-panel` / `.mobile-nav-inner` / `.mobile-nav-box` / 两个菜单项）的 `width` / `left` / `right`，以及 `.mobile-nav-box` / 编写器那一项 / 卡名的**纵向** `top` / `bottom`（卡名挪进面板之后，「在不在编写器那一项下面」是个纵向关系）。⚠ 「两个菜单项右边缘为什么是锯齿」就是靠它量出来的 —— 光看截图只能看出「不齐」，量宽度才知道是 `display:flex` 的 `<button>` 按 fit-content 算。⚠ 收尾顺序是 `kill()` → `close()` → `sleep(400)` → 删 profile；而且 `chromeProc` / `httpSrv` 必须挂在**模块作用域** —— `.finally()` 的回调**看不见** async IIFE 里 `const` 出来的变量，越界引用被 `try/catch` 一吞就长得跟「清理成功」一样（2026-09-20 实测漏了 3 个 `cdp-mnav-*`） |
| `run*.log` | 跑批留下的输出，随手可删 |
| `shots/` | **探针 / 套件的产物**：截图（`.png`）与对比用的 HTML（`.html`）。⚠ 现在里面有 **57 个 png + 9 个 html**（快照，2026-09-21） —— 都**不是输入**，删掉不影响任何检查，重跑对应脚本会再生成。⚠ 别把它当「目录里只有 `.js`」——**一次性探针的产出全在这儿**，找截图先来这儿，别在 `_verify/` 根下 `ls *.png`（那里一个都没有） |
| `_purge-tmp.js` | **数 / 清临时 profile 残留**：`node _purge-tmp.js` 只数，`--go` 才真删（**默认不删是故意的** —— 会删东西的脚本不该把「删」设成默认动作）。⚠ 只认本仓库造过的 **12 个**前缀白名单（`cdp-` / `diag-` / `diagth-` / `font-` / `fontd-` / `fontpx-` / `fontv-` / `fontvar-` / `probe-sb-` / `pbtn-` / `pfnt-` / `dbg-`），且必须是 `os.tmpdir()` 下的目录 —— **绝不递归删 tmpdir 本身**。⚠⚠ 它还会打印**「未收录的前缀」**（tmpdir 里有、但不在白名单里的一律列出来）—— **那一道才是这份脚本真正的防线**：白名单是手写的、一定会漏，而漏掉的后果是**静默少扫一批**（见上面那段「那次全清并不全」） |
| `_audit-counts.js` | **审计「N 个 X」这类计数断言**：挖出全仓文档里「数字 + 量词 + 名词」并按名词归组，**同一名词出现多个数字就打 ⚠**（那些是「至少有一处错」的候选）。⚠ **默认排除 `CHANGELOG.md`** —— 它是历史文本（「当时是 12 个」也是对的），拿它当当前断言会淹掉信号；要一起扫加 `--with-changelog`。⚠ 它只负责**找出候选**，判对错要回源码枚举 —— 静态检查**看不见事实** |
| `deploy-check.js` | **线上那个页面是不是本地这一份**（只读，⚠ **不是套件** —— 它依赖网络，已登记进 `run-all.js` 的 `NOT_A_SUITE`）：GET 线上 `index.html`，跟本地 `index.html` 比 **字节数 + sha1**，顺带核 `saki.html` 跟它一不一致（⚠ 站点发的是 `index.html`，忘了 `cp` 就会在这行报出来）。加 `--runs` 再查：最近 5 次 `static.yml` 的结论（`cancelled` 会**顺带数 job** —— `total_count: 0` 就是「排队阶段被掐」，见 §1 那段）、最近 3 次 deployment、以及**当前有几条 active workflow**（> 1 就提醒逐个核 `on:` 与 `concurrency:`）。**退出码 0 = 线上与本地逐字节一致。** ⚠ 为什么需要它：`git push` 绿 + 远端 blob 一致 **只证明仓库对了，不证明站点对了**（`RULES.md` 六之二十） |
| `_audit-anchors.js` | **核对本文件 §2 / §3 那两张行号表**（只读）：§2 断言每个 `id="X"` / 首个 `class="…X…"` **就在**表里那个行号上，§3 断言表里那些行号**必须是注释横幅开头**（漂了就报「最近的上一个横幅在 N」—— 直接给出真值）。⚠ 硬判据**抓不到「漂到了另一个横幅上」**（那种情况照样是横幅 ⇒ 照样 ✅），所以补一道**软提示**：区块名跟横幅正文**共享不到 2 个字** ⇒ 打 ⚠（**不计入失败、不影响退出码**；门槛跟名字长度挂钩，否则「名字里只剩 1 个中文字」会变成永远在报的检查）。⚠ 判据用「共享字」不用「整串包含」—— 表里的名字是**编者概括**，实测「可折叠字段」vs 横幅「可折叠**的**字段（…）」、「浮层复古皮肤」vs「复古皮肤：浮层…」两处都栽在这上面。⚠ **往 `<head>` 插一段 CSS 会让后面所有锚点整体后移，而且同一张表里可能有两种位移**（实测 §3 里 `2424→2444` 是 **+20**、`2580→2621` 是 **+41** 并存）⇒ **别靠加法算，跑它**。⚠ 它只管「行号对不对」，不管「这一节该不该在这儿」——**语义仍要人看** |

> ⚠⚠ **历史状态（2026-09-20 审查时）：每一套 CDP 套件都会在系统临时目录里留一个 Chrome profile，
> 而且不删。** 它们都是 `fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-…-'))` 建出来、当
> `--user-data-dir` 用，收尾时**没有** `rmSync`。当时本地 15 套里 14 套走 CDP ⇒
> **每跑一次全量就多 14 个目录**；实测 `cdp-*` 前缀 **873 个目录、约 14.5 GB**。
> ⚠ **这一段记的是当年的现场，不是现在的行为** —— 现况见下面两条 ✅（净增 0）。
> （2026-09-23 加第 16 套时，**没有**把这个旧数字顺手 +1 —— 加套数不等于加泄漏。）
>
> ✅ **已修（2026-09-20）**：本地 25 处 `mkdtempSync` 全部补上收尾清理（11 套 + 7 个一次性探针，
> 之后新加的 `sb-verify8.js` / `sb-verify9.js` 一开始就带着）；
> **外部 7 个文件也一并补了**（见下）。⚠ **`maxRetries` 不能省** —— Windows 上进程刚 kill 掉时
> 目录还锁着，裸 `rmSync` 会 EBUSY 退出，而外面那层 `catch` 把它吞掉 ⇒ **静默失败**。
> 实测：不带重试时 `st-ai.js` 每次全量都漏一个；补齐后**连跑多次全量，`cdp-*` 净增 0**。
> ✅ **复量（2026-09-23）**：16 套全跑一遍（3 m 48 s）+ 反向测试再跑 6 次，`cdp-*` 前缀
> **新增 0 个**（`_purge-tmp.js` 只剩 2026-09-21 那 7 个旧的）。⇒ **这条不用再当「固定成本」看了。**
> （`smoke.js` / 4 个一次性探针的 `prof` 在 IIFE 里、外面 `.catch` 够不着，
> 所以那几处按**前缀扫**删，不是用变量。）
>
> ⚠ **修正一句上一轮写错的话。** 上一轮这里写的是「外部 6 套**本来就有的**」——
> 实测：外部 harness 是 **7 个文件**（`verify_tavern_visual.js` + 6 个 `diag_*`）有 `mkdtempSync`，
> 而且**每一个都是裸 `rmSync`、一个 `maxRetries` 都没有**。「有清理调用」和「清理生效」是两件事。
> ✅ **已补（2026-09-20 续七）**：7 处全部加上 `maxRetries: 8, retryDelay: 150`，
> 每处都从磁盘回读核对过。⚠ **这不是在修一个正在漏的东西** ——
> 先量了：`cdp-tavern-` 最新一个是 **09-19 22:26**，今天跑了 4 次都没新增；
> 这是在**关掉全仓最后一处同类形状**（`kill()` 之后立刻 `rmSync`、无重试）。
> 那 39 个 `cdp-tavern-` 是历史遗留，不是现在的泄漏率。
>
> ⚠ 已经堆出来的那些目录**要人确认后再删** —— 它们全在系统临时目录下，
> 不是这个仓库的一部分，删除属于破坏性操作。2026-09-20 续七实测：`cdp-*` **933 个**
> （其中 `cdp-tavern-` 39、`cdp-diag-` 4），另有 `diag-` 4 / `font-` 3 / `diagth-` 1 /
> `fontd-` 1 / `fontpx-` 1 —— **合计 943 个目录 / 329 163 个文件 / 13.13 GB**。
> 最旧一个 **2026-09-17 12:22**、最新 **2026-09-20 07:13**。
> ⚠ 数它最稳的是 node 的 `os.tmpdir()`。本机 Git Bash 的 `/tmp` **恰好**挂到同一个目录
> （两边数一致：933 个 `cdp-*`），但那是挂载约定、不是保证 —— 别拿它当跨环境的事实。
>
> ✅ **已清（2026-09-20 续八）**：用户点头后全清 —— `_purge-tmp.js --go` 报
> 「先数 943 → 删除成功 **943 / 943** → 删完再数 **0**」。**清的是历史积压，不是新的泄漏率**：
> 清之前先跑过一次本地全量，`cdp-` 933 → 933（净增 0），所以清完仍然应该净增 0。
>
> ⚠⚠ **但那次「全清」并不全 —— 2026-09-20 第十七轮才发现。** 白名单当时只有 **6 个**前缀，
> 而 tmpdir 里本仓库造出来的其实是 **12 类**。于是
> `probe-sb-` / `pbtn-` / `pfnt-` / `fontv-` / `fontvar-` / `dbg-` 这 **18 个目录 / 212.8 MB**
> （全是 09-17 / 09-19 的）**从头到尾没被看过一眼** ——
> 脚本只数白名单里的东西，**白名单外的不在它的视野里**。
> ⚠ **它不会报错，只会安静地少扫一批**：输出照样是「943 / 943 成功、失败 0、删完再数 0」。
> 这就是那条通则的现场：**枚举不完整时不会红，只会少走。**
> 教训不是「下次仔细点」，是**别让完整性靠人记** —— 修法是给脚本加一道
> **「未收录前缀」报告**（tmpdir 里有、但不在白名单里的前缀一律打印出来）。
> 补完 6 个前缀后实测：脚本看得见 **19 个**（原来只看得见 1 个），
> 而「未收录」那一栏里只剩宿主程序自己的目录（`workbuddy-` / `codebuddy-` / `agent-` / `node-` / `vscode-` / 无前缀）
> ⇒ 白名单**当前是完整的**，而且以后再有缺口会当场显形。
> ✅ **已清（2026-09-20 第十七轮）**：用户点头后 `_purge-tmp.js --go` 报
> 「先数 **19**（`cdp-`1 / `dbg-`1 / `fontv-`2 / `fontvar-`2 / `pbtn-`4 / `pfnt-`2 / `probe-sb-`7）
> → 删除成功 **19 / 19** → 删完再数 **0**」，回收 **212.8 MB**。
> 清完再跑一次前缀普查，确认本仓库的**恰好是那 12 类** ——
> 另外两种快照（`_disk3.txt` 与逐目录清单 `_disk2.txt`）**互相印证**，两边都是这 12 类，
> 而 `_disk2.txt` 里多出的 `mozilla-` 是 Firefox 自己的，**不属于本仓库、不进白名单**。
>
> ⚠ **一个预期内的例外：被「杀」掉的跑会留下恰好 1 个。** 2026-09-20 第十五轮实测 ——
> 前台跑超时被 `SIGTERM` 之后，`_purge-tmp.js` 数出 `cdp-=1`（`cdp-stcode-…`）。
> **那不是泄漏**：进程被杀，收尾的 `rmSync` 根本没机会执行。
> **判据不是「数到几个」，是「净增几个」** —— 单跑 `st-code.js`（670/0）前后各数一次，
> **净增 0**，同一个目录名、同一个时间戳自始至终没变。⚠ 先量输入再下结论，
> 别把一个「被杀掉的跑」的副产品记成一次回归。

⚠ **「不启浏览器」的快路径就一条**：`node check.js`。
它自己抽 `saki.html` 的源码、自己解析（`vm.Script`），所以**不用先 `extract.js`**、
也不用先 `node --check` —— 语法错当场就报，`MISSING:` 那份清单比任何运行期测试都早一步
拦住「引用了但没声明」这类加载不报错的 bug。**改完先跑这一条，再上 CDP。**

> ⚠ **为什么不再读 `blk0.js`。** `blk0.js` 是生成物 —— 改了 `saki.html` 却忘了重新 extract，
> 检查会**安安静静地对着旧代码给答案**，而那份答案看起来完全正常
> （`MISSING: (none)` 一样会打出来）。**过时的输入比没有检查更坏。**
> 现在检查当场抽当场查。
> （这条有反向测试：造一份垃圾 `blk0.js`，`check.js` 的输出**逐字不变** —— 见 `_reverse5.js` 探针 A。
> 探针**自己造、自己删**，因为生成物平时不在目录里。）
>
> ⚠ **而且它真的会过时，一次审查当场抓到两处。** 同一份文件在磁盘上有**两份**：
> `_verify/blk0.js` 和**仓库根目录**的 `G:\saki\blk0.js`。审查时实测两份**都不是最新**的 ——
> `_verify/blk0.js` 缺了整个 `progress` 能力（沙盒权限表里还是 `['card.read','card.write']`），
> 根目录那份更旧。**没有任何脚本读根目录那份**，它纯粹是遗留。
> 教训：生成物**要么放一处、要么别留** —— 留两份就一定会有一份是错的，而且看不出是哪一份。
>
> ✅ **已清（2026-09-20）**：两份都删了；`extract.js` 留着（一条命令就能再生，实测
> 1 090 948 字节、`node --check` 通过）。**依赖它的三处也一并改了** —— 只删文件会当场碎掉：
> - `_probe-escape.js` 原来 `readFileSync('blk0.js')` → 改成**直接读 `saki.html` 当场抽**
>   （规则和 `check.js` 第 22~28 行同一套）。它量出来的 29 条裸插值跟 `ESCAPE_ALLOW` 正好对上。
> - `_reverse5.js` 探针 A 原来写的是「备份存在才还原」→ 文件本来不在时会**把垃圾留在目录里**，
>   自己还一个字都不说，下次整跑会卡在「清单对账」那一关、看起来像套件坏了。改成
>   **无条件 `unlinkSync`**；顺手把写死的 `declared functions: 932` 改成**跟基线比**
>   （函数数量每加一个东西就会变，写死等于给自己攒一笔「红」的账）。
> - `run-all.js` 的 `'blk0.js'` 条目**留着**（跑过 `extract.js` 之后它不算「未分类」），
>   但注释改成实话；对账那行改成**从磁盘数**非套件个数，否则 28 个文件会被印成 29。

### 转义闸门（`check.js` 的第 5 项）

**不变量**：`stCode*Html` / `stCodeHighlight` 这些**构建 HTML 字符串**的函数，
凡是把动态值拼进字符串的，都必须先过 `escapeHtml` —— 它们渲染的是模型输出 / skill 输出 /
卡里的内容。

**判据**：把「已经安全的包装」（`escapeHtml` / `stCodeAttr` / `stCodeJsonText`）整段抹白，
剩下的 `+ 变量` 就是候选；候选的**多重集**必须跟 `check.js` 里那张 `ESCAPE_ALLOW` 白名单
**逐字一致**。

⚠ 为什么按「函数名 + 标识符名」而不是行号 / 出现次序：**那两个会漂，这两个不会**。
⚠ 为什么是**多重集**而不是集合：同一个函数里再多一个裸插值，集合看不出来。
⚠ 白名单是**显式**的：新加一个构建函数、或者在老函数里多拼一个变量，都必须来改这里 ——
要么给它套上 `escapeHtml`，要么想清楚为什么不用（数字 / 静态常量表）。
**这正是这条闸门存在的意义：让「又插了一个值」这件事必须被看见一次。**
（当前 **29 条**候选全部是数字、已转义的局部变量、或 `ST_CODE_THINK` / `ST_CODE_TASK_ST`
这类静态常量表的字段。⚠ **别抄这个数** —— 跑一次 `_probe-escape.js` 就现量，
它和 `ESCAPE_ALLOW` 的条目数必须一致。这里原来写的是 **24**，是白名单还只有 11 个函数时的数；
后来加了 `stCodeMemoPopHtml` 的 4 条、`stCodeBarHtml` 也在里面，早就对不上了。）

⚠ 反向测试在 `_reverse5.js`：拆掉一处 `escapeHtml`、新加一个不在白名单里的构建函数，
闸门都必须红。

**Code 页那些「闸门」自己的反向测试在 `_reverse7.js`**（skill 自报进度那一版）：
去掉权限判断 / 去掉节流窗口 / 不撤那句进度 / 把 `progress` 从能力表里拿掉，
四条都必须变红 —— 其中「去掉节流」那条会**只**红一节，因为次数上限是另一道闸，
两条互不代替。⚠ 探针 D 一开始写错了锚点：两个常量里都有 `'progress'`，
改错一个的话红的是「两边是一份」而「进了能力表」照样绿 —— 说明**锚点要选到那一个常量**。

**「展开键」那组的反向测试在 `_reverse8.js`**（自包含：备份 → 注入 → 跑套件 → 还原 → 核字节）。
⚠ **「展开键」在这份代码里有**两个**，探针也就有两组，别把它们当一件事：
- **探针 A / B** 打的是**全屏浮层顶栏那个 `≡ 选项卡`**：A 拆掉箭头 `span` ⇒ **恰好 5 条箭头相关变红、4 条对照组仍绿**；
  B 把 `.st-tabs` 的时长改回 `0.22s ease` ⇒ **只红 1 条**（那条「箭头与左侧栏同时长」）。
- **探针 C** 打的是**主页上那张编写器卡片的箭头**：撤掉 `.st-container.ai-collapsed .st-toggle-icon`
  ⇒ **恰好 1 条红**（「卡片折叠时箭头转到了 180°」），6 条对照仍绿，而且**选项卡那组完全不受影响**。

⚠ 两条探针各自对着**一个不同的病**：A 是「按钮没有状态反馈」，B 是「两边不同步」，C 是「规则整个漏掉」——
**只修其中一个，另一个的断言照样红**，这就是它们必须分开验的理由。
⚠ 另外，外部 Chrome 层那个 `sleep(350)` 也反向测试过（撤掉 `.st-tabs` 的 `transition`
⇒ **恰好两条新断言变红（`timeout`）**，宽度断言全绿）—— 见 §4「真实 Chrome 层」。

**外部 Chrome 层那道「假绿闸门」的反向测试在 `_reverse-tv.js`**（`_` 前缀，自包含：
备份 → 把第 7 / 11 节的「展开设置 + 高级面板」换成 no-op → 跑注入版 → 断言 → 删副本 →
核 sha1 → **再跑原版作对照**；实测 **11 条全绿**）。它要同时证明两件事，少一半都没意义：

1. **闸门变红，而且报出真凶**（`div.ai-adv-inner (h=0.0, overflowY=hidden)`）——
   不是只说一句「红了」；只证明「会红」说明不了它抓的是对的东西。
2. **那两条触控断言在注入版里仍然绿** —— 也就是**假绿被复现了**。
   只证明②说明不了新闸门能抓，只证明①说明不了原来的断言真的会漏。

⚠ **锚点必须是单行。** `verify_tavern_visual.js` 是 **CRLF**（实测 2470 个 CRLF、0 个孤立 LF），
多行锚点用 `'\n'` 拼**永远匹配不到**，而且报出来的是「出现 0 次」这种跟真实原因毫无关系的数 ——
这条坑的老形态是「`$` 锚不到行尾」，这里是「多行字面量锚点」，**同一个根因**。

**`_audit-anchors.js` 自己也反向测试过 —— 而且已固化进 `_reverse9.js`**（`_` 前缀，自包含：
备份 → 注入 → 跑 → 还原 → 核 sha1；实测 **14 条断言全绿** —— A 5 条 + B 4 条 + C 4 条 + 收尾 1 条）。它读的是**文档**，所以注入点也在文档上
（改 `README.md` 一个行号，跑完立刻写回原文）。三组：

- **注入 A**：§2 的 `#st-card` 行号 `5202` → `5203` ⇒ **恰好 1 行红**，报「表里写 5203、**实际 5202**」，
  其余 7 行对照全绿，**exit code = 1**。
- **注入 B**：§3 的 `289` → `290` ⇒ **恰好 1 行红**，报「不是横幅；最近的**上一个**横幅在 289（日历容器…）」——
  **它把「红」变成了可操作的信息**，不用再去 `grep`。
- **注入 C**：§3 的 `289` → `274`（指到**另一个横幅**「数字时钟」上）⇒ 硬判据**照样 ✅**（274 确实是横幅），
  **只有软提示报 ⚠**（共享 0 个字），而 exit code 仍是 **0**。
  ⇒ 这一组专门证明**软提示不是摆设**：它抓的正是硬判据的盲区，而且**没把软的东西偷偷变成硬的**。

⚠ **「跑完 `cmp` 报 DIFF」≠「脚本改坏了文件」。** 第一次核的时候我拿来比的是**几轮编辑之前**的备份，
DIFF 是**备份过时**，不是回归 —— 差点误判成脚本 bug。判据要用**同一时刻**的快照：`cp` 一份 → 跑 → `cmp`，
实测 sha1 **跑前跑后一致**（**不写具体值** —— 它会随 README 每次编辑而变；脚本自己会打印「sha1 X vs 原文 X」）。⚠ 顺带确认：Node 的 `crypto` 算出的 sha1 与 `sha1sum` **一致** ——
两者不同就说明**内容真的不同**，不是「编码口径差异」。

**量「展开键动画」用 `_probe-stcard-anim.js` / `_probe-tabs-anim.js`**（都是 `_` 前缀的一次性探针）。
⚠ 判据是「**`transform` 取值数**」不是「终值对不对」：`_probe-stcard-anim.js` 实测修复前
取值数 = **1**（箭头一动不动）而卡片高度照样是渐变 —— **只看「内容收起来了没有」抓不到这个 bug**。
它还带 `[标签]` 参数，`node _probe-stcard-anim.js broken` 能把「修前 / 修后」两张展开键特写
分别存成 `shots/stcard-<标签>-head-{collapsed,expanded}.png`。

⚠⚠ **反向测试要定期重跑，不是写完那天跑一次。** 它写的当天全绿，六天后重跑时
**基线就已经是 `661 通过 / 2 失败`** —— 它的第一个职责（断言套件是绿的）悄悄烂掉了。
那次捞出一个**真 bug**：`stCodeSkillRun` 的 `finish()` 里注释写着「收尾要把进度那句撤掉」，
而 `stCodeProgressClear(id);` 那一行当时**不在文件里**。
⚠ **但别把它说成「那一行从来没写过」。** E11 那条断言（它前面那条 `prog_yes` 一定会把
`stCode.prog` 设成对象）**没有那行代码不可能通过**，而上一轮 `run-all` 报的正是 `663/0`。
所以准确的说法是「**写进去 → 落盘 → 跑绿 → 之后被静默弄丢**」。
⚠ 当时**没有那一版的文件快照**（`/tmp/saki.bak` 早于这个功能），结论是从**断言的可通行性**
反推的 —— 推理对不等于事实。展开见 `RULES.md` 六之三。
⚠ **语法 / `UNDECLARED` / 转义闸门三个静态检查全都看不见它** —— 函数声明在、别处也在引用，
符号是健康的；**只有行为断言抓得到**。
⚠ 通则：**注释说了什么 ≠ 代码做了什么**（批量 Edit 漏掉**一条语句**时会留下注释，
文件照样解析）。看到「注释承诺了某件事」的地方，值得专门 `grep` 那句话对应的调用**在不在**。

⚠⚠ **改了哪个套件就单跑哪个 —— 汇总总数不能替代单跑。** 实测**同一份产品**：
`run-all.js` 报 `st-code.js 663 通过 / 0 失败`，单跑报 `661 通过 / 2 失败`。
⚠ 这两个数是**那天的快照、不是当下的基线**（现在这个套件已经是 670 条）——
**拿它去对照今天的运行结果，就会得出一个不存在的差异。**
⚠ **第一反应容易是「套件之间串味」**（前面留下的状态恰好让后面那条通过）—— **实测证伪了**。
真因是**两次跑的不是同一份文件**（见上一条：那行代码在两次运行之间被弄丢了）。
`_probe-falsegreen.js` 把 bug 注回产品、两边各跑一遍：`run-all` **如实报红**
（`661/2`、合计 `1662/2`、退出码 1）—— 它**不盖红**。展开见 `RULES.md` 六之四。
⚠ 通则：**两个 runner 结论不一致时，先怀疑「两次跑的不是同一份文件」，再怀疑串味。**

⚠⚠ **2026-09-20 又整跑了一遍全部反向测试 —— 这次抓到的是「探针自己烂了」，
不是产品烂了，所以任何绿灯都不会提示你：**

| 脚本 | 问题 | 后果 |
|---|---|---|
| `_reverse3.js` 探针 B | 锚点写的是 `const SUITES = [\n    'sb-verify.js',`，而 `check.js` 后来被加到了 SUITES **最前面** | 锚点失效 → 打 `NOT FOUND` → `process.exit(1)`。**后面两条断言从来没跑到**，整条探针等于摆设，每天只安静打印一行 NOT FOUND |
| `_reverse2.js` | 设计成「注入，然后自己手动 `--restore`」 | 忘了还原就把**坏产品**留在盘上。实测跑完 `saki.html` 的哈希已经变了，而它只打印一句「跑完用 `--restore` 还原」 |

**修法**：

- 锚点改成 `const SUITES = [` —— **不会因为「清单里加了一项」而失效**。
  通则：**锚点要选「结构性」的那种，别选「清单第一项的名字」**。
  （外部那份 `_reverse4.js` 是同一形状，一并改了。）
- `_reverse2.js` 改成**自包含**（跟 `_reverse5/6/7.js` 一个套路）：备份 → 注入 → 跑套件 →
  断言**恰好那几条**变红 + **对照组仍绿** → 还原 → 核对字节与汇总。`--restore` 只留作逃生口。
  另加一道**守卫**：目录里存在 `_reverse2.bak` 就**拒绝启动**（那个文件的存在本身就说明上次没还原）。
- 顺带修掉 `_reverse3.js` 里写死的 `622 通过`（早漂成 670）→ 改成从输出里现取。

⚠ 通则：**「跑完了」和「每条断言都跑到了」是两件事。** 探针里任何提前 `process.exit()`
都会静默吃掉它后面的断言，而输出看起来仍然「像跑过了」。**重跑反向测试时先数一下
每个探针各跑了几条断言**，别只看有没有 ❌。
⚠ 另：`process.exit()` **不跑 `finally`** —— 锚点检查必须放在 `try` **外面**，
否则临时文件和改过的 runner 会一起留在盘上。

⚠⚠ **量出来的数正好落在阈值上 → 先量输入，别改 CSS。** 外部视觉层报
「移动端顶栏按钮触控高度 >= 32px」`btnH: 31`，**单跑三遍却全是 368/368**。
查出来是**字体时序**：本地那个 7MB 像素字体加载前后，文本行盒 13px → 17px，
按钮高（行盒 + padding 6×2 + border 1×2，border-box）**31 → 32**，而阈值正好 `>= 32`。
**产品完全正确。** 修法是在套件里量之前 `await evaluate("document.fonts.ready.then(() => true)")`。
⚠ `getBoundingClientRect().height` 对带文字的控件 = 行盒 + padding + border ——
它继承**每一次字体切换**；断言余量小于字体行高差的都是掷硬币。
⚠ 判据只能是**重复实验**：「我改的」/「早上还是绿的」**都不能**否定一个闪烁断言。

**`st-ai.js` / `st-code.js` 全程不碰真网络。** 它们把 `window.fetch` 整个换掉
（`Page.addScriptToEvaluateOnNewDocument`，刷新之后桩还在），按 URL 形状判断对方是哪套协议，
再回一份形状正确的假响应 —— 于是「请求发去了哪个 URL、带了什么头、body 长什么样」全都是
**断言到**的，而不是「代码里写了」。想改 AI / Code 那两块，先看这两套。

`st-code.js` 还会**按轮次喂脚本**：第一轮回一个带 `tool_calls` 的响应、第二轮回纯文字，
断言中间那条 `tool` 消息确实带着工具结果发回去了 —— 这是「Agent 循环真的闭环了」的唯一硬证据。

**`sb-keep-compare.js` 是 `sb-verify6.js` / `sb-verify7.js` 的前提。** 自由摆放和调整大小
能加进来，靠的是「**中性值 = 一条声明都不写**」—— 偏移是 `0px`、尺寸是 `0`。只要这条破了，
逐像素对照立刻变红。所以改 `stSbOffCss` / `stSbSizeCss` / `stSbBlockHtml` 之后，这三套要一起看。

⚠ 尺寸这条比偏移更容易踩：偏移的中性值（`left:0`）生成器**从来不会写**，而尺寸的中性值
（`height:1px`）在**分割线**身上生成器本来就写。所以读回尺寸时必须先跟
`stSbSizeBaseline()` 比一遍 —— 否则生成器自己写的那条会被当成用户设的（bug 表 34）。

`sb-keep-compare.js` 跑**两份形态完全不同的手写稿**（`inline` 全内联 / `class` 靠
`<style>` + class），两份都做到像素级逐字节相同。只跑一份会漏掉整整一类 bug。
截图产出在 `_verify/shots/keep-compare-{inline,class}.png`。

### 诊断脚本（`diag_*.js` / `diag_*.py`）

出问题时用的一次性探针，不是回归测试：`diag_layout` / `diag_depth` / `diag_wi` /
`diag_wi_d` / `diag_preview` / `diag_card` / `diag_preset` / `diag_persona` / `diag_stcard` /
`diag_brace` / `diag_thimport` / `diag_font` / `diag_fontdense` / `diag_fontpixel` /
`diag_mvu` / `diag_mvu_adopt` / `diag_glyphdiff.py`。

另有 `mkfixtures.js` —— 生成 `fixtures/` 下那些 PNG 卡（改夹具格式时重跑它）。

### fixtures

`_verify/fixtures/`：`card-v1.json` / `card-v2.json` / `card-v3.json` / `card-v2.png` /
`card-v3-itxt.png` / `card-ztxt.png` / `card-notacard.png` / `lore.json` / `lore-legacy.json` /
`lore-object-entries.json` / `lore-recursion.json`

---

## 8. 改代码时的注意事项

1. **改完必须跑全量 8 层**（再加上 `_verify/` 那 16 套，共 2 234 条）。这套验证不是装饰，历史上有多次「改一处碎三处」都是它抓出来的。
2. **同文件多处编辑不要盲目并行**。已经**五次**被咬（`thScripts: []`、`ST_TH_RAW_KEEP_MAX`、`ST_TABS` 里的 `ai` 选项卡、第一段那批 5 处… —— 都是「声明 / 登记没落地，但引用落地了」，症状离现场很远）。改完逐条 `grep` 确认。
3. **新增「应用填」的槽会让 layout 行数变化**，`verify_tavern.js` 里的下标断言容易碎。新写的断言请用**相对锚点**（找某个哨兵字符串的下标再比较），别写死数字。
4. **CSS 里不能写 `//` 注释**。写了会把紧随其后的那条规则整条吞掉。
5. **CSS 路径必须用正斜杠**。`\fonts\` 里的 `\f` 是转义序列，会被静默吃掉。
6. **静态检查的「引用未声明」扫描**能抓到藏在函数体里、加载不报错的那类 bug。它限定 `ST_*` / `st*` 前缀，误报接近零。
   ⚠ 同一条也适用于**标签配平**：它必须先摘掉 `<script>` / `<style>` 块再数 HTML 骨架
   （JS 里 `'<div' + cls + '>'` 这种拼法数不到、注释里的 `<details>` 会被算进去，
   两条都会让计数永远对不上），JS 那半边另留一条窄检查（只看 `<details>`，先去掉行注释）。
   **永远在报的检查最后只会被无视** —— 一个 20% 误报的检查价值是负的。改检查本身也要做反向测试。
7. **改完跑一遍 `static_check.js` 的最后一项（未声明标识符扫描）** 比跑任何运行期测试都快，能提前拦住最阴的一类问题。
8. **`_verify/` 里的套件不要依赖 CDP 的对话框自动应答**。往页里装 `confirm` 同步桩
   （`Page.addScriptToEvaluateOnNewDocument`），CDP 那条只当保底 —— 实测约 20% 会翻车，
   而且红在一个跟弹窗无关的断言上。另外**任何 `.catch` 都不许空着**，
   这个坑就是被一个空的 `.catch(() => {})` 藏了整整一轮（详见 04 的「测试时的坑」）。
