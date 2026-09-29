#!/usr/bin/env bash
# run.sh —— 桌面端契约测试。**不需要手机，不需要模拟器，不需要联网。**
#
# 它把「App 内原生转发」这条链路的**除 WebView 之外**全部真跑一遍：
#
#   本地假上游  ←──  真 AiProxy（真 JVM）  ──→  真 JsEvent  ──→  真垫片（Node）
#        └──────────────── 往返比对：服务器真发出去的字节 == 页面侧还原出的字节 ───────┘
#
# ⚠⚠ 为什么值得为这个专门写一套
#   「AI 跨域转发」这件事天然是「看起来对、只有装到手机上才知道对不对」的那种代码：
#   编译过、APK 装得上、界面也不报错，然后请求静静地失败。
#   所以这里把**能脱离 WebView 验证的部分全部验证掉**，
#   剩下真正无法验证的只有两件事，README 里明写了：
#     ① evaluateJavascript 的实际投递时序；② 真的连上 Google。
#
# 用法：bash run.sh

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID="$(cd "$HERE/../.." && pwd)"

PYBIN="${PYBIN:-C:/Users/YanSaki/.workbuddy-ai/binaries/python/versions/3.13.12/python.exe}"
NODE="${NODE:-C:/Users/YanSaki/.workbuddy-ai/binaries/node/versions/22.22.2-3/node.exe}"

# 桌面 javac：这里**不**对着 android.jar 编译（这两个类刻意不依赖 android.*），
# 所以不受 build.sh 那条「javac 必须 11/17」的约束。随便一个 JDK 都行。
JAVAC="${JAVAC:-}"
if [ -z "$JAVAC" ]; then
    for cand in "C:/Program Files/Java/jdk-21/bin/javac.exe" \
                "C:/Program Files/Java/jdk-11/bin/javac.exe" \
                "C:/Program Files/Java/jdk-17/bin/javac.exe"; do
        [ -x "$cand" ] && { JAVAC="$cand"; break; }
    done
fi
[ -n "$JAVAC" ] && [ -x "$JAVAC" ] || { echo "❌ 找不到 javac，设 JAVAC=... 指过来"; exit 1; }
JAVA="${JAVAC%/javac.exe}/java.exe"

# ⚠ 本机控制台是 GBK 代码页，Java 18+ 的 stdout.encoding 会跟着它走 ⇒ 输出里的 ✅ 全变成 `?`，
#   整个输出还会因为编码混杂而被解码器猜成 GBK、中文变乱码。
#   这里显式把 stdout/stderr 钉成 UTF-8，让三段输出（bash / java / node）保持一致。
JAVA_ENC=(-Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8)
export PYTHONIOENCODING=utf-8

[ -x "$PYBIN" ] || { echo "❌ 找不到 python：$PYBIN"; exit 1; }
[ -x "$NODE" ] || { echo "❌ 找不到 node：$NODE"; exit 1; }

WORK="${WORK:-$HERE/.work}"

# ⚠⚠ 清空 .work 必须**回读确认**，不能只发一句 `rm -rf` 就走。
#   本环境的 shell `rm` 是个包了「安全删除」（genie-trash）的**函数**。
#   它对**刚被 kill 掉的进程写过**的目录树会失败：
#       [safe-delete][SAFE_DELETE_FAIL_CLOSED] … Some operations were aborted
#   rc=1，而本脚本用的是 `set -uo pipefail`（**没有 -e**）⇒ 脚本照跑。
#   同一句 `rm -rf` 在 build.sh 里是响的（那边有 `-e`），在这里是**哑的**。
#
#   为什么这不是洁癖问题：清不掉就留着上一轮的 expected/*.bin，
#   而 server.py 这一轮要是没写出 sse.bin，contract.test.js 会拿**上一轮的录制**
#   去比 —— 那是「拿旧数据当真值」，比直接报错难查得多。
#
#   所以：① 先走 rm（回收站，符合本项目删东西的习惯）；
#        ② 还在就换 **python shutil.rmtree**（真删，另一条机制）；
#        ③ 还在就由调用方**报错退出**，绝不带着上一轮的残留往下跑。
purge_work() {
    rm -rf "$WORK" 2>/dev/null
    if [ -e "$WORK" ]; then
        "$PYBIN" -c 'import shutil,sys; shutil.rmtree(sys.argv[1], ignore_errors=True)' \
            "$WORK" 2>/dev/null
    fi
    [ ! -e "$WORK" ]
}

if ! purge_work; then
    echo "❌ 清不掉 $WORK —— 上一轮的 expected/*.bin 会冒充这一轮的录制，拒绝继续"
    echo "   目录里还剩：$(ls -A "$WORK" 2>/dev/null | tr '\n' ' ')"
    exit 1
