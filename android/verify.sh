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
echo "== 4. 内容（zip 条目 / dex / 页面字节 / 字体）=="
"$PYBIN" - "$APK" "$HERE/../saki.html" "$HERE/../fonts" <<'PY'
import hashlib, os, re, struct, sys, zipfile
apk_path, src_path, fonts_dir = sys.argv[1], sys.argv[2], sys.argv[3]
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
html = None
if 'assets/index.html' in names and src_path:
    a = z.read('assets/index.html')
    html = a
    try:
        b = open(src_path, 'rb').read()
    except OSError:
        b = None
    if b is None:
        print('   ⚠ 找不到 %s，跳过页面比对' % src_path)
    else:
        chk(a == b, '内嵌页面 == saki.html  (sha1 %s)' % hashlib.sha1(a).hexdigest())
        chk(b'\r\n' in a, 'CRLF 换行未被改动')

# dex 里必须真有我们的类与垫片
if 'classes.dex' in names:
    dex = z.read('classes.dex')
    chk(dex[:4] == b'dex\n', 'dex magic 正确 (%r)' % dex[:8])
    for s in (b'top/yansaki/shed/MainActivity', b'appassets.androidplatform.net',
              b'YanSakiNative', b'HTMLAnchorElement.prototype.click'):
        chk(s in dex, 'dex 含 %s' % s.decode())

# ---- 字体 ----
# ⚠⚠ 这里**故意不写死字体清单**。写死了就有两个后果：
#   ① 产品里改了 @font-face 的路径，验证脚本不会红（它只认自己那份清单）；
#   ② 清单要人肉维护，迟早漂。
#   正确做法是**从页面正文里把引用的字体路径抽出来**，再逐条问「APK 里有没有它」。
#   这样「CSS 说要用的字体」和「真的装进去的字体」之间不可能出现缝。
if html is not None:
    refs = sorted(set(re.findall(rb'url\(\s*[\'"]?\.?/?(fonts/[^\'")]+)', html)))
    print('   --- 页面引用的字体 %d 条（从 HTML 里抽的，不是写死的清单）---' % len(refs))
    for r in refs:
        p = r.decode('utf-8', 'replace')
        chk('assets/' + p in names, 'APK 里有 assets/%s' % p)

    # 逐字节比对：抽出来的每一条都要和仓库里的源文件一致
    if fonts_dir and os.path.isdir(fonts_dir):
        for r in refs:
            p = r.decode('utf-8', 'replace')
            if 'assets/' + p not in names:
                continue
            srcf = os.path.join(fonts_dir, p[len('fonts/'):])
            if not os.path.exists(srcf):
                chk(False, '仓库里找不到 %s（页面引用了但它不在 fonts/ 里）' % srcf)
                continue
            same = z.read('assets/' + p) == open(srcf, 'rb').read()
            chk(same, '%s 与仓库源文件逐字节一致 (%d 字节)' % (p, os.path.getsize(srcf)))

    # 顺带报一下「装了但页面没引用」的，方便判断能不能瘦身
    packed = sorted(n for n in names if n.startswith('assets/fonts/'))
    unused = [n for n in packed if n[len('assets/'):] not in {r.decode() for r in refs}]
    if unused:
        print('   ℹ️  装了但页面没引用（可考虑删掉瘦身）：')
        for n in unused:
            print('        %-58s %8d 字节' % (n, z.getinfo(n).file_size))

# ---- zip 结构：本地文件头里的名字必须与中央目录里的名字逐字节一致 ----
# ⚠⚠ 这条不是吹毛求疵，是**本轮花了很久才查清的一个假警报的判据**。
#   aapt2 在 Windows 上给**带子目录的资产**写本地文件头(LFH)时，路径用的是平台分隔符 `\`，
#   而中央目录(CD)里是 `/`。zipalign 的 ZipEntry::compareHeaders() 最后一条就是
#   `strcmp(CD 名字, LFH 名字)`，于是每一条这样的资产都打一行
#   `zip W …] WARNING: header mismatch` —— 本轮 5 个字体正好 5 行。
#   `assets/index.html` 没有分隔符，所以加字体之前从来没报过。
#   ⚠ 关键：zipalign 是**从中央目录重建本地头**的，所以它顺手把反斜杠归一了 ——
#     它只打警告、退出码照样是 0，**它的输出是干净的**（实测 base.apk 5 条 → aligned.apk 0 条）。
#   ⇒ 所以判据必须落在**出货的那一份**上，而不是「有没有警告」。
#   ⇒ 也解释了为什么不能只看 build.sh 的退出码：警告会被淹没在滚动输出里。
raw = open(apk_path, 'rb').read()
eocd = raw.rfind(b'PK\x05\x06')
n_ent, cd_size, cd_off = struct.unpack('<HII', raw[eocd + 10:eocd + 20])
bad = []
p = cd_off
for _ in range(n_ent):
    nl, el, cl = struct.unpack('<HHH', raw[p + 28:p + 34])
    lho = struct.unpack('<I', raw[p + 42:p + 46])[0]
    cname = raw[p + 46:p + 46 + nl]
    lname = raw[lho + 30:lho + 30 + nl]
    if cname != lname:
        bad.append((cname.decode('utf-8', 'replace'), lname.decode('utf-8', 'replace')))
    p += 46 + nl + el + cl
chk(n_ent == len(names), '中央目录项数(%d) == zipfile 读到的项数(%d)' % (n_ent, len(names)))
chk(not bad, '每个条目的本地头名字都与中央目录逐字节一致（不一致会让 zipalign 报 header mismatch）')
for a, b in bad[:10]:
    print('        CD=%r  LFH=%r' % (a, b))

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
