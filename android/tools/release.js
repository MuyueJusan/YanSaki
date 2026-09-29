#!/usr/bin/env node
// release.js —— 把**这一版**的 APK 挂到 `apk` 分支对应的 GitHub Release 上。
//
// 为什么要有这个脚本（而不是每次手敲一段 node 一行流）：
//   1. ⚠⚠ **「上传成功」不等于「附件就是那个包」。** 附件是 APK 的**第二份拷贝**，
//      不会自己更新。它挂着一个旧版的时候最坑：别人从你给的链接下载，
//      拿到的是旧 App，**而且不报错**。
//      ⇒ 本脚本的最后一步是**把附件下载回来算 sha1，跟本地逐字节比**（往返判据）。
//        这一步不能省 —— 「字段名看着齐」不等于「东西对」（RULES 六之六十一）。
//   2. ⚠ 版本号**只有一个真相源**：`AndroidManifest.xml` 的 `versionName`。
//      这里**不重新实现**一遍读法，直接问 `tools/apk_path.py`（Python 侧那份是单一实现）。
//   3. ⚠ tag 已存在时**拒绝**，不静默覆盖 —— 覆盖会把「谁下载过旧的那份」这件事抹掉。
//
// 用法：
//   node android/tools/release.js              # **默认 dry-run**，只打印要做什么
//   node android/tools/release.js --go         # 真发
//   node android/tools/release.js --verify     # 只核**已有** release 的附件是不是这个包（不写远端）
//   node android/tools/release.js --go --notes-file=/tmp/notes.md
//
// ⚠ 默认 dry-run —— 会写远端的脚本不该把「写」设成默认动作（同 `api-push.js` / `_purge-tmp.js`）。
// ⚠ 全程**不打印令牌**。
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const HERE = __dirname;
const ANDROID = path.resolve(HERE, '..');
const ROOT = path.resolve(ANDROID, '..');
const CRED = path.join(ROOT, '.workbuddy-ai', 'git', 'credentials');
const REPO = 'MuyueJusan/YanSaki';
const BRANCH = 'apk';

const GO = process.argv.includes('--go');
const VERIFY = process.argv.includes('--verify');
const notesArg = process.argv.find(a => a.startsWith('--notes-file='));

// ⚠ 本环境 `spawnSync` / `execFileSync` / `execSync` 一律 EBUSY（RULES 六之四十六）⇒ 异步 spawn
function run(cmd, args) {
    return new Promise((resolve, reject) => {
        const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '', err = '';
        p.stdout.on('data', d => { out += d; });
        p.stderr.on('data', d => { err += d; });
        p.on('error', reject);
        p.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(cmd + ' 退出码 ' + code + '\n' + err)));
    });
}

function die(msg) { console.error('❌ ' + msg); process.exit(1); }

