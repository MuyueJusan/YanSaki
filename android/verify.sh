#!/usr/bin/env bash
# verify.sh —— **只读**。回答一个问题：这个 APK 真的能装、而且装的是我们要的那份页面吗？
#
# ⚠ 为什么 build.sh 绿了还不够：`aapt2 link` 成功只说明资源打包没报错，
#   不说明 classes.dex 进去了、不说明 assets 里是**当前**的页面、不说明签名有效。
#   这里逐条量，任何一条不过就非零退出。
#
# 用法：bash verify.sh [APK路径]
#      默认 = `build/YanSakiShed-<versionName>.apk`，版本号**从 AndroidManifest.xml 现读**
#      （写死过一次 1.0，提版本那天就会报「找不到 APK」—— 而那是断言过时，不是产品坏了）

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# ⚠ 读不出来就**当场退出**，别退回一个写死的旧名字 ——
#   那样提完版本它会说「找不到 YanSakiShed-1.0.apk」，
#   看起来像「构建没产出」，其实是这一行过时了
_VER=$(grep -o 'android:versionName="[^"]*"' "$HERE/AndroidManifest.xml" | head -1 | sed 's/.*="//;s/"$//')
if [ -z "$_VER" ]; then
    echo "❌ 从 $HERE/AndroidManifest.xml 读不出 android:versionName —— 不知道默认该验哪个 APK"
    exit 1
fi
APK="${1:-$HERE/build/YanSakiShed-$_VER.apk}"
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
# ⚠⚠ 版本号**从 AndroidManifest.xml 现读**，不要写死在这句里。
#   写死的话每次提版本都会来收账：这一轮把 1.0 提到 1.2，那句写死的断言会报
#   「包名/版本正确」失败 —— 而失败原因是**断言自己过时了**，不是产品坏了。
#   「过时断言」是「永真断言」的镜像：一个是永远红、一个是永远绿，
#   但都会让人不再看它（RULES 六之四十八）。
# ⚠ 读不出来就**当场退出**，别拿空串去比 —— 那样这条会永远红，
#   而红久了没人看，等于没有（同一类「把失败伪装成别的东西」）。
VC=$(grep -o 'android:versionCode="[0-9]*"' "$HERE/AndroidManifest.xml" | head -1 | grep -o '[0-9]*')
VN=$(grep -o 'android:versionName="[^"]*"' "$HERE/AndroidManifest.xml" | head -1 | sed 's/.*="//;s/"$//')
if [ -z "$VC" ] || [ -z "$VN" ]; then
    echo "❌ 从 $HERE/AndroidManifest.xml 读不出 versionCode / versionName —— 拒绝用空串去比"
    exit 1
fi
echo "   清单声明：versionCode=$VC  versionName=$VN"
chk "$(echo "$BADGING" | grep -q "package: name='top.yansaki.shed' versionCode='$VC' versionName='$VN'" && echo 1 || echo 0)" \
    "包名/版本正确（与 AndroidManifest.xml 一致：$VC / $VN）"
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

