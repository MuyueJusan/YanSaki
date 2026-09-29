#!/usr/bin/env bash
# build.sh —— 把「YanSaki的小屋」打成 APK。**不用 Gradle**。
#
# 为什么不用 Gradle：
#   ① 省 ~130MB 的 Gradle 发行包 + 它要拉的一大堆依赖（本机 C: 只剩 7G、G: 只剩 4G）；
#   ② 本机 java 是 24，AGP 对 JDK 有版本窗口，手工链路完全绕开这个不确定性；
#   ③ 这个 App 只有一个 Activity、零第三方依赖 —— 用不上构建系统的任何能力。
#
# 链路：aapt2 compile → aapt2 link → javac → d8 → 塞 classes.dex → zipalign → apksigner
#
# 用法：
#   bash build.sh                 # 产出 build/YanSakiShed-1.0.apk
#   ANDROID_SDK=... bash build.sh # 换 SDK 位置
#
# ⚠ 前置：页面正文来自仓库根的 ../saki.html（**不复制进仓库**，见 README）。
#   ⇒ 在 apk 分支上跑；页面一改，重跑本脚本即可，不会出现「两份 HTML 谁新」的问题。

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

ANDROID_SDK="${ANDROID_SDK:-C:/Users/YanSaki/.workbuddy-ai/android-sdk}"
BT="$ANDROID_SDK/build-tools/34.0.0"
ANDROID_JAR="$ANDROID_SDK/platforms/android-34/android.jar"

# ⚠⚠ javac **必须**用 JDK 11 或 17，**绝不能用 21+**。
#   实测（2026-09-29，本机）：JDK 21 / 24 的 javac 在 `-target 8` 下，对「带 this$0
#   合成外部引用的内部类」（也就是任何写在实例方法里的匿名类 / 非静态内部类）
#   会写出 d8 8.2.2 解析不了的 class 文件，d8 直接内部崩溃：
#       java.lang.NullPointerException: Cannot invoke "String.length()" because "<parameter1>" is null
#   同一份源码换 JDK 11 的 javac 编译，d8 一切正常。class 文件主版本号两边都是 52，
#   `-g:none` 也去不掉 ⇒ **看字节看不出来，只能靠 javac 版本**。
#   最小复现留在 build/mintest/MinTest2.java（build/ 不入库，用 `--repro` 重建）。
JAVAC_HOME="${JAVAC_HOME:-}"
if [ -z "$JAVAC_HOME" ]; then
    for cand in "C:/Program Files/Java/jdk-11" "C:/Program Files/Java/jdk-17" "C:/Program Files/Eclipse Adoptium/jdk-17"; do
        [ -x "$cand/bin/javac.exe" ] && { JAVAC_HOME="$cand"; break; }
    done
fi
# d8 / apksigner 是 .bat，靠 JAVA_HOME 找 java；R8 8.2.2 要 Java 11+，用 21 稳
JAVA_HOME="${JAVA_HOME:-C:/Program Files/Java/jdk-21}"
export JAVA_HOME
export PATH="$JAVA_HOME/bin:$PATH"

PKG_NAME="YanSakiShed"
# ⚠⚠ 版本号**从 AndroidManifest.xml 现读**（单一真相源），别在这儿再写一份。
#   写死两份就一定会分叉：这一轮把清单的 versionName 提到 1.2，而这里还写着 1.0
#   ⇒ 产出的包叫 `YanSakiShed-1.0.apk`、里面却是 1.2，Release 附件名跟版本对不上。
#   （那正是用户这次要修的那类问题：两个包顶着同一个版本号，只有 tag 能区分。）
# ⚠ 读不出来就当场退出，别拿空串去拼文件名（`YanSakiShed-.apk` 会一路签到最后才发现）
VER_NAME=$(grep -o 'android:versionName="[^"]*"' "$HERE/AndroidManifest.xml" | head -1 | sed 's/.*="//;s/"$//')
if [ -z "$VER_NAME" ]; then
    echo "❌ 从 $HERE/AndroidManifest.xml 读不出 android:versionName —— 拒绝拼一个空版本号的文件名"
    exit 1
