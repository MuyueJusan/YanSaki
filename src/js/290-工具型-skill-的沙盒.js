        // ===== 工具型 skill 的沙盒 =====
        // ⚠ 跑在**沙盒化 iframe** 里，不是 Worker。
        //   Worker 有 fetch / importScripts / IndexedDB / WebSocket，而且**继承页面源** ——
        //   它是「并发边界」，不是「安全边界」。iframe 配 sandbox="allow-scripts"
        //   （**不给 allow-same-origin**）拿到的是一个不透明源：摸不到父页面的 DOM /
        //   localStorage / cookie，也读不到那张角色卡。
        //   再叠一条文档内 CSP 把网络整个掐掉。
        //
        // —— 下面四条是**实测**出来的，不是查文档查来的（Chrome，2026-09）——
        //   ① 沙盒文档里 `fetch` 被 CSP 挡掉（TypeError）✓
        //   ② `new Worker(blob:)` 被同一条 CSP 挡掉（worker-src 回落到 default-src 'none'）
        //   ③ 给 CSP 补上 `worker-src blob:` 之后 worker 起得来，但**它里面的 fetch
        //      照样被挡**（CSP 会被 blob worker 继承）—— 所以真要用 Worker 也行，
        //      不过没必要，见 ④
        //   ④ **不透明源 = 跨源 → Chrome 把沙盒 iframe 放进另一个进程**，
        //      里面死循环**不会**卡住父页面：实测父页面的 setInterval 照常跳，
        //      5e8 次空循环在沙盒里跑了 548ms 而父页面全程响应。
        //      ⚠ 这一条正是「超时掐得掉」的依据。**靠的是进程隔离，不是事件循环** ——
        //      哪天浏览器不隔离了，超时就退化成「尽力而为」，所以下面那个 timer
        //      还是要留着（它是唯一能让 skill 卡住时给出提示的东西）
        const ST_CODE_SANDBOX_BOOT = [
            // 宿主调用的序号 + 等待表
            'var __hn = 0, __hw = {};',
            // 当前这次 run 的 id。⚠ 要在 onmessage 里记下来 —— host.progress 是
            //   **单向**的，它不需要等回信，但父页面得知道这条进度属于哪一次 run
            //   （页面上可能有别的 iframe：状态栏预览、上一个还没拆干净的沙盒）
            'var __rid = 0;',
            'self.onmessage = function (e) {',
            '  var d = e.data || {};',
            // ⚠ **先认回信分支**：__call 那条下面会 return，顺序反了的话
            //   宿主调用的回信会被当成「一次新的调用」，然后什么都不发生 —— 不报错，
            //   只是每个 host.call 都超时
            '  if (d.__hostRet) {',
            '    var w = __hw[d.__hostRet];',
            '    if (w) { delete __hw[d.__hostRet]; w(d); }',
            '    return;',
            '  }',
            '  if (d.__call !== 1) return;',
            '  var id = d.id;',
            '  __rid = id;',
            '  var done = function (ok, v) {',
            '    var s = (v === null || v === undefined) ? "" : String(v);',
            '    try { self.parent.postMessage({ __ret: id, ok: !!ok, v: s }, "*"); } catch (err) {}',
            '  };',
            '  try {',
            '    if (typeof run !== "function") {',
            '      done(false, "这个 skill 没有定义 run(args)。约定是：定义 function run(args){ return 结果 }");',
            '      return;',
            '    }',
            '    var r = run(d.args || {});',
            '    if (r && typeof r.then === "function") {',
            '      r.then(function (v) { done(true, v); }, function (err) { done(false, (err && err.message) || err); });',
            '    } else { done(true, r); }',
            '  } catch (err) { done(false, (err && err.message) || err); }',
            '};',
            // —— 给 skill 用的宿主通道 ——
            // ⚠ 这里**不做权限判断**（在沙盒里判断等于没判断 —— skill 能改自己的代码）。
            //   闸门在父页面那边：它按 manifest 声明的 perm 决定放不放行。
            //   这边只负责「问一句、等回信、超时就报错」；progress 那条连回信都没有
            'var host = {',
            '  call: function (name, args) {',
            '    return new Promise(function (res, rej) {',
            '      var id = ++__hn;',
            '      var t = setTimeout(function () {',
            '        delete __hw[id];',
            '        rej(new Error("宿主调用超时（' + (ST_CODE_SANDBOX_RPC_MS / 1000) + ' 秒）：" + name));',
            '      }, ' + ST_CODE_SANDBOX_RPC_MS + ');',
            '      __hw[id] = function (d) {',
            '        clearTimeout(t);',
            '        if (d.ok) res(d.v); else rej(new Error(String(d.v || "宿主拒绝了这次调用")));',
            '      };',
            '      try { self.parent.postMessage({ __host: 1, id: id, name: String(name), args: args || {} }, "*"); }',
            '      catch (err) { clearTimeout(t); delete __hw[id]; rej(err); }',
            '    });',
            '  },',
            // —— 单向进度上报 ——
            // ⚠ **return undefined，不是 Promise**：它是「说一声」，没有回信可言。
            //   返回 Promise 会诱导 skill 写 `await host.progress(...)`，等一个永远
            //   不会来的结果；5 秒后整段被超时掐掉，而 skill 的作者以为是自己算错了
            // ⚠ 这里**不判断权限**（沙盒里判断等于没判断）。父页面收到 __prog 才查
            //   manifest —— 没申请 `progress` 的话那条消息直接丢掉
            // ⚠ 也**不做频率控制**（沙盒自己做节流等于让 skill 自己守规矩）。
            //   节流在父页面，快了的直接丢，不排队
            '  progress: function (text) {',
            '    try {',
            '      self.parent.postMessage({ __prog: 1, id: __rid, text: String(text == null ? "" : text) }, "*");',
            '    } catch (err) {}',
            '  }',
            '};'
        ].join('\n');

        function stCodeSandboxDoc(code) {
            // ⚠ 代码里的 `</script` 必须打断 —— 不打断的话 skill 里一个字符串常量
            //   就能提前闭合脚本，后面的内容变成 HTML（那时候就不是「跑错了」，
            //   而是**跑别的去了**）
            const safe = String(code || '').replace(/<\/script/gi, '<\\/script');
            return '<!DOCTYPE html><html><head><meta charset="utf-8">' +
                '<meta http-equiv="Content-Security-Policy" ' +
                'content="default-src \'none\'; script-src \'unsafe-inline\'">' +
                '</head><body><script>\n' + ST_CODE_SANDBOX_BOOT + '\n' + safe + '\n</' + 'script></body></html>';
        }

        let stCodeSandboxN = 0;

        // 这个工具名属于哪个能力。不在表里 = **不给沙盒用**（包括 fetch_url 和别的 skill）
        function stCodePermOfTool(name) {
            const nm = String(name || '');
            const keys = Object.keys(ST_CODE_PERM_TOOLS);
            for (let i = 0; i < keys.length; i++) {
                if (ST_CODE_PERM_TOOLS[keys[i]].indexOf(nm) >= 0) return keys[i];
            }
            return '';
        }

        // 一个 skill 实际拿到的能力 = manifest 声明过的 ∩ 宿主真的有的。
        // ⚠ 求交集不是多此一举：老草稿里可能存着早就下线的能力名，
        //   直接信 manifest 就等于「skill 自己给自己发权限」
        function stCodeSkillPermsOf(skill) {
            const own = (skill && skill.tool && Array.isArray(skill.tool.perm)) ? skill.tool.perm : [];
            return own.map(x => String(x)).filter(x => ST_CODE_SANDBOX_PERM.indexOf(x) >= 0);
        }

        // 这组能力对应的工具名。用来在报错里说清楚「你能用什么」，也在面板上展示
        function stCodePermToolNames(perms) {
            const out = [];
            (perms || []).forEach(p => {
                (ST_CODE_PERM_TOOLS[p] || []).forEach(n => { if (out.indexOf(n) < 0) out.push(n); });
            });
            return out;
        }

        // 跑一次。**永远 resolve**（不 reject）—— 它炸了要当成一次工具结果喂回模型，
        // 而不是把 Agent 循环带下去
        function stCodeSkillRun(skill, args) {
            return new Promise(resolve => {
                const id = ++stCodeSandboxN;
                let frame = null, done = false, timer = 0, rpc = 0;
                // 进度上报的节流状态，见 ST_CODE_PROG_MS / ST_CODE_PROG_MAX 那两段
                let progLast = 0, progN = 0;
                // ⚠ 这个 skill 有没有**真的改到卡**（它自己通过 host.call 调的写工具）。
                //   要一路带回去给 Agent 循环 —— 不带的话循环不知道卡变了，
                //   右侧那份卡 JSON 就不重画，用户看到的是一张**没更新的卡**，
                //   而 skill 明明说它改好了
                let touchedAny = false;
                // 这个 skill 装的时候申请到的能力。**整个 run 期间不变** ——
                // 它自己没法在运行中途给自己加权限（那正是「沙盒里不判断」的代价）
                const allowed = stCodeSkillPermsOf(skill);
                const finish = (ok, text) => {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    window.removeEventListener('message', onMsg);
                    // ⚠ 一定要**拆掉** iframe —— 不拆的话一个死循环会一直烧 CPU，
                    //   而用户那边什么都看不到
                    if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
                    // ⚠ 收尾要把进度那句话**撤掉** —— 不收的话它会挂在那儿，
                    //   而下一条消息已经进来了，看着像「还在跑第 7 条」
                    stCodeProgressClear(id);
                    resolve({ ok: ok, text: String(text == null ? '' : text),
                        touched: touchedAny ? 'skill' : '' });
                };
                // skill 报的一条进度。**每一层都要过闸**（和 onHost 一样是三层，只是
                // 第一层换成能力名而不是工具名）：
                //   ① 有没有申请 `progress`
                //   ② 两次之间够不够 ST_CODE_PROG_MS（不够就丢，不排队）
                //   ③ 总次数有没有超 ST_CODE_PROG_MAX
                const onProg = d => {
                    if (allowed.indexOf('progress') < 0) return;
                    const now = Date.now();
                    if (now - progLast < ST_CODE_PROG_MS) return;
                    if (++progN > ST_CODE_PROG_MAX) return;
                    progLast = now;
                    stCodeProgressShow(id, String(d.text == null ? '' : d.text));
                };
                const reply = (rid, ok, v) => {
                    // 沙盒可能已经被拆了（超时 / 已经返回）—— 那时候回信没人接，别炸
                    if (done || !frame || !frame.contentWindow) return;
                    try {
                        frame.contentWindow.postMessage(
                            { __hostRet: rid, ok: !!ok, v: String(v == null ? '' : v) }, '*');
                    } catch (e) { /* 沙盒没了就算了 */ }
                };
                // 沙盒要调宿主能力。**每一层都要过闸**：
                //   ① 这个工具名在不在「能力 → 工具」表里（不在 = 不是给沙盒用的东西）
                //   ② 它要的那个能力，这个 skill 装的时候申请到没有
                //   ③ 次数上限（一次 run 最多 ST_CODE_SANDBOX_RPC_MAX 次）
                // ⚠ 底下走的是**同一个 stCodeToolRun** —— 写路径白名单 / 回收站 /
                //   「真的改卡」开关全都照旧生效。另写一条写路径 = 把那些闸门全绕过去
                const onHost = d => {
                    const rid = d.id;
                    if (++rpc > ST_CODE_SANDBOX_RPC_MAX) {
                        return reply(rid, false, '一次最多调 ' + ST_CODE_SANDBOX_RPC_MAX +
                            ' 次宿主能力，已经超了。要读很多次的话，把逻辑挪进 skill 自己算。');
                    }
                    const nm = String(d.name || '');
                    const need = stCodePermOfTool(nm);
                    if (!need) {
                        // ⚠ 这里只列**工具名** —— `progress` 不是工具（它不走 host.call），
                        //   把它拼进来会让 skill 去 `host.call('progress')`，那是个死路
                        const tn = stCodePermToolNames(allowed);
                        return reply(rid, false, '沙盒里没有「' + nm + '」这个能力。' +
                            '能用的只有：' + (tn.join('、') || '（一个都没有）') +
                            (allowed.indexOf('progress') >= 0
                                ? '。报进度用 host.progress("…")，不走这里' : ''));
                    }
                    if (allowed.indexOf(need) < 0) {
                        return reply(rid, false, '这个 skill 没有申请「' + need + '」' +
                            '（它声明的是：' + (allowed.join('、') || '无') + '）。' +
                            '**权限是导入那一刻定的，运行时不会临时给** —— ' +
                            '要它就先改 MANIFEST 再重新导入。');
                    }
                    stCodeToolRun(nm, d.args || {}).then(r => {
                        // ⚠ 写工具会带 `touched` 回来 —— 记下来，最后一起带出沙盒
                        if (r && r.touched) touchedAny = true;
                        reply(rid, r.ok !== false, r.text);
                    }, e => {
                        reply(rid, false, '调用 ' + nm + ' 时出错：' + ((e && e.message) || e));
                    });
                };
                const onMsg = e => {
                    if (!frame || e.source !== frame.contentWindow) return;  // 只认自己这个沙盒
                    const d = e.data || {};
                    // ⚠ 宿主调用也必须认这个 source —— 页面上还有**别的** iframe
                    //   （状态栏预览），不认的话它能冒充 skill 来调工具
                    if (d.__host) { onHost(d); return; }
                    // 进度也一样：认 source + 认 id。⚠ 认 id 不是多余的 ——
                    //   上一个 run 超时被拆掉时，它可能刚好有一条 __prog 在路上，
                    //   不认 id 的话那条会显示成**这一次**的进度
                    if (d.__prog) { if (d.id === id) onProg(d); return; }
                    if (d.__ret !== id) return;
                    finish(d.ok !== false, d.v);
                };
                window.addEventListener('message', onMsg);
                try {
                    frame = document.createElement('iframe');
                    frame.setAttribute('sandbox', 'allow-scripts');   // ⚠ 不给 allow-same-origin
                    frame.setAttribute('aria-hidden', 'true');
                    frame.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;border:0';
                    frame.srcdoc = stCodeSandboxDoc(String(skill.body || ''));
                    frame.addEventListener('load', () => {
                        try {
                            frame.contentWindow.postMessage({ __call: 1, id: id, args: args || {} }, '*');
                        } catch (e) { finish(false, '沙盒起不来：' + ((e && e.message) || e)); }
                    });
                    document.body.appendChild(frame);
                } catch (e) { finish(false, '沙盒起不来：' + ((e && e.message) || e)); return; }
                timer = setTimeout(() => finish(false, '跑了 ' + (ST_CODE_SANDBOX_MS / 1000) +
                    ' 秒还没返回，已经掐掉（里面可能有死循环）。'), ST_CODE_SANDBOX_MS);
            });
        }

        // .md 的 frontmatter → { name, desc, body, triggers }
        function stCodeSkillMeta(txt) {
            const raw = String(txt || '').replace(/\r\n/g, '\n');
            const out = { name: '', desc: '', body: raw.trim(), triggers: [] };
            const m = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
            if (m) {
                const head = m[1];
                const grab = key => {
                    const r = new RegExp('^\\s*' + key + '\\s*:\\s*(.*)$', 'm').exec(head);
                    return r ? String(r[1] || '').trim().replace(/^["']|["']$/g, '') : '';
                };
                out.name = grab('name');
                out.desc = grab('description') || grab('desc');
                // 触发词：frontmatter 里写 triggers / trigger / keywords 都认。
                // 不写也没关系 —— 匹配时会退回用 name 兜底
                out.triggers = stCodeTrigList(grab('triggers') || grab('trigger') || grab('keywords'));
                out.body = raw.slice(m[0].length).trim();
            }
            if (!out.name) {
                const h = /^#\s+(.+)$/m.exec(out.body);
                out.name = h ? String(h[1]).trim() : '';
            }
            if (!out.desc) {
                const lines = out.body.split('\n').map(x => x.trim())
                    .filter(x => x && x.charAt(0) !== '#' && x.charAt(0) !== '-' && x.charAt(0) !== '*');
                out.desc = lines.length ? lines[0].slice(0, 160) : '';
            }
            return out;
        }

        function stCodePickSkills() {
            const el = document.getElementById('st-code-skill-file');
            if (el) el.click();
        }

        function stCodePickSkillDir() {
            const el = document.getElementById('st-code-skill-dir');
            if (el) el.click();
        }

        // 文本 → 一条 skill。三个入口（选文件 / 拖进来 / 从链接）共用这一处，
        // 所以「多大算太大」只有这一个答案
        // 文本 → 一条 skill。四个入口（选文件 / 选目录 / 拖进来 / 从链接）共用这一处，
        // 所以「多大算太大」「算知识还是算工具」都只有这一个答案。
        // ⚠ 返回三态：skill 对象 / `{ err }`（**看得出是 skill 但装不了**）/ null（不是 skill）。
        //   中间那态不能省 —— 把「manifest 写错了」和「这不是 skill」混成同一个 null，
        //   用户就只会看到「一个能用的都没有」，然后回去猜
        function stCodeSkillFromText(txt, file) {
            const src = String(txt || '');
            // ⚠ **先判工具**。一个 .js 里也可能有 frontmatter 式的东西，
            //   反过来判会把工具当成知识，然后它就成了「一段没人看的说明书」
            if (ST_CODE_MANIFEST_RX.test(src)) {
                const r = stCodeManifestOf(src);
                if (!r.ok) return { err: r.why };
                if (src.length > ST_CODE_SKILL_CHARS) {
                    return { err: '代码太长（' + src.length + ' 字，上限 ' +
                        ST_CODE_SKILL_CHARS + '）。工具型 skill 不能截断 —— 截了就跑了。' };
                }
                // 工具名不能和别的工具型 skill 撞：撞了的话模型调谁是不确定的，
                // 而且它会一直以为自己调对了
                const clash = stCode.skills.filter(x => x.kind === 'tool' && x.tool &&
                    x.tool.name === r.m.name && x.name !== r.m.name)[0];
                if (clash) {
                    return { err: '工具名「' + r.m.name + '」已经被另一个 skill（' +
                        clash.name + '）占了。' };
                }
                return {
                    name: r.m.name, desc: r.m.desc, body: src, file: String(file || ''),
                    triggers: [], kind: 'tool', tool: r.m
                };
            }
            const meta = stCodeSkillMeta(src);
            if (!meta.name) return null;
            let body = String(meta.body || '');
            if (body.length > ST_CODE_SKILL_CHARS) {
                body = body.slice(0, ST_CODE_SKILL_CHARS) + '\n\n…（正文太长，导入时已截断）';
            }
            return { name: meta.name, desc: meta.desc, body: body, file: String(file || ''),
                triggers: meta.triggers || [], kind: 'knowledge' };
        }

        // 合并进现有列表。同名**以后导入的为准** —— 重导一份改过的 skill
        // 应该覆盖旧的，而不是并排出现两条一模一样的
        // ⚠ **async**：落盘走 IndexedDB。调用方要 await，不然 `saved` 拿到的是
        //   Promise（永远是真值），「存不下」那条提示就永远不会出现
        async function stCodeSkillsMerge(found) {
            const list = (found || []).filter(s => s && s.name);
            if (!list.length) return { added: 0, total: stCode.skills.length, saved: true };
            const map = {};
            stCode.skills.forEach(s => { map[s.name.toLowerCase()] = s; });
            list.forEach(s => { map[s.name.toLowerCase()] = s; });
            stCode.skills = Object.keys(map).map(k => map[k]).sort((a, b) => a.name.localeCompare(b.name));
            return { added: list.length, total: stCode.skills.length, saved: await stCodeSaveSkills() };
        }

        // 一个 skill 的触发词。没写就**退回用名字兜底** ——
        // 「名字本身就是最自然的触发词」，这样零配置也能用起来
        function stCodeSkillTriggers(s) {
            const own = (s && Array.isArray(s.triggers)) ? s.triggers : [];
            const list = own.length ? own.slice() : [String((s && s.name) || '')];
            return list.map(x => String(x).trim().toLowerCase()).filter(x => x.length >= 2);
        }

        // 挑出「用户这句话命中了哪些 skill」，并把结果**累积在会话上**。
        // ⚠ 为什么是累积而不是只算当前这一句：用户说「改一下状态栏」（命中），
        //   接着说「再改个颜色」（不命中）—— 只算当前句的话第二轮正文就掉了，
        //   模型会突然忘掉刚才那份说明。代价是上下文只增不减，所以配总量上限
        //   （ST_CODE_AUTO_CHARS），装不下时退回「只列名字」。
        // ⚠ 结果要**排序**：让 system 的内容只跟「命中集合」有关，
        //   不跟「用户按什么顺序提到它们」有关，否则同一组 skill 会生成两种 system
        function stCodeSkillAuto(text, sess) {
            const s = sess || stCodeSession();
            const t = String(text || '').toLowerCase();
            // ⚠ 只算**知识型** skill。工具型 skill 的 body 是源码 —— 把它塞进 system
            //   等于让模型去读一份实现，既占上下文又没用（它该做的是「调」）
            const pool = stCode.skills.filter(sk => sk.kind !== 'tool');
            // 已经删掉的 skill 不要留在名单里
            const want = (Array.isArray(s.autoSkills) ? s.autoSkills : [])
                .filter(nm => pool.some(x => x.name === nm));
            if (t) {
                pool.forEach(sk => {
                    if (want.indexOf(sk.name) >= 0) return;
                    // `@名字` 是强制加载 —— 触发词写得不合适时，用户的兜底手段
                    if (t.indexOf('@' + sk.name.toLowerCase()) >= 0 ||
                        stCodeSkillTriggers(sk).some(k => t.indexOf(k) >= 0)) want.push(sk.name);
                });
            }
            want.sort((a, b) => a.localeCompare(b));
            s.autoSkills = want;
            return want.map(nm => stCode.skills.filter(x => x.name === nm)[0]).filter(Boolean);
        }

        // 文件列表 → 一批 skill。
        // 规则：**SKILL.md 一律收；别的 .md 只有在「一共没几个 .md」时才收**；
        // **.js 必须带 manifest 才收**（仓库里的普通 .js 太多 —— 打包产物、配置，
        // 全收进来就是一堆噪声）。这样「拖一个手写的 xxx.md 进来」能用，
        // 而「拖一整个仓库进来」不会把满仓的 README.md 全塞进来
        // ⚠ 返回里带 `errs`：**看得出是 skill 但装不了**的要报出来，
        //   不能和「这不是 skill」混成同一个沉默
        async function stCodeImportFiles(files) {
            const list = Array.prototype.slice.call(files || []);
            const mds = list.filter(f => f && /\.md$/i.test(String(f.name || '')));
            const jss = list.filter(f => f && /\.js$/i.test(String(f.name || '')));
            const loose = mds.length <= 10;
            const found = [], errs = [];
            const take = (s, nm) => {
                if (s && s.err) errs.push(nm + '：' + s.err);
                else if (s) found.push(s);
            };
            for (let i = 0; i < mds.length; i++) {
                const f = mds[i];
                const nm = String(f.name || '').toLowerCase();
                if (nm !== 'skill.md' && !loose) continue;
                let txt = '';
                try { txt = await f.text(); } catch (e) { continue; }
                take(stCodeSkillFromText(txt, f.webkitRelativePath || f.name || ''), f.name || '');
            }
            for (let i = 0; i < jss.length; i++) {
                const f = jss[i];
                let txt = '';
                try { txt = await f.text(); } catch (e) { continue; }
                if (!ST_CODE_MANIFEST_RX.test(txt)) continue;   // 没 manifest = 不是工具型 skill
                take(stCodeSkillFromText(txt, f.webkitRelativePath || f.name || ''), f.name || '');
            }
            return { found: found, mds: mds.length, js: jss.length, errs: errs };
        }

        // 走统一的收尾：合并 + 报数 + 装不了的说清楚
        // ⚠ **async**（落盘是异步的）。调用方要 await —— 不 await 的话
        //   「存不下」的提示会在「导入 N 个」之后才冒出来，用户看不懂
        async function stCodeSkillsApply(found, mds, fromWhat, errs) {
            const bad = Array.isArray(errs) ? errs : [];
            if (!found.length) {
                stCode.skillErr = bad.length
                    ? ('有 ' + bad.length + ' 个文件看着像 skill，但装不了：\n· ' + bad.join('\n· '))
                    : (mds ? ('看了 ' + mds + ' 个文件，一个能用的都没有（名字解析不出来）。')
                        : '没接到 skill 文件（.md 要有 SKILL.md 或一级标题；' +
                          '.js 要有 /*!MANIFEST*/）。');
                stCode.skillMsg = '';
                stCodeRepaint();
                return;
            }
            const m = await stCodeSkillsMerge(found);
            stCode.skillErr = m.saved
                ? (bad.length ? ('（另有 ' + bad.length + ' 个没装成：' + bad[0] + '）') : '')
                : stCodeSkillFailText();
            // ⚠ 权限是**导入这一刻**给的，所以「这个能改你的卡」必须**在这一刻**说。
            //   只在列表上挂个 ✏️ 徽章是不够的：用户点完「装」就走了，
            //   事后再去看列表才知道自己同意了什么 —— 那就不叫「明确同意」了。
            //   移除也很简单（列表上每行都有「移除」），所以这里给的是**提示**不是拦截
            const writers = found.filter(sk => sk.kind === 'tool' && sk.tool &&
                stCodeSkillPermsOf(sk).indexOf('card.write') >= 0);
            stCode.skillMsg = fromWhat + '导入 ' + m.added + ' 个，现在一共 ' + m.total + ' 个。' +
                (writers.length
                    ? '\n⚠ 其中 ' + writers.length + ' 个（' + writers.map(sk => sk.name).join('、') +
                      '）申请了 card.write —— 它们能在你没让它们动的时候改这张卡。\n' +
                      '不放心就在下面把它移除（移除立即生效）。'
                    : '');
            stCodeRepaint();
            stCodeFlash(writers.length
                ? '已导入 ' + m.added + ' 个 skill（⚠ 有 ' + writers.length + ' 个能改卡）。'
                : '已导入 ' + m.added + ' 个 skill。');
        }

        async function stCodeOnSkillsPicked(ev) {
            const files = Array.from((ev && ev.target && ev.target.files) || []);
            if (ev && ev.target) ev.target.value = '';
            if (!files.length) return;
            const r = await stCodeImportFiles(files);
            await stCodeSkillsApply(r.found, r.mds + r.js, '', r.errs);
        }

