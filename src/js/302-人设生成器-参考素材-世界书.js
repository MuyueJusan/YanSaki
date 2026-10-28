        // ===== 人设生成器 · 参考素材（世界书） =====
        //
        // 两路来源，**同一套渲染 / 解析**：
        //   · 'card' —— 本卡世界书 `card.bookEntries`
        //   · 'imp'  —— 用户额外导入的那一本（`stEditor.personaLore`，**不进卡**）
        //
        // ⚠ 别把导入的书并进 `card.bookEntries`：那样「额外导入」就变成了「偷偷改卡」，
        //   而用户点的是「导入来生成角色」，不是「把这本书加到卡里」。

        function stPersonaPickKey(src, id) { return src + ':' + id; }

        // 现在能选的全部来源。空书不出现在列表里（免得出现一个 0 条的标题）
        function stPersonaLoreSources() {
            const out = [];
            const card = stEditor.card;
            if (card && Array.isArray(card.bookEntries) && card.bookEntries.length) {
                out.push({
                    src: 'card',
                    name: stStr(card.bookName) || '本卡世界书',
                    entries: card.bookEntries
                });
            }
            const imp = stEditor.personaLore;
            if (imp && Array.isArray(imp.entries) && imp.entries.length) {
                out.push({ src: 'imp', name: imp.name || '导入的世界书', entries: imp.entries });
            }
            return out;
        }

        function stPersonaPickHas(key) {
            const a = Array.isArray(stEditor.personaPick) ? stEditor.personaPick : [];
            return a.indexOf(key) >= 0;
        }

        // 解析勾选 → 真正要喂给 AI 的那几段。
        // 返回的 missing / dropped / truncated 三个数**必须被说出来**：
        //   missing   = 勾了但条目已经不在（世界书页删了 / 换了张卡）
        //   dropped   = 条目在，但正文是空的（只有关键词或常驻标记）
        //   truncated = 总字符超了预算，这一条没进去
        // ⚠ 「静默少喂几条」是这个功能最容易出的坑：界面上勾着 5 条、模型只看到 3 条，
        //   而生成结果看起来完全正常 —— 只能靠这里记账、再在提示里报出来。
        function stPersonaLoreResolve() {
            const picks = Array.isArray(stEditor.personaPick) ? stEditor.personaPick : [];
            const byKey = {};
            stPersonaLoreSources().forEach(s => {
                s.entries.forEach(e => {
                    if (e && e.id) byKey[stPersonaPickKey(s.src, e.id)] = { e: e, srcName: s.name };
                });
            });
            const items = [];
            let missing = 0, dropped = 0, truncated = 0, chars = 0;
            picks.forEach(k => {
                const hit = byKey[k];
                if (!hit) { missing++; return; }
                const body = String(hit.e.content == null ? '' : hit.e.content).trim();
                if (!body) { dropped++; return; }
                // 超预算就跳过这一条、继续看后面的（后面可能有短条目），跳过的照样计数
                if (chars + body.length > ST_PERSONA_LORE_MAX) { truncated++; return; }
                items.push({
                    name: stStr(hit.e.comment) || '（没写备注）',
                    srcName: hit.srcName,
                    content: body
                });
                chars += body.length;
            });
            return { items, missing, dropped, truncated, chars };
        }

        // 折进提示词的那一段。没有可喂的条目时返回空串（调用方据此整段省掉）
        function stPersonaLoreBlock() {
            const r = stPersonaLoreResolve();
            if (!r.items.length) return '';
            const parts = [
                '## 参考素材（世界书条目）',
                '下面是用户从世界书里挑出来的设定。**当成这个世界的既有事实**，',
                '人设要跟它一致；但不要把原文照抄进人设，也不要在人设里提「世界书」这三个字。'
            ];
            r.items.forEach(it => {
                parts.push('');
                parts.push('### ' + it.name + '（来自「' + it.srcName + '」）');
                parts.push(it.content);
            });
            return parts.join('\n');
        }

        // 勾选框：**只改状态 + 只改计数，不重绘** ——
        // 重绘会把 `.st-lore-list` 的滚动位置弹回顶部，勾第 12 条时特别难受。
        // （跟 stSyncPersonaTplOpen「只改 class 不重绘」同一条理由）
        function stPersonaPickToggle(box) {
            const key = box ? box.getAttribute('data-key') : '';
            if (!key) return;
            const a = Array.isArray(stEditor.personaPick) ? stEditor.personaPick.slice() : [];
            const at = a.indexOf(key);
            if (box.checked) { if (at < 0) a.push(key); }
            else if (at >= 0) { a.splice(at, 1); }
            stEditor.personaPick = a;
            stPersonaPickHintPaint();
        }

        // 折叠头右侧那行字。**数的是能解析出来的条数**，不是数组长度 ——
        // 条目被删之后数组里还留着那个键，直接报长度会显示「已选 3 条」而实际喂 2 条
        function stPersonaPickHintText() {
            const r = stPersonaLoreResolve();
            const n = r.items.length;
            if (!n) return '未选';
            const lost = r.missing + r.dropped + r.truncated;
            return '已选 ' + n + ' 条 · 约 ' + r.chars + ' 字' +
                (lost ? '（另有 ' + lost + ' 条没进去）' : '');
        }

        function stPersonaPickHintPaint() {
            const el = document.getElementById('st-persona-pick-hint');
            if (el) el.textContent = stPersonaPickHintText();
        }

        function stSyncPersonaPickOpen() {
            const on = stEditor.personaPickOpen === true;
            const box = document.getElementById('st-persona-pick-fold');
            if (box) box.classList.toggle('st-fold-open', on);
            const btn = document.getElementById('st-persona-pick-toggle');
            if (btn) btn.setAttribute('aria-expanded', on ? 'true' : 'false');
        }

        function stPersonaPickFoldToggle() {
            stEditor.personaPickOpen = !(stEditor.personaPickOpen === true);
            stSyncPersonaPickOpen();
        }

        // 全选 / 清空。**重绘**（不是逐个写 .checked）—— 一次要动几十个勾选框，
        // 逐个写反而更容易漏；代价只是列表滚回顶部，而这是用户主动点的批量动作
        function stPersonaPickAll(on) {
            const keys = [];
            stPersonaLoreSources().forEach(s => s.entries.forEach(e => {
                if (e && e.id) keys.push(stPersonaPickKey(s.src, e.id));
            }));
            stEditor.personaPick = on ? keys : [];
            stRerender();
        }

        function stPersonaLorePick() {
            const el = document.getElementById('st-persona-lore-file');
            if (el) { try { el.click(); } catch (e) {} }
        }

        // 额外导入一本世界书。**只存进 stEditor.personaLore，一个字都不进卡**。
        // ⚠ 跟 onLoreFilePicked（聊天区那本）是两回事：那个会写进 aiConfig.tavernLore
        //   并进酒馆模式，这个只喂人设生成器。
        async function stPersonaLoreFilePicked(ev) {
            const file = ev.target.files && ev.target.files[0];
            // ⚠ 先清空 value：不清的话**同一个文件选第二次不会再触发 change**
            //   （浏览器认为值没变），症状是「导入过一次之后再导入就没反应」
            ev.target.value = '';
            if (!file) return;
            try {
                const text = new TextDecoder('utf-8').decode(new Uint8Array(await file.arrayBuffer()));
                const book = parseWorldBook(JSON.parse(text), file.name.replace(/\.json$/i, ''));
                if (!book.entries.length) {
                    stExportMsg('⚠ 「' + book.name + '」里没有可用条目' +
                        '（正文、关键词、常驻三者全空的会被丢掉）。', 'warn', 'persona');
                    return;
                }
                stEditor.personaLore = { name: book.name, entries: book.entries };
                // 导进来就展开：用户刚做完一个动作，得让他看见结果落在哪
                stEditor.personaPickOpen = true;
                stRerender();
                stExportMsg('✅ 已载入「' + book.name + '」' + book.entries.length +
                    ' 条 —— 它不会进卡，只喂这一次生成。勾上要用的条目再点生成。', 'ok', 'persona');
            } catch (e) {
                stExportMsg('❌ 世界书读取失败：' + (e && e.message ? e.message : e), 'bad', 'persona');
            }
        }

        // 移除导入的那本书。**连带清掉只属于它的勾选** ——
        // 不清的话折叠头会一直报「另有 N 条没进去」，而那 N 条已经无从勾掉
        function stPersonaLoreDrop() {
            stEditor.personaLore = null;
            const a = Array.isArray(stEditor.personaPick) ? stEditor.personaPick : [];
            stEditor.personaPick = a.filter(k => k.indexOf('imp:') !== 0);
            stRerender();
            stExportMsg('已移除导入的世界书（卡内世界书没动）。', '', 'persona');
        }

        // 换卡 / 新建卡时清掉：上一张卡勾中的条目 id 在新卡里一个都不存在
        function stPersonaPickClear() {
            stEditor.personaPick = [];
            stEditor.personaLore = null;
        }

        function stPersonaUserPrompt(req, tpl) {
            const c = stEditor.card || {};
            const ctx = [];
            // 卡名是**可选**喂的（面板上那个「把角色卡名字当人物姓名」）——
            // 关掉时这一段整个不给，让 AI 按用户写的设定自己起名。
            // 注意这里**不是**「换个说法告诉它别用卡名」：不提就够了，
            // 提了反而会把卡名泄给模型（那正是用户想避免的）
            if (stPersonaNameUse() && stStr(c.name)) ctx.push('这张卡现在的名字：' + stStr(c.name));
            const parts = ['用户的要求：' + req, ''];
            if (ctx.length) {
                parts.push('## 这张卡的现状（跟它保持一致，别冲突）');
                ctx.forEach(x => parts.push(x));
                parts.push('');
            }
            // 参考素材排在「要求」和「模板」之间：它跟要求一样是**输入**，
            // 而模板是**输出的形状** —— 先给料，再给表格
            const lore = stPersonaLoreBlock();
            if (lore) { parts.push(lore); parts.push(''); }
            parts.push('## 模板（照它的结构逐项填）');
            parts.push(tpl);
            return parts.join('\n');
        }

        // 模型偶尔会把整份东西包进 ``` 围栏。**只做这一种清洗** ——
        // 再多的「智能」清洗（比如删掉开头那句「好的，这是人设：」）会顺手吃掉真正的第一行，
        // 而那种错**看不出来**：输出照样有内容、照样能写进卡
        function stPersonaText(raw) {
            let s = String(raw == null ? '' : raw).replace(/\r\n/g, '\n').trim();
            const fence = s.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
            if (fence) s = fence[1].trim();
            return s;
        }

        // 从生成结果里取「姓名:」**后面**的字符 —— 「追加到世界书」的备注和关键词都用它。
        //
        // ⚠ 先把 CRLF 归一成 LF：JS 的 `.` **不匹配 `\r`**，多行模式下 `$` 也不认 `\r`，
        //   所以 `姓名: 艾莉丝\r\n年龄: 19` 这种文本会**整行匹配不上**。症状是「名字悄悄取不到、
        //   回落成卡名」—— 页面上看不出任何异常，只有条目关键词跟预期不一样。
        //   （跟主页那个「凡 `$` 锚行尾的正则先问这文件是不是 CRLF」是同一个坑，
        //     区别是这回 CRLF 来自**运行时数据**，不是源文件。）
        // ⚠ 只剥行首的 `- ` / `*` / 空格和值两端的 `*` / 反引号 —— 模型偶尔会把整行加粗。
        //   再多的清洗（比如截到第一个空格、去掉括号）会吃掉真正的名字，而那种错看不出来。
        // ⚠ 认半角 `:` 和全角 `：` 两种 —— 默认模板里就是混着用的。
        function stPersonaNameFromOut(text) {
            const t = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
            const m = t.match(/^[ \t\-*]*姓名[ \t]*[:：][ \t]*(.*)$/m);
            if (!m) return '';
            return m[1].replace(/^[*`\s]+|[*`\s]+$/g, '');
        }

        // 生成结果里的「人物名」—— 四个按钮的反馈都用它。取「姓名:」后面的字符，
        // 取不到回落**卡名**。
        //
        // ⚠ 返回值里必须带上 `fromOut`：「用的是卡名」这件事**从结果文本里完全看不出来**，
        //   所以调用方要能在提示里把它说出来（回落 = 把失败伪装成成功）。
        // ⚠ 两处都没有时 name 是空串 —— 调用方要把「」整段省掉，而不是印一对空引号。
        function stPersonaOutName(out) {
            const inName = stPersonaNameFromOut(out);
            return {
                name: inName || stStr((stEditor.card || {}).name),
                fromOut: !!inName
            };
        }

        // 「上一次那个世界书条目」—— 按 **id** 找，不按下标：下标会被世界书页的增删改挪走。
        // 找不到（用户自己在世界书页删掉了）返回 null，调用方据此当新条目处理、并说出来。
        function stPersonaBookRefEntry() {
            const id = stEditor.personaBookRef;
            if (!id) return null;
            const a = (stEditor.card && Array.isArray(stEditor.card.bookEntries))
                ? stEditor.card.bookEntries : [];
            for (let i = 0; i < a.length; i++) {
                if (a[i] && a[i].id === id) return a[i];
            }
            return null;
        }

        async function stPersonaRun() {
            if (stEditor.personaBusy) return;
            if (!stEditor.card) return;
            const req = String(stEditor.personaReq || '').trim();
            if (!req) {
                stExportMsg('⚠ 先写一句你想要什么（例如「冷淡的吸血鬼女仆，喜欢红茶」）。', 'warn', 'persona');
                const el = document.getElementById('st-persona-req');
                if (el) { try { el.focus(); } catch (e) {} }
                return;
            }
            const tpl = String(stPersonaTpl() || '').trim();
            if (!tpl) {
                stExportMsg('⚠ 模板是空的 —— 点「恢复默认模板」，或者自己写一份（每行以冒号结尾）。', 'warn', 'persona');
                return;
            }
            const cfg = stAiCfg();
            const ready = stAiReady(cfg);
            if (!ready.ok) {
                stExportMsg('⚠ ' + ready.why, 'warn', 'persona');
                return;
            }
            stEditor.personaBusy = true;
            stRerender();
            // 参考素材在**发请求之前**解析一次：报告里说的必须是「这一轮实际发出去的那一份」，
            // 而不是「发完之后状态里还剩什么」（生成过程中状态不会变，但把这个前提写死更省心）
            const lore = stPersonaLoreResolve();
            stExportMsg('⏳ 正在让 AI 生成人设…', '', 'persona');
            let text = '';
            try {
                text = await stAiChat([
                    { role: 'system', content: stPersonaSysPrompt() },
                    { role: 'user', content: stPersonaUserPrompt(req, tpl) }
                ], {
                    cfg: cfg, stream: false,
                    temperature: cfg.temperature,
                    // 人设比预制块长得多，下限给到 2048
                    maxTokens: Math.max(2048, cfg.maxTokens)
                });
            } catch (e) {
                stEditor.personaBusy = false;
                stRerender();
                stExportMsg('❌ AI 生成失败：' + stAiErrText(e), 'bad', 'persona');
                return;
            }
            stEditor.personaBusy = false;
            const out = stPersonaText(text).slice(0, ST_PERSONA_OUT_MAX);
            if (!out) {
                stRerender();
                stExportMsg('❌ 模型返回了空内容。换个说法再试一次。', 'bad', 'persona');
                return;
            }
            stEditor.personaOut = out;
            // 生成了**新的人设** ⇒ 把「已经添加过」的记账清掉。
            // ⚠ 这是需求的一部分（用户原话：「如果后续又生成了新的人设，则重置计数，
            //   在第二次点击时再次显示」）：新结果跟旧条目没有关系，所以接下来**第一次**点
            //   「追加到世界书」应该直接追加、不弹窗，**第二次**才该问。
            stEditor.personaBookRef = null;
            stEditor.personaBookAsk = null;
            stRerender();
            // 「对上了几项」—— 跟预制块那边报「几条路径对得上」同一个口径：
            // 只说「成功」的话，模型悄悄改写了标题用户是看不见的
            const labels = stPersonaLabels(tpl);
            const hit = labels.filter(k => out.indexOf(k) >= 0).length;
            const miss = labels.length - hit;
            // 参考素材也报一句：喂了几条、几条没进去。
            // ⚠ 「没进去」必须点名原因 —— 只说「有 2 条没进去」等于没说，
            //   用户既不知道该去哪修，也分不清是自己勾错了还是程序吞了
            const loreLost = lore.missing + lore.dropped + lore.truncated;
            const loreWhy = [
                lore.missing ? lore.missing + ' 条已不存在' : '',
                lore.dropped ? lore.dropped + ' 条正文为空' : '',
                lore.truncated ? lore.truncated + ' 条超出 ' + ST_PERSONA_LORE_MAX + ' 字预算' : ''
            ].filter(Boolean).join(' / ');
            stExportMsg('✅ 生成了 ' + out.length + ' 字符' +
                (lore.items.length ? '；参考素材 ' + lore.items.length + ' 条（' + lore.chars + ' 字）' : '') +
                (labels.length ? '；模板 ' + labels.length + ' 项里对上了 ' + hit + ' 项' : '') +
                (miss ? '（' + miss + ' 项没出现 —— 模型可能改写了标题，先看一眼再写入）' : '') +
                (loreLost ? '（另有 ' + loreLost + ' 条参考素材没进去：' + loreWhy + '）' : '') +
                '。', (miss || loreLost) ? 'warn' : 'ok', 'persona');
        }

        // mode：'replace' 写入角色描述 / 'append' 追加到角色描述 / 'book' 追加成一条世界书条目
        function stPersonaApply(mode) {
            const out = String(stEditor.personaOut || '').trim();
            if (!out) { stExportMsg('⚠ 还没有生成结果。', 'warn', 'persona'); return; }
            if (!stEditor.card) return;
            // —— 追加到世界书 ——
            // 走 stPersonaBookStart()：它先看「上一次那条还在不在」，在就先弹三选一。
            if (mode === 'book') { stPersonaBookStart(); return; }
            // 名字取不到时**整段省掉**，别印一对空引号（「已将「」写入…」）
            const nm = stPersonaOutName(out).name;
            const head = nm ? '已将「' + nm + '」' : '已';
            const cur = stStr(stEditor.card.description);
            if (mode === 'append') {
                // 描述本来是空的就当成写入 —— 不然会留一个空行开头
                if (!cur.trim()) { stPersonaApply('replace'); return; }
                stSet('card.description', cur.replace(/\s+$/, '') + '\n\n' + out);
                stExportMsg('✅ ' + head + '追加到角色描述（现在 ' +
                    stStr(stEditor.card.description).length + ' 字符）。', 'ok', 'persona');
                return;
            }
            if (cur.trim() && !window.confirm('角色描述里已经有 ' + cur.length +
                ' 个字符，「写入」会**整个替换**掉它。要继续吗？')) {
                stExportMsg('已取消 —— 角色描述没动。', 'warn', 'persona');
                return;
            }
            stSet('card.description', out);
            stExportMsg('✅ ' + head + '写入角色描述（' + out.length + ' 字符）。', 'ok', 'persona');
        }

        // 「追加到世界书」的入口：上一次那条**还在**就先弹三选一，否则直接写成新条目。
        //
        // ⚠ 「已经添加过了」只能靠**记账**知道 —— 世界书条目里没有任何字段能标出
        //   「这条是人设生成器写的」。账在 `stEditor.personaBookRef`（条目 id），
        //   生成新结果时由 `stPersonaRun` 清掉，所以「重置计数」是它的副作用。
        function stPersonaBookStart() {
            const out = String(stEditor.personaOut || '').trim();
            if (stPersonaBookRefEntry()) {
                stEditor.personaBookAsk = { name: stPersonaOutName(out).name };
                stRerender();
                return;
            }
            stPersonaBookWrite('new');
        }

        // action：'new' 追加为新条目 / 'overwrite' 覆盖上一次那条
        //