fi
echo "版本（读自 AndroidManifest.xml）：$VER_NAME"

OUT="$HERE/build"
APK_DIR="$OUT/apk"
CLASSES="$OUT/classes"
DEX="$OUT/dex"
GEN="$OUT/gen"
ASSETS="$HERE/assets"

# ⚠ 提前到这里定义：第 1b 步（挑字体）就要用它，而它原来定义在第 5 步旁边。
PYBIN="${PYBIN:-/c/Users/YanSaki/.workbuddy-ai/binaries/python/envs/default/Scripts/python.exe}"
[ -x "$PYBIN" ] || { echo "❌ 找不到 python：$PYBIN（设 PYBIN=... 指过来）"; exit 1; }

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

# ---------- 0a. 清掉上一版留下的 APK ----------
# ⚠⚠ 版本号一提，输出文件名就变了（`$PKG_NAME-$VER_NAME.apk`），上一版那个**不会自己消失**
#   ⇒ build/ 里同时躺着两个包。而「留两份就一定有一份是错的」：核对 sha1 时拿错一份、
#   Release 传错一份，都是这么来的。build/ 是纯生成物（gitignore 里就是它），
#   所以这里删得理直气壮 —— 只删**本目录下、名字带本应用前缀**的那些。
# ⚠ 用 glob 而不是 `ls | while`：没匹配时 glob 保持字面量，`[ -e ]` 挡掉即可，
#   不必靠 `ls ... || true`（那玩意儿在 `set -o pipefail` 下容易咬到自己）
for f in "$OUT/$PKG_NAME-"*.apk; do
    [ -e "$f" ] || continue
    echo "   清掉上一版产物：$(basename "$f")"
    rm -f "$f"
done

# ---------- 0. 检查工具 ----------
say "0. 检查工具链"
for f in "$BT/aapt2.exe" "$BT/d8.bat" "$BT/zipalign.exe" "$BT/apksigner.bat" "$ANDROID_JAR"; do
    [ -e "$f" ] || { echo "❌ 缺：$f"; exit 1; }
done
JAVAC="$JAVAC_HOME/bin/javac.exe"
JAR_TOOL="$JAVAC_HOME/bin/jar.exe"
KEYTOOL="$JAVA_HOME/bin/keytool.exe"
[ -e "$JAVAC" ] || { echo "❌ 缺 javac：$JAVAC"; exit 1; }
echo "   SDK      = $ANDROID_SDK"
echo "   javac    = $JAVAC_HOME   （⚠ 必须 11/17，21+ 会让 d8 崩，见文件头）"
echo "   工具 JRE = $JAVA_HOME"
"$JAVAC" -version 2>&1 | sed 's/^/   /'

# ---------- 1. 页面 ----------
say "1. 取页面正文"
mkdir -p "$ASSETS"
SRC_HTML="$ROOT/saki.html"
[ -e "$SRC_HTML" ] || { echo "❌ 找不到 $SRC_HTML（本脚本要在 apk 分支上跑）"; exit 1; }
cp -f "$SRC_HTML" "$ASSETS/index.html"
echo "   saki.html → assets/index.html  ($(stat -c%s "$ASSETS/index.html") 字节)"
# ⚠ 不重编码、不转换行尾 —— 产品的 CRLF 要原样带过去