# ---------- 2b. 签名**身份**：不只是「签了」，而是「**谁**签的」 ----------
# ⚠⚠ 上面那几条只证明「签名方案有效」—— **用任何一张证书签都有效**。
#   而签名身份 = App 的身份：签错钥匙的包照样「校验通过」，只是
#   **装不上任何已经装过旧版的手机**（INSTALL_FAILED_UPDATE_INCOMPATIBLE），
#   而且这件事**只有到手机上才会发现**。
#   ⇒ 判据 = 「APK 的签名者证书 == 我们配置的那个密钥库里的证书」（往返判据，
#     不是「签名成功」这种从上传/构建那一侧看不出来的东西）。
echo
echo "== 2b. 签名身份（APK 的签名者 vs 密钥库里的证书）=="
# ⚠ 期望值**从密钥库现读**，不写死 —— 写死就成了「过时断言」：
#   换密钥时忘了改它，套件会一直红（或更糟：红久了没人看）。指纹的唯一真相源是密钥库。
# ⚠ 口令来源与 build.sh **同一处**（keystore/signing.env），否则两边会分叉。
KS_DIR="$HERE/keystore"
if [ -f "$KS_DIR/signing.env" ]; then . "$KS_DIR/signing.env"; fi
if [ -n "${YS_KS_FILE:-}" ]; then
    case "$YS_KS_FILE" in
        /*|[A-Za-z]:[\\/]*) KS="$YS_KS_FILE" ;;
        *)                 KS="$KS_DIR/$YS_KS_FILE" ;;
    esac
    ALIAS="${YS_KS_ALIAS:-}"
    export YS_KS_PASS="${YS_KS_PASS:-}"
    echo "   密钥库：$KS   （别名 ${ALIAS:-未指定}）"
else
    KS="$KS_DIR/debug.jks"
    ALIAS="androiddebugkey"
    export YS_KS_PASS="android"
    echo "   ⚠ 没有 signing.env ⇒ 按 **debug 密钥**核对（口令是公开的 android）"
fi

# ⚠ `-J-Duser.language=en` 不能省：keytool 的输出**跟着 locale 走**
#   （中文环境下打「所有者:」而不是「Owner:」）⇒ 不加它，下面的 grep 会**静默取到空**。
# ⚠ 口令走 `-storepass:env`（不进 argv）。keytool 自 Java 9 起支持这个形式。
KT_ARGS=(-J-Duser.language=en -list -v -keystore "$KS" -storepass:env YS_KS_PASS)
# ⚠ 写成 `if` 而不是 `[ -n "$ALIAS" ] && KT_ARGS+=(...)`：
#   两者**功能等价** —— 别搞错方向：`set -e` **不**因为 `[ ]` 为假就中止脚本
#   （POSIX：`-e` 对 AND-OR 列表里「非最后一项」的命令失效；实测 `false && echo A; echo B`
#    照样打印 B、rc=0）。真正的尾巴是：这条 `[ ] &&` 若成为**脚本/函数的最后一条语句**，
#   整个列表返回 1 ⇒ **退出码变成失败**（假红）。
#   写成 `if` 就不用让每个读者都记住「豁免只对非最后一项生效」这条冷知识。
if [ -n "$ALIAS" ]; then KT_ARGS+=(-alias "$ALIAS"); fi
WANT=$("$JAVA_HOME/bin/keytool.exe" "${KT_ARGS[@]}" 2>/dev/null \
       | grep -m1 "SHA256:" | awk '{print $2}' | tr -d ':\r' | tr 'A-Z' 'a-z')
GOT=$("$BT/apksigner.bat" verify --print-certs "$APK" 2>/dev/null \
      | grep -m1 "certificate SHA-256 digest" | awk '{print $NF}' | tr -d ':\r' | tr 'A-Z' 'a-z')

# ⚠⚠ 两个读数都**先断言形状**（64 位十六进制）再比。
#   不这么做的话，「两边都解析失败」⇒ 空串 == 空串 ⇒ **绿** ——
#   而那是永真断言：换密钥、改 keytool 输出格式、甚至把密钥库删了，它都不会红。
#   （同族：RULES 六之三十九「`.every()` 对空数组有定义好的返回值」）
is_fp() { [ "$(printf '%s' "$1" | grep -cE '^[0-9a-f]{64}$')" = "1" ]; }
chk "$(is_fp "$WANT" && echo 1 || echo 0)" "从密钥库读出的指纹形状合法（${WANT:-空}）"
chk "$(is_fp "$GOT"  && echo 1 || echo 0)" "从 APK 读出的指纹形状合法（${GOT:-空}）"
chk "$(is_fp "$WANT" && [ "$WANT" = "$GOT" ] && echo 1 || echo 0)" "APK 的签名者 == 密钥库里的那张证书"

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
"$PYBIN" - "$APK" "$HERE/../saki.html" "$HERE/../fonts" "$HERE/shim/ai-fetch-shim.js" <<'PY'
import hashlib, os, re, struct, sys, zipfile
apk_path, src_path, fonts_dir, shim_path = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
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
    # ⚠⚠ 清单用**与 build.sh 同一个脚本**抽（`tools/pick-fonts.py`），这里不再写一遍正则。
    #   两份实现的话，改了一处忘了另一处 ⇒「构建挑的是 A、验证核的是 B」，
    #   两边都绿，而装进 APK 的是别的东西。
    #   `--list-only` = 只要清单、不要它那两道闸门（闸门在 build.sh 那边，
    #   这里的报告更细：逐条说「APK 里有没有」「与源文件一不一致」）。
    #   HTML 走 stdin —— 用的是 **APK 里那一份**，与上面那条「内嵌页面 == saki.html」
    #   是同一批字节，所以「抽出来的清单」和「实际会渲染的 CSS」不会错位。
    import subprocess
    _picker = os.path.join(os.path.dirname(os.path.dirname(shim_path)), 'tools', 'pick-fonts.py')
    _pr = subprocess.run([sys.executable, _picker, '--list-only', '-', fonts_dir or '.'],
                         input=html, capture_output=True)
    chk(_pr.returncode == 0, '用 tools/pick-fonts.py 抽字体清单（rc=%d）' % _pr.returncode)
    refs = [l.encode('utf-8') for l in _pr.stdout.decode('utf-8').splitlines() if l.strip()]
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
        tot_u = tot_c = 0
        for n in unused:
            i = z.getinfo(n)
            tot_u += i.file_size
            tot_c += i.compress_size
            print('        %-58s %8d 字节' % (n, i.file_size))
        # ⚠ 合计**算出来**，不写死。
        #   README 里原来那句「合计 3 667 028 字节」就是写死的，而正确值是 6 577 028
        #   （4 个文件的未压缩之和）—— 写死的数字不会自己更正，也没人会去核。
        print('        合计 %d 字节未压缩 / %d 字节在 APK 里（含已压缩的）' % (tot_u, tot_c))

# ---- AI 跨域转发（垫片 + 原生转发核心）----
# 这一节回答的问题是：「APK 里真的带着那套能让页面直连 Vertex AI 的东西吗？」
# 它**不**回答「真的能连上 Google」—— 本机连不上（所有 *.googleapis.com 都被代理挡死），
# 那件事只能在能上外网的手机上验。这里只保证**东西装进去了、而且是仓库里那一份**。
print('   --- AI 跨域转发 ---')
SHIM_ASSET = 'assets/ys-ai-shim.js'
chk(SHIM_ASSET in names, 'APK 里有 %s' % SHIM_ASSET)
if SHIM_ASSET in names and shim_path and os.path.exists(shim_path):
    a = z.read(SHIM_ASSET)
    b = open(shim_path, 'rb').read()
    chk(a == b, '垫片与仓库源文件逐字节一致 (%d 字节)' % len(b))
    # ⚠ 白名单**只能有一份实现**（AiProxy.ALLOW_SUFFIX）。
    #   垫片要是自己又抄一份域名清单，改了 Java 忘了改 JS 的表现是
    #   「请求被垫片接管了，却报『不在白名单』」—— 能查，但纯属自找。
    #   所以这里做一条「不该发生」的对照：垫片里不许出现任何 googleapis 域名。
    # ⚠ 只扫**代码**，不扫注释。
    #   垫片的注释里**正当**地提到了 *.googleapis.com（解释「本机连不上 Google」这件事）。
    #   第一版没去注释，于是这条断言第一次跑就报了个假红：实得 ['.googleapis.com'] ——
    #   那不是域名清单，是注释里的一个词。
    #   这个去注释是**文本级**的：垫片里没有含 `//` 的字符串字面量，
    #   所以不存在「把字符串里的 // 当成注释、把后面的代码整段吃掉」这种误伤。
    code = re.sub(rb'/\*.*?\*/', b'', a, flags=re.S)
    code = re.sub(rb'//[^\n]*', b'', code)
    hosts = re.findall(rb'[a-z0-9.-]*googleapis\.com', code)
    chk(not hosts,
        '垫片代码里没有硬编码的 googleapis 域名（白名单只有 AiProxy 一份实现）'
        + ('' if not hosts else '，实得 %r' % sorted(set(h.decode() for h in hosts))))
    chk(b'aiAllowed' in a, '垫片是通过 aiAllowed() 问原生的')

