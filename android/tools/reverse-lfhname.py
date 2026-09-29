#!/usr/bin/env python3
r"""reverse-lfhname.py —— 反向测试：证明 verify.sh 里「本地头名字 == 中央目录名字」那条断言
**不是永远为真**的，同时证明这个缺陷**结构上不可能进入出货 APK**。

背景（为什么要为这么一条小断言专门写反向测试）：
  aapt2 在 Windows 上给**带子目录的资产**写本地文件头(LFH)时，路径用的是平台分隔符 `\`，
  而中央目录(CD)里是 `/`。zipalign 的 ZipEntry::compareHeaders() 最后一条正是
  `strcmp(CD 名字, LFH 名字)`，于是每一条这样的资产都打一行
  `zip W …] WARNING: header mismatch`，而 **zipalign 的退出码仍然是 0**。
  换句话说：只看 build.sh 的退出码，这件事会被完全淹没。
  zipalign 是**从中央目录重建本地头**的，所以它顺手把反斜杠归一了 —— 它的输出是干净的。
  ⇒ 所以判据必须落在**出货的那一份**上，而不是「有没有警告」。

本脚本做两件事：
  ① 把某个条目的 LFH 名字从 `/` 改成 `\\`（只动那几个字节，其余原样），
     然后**期望 apksigner 拒绝它** —— 这说明「名字不一致的 APK 签不出名」，
     出货链路自己就是一道闸门。
  ② 对注入文件跑 verify.sh，**期望恰好那条断言变红**（对照组 = 真实 APK，期望它是绿）。

⚠ 注入文件没法签名（见 ①），所以 verify.sh 的「签名」那一段必然一起红 —— 那是预期的，
  不是本测试关心的对象，所以这里**只 grep 那一条断言**，不拿「整体退出码」当判据。

用法：
  python tools/reverse-lfhname.py                       # 用默认路径
  python tools/reverse-lfhname.py --apk build/X.apk --unsigned build/aligned.apk
"""
import argparse
import os
import struct
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ANDROID = os.path.dirname(HERE)

TARGET = b'assets/fonts/web/Cubic_11_1.100_R.woff2'
NEEDLE = '每个条目的本地头名字都与中央目录逐字节一致'

ap = argparse.ArgumentParser()
ap.add_argument('--apk', default=os.path.join(ANDROID, 'build', 'YanSakiShed-1.0.apk'),
                help='出货 APK（对照组，期望它是绿的）')
ap.add_argument('--unsigned', default=os.path.join(ANDROID, 'build', 'aligned.apk'),
                help='未签名产物，用来做注入的起点')
ap.add_argument('--bt', default=os.environ.get(
    'BT', 'C:/Users/YanSaki/.workbuddy-ai/android-sdk/build-tools/34.0.0'))
ap.add_argument('--keystore', default=os.path.join(ANDROID, 'keystore', 'debug.jks'))
ap.add_argument('--target', default=TARGET.decode())
args = ap.parse_args()

fails = []


def check(cond, msg):
    print('   %s %s' % ('✅' if cond else '❌', msg))
    if not cond:
        fails.append(msg)


def entry_offsets(data, want):
    """从中央目录里拿到 want 这条的本地头偏移与名字长度（中央目录才是权威）。"""
    eocd = data.rfind(b'PK\x05\x06')
    n, _cs, co = struct.unpack('<HII', data[eocd + 10:eocd + 20])
    p = co
    for _ in range(n):
        nl, el, cl = struct.unpack('<HHH', data[p + 28:p + 34])
        if bytes(data[p + 46:p + 46 + nl]) == want:
            return struct.unpack('<I', data[p + 42:p + 46])[0], nl
        p += 46 + nl + el + cl
    return None, None


def mismatched_entries(path):
    d = open(path, 'rb').read()
    eocd = d.rfind(b'PK\x05\x06')
    n, _cs, co = struct.unpack('<HII', d[eocd + 10:eocd + 20])
    p, bad = co, []
    for _ in range(n):
        nl, el, cl = struct.unpack('<HHH', d[p + 28:p + 34])
        off = struct.unpack('<I', d[p + 42:p + 46])[0]
        if d[p + 46:p + 46 + nl] != d[off + 30:off + 30 + nl]:
            bad.append(d[p + 46:p + 46 + nl].decode('utf-8', 'replace'))
        p += 46 + nl + el + cl
    return bad