# ---------- 1a. AI 转发垫片 ----------
say "1a. 取 AI 转发垫片"
# ⚠ 垫片放 shim/ 而不是直接放 assets/：assets/ 是生成物（已 gitignore），
#   源文件必须待在仓库里。这里拷进去，MainActivity 再从 assets 读出来注入。
SHIM_SRC="$HERE/shim/ai-fetch-shim.js"
[ -e "$SHIM_SRC" ] || { echo "❌ 找不到 $SHIM_SRC"; exit 1; }
cp -f "$SHIM_SRC" "$ASSETS/ys-ai-shim.js"
echo "   shim/ai-fetch-shim.js → assets/ys-ai-shim.js  ($(stat -c%s "$ASSETS/ys-ai-shim.js") 字节)"
# ⚠ 顺手做一次语法检查。垫片是注入到页面里的，语法错了表现是
#   「页面上什么都没发生」，而 evaluateJavascript 的报错只进 logcat，非常难查。
if command -v node >/dev/null 2>&1; then
    node --check "$ASSETS/ys-ai-shim.js" && echo "   node --check 通过"
fi

# ---------- 1b. 字体 ----------
say "1b. 取字体"
# 产品里的 @font-face 用的是**相对路径** `./fonts/fusion-pixel-….ttf`。
# 页面跑在 https://appassets.androidplatform.net/ 上，所以相对路径会解析成
#   https://appassets.androidplatform.net/fonts/…
# 而 shouldInterceptRequest 会把** assets 下任意路径**都兜住 ⇒ 原样丢进 assets/fonts 即可，
# **产品源码一个字都不用改**，也不用给它换绝对路径。
FONTS_SRC="$ROOT/fonts"
[ -d "$FONTS_SRC" ] || { echo "❌ 找不到 $FONTS_SRC"; exit 1; }

# ⚠⚠ 只拷**页面真的引用到的**那些，不是整个 ../fonts。
#   `../fonts` 一共 5 个文件 13MB，而页面只引用 1 个（7MB）—— 另外 4 个（3 667 028 字节）
#   全仓库任何地方都没引用过，其中 `myFont.ttf` 与 `ttf/Cubic_11_1.100_R.ttf` 还是
#   **同一份文件的两个副本**（crc32 都是 733b9c8b）。整个拷进去 = APK 白胖 3.5MB。
#   （用户 2026-09-29 明确选了「只装页面真正引用的那 1 个」。）
#
# ⚠⚠ 清单**从页面正文里抽**，不写死 —— 与 verify.sh 调的是**同一个脚本**
#   （`tools/pick-fonts.py`），所以那条正则只有**一份实现**。
#   各写一份的话，改了一处忘了另一处，表现是「构建挑的是 A、验证核的是 B」——
#   两边都绿，而装进 APK 的是别的东西。
#   ⚠ 脚本自己会在两种情况下非零退出并说明原因：① 一个引用都抽不到；
#     ② 页面引用了某个字体但源文件不存在。**这两种失败在手机上都是静默的**
#     （只表现为「字体悄悄退化成系统字体」），所以必须在这里就拦住。
FONT_LIST=$("$PYBIN" "$HERE/tools/pick-fonts.py" "$ROOT/saki.html" "$FONTS_SRC") \
    || { echo "❌ 挑字体失败（原因见上）—— 不会出一个没有字体的 APK"; exit 1; }

rm -rf "$ASSETS/fonts"
mkdir -p "$ASSETS/fonts"
NFONT=0
while IFS= read -r rel; do
    [ -n "$rel" ] || continue
    src="$FONTS_SRC/${rel#fonts/}"
    mkdir -p "$(dirname "$ASSETS/$rel")"
    cp -f "$src" "$ASSETS/$rel"
    NFONT=$((NFONT + 1))
done <<< "$FONT_LIST"
echo "   fonts/ → assets/fonts/  ($NFONT 个文件, $(du -sh "$ASSETS/fonts" | cut -f1))"
find "$ASSETS/fonts" -type f | sed "s|$ASSETS/|     |" | sort

# ---------- 2. 资源 ----------
say "2. aapt2 compile"
rm -rf "$OUT"; mkdir -p "$APK_DIR" "$CLASSES" "$DEX" "$GEN"
"$BT/aapt2.exe" compile --dir "$HERE/res" -o "$OUT/res.zip"
echo "   res.zip = $(stat -c%s "$OUT/res.zip") 字节"

