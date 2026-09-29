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
VER_NAME="1.0"

OUT="$HERE/build"
APK_DIR="$OUT/apk"
CLASSES="$OUT/classes"
DEX="$OUT/dex"
GEN="$OUT/gen"
ASSETS="$HERE/assets"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

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

# ---------- 1b. 字体 ----------
say "1b. 取字体"
# 产品里的 @font-face 用的是**相对路径** `./fonts/fusion-pixel-….ttf`。
# 页面跑在 https://appassets.androidplatform.net/ 上，所以相对路径会解析成
#   https://appassets.androidplatform.net/fonts/…
# 而 shouldInterceptRequest 会把** assets 下任意路径**都兜住 ⇒ 原样丢进 assets/fonts 即可，
# **产品源码一个字都不用改**，也不用给它换绝对路径。
FONTS_SRC="$ROOT/fonts"
[ -d "$FONTS_SRC" ] || { echo "❌ 找不到 $FONTS_SRC"; exit 1; }
rm -rf "$ASSETS/fonts"
mkdir -p "$ASSETS/fonts"
cp -R "$FONTS_SRC/." "$ASSETS/fonts/"
echo "   fonts/ → assets/fonts/  ($(find "$ASSETS/fonts" -type f | wc -l) 个文件, $(du -sh "$ASSETS/fonts" | cut -f1))"
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
PYBIN="${PYBIN:-/c/Users/YanSaki/.workbuddy-ai/binaries/python/envs/default/Scripts/python.exe}"
"$PYBIN" "$HERE/tools/add-dex.py" "$APK_DIR/base.apk" "$DEX/classes.dex"

# ---------- 7. 签名 ----------
say "7. 签名"
KS="$HERE/keystore/debug.jks"
if [ ! -e "$KS" ]; then
    echo "   生成 debug 密钥库（首次）"
    mkdir -p "$(dirname "$KS")"
    "$KEYTOOL" -genkeypair -v \
        -keystore "$KS" -storetype PKCS12 \
        -storepass android -keypass android \
        -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 \
        -dname "CN=Android Debug,O=Android,C=US" 2>&1 | tail -2 | sed 's/^/   /'
fi

"$BT/zipalign.exe" -p -f 4 "$APK_DIR/base.apk" "$OUT/aligned.apk"
"$BT/apksigner.bat" sign \
    --ks "$KS" --ks-pass pass:android --key-pass pass:android \
    --ks-key-alias androiddebugkey \
    --v1-signing-enabled true --v2-signing-enabled true \
    --out "$OUT/$PKG_NAME-$VER_NAME.apk" "$OUT/aligned.apk"

say "完成"
echo "   $OUT/$PKG_NAME-$VER_NAME.apk  ($(stat -c%s "$OUT/$PKG_NAME-$VER_NAME.apk") 字节)"
echo "   sha1 $(sha1sum "$OUT/$PKG_NAME-$VER_NAME.apk" | cut -d' ' -f1)"
