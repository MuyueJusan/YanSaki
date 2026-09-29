// 最小复现：d8（R8 8.2.2，build-tools 34.0.0）解析不了「JDK 21+ 的 javac 在 -target 8 下
// 为**非静态上下文里的匿名类**生成的 class 文件」。
//
// 症状（d8 直接内部崩溃，不是你代码写错）：
//     Error in <jar>:MinTest2$1.class:
//     java.lang.NullPointerException: Cannot invoke "String.length()" because "<parameter1>" is null
//     Compilation failed with an internal error.
//
// 判定实验（2026-09-29 本机实测）：
//     javac 来自 JDK 11  → d8 ✅
//     javac 来自 JDK 21  → d8 ❌
//     javac 来自 JDK 24  → d8 ❌
//   两边产出的 class 文件主版本号**都是 52**，`-g:none` 也去不掉 ⇒ 看字节看不出来。
//
// ⚠ 关键变量是「非静态上下文」：下面这个 `go()` 是实例方法，匿名类因此带一个
//   `this$0` 合成字段指向外部实例。把 go() 改成 static（去掉对外部实例的引用），
//   同一份 javac 编译出来的东西 d8 就能吃。见 MinTest.java。
//
// 跑法见同目录 run.sh。
public class MinTest2 {
    private int x = 1;

    interface Cb { void done(String s); }

    public void go() {                      // ← 实例方法：这一行就是分水岭
        Cb cb = new Cb() {
            public void done(String s) { System.out.println(s + x); }
        };
        cb.done("hi");
    }

    public static void main(String[] a) {
        new MinTest2().go();
    }
}
