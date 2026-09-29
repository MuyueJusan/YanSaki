# YanSaki的小屋 · Android 封装版

把仓库根那个单文件页面（`saki.html`）套一层 WebView，打成可以直接装在手机上的 APK。

> **这一支为什么存在**：原本想 fork 一个库来做实验，但 GitHub **不允许 fork 自己拥有的库**
> （实测 `POST /repos/MuyueJusan/YanSaki/forks` 返回 **202**，看着像成功，其实什么都没建 ——
> 返回体里的 id 就是源库自己的 id，`forks_count` 仍是 0）。所以改用**同库的一个分支** `apk`
> 来达到同样的隔离效果：站点只从 `main` 部署（`.github/workflows/static.yml` 的
> `on: push: branches: ["main"]`），这个分支上的任何东西都不会影响线上。

---

## 快速开始

```bash
cd android
bash build.sh        # → build/YanSakiShed-1.0.apk
bash verify.sh       # 只读核对：清单 / 签名 / 对齐 / 内容
```

前置（本机已装好，换机器要重来）：

| 需要 | 位置 / 说明 |
|---|---|
| Android SDK | `C:\Users\YanSaki\.workbuddy-ai\android-sdk`，含 `build-tools;34.0.0` + `platforms;android-34` |
| **JDK 11**（编译用） | `C:\Program Files\Java\jdk-11` —— ⚠ **必须 11/17，见下面「坑二」** |
| JDK 21（跑 d8/apksigner 用） | `C:\Program Files\Java\jdk-21` |
| Python（图标 / 装 dex 用） | 只用标准库，不需要第三方包 |

SDK 不在默认位置就 `ANDROID_SDK=... bash build.sh`。

**不用 Gradle**，链路是手写的：

```
aapt2 compile → aapt2 link → javac → d8 → 追加 classes.dex → zipalign → apksigner
```

不引 Gradle 的三个理由：省 ~130MB 发行包和它要拉的一堆依赖；绕开「本机 JDK 24 与 AGP 的版本窗口」这个不确定性；这个 App 只有一个 Activity、零第三方依赖，用不上构建系统的任何能力。

---

## 三个必须知道的坑

### 坑一：页面必须跑在**真实 origin** 上，不能用 `file://`

产品里 `localStorage` 用了 **76 处**（选项卡状态、卡片草稿、状态栏、主题…）。而 `file://` 是
**opaque origin**，`localStorage` 一访问就抛 `SecurityError` —— 表现是「设置全部存不住」，
界面上不报错，非常难查。

所以 `MainActivity` 学 androidx 的 `WebViewAssetLoader`：用一个保留域名
`appassets.androidplatform.net`，在 `shouldInterceptRequest` 里把请求换成读 `assets/`。
页面于是跑在真正的 `https://` origin 上，`localStorage` / `fetch` / `FileReader` 全部正常。
**纯 framework API，零依赖。**

### 坑二：javac 必须用 JDK 11/17，**不能用 21+**

| javac 来自 | d8（R8 8.2.2）结果 |
|---|---|
| JDK 11 | ✅ |
| JDK 21 | ❌ 内部 NPE |
| JDK 24 | ❌ 内部 NPE |

JDK 21/24 的 javac 在 `-target 8` 下，对**带 `this$0` 合成外部引用的内部类**（也就是任何写在
实例方法里的匿名类 / 非静态内部类）写出的 class 文件，d8 解析不了：

```
java.lang.NullPointerException: Cannot invoke "String.length()" because "<parameter1>" is null
```

两边产出的 class 文件主版本号**都是 52**，`-g:none` 也去不掉 ⇒ **看字节看不出来**。
最小复现在 `tools/repro-d8-javac/`，`bash tools/repro-d8-javac/run.sh` 可以直接跑出这个对照。

> 附带一条：`-bootclasspath android.jar` **只允许配 `-target 8`**（11 以上报
> 「目标 11 不允许选项 --boot-class-path」）。所以「改成 target 11 绕开」这条路是堵死的，
> 唯一正解就是换 JDK。

### 坑三：`zipalign` 的 `WARNING: header mismatch` 是**假警报**，而且它**退出码是 0**

把 `../fonts` 整个拷进 `assets/fonts/` 之后，构建日志里多出 5 行：

```
zip W 09-29 19:17:11  2808 22460] WARNING: header mismatch
```

正好等于字体文件个数 —— 但那**不是**压缩、对齐或内容出了问题。查清的过程和结论：