# ---------- 3. 链接（生成带资源与 assets 的 APK 骨架 + R.java）----------
say "3. aapt2 link"
"$BT/aapt2.exe" link \
    -o "$APK_DIR/base.apk" \
    -I "$ANDROID_JAR" \
    --manifest "$HERE/AndroidManifest.xml" \
    -R "$OUT/res.zip" \
    -A "$ASSETS" \
    --java "$GEN" \
    --min-sdk-version 29 \
    --target-sdk-version 34 \
    --auto-add-overlay
echo "   base.apk = $(stat -c%s "$APK_DIR/base.apk") 字节"
find "$GEN" -name '*.java' | sed 's/^/   /'

# ---------- 4. javac ----------
say "4. javac"
# ⚠ 用 -source/-target 8 而**不是** --release 8：--release 会把 bootclasspath 换成 JDK 自己的，
#   我们要的是对着 android.jar 编译。d8 对 class 文件版本 52 支持最稳。
SRCS=$(find "$HERE/src" "$GEN" -name '*.java')
"$JAVAC" -source 8 -target 8 -nowarn -encoding UTF-8 \
    -bootclasspath "$ANDROID_JAR" \
    -d "$CLASSES" $SRCS 2>&1 | grep -v "^注:" || true

# ⚠⚠ 数一遍 class 文件。这不是形式主义：javac 编译失败时**仍然**退出 0（上面的 `|| true`），
#   而 d8 对**空 jar** 会「成功」产出 —— 于是整条链路一片绿，装出来的 APK 里没有代码。
#   这个假绿我本轮真踩了一次（拿它得出过「-target 11 可以」的错误结论）。
NCLASS=$(find "$CLASSES" -name '*.class' | wc -l)
echo "   class 文件 $NCLASS 个"
[ "$NCLASS" -ge 3 ] || { echo "❌ class 文件太少（$NCLASS）—— javac 大概失败了，见上面输出"; exit 1; }
find "$CLASSES" -name '*.class' | sed 's|.*/||' | sed 's/^/      /'

# ---------- 5. d8 ----------
say "5. d8 → classes.dex"
# 先打成一个 jar 再喂给 d8：Windows 命令行有长度上限，几百个 .class 直接铺开会炸
( cd "$CLASSES" && "$JAR_TOOL" cf "$OUT/classes.jar" . )
echo "   classes.jar = $(stat -c%s "$OUT/classes.jar") 字节"
"$BT/d8.bat" --lib "$ANDROID_JAR" --min-api 29 --output "$DEX" "$OUT/classes.jar" 2>&1 | sed 's/^/   /'
[ -e "$DEX/classes.dex" ] || { echo "❌ d8 没产出 classes.dex"; exit 1; }
echo "   classes.dex = $(stat -c%s "$DEX/classes.dex") 字节"

# ---------- 6. 把 dex 塞进 APK ----------
say "6. 装入 classes.dex 并自查"
# ⚠ 本机没有 `zip` 命令（Git Bash 自带 unzip 却没带 zip）⇒ 走 tools/add-dex.py。
#   它用 ZipFile 的追加模式，已有条目字节原样不动，并**当场验** resources.arsc 没被重压；
#   验不过就非零退出，不产出半成品 APK。
#   （PYBIN 定义在第 0 步之前的变量区 —— 第 1b 步也要用。）
"$PYBIN" "$HERE/tools/add-dex.py" "$APK_DIR/base.apk" "$DEX/classes.dex"

