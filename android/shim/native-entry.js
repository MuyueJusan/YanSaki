// 「✨ 新界面」入口（APK 专属）—— 往左上那个下拉菜单里塞一个按钮。
//
// ⚠ 为什么用注入而不是改页面：网页版必须**一个字节都不动**（用户明确要求这个设计
//   只在 APK 里）。注入点选的是 `.mobile-nav-box`（菜单项的容器），
//   而不是某个具体按钮的后面 —— 后者在菜单项顺序变了之后会插到奇怪的位置。
//
// ⚠ 产品会重绘吗？`#mobile-nav` 是静态标记（在 100-BODY 里写死的），不会被 innerHTML
//   重刷，所以这里 append 一次就够了。但为了保险，带一个 id 判重。
(function () {
    'use strict';
    if (document.getElementById('ys-native-entry')) return;

    var box = document.querySelector('#mobile-nav .mobile-nav-box');
    if (!box) return;

    var btn = document.createElement('button');
    btn.id = 'ys-native-entry';
    btn.type = 'button';
    btn.className = 'mobile-nav-item';
    btn.textContent = '✨ 新界面';
    btn.setAttribute('title', 'Material 3 Expressive · 原生界面（仅 APK）');

    btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        try { if (typeof closeMobileNav === 'function') closeMobileNav(); } catch (err) { }
        try {
            if (window.YanSakiNative && window.YanSakiNative.openNativeUi) {
                window.YanSakiNative.openNativeUi();
            } else {
                console.warn('[ys-native] 没有 YanSakiNative.openNativeUi');
            }
        } catch (err) {
            console.warn('[ys-native] 打开失败', err);
        }
    });

    box.appendChild(btn);
})();