def find_bash():
    """找**Git Bash**，不能靠 PATH 里的 `bash`。

    ⚠⚠ Windows 的 PATH 里 `C:\\Windows\\System32\\bash.exe` 排在前面，那是 **WSL 的启动器**，
       没装发行版时它只打印「适用于 Linux 的 Windows 子系统没有已安装的分发版」就退出，
       **rc=1、一句有用的话都没有**。本轮我在这里又栽了一次：
       对照组和注入组一起报 ❌，看着像断言写反了，其实是 verify.sh 根本没被执行。
    """
    cands = [r'C:\Program Files\Git\bin\bash.exe',
             r'C:\Program Files (x86)\Git\bin\bash.exe',
             r'C:\Program Files\Git\usr\bin\bash.exe']
    for c in cands:
        if os.path.exists(c):
            return c
    return 'bash'          # 兜底：环境里没有 Git Bash 就让它按 PATH 去找


BASH = find_bash()


def run_verify(apk):
    """跑 verify.sh。

    ⚠⚠ 路径必须转成**正斜杠**再传。verify.sh 开头是 `[ -e "$APK" ] || exit 1`，
       而 Git Bash 不认 `G:\\saki\\...` 这种反斜杠路径 —— 传错了它会**立刻退出**，
       于是「断言没出现」看起来就像「产品坏了」。
    """
    r = subprocess.run([BASH, os.path.join(ANDROID, 'verify.sh').replace('\\', '/'),
                        apk.replace('\\', '/')],
                       capture_output=True, cwd=ANDROID,
                       env=dict(os.environ, PYTHONIOENCODING='utf-8'))
    return (r.stdout + r.stderr).decode('utf-8', 'replace')


print('== 0. 前置：文件都在吗 ==')
for f in (args.apk, args.unsigned, args.keystore):
    check(os.path.exists(f), '存在 %s' % f)
if fails:
    print('\n== ❌ 前置不满足，中止 ==')
    sys.exit(1)

print()
print('== 1. 对照组：出货 APK 上这条断言应当是绿的 ==')
out = run_verify(args.apk)
# ⚠ 先证明 verify.sh **真的跑到了那一节**。不然「找不到文件提前退出」和「断言变红」
#   在输出上长得一样 —— harness 自己坏掉会伪装成产品坏掉。
check('== 4. 内容' in out, 'verify.sh 跑到了第 4 段（没有提前退出）')
check(('✅ ' + NEEDLE) in out, '出货 APK：%s → ✅' % NEEDLE)
check(not mismatched_entries(args.apk), '独立复核：出货 APK 里名字不一致的条目 = 0')

print()
print('== 2. 注入：只把目标条目的 LFH 名字里的 / 换成 \\ ==')
raw = bytearray(open(args.unsigned, 'rb').read())
off, nl = entry_offsets(raw, args.target.encode())
check(off is not None, '在中央目录里找到 %s' % args.target)
if off is None:
    print('\n== ❌ 中止 ==')
    sys.exit(1)
lname = bytes(raw[off + 30:off + 30 + nl])
check(lname == args.target.encode(), 'LFH 名字与中央目录一致（注入前）')
patched = lname.replace(b'/', b'\\')
raw[off + 30:off + 30 + nl] = patched

tmpd = tempfile.mkdtemp(prefix='rev-lfhname-')
injected = os.path.join(tmpd, 'injected.apk')
open(injected, 'wb').write(bytes(raw))
print('   注入文件：%s' % injected)
check(len(mismatched_entries(injected)) == 1, '注入后恰好 1 个条目的名字不一致')

print()
print('== 3. 签名器应当拒绝它（出货链路自带的一道闸门）==')
r = subprocess.run([os.path.join(args.bt, 'apksigner.bat'), 'sign',
                    '--ks', args.keystore, '--ks-pass', 'pass:android',
                    '--key-pass', 'pass:android', '--ks-key-alias', 'androiddebugkey',
                    '--v1-signing-enabled', 'true', '--v2-signing-enabled', 'true',
                    '--out', os.path.join(tmpd, 'signed.apk'), injected],
                   capture_output=True, env=dict(os.environ,
                                                 JAVA_HOME='C:/Program Files/Java/jdk-21'))
txt = (r.stdout + r.stderr).decode('utf-8', 'replace')
check(r.returncode != 0, 'apksigner 退出码非 0（rc=%d）' % r.returncode)
check('Name mismatch between Local File Header and Central Directory' in txt,
      '报错正是 LFH/CD 名字不一致')

print()
print('== 4. 反向：注入文件上这条断言应当变红 ==')
out = run_verify(injected)
check('== 4. 内容' in out, 'verify.sh 跑到了第 4 段（没有提前退出）')
check(('❌ ' + NEEDLE) in out, '注入文件：%s → ❌' % NEEDLE)

print()
if fails:
    print('== ❌ 反向测试本身有问题：%d 条不符 ==' % len(fails))
    for f in fails:
        print('   -', f)
    sys.exit(1)
print('== 全部符合预期 ==')
print('   ① 出货 APK 上断言为绿；② 注入后为红；③ 注入的 APK 签不出名。')
