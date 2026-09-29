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
bash verify.sh       # 只读核对：清单 / 签名 / 对齐 / 内容 / 字体 / AI 转发
```

改完之后想确认「断言本身不是永远为真」，跑两个反向测试：

```bash
python tools/reverse-lfhname.py      # 坑三
python tools/reverse-ai.py           # AI 那一节（5 根针，含 3 次重建，约 2 分钟）
```

AI 转发那条链路**不需要手机**就能验：

```bash
bash tools/test-aiproxy/run.sh       # 真 javac + 真 JVM + 真垫片，本地假上游
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

## 四个必须知道的坑

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

### 坑四：`rm -rf` 可能**静默失败**，而且根因不是「删除机制坏了」

`tools/test-aiproxy/run.sh` 收尾要删中间目录 `.work`。日志里出现了：

```
[safe-delete][SAFE_DELETE_FAIL_CLOSED] … "reason":"trash-failed" …
ERROR … Error during a `trash` operation: Unknown { description: "Some operations were aborted" }
```

`rc=1`，**目录原样留着**。但同一个目录**过几秒再删就成功** —— 也就是说它是个**竞态**，不是删法的问题。
（我为此先去查了 genie-trash、又加了 `shutil.rmtree` 兜底、还加了 `wait`，全都没用。）

真正的成因有两层：

1. **顺序**：收尾那句 purge 写在 `exit 0` **之前**，而停服务器的 `trap cleanup EXIT` 要到退出时才跑
   ⇒ 删的时候服务器**还活着**，`server.log` 还被它占着 ⇒ Windows 拒绝删除。
2. **静默**：`run.sh` 用的是 `set -uo pipefail`（**没有 `-e`**）⇒ `rm -rf` 失败**不影响脚本继续跑**。
   同一句 `rm -rf` 在 `build.sh` 里是**响的**（那边有 `-e`，会当场把脚本打死）。

为什么必须修，而不是「反正下一轮会重建」：清不掉就留着**上一轮**的 `expected/*.bin`，
而 `contract.test.js` 是拿它当**真值**去比的。这一轮 `server.py` 要是没写出 `sse.bin`，
测试就会拿**上一轮的录制**比对然后**通过** —— 拿旧数据当真值，比直接报错难查得多。

所以改成「**先停服务器（并 `wait` 到它真的退出）→ 再删 → 回读确认 → 删不掉就拒跑**」。
这条闸门也反向测过：用另一个进程占住目录里的文件再跑，它必须拒绝：

```
❌ 清不掉 /g/saki/android/tools/test-aiproxy/probehold —— 上一轮的 expected/*.bin 会冒充这一轮的录制，拒绝继续
   目录里还剩：locked.bin
  run.sh 退出码 = 1
```

---

## 目录

```
AndroidManifest.xml                 包名 top.yansaki.shed，minSdk 29 / targetSdk 34
src/top/yansaki/shed/
  MainActivity.java                 宿主 Activity：WebView 装配、assets 拦截、两个注入脚本、JS 桥
  AiProxy.java                      AI 转发核心（⚠ 刻意**不 import android.\***，见「AI 跨域转发」）
  JsEvent.java                      Sink 回调 → evaluateJavascript 那一行（同样不 import android.*）
shim/ai-fetch-shim.js               注入页面、包一层 window.fetch 的垫片（build.sh 拷进 assets/）
res/                                图标 + 主题色 + 应用名
  mipmap-*/                         各密度图标（生成物，已入库，方便直接看）
  mipmap-anydpi-v26/                自适应图标描述
tools/make-icons.py                 头像 → 图标（纯标准库，见下）
tools/add-dex.py                    把 classes.dex 追加进 APK 并自查压缩方式
tools/repro-d8-javac/               坑二的最小复现
tools/reverse-lfhname.py            坑三的反向测试（证明那条断言不是永远为真）
tools/reverse-ai.py                 AI 那一节的反向测试（5 根针，见「AI 跨域转发」）
tools/test-aiproxy/                 桌面契约测试：真 JVM + 真垫片，不需要手机/模拟器/联网
  server.py / Harness.java / contract.test.js / run.sh
keystore/debug.jks                  ⚠ 签名密钥，见「签名」一节
build.sh / verify.sh                构建 / 验证
```

**不在这里的东西**：`assets/index.html`、`assets/fonts/`、`assets/ys-ai-shim.js` 和 `build/`
都是生成物，已 gitignore。`assets/fonts/` 的来源是仓库根的 `../fonts/`（见「字体」一节），
`assets/ys-ai-shim.js` 的来源是 `shim/ai-fetch-shim.js`（见「AI 跨域转发」）。

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

体积代价：只加字体那一步是 **1 083 285 → 5 036 342 字节**；再加上 AI 转发之后，
当前出货是 **5 048 696 字节**（sha1 `cb6defe6…`，写于 2026-09-29）。

