#!/usr/bin/env python3
r"""reverse-ai.py —— 反向测试：证明 verify.sh 里「AI 跨域转发」那一节的断言**不是永远为真**。

为什么这一节特别需要反向测试：
  这一节的断言几乎全是「某个字符串出现在某个字节流里」—— `b'aiAbort' in dex`、
  `b'aiAllowed' in a`、正则扫垫片代码。这类断言的坏法不是「报错」，而是**永远为真**：
  路径拼错、读到的对象是空的、正则写宽了…… 表现全都是**绿**。
  所以「绿」本身不构成证据，必须拿一根针把它打红一次。

本脚本跑五根针，每根都只改**一处**，然后拿**整份输出的红行集合**跟期望比：

  针①  只改仓库源、**不重建**  ⇒ 期望恰好「逐字节一致」变红。
       ★ 顺带证明那条断言比的是【出货的那一份】vs【仓库源】，
         而不是【源】vs【源】——因为这一针把 googleapis 域名写进了仓库源的**注释**里，
         而「没有硬编码域名」那条**保持绿**。要是它读的是源文件，就该一起红。
  针②  把域名清单写进仓库源的**代码**（重建）⇒ 期望恰好「没有硬编码域名」变红。
       证明那条正则扫的是真字节，不是永远扫不到。
  针③  把 MainActivity 的 aiAbort 改名 aiCancel（重建）⇒ 期望恰好那条符号断言变红。
  针④  把 aiAbort 改名 aiAbortZZZ（重建）⇒ 期望**同样恰好那一条红**。
       ★ 这一针是有来历的：改之前那条断言是 `b'aiAbort' in dex`（**子串**搜索），
         针④ 实测**全绿** —— 也就是说把桥接方法改名成 aiAbortZZZ 时，没有任何一层会报，
         而垫片里 `native.aiAbort(...)` 是硬调的 ⇒ 真机上「点停止没反应」。
         据此把断言改成了「dex 字符串表里有**恰好叫** aiAbort 的符号」，
         这一针于是从「量盲区」变成了真反向测试。
  针⑤  往 verify.sh 的 dex_strings() 里插一句 `return None`（不重建）
       ⇒ 期望恰好 7 条变红（解析器 + 正对照 + 3 个方法名 + 2 个描述符），
         而**负对照保持绿**。
       ★ 它证明新写的字符串表解析器**会**失败，不是永远返回一个能通过检查的集合；
         顺带证明「解析失败不静默跳过下面几条」这个设计真的在起作用 ——
         要是还写成 `if strs:`，这一针只会红 1 条，剩下 6 条会**无声消失**。

收尾：恢复三处源文件、重建、**断言 APK 的 sha1 回到脚本开头量到的基线**。
       ⚠ 基线是**现量**的，不是写死的常量 —— 写死的 sha1 每次产品一改就红，
        那种红没人看（「过时断言」）。基线在脚本里现取，产品怎么变都对。

⚠ 判据一律用**红行集合相等**，不是「退出码非 0」：注入必然连带别处一起红，
  只看退出码分不清「打中了它声称打的那一处」还是「把整层都打崩了」。

用法：
  python tools/reverse-ai.py
  python tools/reverse-ai.py --keep-going      # 一根针不符也继续跑完，最后一起报
"""
import argparse
import hashlib
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ANDROID = os.path.dirname(HERE)

SHIM = os.path.join(ANDROID, 'shim', 'ai-fetch-shim.js')
MAIN = os.path.join(ANDROID, 'src', 'top', 'yansaki', 'shed', 'MainActivity.java')
# ⚠ APK 路径**从 AndroidManifest.xml 现推**，别写死文件名：
#   写死过一次 `YanSakiShed-1.0.apk`，一提版本这条就报「前置不满足，中止」——
#   看着像环境坏了，其实只是这一行过时（RULES 六之四十八）。
sys.path.insert(0, HERE)
from apk_path import apk_path  # noqa: E402  （必须在 sys.path 之后）
APK = apk_path()
BUILD_SH = os.path.join(ANDROID, 'build.sh')
VERIFY_SH = os.path.join(ANDROID, 'verify.sh')

# 所有注入都带上这个标记，脚本开头扫一遍、结尾扫一遍。
# ⚠ 有标记残留 = 上一次没恢复干净 ⇒ 直接拒跑。带着上一次的注入继续做实验，
#   后面的「红」到底是谁打红的就说不清了。
MARK = 'YSREV_INJECT'

