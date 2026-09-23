#!/usr/bin/env node
// api-push.js —— **git-over-HTTPS 被挡死时的兜底推送**（用 Git Data API 代替 `git push`）。
//
// 什么时候需要它（2026-09-23 实测）：
//   本机的 git 必须走本地代理（直连 `github.com:443` 不通），而代理会周期性对 `github.com`
//   返回 `CONNECT tunnel failed, response 502` —— 连续 11 次、跨 4 分钟全失败。
//   同时 `api.github.com` **直连正常**（Node 的 `fetch` 不走 `http_proxy`）⇒ 用 REST API 推。
//
// ⚠⚠ 核心手法：**复刻一模一样的 commit 元数据**（tree / parent / author / committer / message
//   都从本地 `git cat-file commit` 里原样取出），这样远端算出来的 sha 会**等于本地的 sha**
//   ⇒ **远端与本地同 sha、零分叉**，`git status` 里不会出现「本地领先一个不同哈希的提交」。
//   ⚠ 每一步都拿本地 `git rev-parse` 的 sha 当**闸门**：任何一步对不上就**立刻退出**，
//   此时远端 ref **一个字节都没动**（create blob / tree / commit 都不会移动 ref），
//   只会留下几个 dangling 对象。**最后一步 `force: false`**，非快进会被 GitHub 自己拒掉。
//
// 用法：
//   node _verify/api-push.js                # 把本地领先远端的 commit 推上去（默认 dry-run！）
//   node _verify/api-push.js --go           # 真推
//   node _verify/api-push.js --go --branch=main
//
// ⚠ **默认 dry-run** —— 会写远端的脚本不该把「写」设成默认动作（同 `_purge-tmp.js` / `setup-dev.sh`）。
// ⚠ 全程**不打印令牌**。
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CRED = path.join(ROOT, '.workbuddy-ai', 'git', 'credentials');
const REPO = 'MuyueJusan/YanSaki';

const GO = process.argv.includes('--go');
const branchArg = process.argv.find(a => a.startsWith('--branch='));
const BRANCH = branchArg ? branchArg.split('=')[1] : 'main';

const git = (...a) => cp.execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
const gitBuf = (...a) => cp.execFileSync('git', a, { cwd: ROOT, encoding: 'buffer' });

function token() {
    if (!fs.existsSync(CRED)) return null;
    const line = fs.readFileSync(CRED, 'utf8').split(/\r?\n/).find(l => l.trim());
    const m = line && line.match(/^https:\/\/[^:]+:([^@]+)@/);
    return m ? m[1] : null;   // ⚠ 调用方永远不要打印它
}

async function api(tok, url, method, body) {
    const r = await fetch('https://api.github.com' + url, {
        method: method || 'GET',
        headers: Object.assign({
            'Authorization': 'Bearer ' + tok,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'saki-api-push'
        }, body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined
    });
    const t = await r.text();
    let b = null;
    try { b = JSON.parse(t); } catch (e) { b = t.slice(0, 300); }
    return { status: r.status, body: b };
}

// `git cat-file commit <sha>` → { tree, parents[], author, committer, message }
function readCommit(sha) {
    const raw = gitBuf('cat-file', 'commit', sha).toString('utf8');
    const nl = raw.indexOf('\n\n');
    const head = raw.slice(0, nl).split('\n');
    const msg = raw.slice(nl + 2);                       // ⚠ 含结尾换行，原样保留
    const one = k => { const l = head.find(x => x.startsWith(k + ' ')); return l ? l.slice(k.length + 1) : null; };
    const who = s => {
        const m = s.match(/^(.*) <([^>]*)> (\d+) ([+-]\d{4})$/);
        const tz = m[4];
        const off = (tz[0] === '-' ? -1 : 1) * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5)));
        // ⚠ 给 GitHub 的 date 用 ISO；带同样的 offset，GitHub 才会写出同样的 `+HHMM`
        const iso = new Date((Number(m[3]) + off * 60) * 1000)
            .toISOString().replace(/\.\d{3}Z$/, tz.slice(0, 3) + ':' + tz.slice(3));
        return { name: m[1], email: m[2], date: iso };
    };
    return {
        sha: sha,
        tree: head.find(l => l.startsWith('tree ')).slice(5),
        parents: head.filter(l => l.startsWith('parent ')).map(l => l.slice(7)),
        author: who(one('author')),
        committer: who(one('committer')),
        message: msg
    };
}

function die(msg) { console.log('\n❌ ' + msg + '\n（远端 ref 未改动）'); process.exit(1); }

