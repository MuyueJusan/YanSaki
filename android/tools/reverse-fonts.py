#!/usr/bin/env python3
r"""reverse-fonts.py —— 反向测试：证明 `tools/pick-fonts.py` 那两道闸门**真的会拦**，
而且那条正则**真的只有一份实现**。

背景：把 `assets/fonts/` 从「整个 ../fonts」改成「只装页面引用的那些」之后，
多出两条新的失败路径，而它们的失败方式**都是静默的**：

  ① 一个 `fonts/` 引用都抽不到（正则失效 / 产品改了引用方式）
     ⇒ 出一个**没有字体**的 APK。
  ② 页面引用了某个字体，但 `../fonts` 里没有
     ⇒ 装进去 404。

两种在手机上**都只表现为「字体悄悄退化成系统字体」**，不报任何错。
所以它们必须各有一条反向测试，而且测试要能喂进**造的 HTML** ——
不能去动真正的产品文件。

本脚本跑的针：

  针① 真产品 + 真 fonts/ ⇒ rc=0，清单恰好 = 产品里那一条，且文件真的存在
  针② 一份**没有任何 fonts/ 引用**的 HTML ⇒ 必须 rc=1，且报错说到点子上
  针③ 一份**引用了不存在的字体**的 HTML ⇒ 必须 rc=1，且**点名那个文件**
  针④ 一份有 **4 条**引用、用了 4 种不同写法的 HTML ⇒ 必须出 4 条
      （证明正则在真干活，不是永远返回同一条）
  针⑤ `--list-only` 必须**绕过**闸门 —— 否则 verify.sh 里那句「rc=0」什么也说明不了
  针⑥ 反漂移：那条正则只许出现在 `pick-fonts.py` 一个**可执行**文件里

⚠ 所有造的 HTML 都写在临时目录，`atexit` 无条件删。
"""
import atexit
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ANDROID = os.path.dirname(HERE)
ROOT = os.path.dirname(ANDROID)
PICKER = os.path.join(HERE, 'pick-fonts.py')
PAGE = os.path.join(ROOT, 'saki.html')
FONTS = os.path.join(ROOT, 'fonts')
BUILD_SH = os.path.join(ANDROID, 'build.sh')
VERIFY_SH = os.path.join(ANDROID, 'verify.sh')

PYBIN = os.environ.get('PYBIN', sys.executable)

fails = []


def check(cond, msg):
    print('   %s %s' % ('✅' if cond else '❌', msg))
    if not cond:
        fails.append(msg)
    return cond


TMPD = tempfile.mkdtemp(prefix='rev-fonts-')
# ⚠ 探针造的文件**无条件删**；用 atexit 兜住三条退出路径
#   （正常结束 / 断言失败时的 sys.exit / 中途抛异常）。
atexit.register(shutil.rmtree, TMPD, True)


def run(html_path, extra=()):
    """跑 pick-fonts.py，返回 (rc, 清单, stderr)。"""
    r = subprocess.run([PYBIN, PICKER] + list(extra) + [html_path, FONTS],
                       capture_output=True, timeout=120,
                       env=dict(os.environ, PYTHONIOENCODING='utf-8'))
    out = r.stdout.decode('utf-8', 'replace')
    err = r.stderr.decode('utf-8', 'replace')
    return r.returncode, [l for l in out.splitlines() if l.strip()], err


def write_html(name, body):
    p = os.path.join(TMPD, name)
    with open(p, 'w', encoding='utf-8', newline='\n') as f:
        f.write('<!doctype html><html><head><style>\n' + body + '\n</style></head></html>\n')
    return p


# =====================================================================
print('== 0. 前置 ==')
for f in (PICKER, PAGE, FONTS, BUILD_SH, VERIFY_SH):
    check(os.path.exists(f), '存在 %s' % os.path.relpath(f, ROOT))
if fails:
    print('\n== ❌ 前置不满足，中止 ==')
    sys.exit(1)