def dex_strings(d):
    """把 dex 的 string_ids 表整个读出来，返回 set；解析不动就返回 None。

    ⚠ 为什么要费这个劲：`b'aiAbort' in dex` 是**子串**搜索，
       把桥接方法改名成 `aiAbortZZZ` 它**照样绿** —— 反向测试 tools/reverse-ai.py 的
       针④ 实测过。而垫片里 `native.aiAbort(...)` 是硬调的 ⇒ 改了名**没有任何一层会报**，
       直到真机上「点停止没反应」。所以这里要比**整串**。
    """
    try:
        if not d.startswith(b'dex\n'):
            return None
        n, off = struct.unpack('<II', d[56:64])          # string_ids_size / _off
        if not (0 < n < 200000 and 0 < off < len(d)):
            return None
        out = set()
        for i in range(n):
            p = struct.unpack('<I', d[off + 4 * i:off + 4 * i + 4])[0]
            if not (0 < p < len(d)):
                return None
            while p < len(d) and d[p] & 0x80:            # uleb128 utf16_size
                p += 1
            p += 1
            e = d.find(b'\x00', p)                       # MUTF-8 里 U+0000 是 C0 80，不会早停
            if e < 0:
                return None
            out.add(d[p:e])
        return out
    except Exception:
        return None


