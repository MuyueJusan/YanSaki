#!/usr/bin/env bash
# bash 驱动版整跑。
#
# 为什么留着它（`run-all.js` 才是**首选**）：
#   `run-all.js` 原来用的是 `spawnSync`，而这个环境里 **`spawnSync` / `execFileSync` /
#   `execSync` 一律立刻返回 `EBUSY`**（异步 `spawn` 完全正常），于是 19 套全部打出
#     19 套，共 **0 通过 / 0 失败**，每套一行 `[无] 0.0s ← 没有可解析的汇总行`
#   —— ⚠ 这个输出**长得像「套件全坏了」**，但真正坏的是 runner 起不了子进程
#   （`0.0s` 是唯一线索：真跑过的套件不可能 0.0s）。
#   ⇒ 那一版已改成**异步 `spawn`**，`node run-all.js` 当场恢复。
#   ⇒ 本脚本是**备用**：万一哪天 node 侧起不了子进程，用它绕。
#
# ⚠⚠ 别把上面这段读成「沙箱只放行一层进程创建」—— 那是当时的**误判**
#   （依据是 `spawnSync('where.exe')` / `spawnSync('git')` 也一样 EBUSY），代价是白写这个驱动。
#   真因与教训见 `RULES.md` 六之四十六：
#   **「环境不允许」这个结论，要拿同一件事的另一种写法证伪过再下。**
#
# ⚠ 清单与汇总行正则**只有一份**（在 `suites.js`）—— 两个驱动共用，抄一份必然分叉。
# ⚠ 逐套**串行**，别并发：撞 profile / 端口时红绿都不可信。
#
# 用法：
#   bash run-all.sh                 # 全部 19 套
#   bash run-all.sh st-code.js      # 只跑指定的几个（会大声提示这是部分结果）
#   TIMEOUT_S=1200 bash run-all.sh  # 改单套上限（默认 900s）
set -u

cd "$(dirname "$0")" || exit 1
NODE="${NODE:-node}"
TIMEOUT_S="${TIMEOUT_S:-900}"     # ⚠ 别再往小里调：慢的是走 CDP 的那几套，
                                  #   而**被截断的套件跟「通过了」长得一模一样**（汇总行照样打得出来）

# ── ① 清单跟目录对账（早失败：还没跑就先拦住「新加的 .js 没登记」）──────────
"$NODE" suites.js --audit || exit 1

# ── ② 决定跑哪些 ──────────────────────────────────────────────
mapfile -t ALL < <("$NODE" suites.js --list-suites)
if [ "$#" -gt 0 ]; then
    RUN=("$@")
    for f in "${RUN[@]}"; do
        hit=0
        for a in "${ALL[@]}"; do [ "$a" = "$f" ] && hit=1 && break; done
        if [ "$hit" -eq 0 ]; then
            echo ""
            echo "❌ 这些不在套件清单里：$f"
            exit 1
        fi
    done
    PARTIAL=1
else
    RUN=("${ALL[@]}")
    PARTIAL=0
fi

# ── ③ 逐套跑（串行），输出落临时目录 ────────────────────────────
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
: > "$TMP/meta.txt"

for f in "${RUN[@]}"; do
    out="$TMP/$f.out"
    t0=$(date +%s%N)
    if command -v timeout >/dev/null 2>&1; then
        timeout "${TIMEOUT_S}s" "$NODE" "$f" > "$out" 2>&1
    else
        "$NODE" "$f" > "$out" 2>&1
    fi
    code=$?
    t1=$(date +%s%N)
    ms=$(( (t1 - t0) / 1000000 ))
    # 两路都搜（有的套件把收尾信息打到 stderr）—— 这里已经 2>&1 合流了
    printf '%s %s %s\n' "$f" "$code" "$ms" >> "$TMP/meta.txt"
done

# ── ④ 呈现（表 + 合计 + 退出码，全在 suites.js 里）─────────────
if [ "$PARTIAL" -eq 1 ]; then
    echo ""
    echo "  ⚠ **这是部分结果**（只跑了 ${#RUN[@]} 套，共 ${#ALL[@]} 套）——"
    echo "    别拿这个总数去对 README。要对照就整跑一遍。"
fi
"$NODE" suites.js --report "$TMP" "${RUN[@]}"