> ⚠ 这类数字**会漂**（改一次产品就变），所以别照抄。要现量：
> ```bash
> sha1sum build/YanSakiShed-1.0.apk; stat -c%s build/YanSakiShed-1.0.apk
> ```
> `verify.sh` 每次跑都会在最上面把「多少字节 / sha1 多少」打出来。

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

## AI 跨域转发（让 APK 能用 Google Vertex AI）

### 问题只有一条：CORS

页面本身**已经是一个完整的 Vertex AI 客户端**了，什么都不用加：

| 模式 | 页面里怎么做的 | 打到哪 |
|---|---|---|
| express（API key） | `fetch` + `x-goog-api-key` 头 | `aiplatform.googleapis.com` |
| 完整（Service Account JSON） | `crypto.subtle` 签 RSASSA-PKCS1-v1_5 → 换 access token | `oauth2.googleapis.com` → `aiplatform…` |

它缺的只有一样：**从 WebView 里直连 `*.googleapis.com` 会被 CORS 挡掉**。
Google 不给浏览器 origin 发 `Access-Control-Allow-Origin`，所以请求发得出去、响应读不回来
（表现是 `TypeError: Failed to fetch`，控制台里只有一句含糊的跨域报错）。

### 为什么选「注入 `fetch` 垫片」而不是 `shouldInterceptRequest`

`shouldInterceptRequest` 看上去更正统（不用动页面行为），但它的正确性取决于三条
**在本机无法验证**的行为：① 自己合成的响应要不要手工写 CORS 头；② preflight 会不会也被拦；
③ 流式必须在后台线程**同步**返回。

垫片的语义是**浏览器自己的** —— 它只是把 `fetch` 换掉，剩下的 `Response` / `ReadableStream` /
`AbortSignal` 全是真的。所以这条路**能脱离 WebView 用 Node 验证**，而上面那三条不能。

> 注入是安全的：`saki.html` 里**从来没有**把 `fetch` 赋给变量（`window.fetch =`、`= fetch`、
> `const fetch`、`fetch.bind` 全部 grep 不到），所以包一层不会打乱产品自己的引用。

### 链路

```
页面 fetch(url, {...})
   │  垫片只接管「白名单里的域名」，其余原样交回原始 fetch
   ▼
window.YanSakiNative.aiStart(id, url, method, headers, body)   ← JS 桥线程，立刻返回
   ▼
后台线程 "ys-ai"：AiProxy.execute(...) 用 HttpURLConnection     ← 真网络请求
   ▼
aiplatform.googleapis.com / oauth2.googleapis.com
   │  每 8 KiB 一块
   ▼
JsEvent.head / chunk / done → evaluateJavascript("window.__ysAi.chunk('id','<base64>')")
   ▼
垫片把 base64 还原成字节喂进 ReadableStream ⇒ fetch 的 Promise 拿到一个真的 Response
```

`AbortSignal` 接在 `aiAbort(id)` 上，页面点「停止」或超时时原生请求也会被 `disconnect()`。

### 三件容易写错、所以特意写对的事

- **`Accept-Encoding: identity`** —— 不加的话 `HttpURLConnection` 的透明 gzip 会把整个 SSE
  **缓冲成一整块**再吐出来，「流式」就没了，而且**不报错**。
- **非 2xx 不抛异常** —— 用 `getErrorStream()` 把错误正文也转发回去。页面靠它显示
  「为什么被拒」，丢了就只剩一句 `HTTP 400`。
- **`onHead` 先于正文** —— 状态行一到就让 `fetch` 的 Promise resolve，状态码立刻可读，
  不用等正文。

### `AiProxy` / `JsEvent` 为什么**不 import `android.*`**

这是整件事**能被验证**的前提：这两个类（连同 `Harness`）能在桌面 JVM 上直接编译运行，
所以 `tools/test-aiproxy/run.sh` 能用**真 javac + 真 JVM** 跑**同一份实现**，
而不是在测试里再抄一份近似品。`run.sh` 里那句 `[ "$NCLASS" -ge 4 ]` 就是这条性质的守门人 ——
一旦有人往这两个类里加了 `android.*` 的引用，它当场红。

### 白名单**只有一份实现**

`AiProxy.ALLOW_SUFFIX` 是唯一的域名清单（`aiplatform` / `oauth2` / `generativelanguage` /
`127.0.0.1` / `localhost`）。垫片不许自己抄一份 —— 抄了的话，改了 Java 忘了改 JS 的表现是
「请求被垫片接管了，却报『不在白名单』」。`verify.sh` 有一条断言盯着：
**垫片代码里不许出现任何 googleapis 域名**（只扫代码、不扫注释）。

### 「开源网关塞进 APK」那条路怎么插进来