(async () => {
    if (!fs.existsSync(CRED)) die('找不到凭据：' + CRED);
    const cred = fs.readFileSync(CRED, 'utf8').trim();
    const m = cred.match(/x-access-token:([^@]+)@/);
    if (!m) die('凭据文件格式不对（期望 https://x-access-token:<TOKEN>@github.com）');
    const TOK = m[1];
    const H = { 'Authorization': 'Bearer ' + TOK, 'User-Agent': 'yansaki-release', 'Accept': 'application/vnd.github+json' };
    const api = async (p, init) => {
        const r = await fetch('https://api.github.com' + p, Object.assign({ headers: H }, init));
        const body = await r.text();
        let json = null; try { json = JSON.parse(body); } catch (e) {}
        return { status: r.status, json: json, text: body };
    };

    // ⚠⚠ 取附件用的请求头**必须**把覆盖项放最后。
    //   2026-09-29 实测：原本写成 `Object.assign({ 'Accept': 'application/octet-stream' }, H)`，
    //   而 H 里带着 `'Accept': 'application/vnd.github+json'` —— **后面的 H 反手把刚设的盖掉**，
    //   于是 GitHub 返回的是**资产的元数据 JSON**（1514 字节），不是包。
    //   最坑的是：上传照样 201、size 照样 2709559 ⇒ 从上传那一侧**完全看不出问题**，
    //   只有「下载回来逐字节比」这道往返判据能发现（RULES 六之六十一）。
    //   ⇒ 规矩：`Object.assign({}, 基础头, { 覆盖项 })`，覆盖项**永远放最后**。
    const dlHeaders = Object.assign({}, H, { 'Accept': 'application/octet-stream' });

    // 把附件下回来（不比对，只取字节）。⚠ 跨域重定向到 objects.githubusercontent.com 时
    // fetch 会按规范丢掉 Authorization —— 那是**对的**，签名 URL 自带凭据。
    // 把附件下回来（不比对，只取字节）。
    // ⚠⚠ 必须带**超时**：2026-09-30 实测 —— `--go` 会在这一步**静默挂死**：
    //   输出停在「== 回读核对（往返判据）==」之后**一行都没有**，然后被外部掐掉（SIGTERM）。
    //   ⇒ 后果是**发布路径的往返判据从来没跑完过**，只能靠事后再跑一次 `--verify` 补。
    //   ⇒ 没有超时的请求 = 把「失败」伪装成「卡住」。超时 + 重试，让它要么成、要么报错。
    // ⚠ 跨域重定向到 objects.githubusercontent.com 时 fetch 会按规范丢掉 Authorization
    //   —— 那是**对的**，签名 URL 自带凭据。
    const fetchAsset = async (url, tries = 3) => {
        let lastErr = null;
        for (let i = 1; i <= tries; i++) {
            try {
                const r = await fetch(url, { headers: dlHeaders, signal: AbortSignal.timeout(60000) });
                if (r.status !== 200) { lastErr = new Error('HTTP ' + r.status); continue; }
                return Buffer.from(await r.arrayBuffer());
            } catch (e) {
                lastErr = e;
                console.log('   ⚠ 第 ' + i + ' 次取附件失败：' + (e && e.message ? e.message : e) + '，重试…');
            }
        }
        die('下载附件失败（试了 ' + tries + ' 次）：' + (lastErr && lastErr.message ? lastErr.message : lastErr));
    };

    const sha1Of = (b) => crypto.createHash('sha1').update(b).digest('hex');

    // ⚠⚠ 往返判据**只有这一份实现**，`--go` 和 `--verify` 都调它。
    //   为什么必须共用：`--go` 原来用的是**上传响应**里的 `asset.url`，而 `--verify` 用的是
    //   「重新列资产」拿到的 `hit.url` —— 两条路看着一样，实际不是同一段代码，
    //   于是「`--verify` 能跑完」证明不了「`--go` 能跑完」（实测确实不能）。
    //   ⇒ 判据只能有一份实现，才谈得上「验过就是验过」。
    const roundTrip = async (relId, name, local, sha1) => {
        const assets = await api('/repos/' + REPO + '/releases/' + relId + '/assets');
        if (assets.status !== 200) die('列资产失败 HTTP ' + assets.status);
        const hit = (assets.json || []).find(a => a.name === name);
        if (!hit) die('release ' + relId + ' 里没有 ' + name +
            '（现有：' + ((assets.json || []).map(a => a.name).join(', ') || '一个都没有') + '）');
        console.log('  asset id = ' + hit.id + '   远端登记大小 ' + hit.size + ' 字节');
        const back = await fetchAsset(hit.url);
        console.log('  下载回来     ' + back.length + ' 字节  sha1 ' + sha1Of(back));
        console.log('  本地 APK     ' + local.length + ' 字节  sha1 ' + sha1);
        if (!back.equals(local)) {
            die('⚠⚠ 附件与本地 APK **不一致** —— 这个 release 不能对外说「就是它」。\n' +
                '   （release id=' + relId + '，去网页上删掉重来）');
        }
        console.log('  ✅ 逐字节一致');
    };

    // ---- 1. 这一版叫什么、在哪 ----
    // ⚠ 版本号问 Python 那份（单一实现），别在 JS 里再写一遍正则
    const PYBIN = process.env.PYBIN || 'C:/Users/YanSaki/.workbuddy-ai/binaries/python/envs/default/Scripts/python.exe';
    let apkPath;
    try { apkPath = await run(PYBIN, [path.join(HERE, 'apk_path.py')]); }
    catch (e) { die('问 tools/apk_path.py 要路径失败：' + e.message); }
    if (!fs.existsSync(apkPath)) die('APK 不存在：' + apkPath + '\n   （先 bash android/build.sh）');

    const ver = path.basename(apkPath).replace(/^YanSakiShed-/, '').replace(/\.apk$/, '');
    const TAG = 'apk-v' + ver;
    const local = fs.readFileSync(apkPath);
    const sha1 = crypto.createHash('sha1').update(local).digest('hex');

    console.log('== 这一版 ==');
    console.log('  APK      ' + apkPath);
    console.log('  版本     ' + ver + '   （读自 AndroidManifest.xml，经 tools/apk_path.py）');
    console.log('  大小     ' + local.length + ' 字节');
    console.log('  sha1     ' + sha1);
    console.log('  tag      ' + TAG);

    // ---- 1b. --verify：只核已有 release，一个字节都不写 ----
    // ⚠ 为什么要有这条：tag 存在时发布路径会**拒绝**（不静默覆盖，见下）。
    //   可「拒绝」之后就没路了 —— 而「这个 release 上挂的到底是不是那个包」
    //   恰恰是最需要能随时复查的一件事。所以校验必须是**独立于发布**的一条路。
    if (VERIFY) {
        console.log('\n== 校验已有 release（不写远端）==');
        const rel = await api('/repos/' + REPO + '/releases/tags/' + TAG);
        if (rel.status !== 200) die('release ' + TAG + ' 不存在（HTTP ' + rel.status + '）—— 还没发过');
        console.log('  release id = ' + rel.json.id);
        await roundTrip(rel.json.id, path.basename(apkPath), local, sha1);
        console.log('\n  https://github.com/' + REPO + '/releases/tag/' + TAG);
        process.exit(0);
    }

    // ---- 2. 远端 apk 分支当前在哪（release 的 target）----
    const ref = await api('/repos/' + REPO + '/git/ref/heads/' + BRANCH);
    if (ref.status !== 200) die('读远端 ' + BRANCH + ' 失败 HTTP ' + ref.status);
    const target = ref.json.object.sha;
    console.log('  远端 ' + BRANCH + ' = ' + target);

    // ---- 3. tag 已存在就拒绝 ----
    const exists = await api('/repos/' + REPO + '/releases/tags/' + TAG);
    if (exists.status === 200) {
        die('release ' + TAG + ' **已经存在**（id=' + exists.json.id + '）。\n' +
            '   不静默覆盖 —— 覆盖会抹掉「谁下载过旧的那份」这件事。\n' +
            '   真要重发就先在网页上删掉它，或者把版本号提上去。');
    }
    if (exists.status !== 404) die('查 tag 失败 HTTP ' + exists.status + ' ' + exists.text.slice(0, 200));

    const notes = notesArg
        ? fs.readFileSync(notesArg.split('=')[1], 'utf8')
        : '网页版（`main` 分支）与这份 APK 用的是**同一份** `saki.html`，只是套了一层 WebView。\n\n' +
          '- 版本号 `versionName` = `' + ver + '`，与 tag 对齐\n' +
          '- 内嵌页面 sha1 `' + crypto.createHash('sha1')
              .update(fs.readFileSync(path.join(ROOT, 'saki.html'))).digest('hex') + '`\n' +
          '- 附件 sha1 `' + sha1 + '`\n';

    if (!GO) {
        console.log('\n== dry-run ==（要真发加 --go）');
        console.log('  会建 release ' + TAG + '，target=' + target);
        console.log('  会传附件 ' + path.basename(apkPath));
        console.log('  会下载回来核 sha1');
        console.log('\n--- release 说明 ---\n' + notes);
        process.exit(0);
    }

    // ---- 4. 建 release ----
    console.log('\n== 建 release ==');
    const rel = await api('/repos/' + REPO + '/releases', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, H),
        body: JSON.stringify({
            tag_name: TAG, target_commitish: target, name: TAG,
            body: notes, prerelease: true, draft: false
        })
    });
    if (rel.status !== 201) die('建 release 失败 HTTP ' + rel.status + ' ' + rel.text.slice(0, 300));
    console.log('  id = ' + rel.json.id + '   tag = ' + rel.json.tag_name);
    const relId = rel.json.id;

    // ---- 5. 上传附件 ----
    console.log('\n== 上传附件 ==');
    const name = path.basename(apkPath);
    const up = await fetch('https://uploads.github.com/repos/' + REPO + '/releases/' + relId +
        '/assets?name=' + encodeURIComponent(name), {
        method: 'POST',
        headers: Object.assign({
            'Content-Type': 'application/vnd.android.package-archive',
            'Content-Length': String(local.length)
        }, H),
        body: local
    });
    const upText = await up.text();
    if (up.status !== 201) die('上传失败 HTTP ' + up.status + ' ' + upText.slice(0, 300));
    const asset = JSON.parse(upText);
    console.log('  asset id = ' + asset.id + '   ' + asset.size + ' 字节');

    // ---- 6. ⚠⚠ 下载回来核 sha1（判据是往返，不是「上传成功」）----
    // ⚠ 走**和 `--verify` 同一份** roundTrip：不再用上传响应里的 `asset.url`
    //   （那条路 2026-09-30 实测会静默挂死，见 fetchAsset 的注释）。
    console.log('\n== 回读核对（往返判据）==');
    await roundTrip(relId, name, local, sha1);

    console.log('\n== 完成 ==');
    console.log('  https://github.com/' + REPO + '/releases/tag/' + TAG);
})().catch(e => { console.error('💥 ' + (e && e.stack ? e.stack : e)); process.exit(1); });