if 'classes.dex' in names:
    dex = z.read('classes.dex')
    # ⚠ 「子串命中」和「符号就叫这个」是两件事，分两档写，别让弱断言混进强断言里。
    #   方法名与类型描述符在 dex 字符串表里是**整串**存的 ⇒ 要求精确匹配。
    strs = dex_strings(dex)
    chk(strs is not None and len(strs) > 100,
        'dex 字符串表解析成功（%s 条）' % (len(strs) if strs else 'None'))
    if not strs:
        # ⚠ 解析失败**不跳过**下面几条，而是让它们全部红出声。
        #   `if strs:` 那种写法会让解析器坏掉时下面几条**静默消失** ——
        #   输出上「红 1 条」和「红 6 条」都是红，但前者看着像「只坏了一点点」，
        #   实际上「下面几条压根没被检查」这件事被藏起来了。
        strs = set()
    # 两条**对照**：一条正的（证明解析器真的在读 dex，不是返回空集/垃圾），
    # 一条负的（证明它不是一个「查什么都有」的容器）。
    # ⚠ 记忆里的规矩：说「发生了」必须配一条「不该发生」的 —— 否则这条断言
    #   可能**永远为真**，而永远为真的绿不是证据。
    chk(b'Ltop/yansaki/shed/MainActivity;' in strs,
        '对照：字符串表里查得到 MainActivity（解析器真的在读 dex）')
    chk(b'Ltop/yansaki/shed/NoSuchClassZZZ;' not in strs,
        '对照：不存在的类型描述符确实查不到（不是「查什么都有」）')
    for nm in (b'aiStart', b'aiAllowed', b'aiAbort'):
        chk(nm in strs, 'dex 字符串表里有恰好叫 %s 的符号（不是子串命中）' % nm.decode())
    for desc in (b'Ltop/yansaki/shed/AiProxy;', b'Ltop/yansaki/shed/JsEvent;'):
        chk(desc in strs, 'dex 字符串表里有类型描述符 %s' % desc.decode())
    # ⚠ `window.__ysAi` 只可能是**子串**匹配：它是 JsEvent 拼出来的 JS 字面量的一个片段，
    #   不单独成串。这条弱一档是格式决定的，不是偷懒 —— 所以它单独写、单独说清楚。
    chk(b'window.__ysAi' in dex, 'dex 含 window.__ysAi（JS 字面量片段，只做子串匹配）')

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
