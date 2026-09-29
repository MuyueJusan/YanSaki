#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
add-dex.py —— 把 classes.dex 追加进 aapt2 产出的 APK，并自查关键条目的压缩方式。

⚠ 为什么不用 `zip`：本机 Git Bash 只有 `unzip`，没有 `zip`。
⚠ 为什么用 `ZipFile(..., 'a')`：追加模式打开 r+b，**已有条目的字节原样不动**，
   新条目写在末尾。resources.arsc 的位置与压缩方式因此完全不受影响。
   （自己 read 全部再 write 回去的做法会把 resources.arsc 重排/重压，
     而 targetSdk 30+ 要求它**未压缩且 4 字节对齐**，那样装不上。）

用法：add-dex.py <apk> <classes.dex>
"""
import sys
import zipfile


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    apk, dex_path = sys.argv[1], sys.argv[2]

    with open(dex_path, 'rb') as f:
        dex = f.read()

    # 幂等：已经塞过就先删掉，免得出现两条 classes.dex
    with zipfile.ZipFile(apk, 'r') as z:
        has = 'classes.dex' in z.namelist()
    if has:
        # 只删这一条。zipfile 没有「删条目」API，且重写会动到 resources.arsc，
        # 所以这里直接把 APK 回退掉更安全 —— 但 aapt2 的产物已经没了，
        # 因此改成：直接报错退出，让 build.sh 从头重跑（它本来就会 rm -rf build）。
        print('❌ APK 里已经有 classes.dex 了 —— 请重跑 build.sh（它会重建 build/）')
        return 1

    zi = zipfile.ZipInfo('classes.dex', date_time=(1980, 1, 1, 0, 0, 0))
    zi.compress_type = zipfile.ZIP_STORED     # 不压缩：省得每次启动都要解压
    zi.external_attr = 0o644 << 16

    with zipfile.ZipFile(apk, 'a') as z:
        z.writestr(zi, dex)

    print('   classes.dex 已追加（%d 字节，Stored）' % len(dex))

    # ---- 自查 ----
    print('   --- 关键条目 ---')
    ok = True
    with zipfile.ZipFile(apk, 'r') as z:
        names = z.namelist()
        for n in ('resources.arsc', 'AndroidManifest.xml', 'classes.dex', 'assets/index.html'):
            if n not in names:
                print('   ❌ 缺条目：%s' % n)
                ok = False
                continue
            i = z.getinfo(n)
            method = 'Stored' if i.compress_type == 0 else 'Deflated'
            print('   %-22s %-9s %9d 字节' % (n, method, i.file_size))
            if n == 'resources.arsc' and i.compress_type != 0:
                print('      ❌ resources.arsc 被压缩了 —— targetSdk 30+ 会装不上')
                ok = False

        # classes.dex 必须在根目录，且不能有第二个
        if names.count('classes.dex') != 1:
            print('   ❌ classes.dex 出现 %d 次（应为 1）' % names.count('classes.dex'))
            ok = False

    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