接缝是**一个方法**：

```java
// AiProxy.java
public static String upstream(String url) {
    return url;                    // 默认：原样直连
    // 要转给本机网关（nodejs-mobile 之类）时，只改这一行：
    // return url.replace("https://aiplatform.googleapis.com", "http://127.0.0.1:4000");
}
```

页面侧一个字都不用改。**这正是「App 内原生转发」与「本机开源网关」能互为保底的原因 ——
两者的接缝是同一条，区别只在接缝下游换成谁。** 白名单里那两条 `127.0.0.1` / `localhost`
就是为这条路留的。

### 验证到什么程度

```bash
bash tools/test-aiproxy/run.sh      # 桌面契约测试：不要手机、不要模拟器、不要联网
python tools/reverse-ai.py          # 反向测试：证明 verify.sh 那一节的断言不是永远为真
```

`run.sh` 把这条链路**除 WebView 之外**全部真跑一遍：本地假上游 ← 真 `AiProxy`（真 JVM）
→ 真 `JsEvent` → 真垫片（Node），并做**往返比对**（服务器真发出去的字节 == 页面侧还原出的字节）。
覆盖到的：SSE 分 8 块、**切点落在一个多字节 UTF-8 字符中间**、非 2xx 的错误正文、
请求头/正文逐字节往返、`resp.json()`、白名单外的域名**确实走原始 fetch**、
非字符串 body 交回原始 fetch、以及三条失败路径（head 之前失败 / 正文中途断 / abort）。

`reverse-ai.py` 跑 5 根针，每根只改一处，然后比**整份输出的红行集合**：

| 针 | 改什么 | 期望 |
|---|---|---|
| ① | 只改仓库源、**不重建** | 恰好「逐字节一致」红；域名那条**保持绿**（证明它读的是 APK 里那份，不是仓库源） |
| ② | 域名清单写进仓库源的**代码**（重建） | 恰好「没有硬编码域名」红 |
| ③ | `aiAbort` → `aiCancel`（重建） | 恰好那条符号断言红 |
| ④ | `aiAbort` → `aiAbortZZZ`（重建） | **同样那一条红** —— 见下 |
| ⑤ | 往 `verify.sh` 的 `dex_strings()` 里插 `return None` | 恰好 7 条红，**负对照保持绿** |

> **针④ 有来历，值得单独说。** 那条断言原来写成 `b'aiAbort' in dex` —— 一个**子串**搜索。
> 针④ 第一次跑的时候**全绿**：把方法改名成 `aiAbortZZZ`，子串照样命中。
> 那不是「断言很严」，是**量错了对象** —— 它只能证明「dex 里有这么一段字节」，
> 不能证明「桥接方法的名字就是 `aiAbort`」。而垫片里 `native.aiAbort(...)` 是硬调的
> ⇒ 改了名**没有任何一层会报**，直到真机上「点停止没反应」。
> 据此把断言改成了解析 dex 的 `string_ids` 表、要求**整串相等**，针④ 于是从「量盲区」
> 升级成真反向测试。同一节里还配了一条**负对照**（不存在的类型描述符必须查不到）——
> 「查得到」这类断言必须配一条「不该查到的」才算数。

> 针⑤ 第一次跑也失败过，原因值得记：注入落进了 `if` 块里 ⇒ verify.sh 的内嵌 Python
> `IndentationError` ⇒ 脚本**静默早退** ⇒ **一条 ❌ 都没打印**。而「0 条红」和「全绿」
> 在红行集合上**完全一样** —— 差一点就拿到一个「反向测试很成功」的假结论。
> 现在 `expects()` 每次比对前都先问一句「verify.sh 跑到收尾行了吗」。

**没验证的（明写，别当成已验证）**：

1. **`evaluateJavascript` 的实际投递时序** —— 桌面测试是把字符串直接喂给垫片；
   真实 WebView 里它是异步投递到 JS 线程的。理论上没有顺序问题（同一线程、按调用顺序排队），
   但**没有实测**。
2. **真的连上 Google** —— 本机所有 `*.googleapis.com` 都被代理挡死（实测 `http=000`），
   连不出去。这条只能在能上外网的设备上验。
3. **没有真机 / 模拟器跑过** —— 本机没有 `platform-tools`、没有 `adb`、没有系统镜像。
   也就是说**「能装、能跑、能流式出字」还没有在设备上确认过**。

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
| **AI 转发只验到「除 WebView 之外」** | 桌面契约测试把 `AiProxy → JsEvent → 垫片` 全跑通了，但 **`evaluateJavascript` 的投递时序没实测**，而且本机 `*.googleapis.com` 全被代理挡死（`http=000`）⇒ **「真的能连上 Vertex AI」没有验证过**。详见「AI 跨域转发」最后一节。 |
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
