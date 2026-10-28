        // —— 反推：从卡里已有的 Zod 脚本解析回变量树 ——
        // 只认本编辑器会生成的那套写法 + 常见变体（z.coerce.number() /
        // .int() / .transform(v => _.clamp(v, a, b)) / .describe() / .prefault()）。
        // 认不出来就返回 null —— 调用方据此**不接管**这张卡，绝不覆盖
        //
        // ⚠ 定位 schema 必须走 registerMvuSchema(<名字>) → 找**那个名字**的
        //   `= z.object(` 定义。直接 s.indexOf('z.object(') 是错的：作者常写
        //   `const Base = z.object({...})` 再 `Base.extend({...})`，
        //   第一个 z.object 是基底不是 schema —— 拿它当结构解析，
        //   用户改一下就会把真正的结构整个覆盖掉
        //
        // ⚠ 标识符必须**同时认 ASCII 和 CJK**。中文社区的卡里
        //   `const 角色 = z.object({…})` / `registerMvuSchema(角色)` 这种写法很常见。
        //   只写 [A-Za-z_$] 的话，这类卡会**整个读不回来** ——
        //   表现是「编辑器说认不出这张卡的 Zod」，而用户完全不知道为什么，
        //   只会觉得「我这张卡明明是好的」。所以下面两处正则都换成 ST_MVU_IDENT
        const ST_MVU_IDENT = '[A-Za-z_$\\u4e00-\\u9fa5][A-Za-z0-9_$\\u4e00-\\u9fa5]*';

        function stMvuParseZod(code) {
            const s = String(code || '');
            const reg = new RegExp('registerMvuSchema\\s*\\(\\s*(' + ST_MVU_IDENT + ')').exec(s);
            let at = -1;
            if (reg) {
                // 知道注册的是哪个标识符 → 只认它，认不出就不接管，绝不猜
                // 标识符是原样插进 RegExp 的，$ 之类得先转义（$ 在外面是行尾锚）
                const id = String(reg[1]).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const decl = new RegExp('(?:export\\s+)?(?:const|let|var)\\s+' + id +
                    '\\s*=\\s*z\\.object\\s*\\(');
                const m = decl.exec(s);
                if (!m) return null;
                at = m.index + m[0].length - 1;
            } else {
                // 没有 registerMvuSchema 调用：退一步找 z.object 赋值，
                // 但必须**只有一个** —— 多个候选说明认不准，宁可不管
                const re = new RegExp('(?:export\\s+)?(?:const|let|var)\\s+' + ST_MVU_IDENT +
                    '\\s*=\\s*z\\.object\\s*\\(', 'g');
                const hits = [];
                let m;
                while ((m = re.exec(s))) hits.push(m.index + m[0].length - 1);
                if (hits.length !== 1) return null;
                at = hits[0];
            }
            const p = { s: s, i: at };   // at 指向 '('
            try {
                const inner = stMvuPReadParen(p);
                const nodes = stMvuParseObjBody(stMvuSubParser(inner));
                return Array.isArray(nodes) ? nodes : null;
            } catch (e) { return null; }
        }

        function stMvuPWs(p) {
            while (p.i < p.s.length && /\s/.test(p.s[p.i])) p.i++;
        }

        function stMvuPExpect(p, ch) {
            stMvuPWs(p);
            if (p.s[p.i] !== ch) throw new Error('want ' + ch);
            p.i++;
        }

        // 读一对括号，返回里面那段原文（认嵌套括号和字符串）
        function stMvuPReadParen(p) {
            stMvuPExpect(p, '(');
            const start = p.i;
            let depth = 1;
            while (p.i < p.s.length) {
                const c = p.s[p.i];
                if (c === "'" || c === '"') { stMvuPReadString(p); continue; }
                if (c === '(' || c === '[' || c === '{') depth++;
                else if (c === ')' || c === ']' || c === '}') {
                    depth--;
                    if (depth === 0) { const out = p.s.slice(start, p.i); p.i++; return out; }
                }
                p.i++;
            }
            throw new Error('unclosed');
        }

        function stMvuPReadString(p) {
            const q = p.s[p.i];
            p.i++;
            let out = '';
            while (p.i < p.s.length && p.s[p.i] !== q) {
                if (p.s[p.i] === '\\') {
                    const n = p.s[p.i + 1];
                    out += (n === 'n') ? '\n' : (n === 't') ? '\t' : n;
                    p.i += 2;
                } else { out += p.s[p.i]; p.i++; }
            }
            p.i++;
            return out;
        }

        function stMvuPKey(p) {
            stMvuPWs(p);
            const c = p.s[p.i];
            if (c === "'" || c === '"') return stMvuPReadString(p);
            const m = /^[A-Za-z_$\u4e00-\u9fa5][A-Za-z0-9_$\u4e00-\u9fa5]*/.exec(p.s.slice(p.i));
            if (!m) throw new Error('key');
            p.i += m[0].length;
            return m[0];
        }

        function stMvuParseObjBody(p) {
            stMvuPExpect(p, '{');
            const out = [];
            stMvuPWs(p);
            if (p.s[p.i] === '}') { p.i++; return out; }
            for (;;) {
                const key = stMvuPKey(p);
                stMvuPExpect(p, ':');
                const node = stMvuParseExpr(p);
                if (!node) throw new Error('expr');
                node.name = key;
                out.push(node);
                stMvuPWs(p);
                if (p.s[p.i] === ',') { p.i++; continue; }
                if (p.s[p.i] === '}') { p.i++; return out; }
                throw new Error('sep');
            }
        }

        // 把 '[...]' 里的元素按顶层逗号切开
        function stMvuPSplitTop(inner) {
            const parts = [];
            let depth = 0, cur = '', q = '';
            for (let i = 0; i < inner.length; i++) {
                const c = inner[i];
                if (q) {
                    cur += c;
                    if (c === '\\') { cur += inner[++i] || ''; continue; }
                    if (c === q) q = '';
                    continue;
                }
                if (c === "'" || c === '"') { q = c; cur += c; continue; }
                if (c === '(' || c === '[' || c === '{') depth++;
                if (c === ')' || c === ']' || c === '}') depth--;
                if (c === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
                cur += c;
            }
            if (cur.trim()) parts.push(cur);
            return parts.map(x => x.trim()).filter(x => x !== '');
        }

        function stMvuSubParser(text) {
            return { s: String(text), i: 0 };
        }

        function stMvuParseExpr(p) {
            stMvuPWs(p);
            if (p.s.substr(p.i, 2) !== 'z.') throw new Error('z');
            p.i += 2;
            const m = /^[A-Za-z]+/.exec(p.s.slice(p.i));
            if (!m) throw new Error('zname');
            p.i += m[0].length;
            let kind = m[0];
            let inner = '';
            stMvuPWs(p);
            if (p.s[p.i] === '(') inner = stMvuPReadParen(p);
            // z.coerce.number() —— coerce 后面还得跟一个 .number
            if (kind === 'coerce') {
                stMvuPExpect(p, '.');
                const m2 = /^[A-Za-z]+/.exec(p.s.slice(p.i));
                if (!m2) throw new Error('coerce');
                p.i += m2[0].length;
                kind = m2[0];
                stMvuPWs(p);
                if (p.s[p.i] === '(') inner = stMvuPReadParen(p);
            }
            const node = stBlankMvuNode();
            if (kind === 'number') {
                node.type = 'number';
            } else if (kind === 'boolean') {
                node.type = 'boolean';
            } else if (kind === 'enum') {
                node.type = 'enum';
                node.options = stMvuPSplitTop(inner.replace(/^\s*\[|\]\s*$/g, ''))
                    .map(x => {
                        const sp = stMvuSubParser(x);
                        return stMvuPKey(sp);
                    });
            } else if (kind === 'object') {
                node.type = 'object';
                node.children = stMvuParseObjBody(stMvuSubParser(inner));
            } else if (kind === 'record') {
                node.type = 'record';
                const args = stMvuPSplitTop(inner);
                const val = args.length > 1 ? args[1] : '';
                if (/z\.object\s*\(/.test(val)) {
                    const vp = stMvuSubParser(val);
                    stMvuPWs(vp);
                    vp.i += 'z.object'.length;
                    node.children = stMvuParseObjBody(stMvuSubParser(stMvuPReadParen(vp)));
                }
            } else if (kind === 'union') {
                node.type = 'union';
                node.children = stMvuPSplitTop(inner.replace(/^\s*\[|\]\s*$/g, ''))
                    .map(x => {
                        try { return stMvuParseExpr(stMvuSubParser(x)); } catch (e) { return null; }
                    }).filter(Boolean);
            } else {
                node.type = 'string';
            }
            // 链式修饰
            for (;;) {
                stMvuPWs(p);
                if (p.s[p.i] !== '.') break;
                p.i++;
                const mm = /^[A-Za-z]+/.exec(p.s.slice(p.i));
                if (!mm) throw new Error('chain');
                p.i += mm[0].length;
                stMvuPWs(p);
                const arg = (p.s[p.i] === '(') ? stMvuPReadParen(p) : '';
                if (mm[0] === 'int') node.int = true;
                else if (mm[0] === 'describe') {
                    const sp = stMvuSubParser(arg);
                    stMvuPWs(sp);
                    try { node.desc = stMvuPReadString(sp); } catch (e) {}
                } else if (mm[0] === 'prefault' || mm[0] === 'default') {
                    const t = arg.trim();
                    if (/^['"]/.test(t)) {
                        const sp = stMvuSubParser(t);
                        stMvuPWs(sp);
                        node.value = stMvuPReadString(sp);
                    } else node.value = t;
                } else if (mm[0] === 'transform') {
                    const cl = /_\s*\.\s*clamp\s*\(\s*[^,]+,\s*(-?[\w.]+)\s*,\s*(-?[\w.]+)\s*\)/
                        .exec(arg);
                    if (cl) {
                        node.min = stMvuNumFromLit(cl[1]);
                        node.max = stMvuNumFromLit(cl[2]);
                    }
                }
            }
            return node;
        }

        function stMvuNumFromLit(t) {
            const n = Number(t);
            return Number.isFinite(n) ? Math.trunc(n) : null;
        }

