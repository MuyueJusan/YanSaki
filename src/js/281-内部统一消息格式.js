        // —— 内部统一消息格式 ——
        //   { role:'system'|'user'|'assistant'|'tool', content:'文本',
        //     calls?: [{id,name,args}], toolResults?: [{id,name,text}] }
        // 存进会话的就是这个形状；发出去之前才转成协议要的样子。
        // ⚠ Anthropic 那条**不能**走 stAiSplitSystem —— 那个函数假设 content 是字符串，
        //   而工具消息的 content 是块数组，塞进去会变成 "[object Object]"
        function stCodeMessagesFor(proto, msgs) {
            const list = msgs || [];
            if (proto === 'anthropic') {
                const sys = [], out = [];
                // 连续的 tool_result 必须并进同一条 user —— Anthropic 不允许两条连续的 user
                const pushUserBlocks = blocks => {
                    const last = out[out.length - 1];
                    if (last && last.role === 'user') {
                        const prev = Array.isArray(last.content)
                            ? last.content
                            : [{ type: 'text', text: String(last.content || '') }];
                        last.content = prev.concat(blocks);
                        return;
                    }
                    out.push({ role: 'user', content: blocks });
                };
                list.forEach(m => {
                    // note 是给用户看的一句话提示，**不发给模型**
                    if (!m || m.role === 'note') return;
                    const text = String(m && m.content != null ? m.content : '');
                    if (m.role === 'system') { if (text) sys.push(text); return; }
                    if (m.role === 'tool') {
                        const blocks = (m.toolResults || []).map(r => ({
                            type: 'tool_result',
                            tool_use_id: r.id,
                            content: String(r.text == null ? '' : r.text)
                        }));
                        if (blocks.length) pushUserBlocks(blocks);
                        return;
                    }
                    if (m.role === 'assistant') {
                        const blocks = [];
                        if (text) blocks.push({ type: 'text', text: text });
                        (m.calls || []).forEach(c => blocks.push({
                            type: 'tool_use', id: c.id, name: c.name, input: c.args || {}
                        }));
                        if (!blocks.length) blocks.push({ type: 'text', text: '（继续）' });
                        out.push({ role: 'assistant', content: blocks });
                        return;
                    }
                    out.push({ role: 'user', content: text || '（继续）' });
                });
                if (!out.length) out.push({ role: 'user', content: '（继续）' });
                if (out[0].role !== 'user') out.unshift({ role: 'user', content: '（继续）' });
                return { system: sys.join('\n\n'), messages: out };
            }
            if (proto === 'gemini') {
                const sys = [], contents = [];
                // Gemini 每一轮叫一个「content」，形状 {role:'user'|'model', parts:[...]}。
                // ⚠ 同一个 role 连着出现时**合并**：一组工具结果本来就是好几条
                //   functionResponse，拆成多条 content 会让模型看到一串空转的轮次
                const pushParts = (role, parts) => {
                    if (!parts.length) return;
                    const last = contents[contents.length - 1];
                    if (last && last.role === role) last.parts = last.parts.concat(parts);
                    else contents.push({ role: role, parts: parts });
                };
                list.forEach(m => {
                    // 同上：note 只给用户看
                    if (!m || m.role === 'note') return;
                    const text = String(m && m.content != null ? m.content : '');
                    if (m.role === 'system') { if (text) sys.push(text); return; }
                    if (m.role === 'tool') {
                        pushParts('user', (m.toolResults || []).map(r => {
                            const fr = {
                                name: String(r.name || ''),
                                // ⚠ response 必须是**对象**（proto 里是 Struct）——
                                //   给个字符串服务端直接 400
                                response: { result: String(r.text == null ? '' : r.text) }
                            };
                            // ⚠ 只有模型**真的给过** id 才回传：Gemini 2.5 及更早不给 id，
                            //   凭空编一个反而可能让它对不上（3 代起才要求回传）
                            if (r.mid) fr.id = String(r.mid);
                            return { functionResponse: fr };
                        }));
                        return;
                    }
                    if (m.role === 'assistant') {
                        // ⚠ 有原始 parts 就**原样**发回去：`thoughtSignature` 必须待在它
                        //   原来那个 Part 里（Gemini 3 起对函数调用是强制的），重新拼一遍
                        //   签名就丢了，服务端回 400
                        if (Array.isArray(m.gemParts) && m.gemParts.length) {
                            pushParts('model', m.gemParts);
                            return;
                        }
                        const parts = [];
                        if (text) parts.push({ text: text });
                        (m.calls || []).forEach(c => {
                            const fc = {
                                name: String(c.name || ''),
                                args: (c.args && typeof c.args === 'object') ? c.args : {}
                            };
                            if (c.mid) fc.id = String(c.mid);
                            parts.push({ functionCall: fc });
                        });
                        if (!parts.length) parts.push({ text: '（继续）' });
                        pushParts('model', parts);
                        return;
                    }
                    pushParts('user', [{ text: text || '（继续）' }]);
                });
                if (!contents.length) contents.push({ role: 'user', parts: [{ text: '（继续）' }] });
                if (contents[0].role !== 'user') {
                    contents.unshift({ role: 'user', parts: [{ text: '（继续）' }] });
                }
                return { system: sys.join('\n\n'), contents: contents };
            }
            const out = [];
            list.forEach(m => {
                // 同上：note 只给用户看
                if (!m || m.role === 'note') return;
                const text = String(m && m.content != null ? m.content : '');
                if (m.role === 'system') { if (text) out.push({ role: 'system', content: text }); return; }
                if (m.role === 'tool') {
                    (m.toolResults || []).forEach(r => out.push({
                        role: 'tool',
                        tool_call_id: r.id,
                        content: String(r.text == null ? '' : r.text)
                    }));
                    return;
                }
                if (m.role === 'assistant') {
                    const o = { role: 'assistant', content: text || '' };
                    const calls = (m.calls || []).map(c => ({
                        id: c.id,
                        type: 'function',
                        function: { name: c.name, arguments: JSON.stringify(c.args || {}) }
                    }));
                    if (calls.length) o.tool_calls = calls;
                    out.push(o);
                    return;
                }
                out.push({ role: 'user', content: text });
            });
            if (!out.length) out.push({ role: 'user', content: '（继续）' });
            return { system: '', messages: out };
        }

        // Code 页的请求体。**没有第一段** —— 只有 system + messages + tools
        function stCodeRequest(cfg, msgs, opts) {
            const o = opts || {};
            const proto = cfg.proto === 'anthropic' ? 'anthropic'
                : (cfg.proto === 'gemini' ? 'gemini' : 'openai');
            const maxTokens = Math.trunc(stAiNum(o.maxTokens, cfg.maxTokens, 256, 32000));
            const temperature = stAiNum(o.temperature, cfg.temperature, 0, 2);
            const conv = stCodeMessagesFor(proto, msgs);
            const tools = stCodeToolsFor(proto);

            if (proto === 'gemini') {
                // ⚠ gemini 的 URL 里**要拼模型名**、头还可能异步 ⇒ 不能走 stAiEndpoint
                //   （那个只认 openai / anthropic）。完整模式的 token 同理：这里只留
                //   `needsToken` 标记，由 stCodeFetch await 之后合并进 headers ——
                //   这样本函数保持**同步**，套件才能直接取返回值断言
                const needsToken = stAiIsVertex(cfg) && (cfg.authMode === 'sa');
                const headers = { 'Content-Type': 'application/json' };
                if (!needsToken) headers['x-goog-api-key'] = String(cfg.apiKey || '');
                // generationConfig / safetySettings 复用 stAiGeminiBody —— 「安全阈值必须发」
                // 和 maxOutputTokens 的钳制这两条规则只该有一份实现
                const body = stAiGeminiBody(cfg, [], { temperature: temperature, maxTokens: maxTokens });
                body.contents = conv.contents;
                if (conv.system) body.systemInstruction = { parts: [{ text: conv.system }] };
                else delete body.systemInstruction;
                body.tools = tools;
                body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
                return {
                    proto: 'gemini',
                    url: stAiGeminiUrl(cfg, cfg.model, false),
                    headers: headers,
                    needsToken: needsToken,
                    body: body
                };
            }

            const ep = stAiEndpoint(cfg, proto === 'anthropic' ? '/messages' : '/chat/completions');
            if (proto === 'anthropic') {
                const body = {
                    model: cfg.model,
                    max_tokens: maxTokens,
                    temperature: temperature,
                    messages: conv.messages,
                    tools: tools
                };
                if (conv.system) body.system = conv.system;
                return { proto: ep.proto, url: ep.url, headers: ep.headers, body: body };
            }
            const body = {
                model: cfg.model,
                messages: conv.messages,
                temperature: temperature,
                tools: tools,
                tool_choice: 'auto',
                // 工具调用要拼成完整的一条消息，流式反而更麻烦 —— 一律非流式
                stream: false
            };
            if (maxTokens > 0) body.max_tokens = maxTokens;
            return { proto: ep.proto, url: ep.url, headers: ep.headers, body: body };
        }

        // 从回复里取出「说了什么」+「要调哪些工具」
        function stCodeParseReply(proto, data) {
            const out = { text: '', calls: [], stop: '' };
            if (!data || typeof data !== 'object') return out;
            if (proto === 'anthropic') {
                const parts = Array.isArray(data.content) ? data.content : [];
                parts.forEach(p => {
                    if (!p || typeof p !== 'object') return;
                    if (p.type === 'text') out.text += String(p.text || '');
                    else if (p.type === 'tool_use') out.calls.push({
                        id: String(p.id || stUuid()),
                        name: String(p.name || ''),
                        args: stCodeArgs(p.input)
                    });
                });
                out.stop = String(data.stop_reason || '');
                return out;
            }
            if (proto === 'gemini') {
                const cands = Array.isArray(data.candidates) ? data.candidates : [];
                const c0 = cands[0] || {};
                const parts = (c0.content && Array.isArray(c0.content.parts)) ? c0.content.parts : [];
                parts.forEach(p => {
                    if (!p || typeof p !== 'object') return;
                    // ⚠ 思考片段（thought:true）**不进正文** —— 那是模型的内部推理，
                    //   混进 out.text 用户就会看到「AI 在自言自语」，而且下一轮还会被
                    //   当成 assistant 正文回发。但它必须留在 out.parts 里（签名在那）
                    if (p.thought === true) return;
                    if (typeof p.text === 'string') { out.text += p.text; return; }
                    if (p.functionCall && typeof p.functionCall === 'object') {
                        const fc = p.functionCall;
                        // ⚠ mid = **模型给的** id（可能没有）。没有时内部补一个，但回传
                        //   时只回 mid —— 见 stCodeMessagesFor 的 gemini 分支
                        const mid = fc.id ? String(fc.id) : '';
                        out.calls.push({
                            id: mid || stUuid(),
                            mid: mid,
                            name: String(fc.name || ''),
                            args: stCodeArgs(fc.args)
                        });
                    }
                });
                // 原始 parts 整份留着 —— thoughtSignature 必须原样待在它那个 Part 里
                out.parts = parts;
                out.stop = String(c0.finishReason || '');
                return out;
            }
            const ch = (data.choices && data.choices[0]) || null;
            const msg = ch && ch.message ? ch.message : null;
            if (!msg) return out;
            if (typeof msg.content === 'string') out.text = msg.content;
            else if (Array.isArray(msg.content)) {
                msg.content.forEach(p => { if (p && p.type === 'text') out.text += String(p.text || ''); });
            }
            (Array.isArray(msg.tool_calls) ? msg.tool_calls : []).forEach(c => {
                if (!c) return;
                const fn = c.function || {};
                out.calls.push({
                    id: String(c.id || stUuid()),
                    name: String(fn.name || ''),
                    args: stCodeArgs(fn.arguments)
                });
            });
            out.stop = String(ch.finish_reason || '');
            return out;
        }

        // 工具入参：Anthropic 给对象，OpenAI 给 JSON 字符串。
        // 字符串那条还得兜住「模型给了一段带 ``` 围栏的 JSON」—— 跟 stAiJsonOf 一个道理
        function stCodeArgs(v) {
            if (v && typeof v === 'object' && !Array.isArray(v)) return v;
            const s = String(v == null ? '' : v).trim();
            if (!s) return {};
            const j = stAiJsonOf(s);
            if (j.ok && j.value && typeof j.value === 'object' && !Array.isArray(j.value)) return j.value;
            return { __raw: s };
        }

