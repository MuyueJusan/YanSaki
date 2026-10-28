        // ===== 开场白：拼提示词 =====

        function stAiGreetPlan() {
            const ui = stAiUi;
            const count = Math.max(1, Math.min(5, Math.trunc(Number(ui.grCount) || 1)));
            const len = Math.max(100, Math.min(3000, Math.trunc(Number(ui.grLen) || 600)));
            const rows = stAiInjectList({ includeDisabled: ui.grIncOff });
            const inject = stAiInjectText(rows);
            const mood = stAiMoodText(ui.grMood, ui.grMoodFree);
            const extra = String(ui.grExtra || '').trim();

            const sys = [
                '你是一位 SillyTavern 角色卡的作者。请根据角色设定与世界观，写开场白（first_mes）——',
                '也就是玩家打开这张卡时看到的第一条消息。',
                '',
                '【输出格式（必须严格遵守）】',
                '只输出一个 JSON 对象。不要任何解释、寒暄、前后缀，不要 Markdown 围栏。结构：',
                '{"greetings":["第一段开场白","第二段开场白"]}',
                '',
                '【写作要求】',
                '· 站在角色的视角写，可以第二人称也可以第三人称。',
                '· **不要替玩家说话，也不要替玩家决定动作或心理活动。**',
                '· 动作、神态、环境描写放在 *星号* 里。用 {{user}} 指玩家、{{char}} 指角色。',
                '· 开头先立画面：场景、时间、角色的状态，然后再让角色开口。',
                '· 结尾留一个钩子，给玩家回话的空间，不要把事情写死、不要提前推进剧情。',
                '· 每段大约 ' + len + ' 字，不要太短。',
                '· greetings 数组的元素个数必须**正好 ' + count + ' 个**，' +
                    '段与段之间场景或切入点要有明显区别，不要只是换几句台词。'
            ].join('\n');

            const u = [];
            const brief = stAiCardBrief(1500);
            if (brief) u.push('【角色卡设定】\n' + brief);
            u.push('【世界观 / 世界书注入】\n' +
                (inject || '（这张卡还没有可用的世界书条目。）') +
                '\n\n上面是按运行时顺序排好的 —— 开场时对话里只有这一条开场白，' +
                '所以所有「按深度插入」的条目都会插在它之前，这里已经按深度从大到小排给你了。');
            u.push('【氛围】\n' + (mood || '不指定，从角色设定里自己判断，并保持全篇一致。'));
            if (extra) u.push('【额外要求】\n' + extra);
            u.push('【条数】\n正好 ' + count + ' 段。');

            return { system: sys, user: u.join('\n\n'), count: count, rows: rows };
        }