N_BYTES = '垫片与仓库源文件逐字节一致'
N_HOSTS = '垫片代码里没有硬编码的 googleapis 域名'
N_ALLOW = '垫片是通过 aiAllowed() 问原生的'
N_ABORT = 'dex 字符串表里有恰好叫 aiAbort 的符号'

ap = argparse.ArgumentParser()
ap.add_argument('--keep-going', action='store_true', help='一根针不符也继续，最后一起报')
args = ap.parse_args()

fails = []
log = []


def check(cond, msg):
    print('   %s %s' % ('✅' if cond else '❌', msg))
    if not cond:
        fails.append(msg)
    return cond


def read(p):
    with open(p, 'rb') as f:
        return f.read()


def write(p, data):
    """写盘**并回读**。

    ⚠⚠ 「Edit 报成功 ≠ 落盘」在本项目踩过十三次；这里的注入是整文件写，
       更要回读。回读不通过就直接中止 —— 拿着一个「以为改了其实没改」的源
       去跑反向测试，得到的绿是假的。
    """
    with open(p, 'wb') as f:
        f.write(data)
    back = read(p)
    assert back == data, '写盘后回读不一致：%s' % p
    return back


def sha1(p):
    h = hashlib.sha1()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def find_bash():
    """找 **Git Bash**，不能靠 PATH 里的 `bash`。

    ⚠⚠ Windows 的 PATH 里 `C:\\Windows\\System32\\bash.exe` 排在前面，那是 **WSL 的启动器**，
       没装发行版时它只打印一行「没有已安装的分发版」就退出，**rc=1、没有有用信息**。
       （这个坑在 reverse-lfhname.py 里已经踩过一次，这里是同一个坑的第二处调用点。）
    """
    for c in (r'C:\Program Files\Git\bin\bash.exe',
              r'C:\Program Files (x86)\Git\bin\bash.exe',
              r'C:\Program Files\Git\usr\bin\bash.exe'):
        if os.path.exists(c):
            return c
    return 'bash'


BASH = find_bash()


def sh_env():
    env = dict(os.environ, PYTHONIOENCODING='utf-8')
    # build.sh 里 `command -v node` 找不到 node 时会**静默跳过**语法检查，
    # 所以这里把托管 node 显式塞进 PATH，并在下面断言那句输出真的出现了。
    nodedir = os.path.join(os.path.expanduser('~'), '.workbuddy-ai', 'binaries',
                           'node', 'versions', '22.22.2-3')
    if os.path.isdir(nodedir):
        env['PATH'] = nodedir + os.pathsep + env.get('PATH', '')
    return env


def run_script(path, *extra):
    """跑 build.sh / verify.sh。

    ⚠⚠ 路径必须转成**正斜杠**再传。verify.sh 开头是 `[ -e "$APK" ] || exit 1`，
       而 Git Bash 不认 `G:\\saki\\...` —— 传错了它**立刻退出**，
       于是「断言没出现」看起来就像「产品坏了」。（reverse-lfhname.py 里踩过两次。）
    """
    r = subprocess.run([BASH, path.replace('\\', '/')] + [e.replace('\\', '/') for e in extra],
                       capture_output=True, cwd=ANDROID, env=sh_env(), timeout=600)
    return (r.stdout + r.stderr).decode('utf-8', 'replace'), r.returncode


def build():
    out, rc = run_script(BUILD_SH)
    return out, rc


def verify(apk=None):
    out, _rc = run_script(VERIFY_SH, *( [apk] if apk else [] ))
    return out


RED = re.compile(r'^\s*❌\s+(.*)$', re.M)


def reds(out):
    """整份输出里的红行集合。

    ⚠ 只看 `❌ ` 开头的行，不看退出码 —— 退出码只告诉你「有红的」，
       不告诉你**红的是哪几条**。反向测试要的正是后者。
    """
    return sorted(set(m.strip() for m in RED.findall(out)))