# ---------- 7. 签名 ----------
say "7. 签名"
# ⚠⚠ 签名身份 = App 的身份。**换密钥 ⇒ 证书 SHA-256 变了 ⇒ 新旧包不是同一个 App**，
#   手机上装过旧版的必须先卸载才能装新的（INSTALL_FAILED_UPDATE_INCOMPATIBLE）。
#   ⇒ 所以判据不在这儿，而在 `verify.sh` 那条「APK 的签名者证书 == 密钥库里的那张证书」。
#
# ⚠⚠ 密钥与口令**都不进仓库**（本仓库公开）：
#   密钥 → `android/keystore/*.jks`（.gitignore 挡住，只放行口令公开的 `debug.jks`）
#   口令 → `android/keystore/signing.env`（同样被挡）；空模板见 `signing.env.example`
KS_DIR="$HERE/keystore"
if [ -f "$KS_DIR/signing.env" ]; then
    # shellcheck disable=SC1091
    . "$KS_DIR/signing.env"
fi

# ⚠⚠ 一律写 `${VAR:-}`：本脚本开着 `set -u`，直接引未设的变量会**当场崩**，
#   而不是走到下面的回落分支 —— 那会把「没配密钥」伪装成「脚本有 bug」。
if [ -n "${YS_KS_FILE:-}" ]; then
    # 绝对路径原样用；否则当成本目录下的文件名
    case "$YS_KS_FILE" in
        /*|[A-Za-z]:[\\/]*) KS="$YS_KS_FILE" ;;
        *)                 KS="$KS_DIR/$YS_KS_FILE" ;;
    esac
    [ -e "$KS" ] || { echo "❌ signing.env 的 YS_KS_FILE 指向不存在的文件：$KS"; exit 1; }
    # ⚠ 这三条**必须**在，缺一个就拒绝构建。
    #   静默退回 debug 密钥是这里最坏的失败方式：包照样打出来、照样能装，
    #   只是**签名身份悄悄换了一个** —— 而「装不上去」这件事要到手机上才发现。
    [ -n "${YS_KS_ALIAS:-}" ] || { echo "❌ signing.env 里没写 YS_KS_ALIAS"; exit 1; }
    [ -n "${YS_KS_PASS:-}" ]  || { echo "❌ signing.env 里没写 YS_KS_PASS"; exit 1; }
    # ⚠ 口令走**环境变量**（apksigner 的 `env:` 形式），不走 argv：
    #   `pass:xxx` 会把口令明文放进进程参数表，同机任何进程都读得到。
    export YS_KS_PASS
    export YS_KEY_PASS="${YS_KEY_PASS:-$YS_KS_PASS}"
    echo "   密钥库：$KS"
    echo "   别名  ：$YS_KS_ALIAS"
else
    echo "   ⚠⚠ 没有 signing.env ⇒ 退回 **debug 密钥**（口令是公开的 android）"
    echo "      打出来的包签名身份与正式版**不同**，自己测可以，别往外发"
    KS="$KS_DIR/debug.jks"
    if [ ! -e "$KS" ]; then
        echo "   生成 debug 密钥库（首次）"
        mkdir -p "$(dirname "$KS")"
        "$KEYTOOL" -genkeypair -v \
            -keystore "$KS" -storetype PKCS12 \
            -storepass android -keypass android \
            -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 \
            -dname "CN=Android Debug,O=Android,C=US" 2>&1 | tail -2 | sed 's/^/   /'
    fi
    YS_KS_ALIAS="androiddebugkey"
    export YS_KS_PASS="android"
    export YS_KEY_PASS="android"
fi

"$BT/zipalign.exe" -p -f 4 "$APK_DIR/base.apk" "$OUT/aligned.apk"
"$BT/apksigner.bat" sign \
    --ks "$KS" --ks-pass env:YS_KS_PASS --key-pass env:YS_KEY_PASS \
    --ks-key-alias "$YS_KS_ALIAS" \
    --v1-signing-enabled true --v2-signing-enabled true \
    --out "$OUT/$PKG_NAME-$VER_NAME.apk" "$OUT/aligned.apk"

say "完成"
echo "   $OUT/$PKG_NAME-$VER_NAME.apk  ($(stat -c%s "$OUT/$PKG_NAME-$VER_NAME.apk") 字节)"
echo "   sha1 $(sha1sum "$OUT/$PKG_NAME-$VER_NAME.apk" | cut -d' ' -f1)"
