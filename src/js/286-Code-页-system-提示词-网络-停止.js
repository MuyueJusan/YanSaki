        // ===== 各选项卡 =====

        // —— system 提示词 ——
        // ⚠ Code 页**没有「第一段」**：发出去的就是这一条 system + 会话 + 工具表。
        //   「第一段」是 AI 对话 / AI 助手那几处的设置，跟这里无关
        function stCodeSystem(sess) {
            const th = stCodeThink();
            const c = stEditor.card || stBlankCard();
            const s0 = sess || stCodeSession();
            const L = [];
            L.push('你是「角色卡编辑器」里的一个助手，直接操作一张 SillyTavern 角色卡。');
            L.push('用户用自然语言让你改这张卡。**你有工具，想改就直接改，不要只给建议或只输出代码块。**');
            L.push('');
            L.push('## 怎么做');
            L.push('· 动手之前先 read_card 看一眼现状，不要凭想象写。');
            L.push('· 一次只做用户要的那件事，别顺手改别的字段。');
            L.push('· 改完用一两句话说明改了什么。**不要把整段内容复述一遍** —— 左边就能看到。');
            L.push('· 拿不准的地方先问，别猜。');
            L.push('· 事情超过两三步时，**先用 set_tasks 把计划列出来**，之后每推进一步就更新一次 —— ' +
                '用户能在界面上看见进度，这比你在文字里说「我接下来要…」有用得多。');
            L.push('· 用户说「记住…」，或者**反复强调同一条要求**时，用 remember 记下来；' +
                '只是这一轮的要求不要记。');
            if (th.id === 'off') L.push('· 能一步做完就别分两步。');
            else if (th.id === 'low') L.push('· 别铺开，够用就行。');
            else if (th.id === 'mid') L.push('· 改完再读一次确认真的写进去了。');
            else L.push('· 每一步都先取证；改完必须复核；涉及多条时逐条确认，不要跳过检查。');

            // 项目记忆放在「怎么做」正后面、并明说**优先于上面的通用做法** ——
            // 否则它会被当成又一条泛泛的建议，模型照样按默认习惯来
            const memo = String(stCode.memo || '').trim();
            if (memo) {
                L.push('');
                L.push('## 项目记忆（用户长期要求，**优先于上面的通用做法**）');
                L.push(memo);
            }

            L.push('');
            L.push('## 这张卡现在长什么样');
            const has = ST_CODE_TEXT_PATHS.filter(p => String(stCodeGetPath(c, p) || '').trim());
            L.push('· 名字：' + (String(c.name || '').trim() || '（还没起名）'));
            L.push('· 已填的文本字段：' + (has.length ? has.join('、') : '（一个都没有）'));
            L.push('· 世界书：' + ((Array.isArray(c.bookEntries) ? c.bookEntries.length : 0)) + ' 条');
            L.push('· 标签：' + ((Array.isArray(c.tags) && c.tags.length) ? c.tags.join('、') : '（无）'));
            // 这几样必须**报个数**。不报的话模型不知道卡里有没有状态栏 / MVU，
            // 要么干脆不碰，要么凭空去 write_doc 一个（把已有的覆盖掉）
            const nRx = Array.isArray(c.regex) ? c.regex.length : 0;
            const nTh = stCodeThList(c).filter(x => x.node.kind !== 'folder').length;
            const sd = stSbDetect();
            const md = stMvuDetect();
            L.push('· 正则脚本：' + nRx + ' 条；酒馆助手脚本：' + nTh + ' 个');
            L.push('· 状态栏：' + (sd.state === 'none' ? '没有'
                : (sd.state === 'mine' ? '有（本编辑器生成的，可以直接改）'
                    : '有，但是**别人手写的** —— read_doc 只给你原文，write_doc 会被拒绝')));
            L.push('· MVU：' + (md.hasCore ? '装好了' : (md.hasAny ? '装了一半（缺东西）' : '没装')));

            L.push('');
            L.push('## 卡里那几样「不是普通字段」的东西住在哪');
            L.push('· **状态栏**不是独立字段 —— 它的 HTML 住在「' + ST_MVU_RX_NAME.sbShow +
                '」那条正则的 replaceString 里。读它 read_doc({kind:"statusbar"})，' +
                '写它 write_doc —— 给 HTML，**别去动那条正则**。');
            L.push('· **MVU 的变量结构**也不是 —— 它是某条酒馆助手脚本里的 Zod 源码' +
                '（写着 registerMvuSchema 的那条）。读它 read_doc({kind:"mvu"})，' +
                '写它 write_doc —— 给**完整** Zod 源码，**别去动那个脚本**。');
            L.push('· 其它正则用 read_regex / write_regex，其它脚本用 read_th / write_th。' +
                '都是**按条目**改的：不传 id 先看清单，再拿 id 读全文、改那一条。');
            L.push('· ⚠ 用 write_regex 改「' + ST_MVU_RX_NAME.sbShow + '」那条、或用 write_th 改 ' +
                'MVU 那两个脚本，会被**拒绝** —— 它们是编辑器生成的，改了下一次写回就覆盖掉。' +
                '（只改开关是允许的。）');

            // 工具型 skill 和知识型 skill 在 system 里**必须分开讲** ——
            // 混在一起的话模型会去 read_skill 一个工具（读不到「正文」，
            // 读到的是源码），或者把知识型当工具调（调不动）
            const knowSkills = stCode.skills.filter(sk => sk.kind !== 'tool');
            const toolSkills = stCode.skills.filter(sk => sk.kind === 'tool' && sk.tool);
            if (toolSkills.length) {
                L.push('');
                L.push('## 用户装的工具（已经在你手上）');
                L.push('下面这些是用户导入的 skill，**已经注册成工具了** —— 直接调就行，' +
                    '不用 read_skill，也不用问用户参数怎么写：');
                toolSkills.forEach(sk => {
                    const ps = stCodeSkillPermsOf(sk);
                    L.push('· ' + sk.tool.name + ' —— ' + sk.tool.desc +
                        (ps.length ? '（它自己也能读改卡：' + ps.join(' / ') + '）' : ''));
                });
                L.push('⚠ 它们跑在沙盒里：**摸不到这张卡、也上不了网**。要读卡还是你自己用 ' +
                    'read_card / read_doc。上面标了「它自己也能读改卡」的，是它在沙盒里' +
                    '调得到那几个工具（走的是和你同一套工具，白名单、回收站、安全开关一样管着）；' +
                    '没标的就是纯算它自己那点东西。');
            }
            if (knowSkills.length) {
                const autoNames = (s0 && Array.isArray(s0.autoSkills)) ? s0.autoSkills : [];
                const auto = autoNames
                    .map(nm => knowSkills.filter(x => x.name === nm)[0]).filter(Boolean);
                const rest = knowSkills.filter(sk => auto.indexOf(sk) < 0);
                L.push('');
                L.push('## 可用的 skill');
                if (rest.length) {
                    L.push('下面这些是用户导入的 skill。**动手之前先看一眼有没有对口的**；' +
                        '有就用 read_skill 把它的正文读出来，照着它说的做。');
                    rest.forEach(sk => L.push('· ' + sk.name + ' —— ' + (sk.desc || '(无描述)')));
                } else {
                    L.push('（其它 skill 都已经自动加载了，正文见下一节）');
                }
                // 命中触发词的 skill：正文**直接装进 system**，不用模型再伸手。
                // ⚠ 装不下就退回「只列名字」而不是硬塞 —— 单个 skill 可以到 40000 字，
                //   一次把好几个全塞进来等于把上下文一次烧光
                if (auto.length) {
                    let used = 0;
                    const loaded = [];
                    const skipped = [];
                    auto.forEach(sk => {
                        const body = String(sk.body || '');
                        if (used + body.length > ST_CODE_AUTO_CHARS) { skipped.push(sk); return; }
                        used += body.length;
                        loaded.push(sk);
                    });
                    L.push('');
                    L.push('## 已自动加载的 skill（正文在下面，**照着做**，不用再 read_skill）');
                    loaded.forEach(sk => {
                        L.push('');
                        L.push('### ' + sk.name);
                        if (sk.desc) L.push(sk.desc);
                        L.push(String(sk.body || ''));
                    });
                    if (skipped.length) {
                        L.push('');
                        L.push('（这几个太长、没有自动装进来，要用就先 read_skill：' +
                            skipped.map(x => x.name).join('、') + '）');
                    }
                }
            }

            L.push('');
            L.push('## 限制');
            L.push('· 最多 **改卡 ' + th.steps + ' 次**（read_* 这类只读工具，以及**没申请改卡权限**的' +
                '工具型 skill，都不算在里面；但也别一直读 —— 连着读几十次就会被叫停）。');
            L.push('· 读到的内容太长时会带一个「' + ST_CODE_CUT_MARK + '」标记。' +
                '**看到这个标记就说明你没读全** —— 用 read_doc 的 from 接着往后读，' +
                '千万不要把带标记的那段写回去（等于把后半段删掉）。');
            L.push('· 只能改这些字段：' + ST_CODE_TEXT_PATHS.join(' / ') + '；数组字段：' + ST_CODE_LIST_PATHS.join(' / '));
            L.push('· 世界书条目用 add_world_entry / update_world_entry / delete_world_entry 动。');
            L.push('· 正则 / 脚本 / 状态栏 / MVU 不在上面那份名单里，' +
                '它们各有各的工具（见上一节），**不要**用 write_text 硬改。');
            L.push('· **你自己没有网络**。要读公网上的文档就用 fetch_url 让用户的浏览器代取，' +
                '但别拿它当搜索引擎反复试探 —— 每次调用都会真的发一次请求，结果还会占掉你的上下文。');
            L.push('· 每次工具调完就继续，**不要停下来等用户确认**。');
            if (!stCode.autoApply) {
                L.push('· ⚠ 用户当前**关闭了「工具真的改卡」**，你的写操作不会生效 —— 跟他说清楚。');
            }
            return L.join('\n');
        }

        // 会话消息 → 要发出去的消息。note 是给用户看的提示，**不发给模型**
        //
        // ⚠ 这里是 Code 页消息的**唯一出口** —— 要插「第一段」只在这里插，
        //   别去 stCodeSend 里另拼一份（那份会漏掉工具结果之类的分支）。
        // ⚠ 第一段必须排在最前面（`unshift` 到 system 之前），而且**默认不开**：
        //   这个开关一打开就改变了「发给模型的第一句话」，属于用户得自己知道的改动。
        //   复用 stAiFirstSegText() 而不是重写一遍 —— 它已经处理了 `{{char}}` 替换
        //   和「空着就不发」，重写一遍就等于把这套规则维护两处。
        function stCodeSysMsgs(s) {
            const out = [{ role: 'system', content: stCodeSystem(s) }];
            ((s && s.msgs) || []).forEach(m => {
                if (!m || m.role === 'note') return;
                out.push(m);
            });
            if (stCode.useFirstSeg) {
                const seg = stAiFirstSegText();
                // 开了开关但那段是空的 —— **不发空消息**（和 AI 助手那边一致）
                if (seg) out.unshift({ role: 'system', content: seg });
            }
            return out;
        }

        async function stCodeFetch(plan, cfg) {
            // ⚠ Vertex 完整模式要**现换 access token**，这个补头必须走和 AI 助手同一条
            //   （stAiPlanAuth）—— 漏掉它只会拿到 401，看着像 Key 写错了
            if (plan && plan.needsToken) await stAiPlanAuth(plan, cfg || stAiCfg());
            const ctl = (typeof AbortController === 'function') ? new AbortController() : null;
            if (ctl) stCode.abort = ctl;
            let resp;
            try {
                resp = await fetch(plan.url, {
                    method: 'POST',
                    headers: plan.headers,
                    body: JSON.stringify(plan.body),
                    ...(ctl ? { signal: ctl.signal } : {})
                });
            } catch (e) {
                throw new Error(stAiErrText(e));
            } finally {
                stCode.abort = null;
            }
            if (!resp.ok) {
                let t = '';
                try { t = (await resp.text()).slice(0, 300); } catch (e) {}
                throw new Error('HTTP ' + resp.status + (t ? ' ' + t : ''));
            }
            return await resp.json();
        }

        function stCodeStop() {
            if (stCode.abort) { try { stCode.abort.abort(); } catch (e) {} }
        }