(async () => {
    const tok = token();
    if (!tok) die('读不到凭据（' + path.relative(ROOT, CRED) + '）');

    // ---------- 远端现状 ----------
    const ref = await api(tok, '/repos/' + REPO + '/git/ref/heads/' + BRANCH);
    if (ref.status !== 200) die('读 ref 失败 HTTP ' + ref.status + ' ' + JSON.stringify(ref.body));
    const remoteHead = ref.body.object.sha;

    const localHead = git('rev-parse', 'HEAD');
    console.log('== 现状 ==');
    console.log('  远端 refs/heads/' + BRANCH + ' = ' + remoteHead);
    console.log('  本地 HEAD                 = ' + localHead);
    if (remoteHead === localHead) {
        console.log('\n✅ 已经一致，没什么要推的。');
        process.exit(0);
    }

    // 远端必须是本地 HEAD 的祖先，否则不是快进 —— 先拉再推，别硬来
    let ancestors;
    try {
        ancestors = git('rev-list', localHead).split('\n');
    } catch (e) { die('读本地历史失败：' + e.message); }
    if (!ancestors.includes(remoteHead)) {
        die('远端 HEAD 不是本地 HEAD 的祖先 ⇒ 不是快进。\n' +
            '   远端有本地没有的东西，或历史分叉了。**先 `git fetch` 看清楚**，别用 force。');
    }

    const chain = [];
    for (let s = localHead; s !== remoteHead; s = git('rev-parse', s + '^')) chain.unshift(s);
    console.log('\n== 要推 ' + chain.length + ' 个 commit ==');
    chain.forEach(s => console.log('  ' + s.slice(0, 7) + '  ' + git('log', '-1', '--format=%s', s)));

    if (!GO) {
        console.log('\n（dry-run）加 `--go` 才真推。');
        process.exit(0);
    }

    // ---------- 逐个 commit 复刻 ----------
    let prevTree = null;
    for (const sha of chain) {
        const c = readCommit(sha);
        console.log('\n--- ' + sha.slice(0, 7) + ' ---');

        if (!prevTree) {
            const rc = await api(tok, '/repos/' + REPO + '/git/commits/' + c.parents[0]);
            if (rc.status !== 200) die('读远端父提交失败 HTTP ' + rc.status);
            prevTree = rc.body.tree.sha;
        }
        const wantTree = git('rev-parse', sha + '^{tree}');

        // 这个 commit 相对父提交改了哪些路径（`--no-renames` 让 R 变回 A+D，解析简单）
        const st = git('diff-tree', '-r', '--no-renames', '--name-status', '-z',
            c.parents[0], sha).split('\0').filter(Boolean);
        const entries = [];
        for (let i = 0; i < st.length; i += 2) {
            const status = st[i], p = st[i + 1];
            if (status === 'D') {
                entries.push({ path: p, mode: '100644', type: 'blob', sha: null });   // null = 从 base_tree 里删掉
                console.log('  删除 ' + p);
                continue;
            }
            const mode = git('ls-tree', sha, '--', p).split(/\s+/)[0];
            const blobBytes = gitBuf('cat-file', 'blob', sha + ':' + p);
            const b = await api(tok, '/repos/' + REPO + '/git/blobs', 'POST',
                { content: blobBytes.toString('base64'), encoding: 'base64' });
            if (b.status !== 201 && b.status !== 200) die('建 blob 失败（' + p + '）HTTP ' + b.status);
            const wantBlob = git('rev-parse', sha + ':' + p);
            if (b.body.sha !== wantBlob) die('blob sha 不一致（' + p + '）：远端 ' + b.body.sha + ' vs 本地 ' + wantBlob);
            entries.push({ path: p, mode: mode, type: 'blob', sha: b.body.sha });
            console.log('  ' + status + ' ' + p + '  → blob ' + b.body.sha.slice(0, 10) + ' ✅');
        }

        const t = await api(tok, '/repos/' + REPO + '/git/trees', 'POST',
            { base_tree: prevTree, tree: entries });
        if (t.status !== 201 && t.status !== 200) die('建 tree 失败 HTTP ' + t.status + ' ' + JSON.stringify(t.body));
        if (t.body.sha !== wantTree) die('tree sha 不一致：远端 ' + t.body.sha + ' vs 本地 ' + wantTree);
        console.log('  tree ' + t.body.sha.slice(0, 10) + ' ✅');

        const cm = await api(tok, '/repos/' + REPO + '/git/commits', 'POST', {
            message: c.message, tree: wantTree, parents: c.parents,
            author: c.author, committer: c.committer
        });
        if (cm.status !== 201 && cm.status !== 200) die('建 commit 失败 HTTP ' + cm.status + ' ' + JSON.stringify(cm.body));
        if (cm.body.sha !== sha) {
            die('commit sha 不一致：远端 ' + cm.body.sha + ' vs 本地 ' + sha +
                '\n   ⇒ 元数据没能完全复刻。**不移动 ref**，本地这些 commit 留到下次能 `git push` 时再走。');
        }
        console.log('  commit ' + cm.body.sha.slice(0, 10) + ' ✅ 与本地同 sha');
        prevTree = wantTree;
    }

    // ---------- 移动 ref（只有全部 sha 一致才走到这儿）----------
    const up = await api(tok, '/repos/' + REPO + '/git/refs/heads/' + BRANCH, 'PATCH',
        { sha: localHead, force: false });
    if (up.status !== 200) die('移动 ref 失败 HTTP ' + up.status + ' ' + JSON.stringify(up.body));

    const after = await api(tok, '/repos/' + REPO + '/git/ref/heads/' + BRANCH);
    const ok = after.status === 200 && after.body.object.sha === localHead;
    console.log('\n== 结果 ==');
    console.log('  refs/heads/' + BRANCH + ' → ' + (after.body && after.body.object && after.body.object.sha));
    console.log(ok
        ? '✅ 远端 = 本地 = ' + localHead + ' —— **同 sha，零分叉**。'
        : '⚠ 复核对不上，去看上面。');
    process.exit(ok ? 0 : 1);
})();
