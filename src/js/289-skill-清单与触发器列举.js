        // —— skill ——

        // 解析 SKILL.md。有 frontmatter 就用它；没有就用正文第一个标题当名字、
        // 第一段非标题文字当描述 —— 别人手写的 skill 不一定带 frontmatter
        // 「a, b、c / d」→ ['a','b','c','d']。触发词是**人随手写的**，分隔符全凭手感，
        // 所以几种都认。⚠ 一个字以内的直接丢掉 —— 单字触发词等于「每条消息都命中」，
        // 那不是触发，是把整个 skill 常驻进上下文
        function stCodeTrigList(raw) {
            return String(raw == null ? '' : raw)
                .split(/[,，、;；\/|\n]+/)
                .map(x => String(x).trim())
                .filter(x => x.length >= 2)
                .slice(0, ST_CODE_TRIG_MAX);
        }

        // 从 .js 源码里抠出 manifest。返回 { ok:true, m } 或 { ok:false, why }
        // ⚠ 每一条拒绝都要**说清为什么** —— 导入失败却只说「格式不对」的话，
        //   写 skill 的人只能靠猜
        function stCodeManifestOf(code) {
            const r = ST_CODE_MANIFEST_RX.exec(String(code || ''));
            if (!r) {
                return { ok: false, why: '开头没有 /*!MANIFEST {…} !*/。' +
                    '没有它就没法知道这个工具叫什么、要什么参数，也就没法交给模型。' };
            }
            let m = null;
            try { m = JSON.parse(r[1]); }
            catch (e) { return { ok: false, why: 'MANIFEST 里的 JSON 读不了：' + ((e && e.message) || e) }; }
            if (!m || typeof m !== 'object' || Array.isArray(m)) {
                return { ok: false, why: 'MANIFEST 得是一个对象' };
            }
            const name = String(m.name == null ? '' : m.name).trim();
            if (!ST_CODE_TOOLNAME_RX.test(name)) {
                return { ok: false, why: '工具名「' + name + '」不合法 —— 只能用英文字母 / 数字 / ' +
                    '下划线 / 连字符，1–64 个字符。这是**两套模型协议共同的硬要求**，' +
                    '中文名和带点的名字都会在发请求那一步才报错，而且报的错看不懂。' };
            }
            if (ST_CODE_TOOLS.some(t => t.name === name)) {
                return { ok: false, why: '工具名「' + name + '」和内置工具重名了 —— 换一个' +
                    '（建议加个前缀，比如 skill_' + name + '）。重名的话模型调的是内置那个，' +
                    '你这个 skill 永远轮不到，而且没有任何提示。' };
            }
            const perm = Array.isArray(m.perm) ? m.perm.map(x => String(x)).filter(x => x) : [];
            const bad = perm.filter(p => ST_CODE_SANDBOX_PERM.indexOf(p) < 0);
            if (bad.length) {
                return { ok: false, why: '它要的能力这里还没有：' + bad.join('、') +
                    '。现在能给的只有：' + (ST_CODE_SANDBOX_PERM.join('、') || '（暂时一个都没有）') +
                    '（card.read = 读卡，card.write = 改卡，progress = 往界面上报进度）。' +
                    '**装不了** —— 硬装进去它调不到东西，只会给模型一堆失败，' +
                    '而用户完全不知道为什么。' };
            }
            const desc = String(m.description || m.desc || '').trim();
            if (!desc) {
                return { ok: false, why: 'MANIFEST 里没写 description —— ' +
                    '模型就是靠这一句话决定要不要用它的，没写等于没人会调。' };
            }
            const params = (m.parameters && typeof m.parameters === 'object' && !Array.isArray(m.parameters))
                ? m.parameters : { type: 'object', properties: {} };
            return { ok: true, m: { name: name, desc: desc.slice(0, 600), params: params, perm: perm } };
        }

