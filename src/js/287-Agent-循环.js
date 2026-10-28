        // —— Agent 循环 ——
        // 每轮：发一次 → 有工具就执行、把结果喂回去继续 → 没有工具就收尾
        async function stCodeSend() {
            if (stCode.running) return;
            const box = document.getElementById('st-code-input');
            const text = box ? String(box.value || '').trim() : String(stCodeDraft || '').trim();
            if (!text) return;

            const cfg = stAiCfg();
            const ready = stAiReady(cfg);
            if (!ready.ok) { stCode.err = ready.why; stCodeRepaint(); return; }

            const th = stCodeThink();
            // ⚠ skill 列表来自 IndexedDB，是异步读的。这里必须等一下 ——
            //   否则「打开编辑器后马上点发送」会拿到空列表，触发词一个都命中不了，
            //   表现是「刚导入的 skill 第一次不生效，第二次就好了」
            await stCodeSkillsLoad();
            const s = stCodeSession();
            s.msgs.push({ role: 'user', content: text, ts: Date.now() });
            s.title = stCodeTitleOf(s);
            s.ts = Date.now();
            // 用户这一句命中了哪些 skill → 正文自动进 system（结果累积在会话上）。
            // ⚠ 只在**这一处**算：stCodeSystem 每一轮都会被调用，而这件事有副作用
            //   （写 s.autoSkills）—— 放那儿就成了每轮反复改写状态
            stCodeSkillAuto(text, s);

            stCodeDraft = '';
            if (box) box.value = '';
            stCode.running = true;
            stCode.err = '';
            stCode.step = 0;
            stCodeSaveSessions();
            stCodeRepaint();

            // used  = **改卡步数**，只数会动卡的工具
            // reads = 只读工具的次数。⚠ 只读**不占 used** —— 「关」档才 4 步，
            //   读卡 + 读状态栏 + 读 Zod 就用掉 3 步，真正要改的那一下反而没预算了。
            //   但也不能不限，否则模型可以一直 read_card 转圈，所以单独给一个上限
            let used = 0;
            let reads = 0;
            try {
                // 轮次硬上限。每一轮都是一次 API 调用，不能只按 used 算 ——
                // 只读不涨 used 的话这里就成了兜底闸门
                for (let round = 0; round <= th.steps + ST_CODE_READ_STEPS_MAX; round++) {
                    stCode.step = used + 1;
                    stCodePaint();

                    const plan = stCodeRequest(cfg, stCodeSysMsgs(s), {});
                    const data = await stCodeFetch(plan, cfg);
                    const rep = stCodeParseReply(plan.proto, data);

                    const calls = (rep.calls || []).filter(c => c && c.name);
                    if (!calls.length) {
                        if (rep.text.trim()) {
                            s.msgs.push({ role: 'assistant', content: rep.text, ts: Date.now() });
                        } else {
                            s.msgs.push({ role: 'note', content: '模型这一轮什么都没返回。', ts: Date.now() });
                        }
                        break;
                    }

                    // 一轮里**只记一条 assistant**：文字和 tool_calls 是同一条消息的两半。
                    // ⚠ 拆成两条的话 Anthropic 那边就是连续两条 assistant，直接 400；
                    //   OpenAI 那边也会因为「带 tool_calls 的消息后面没紧跟 tool」而报错。
                    //   再把每条工具结果各记一条 tool —— 每个 tool_call_id 都得有对应的结果
                    // ⚠ Gemini 的原始 parts 要留着：`thoughtSignature` 必须原样回传
                    //   （Gemini 3 起对函数调用是强制的），重新拼一遍签名就丢了
                    const am = { role: 'assistant', content: rep.text, calls: calls, ts: Date.now() };
                    if (plan.proto === 'gemini' && Array.isArray(rep.parts) && rep.parts.length) {
                        am.gemParts = rep.parts;
                    }
                    s.msgs.push(am);
                    let touched = false;
                    // ⚠ 这里必须 for...of + await，不能用 forEach：
                    //   ① fetch_url 要真的等网络，forEach 不认 async 回调 ——
                    //      写成 forEach 的话每个工具结果都会是 `{}`（Promise 没被 await），
                    //      而且**不报错**，模型只会看到一堆空结果；
                    //   ② for...of 是顺序的，工具结果的先后和 tool_calls 的顺序对得上。
                    for (const c of calls) {
                        // ⚠ 只读工具不涨 used。判据在 stCodeIsReadTool 里 ——
                        //   静态名单**加**「没申请 card.write 的工具型 skill」
                        //   （那个判断依赖 stCode.skills，所以不能在常量层做）
                        //   ⚠ 名单里拼错一个名字不会报错 —— 那条工具只是悄悄退回
                        //     「吃步数」的老行为。套件里用**推导式**断言兜住
                        if (stCodeIsReadTool(c.name)) reads++;
                        else used++;
                        const r = await stCodeTool(c.name, c.args);
                        s.msgs.push({
                            role: 'tool',
                            content: '',
                            // mid 一起带上：Gemini 回传 functionResponse 时要那个 id
                            toolResults: [{ id: c.id, mid: c.mid || '', name: c.name, text: r.text }],
                            ok: r.ok !== false,
                            ts: Date.now()
                        });
                        if (r.touched) touched = true;
                    }
                    if (touched) stCodePaintJson();
                    stCodeSaveSessions();
                    stCodePaint();

                    if (used >= th.steps) {
                        s.msgs.push({
                            role: 'note',
                            content: '已经用满 ' + th.steps + ' 步改卡，先停在这里。可以再说一句让它接着做。',
                            ts: Date.now()
                        });
                        break;
                    }
                    if (reads >= ST_CODE_READ_STEPS_MAX) {
                        s.msgs.push({
                            role: 'note',
                            content: '已经连着读了 ' + reads + ' 次还没动手，先停在这里。' +
                                '可以再说一句、或者直接告诉它要改哪里。',
                            ts: Date.now()
                        });
                        break;
                    }
                }
            } catch (e) {
                stCode.err = stAiErrText(e);
            } finally {
                stCode.running = false;
                stCode.step = 0;
                stCode.abort = null;
                stCodeSaveSessions();
                stCodeRepaint();
            }
        }

