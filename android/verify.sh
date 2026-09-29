#!/usr/bin/env bash
# verify.sh —— **只读**。回答一个问题：这个 APK 真的能装、而且装的是我们要的那份页面吗？
#
# ⚠ 为什么 build.sh 绿了还不够：`aapt2 link` 成功只说明资源打包没报错，
#   不说明 classes.dex 进去了、不说明 assets 里是**当前**的页面、不说明签名有效。
#   这里逐条量，任何一条不过就非零退出。
#
# 用法：bash verify.sh [APK路径]     默认 build/YanSakiShed-1.0.apk

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APK="${1:-$HERE/build/YanSakiShed-1.0.apk}"
ANDROID_SDK="${ANDROID_SDK:-C:/Users/YanSaki/.workbuddy-ai/android-sdk}"
BT="$ANDROID_SDK/build-tools/34.0.0"
PYBIN="${PYBIN:-/c/Users/YanSaki/.workbuddy-ai/binaries/python/envs/default/Scripts/python.exe}"
JAVA_HOME="${JAVA_HOME:-C:/Program Files/Java/jdk-21}"
export JAVA_HOME

FAIL=0
chk() { if [ "$1" = "1" ]; then echo "   ✅ $2"; else echo "   ❌ $2"; FAIL=1; fi; }

[ -e "$APK" ] || { echo "❌ 找不到 $APK"; exit 1; }
echo "APK: $APK"
echo "     $(stat -c%s "$APK") 字节   sha1 $(sha1sum "$APK" | cut -d' ' -f1)"

# ---------- 1. 清单 ----------
echo
echo "== 1. 清单（aapt2 dump badging）=="
BADGING=$("$BT/aapt2.exe" dump badging "$APK" 2>&1)
echo "$BADGING" | grep -E "^(package|sdkVersion|targetSdkVersion|application-label|launchable-activity|uses-permission)" | sed 's/^/   /'
chk "$(echo "$BADGING" | grep -c "package: name='top.yansaki.shed' versionCode='1' versionName='1.0'" | sed 's/^0$/0/;s/^[1-9].*/1/')" "包名/版本正确"
chk "$(echo "$BADGING" | grep -q "sdkVersion:'29'" && echo 1 || echo 0)" "minSdk = 29"
chk "$(echo "$BADGING" | grep -q "targetSdkVersion:'34'" && echo 1 || echo 0)" "targetSdk = 34"
chk "$(echo "$BADGING" | grep -q "launchable-activity: name='top.yansaki.shed.MainActivity'" && echo 1 || echo 0)" "启动 Activity 存在"
chk "$(echo "$BADGING" | grep -q "mipmap-anydpi-v26/ic_launcher.xml" && echo 1 || echo 0)" "自适应图标已挂上"

# ---------- 2. 签名 ----------
echo
echo "== 2. 签名（apksigner verify）=="
# ⚠⚠ 这里必须显式给 `--min-sdk-version 23`。
#   不给的话 apksigner 会按 APK 自己的 minSdk(29) 去校验，而它**只校验该 minSdk 需要的方案**，
#   于是 v1/v2 一律打印 false —— 那不是「没签」，是「没查」。
#   我本轮就先被这个 false 骗过一次，以为签名方案没生效。
SIG=$("$BT/apksigner.bat" verify --verbose --min-sdk-version 23 "$APK" 2>&1 | grep -v "^WARNING")
echo "$SIG" | grep -E "Verifies|Verified using|Number of signers" | sed 's/^/   /'
chk "$(echo "$SIG" | grep -q "^Verifies" && echo 1 || echo 0)" "签名整体校验通过"
for s in v1 v2 v3; do
    chk "$(echo "$SIG" | grep -q "Verified using $s scheme.*: true" && echo 1 || echo 0)" "$s 方案有效"
done

# ---------- 3. 对齐 ----------
echo
echo "== 3. 对齐（zipalign -c 4）=="
# ⚠ 判据用**退出码**，不要去 grep 它那行人话 ——
#   zipalign 把 "successful" 印成了 "succesful"（少一个 s），
#   我第一版 grep "successful" 就因此把一次成功报成了失败。
AL=$("$BT/zipalign.exe" -c -v 4 "$APK" 2>&1)
AL_RC=$?
echo "$AL" | tail -1 | sed 's/^/   /'
chk "$([ "$AL_RC" -eq 0 ] && echo 1 || echo 0)" "4 字节对齐（zipalign 退出码 = $AL_RC）"

# ---------- 4. 内容 ----------
echo
echo "== 4. 内容（zip 条目 / dex / 页面字节）=="
"$PYBIN" - "$APK" "$HERE/../saki.html" <<'PY'
import hashlib, sys, zipfile
apk_path, src_path = sys.argv[1], sys.argv[2]
z = zipfile.ZipFile(apk_path)
names = z.namelist()
fail = 0

def chk(c, msg):
    global fail
    print('   %s %s' % ('✅' if c else '❌', msg))
    if not c: fail = 1

chk('AndroidManifest.xml' in names, 'AndroidManifest.xml 在')
chk('classes.dex' in names, 'classes.dex 在')
chk(names.count('classes.dex') == 1, 'classes.dex 只有一份')
chk('resources.arsc' in names, 'resources.arsc 在')
chk('assets/index.html' in names, 'assets/index.html 在')

# targetSdk 30+ 硬要求：resources.arsc 必须未压缩
if 'resources.arsc' in names:
    i = z.getinfo('resources.arsc')
    chk(i.compress_type == 0, 'resources.arsc 未压缩（targetSdk 30+ 硬要求）')

# 内嵌页面必须与产品原文逐字节相同 —— 否则「装的不是这一版」
if 'assets/index.html' in names and src_path:
    a = z.read('assets/index.html')
    try:
        b = open(src_path, 'rb').read()
    except OSError:
        b = None
    if b is None:
        print('   ⚠ 找不到 %s，跳过页面比对' % src_path)
    else:
        sa = hashlib.sha1(a).hexdigest()
        sb = hashlib.sha1(b).hexdigest()
        chk(a == b, '内嵌页面 == saki.html  (sha1 %s)' % sa)
        chk(b'\r\n' in a, 'CRLF 换行未被改动')

# dex 里必须真有我们的类与垫片
if 'classes.dex' in names:
    dex = z.read('classes.dex')
    chk(dex[:4] == b'dex\n', 'dex magic 正确 (%r)' % dex[:8])
    for s in (b'top/yansaki/shed/MainActivity', b'appassets.androidplatform.net',
              b'YanSakiNative', b'HTMLAnchorElement.prototype.click'):
        chk(s in dex, 'dex 含 %s' % s.decode())

sys.exit(fail)
PY
[ $? -ne 0 ] && FAIL=1

echo
if [ "$FAIL" -eq 0 ]; then
    echo "== 全部通过 =="
else
    echo "== ❌ 有检查项未通过 =="
fi
exit "$FAIL"
