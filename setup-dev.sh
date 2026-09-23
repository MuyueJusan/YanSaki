#!/usr/bin/env bash
# 在一台新设备上，把仓库里的「技能」和「记忆」装回工作台。
#
# 为什么需要这个脚本：
#   `.workbuddy-ai/` **不进仓库**（里面还有 git 凭据），所以技能与记忆在仓库里
#   只是**镜像**，文件名 / 路径跟运行时都对不上 —— 手动 cp 很容易装错地方或装反方向。
#
# 用法：
#   bash setup-dev.sh              # 只看计划（默认，什么都不改）
#   bash setup-dev.sh --go         # 真执行：**只补本地没有的**，已存在的一律不动
#   bash setup-dev.sh --go --force # 连已存在的也覆盖（比如你在别的设备上改过、要拉回来）
#
# ⚠ 这个脚本**绝不碰** `.workbuddy-ai/git/credentials`。
# ⚠ 默认不覆盖是**故意的**：记忆的真相源是本地（`markdown/` 才是副本），
#   在**写这份记忆的那台机器**上跑，覆盖 = 把新内容冲掉。

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIRROR="$ROOT/markdown"
DEST_MEM="$ROOT/.workbuddy-ai/memory"
DEST_SKILLS="${HOME}/.workbuddy-ai/skills"

GO=0
FORCE=0
for a in "$@"; do
  case "$a" in
    --go)    GO=1 ;;
    --force) FORCE=1 ;;
    -h|--help)
      sed -n '2,18p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "未知参数：$a（试 --help）"; exit 2 ;;
  esac
done

say()  { printf '  %s\n' "$*"; }
run()  { if [ "$GO" = 1 ]; then "$@"; else say "[dry] $*"; fi; }

# 把镜像装到目标；已存在且内容不同时，只有 --force 才覆盖。
install() {
  local src="$1" dst="$2" label="$3"
  if [ ! -f "$src" ]; then say "跳过（镜像不在）：$label"; return; fi
  if [ -e "$dst" ]; then
    if cmp -s "$src" "$dst"; then say "一致，不动：$label"; return; fi
    if [ "$FORCE" != 1 ]; then
      say "⚠ 已存在且不同，跳过（要覆盖加 --force）：$label"
      say "    本地 $dst"
      say "    镜像 $src"
      return
    fi
    say "覆盖：$label"
    run cp -p "$src" "$dst"
    return
  fi
  say "新建：$label"
  run mkdir -p "$(dirname "$dst")"
  run cp -p "$src" "$dst"
}

echo "仓库根：$ROOT"
echo

echo "== 记忆  ->  $DEST_MEM =="
run mkdir -p "$DEST_MEM"
for f in MEMORY.md RULES.md; do
  install "$MIRROR/$f" "$DEST_MEM/$f" "$f"
done
# 日志：文件名带日期，逐份过
for f in "$MIRROR"/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].md; do
  [ -e "$f" ] || continue
  b="$(basename "$f")"
  install "$f" "$DEST_MEM/$b" "$b"
done

echo
echo "== 技能  ->  $DEST_SKILLS =="
# 「一份镜像文件 -> 一个技能目录」，路径对不上，所以这里显式映射。
for pair in \
  "SKILL.md:verify-single-file-html-app" \
  "SKILL-git-push.md:git-push-existing-github-repo" ; do
  install "$MIRROR/${pair%%:*}" "$DEST_SKILLS/${pair##*:}/SKILL.md" "${pair##*:}/SKILL.md"
done

echo
if [ "$GO" = 1 ]; then
  echo "完成。"
  echo "⚠ 凭据不在仓库里，新设备上第一次推送要自己配一次 ——"
  echo "  见技能 git-push-existing-github-repo 第 3 节（凭据文件要放在 gitignore 掉的目录里）。"
else
  echo "以上只是计划。确认无误后："
  echo "   bash setup-dev.sh --go"
fi
