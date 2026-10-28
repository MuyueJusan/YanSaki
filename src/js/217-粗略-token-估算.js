        // —— 粗略 token 估算：CJK 约 1 字 1 token，ASCII 约 4 字符 1 token ——
        function estimateTokens(text) {
            const s = String(text == null ? '' : text);
            if (!s) return 0;
            let cjk = 0, other = 0;
            for (const ch of s) {
                const c = ch.codePointAt(0);
                if ((c >= 0x2e80 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff) ||
                    (c >= 0xff00 && c <= 0xffef) || (c >= 0x3000 && c <= 0x303f)) cjk++;
                else other++;
            }
            return Math.ceil(cjk + other / 4);
        }

        function escapeRe(s) {
            return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }

        // ===== 角色卡解析 =====

        // 返回 { card, book }：book 是卡内自带的原始世界书（没有就是 null）
        // lenient = true 时允许「只有名字」这种空卡（编写器导入用），
        // 酒馆模式导入还是严格模式 —— 免得把一张随便的 JSON 当成角色卡读进来
        function parseCharacterCard(raw, lenient) {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('不是有效的 JSON 对象');
            let spec = 'v1';
            let data = raw;
            if (raw.spec && String(raw.spec).indexOf('chara_card') === 0) {
                spec = String(raw.spec).replace('chara_card_', '');
                data = raw.data || {};
            } else if (raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data) &&
                       (raw.data.name || raw.data.description || raw.data.first_mes)) {
                spec = 'v2';
                data = raw.data;
            }
            const s = v => (typeof v === 'string' ? v : (v == null ? '' : String(v)));
            const card = {
                spec,
                // V1 的老字段名也一起兜住
                name: s(data.name) || s(data.char_name) || '未命名角色',
                description: s(data.description) || s(data.char_persona),
                personality: s(data.personality),
                scenario: s(data.scenario) || s(data.world_scenario),
                firstMes: s(data.first_mes) || s(data.char_greeting),
                mesExample: s(data.mes_example) || s(data.example_dialogue),
                creatorNotes: s(data.creator_notes),
                systemPrompt: s(data.system_prompt),
                postHistoryInstructions: s(data.post_history_instructions),
                alternateGreetings: Array.isArray(data.alternate_greetings)
                    ? data.alternate_greetings.map(s).filter(x => x.trim()) : [],
                tags: Array.isArray(data.tags) ? data.tags.map(s) : [],
                creator: s(data.creator),
                characterVersion: s(data.character_version),
                nickname: s(data.nickname)
            };
            if (!lenient && !card.description && !card.personality && !card.firstMes && !card.mesExample) {
                throw new Error('卡里没找到 description / personality / first_mes / mes_example，不像是角色卡');
            }
            const book = (data && data.character_book) || raw.character_book || null;
            return { card, book };
        }

