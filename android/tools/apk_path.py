#!/usr/bin/env python3
"""算出「这一版出货 APK 的路径」—— **单一实现**。

⚠ 为什么要单独一个文件：有**四处**都需要知道「这次的 APK 叫什么」
（`build.sh` / `verify.sh` / `tools/reverse-lfhname.py` / `tools/reverse-ai.py`），
而文件名里的版本号来自 `AndroidManifest.xml`。第一版是在每处各写一遍
`YanSakiShed-1.0.apk` ⇒ 一提版本，四处**一起过时**：

  · `verify.sh` 报「找不到 APK」——看起来像构建没产出
  · 两个反向测试报「前置不满足，中止」——看起来像环境坏了

而**真正的原因**只是那一行旧了。RULES 六之四十八：
「过时断言」是「永真断言」的镜像 —— 一个永远红、一个永远绿，都会让人不再看它。

⚠ 文件名用下划线（`apk_path.py`）而不是像隔壁 `pick-fonts.py` 那样用连字符：
   连字符的模块名**没法 import**，而这里就是要给别的脚本 import 的。

用法（命令行）：python tools/apk_path.py        # 打印路径
用法（import）：from apk_path import apk_path
"""
import os
import re

ANDROID = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ANDROID, 'AndroidManifest.xml')


def version_name(manifest=MANIFEST):
    """从 AndroidManifest.xml 读 android:versionName；读不出来返回 ''。"""
    with open(manifest, 'r', encoding='utf-8') as f:
        txt = f.read()
    m = re.search(r'android:versionName="([^"]*)"', txt)
    return m.group(1).strip() if m else ''


def apk_path():
    """出货 APK 的绝对路径。

    ⚠ 读不出版本号就**当场退出**，绝不退回一个写死的旧名字 ——
      那样提完版本它会说「找不到 YanSakiShed-1.0.apk」，
      看着像「构建没产出」，其实是这里过时了（把失败伪装成了另一种失败）。
    """
    v = version_name()
    if not v:
        raise SystemExit('❌ 从 %s 读不出 android:versionName' % MANIFEST)
    return os.path.join(ANDROID, 'build', 'YanSakiShed-%s.apk' % v)


if __name__ == '__main__':
    print(apk_path())
