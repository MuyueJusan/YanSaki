        // —— 遍历酒馆助手脚本（文件夹里的也算），带**定位**信息 ——
        // ⚠ 必须递归（文件夹能嵌套），而且要把父列表和下标一起带出来 ——
        //   只给节点的话删一条还得再找一遍
        function stCodeEachTh(c, fn, list, path, _d) {
            const d = _d || 0;
            if (d > 20) return;
            const fromRoot = (list === undefined && path === undefined);
            const arr = fromRoot
                ? (Array.isArray(c && c.thScripts) ? c.thScripts : [])
                : (Array.isArray(list) ? list : []);
            const pre = fromRoot ? 'card.thScripts' : String(path);
            for (let i = 0; i < arr.length; i++) {
                const n = arr[i];
                if (!n || typeof n !== 'object') continue;
                const p = pre + '[' + i + ']';
                fn(n, arr, i, p);
                if (n.kind === 'folder') stCodeEachTh(c, fn, n.scripts, p + '.scripts', d + 1);
            }
        }

        function stCodeThList(c) {
            const out = [];
            stCodeEachTh(c, (n, arr, i, p) => { out.push({ node: n, list: arr, index: i, path: p }); });
            return out;
        }

        // 找正则 / 找脚本：先按 id 精确，再按名字，最后按前缀和包含
        // （抄 stCodeFindEntry 那套 —— 模型常把 uuid 抄漏几位）
        function stCodeFindRegex(c, key) {
            const list = Array.isArray(c && c.regex) ? c.regex : [];
            const k = String(key == null ? '' : key).trim();
            if (!k) return null;
            return list.filter(r => r && r.id === k)[0] ||
                list.filter(r => r && stStr(r.scriptName) === k)[0] ||
                list.filter(r => r && r.id && String(r.id).indexOf(k) === 0)[0] ||
                list.filter(r => r && stStr(r.scriptName).indexOf(k) >= 0)[0] || null;
        }

        function stCodeFindTh(c, key) {
            const k = String(key == null ? '' : key).trim();
            if (!k) return null;
            const all = stCodeThList(c).filter(x => x.node.kind !== 'folder');
            return all.filter(x => x.node.id === k)[0] ||
                all.filter(x => stStr(x.node.name) === k)[0] ||
                all.filter(x => x.node.id && String(x.node.id).indexOf(k) === 0)[0] ||
                all.filter(x => stStr(x.node.name).indexOf(k) >= 0)[0] || null;
        }

        // ⚠ **这一条是这次加工具的核心风险点。**
        //   状态栏不是独立字段 —— 它就住在「状态栏界面」那条正则的 replaceString 里；
        //   MVU 的 Zod 也不是 —— 它住在某条酒馆助手脚本的 content 里。
        //   模型把它们当普通条目删掉 / 改掉，等于把状态栏、MVU 整个抹了，
        //   而且**它自己不会知道**（没有任何报错，卡看起来还是好的）。
        //   所以写工具必须先过这道闸：认出「这是 MVU / 状态栏自己的东西」就拦住，
        //   并告诉它该走哪条路。
        function stCodeEntryGuard(kind, item) {
            if (!item) return { locked: false, why: '' };
            if (kind === 'regex') {
                const k = stMvuRegexKind(item);
                if (!k) return { locked: false, why: '' };
                const nm = ST_MVU_RX_NAME[k] || stStr(item.scriptName);
                if (k === 'sbShow') {
                    return { locked: true, why: '「' + nm + '」就是**状态栏本身** —— 状态栏 HTML ' +
                        '存在它的 replaceString 里。要改状态栏用 write_doc({kind:"statusbar"})' };
                }
                return { locked: true, why: '「' + nm + '」是 MVU 装的那条正则，由编辑器生成；' +
                    '改了会在下一次写回时被覆盖。要调它去「MVU」页' };
            }
            if (kind === 'th') {
                const t = String(item.content || '');
                if (t.indexOf('MagVarUpdate') >= 0) {
                    return { locked: true, why: '这条脚本里是 **MVU 的核心**（MagVarUpdate），' +
                        '删了 MVU 就废了' };
                }
                if (t.indexOf('registerMvuSchema') >= 0) {
                    return { locked: true, why: '这条脚本里是 **MVU 的变量结构（Zod）**。' +
                        '要改变量结构用 write_doc({kind:"mvu"})' };
                }
                return { locked: false, why: '' };
            }
            return { locked: false, why: '' };
        }

        // 回写闸门：模型写回来的文本里**带着截断标记** → 拒收。
        // ⚠ 这是「读一半 → 写回一半」这个静默丢数据的最后一道闸。
        //   典型路径：read_doc(statusbar) 拿到 32000 字里的一截 → 模型「保持原样」
        //   把那截写回来 → stSbParseDoc 高高兴兴解析这段**不完整但合法**的 HTML
        //   → 后半段块全没了，而且没有任何一处会报错。
        //   放在 stCode.autoApply 判断**之前**：关掉「真的改卡」时也得拦，
        //   否则模型会以为写成功了，用户一开开关就丢东西
        function stCodeCutGuard(text) {
            if (String(text).indexOf(ST_CODE_CUT_MARK) < 0) return null;
            return { ok: false, text: '你写回来的内容里有「' + ST_CODE_CUT_MARK + '」—— ' +
                '那是**读取被截断**留下的标记，不是原文的一部分。\n' +
                '照这样写进去会把原文后半段整个删掉。\n' +
                '正确做法是**读全了再写**：read_doc 可以带 from 分段接着读；' +
                '别的读工具读不完就说明这东西太大，先告诉用户、别硬写。**卡没有动。**' };
        }

        // 值太大时给「形状摘要」，而不是硬塞前半截。
        // ⚠ 直接截断最坏的地方不是「少看到东西」，是模型看到的是一段
        //   **看起来完整**的 JSON —— 它会当成全部，然后基于半截数据做决定。
        //   形状摘要至少让它知道自己没看到全部，而且知道该去读哪一块。
        function stCodeBrief(v, max) {
            const lim = max || ST_CODE_BRIEF_CHARS;
            const full = stCodeJsonText(v, 2);
            if (full.length <= lim) return full;
            const cut = t => { const x = stStr(t); return x.length > 120 ? x.slice(0, 120) + '…' : x; };
            const one = x => {
                if (x === null || x === undefined) return String(x);
                if (typeof x !== 'object') return cut(x);
                if (Array.isArray(x)) return '数组(' + x.length + ' 项)';
                const ks = Object.keys(x);
                return '{' + ks.slice(0, 6).join(', ') + (ks.length > 6 ? ', …' : '') + '}';
            };
            if (Array.isArray(v)) {
                const show = v.slice(0, 12);
                return '（这个数组有 ' + v.length + ' 项、共 ' + full.length + ' 字，没整个给你）\n' +
                    show.map((x, i) => '  ' + (i + 1) + '. ' + one(x)).join('\n') +
                    (v.length > show.length ? '\n  …还有 ' + (v.length - show.length) + ' 项' : '');
            }
            if (v && typeof v === 'object') {
                return '（这个对象共 ' + full.length + ' 字，没整个给你）\n' +
                    Object.keys(v).map(k => '  · ' + k + ' → ' + one(v[k])).join('\n');
            }
            return '（这段有 ' + full.length + ' 字，只给开头）\n' + stStr(v).slice(0, lim);
        }

        // 把模型的参数填进条目。**空值不覆盖** —— 它偷懒给个空数组 / 空串，
        // 不该被当成「用户想清空」（跟单条改写那条铁律一样）
        function stCodeFillEntry(e, a) {
            // ⚠ 空值一律**不覆盖**。模型偷懒给个空串 / 空数组，不该被当成
            //   「用户想清空」—— 手写的条目被模型顺手抹掉是很疼的
            if (a.content !== undefined) {
                const v = String(a.content == null ? '' : a.content);
                if (v.trim()) e.content = v;
            }
            if (a.comment !== undefined) {
                const v = String(a.comment == null ? '' : a.comment).trim();
                if (v) e.comment = v;
            }
            if (a.keys !== undefined) { const k = stCodeStrList(a.keys); if (k.length) e.keys = k; }
            if (a.secondaryKeys !== undefined) {
                const k = stCodeStrList(a.secondaryKeys);
                if (k.length) e.secondaryKeys = k;
            }
            if (a.enabled !== undefined) e.enabled = a.enabled !== false;
            if (a.constant !== undefined) e.constant = !!a.constant;
            if (a.position !== undefined) e.position = Math.trunc(stAiNum(a.position, e.position, 0, 7));
            if (a.depth !== undefined) e.depth = Math.trunc(stAiNum(a.depth, e.depth, 0, 999));
            if (a.order !== undefined) e.order = Math.trunc(stAiNum(a.order, e.order, 0, 9999));
            return e;
        }

        // 把模型的参数填进正则条目。**空值不覆盖**（跟 stCodeFillEntry 同一条铁律）
        function stCodeFillRegex(r, a) {
            if (a.scriptName !== undefined) {
                const v = String(a.scriptName == null ? '' : a.scriptName).trim();
                if (v) r.scriptName = v;
            }
            if (a.findRegex !== undefined) {
                const v = String(a.findRegex == null ? '' : a.findRegex);
                if (v.trim()) r.findRegex = v;
            }
            // ⚠ replaceString 允许是**空串** —— 「匹配到就删掉」是正当写法（MVU 的
            //   「对AI隐藏变量更新」那条就是空替换）。所以这里跟别的字段不一样，
            //   不看 trim，给了就认
            if (a.replaceString !== undefined) {
                r.replaceString = String(a.replaceString == null ? '' : a.replaceString);
            }
            if (a.trimStrings !== undefined) r.trimStrings = stCodeStrList(a.trimStrings);
            if (a.placement !== undefined) {
                const raw = Array.isArray(a.placement) ? a.placement : [a.placement];
                const p = raw.map(x => Math.trunc(stAiNum(x, 0, 0, 9)))
                    .filter(x => x === 1 || x === 2)
                    .filter((x, i, arr) => arr.indexOf(x) === i);
                if (p.length) r.placement = p;
            }
            if (a.disabled !== undefined) r.disabled = a.disabled === true;
            if (a.markdownOnly !== undefined) r.markdownOnly = a.markdownOnly === true;
            if (a.promptOnly !== undefined) r.promptOnly = a.promptOnly === true;
            if (a.runOnEdit !== undefined) r.runOnEdit = a.runOnEdit === true;
            return r;
        }

        // 同上，填酒馆助手脚本。⚠ content 也允许是空串（清空一个脚本是正当的）
        function stCodeFillTh(s, a) {
            if (a.name !== undefined) {
                const v = String(a.name == null ? '' : a.name).trim();
                if (v) s.name = v;
            }
            if (a.content !== undefined) s.content = String(a.content == null ? '' : a.content);
            if (a.info !== undefined) s.info = String(a.info == null ? '' : a.info);
            if (a.enabled !== undefined) s.enabled = a.enabled === true;
            return s;
        }

        // 「只改开关」的白名单。MVU 自己的条目**只**允许改开关：
        // 关掉一条 MVU 正则是正当需求（比如不想让 AI 看到变量更新），而且它不会跟
        // 生成器打架 —— 生成器压根不管 disabled 这个字段。改别的就不行。
        //
        // ⚠ 必须**先要求 mode === 'update'**。只看「参数里有没有多余字段」是不够的：
        //   `{mode:'delete', id:'状态栏界面'}` 的参数集合恰好也在白名单里 ——