fi
mkdir -p "$WORK/classes" "$WORK/expected"

PORT=$(( 8700 + RANDOM % 200 ))

cleanup() {
    if [ -n "${SRV_PID:-}" ]; then
        kill "$SRV_PID" 2>/dev/null
        # ⚠⚠ 必须 `wait` 到它**真的退出**，不能 kill 完就走。
        #   不等的话，收尾那句 purge_work 会因为 server.log 还被这个进程占着而删不掉 ——
        #   实测：kill 完立刻 `rm -rf .work` → SAFE_DELETE_FAIL_CLOSED / rc=1；
        #   同一个目录等几秒再删 → rc=0。也就是说这**纯粹是个竞态**，
        #   而它的表现（「中间产物没删掉」）看起来像删除机制坏了，害我去查 genie-trash。
        wait "$SRV_PID" 2>/dev/null
    fi
}
trap cleanup EXIT

echo "== 0. 起本地假上游（端口 $PORT）=="
"$PYBIN" "$HERE/server.py" "$WORK/expected" "$PORT" > "$WORK/server.log" 2>&1 &
SRV_PID=$!
for _ in $(seq 1 50); do
    grep -q "^READY" "$WORK/server.log" 2>/dev/null && break
    sleep 0.2
done
if ! grep -q "^READY" "$WORK/server.log" 2>/dev/null; then
    echo "❌ 服务器没起来。日志："
    sed 's/^/   /' "$WORK/server.log"
    exit 1
fi
echo "   ✅ 已就绪"

echo
echo "== 1. 编译 AiProxy + JsEvent + Harness（真 javac，真 JVM）=="
# ⚠ 刻意**只**编译这三个文件：它们必须能在没有 android.jar 的情况下编译通过。
#   一旦有人往 AiProxy/JsEvent 里加了 android.* 的引用，这一步会当场红 ——
#   这正是「这一层可测试」这条性质的守门人。
"$JAVAC" -d "$WORK/classes" -encoding UTF-8 \
    "$ANDROID/src/top/yansaki/shed/AiProxy.java" \
    "$ANDROID/src/top/yansaki/shed/JsEvent.java" \
    "$HERE/Harness.java" 2>&1 | sed 's/^/   /'
NCLASS=$(find "$WORK/classes" -name '*.class' | wc -l)
[ "$NCLASS" -ge 4 ] || { echo "❌ 只产出 $NCLASS 个 class —— javac 大概失败了"; exit 1; }
echo "   ✅ 编译出 $NCLASS 个 class"

echo
echo "== 2. Java 侧：真 AiProxy 打本地服务器 =="
"$JAVA" "${JAVA_ENC[@]}" -cp "$WORK/classes" Harness "http://127.0.0.1:$PORT" "$WORK/events.txt"
JRC=$?

echo
echo "== 3. JS 侧：把录下来的事件回放给真垫片 =="
"$NODE" "$HERE/contract.test.js" "$WORK" "http://127.0.0.1:$PORT"
NRC=$?

echo
if [ "$JRC" -eq 0 ] && [ "$NRC" -eq 0 ]; then
    echo "== 契约测试全部通过 =="
    echo "   （仍**未**验证：evaluateJavascript 的投递时序、真的连上 Google —— 见 README）"
    # ⚠⚠ 顺序很关键：**先停掉服务器（并等它真的退出），再删 .work**。
    #   原来是在这里直接 purge，而服务器的 EXIT trap 要到 `exit 0` **之后**才跑 ——
    #   于是删的时候 server.log 还被那个进程占着，purge 必然失败。
    #   这个顺序问题伪装成了「删除机制坏了」：我为此去查了 genie-trash、
    #   试了 shutil.rmtree 兜底、还加了 wait —— 全都没用，因为问题不在删法上。
    cleanup
    SRV_PID=""
    # 收尾清理是**尽力而为**：删不掉不该把一套全绿的测试判成失败。
    # ⚠ 但也**不能一声不吭** —— 静默留下的东西下一轮会被开头的 purge 强制清掉，
    #   可要是那句 purge 也失手，就会变成「拿旧录制当真值」。所以说一声。
    purge_work || echo "   ⚠ 中间产物没删掉（$WORK）；下一轮开头会强制清空，删不掉就拒跑"
    exit 0
fi
echo "== ❌ 契约测试失败（Java 侧 rc=$JRC / JS 侧 rc=$NRC）=="
echo "   中间产物留在 $WORK（方便对着看）"
exit 1