| 阶段 | 项数 | 「本地头名字 ≠ 中央目录名字」的条目 | zipalign 警告 |
|---|---|---|---|
| `build/apk/base.apk`（aapt2 输出） | 26 | **5**（就是那 5 个字体） | **5 条** |
| `build/aligned.apk`（zipalign 输出） | 26 | 0 | **0 条** |
| 出货 APK（签名后） | 29 | 0 | **0 条** |

根因是 **aapt2 在 Windows 上给「带子目录的资产」写本地文件头(LFH)时，路径用的是平台分隔符 `\`**，
而中央目录(CD)里是 `/`：

```
LFH: assets\fonts\web\Cubic_11_1.100_R.woff2
CD : assets/fonts/web/Cubic_11_1.100_R.woff2
```

zipalign 的 `ZipEntry::compareHeaders()` 最后一条正是 `strcmp(CD 名字, LFH 名字)`，于是每条打一行警告。
`assets/index.html` 路径里没有分隔符，所以**加字体之前从来没报过**。

为什么可以判定无害：

1. **zipalign 是从中央目录重建本地头的**，所以它顺手把反斜杠归一了 —— 它自己的输出 0 条警告。
2. **apksigner 直接拒绝**这种 APK，`rc=1`：
   ```
   com.android.apksig.zip.ZipFormatException:
     Name mismatch between Local File Header and Central Directory.
   ```
   ⇒ 这个缺陷**在结构上不可能进入出货产物**，签名那一步就是闸门。
3. 但 zipalign **只打警告、退出码照样 0**，光看 `build.sh` 成没成功是**看不出来**的。

所以 `verify.sh` 加了一条断言：**出货 APK 里每个条目的本地头名字都要与中央目录逐字节一致**。
配了反向测试 `tools/reverse-lfhname.py`（注入反斜杠 → 断言必须变红；对照真实 APK → 必须为绿）：

```bash
python tools/reverse-lfhname.py     # == 全部符合预期 == 才算过
```

> ⚠ 这个反向测试自己踩过两个坑，都写进脚本注释了，因为**两者都会伪装成「产品坏了」**：
> ① Windows PATH 里的 `bash` 是 **WSL 启动器**，没装发行版时只打印一行中文就 `rc=1` 退出 ——
> 脚本必须显式用 `C:\Program Files\Git\bin\bash.exe`；
> ② 传给 `verify.sh` 的路径要用**正斜杠**，反斜杠会让 `[ -e "$APK" ]` 失败并**立刻退出**。

---

## 目录

```
AndroidManifest.xml                 包名 top.yansaki.shed，minSdk 29 / targetSdk 34
src/top/yansaki/shed/MainActivity.java   全部逻辑（就这一个类）
res/                                图标 + 主题色 + 应用名
  mipmap-*/                         各密度图标（生成物，已入库，方便直接看）
  mipmap-anydpi-v26/                自适应图标描述
tools/make-icons.py                 头像 → 图标（纯标准库，见下）
tools/add-dex.py                    把 classes.dex 追加进 APK 并自查压缩方式
tools/repro-d8-javac/               坑二的最小复现
tools/reverse-lfhname.py            坑三的反向测试（证明那条断言不是永远为真）
keystore/debug.jks                  ⚠ 签名密钥，见「签名」一节
build.sh / verify.sh                构建 / 验证
```

**不在这里的东西**：`assets/index.html`、`assets/fonts/` 和 `build/` 都是生成物，已 gitignore。
`assets/fonts/` 的来源是仓库根的 `../fonts/`（见「字体」一节）。

---

## 图标

用的是 GitHub 头像（`https://avatars.githubusercontent.com/u/86054388`）。
`tools/make-icons.py` 从源图裁出一块「头部特写」，再生成各密度图标 + 自适应图标前景 + 一张预览。

```bash
python tools/make-icons.py <头像.png> res
# 然后看 build/icon-preview.png —— 中间亮区就是启动器实际会露出的部分
```

⚠ 裁切参数 `CROP_X / CROP_Y / CROP_SIDE` 是**看出来的**，改了必须重看预览图。
（实测源图是 **460×460**，不是 512 —— GitHub 不会把原图放大。）

⚠ 生成脚本故意**不用 Pillow**：本机 pip 走代理拉不到 PyPI（实测卡死 4 分钟无输出）。
用标准库 `zlib` 手写 PNG 解码/编码 + 面积平均缩放，零依赖。

---

## 字体

`build.sh` 的第 1b 步会把仓库根的 `../fonts/` **整个目录原样拷进 `assets/fonts/`**：

```bash
FONTS_SRC="$ROOT/fonts"          # $ROOT = 仓库根
rm -rf "$ASSETS/fonts"; mkdir -p "$ASSETS/fonts"; cp -R "$FONTS_SRC/." "$ASSETS/fonts/"
```