def expects(title, out, want_red, want_green=()):
    """比对红行集合。want_red 是期望红的**子串**清单，want_green 是期望仍绿的子串。"""
    print('   --- %s ---' % title)
    got = reds(out)
    print('       实测红行 %d 条：' % len(got))
    for g in got:
        print('         ·', g)
    # ⚠⚠ **先确认 verify.sh 跑到了收尾行**，再数红行。
    #   harness 自己死掉时（比如注入把内嵌 Python 弄成 IndentationError），
    #   输出里**一条 ❌ 都没有** —— 「0 条红」和「全绿」在红行集合上**完全一样**。
    #   本轮针⑤ 第一次跑就踩了这个：注入落进了 `if` 块里 ⇒ 内嵌 Python 语法错 ⇒
    #   verify.sh 静默早退 ⇒ 实测红行 0 条。要是这里只断言「没有多余的红」，
    #   这一针会**假装通过**，而我拿到的是一个「反向测试很成功」的假结论。
    #   ⇒ 所以每次比对前先问一句「它跑完了吗」。
    check('== 全部通过 ==' in out or '== ❌ 有检查项未通过 ==' in out,
          'verify.sh 跑到了收尾行（没有提前死掉）')
    hit = [w for w in want_red if any(w in g for g in got)]
    extra = [g for g in got if not any(w in g for w in want_red)]
    ok = check(len(hit) == len(want_red),
               '期望红的都红了（%d/%d）' % (len(hit), len(want_red)))
    ok &= check(not extra,
                '没有多余的红（红行恰好 = 期望那 %d 条）%s'
                % (len(want_red), '' if not extra else '，多出 %r' % extra))
    for w in want_green:
        ok &= check(any(('✅ ' + w) in l for l in out.splitlines()),
                    '「%s」仍为绿' % w)
    return ok


# =====================================================================
print('== 0. 前置 ==')
for f in (SHIM, MAIN, APK, BUILD_SH, VERIFY_SH):
    check(os.path.exists(f), '存在 %s' % os.path.relpath(f, ANDROID))
if fails:
    print('\n== ❌ 前置不满足，中止 ==')
    sys.exit(1)

stale = []
for f in (SHIM, MAIN, VERIFY_SH):
    if MARK.encode() in read(f):
        stale.append(os.path.relpath(f, ANDROID))
check(not stale,
      '仓库里没有上一次注入的残留标记 %r%s'
      % (MARK, '' if not stale else '（残留：%r）' % stale))
if stale:
    print('\n== ❌ 先手工清掉残留再跑，否则分不清是谁打红的 ==')
    sys.exit(1)

BASE_SHA = sha1(APK)
print('   基线 APK sha1 = %s' % BASE_SHA)
print('   基线体积      = %d 字节' % os.path.getsize(APK))

# =====================================================================
print()
print('== 1. 对照组：出货 APK 上这一节应当全绿 ==')
out = verify()
# ⚠ 先证明 verify.sh **真的跑到了那一节**。harness 自己坏掉会伪装成产品坏掉：
#   「找不到文件提前退出」和「断言变红」在输出上长得一样。
check('--- AI 跨域转发 ---' in out, 'verify.sh 跑到了 AI 那一段（没有提前退出）')
check('== 全部通过 ==' in out, '出货 APK 整份全绿')
check(not reds(out), '出货 APK 红行数 = 0（实得 %d）' % len(reds(out)))
for n in (N_BYTES, N_HOSTS, N_ALLOW, N_ABORT):
    check(('✅ ' + n) in out, '对照组为绿：%s' % n)
# 字节一致那条得报出**非零**字节数，否则「空 == 空」也是绿的（永真）。
m = re.search(r'垫片与仓库源文件逐字节一致 \((\d+) 字节\)', out)
check(m is not None and int(m.group(1)) > 5000,
      '字节一致那条报的是真实体积（%s 字节，不是 0）' % (m.group(1) if m else '未匹配'))
# ⚠ build.sh 里 `command -v node` 找不到 node 会**静默跳过**语法检查 ⇒ 得看它真的跑了。
bout, brc = build()
if brc != 0 or 'node --check 通过' not in bout:
    # ⚠⚠ **别只报一句「退出码不是 0」** —— 那等于把 build.sh 真正的报错吞掉，
    #   然后人会去猜「产品哪里坏了」。本轮的第一次失败就吃了这个亏：
    #   日志里只有 `❌ build.sh 退出码 0`，真正的原因一个字都没有，
    #   于是同一套脚本跑了两遍才拿到现场。（同族：六之五十「harness 自己的结构
    #   缺陷会伪装成产品坏了」）
    print('   --- build.sh 输出全文（rc=%d）---' % brc)
    for line in bout.splitlines():
        print('       | ' + line)
    print('   --- build.sh 输出结束 ---')
check(brc == 0, 'build.sh 退出码 0')
check('node --check 通过' in bout,
      'build.sh 真的做了垫片语法检查（不是静默跳过）')
check(sha1(APK) == BASE_SHA, '重建后 sha1 与基线一致（构建可复现）')
if fails and not args.keep_going:
    print('\n== ❌ 对照组就不对，后面的针没意义，中止 ==')
    sys.exit(1)

