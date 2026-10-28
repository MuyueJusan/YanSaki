        // ===== 提示词结构预览 =====
        //
        // 把「将要发给模型的那几条消息」按编号摊开。三处共用：
        // AI 助手页（骨架）/ 世界书批量扩写面板 / 单条改写面板 / 开场白面板。
        //
        // ⚠ 展开状态**故意不进 stAiUi**：靠 <details> 自己管。存进状态就意味着
        // 每次 toggle 都要 stRerender() 重建整个 pane，滚动位置当场丢掉；
        // 而这几条消息纯粹是字符串拼接，算一遍很便宜，不值得为它换一次重画
        function stAiMsgPreview(messages, extraNote) {
            const list = (messages || []).filter(m => m && m.role);
            const total = list.reduce((n, m) => n + estimateTokens(m.content || ''), 0);
            const sysN = list.filter(m => m.role === 'system').length;
            const proto = stAiCfg().proto === 'anthropic' ? 'anthropic' : 'openai';
            // 两种协议下「谁在最前面」的表现不一样，这里必须说清楚，
            // 否则用户看到 Anthropic 的请求体里 messages 只剩一条会以为第一段丢了
            const note = proto === 'anthropic'
                ? '当前协议 <b>Anthropic</b>：上面 ' + sysN + ' 条 system 会合并进顶层 <code>system</code> 字段，' +
                  '<code>messages</code> 里只剩 user（Anthropic 要求它以 user 开头）。' +
                  '合并时按编号顺序拼，所以第一段仍然是最前面的内容。'
                : '当前协议 <b>OpenAI 兼容</b>：这几条按编号原样发进 <code>messages</code>，' +
                  '第 0 条就是模型最先读到的内容。';
            const MAX = 6000;
            const rows = list.map((m, i) => {
                const text = String(m.content || '');
                const shown = text.length > MAX
                    ? text.slice(0, MAX) + '\n\n…（这里截断了，实际发送的是完整 ' + text.length + ' 字）'
                    : text;
                const empty = !text.trim() || m.placeholder;
                return '<div class="st-ai-pmsg' +
                        (m.first ? ' st-p-first' : (m.role === 'user' ? ' st-p-user' : '')) + '">' +
                    '<div class="st-ai-phead">' +
                        '<span class="st-ai-prole">#' + i + '</span>' +
                        '<span class="st-ai-prole">' + escapeHtml(m.role) + '</span>' +
                        '<span class="st-ai-pname">' + escapeHtml(m.label || '') + '</span>' +
                        '<span class="st-ai-plen">' + text.length + ' 字</span>' +
                    '</div>' +
                    '<pre class="st-ai-pbody' + (empty ? ' st-empty' : '') + '">' +
                        escapeHtml(shown || '（这一条是空的，不会真的发出去）') + '</pre>' +
                    '</div>';
            }).join('');
            return '<details class="st-ai-pv">' +
                '<summary>🔍 提示词结构预览' +
                    '<span class="st-chip">' + list.length + ' 条</span>' +
                    '<span class="st-chip">约 ' + total + ' tokens</span>' +
                '</summary>' +
                '<div class="st-ai-pv-body">' +
                    rows +
                    '<div class="st-ai-pnote">' + note + '</div>' +
                    (extraNote ? '<div class="st-ai-pnote">' + extraNote + '</div>' : '') +
                '</div>' +
                '</details>';
        }

        // 拿某个功能面板的 plan 直接出预览 —— 三个面板都走这一句
        function stAiPlanPreview(plan, extraNote) {
            return stAiMsgPreview(stAiPlanMessages(plan), extraNote);
        }

        // AI 助手页的**骨架**预览：三个固定槽位 + 真实的第一段内容。
        // 这里故意不跑各功能面板的 plan —— 那两个面板各自有带真实内容的预览，
        // 在这一页再算一遍只会让「参数到底在哪一页配」变得含糊
        function stAiSkeletonPreview() {
            return stAiMsgPreview([
                { role: 'system', content: stAiFirstSegText(),
                  label: '第一段（你自己写的）', first: true },
                { role: 'system', content: '（由各功能面板自己拼：任务说明 + 输出格式约束 + 字段说明）',
                  label: '任务提示词 system', placeholder: true },
                { role: 'user', content: '（由各功能面板自己拼：素材 + 要求 + 氛围 + 正文格式）',
                  label: '任务与素材 user', placeholder: true }
            ], '后面两条的内容随功能而变 —— 带真实内容的预览在世界书页的' +
               '「✨ AI 扩写条目」、每条条目自己的「✍ AI 改写这一条」、' +
               '以及开场白页的「AI 生成开场白」里。');
        }

        // 本机地址（Ollama / LM Studio / 反代）不需要 key
        function stAiIsLocal(baseUrl) {
            return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)/i.test(String(baseUrl || ''));
        }

        // 「这份配置到底要不要 API Key」的**唯一判据**。
        // ⚠⚠ Vertex 完整模式（Service Account）是拿 SA JSON 去换 access token 的，
        //   `apiKey` **本来就是空的** —— 谁无条件要求 Key，就等于把这条路整个封死。
        //   这个坑踩过两次：先是 `stAiReady`（编写器发不出请求），
        //   然后是 `applyAiSettings`（【ai对话】点「应用」被拦，聊天都进不去）。
        // ⇒ 凡是「要不要 Key」的**轻量**判断一律走这里，别再各写各的。
        //   ⚠ `stAiReady` / `apigReadyCheck` 是**整条**校验分支（还要管模型名、
        //     SA JSON 解析、项目 ID），各自保留结构；但其中那条 Key 的判据必须跟这里一致。
        //   ⚠ 别拿 `proto === 'gemini'` 代替 `stAiIsVertex()` —— AI Studio 也是 gemini
        //     协议，它**永远要 Key**，混用会让它带着一个残留的 `authMode: 'sa'` 裸奔出去
        function stAiNeedsKey(cfg) {
            if (stAiIsVertex(cfg) && cfg && cfg.authMode === 'sa') return false;
            return !stAiIsLocal((cfg && cfg.baseUrl) || '');
        }

        // needModel 默认 true。**「拉模型列表」要传 false** ——
        // 那一步本来就是为了挑模型，要求先有模型就成了死循环
        function stAiReady(cfg, opts) {
            const needModel = !(opts && opts.needModel === false);
            const where = cfg.mode === 'own' ? '去「AI 助手」页' : '点主页的【🔌 API 全局配置】按钮';
            if (!cfg.baseUrl) {
                return { ok: false, why: '还没配 Base URL。' + where + '选一个服务商' +
                    (cfg.mode === 'own' ? '' : '，或者在本页切到「独立配置」自己填一套') + '。' };
            }
            // ⚠⚠ Vertex 单独判：它的预设 baseUrl 是**写死的**（`https://aiplatform.googleapis.com`），
            //   而完整模式下 `apiKey` **本来就是空的** ⇒ 走下面那条通用检查会永远报
            //   「还没填 API Key」，完整模式**根本跑不起来**（第一版就是这个 bug）。
            if (stAiIsVertex(cfg)) {
                if (cfg.authMode === 'sa') {
                    if (!cfg.saJson) {
                        return { ok: false, why: '完整模式还没粘 Service Account JSON。' + where +
                            '切到「完整模式（Service Account）」那一档，把密钥 JSON 粘进去。' };
                    }
                    const sa = stAiSaParse(cfg.saJson);
                    if (!sa.ok) return { ok: false, why: sa.why };
                    // 项目 ID：填了用填的，没填从 JSON 的 `project_id` 取（见 stAiVertexProject）。
                    // 两处都没有就**明说拒绝** —— 否则拼出 `/v1/projects//locations/...` 拿一个
                    // 404 回来，报错里看不出是「少了项目」（RULES 六之二十七：别把失败伪装成别的失败）
                    if (!stAiVertexProject(cfg)) {
                        return { ok: false, why: '这份 Service Account JSON 里没有 project_id，' +
                            '也没在「项目 ID」那一格填 —— 完整模式的 URL 必须有项目，' +
                            '补一个（密钥文件里的 project_id）。' };
                    }
                } else if (!cfg.apiKey) {
                    return { ok: false, why: 'Vertex 快速模式还没填 API Key。' + where + '填一个。' };
                }
                if (needModel && !cfg.model) {
                    return { ok: false, why: '还没填模型名。' + where +
                        '直接输入一个（例如 gemini-2.5-flash），或点「获取模型列表」再挑。' };
                }
                return { ok: true, why: '' };
            }
            if (!cfg.apiKey && !stAiIsLocal(cfg.baseUrl)) {
                return { ok: false, why: '还没填 API Key。' + where + '填一个' +
                    (cfg.mode === 'own' ? '。' : '，或者在本页切到「独立配置」自己填一套。') };
            }
            if (needModel && !cfg.model) {
                return { ok: false, why: '还没选模型。' + where + '点一下「获取模型」再选一个。' };
            }
            return { ok: true, why: '' };
        }

        function stAiModeLabel(cfg) {
            const c = cfg || stAiCfg();
            const who = c.mode === 'own' ? '独立配置' : '跟随 API 全局配置';
            return who + ' · ' + (c.providerLabel || c.provider || '?') + ' · ' + (c.model || '（未选模型）');
        }

        function stAiErrText(e) {
            const m = (e && e.message) ? String(e.message) : String(e);
            if (/Failed to fetch|NetworkError|Load failed|ERR_/i.test(m)) {
                return '请求发不出去（Failed to fetch）。三个常见原因：① Base URL 写错；' +
                    '② 该服务不允许浏览器直连（CORS，Anthropic 要带 ' +
                    'anthropic-dangerous-direct-browser-access 头，本应用已经带了）；' +
                    '③ 网络不通或需要代理。原始信息：' + m;
            }
            if (/aborted|AbortError/i.test(m)) return '请求超时或被取消了。';
            return m;
        }

