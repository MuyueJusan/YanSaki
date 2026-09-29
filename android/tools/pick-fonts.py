#!/usr/bin/env python3
r"""pick-fonts.py —— 从页面正文里抽出它**真的引用到的**字体，并核对源文件在不在。

用法：
  python tools/pick-fonts.py <saki.html> <fonts_dir>          # 正常用法
  python tools/pick-fonts.py --list-only <saki.html> <fonts_dir>
  python tools/pick-fonts.py --list-only - <fonts_dir>      # HTML 从 stdin 读

  stdout = 一行一个 `fonts/...` 相对路径（去重、按字典序）
  rc=0 成功；rc=1 有问题（原因写到 stderr）；rc=2 用法错

为什么要单独一个脚本，而不是把这几行写在 build.sh 里：
  ① **一份逻辑只能有一份实现。** 这条正则 build.sh（挑哪些拷进去）和 verify.sh
     （核对 APK 里有没有）**都要用**；各写一份的话，改了一处忘了另一处，
     表现是「构建挑的是 A、验证核的是 B」——两边都绿，而装进 APK 的是别的东西。
  ② 抽出来之后它**能被直接考**。这两条闸门的失败方式都是**静默**的：
     一个引用都没抽到 ⇒ 出一个没有字体的 APK；引用了但源文件不存在 ⇒ 装进去 404。
     两种在手机上**都只表现为「字体悄悄退化成系统字体」，不报任何错**。
     所以要各配一条反向测试，而测试得能喂进**造的 HTML**，不能去动真正的产品文件。

⚠ 正则与 verify.sh 原来那条**逐字节相同**（`url\(\s*['"]?\.?/?(fonts/[^'")]+)`）。
  改成两边都调本脚本之后，就只有这一份了。
"""
import os
import re
import sys

RE_FONT = rb'url\(\s*[\'"]?\.?/?(fonts/[^\'")]+)'


def pick(html_bytes):
    """从 HTML 字节里抽出字体引用（去重、排序）。"""
    return sorted(set(m.decode('utf-8') for m in re.findall(RE_FONT, html_bytes)))


def main(argv):
    args = [a for a in argv[1:] if not a.startswith('--')]
    list_only = '--list-only' in argv
    if len(args) != 2:
        sys.stderr.write('用法：pick-fonts.py [--list-only] <html|-> <fonts_dir>\n')
        return 2
    html_arg, fonts_dir = args

    if html_arg == '-':
        html_bytes = sys.stdin.buffer.read()
        html_name = '<stdin>'
    else:
        if not os.path.exists(html_arg):
            sys.stderr.write('❌ 找不到页面：%s\n' % html_arg)
            return 1
        html_bytes = open(html_arg, 'rb').read()
        html_name = html_arg

    refs = pick(html_bytes)
    if not refs and not list_only:
        sys.stderr.write(
            '❌ 从 %s 里一个 `fonts/` 引用都没抽到。\n'
            '   要么产品改了引用方式（比如换成绝对 URL / 换了个目录），'
            '要么下面这条正则失效了：\n'
            '     %s\n'
            '   ⚠ 就这么往下走的话，会出一个**没有字体**的 APK —— 而手机上只表现为\n'
            '     「字体悄悄退化成系统字体」，不报任何错。\n' % (html_name, RE_FONT.decode()))
        return 1

    if not list_only:
        if not os.path.isdir(fonts_dir):
            sys.stderr.write('❌ 找不到字体目录：%s\n' % fonts_dir)
            return 1
        missing = [r for r in refs
                   if not os.path.exists(os.path.join(fonts_dir, r[len('fonts/'):]))]
        if missing:
            sys.stderr.write('❌ 页面引用了这些字体，但源目录里没有：\n')
            for m in missing:
                sys.stderr.write('     %-46s -> %s\n'
                                 % (m, os.path.join(fonts_dir, m[len('fonts/'):])))
            sys.stderr.write('   装进去会 404 ⇒ 手机上只表现为「字体悄悄退化成系统字体」，不报错。\n')
            return 1

    sys.stdout.write('\n'.join(refs) + ('\n' if refs else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