**页面一个字都不用改**：`saki.html` 里的 `@font-face` 用的是相对路径 `./fonts/…`，
而 `MainActivity` 的 `shouldInterceptRequest` 会把 `assets/` 下的**任意路径**都喂给 WebView，
所以 `https://appassets.androidplatform.net/fonts/…` 直接命中 `assets/fonts/…`。

体积代价：APK 从 **1 083 285 → 5 036 342 字节**（sha1 `30d9faeb…` → `97b67322…`）。

⚠ 页面实际只引用了 **1 个**字体（`fusion-pixel-12px-proportional-ja.ttf`，7 012 636 字节）；
另外 4 个（`myFont.ttf` / `ttf/Cubic_11_1.100_R.ttf` / `web/*.woff` / `web/*.woff2`，合计
3 667 028 字节）**全仓库任何地方都没引用过** —— 它们是从整个 `fonts/` 目录一起拷进来的。
`verify.sh` 会把这几个「装了但没引用」的列出来，方便决定要不要瘦身。

> 顺带一个观察：`myFont.ttf` 与 `ttf/Cubic_11_1.100_R.ttf` 的 crc32 和大小**完全相同**
> （`733b9c8b` / 2 761 212），是同一份文件的两个副本。

`verify.sh` 的字体检查**故意不写死清单**，而是**从页面正文里把 `url(…fonts/…)` 抽出来**再逐条核对：

```python
refs = sorted(set(re.findall(rb'url\(\s*[\'"]?\.?/?(fonts/[^\'")]+)', html)))
```

这样「CSS 说要用的字体」和「真的装进去的字体」之间不可能出现缝 —— 写死清单的话，
产品里改了路径验证脚本不会红，而且清单迟早漂。

---

## 签名

`keystore/debug.jks` 是**调试密钥**（口令就是公开的 `android`，和 Android Studio 默认那份同性质），
**故意入库** —— 这样每次重新构建的签名一致，可以直接覆盖安装升级，不用先卸载。

⚠ 它是 debug 密钥，**不能用来上架应用商店**。真要发布就自己生成一份 release key，
并把 `build.sh` 里的 `--ks` 指过去。

⚠ `apksigner verify --verbose` 在不给 `--min-sdk-version` 时，会按 APK 自己的 minSdk(29) 校验，
而它**只校验该 minSdk 需要的方案** —— 于是 v1/v2 一律打印 `false`。
**那不是「没签」，是「没查」**（我本轮就先被这个 false 骗过一次）。
`verify.sh` 因此显式传 `--min-sdk-version 23`，实测这个 APK 是 **v1 + v2 + v3 三重签名**。

---

## 已知限制

| 项 | 状态 |
|---|---|
| **返回键** | 小屋是选项卡式 SPA，`canGoBack()` 基本为 false ⇒ 从任何一页按返回都会直接退出。要做到「先回首页」得让页面自己暴露一个钩子，那是产品改动，封装层不该偷偷做。 |
| **离线** | 页面内嵌在 APK 里，完全离线可用。但页面 `@import` 了 Google Fonts，离线时字体退化（不影响功能）。 |
| **真机未验证** | 本机没有设备/模拟器，**只做了静态验证**（`verify.sh` 全绿：清单、签名、对齐、dex 内容、内嵌页面逐字节一致）。**「能装、能跑」还没有在真机上确认过。** |
| minSdk 29 | 故意的：API 29 起有 `MediaStore.Downloads`，导出落盘**零运行时权限**。要兼容 Android 9 及更早得再申请 `WRITE_EXTERNAL_STORAGE` 并处理拒绝，多两条失败路径。 |

## 导出是怎么接住的

产品里所有导出都汇到一个函数：`stDownload(filename, blob)` →
`URL.createObjectURL` + `<a download>` + `a.click()`。WebView 的 `DownloadListener` 拿到
`blob:` URL 是**取不到内容**的。

所以页面加载完成后注入一小段脚本，把 `HTMLAnchorElement.prototype.click` 包一层：
只拦「**带 `download` 属性** 且 **href 是 `blob:`**」的那一下，读出字节交给
`window.YanSakiNative.saveFile()`，Java 那边用 MediaStore 写进「下载」目录；其余点击原样放行。

⚠ 拦截点选的是**浏览器 API**（`a.click()`）而不是产品里的函数名 `stDownload` ——
后者改名就失效，而且等于把封装层焊死在产品实现上。⇒ **产品源码一个字节都没改。**
