        // —— 网络（fetch_url 工具 + 「从链接导入」共用）——

        // 地址闸门：只放行公网 http / https。
        // ⚠ 这不是防君子 —— 模型能指挥**用户的浏览器**去访问任意地址。用户在自己电脑上
        //   开着这个页面，`localhost` 上可能跑着别的东西（数据库、别的应用的后台），
        //   不挡的话模型就能把它们读出来。所以本机 / 内网 / 保留段一律拒。
        // ⚠ 残余风险：这里只按**字面主机名**判断，挡不住「公网域名解析到内网 IP」
        //   （DNS rebinding）。浏览器里拿不到解析结果，这条做不到更严，得知道。
        function stCodeUrlGuard(raw) {
            const s = String(raw == null ? '' : raw).trim();
            if (!s) return { ok: false, why: '地址是空的' };
            let u;
            try { u = new URL(s); } catch (e) { return { ok: false, why: '不是合法的 URL：' + s }; }
            if (u.protocol !== 'http:' && u.protocol !== 'https:') {
                return { ok: false, why: '只接受 http / https，不接受 ' + u.protocol + '//' };
            }
            const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
            if (!host) return { ok: false, why: '这个 URL 没有主机名' };
            if (host === 'localhost' || host === '0.0.0.0' || host === '::1' ||
                /\.(local|localhost|internal|home\.arpa)$/.test(host)) {
                return { ok: false, why: '不接受本机 / 内网主机名：' + host };
            }
            if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
                const p = host.split('.').map(Number);
                const priv = p[0] === 0 || p[0] === 10 || p[0] === 127 ||
                    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||      // 运营商级 NAT
                    (p[0] === 169 && p[1] === 254) ||                    // link-local
                    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
                    (p[0] === 192 && p[1] === 168) ||
                    (p[0] === 198 && (p[1] === 18 || p[1] === 19));
                if (priv) return { ok: false, why: '不接受内网 / 保留地址：' + host };
            }
            return { ok: true, url: u.href };
        }

        // 读响应体，**边读边卡上限**。
        // 不能先 resp.text() 再截断 —— 那样一个指向大文件的地址会先把整个响应
        // 读进内存（几百 MB 也能读进来），截断发生在灾难之后
        async function stCodeReadCapped(resp, cap) {
            const limit = Math.max(1, Number(cap) || ST_CODE_FETCH_CHARS);
            if (!resp.body || typeof resp.body.getReader !== 'function') {
                let t = '';
                try { t = await resp.text(); } catch (e) { throw new Error('读响应体失败'); }
                return t.length > limit ? t.slice(0, limit) + '\n…（太长，已截断）' : t;
            }
            const reader = resp.body.getReader();
            const dec = new TextDecoder('utf-8');
            let out = '', bytes = 0, cut = false;
            for (;;) {
                const r = await reader.read();
                if (r.done) break;
                bytes += r.value.byteLength;
                if (bytes > ST_CODE_FETCH_BYTES) { cut = true; break; }
                out += dec.decode(r.value, { stream: true });
                if (out.length > limit) { cut = true; break; }
            }
            try { await reader.cancel(); } catch (e) {}
            out += dec.decode();
            if (out.length > limit) { out = out.slice(0, limit); cut = true; }
            return out + (cut ? '\n…（太长，已截断）' : '');
        }

        async function stCodeFetchRaw(url, cap, accept) {
            const g = stCodeUrlGuard(url);
            if (!g.ok) throw new Error(g.why);
            const ctl = (typeof AbortController === 'function') ? new AbortController() : null;
            const timer = ctl ? setTimeout(() => { try { ctl.abort(); } catch (e) {} }, ST_CODE_URL_MS) : null;
            let resp;
            try {
                resp = await fetch(g.url, {
                    headers: { 'Accept': accept || 'text/plain,text/markdown,*/*' },
                    ...(ctl ? { signal: ctl.signal } : {})
                });
            } catch (e) {
                throw new Error(stAiErrText(e));
            } finally {
                if (timer) clearTimeout(timer);
            }
            if (resp.status === 403 || resp.status === 429) {
                throw new Error('被限流了（HTTP ' + resp.status + '）。GitHub 的接口未登录每小时只有 60 次；' +
                    '取 raw 文件的直链不走这个限额，可以换直链再试');
            }
            if (resp.status === 404) throw new Error('地址不存在（HTTP 404）。检查一下分支名和路径');
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const ct = String(resp.headers.get('content-type') || '').toLowerCase();
            if (/^\s*(image|audio|video)\//.test(ct)) {
                throw new Error('这个地址返回的是 ' + ct.split(';')[0] + '，不是文本');
            }
            return await stCodeReadCapped(resp, cap);
        }

        function stCodeFetchText(url, cap) { return stCodeFetchRaw(url, cap, 'text/plain,text/markdown,*/*'); }

        async function stCodeFetchJson(url) {
            const txt = await stCodeFetchRaw(url, 512 * 1024, 'application/vnd.github+json,application/json');
            try { return JSON.parse(txt); } catch (e) { throw new Error('返回的不是 JSON'); }
        }

        // GitHub 链接归一。四种形态都要认，因为用户会直接复制地址栏里的东西：
        //   /owner/repo                        → 整个仓库
        //   /owner/repo/tree/ref/路径           → 某个目录
        //   /owner/repo/blob/ref/路径/SKILL.md  → 单个文件（要转成 raw 才取得到正文）
        //   raw.githubusercontent.com/...      → 已经是 raw
        function stCodeGhParts(raw) {
            const g = stCodeUrlGuard(raw);
            if (!g.ok) return null;
            const u = new URL(g.url);
            const host = u.hostname.toLowerCase();
            const seg = u.pathname.replace(/^\/+/, '').replace(/\/+$/, '').split('/');
            if (host === 'raw.githubusercontent.com') {
                if (seg.length < 4) return null;
                return { kind: 'raw', owner: seg[0], repo: seg[1], ref: seg[2], path: seg.slice(3).join('/') };
            }
            if (host !== 'github.com' && host !== 'www.github.com') return null;
            if (seg.length < 2 || !seg[0] || !seg[1]) return null;
            const owner = seg[0], repo = seg[1].replace(/\.git$/i, '');
            if (seg.length === 2) return { kind: 'repo', owner: owner, repo: repo, ref: '', path: '' };
            if (seg[2] === 'blob' || seg[2] === 'tree') {
                return { kind: seg[2], owner: owner, repo: repo, ref: seg[3] || '', path: seg.slice(4).join('/') };
            }
            // /issues /pull /releases … 一律当仓库根
            return { kind: 'repo', owner: owner, repo: repo, ref: '', path: '' };
        }

        function stCodeGhRawUrl(owner, repo, ref, path) {
            return 'https://raw.githubusercontent.com/' + owner + '/' + repo + '/' +
                encodeURIComponent(ref) + '/' + String(path).split('/').map(encodeURIComponent).join('/');
        }

        // 列仓库里所有 SKILL.md 的 raw 地址。
        // 仓库根链接没带分支名，得先问一次 default_branch —— 写死 main 的话
        // 老仓库（master）会整个失败
        async function stCodeGhTreeUrls(gh) {
            let ref = gh.ref;
            if (!ref) {
                const meta = await stCodeFetchJson('https://api.github.com/repos/' + gh.owner + '/' + gh.repo);
                ref = String((meta && meta.default_branch) || 'main');
            }
            const tree = await stCodeFetchJson('https://api.github.com/repos/' + gh.owner + '/' + gh.repo +
                '/git/trees/' + encodeURIComponent(ref) + '?recursive=1');
            const all = (tree && Array.isArray(tree.tree)) ? tree.tree : [];
            const pre = String(gh.path || '').replace(/^\/+|\/+$/g, '');
            return all
                .filter(x => x && x.type === 'blob' && /(^|\/)SKILL\.md$/i.test(String(x.path || '')))
                .map(x => String(x.path))
                .filter(p => !pre || p === pre || p.indexOf(pre + '/') === 0)
                .map(p => stCodeGhRawUrl(gh.owner, gh.repo, ref, p));
        }

        // 一个地址 → 一批 skill。三种走法：单个文件 / 仓库（或目录）/ 普通文本
        // ⚠ 仓库扫描**只看 SKILL.md**（那是约定）。工具型 skill 是**单个 .js**，
        //   直接给它的地址就行 —— 一个仓库里可能上百个 .js，全抓下来既要发上百次请求，
        //   又基本全是打包产物
        async function stCodeUrlToSkills(raw) {
            const g = stCodeUrlGuard(raw);
            if (!g.ok) throw new Error(g.why);
            const gh = stCodeGhParts(g.url);
            const one = (txt, where) => {
                const s = stCodeSkillFromText(txt, where);
                if (s && s.err) return { found: [], note: '', errs: [where + '：' + s.err] };
                return { found: s ? [s] : [], note: '', errs: [] };
            };

            if (gh && gh.kind === 'blob') {
                const txt = await stCodeFetchText(stCodeGhRawUrl(gh.owner, gh.repo, gh.ref, gh.path), ST_CODE_SKILL_CHARS);
                return one(txt, gh.path);
            }

            if (gh && (gh.kind === 'repo' || gh.kind === 'tree')) {
                let urls = await stCodeGhTreeUrls(gh);
                let note = '';
                if (!urls.length) {
                    throw new Error('这个仓库 / 目录里没有 SKILL.md。' +
                        '（知识型 skill 一般放在 skills/<名字>/SKILL.md；' +
                        '工具型 skill 是单个 .js，直接贴它那个文件的地址就行）');
                }
                if (urls.length > ST_CODE_IMPORT_MAX) {
                    note = '仓库里一共 ' + urls.length + ' 个，只取了前 ' + ST_CODE_IMPORT_MAX + ' 个。';
                    urls = urls.slice(0, ST_CODE_IMPORT_MAX);
                }
                const found = [], errs = [];
                for (let i = 0; i < urls.length; i++) {
                    // 单个文件取不到不拖垮整批 —— 仓库里偶尔有一两个路径是坏的
                    try {
                        const s = stCodeSkillFromText(await stCodeFetchText(urls[i], ST_CODE_SKILL_CHARS), urls[i]);
                        if (s && s.err) errs.push(urls[i] + '：' + s.err);
                        else if (s) found.push(s);
                    } catch (e) {}
                }
                return { found: found, note: note, errs: errs };
            }

            // raw 直链，或者任何别的地址：当普通文本抓，按一个 skill 解析
            const txt = await stCodeFetchText(g.url, ST_CODE_SKILL_CHARS);
            return one(txt, gh ? gh.path : g.url);
        }