# =====================================================================
# 备份：⚠ 必须在**任何**改动之前取。上一轮我把备份取在了注入之后，
#   于是「恢复」把注入又拷了回去，grep 出来还是 1 —— 白折腾两轮。
SHIM_BAK = read(SHIM)
MAIN_BAK = read(MAIN)
VERIFY_BAK = read(VERIFY_SH)

try:
    # ---------------------------------------------------------------
    print()
    print('== 2. 针①：只改仓库源、不重建（注入写进注释）==')
    # 注释里放域名 ⇒ 源码**字面上**有了 googleapis，
    # 但去注释后的代码没有 ⇒ 「没有硬编码域名」应当**保持绿**。
    # 这一条同时证明：那条断言读的是【APK 里那一份】，不是仓库源。
    # ⚠ 注入串一律用 **ASCII**：`b'…中文…'` 直接 SyntaxError（bytes 字面量只收 ASCII）。
    inj = SHIM_BAK + (b'\n/* ' + MARK.encode() +
                      b': hosts aiplatform.googleapis.com -- source only, no rebuild */\n')
    write(SHIM, inj)
    out = verify()
    expects('针① 期望：恰好「逐字节一致」红，域名那条仍绿',
            out, [N_BYTES], [N_HOSTS, N_ALLOW])

    # ---------------------------------------------------------------
    print()
    print('== 3. 针②：域名清单写进仓库源的**代码**（重建）==')
    # 把注释那行换成真的代码语句：正则扫的是去注释后的代码，这下扫得到。
    inj = SHIM_BAK + (b'\nvar ' + MARK.encode() +
                      b"_HOSTS = ['aiplatform.googleapis.com'];\n")
    write(SHIM, inj)
    bout, brc = build()
    check(brc == 0, 'build.sh 退出码 0')
    out = verify()
    expects('针② 期望：恰好「没有硬编码域名」红，逐字节一致回绿',
            out, [N_HOSTS], [N_BYTES, N_ALLOW])
    check(sha1(APK) != BASE_SHA, '注入后的 APK 与基线不同（说明重建真的把它带进去了）')

    # ---------------------------------------------------------------
    print()
    print('== 4. 针③：aiAbort 改名 aiCancel（重建）==')
    write(SHIM, SHIM_BAK)                     # 垫片先还原，别让上一针的红串场
    src = MAIN_BAK
    check(src.count(b'public void aiAbort(') == 1,
          'MainActivity 里 `public void aiAbort(` 恰好 1 处')
    write(MAIN, src.replace(b'public void aiAbort(', b'public void aiCancel('))
    bout, brc = build()
    check(brc == 0, 'build.sh 退出码 0')
    out = verify()
    expects('针③ 期望：恰好「字符串表里有恰好叫 aiAbort 的符号」红',
            out, [N_ABORT], [N_BYTES, N_HOSTS, N_ALLOW])

    # ---------------------------------------------------------------
    print()
    print('== 5. 针④：改名成 aiAbortZZZ（重建）—— 子串搜索打不中的那一针 ==')
    # ★ 这一针的来历：断言原来写成 `b'aiAbort' in dex`（**子串**搜索），
    #   针④ 第一次跑的时候**全绿** —— 改名成 aiAbortZZZ 照样命中。
    #   那不是「断言很严」，是「断言量错了对象」：它只能证明「dex 里有这么一段字节」，
    #   不能证明「桥接方法的名字就是 aiAbort」。而垫片里 `native.aiAbort(...)` 是硬调的
    #   ⇒ 改了名**没有任何一层会报**，直到真机上「点停止没反应」。
    #   据此把 verify.sh 那条改成了「dex 字符串表里有**恰好叫** aiAbort 的符号」，
    #   这一针于是从「量盲区」升级成真反向测试：现在它**必须红**。
    write(MAIN, MAIN_BAK.replace(b'public void aiAbort(', b'public void aiAbortZZZ('))
    bout, brc = build()
    check(brc == 0, 'build.sh 退出码 0')
    out = verify()
    expects('针④ 期望：恰好那条符号断言红（子串还在，但整串不是它了）',
            out, [N_ABORT], [N_BYTES, N_HOSTS, N_ALLOW])
    # 把「为什么以前会绿」直接量出来：`aiAbort` 作为**子串**确实还在 dex 里。
    # 这一步是给上面那条注释留凭据 —— 否则「以前是子串搜索」只是一句回忆。
    import zipfile
    dex = zipfile.ZipFile(APK).read('classes.dex')
    check(dex.count(b'aiAbortZZZ') == 1 and b'aiAbort' in dex,
          '凭据：dex 里有 aiAbortZZZ，而 `aiAbort` 作为**子串**仍在 ⇒ 老写法确实会绿')

    # ---------------------------------------------------------------
    print()
    print('== 6. 针⑤：往 verify.sh 的 dex_strings() 里插一句 return None ==')
    # ★ 这一针打的是**harness 自己**：新写的字符串表解析器必须**会**失败，
    #   不能是一个永远返回「能通过检查的集合」的东西。
    #   顺带验证「解析失败不静默跳过下面几条」这个设计真的在起作用 ——
    #   要是还写成 `if strs:`，这一针只会红 1 条，另外 6 条会**无声消失**。
    #   ⚠ 注入只加一句 return，不删任何东西：注入要窄到只打它声称打的那件事。
    write(MAIN, MAIN_BAK)                     # 先还原 MainActivity，别让上一针串场
    # ⚠⚠ 这里**必须重建**。针④ 把 APK 留在了 aiAbortZZZ 那一版上，
    #   不重建的话「字符串表里有恰好叫 aiAbort 的符号」会**跟着一起红**，
    #   红行就不是 7 条 —— 那我这条「恰好 7 条」的判据会红，而红的原因是
    #   **我自己的实验没收拾干净**，不是产品有问题。这种「假红」最难查。
    bout, brc = build()
    check(brc == 0, 'build.sh 退出码 0')
    check(sha1(APK) == BASE_SHA, '针⑤ 开跑前 APK 已回到基线（上一针的红不串场）')
    # ⚠ 注入点必须落在**函数体**层级（4 空格），不是 `if` 块里。
    #   第一次写的是「在 `if not d.startswith(...)` 后面插一行」——
    #   插进去是 8 空格、后面原本那行是 12 空格 ⇒ **IndentationError** ⇒
    #   内嵌 Python 整个不跑 ⇒ verify.sh 一条 ❌ 都没打印。
    #   （这一针因此顺带把 expects() 里「先确认跑完了」那道闸门加上了。）
    anchor = b'def dex_strings(d):\n'
    check(VERIFY_BAK.count(anchor) == 1, '在 verify.sh 里找到了唯一的 dex_strings() 注入锚点')
    write(VERIFY_SH, VERIFY_BAK.replace(
        anchor, anchor + b'    return None  # ' + MARK.encode() + b'\n'))
    out = verify()
    expects('针⑤ 期望：恰好 7 条红，负对照保持绿',
            out,
            ['dex 字符串表解析成功',
             '对照：字符串表里查得到 MainActivity',
             'dex 字符串表里有恰好叫 aiStart',
             'dex 字符串表里有恰好叫 aiAllowed',
             'dex 字符串表里有恰好叫 aiAbort',
             'dex 字符串表里有类型描述符 Ltop/yansaki/shed/AiProxy;',
             'dex 字符串表里有类型描述符 Ltop/yansaki/shed/JsEvent;'],
            ['对照：不存在的类型描述符确实查不到',
             'dex 含 window.__ysAi'])