# =====================================================================
print()
print('== 1. 对照组：真产品 + 真 fonts/ ==')
rc, refs, err = run(PAGE)
check(rc == 0, 'rc=0（实得 %d）%s' % (rc, ('  stderr=' + err.strip()) if err.strip() else ''))
check(len(refs) == 1, '清单恰好 1 条（实得 %d）%r' % (len(refs), refs))
for r in refs:
    check(os.path.exists(os.path.join(FONTS, r[len('fonts/'):])),
          '%s 在 ../fonts 里真的存在' % r)
# 与「产品里字面写了什么」对一遍 —— 别让脚本自己跟自己比。
lit = sorted(set(re.findall(r"url\(['\"]?(\.?/?fonts/[^'\")]+)", open(PAGE, encoding='utf-8').read())))
check(lit, '独立抽了一遍产品里的字体引用（%r）' % lit)
if lit:
    check(set(refs) == set(re.sub(r'^\./', '', x) for x in lit),
          '两条独立路径抽出来的清单一致')
# ⚠⚠ 存一份**真产品**的清单，别指望后面的针跑完 `refs` 还是它。
#   第一次写这个脚本时 §4 用 `rc, refs, err = run(h)` 把 refs 覆盖成了那份 4 条的
#   造数据，于是 §5 里「两种模式的清单一致」拿 1 条去比 4 条，报了个假红 ——
#   而报出来的样子像「产品坏了」。**跨步骤复用的变量，要么存副本、要么当场用掉。**
REFS_REAL = list(refs)

# =====================================================================
print()
print('== 2. 针②：一个 fonts/ 引用都抽不到的 HTML ⇒ 闸门必须拦 ==')
h = write_html('nofonts.html', 'body { font-family: sans-serif; }')
rc, refs, err = run(h)
check(rc == 1, 'rc=1（实得 %d）' % rc)
check(not refs, '清单为空（实得 %r）' % refs)
check('一个 `fonts/` 引用都没抽到' in err, '报错说清了是哪件事')
check('正则' in err, '报错里带上了那条正则（否则不知道去哪查）')
check('没有字体' in err, '报错点明了后果：会出一个没有字体的 APK')

# =====================================================================
print()
print('== 3. 针③：引用了不存在的字体 ⇒ 闸门必须拦，而且要点名 ==')
h = write_html('missing.html', "@font-face{src:url('./fonts/__no_such_font__.ttf')}")
rc, refs, err = run(h)
check(rc == 1, 'rc=1（实得 %d）' % rc)
check('__no_such_font__' in err, '报错里点名了那个文件')
check('404' in err or '退化成系统字体' in err, '报错点明了后果（装进去 404 / 静默退化）')

# =====================================================================
print()
print('== 4. 针④：4 条引用 + 4 种写法 ⇒ 必须出 4 条（正则在真干活）==')
# ⚠ 用**真的存在**的 4 个文件，写法的差异才是这一针唯一的变量。
h = write_html('four.html', '\n'.join([
    "@font-face{src:url('./fonts/myFont.ttf')}",                    # 产品用的那种：./ + 单引号
    '@font-face{src:url("fonts/ttf/Cubic_11_1.100_R.ttf")}',        # 无 ./ + 双引号
    "@font-face{src:url( 'fonts/web/Cubic_11_1.100_R.woff' )}",     # 有空格 + 单引号
    "@font-face{src:url(/fonts/web/Cubic_11_1.100_R.woff2)}",       # 绝对路径风格
]))
rc, refs, err = run(h)
check(rc == 0, 'rc=0（实得 %d）%s' % (rc, ('  stderr=' + err.strip()) if err.strip() else ''))
check(len(refs) == 4, '出了 4 条（实得 %d）%r' % (len(refs), refs))
for want in ('fonts/myFont.ttf', 'fonts/ttf/Cubic_11_1.100_R.ttf',
             'fonts/web/Cubic_11_1.100_R.woff', 'fonts/web/Cubic_11_1.100_R.woff2'):
    check(want in refs, '四种写法都认出来了：%s' % want)

