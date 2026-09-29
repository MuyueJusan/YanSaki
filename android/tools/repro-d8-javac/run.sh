#!/usr/bin/env bash
# 跑出「javac 版本 → d8 能不能吃」的对照表。**只读**，产物都留在临时目录。
#
# 期望结果（2026-09-29 本机实测）：
#     jdk-11  class=3  →  ✅ d8 OK
#     jdk-21  class=3  →  ❌ d8 内部 NPE
#     jdk-24  class=3  →  ❌ d8 内部 NPE
#
# ⚠⚠ 每条都要先看 class 数量。javac 失败时**仍然退出 0**，而 d8 对**空 jar** 会「成功」产出 ——
#    于是会看到一排假绿的 ✅。这个假绿我本轮真踩过一次，还拿它得出了错误结论。

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
D8="${D8:-/c/Users/YanSaki/.workbuddy-ai/android-sdk/build-tools/34.0.0/d8.bat}"
JAR_TOOL="${JAR_TOOL:-C:/Program Files/Java/jdk-21/bin/jar.exe}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "d8 = $D8"
echo
for J in 11 17 21 24; do
    D="C:/Program Files/Java/jdk-$J"
    if [ ! -x "$D/bin/javac.exe" ]; then
        printf 'jdk-%-3s 不在本机，跳过\n' "$J"
        continue
    fi
    rm -rf "$TMP/c" "$TMP/o"; mkdir -p "$TMP/c" "$TMP/o"
    "$D/bin/javac.exe" -source 8 -target 8 -nowarn -encoding UTF-8 \
        -d "$TMP/c" "$HERE/MinTest2.java" >"$TMP/javac.log" 2>&1
    N=$(find "$TMP/c" -name '*.class' | wc -l)
    if [ "$N" -eq 0 ]; then
        printf 'jdk-%-3s class=0  ⚠ javac 编译失败，本条结论无效 —— 原因：%s\n' \
            "$J" "$(head -1 "$TMP/javac.log")"
        continue
    fi
    ( cd "$TMP/c" && "$JAR_TOOL" cf "$TMP/j.jar" . )
    R=$(timeout 120 "$D8" --min-api 29 --output "$TMP/o" "$TMP/j.jar" 2>&1 | head -1)
    printf 'jdk-%-3s class=%s  →  %s\n' "$J" "$N" "${R:-✅ d8 OK}"
done