finally:
    # ---------------------------------------------------------------
    # ⚠ 恢复放在 finally：中途抛异常也不能把注入留在仓库里。
    #   三处都要还原 —— 上一版只还原了两处，针⑤ 打的是 verify.sh。
    print()
    print('== 7. 恢复 + 重建 ==')
    write(SHIM, SHIM_BAK)
    write(MAIN, MAIN_BAK)
    write(VERIFY_SH, VERIFY_BAK)
    resid = [os.path.relpath(f, ANDROID) for f in (SHIM, MAIN, VERIFY_SH)
             if MARK.encode() in read(f)]
    check(not resid, '三处源文件都没有 %r 残留%s'
          % (MARK, '' if not resid else '（%r）' % resid))
    bout, brc = build()
    check(brc == 0, 'build.sh 退出码 0')
    out = verify()
    check('== 全部通过 ==' in out, '恢复后 verify.sh 整份全绿')
    now = sha1(APK)
    check(now == BASE_SHA,
          'APK sha1 回到基线 %s（实得 %s）' % (BASE_SHA, now))

print()
if fails:
    print('== ❌ 反向测试本身有问题：%d 条不符 ==' % len(fails))
    for f in fails:
        print('   -', f)
    sys.exit(1)
print('== 全部符合预期 ==')
print('   ① 出货 APK 全绿；')
print('   ② 针①②③④ 各自只打中它声称打的那一条，不多不少；')
print('   ③ 针⑤ 证明新写的 dex 字符串表解析器会失败，且失败时下面几条不静默跳过；')
print('   ④ 恢复后 sha1 回到基线 %s。' % BASE_SHA)
