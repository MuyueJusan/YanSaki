        // ===== 扩写：拼提示词 =====

        function stAiExpandPlan() {
            const ui = stAiUi;
            const count = Math.max(1, Math.min(20, Math.trunc(Number(ui.exCount) || 1)));
            const src = [];

            if (ui.exSource === 'card' || ui.exSource === 'book') {
                const brief = stAiCardBrief(1200);
                if (brief) src.push('【角色卡设定】\n' + brief);
            }
            if (ui.exSource === 'book') {
                const bk = stAiBookBrief(60);
                if (bk) src.push('【已有世界书条目】\n' + bk);
            }
            if (ui.exSource === 'free') {
                const f = String(ui.exFree || '').trim();
                if (f) src.push('【素材】\n' + f);
            }
            if (ui.exSource !== 'book' && ui.exKeepBook) {
                const bk = stAiBookBrief(60);
                if (bk) src.push('【已有世界书条目（务必不要和它们重复）】\n' + bk);
            }

            const reqs = [];
            ui.exReq.forEach(id => {
                const p = ST_AI_REQ_PRESETS.find(x => x.id === id);
                if (p) reqs.push(p.text);
            });
            const free = String(ui.exReqFree || '').trim();
            if (free) reqs.push(free);

            const fmt = ST_AI_FORMAT_PRESETS.find(p => p.id === ui.exFormat);
            const mood = stAiMoodText(ui.exMood, ui.exMoodFree);

            const sys = [
                '你是一位 SillyTavern 角色卡的世界书作者。你的任务是把给定的设定素材扩写成世界书条目。',
                '',
                '【输出格式（必须严格遵守）】',
                '只输出一个 JSON 对象。不要任何解释、寒暄、前后缀，不要 Markdown 围栏。结构：',
                '{"entries":[{"comment":"备注","keys":["关键词1","关键词2"],"secondary_keys":[],' +
                    '"content":"条目正文","constant":false,"position":0,"depth":4,"order":100}]}',
                '',
                '【字段说明】',
                '· comment：给自己看的备注，一句话，不超过 12 个字。',
                '· keys：触发关键词，3~6 个。必须是会真实出现在对话里的具体名词；' +
                    '不要用「的」「我」「很」「然后」这类泛词。',
                '· secondary_keys：次关键词，没有就留空数组。',
                '· content：条目正文，写法见下面「正文格式」。',
                '· constant：true = 常驻（不看关键词一直生效），false = 靠关键词触发。',
                '· position：0 = 角色定义之前，1 = 角色定义之后，4 = 按深度插入对话。',
                '· depth：只在 position = 4 时有意义，表示插到倒数第几条消息之前，一般 3~6。',
                '· order：插入顺序，默认 100，数字越大越靠后。',
                '· entries 数组的元素个数必须**正好 ' + count + ' 个**，不能多也不能少。',
                '· 条目之间不要互相重复，也不要和「已有世界书条目」重复。'
            ].join('\n');

            const u = [];
            u.push(src.length ? '【素材】\n' + src.join('\n\n')
                : '【素材】\n（没有给出素材。请只根据角色名做最保守的合理发挥，不要编造具体设定。）');
            if (reqs.length) {
                u.push('【扩写要求】\n' + reqs.map((t, i) => (i + 1) + '. ' + t).join('\n'));
            }
            u.push('【氛围】\n' + (mood || '不指定，从素材里自己判断，并保持全篇一致。'));
            u.push('【正文格式】\n' + (fmt ? fmt.text : '自然段落。'));
            u.push('【条数】\n正好 ' + count + ' 条。');

            return { system: sys, user: u.join('\n\n'), count: count };
        }

