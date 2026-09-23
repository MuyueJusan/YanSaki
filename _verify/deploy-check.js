#!/usr/bin/env node
// deploy-check.js —— **只读**。回答一个问题：线上那个页面，是不是本地这份？
//
// 为什么需要它（第十三轮踩的坑）：
//   `git push` 退出码 0 + 远端 blob 一致，**只证明「仓库对了」，不证明「站点对了」**。
//   本项目实测过一次：推送成功、远端 11/11 blob 一致，线上却还是旧版 —— 因为
//   `hugo.yml` / `jekyll-gh-pages.yml` / `static.yml` 三条 workflow 全部
//   `on: push: branches:["main"]` 且全部 `concurrency: { group: "pages" }`，
//   新进入并发组的 run 会取消**已在排队**的那个 ⇒ 它们互相取消，谁恰好在 pending 谁死。
//   被取消的 run **一条 job 都不会有**（`GET .../jobs` 的 `total_count: 0`），
//   而且**根本不会创建 deployment**。
//
// 用法：
//   node _verify/deploy-check.js            # 只比线上 vs 本地
//   node _verify/deploy-check.js --runs     # 顺带查 Actions（需要 .workbuddy-ai/git/credentials）
//
// 退出码：0 = 线上与本地逐字节一致；1 = 不一致 / 取不到。
//
// ⚠ 全程**不打印令牌**。
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://yansaki.top/index.html';
const REPO = 'MuyueJusan/YanSaki';
const CRED = path.join(ROOT, '.workbuddy-ai', 'git', 'credentials');
const WANT_RUNS = process.argv.includes('--runs');

const sha1 = b => crypto.createHash('sha1').update(b).digest('hex');

function localState(name) {
    const p = path.join(ROOT, name);
    if (!fs.existsSync(p)) return null;
    const b = fs.readFileSync(p);
    return { name: name, bytes: b.length, sha1: sha1(b) };
}

async function liveState() {
    // 加时间戳绕开 CDN 缓存；⚠ 别用 HEAD —— HEAD 的 content-length 是压缩后的。
    const r = await fetch(SITE + '?cb=' + Date.now(), { headers: { 'Cache-Control': 'no-cache' } });
    const b = Buffer.from(await r.arrayBuffer());
    return { status: r.status, bytes: b.length, sha1: sha1(b) };
}

function token() {
    if (!fs.existsSync(CRED)) return null;
    const line = fs.readFileSync(CRED, 'utf8').split(/\r?\n/).find(l => l.trim());
    if (!line) return null;
    const m = line.match(/^https:\/\/[^:]+:([^@]+)@/);
    return m ? m[1] : null;   // ⚠ 调用方**永远不要**把这个值打印出来
}

async function gh(url, tok) {
    const r = await fetch('https://api.github.com' + url, {
        headers: {
            'Authorization': 'Bearer ' + tok,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'saki-deploy-check'
        }
    });
    const t = await r.text();
    try { return { status: r.status, body: JSON.parse(t) }; } catch (e) { return { status: r.status, body: null }; }
}

