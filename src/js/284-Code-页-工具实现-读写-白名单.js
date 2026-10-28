        //   于是「删掉状态栏」会被放行。这不是理论问题，套件当场抓到过
        function stCodeOnlyToggle(a) {
            if (String((a && a.mode) || '') !== 'update') return false;
            return Object.keys(a || {}).every(k => k === 'mode' || k === 'id' ||
                k === 'disabled' || k === 'enabled');
        }

        async function stCodeToolRun(name, a) {
            const c = stEditor.card || stBlankCard();
            const entries = () => (Array.isArray(c.bookEntries) ? c.bookEntries : []);

            // ⚠ **工具型 skill 排在最前面**：它不在静态表里，下面那一长串 if 都认不出它。
            //   它跑在沙盒 iframe 里（不透明源 + CSP），所以**它自己**摸不到页面、也上不了网。
            //   ⚠ 但它能在沙盒里 `host.call('read_card', …)` 反过来调这里 —— 那条路的闸门
            //     在 `stCodeSkillRun` 的 `onHost` 里（按 manifest 声明的 perm 放行），
            //     而且**最终落到的就是下面这些分支**，所以白名单 / 回收站 / 安全开关一样管着
            const dyn = stCode.skills.filter(s => s.kind === 'tool' && s.tool &&
                s.tool.name === name)[0];
            if (dyn) {
                const r = await stCodeSkillRun(dyn, a);
                // ⚠ 它可能**已经改过卡了才失败**（先 host.call 写成功、再自己抛异常）。
                //   所以「卡没有动」不能无条件说 —— 那是假话，而且是最坏的那种：
                //   用户以为没动就不会去检查，改动就那么留在卡里
                const did = r.touched
                    ? '（⚠ 它**已经改过卡了**，卡里留着它的改动。）'
                    : '（卡没有动。）';
                if (!r.ok) {
                    return { ok: false, text: 'skill「' + dyn.name + '」没跑成：' + r.text +
                        '\n（这是它自己的问题，不是卡的问题。' + did + '）',
                        touched: r.touched || '' };
                }
                let out = r.text;
                if (out.length > ST_CODE_SANDBOX_OUT) {
                    out = out.slice(0, ST_CODE_SANDBOX_OUT) + '\n' + ST_CODE_CUT_MARK;
                }
                return { ok: true, text: 'skill「' + dyn.name + '」返回：\n' + out,
                    touched: r.touched || '' };
            }

            if (name === 'read_card') {
                const p = String(a.path || '').trim();
                // 不带 path = 整张卡。⚠ 一定要走 stCodeBrief —— 一张卡轻松几十万字，
                // 硬截断会让模型拿到一段**看起来完整**的 JSON，然后当成全部
                if (!p) return { ok: true, text: stCodeBrief(c) };
                // ⚠ 指路要放在**解析之前**。`regex` / `thScripts` / `statusBar` / `mvu`
                //   都是卡里**真实存在**的字段，stCodeGetPath 是查得到的 ——
                //   放在「字段不存在」那个分支里根本走不到，模型拿到的会是一坨
                //   内部表示的 JSON（statusBar / mvu 那两份还只是编辑器的**工作副本**，
                //   对别人的卡来说压根不是卡里的东西，读它等于读了个假象）
                const root = p.split('.')[0];
                const hint = ST_CODE_PATH_HINT[root];
                if (hint) {
                    return { ok: false, text: '「' + p + '」别用 read_card 读 —— ' +
                        '它在卡里，但要看它得走别的工具：' + hint + '。' };
                }
                const v = stCodeGetPath(c, p);
                if (v === undefined) {
                    return { ok: false, text: '卡里没有这个字段：' + p +
                        '。可用字段：' + ST_CODE_TEXT_PATHS.concat(ST_CODE_LIST_PATHS).join(' / ') +
                        '。另外 regex / thScripts / statusBar / mvu 要用 read_regex / read_th / read_doc。' };
                }
                // 对象一律走摘要：小对象照样原样给，大的给形状
                if (typeof v === 'object' && v !== null) return { ok: true, text: stCodeBrief(v) };
                return { ok: true, text: String(v) };
            }

            if (name === 'write_text') {
                const p = String(a.path || '').trim();
                if (ST_CODE_TEXT_PATHS.indexOf(p) < 0) {
                    return { ok: false, text: '这个字段不允许写：' + (p || '(空)') +
                        '。可写的只有：' + ST_CODE_TEXT_PATHS.join(' / ') };
                }
                // ⚠ **没给 value 要拒，不能当空串写进去**。原来这里是
                //   `String(a.value == null ? '' : a.value)` —— 模型（或 skill）少写一个
                //   参数名、或者把 `text` 当成了参数名，结果就是**把那个字段清空**，
                //   而且返回的是「已写入 xxx（现在 0 字）」这种成功回执。同一族问题：
                //   空值不覆盖（见 write_list 的 items、update 的「没传的字段不动」）。
                //   ⚠ 空串 `""` 仍然是**合法**值 —— 那是「故意清空」，和「忘了给」不一样
                if (a.value === undefined || a.value === null) {
                    return { ok: false, text: '没给 value。要写什么得放在 value 里 —— ' +
                        '例如 { path: "description", value: "新的设定" }。' +
                        '（想清空一个字段就显式传 value: ""，那样才是故意的。）**卡没有动。**' };
                }
                const v = String(a.value);
                const cut = stCodeCutGuard(v);
                if (cut) return cut;
                if (!stCode.autoApply) return { ok: true, text: '（已关闭「真的改卡」，这一步只演示，没有写进去）' };
                stCodeSetPath(c, p, v);
                c.modificationDate = Math.floor(Date.now() / 1000);
                return { ok: true, text: '已写入 ' + p + '（现在 ' + v.length + ' 字）', touched: p };
            }

            if (name === 'write_list') {
                const p = String(a.path || '').trim();
                if (ST_CODE_LIST_PATHS.indexOf(p) < 0) {
                    return { ok: false, text: '这个字段不允许写：' + (p || '(空)') +
                        '。可写的只有：' + ST_CODE_LIST_PATHS.join(' / ') };
                }
                const mode = ['replace', 'append', 'remove'].indexOf(String(a.mode || 'replace')) >= 0
                    ? String(a.mode || 'replace') : 'replace';
                const items = stCodeStrList(a.items);
                if (!items.length) return { ok: false, text: 'items 是空的，没东西可写' };
                if (!stCode.autoApply) return { ok: true, text: '（已关闭「真的改卡」，这一步只演示，没有写进去）' };
                let cur = stCodeGetPath(c, p);
                if (!Array.isArray(cur)) cur = [];
                if (mode === 'append') cur = cur.concat(items);
                else if (mode === 'remove') cur = cur.filter(x => items.indexOf(String(x)) < 0);
                else cur = items.slice();
                const seen = [];
                cur.forEach(x => { const s = String(x == null ? '' : x).trim(); if (s && seen.indexOf(s) < 0) seen.push(s); });
                stCodeSetPath(c, p, seen);
                const verb = mode === 'append' ? '追加' : (mode === 'remove' ? '移除' : '替换');
                return { ok: true, text: '已' + verb + ' ' + p + '，现在有 ' + seen.length + ' 项：' + seen.join('、'), touched: p };
            }

            if (name === 'list_world_entries') {
                const list = entries();
                if (!list.length) return { ok: true, text: '（世界书是空的）' };
                const lines = list.map((e, i) => (i + 1) + '. id=' + e.id +
                    ' | 备注=' + (e.comment || '(空)') +
                    ' | 关键词=' + ((Array.isArray(e.keys) && e.keys.length) ? e.keys.join('、') : '(无)') +
                    ' | ' + (e.enabled === false ? '停用' : '启用') +
                    ' | 位置=' + (e.position == null ? 0 : e.position) +
                    ' | ' + String(e.content || '').replace(/\s+/g, ' ').slice(0, 50));
                return { ok: true, text: '世界书共 ' + list.length + ' 条：\n' + lines.join('\n') };
            }

            if (name === 'read_world_entry') {
                const e = stCodeFindEntry(c, a.id);
                if (!e) return { ok: false, text: '找不到这条条目：' + a.id + '。先用 list_world_entries 看一遍' };
                return { ok: true, text: stCodeJsonText(e, 2) };
            }

            if (name === 'add_world_entry') {
                const e = stBlankEntry();
                stCodeFillEntry(e, a);
                if (!String(e.content || '').trim()) return { ok: false, text: 'content 是空的，没东西可加' };
                if (!stCode.autoApply) return { ok: true, text: '（已关闭「真的改卡」，这一步只演示，没有写进去）' };
                c.bookEntries = entries().concat([e]);
                return { ok: true, text: '已新增世界书条目，id=' + e.id +
                    '，备注=' + (e.comment || '(空)') + '，正文 ' + String(e.content || '').length + ' 字',
                    touched: 'bookEntries' };
            }

            if (name === 'update_world_entry') {
                const e = stCodeFindEntry(c, a.id);
                if (!e) return { ok: false, text: '找不到这条条目：' + a.id + '。先用 list_world_entries 看一遍' };
                const before = String(e.content || '').length;
                if (!stCode.autoApply) return { ok: true, text: '（已关闭「真的改卡」，这一步只演示，没有写进去）' };
                stCodeFillEntry(e, a);
                return { ok: true, text: '已更新条目 ' + e.id + '（备注 ' + (e.comment || '(空)') +
                    '，正文 ' + before + ' 字 → ' + String(e.content || '').length + ' 字）',
                    touched: 'bookEntries' };
            }

            if (name === 'delete_world_entry') {
                const list = entries();
                const key = String(a.id == null ? '' : a.id).trim();
                const i = list.findIndex(x => x && (x.id === key || x.comment === key));
                if (i < 0) return { ok: false, text: '找不到这条条目：' + a.id };
                if (!stCode.autoApply) return { ok: true, text: '（已关闭「真的改卡」，这一步只演示，没有写进去）' };
                const gone = list.splice(i, 1)[0];
                // 删掉的东西留在回收站里，用户能撤回 —— 模型误删一条手写条目是很疼的
                // ⚠ 回收站里装的是**带 kind 的包装**而不是条目本身：正则 / 脚本的删除
                //   也走这里，撤回时必须知道该放回哪个数组（见 stCodeUndoDelete）
                stCode.trash.push({ kind: 'book', item: gone });
                return { ok: true, text: '已删除条目：' + (gone.comment || gone.id) + '（进了回收站，用户可撤回）',
                    touched: 'bookEntries' };
            }

            if (name === 'list_skills') {
                if (!stCode.skills.length) {
                    return { ok: true, text: '（用户还没导入 skill。让他去工具条的「🧩 当前 skill 列表」里导入）' };
                }
                // ⚠ 两种要标出来：工具型的**已经在工具表里了**，去 read_skill 只会读到源码。
                //   ⚠ 工具型还要标**它能碰卡到什么程度** —— 模型据此决定「要不要自己先读一遍」
                //     以及「先调谁后调谁」（一个能改卡的工具，顺序就有意义了）
                const line = s => {
                    if (s.kind !== 'tool') return '· [知识] ' + s.name + ' —— ' + (s.desc || '(无描述)');
                    const ps = stCodeSkillPermsOf(s);
                    return '· [工具] ' + s.tool.name + ' —— ' + (s.desc || '(无描述)') +
                        (ps.length ? '（它自己也能读改卡：' + ps.join(' / ') + '）'
                                   : '（纯算它自己的东西，碰不到卡）');
                };
                return { ok: true, text: '共 ' + stCode.skills.length + ' 个 skill：\n' +
                    stCode.skills.map(line).join('\n') +
                    '\n\n[工具] 的**直接调**，不用 read_skill；[知识] 的用 read_skill 读正文。' +
                    '\n工具型跑在沙盒里，**上不了网**；能不能碰卡看上面那句。' };
            }

            if (name === 'read_skill') {
                const key = String(a.name == null ? '' : a.name).trim().toLowerCase();
                if (!key) return { ok: false, text: 'name 是空的' };
                const s = stCode.skills.filter(x => x.name.toLowerCase() === key)[0] ||
                    stCode.skills.filter(x => x.name.toLowerCase().indexOf(key) >= 0)[0] ||
                    stCode.skills.filter(x => key.indexOf(x.name.toLowerCase()) >= 0)[0];
                if (!s) return { ok: false, text: '没有这个 skill：' + a.name + '。用 list_skills 看看有哪些' };
                // 工具型 skill 的 body 是**源码**。给出去等于让模型去读一份实现 ——
                // 它该做的是「调」，所以这里指回工具名
                if (s.kind === 'tool') {
                    // ⚠ 「读不到卡」不能无条件说 —— 申请过 card.read / card.write 的碰得到。
                    //   说错了的后果是模型**放弃**它自己能做的事（「反正它读不到」）
                    const ps = stCodeSkillPermsOf(s);
                    return { ok: false, text: '「' + s.name + '」是**工具型** skill，不用读正文 —— ' +
                        '它已经注册成工具「' + s.tool.name + '」了，直接调就行。' +
                        '它跑在沙盒里，**上不了网**；' +
                        (ps.length ? '它自己也能读改卡（' + ps.join(' / ') + '）。'
                                   : '碰不到卡。') };
                }
                return { ok: true, text: '# ' + s.name + '\n' + (s.desc ? s.desc + '\n\n' : '') + s.body };
            }

            if (name === 'fetch_url') {
                // 唯一一个**会发网络请求**的工具。闸门在 stCodeFetchText 里（只放行公网
                // http/https），这里只管把结果整形。取回来的东西是**别人写的文字** ——
                // 工具描述里已经写明「你自己没有网络」，正文照原样给，不加任何指令性包装
                const raw = String(a.url == null ? '' : a.url).trim();
                const g = stCodeUrlGuard(raw);
                if (!g.ok) return { ok: false, text: '这个地址不能取：' + g.why };
                let txt = '';
                try {
                    txt = await stCodeFetchText(g.url, ST_CODE_FETCH_CHARS);
                } catch (e) {
                    return { ok: false, text: '取不到：' + ((e && e.message) || e) };
                }
                return { ok: true, text: '（下面是 ' + g.url + ' 的正文）\n' + txt };
            }

            if (name === 'set_tasks') {
                const raw = Array.isArray(a.tasks) ? a.tasks : [];
                const list = [];
                raw.forEach(t => {
                    const src = (t && typeof t === 'object') ? t : { text: t };
                    const text = String(src.text == null ? '' : src.text)
                        .replace(/\s+/g, ' ').trim().slice(0, ST_CODE_TASK_CHARS);
                    if (!text) return;  // 空条目直接丢，不报错 —— 模型偶尔会塞一条占位的
                    const st = String(src.status || '');
                    list.push({
                        text: text,
                        status: ST_CODE_TASK_ST.some(x => x.id === st) ? st : 'pending'
                    });
                });
                if (!list.length) return { ok: false, text: 'tasks 是空的（每条至少要有 text）' };
                const cut = list.slice(0, ST_CODE_TASKS_MAX);
                stCodeSession().tasks = cut;
                stCodeSaveSessions();
                stCodeTasksRefresh();
                const done = cut.filter(x => x.status === 'done').length;
                const doing = cut.filter(x => x.status === 'doing').length;
                return { ok: true, text: '已记录 ' + cut.length + ' 条任务（完成 ' + done +
                    ' / 进行中 ' + doing + '）' + (list.length > cut.length
                        ? '。⚠ 超出 ' + ST_CODE_TASKS_MAX + ' 条的 ' + (list.length - cut.length) +
                          ' 条被丢掉了，请合并一下' : '') };
            }

            if (name === 'remember') {
                const text = String(a.text == null ? '' : a.text).replace(/\s+/g, ' ').trim();
                if (!text) return { ok: false, text: 'text 是空的' };
                const line = '- ' + text.slice(0, 200);
                const cur = String(stCode.memo || '').trim();
                // 同一件事模型很容易说两遍 —— 已经有了就当成功，别报错
                if (cur.split('\n').some(x => x.trim() === line)) {
                    return { ok: true, text: '这条已经记过了，没有重复添加。' };
                }
                const next = cur ? (cur + '\n' + line) : line;
                if (next.length > ST_CODE_MEMO_CHARS) {
                    return { ok: false, text: '项目记忆满了（上限 ' + ST_CODE_MEMO_CHARS +
                        ' 字）。告诉用户去工具条的「📝 记忆」面板里删掉几条。' };
                }
                stCode.memo = next;
                const saved = stCodeSaveMemo();
                stCodeMemoRefresh();
                const n = next.split('\n').filter(x => x.trim()).length;
                return { ok: true, text: (saved ? '已记下' :
                    '⚠ 存不下（localStorage 满了），只在这次会话里有效') +
                    '，现在一共 ' + n + ' 条。用户可以在工具条的「📝 记忆」里看到和修改。' };
            }

            // ===== 状态栏 / MVU：整份文本往返 =====
            //
            // 这两样**不是卡上的普通字段**：状态栏 HTML 住在「状态栏界面」那条正则的
            // replaceString 里，MVU 的变量结构住在某条酒馆助手脚本的 content 里。
            // 所以路径工具（read_card / write_text）够不着它们。
            // 但它们各有一条**现成的往返通道**，而且都是模型最擅长的文本：
            //   状态栏：stSbDocHtml / stSbParseDoc  —— 进去出来都是 HTML
            //   MVU   ：stMvuZodCode / stMvuParseZod —— 进去出来都是 Zod 源码
            // 所以这里给原文、收原文，**不给那棵树** —— 树是编辑器内部表示，
            // 让模型拼 JSON 树既啰嗦又容易把结构写坏。
            //
            // ⚠ 和别的工具最大的不同：这两样是「**一份**」而不是「一列」，
            //   所以是整份替换，没有 add / update / delete。改坏一整个状态栏
            //   比改坏一条世界书条目疼得多，所以解析失败一律**报错 + 原样退回**，
            //   绝不「尽力而为地写个大概进去」。
            if (name === 'read_doc') {
                const kind = String(a.kind || '').trim();
                // 从第几个字开始读（0 起）。正常读全文时是 0 —— 只有在
                // 「上一次读被截断」时才该带 from 接着往后读
                const from = Math.max(0, Math.floor(Number(a.from) || 0));
                // 分段读的包装：正文 + 围栏前后那点说明，一次不超过 ST_CODE_DOC_CHUNK。
                // ⚠ 两行提示都放在**围栏外面** —— 模型要抄的是围栏里那段，
                //   把提示抄进去就写脏了
                const sliceDoc = (core, pre, post) => {
                    const all = String(core);
                    const off = Math.min(from, all.length);
                    let part = all.slice(off);
                    let next = 0;
                    if (part.length > ST_CODE_DOC_CHUNK) {
                        part = part.slice(0, ST_CODE_DOC_CHUNK);
                        next = off + part.length;
                    }
                    const head = off > 0
                        ? '⚠ 你读的是**中间一段**：第 ' + off + '–' + (off + part.length) +
                          ' 字，全文 ' + all.length + ' 字。\n\n' : '';
                    const tail = next
                        ? '\n\n⚠ 后面还有 ' + (all.length - next) + ' 字没读到 —— 接着读：' +
                          'read_doc({kind:"' + kind + '", from:' + next + '})。' +
                          '**没读全之前不要 write_doc。**'
                        : (off > 0 ? '\n\n（到这里就是结尾了。）' : '');
                    return head + pre + part + post + tail;
                };
                if (kind === 'statusbar') {
                    const d = stSbDetect();
                    if (!d.regex) {
                        return { ok: true, text: '这张卡里没有「状态栏界面」这条正则 —— ' +
                            '也就是还没有状态栏。\n想建一个：write_doc({kind:"statusbar", ' +
                            'text:"<body 里那段 HTML>"})。' };
                    }
                    if (d.state === 'foreign') {
                        // 别人手写的。**原样**给它，别拿编辑器里那份默认状态栏冒充 ——
                        // 那是骗它，它改完写回来会把原作者的东西整个换掉
                        return { ok: true, text: sliceDoc(String(d.regex.replaceString || ''),
                            '⚠ 卡里这条「状态栏界面」是**别人手写的**' +
                            '（没有本编辑器的结构标记），下面给的是**原样**：\n\n',
                            '\n\n⚠ 这种状态栏 write_doc 改不了 —— ' +
                            '要让用户先在「状态栏」页点一次「接管」。') };
                    }
                    const sb = stEditor.card.statusBar || stBlankStatusBar();
                    return { ok: true, text: sliceDoc(stSbBodyHtml(sb, false),
                        '这是本编辑器生成的状态栏，body 里的 HTML：\n\n```html\n',
                        '\n```\n\n' +
                        '改完用 write_doc({kind:"statusbar", text:…}) 写回去。' +
                        '不用带 ``` 围栏，围栏和围栏外的说明文字会自动保留。') };
                }
                if (kind === 'mvu') {
                    const d = stMvuDetect();
                    if (!d.zodScript) {
                        return { ok: true, text: '这张卡里没有 MVU 变量结构' +
                            '（找不到写着 registerMvuSchema 的脚本）。\n' +
                            '想建一个：write_doc({kind:"mvu", text:"<完整 Zod 源码>"})。' };
                    }
                    const z = stMvuZodParsed();
                    return { ok: true, text: sliceDoc(String(d.zodScript.content || ''),
                        '这是卡里 MVU 的 Zod 变量结构：\n\n```js\n',
                        '\n```\n\n' +
                        '改完用 write_doc({kind:"mvu", text:…}) 写回去' +
                        '（要**完整**源码，含 registerMvuSchema(…)）。' +
                        (z.state === 'ok' ? '' : '\n\n⚠ 这份 Zod 的写法编辑器读不回来（认不出变量树）。' +
                            '可以整个替换，但**替换前先把现在这份抄走** —— 替换之后就回不去了。')) };
                }
                return { ok: false, text: 'kind 只能是 statusbar 或 mvu' };
            }

            if (name === 'write_doc') {
                const kind = String(a.kind || '').trim();
                const text = String(a.text == null ? '' : a.text);
                if (kind !== 'statusbar' && kind !== 'mvu') {
                    return { ok: false, text: 'kind 只能是 statusbar 或 mvu' };
                }
                if (!text.trim()) return { ok: false, text: 'text 是空的，没东西可写' };
                const cut = stCodeCutGuard(text);
                if (cut) return cut;

                if (kind === 'statusbar') {
                    const d = stSbDetect();
                    if (d.state === 'foreign') {
                        return { ok: false, text: '卡里这条「状态栏界面」是**别人手写的**，' +
                            '整份改写会把原作者的东西整个换掉。\n' +
                            '要么让用户先在「状态栏」页点一次「接管」（编辑器会把原稿尽量拆成可编辑的块），' +
                            '要么用 write_regex 精确改那一条里的某段文字。**卡没有动。**' };
                    }
                    const r = stSbParseDoc(text);
                    if (!r.ok) {
                        return { ok: false, text: '这段 HTML 解析不了：' + r.why +
                            '\n原样退回了，**卡没有动**。给 <body> 里那段 HTML 就行，不用带围栏。' };
                    }
                    if (!r.blocks.length) {
                        return { ok: false, text: '这段 HTML 里没解析出任何能编辑的块' +
                            '（只有文字？）。**卡没有动。**' };
                    }
                    if (!stCode.autoApply) {
                        return { ok: true, text: '（已关闭「真的改卡」，这一步只演示，没有写进去）' };
                    }
                    const old = stEditor.card.statusBar || stBlankStatusBar();
                    const isNew = !d.regex;
                    // 围栏外的说明文字**不是**这次要改的东西 —— 卡里已有就一律拿卡里那份，
                    // 模型只负责围栏里那段 HTML（新建时没得拿，才用它自己带的）
                    stEditor.card.statusBar = stStatusBarFromRaw({
                        theme: r.theme, width: r.width, shellExtra: r.shellExtra,
                        shellCls: r.shellCls, shellOff: r.shellOff, blocks: r.blocks,
                        pre: isNew ? r.runtime.pre : old.pre,
                        post: isNew ? r.runtime.post : old.post
                    });
                    if (isNew) {
                        // 卡里还没有这条正则 —— 顺手建一条，形状照 MVU 五件套里那条
                        stEditor.card.regex = (Array.isArray(stEditor.card.regex)
                            ? stEditor.card.regex : []).concat([
                            stMvuMakeRegex(ST_MVU_RX_NAME.sbShow, ST_MVU_PLACEHOLDER, '',
                                { placement: [2], promptOnly: false, markdownOnly: true })
                        ]);
                    }
                    stEditor.sbOwn = true;
                    const did = stSbSync(true);
                    stSaveDraft();
                    const n = stSbCount(stEditor.card.statusBar.blocks);
                    const notes = ['已写入状态栏：' + n + ' 个块'];
                    if (isNew) notes.push('（卡里原来没有，顺手建了「' +
                        ST_MVU_RX_NAME.sbShow + '」这条正则）');
                    if (r.stats.raw) notes.push('其中 ' + r.stats.raw +
                        ' 个块认不出来，原样留成了「高级 HTML」—— 没丢，' +
                        '但在「状态栏」页里只能当文本改');
                    if (r.stats.keptDecls) notes.push('有 ' + r.stats.keptDecls +
                        ' 条编辑器画不出来的样式，已原样保住');
                    if (r.keepOk === false) notes.push('⚠ 有 ' + r.keepMiss.length +
                        ' 条样式没能写进产物：' + r.keepMiss.join(' / '));
                    if (!r.runtime.ok) notes.push('⚠ 原稿的包装不合格（' + r.runtime.why +
                        '）→ 写回时已补成合格的包装，等于顺手修好了');
                    if (r.textOk === false) notes.push('⚠ 文字内容和你给的原文对不上，请核一遍');
                    if (!did) notes.push('（生成结果和卡里已有一致，没有实际改动）');
                    return { ok: true, text: notes.join('\n'), touched: 'statusBar' };
                }

                // kind === 'mvu'
                if (text.indexOf('registerMvuSchema') < 0) {
                    return { ok: false, text: '这段 Zod 里没有 registerMvuSchema(…)。' +
                        '改变量结构必须走这个调用 —— 没有它编辑器不知道注册的是哪个 schema，' +
                        '也就没法保证下次写回时改的是对的那个（作者常写 ' +
                        '`const Base = z.object({…})` 再 `Base.extend({…})`，' +
                        '不指名的话很可能改到基底上去）。**卡没有动。**' };
                }
                const parsed = stMvuParseZod(text);
                if (!parsed) {
                    return { ok: false, text: '这段 Zod 解析不了。只认本编辑器会生成的那套写法 ' +
                        '加常见变体：z.coerce.number() / .int() / ' +
                        '.transform(v => _.clamp(v, a, b)) / .describe() / .prefault()。\n' +
                        '原样退回了，**卡没有动**。' };
                }
                if (!stCode.autoApply) {
                    return { ok: true, text: '（已关闭「真的改卡」，这一步只演示，没有写进去）' };
                }
                const d2 = stMvuDetect();
                const isNew = !d2.zodScript;
                stEditor.card.mvu.nodes = parsed.map(stMvuNodeFromRaw);
                if (isNew) {
                    const s = stBlankThScript();
                    s.name = ST_MVU_ZOD_NAME;
                    s.enabled = true;
                    s.content = text;
                    s.info = '变量结构校验（zod）。内容由「变量结构」页自动生成 —— ' +
                        '在那边改结构，这里会跟着重写。';
                    stEditor.card.thScripts.push(s);
                }
                stEditor.mvuOwn = true;
                const did = stMvuSync();
                stSaveDraft();
                const n = stMvuCount(stEditor.card.mvu.nodes);
                const notes = ['已写入 MVU 变量结构：' + n + ' 个变量'];
                if (isNew) notes.push('（卡里原来没有 Zod 脚本，顺手建了一个）');
                if (d2.initvar) notes.push('世界书「[InitVar]」的初始值也跟着重写了');
                else notes.push('⚠ 卡里没有 [InitVar] 世界书条目，初始值没地方写 —— ' +
                    '变量会全部用 Zod 里的默认值');
                if (!did && !isNew) notes.push('（生成结果和卡里已有一致，没有实际改动）');
                return { ok: true, text: notes.join('\n'), touched: 'mvu' };
            }

            // ===== 正则 / 酒馆助手脚本：按条目 =====
            //
            // 和世界书那套同一个形状（清单 / 读一条 / 增 / 改 / 删，按 id 定位），
            // 而**不是**整列替换。理由是整列替换会**静默丢东西**：
            // 模型看不到的那几条会被它一起写没，而且没有任何报错。
            // 按条目操作时，它没提到的东西根本不会被碰到。
            if (name === 'read_regex') {
                const list = Array.isArray(c.regex) ? c.regex : [];
                const key = String(a.id == null ? '' : a.id).trim();
                if (!key) {
                    if (!list.length) return { ok: true, text: '（卡里没有正则脚本）' };
                    const lines = list.map((r, i) => (i + 1) + '. id=' + r.id +
                        ' | ' + (stStr(r.scriptName) || '(无名)') +
                        ' | ' + (r.disabled === false ? '启用' : '停用') +
                        ' | 匹配=' + String(r.findRegex || '').replace(/\s+/g, ' ').slice(0, 60) +
                        ' | 替换 ' + String(r.replaceString || '').length + ' 字');
                    return { ok: true, text: '卡里共 ' + list.length + ' 条正则：\n' +
                        lines.join('\n') + '\n\n要看某一条的全文：read_regex({id:"…"})。' };
                }
                const r = stCodeFindRegex(c, key);
                if (!r) return { ok: false, text: '找不到这条正则：' + key +
                    '。先用 read_regex 不带 id 看一遍' };
                const g = stCodeEntryGuard('regex', r);
                return { ok: true, text: (g.locked ? '⚠ ' + g.why + '\n\n' : '') +
                    stCodeJsonText(r, 2) };
            }

            if (name === 'write_regex') {
                const mode = String(a.mode || '').trim();
                const key = String(a.id == null ? '' : a.id).trim();
                const list = Array.isArray(c.regex) ? c.regex : [];
                if (mode === 'add') {
                    const nm = String(a.scriptName == null ? '' : a.scriptName).trim();
                    if (!nm) return { ok: false, text: 'scriptName 是空的 —— 正则得有名字' };
                    if (!String(a.findRegex == null ? '' : a.findRegex).trim()) {
                        return { ok: false, text: 'findRegex 是空的 —— 没有匹配规则的替身什么都没做' };
                    }
                    if (!stCode.autoApply) {
                        return { ok: true, text: '（已关闭「真的改卡」，这一步只演示，没有写进去）' };
                    }
                    const r = stBlankRegex();
                    r.scriptName = nm;
                    stCodeFillRegex(r, a);
                    c.regex = list.concat([r]);
                    return { ok: true, text: '已新增正则「' + nm + '」，id=' + r.id +
                        '，' + (r.disabled ? '停用' : '启用') +
                        '（新加的正则默认启用，要关就给 disabled:true）', touched: 'regex' };
                }
                if (mode !== 'update' && mode !== 'delete') {
                    return { ok: false, text: 'mode 只能是 add / update / delete' };
                }
                if (!key) return { ok: false, text: 'mode=' + mode + ' 要给 id' };
                const r = stCodeFindRegex(c, key);
                if (!r) return { ok: false, text: '找不到这条正则：' + key +
                    '。先用 read_regex 不带 id 看一遍' };
                const g = stCodeEntryGuard('regex', r);
                if (g.locked && !stCodeOnlyToggle(a)) {
                    return { ok: false, text: '⚠ 这条不能改：' + g.why +
                        '\n（只改开关是允许的，给 disabled 就行。）**卡没有动。**' };
                }
                if (!stCode.autoApply) {
                    return { ok: true, text: '（已关闭「真的改卡」，这一步只演示，没有写进去）' };
                }
                const nm = stStr(r.scriptName) || r.id;
                if (mode === 'update') {
                    const before = String(r.replaceString || '').length;
                    stCodeFillRegex(r, a);
                    return { ok: true, text: '已更新正则「' + nm + '」' +
                        (a.replaceString !== undefined ? '（替换文本 ' + before + ' 字 → ' +
                            String(r.replaceString || '').length + ' 字）' : ''),
                        touched: 'regex' };
                }
                const i = c.regex.indexOf(r);
                if (i >= 0) {
                    const gone = c.regex.splice(i, 1)[0];
                    stCode.trash.push({ kind: 'regex', item: gone });
                }
                return { ok: true, text: '已删除正则「' + nm +
                    '」（进了回收站，用户可撤回）', touched: 'regex' };
            }

            if (name === 'read_th') {
                const key = String(a.id == null ? '' : a.id).trim();
                const all = stCodeThList(c);
                if (!key) {
                    if (!all.length) return { ok: true, text: '（卡里没有酒馆助手脚本）' };
                    const nScript = all.filter(x => x.node.kind !== 'folder').length;
                    const lines = all.map((x, i) => (i + 1) + '. id=' + x.node.id +
                        ' | ' + (x.node.kind === 'folder' ? '📁 ' : '') +
                        (stStr(x.node.name) || '(无名)') +
                        (x.node.kind === 'folder'
                            ? '（文件夹，里面 ' + ((x.node.scripts || []).length) + ' 个脚本）'
                            : ' | ' + (x.node.enabled === false ? '停用' : '启用') +
                              ' | 正文 ' + String(x.node.content || '').length + ' 字'));
                    return { ok: true, text: '卡里共 ' + nScript + ' 个脚本' +
                        (all.length > nScript ? '（另有 ' + (all.length - nScript) + ' 个文件夹）' : '') +
                        '：\n' + lines.join('\n') + '\n\n要看正文：read_th({id:"…"})。' };
                }
                const hit = stCodeFindTh(c, key);
                if (!hit) return { ok: false, text: '找不到这个脚本：' + key +
                    '。先用 read_th 不带 id 看一遍' };
                const g = stCodeEntryGuard('th', hit.node);
                return { ok: true, text: (g.locked ? '⚠ ' + g.why + '\n\n' : '') +
                    'id=' + hit.node.id + ' | ' + (stStr(hit.node.name) || '(无名)') +
                    ' | ' + (hit.node.enabled === false ? '停用' : '启用') +
                    ' | 路径=' + hit.path + '\n\n```js\n' +
                    String(hit.node.content || '') + '\n```' };
            }

            if (name === 'write_th') {
                const mode = String(a.mode || '').trim();
                const key = String(a.id == null ? '' : a.id).trim();
                if (mode === 'add') {
                    const nm = String(a.name == null ? '' : a.name).trim();
                    if (!nm) return { ok: false, text: 'name 是空的 —— 脚本得有名字' };
                    if (!stCode.autoApply) {
                        return { ok: true, text: '（已关闭「真的改卡」，这一步只演示，没有写进去）' };
                    }
                    const s = stBlankThScript();
                    s.name = nm;
                    stCodeFillTh(s, a);
                    c.thScripts = (Array.isArray(c.thScripts) ? c.thScripts : []).concat([s]);
                    return { ok: true, text: '已新增脚本「' + nm + '」，id=' + s.id +
                        '，' + (s.enabled ? '启用' : '停用') +
                        '（新脚本默认**停用**，要开就给 enabled:true）', touched: 'thScripts' };
                }
                if (mode !== 'update' && mode !== 'delete') {
                    return { ok: false, text: 'mode 只能是 add / update / delete' };
                }
                if (!key) return { ok: false, text: 'mode=' + mode + ' 要给 id' };
                const hit = stCodeFindTh(c, key);
                if (!hit) return { ok: false, text: '找不到这个脚本：' + key +
                    '。先用 read_th 不带 id 看一遍' };
                const g = stCodeEntryGuard('th', hit.node);
                if (g.locked && !stCodeOnlyToggle(a)) {
                    return { ok: false, text: '⚠ 这个不能改：' + g.why +
                        '\n（只改开关是允许的，给 enabled 就行。）**卡没有动。**' };
                }
                if (!stCode.autoApply) {
                    return { ok: true, text: '（已关闭「真的改卡」，这一步只演示，没有写进去）' };
                }
                const nm = stStr(hit.node.name) || hit.node.id;
                if (mode === 'update') {
                    const before = String(hit.node.content || '').length;
                    stCodeFillTh(hit.node, a);
                    return { ok: true, text: '已更新脚本「' + nm + '」（正文 ' + before +
                        ' 字 → ' + String(hit.node.content || '').length + ' 字）',
                        touched: 'thScripts' };
                }
                const gone = hit.list.splice(hit.index, 1)[0];
                stCode.trash.push({ kind: 'th', item: gone });
                return { ok: true, text: '已删除脚本「' + nm +
                    '」（进了回收站，用户可撤回）', touched: 'thScripts' };
            }

            return { ok: false, text: '没有这个工具：' + name };
        }

