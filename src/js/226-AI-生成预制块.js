        // ===== AI 生成预制块 =====
        // 让模型按一句描述拼出一组状态栏块，直接存进「我的预制块」。
        //
        // 三条设计决定：
        //   · **只要块，不要 HTML** —— 模型给的每个块都过一遍 stSbBlockFromRaw 那份白名单，
        //     再走 stSbCloneBlocks 换 id。它编出来的字段名一律被丢掉，最坏情况是
        //     「块长得不好看」，而不是「往卡里塞了一段谁也看不懂的东西」
        //   · **把卡里真实的变量路径喂给它** —— 不喂的话它会一本正经地编
        //     `stat_data.生命值`，而卡里叫 `hp`。喂了之后大部分块当场就绑上了
        //   · **存进「我的预制块」，不直接动画布** —— 生成的东西必须先能反悔。
        //     存完用户点一下才进画布；不满意按 ✕ 删掉，画布一个字节没动
        const ST_SB_AI_MAX_BLOCKS = 24;    // 一次最多收这么多块（含 row 里的子块）
        const ST_SB_AI_MAX_DEEP = 3;       // 块树最大深度（根算 1 层）
        const ST_SB_AI_DESC_MAX = 120;     // 描述那格的字数上限

        // 模型**不许**碰的字段。它们全是「解析别人的手写状态栏时用来保原样」的，
        // 生成新块时写进去只会把外观锁死在模型瞎猜的一个值上
        const ST_SB_AI_STRIP_NUM = ['offX', 'offY', 'w', 'h'];
        const ST_SB_AI_STRIP_STR = ['extra', 'extraInner', 'extraFill', 'wrapExtra'];

        function stSbAiDescSet(v) {
            stEditor.sbPfAiDesc = String(v == null ? '' : v).slice(0, ST_SB_AI_DESC_MAX);
        }

        // 规范化 + 清干净。递归，因为 row 里有子块
        function stSbAiClean(raw) {
            const b = stSbBlockFromRaw(raw);
            ST_SB_AI_STRIP_NUM.forEach(k => { b[k] = 0; });
            ST_SB_AI_STRIP_STR.forEach(k => { b[k] = ''; });
            ST_SB_CLS_ROLES.forEach(r => { b.clsMap[r] = ''; b.clsOwn[r] = []; });
            b.children = (b.children || []).map(stSbAiClean);
            return b;
        }

        // 数一棵块树：总块数 + 最大深度
        function stSbAiCount(list) {
            let n = 0, deep = 0;
            (list || []).forEach(b => {
                n++;
                const sub = stSbAiCount(b.children || []);
                n += sub.n;
                deep = Math.max(deep, sub.deep);
            });
            return { n: n, deep: deep + (n ? 1 : 0) };
        }

        // 裁到上限内：先按顺序取满块数，深度超了**把子块提上来（摊平）**。
        //
        // ⚠ 摊平而不是「砍掉子树」：砍掉会把内容一起丢了 —— 一棵
        //   `row>row>row>row>文字` 的树砍完只剩三个空 row，接着被判成「空块」整份拒收，
        //   用户看到的是「AI 生成失败」，而他明明给了内容。**丢层级可以，丢内容不行。**
        //   （套件 G 段抓到：当时 `actual=0`，看着像裁剪写错了，其实是裁剪把内容裁没了。）
        //
        // 不裁块数的话模型偶尔吐一棵 200 块的树，画布当场卡住
        function stSbAiTrim(list, maxN, maxDeep) {
            let left = maxN;
            const walk = (bs, d) => {
                const out = [];
                (bs || []).forEach(b => {
                    if (left <= 0) return;
                    left--;
                    const kids = b.children || [];
                    if (d < maxDeep) {
                        b.children = walk(kids, d + 1);
                        out.push(b);
                    } else {
                        // 到顶了：自己收下，子块提到**同一层**（再深就继续摊）
                        b.children = [];
                        out.push(b);
                        walk(kids, d).forEach(k => out.push(k));
                    }
                });
                return out;
            };
            return walk(list, 1);
        }

        // 「有内容吗」—— 全是空块（模型给了 [{}] 这种）就不该存，存下去就是个幽灵
        function stSbAiHasContent(list) {
            return (list || []).some(b =>
                stStr(b.text) || stStr(b.path) || stSbAiHasContent(b.children));
        }

        function stSbAiSysPrompt() {
            return [
                '你是 SillyTavern 角色卡的「MVU 状态栏」排版助手。',
                '用户会用一句中文说他想要什么状态栏，你把它拆成一组**块**，用 JSON 返回。',
                '',
                '## 可用的块类型（type 只能是这 9 个之一）',
                '- title：小标题。字段 text',
                '- text：一行普通文字。字段 text',
                '- var：一行「名字 + 数值」。字段 path label showLabel showValue size color labelColor valueColor bold align',
                '- bar：进度条。字段 path label showLabel showValue min max size height color（填充色）track（轨道底色）labelColor valueColor bold align',
                '- dots：圆点 / 星级。字段 path label showLabel showValue min max count（圆点个数）icon（圆点字符，默认 ●）size color（点亮色）emptyColor（没点亮色）labelColor valueColor bold align',
                '- row：横向一行，把别的块并排放。字段 children（块数组）gap（列间距）',
                '- divider：一条分割线。没有字段',
                '- space：一块空白。字段 height（高度 px）',
                '- html：高级 HTML，字段 text。**尽量别用**，只在别的块都表达不了时才用',
                '',
                '## 硬规则',
                '1. **只输出 JSON**。不要解释、不要 ``` 围栏、不要前后寒暄。',
                '2. 顶层形状：{"name":"预制块名字（中文，不超过 12 字）","icon":"一个字符","blocks":[...]}',
                '3. 每个块**只写上面列出的字段**。不要发明字段名 —— 写了会被丢掉。',
                '4. `path` 必须从下面「这张卡里现有的变量」里挑，**一字不差**。',
                '   实在没有合适的，才自己起一个 `stat_data.xxx`（英文小写 + 下划线）。',
                '5. `min` / `max` 要跟那个变量自己的范围一致（下面列出来了）。',
                '6. 颜色写 `#rrggbb`。不确定就**别写**（留空 = 跟主题），不要写 `red` 这类颜色名。',
                '7. 总块数（含 row 里的子块）控制在 12 个以内。超了会被截断。',
                '8. `row` 最多套 2 层（`row` 里再放一个 `row` 就到头了）。再深会被摊平。',
                '9. label / text 一律用中文。'
            ].join('\n');
        }

        function stSbAiUserPrompt(desc) {
            const paths = stSbVarPaths();
            const lines = paths.slice(0, 80).map(p => {
                const hasR = (p.min !== undefined || p.max !== undefined);
                const rng = hasR
                    ? '，范围 ' + (p.min === undefined ? '?' : p.min) + '~' +
                      (p.max === undefined ? '?' : p.max)
                    : '';
                return '- ' + p.path + '（' + (p.type || '?') + rng + '）';
            });
            const sb = (stEditor.card && stEditor.card.statusBar) || {};
            return [
                '用户想要：' + desc,
                '',
                '## 这张卡里现有的变量',
                lines.length ? lines.join('\n')
                    : '（这张卡还没建变量 —— 那就自己起 `stat_data.xxx` 这样的路径，' +
                      '之后建了同名变量就通）',
                '',
                '## 当前状态栏主题',
                String(sb.theme || 'dark') + '（决定默认配色，你不用管，留空即可）'
            ].join('\n');
        }

        // 解析模型回复 → { ok, name, icon, blocks, why }
        function stSbAiParse(text) {
            const out = { ok: false, name: '', icon: '', blocks: [], why: '' };
            const j = stAiJsonOf(text);
            if (!j.ok) { out.why = '模型没返回合法 JSON（' + j.error + '）'; return out; }
            const v = j.value;
            let arr = null, name = '', icon = '';
            if (Array.isArray(v)) {
                arr = v;
            } else if (v && typeof v === 'object') {
                arr = stAiPickArray(v, ['blocks']);
                name = stStr(v.name);
                icon = stStr(v.icon);
            }
            if (!arr || !arr.length) { out.why = '回复里没有 blocks 数组'; return out; }
            let blocks = arr.map(stSbAiClean);
            // ⚠ 两个上限**各自独立**。一开始只判了块数 —— 结果一棵「块不多但很深」的树
            //   整个绕过了深度上限（套件 G 段抓到：5 个块、深度 5，块数没超 24，
            //   深度却超了 3，而当时只判块数 ⇒ 裁剪根本没跑）。**任何一个超了都要裁。**
            const cap = stSbAiCount(blocks);
            if (cap.n > ST_SB_AI_MAX_BLOCKS || cap.deep > ST_SB_AI_MAX_DEEP) {
                blocks = stSbAiTrim(blocks, ST_SB_AI_MAX_BLOCKS, ST_SB_AI_MAX_DEEP);
            }
            if (!blocks.length || !stSbAiHasContent(blocks)) {
                out.why = '生成出来的块是空的';
                return out;
            }
            out.ok = true;
            out.name = (name || 'AI 预制块').slice(0, 24);
            out.icon = (icon || '✨').slice(0, 2);
            out.blocks = blocks;
            return out;
        }

        // 名字撞车就加编号。**不覆盖** —— AI 生成是异步的，弹 confirm 会很别扭，
        // 而静默覆盖别人的东西更糟
        function stSbAiUniqueName(list, want) {
            const base = stStr(want).slice(0, 24) || 'AI 预制块';
            if (!list.some(it => it.name === base)) return base;
            for (let i = 2; i < 100; i++) {
                const nm = base + ' ' + i;
                if (!list.some(it => it.name === nm)) return nm;
            }
            return base;
        }

        async function stSbAiPrefabRun() {
            if (stEditor.sbPfAiBusy) return;
            if (!stEditor.card) return;
            const desc = String(stEditor.sbPfAiDesc || '').trim();
            if (!desc) {
                stExportMsg('⚠ 先写一句你想要的预制块（例如「生命值和魔力，两条进度条」）。', 'warn');
                const el = document.getElementById('st-sb-pf-ai');
                if (el) { try { el.focus(); } catch (e) {} }
                return;
            }
            const cfg = stAiCfg();
            const ready = stAiReady(cfg);
            if (!ready.ok) {
                stExportMsg('⚠ ' + ready.why, 'warn');
                return;
            }
            stEditor.sbPfAiBusy = true;
            stRerender();
            stExportMsg('⏳ 正在让 AI 生成预制块…', '');
            let got = null;
            try {
                const text = await stAiChat([
                    { role: 'system', content: stSbAiSysPrompt() },
                    { role: 'user', content: stSbAiUserPrompt(desc) }
                ], {
                    cfg: cfg, stream: false,
                    temperature: cfg.temperature,
                    maxTokens: Math.max(1024, cfg.maxTokens)
                });
                got = stSbAiParse(text);
                if (!got.ok) throw new Error(got.why);
            } catch (e) {
                stEditor.sbPfAiBusy = false;
                stRerender();
                stExportMsg('❌ AI 生成失败：' + stAiErrText(e), 'bad');
                return;
            }
            stEditor.sbPfAiBusy = false;
            // 这一轮花了多少。**下面几条分支都要带上** —— 存满 / 太大这两条
            // 也是「请求已经发出去、钱已经花了」，只挂在成功那条上的话
            // 用户看到的是「白花了但没数字」
            const usageTip = stAiUsageSuffix();
            const list = stSbUserPrefabs();
            if (list.length >= ST_SB_PF_MAX) {
                stRerender();
                stExportMsg('⚠ 预制块已经存满 ' + ST_SB_PF_MAX + ' 个，先删掉几个再生成。' + usageTip, 'warn');
                return;
            }
            let bytes = 0;
            try { bytes = JSON.stringify(got.blocks).length; } catch (e) { bytes = 0; }
            if (bytes > ST_SB_PF_ITEM_BYTES) {
                stRerender();
                stExportMsg('⚠ 生成的东西太大了（' + Math.round(bytes / 1024) + ' KB），' +
                    '超过单个预制块的上限。换个说法再试一次。' + usageTip, 'warn');
                return;
            }
            const name = stSbAiUniqueName(list, got.name);
            const total = stSbAiCount(got.blocks).n;
            // 路径对得上卡里变量的算「绑上了」，剩下的是兜底路径。
            // ⚠ 跟预制块插入那边同一个口径：**要说清几个绑上了**，不能只报「成功」
            const known = {};
            stSbVarPaths().forEach(p => { known[p.path] = true; });
            let hit = 0, miss = 0;
            const countBind = (bs) => (bs || []).forEach(b => {
                if (b.path) { if (known[b.path]) hit++; else miss++; }
                countBind(b.children);
            });
            countBind(got.blocks);
            const item = {
                id: 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
                name: name,
                icon: got.icon,
                hint: 'AI 生成：' + desc.slice(0, 30) + '（' + total + ' 块）',
                blocks: got.blocks
            };
            const r = stSbPfStore(list.concat([item]));
            if (!r.ok) {
                stRerender();
                stExportMsg('⚠ 没存下来：' + r.why + '。', 'warn');
                return;
            }
            stRerender();
            const bind = (hit + miss)
                ? '，' + hit + '/' + (hit + miss) + ' 条路径对得上卡里的变量' +
                  (miss ? '（剩下的建了同名变量就通）' : '')
                : '';
            stExportMsg('✅ AI 生成了预制块「' + name + '」（' + total + ' 块' + bind + '）。' +
                '点左边那一条就能加进画布。' +
                (name !== got.name ? '名字跟已有的重了，加了编号。' : '') + usageTip, 'ok');
        }

        // 状态栏页里那一行：描述 + 生成按钮。
        // 忙态**从状态渲染**，不用 stAiBusyBtn —— stRerender 会把按钮整个换掉，