(async () => {
    const loc = localState('index.html');
    const saki = localState('saki.html');

    console.log('== 本地 ==');
    if (!loc) { console.log('  ❌ 找不到 index.html'); process.exit(1); }
    console.log('  index.html : ' + loc.bytes + ' 字节  sha1 ' + loc.sha1);
    if (saki) {
        const same = saki.sha1 === loc.sha1;
        console.log('  saki.html  : ' + saki.bytes + ' 字节  sha1 ' + saki.sha1 +
            (same ? '  ✅ 与 index.html 一致' : '  ❌ 与 index.html 不一致（忘了 cp？站点发布的是 index.html）'));
    }

    console.log('\n== 线上 ==');
    let live;
    try {
        live = await liveState();
    } catch (e) {
        console.log('  ❌ 取不到：' + e.message);
        process.exit(1);
    }
    console.log('  ' + SITE);
    console.log('  ' + live.status + '  ' + live.bytes + ' 字节  sha1 ' + live.sha1);

    const inSync = live.status === 200 && live.sha1 === loc.sha1;
    console.log('\n== 结论 ==');
    if (inSync) {
        console.log('  ✅ 线上与本地 index.html **逐字节一致** —— 改动确实上线了。');
    } else if (live.sha1 === saki.sha1) {
        console.log('  ❌ 线上 = 本地 saki.html，但 index.html 没同步 ⇒ 忘了 `cp saki.html index.html`。');
    } else {
        console.log('  ❌ 线上**不是**本地这一版 —— 部署没落地（或还没跑完）。');
        console.log('     线上 ' + live.bytes + ' 字节，本地 ' + loc.bytes + ' 字节。');
    }

    if (WANT_RUNS) {
        const tok = token();
        if (!tok) {
            console.log('\n== Actions ==\n  （没有可用的凭据，跳过；要看就确认 ' +
                path.relative(ROOT, CRED) + ' 存在）');
        } else {
            console.log('\n== Actions（最近 5 次 static.yml）==');
            const r = await gh('/repos/' + REPO + '/actions/workflows/static.yml/runs?per_page=5', tok);
            if (r.status !== 200 || !r.body || !r.body.workflow_runs) {
                console.log('  查询失败 HTTP ' + r.status);
            } else {
                for (const x of r.body.workflow_runs) {
                    let extra = '';
                    if (x.conclusion === 'cancelled') {
                        // ⚠ 判据：cancelled **且 0 个 job** = 排队阶段被掐（并发组互掐），不是构建失败
                        const j = await gh('/repos/' + REPO + '/actions/runs/' + x.id + '/jobs', tok);
                        const n = (j.body && typeof j.body.total_count === 'number') ? j.body.total_count : '?';
                        extra = '   job 数 = ' + n + (n === 0 ? '  ← 排队阶段就被取消（查并发组！）' : '');
                    }
                    console.log('  ' + x.created_at + '  ' + x.status + '/' + x.conclusion +
                        '  sha=' + String(x.head_sha).slice(0, 7) + extra);
                }
            }

            console.log('\n== 最近 3 次 github-pages deployment ==');
            const d = await gh('/repos/' + REPO + '/deployments?per_page=3', tok);
            if (d.status === 200 && Array.isArray(d.body)) {
                for (const x of d.body) {
                    const st = await gh('/repos/' + REPO + '/deployments/' + x.id + '/statuses?per_page=1', tok);
                    const state = (st.body && st.body[0]) ? st.body[0].state : '?';
                    console.log('  ' + x.created_at + '  sha=' + String(x.sha).slice(0, 7) + '  ' + state);
                }
            } else {
                console.log('  查询失败 HTTP ' + d.status);
            }

            console.log('\n== 部署到 pages 的 workflow（⚠ 超过一条就会互相抢并发组）==');
            const w = await gh('/repos/' + REPO + '/actions/workflows?per_page=50', tok);
            if (w.status === 200 && w.body && w.body.workflows) {
                for (const x of w.body.workflows) {
                    // ⚠ 别按 9 对齐 —— `disabled_manually` 有 17 个字符，会把文件名挤成一行
                    console.log('  ' + x.state.padEnd(18) + x.path);
                }
                const n = w.body.workflows.filter(x => x.state === 'active').length;
                console.log(n > 1
                    ? '  ⚠ 有 ' + n + ' 条 active 的 workflow —— 逐个确认它们的 `on:` 与 `concurrency:`，' +
                      '共用 `group: "pages"` 且同时被 push 触发的会互相取消。'
                    : '  ✅ 只有 1 条 active。');
            } else {
                console.log('  查询失败 HTTP ' + w.status);
            }
        }
    } else if (!inSync) {
        console.log('\n  （加 `--runs` 可以顺带查 Actions / deployment，看是不是又被并发组掐了）');
    }

    process.exit(inSync ? 0 : 1);
})();