# =====================================================================
print()
print('== 5. 针⑤：--list-only 必须绕过闸门 ==')
# ⚠ 这一条是**给 verify.sh 那句话兜底**的：verify.sh 调的是 `--list-only`，
#   它那句「rc=0」只有在「这个开关真的关掉了闸门」时才说明得了任何事。
#   要是 --list-only 其实没生效，verify.sh 会在闸门本该拦下的输入上照样 rc=0，
#   而「rc=0」被读成「清单没问题」—— 又一个把失败伪装成成功。
h = write_html('nofonts2.html', 'body { color: red; }')
rc_a, refs_a, _ = run(h)
rc_b, refs_b, _ = run(h, ['--list-only'])
check(rc_a == 1, '不开开关：rc=1（实得 %d）' % rc_a)
check(rc_b == 0, '开 --list-only：rc=0（实得 %d）' % rc_b)
check(refs_a == refs_b == [], '两种模式下清单都是空的（实得 %r / %r）' % (refs_a, refs_b))
# 另一半：**同一条真输入**下两种模式给出的清单必须一致，否则 verify.sh 核的不是 build.sh 装的那份。
rc_c, refs_c, _ = run(PAGE, ['--list-only'])
check(refs_c == REFS_REAL, '同一条真输入下两种模式的清单一致（%r vs %r）' % (refs_c, REFS_REAL))

# =====================================================================
print()
print('== 6. 针⑥：反漂移 —— 那条正则只许有一份实现 ==')
# ⚠ 「一份逻辑 N 份实现」的静态形态：正则被抄成两份之后，改一处忘一处，
#   表现是「build.sh 挑的是 A、verify.sh 核的是 B」—— 两边都绿。
#   这里直接数：**生产侧**出现那条正则的，必须只有 pick-fonts.py 一个。
FRAG = r'fonts/[^'
exes = [BUILD_SH, VERIFY_SH] + [os.path.join(HERE, f) for f in sorted(os.listdir(HERE))
                                if f.endswith('.py')]
hit = []
for p in exes:
    base = os.path.basename(p)
    # ⚠ 反向测试自己**故意**独立再抽一遍（那正是「两条独立路径互核」的价值），
    #   所以 `reverse-*.py` 排除在外。排除的是「探针」，不是「生产侧」。
    if os.path.abspath(p) == os.path.abspath(PICKER) or base.startswith('reverse-'):
        continue
    if FRAG in open(p, encoding='utf-8', errors='replace').read():
        hit.append(os.path.relpath(p, ANDROID))
check(not hit, '生产侧只有 pick-fonts.py 有这条正则%s'
      % ('' if not hit else '（还多出 %r）' % hit))
check(FRAG in open(PICKER, encoding='utf-8').read(),
      'pick-fonts.py 里确实有它（不是两边都没有 = 永真）')
check('reverse-fonts.py' in ' '.join(os.listdir(HERE)),
      '反向测试自己确实独立抽了一遍（探针的独立路径也是证据的一部分）')
# 两边都真的**调用**了那个脚本 —— 「函数写好了」≠「被调用了」。
check('tools/pick-fonts.py' in open(BUILD_SH, encoding='utf-8').read(),
      'build.sh 真的调了 pick-fonts.py')
check('tools/pick-fonts.py' in open(VERIFY_SH, encoding='utf-8').read(),
      'verify.sh 真的调了 pick-fonts.py')

print()
if fails:
    print('== ❌ 反向测试本身有问题：%d 条不符 ==' % len(fails))
    for f in fails:
        print('   -', f)
    sys.exit(1)
print('== 全部符合预期 ==')
print('   ① 真产品清单对得上；② 抽不到 ⇒ 拦；③ 文件不存在 ⇒ 拦且点名；')
print('   ④ 四种写法都认；⑤ --list-only 确实绕过闸门；⑥ 正则只有一份实现且两边都调了。')
