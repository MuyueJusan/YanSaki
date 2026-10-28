        // —— 预设：导入 ——

        async function onPresetFilePicked(ev) {
            const file = ev.target.files && ev.target.files[0];
            ev.target.value = '';   // 允许重复选同一个文件
            if (!file) return;
            setTavernStatus('正在读取预设 ' + file.name + ' …');
            try {
                const text = await file.text();
                const raw = JSON.parse(text);
                const preset = normalizePromptPreset(raw, file.name.replace(/\.json$/i, ''));
                if (!preset.prompts.length) {
                    throw new Error('这个 JSON 里没有 prompts —— 不像是 Chat Completion 预设');
                }
                if (!Array.isArray(aiConfig.tavernPresets)) aiConfig.tavernPresets = [];
                aiConfig.tavernPresets.push(preset);
                aiConfig.tavernPresetId = preset.id;
                presetRefresh();
                setTavernStatus('已导入预设「' + preset.name + '」· ' +
                    preset.prompts.length + ' 个槽 / ' +
                    preset.order.filter(o => o.enabled !== false).length + ' 个启用', 'ok');
            } catch (e) {
                setTavernStatus('⚠️ 预设导入失败：' + e.message, 'err');
            }
        }

        function renderTavernPreview() {
            const box = document.getElementById('ai-tavern-preview');
            if (!box) return;
            if (!tavernEnabled()) {
                box.innerHTML = '<span class="p-dim">开启酒馆模式后，这里会按实际发送顺序列出拼装出来的提示词。</span>';
                return;
            }
            // 试算：dryRun 不推进黏性 / 冷却状态（和 SillyTavern 的 dryRun 一个意思）
            const plan = buildRequestPlan({ dryRun: true });
            // 这些「来源细类」本质都还是 system 消息，所以同时带上 p-sys，
            // 让「有没有系统行」这类粗筛继续认得出来，细类只负责配色
            const cls = kind => ({
                user: 'p-user', ai: 'p-ai', wi: 'p-wi', an: 'p-an',
                main: 'p-sys p-main', char: 'p-sys p-char',
                example: 'p-sys p-example', chat: 'p-sys p-chat', post: 'p-sys p-post'
            }[kind] || 'p-sys');
            const MAX = 40;
            const rows = plan.layout.slice(0, MAX).map(x => {
                const role = x.role === 'system' ? 'system' : x.role;
                const preview = x.text.length > 90 ? x.text.slice(0, 90) + '…' : x.text;
                return '<span class="p-line">' +
                    '<span class="' + cls(x.kind) + '">[' + role + ']</span> ' +
                    '<span class="p-dim">' + escapeHtml(x.label || '') + ' · ' + x.text.length + ' 字</span>' +
                    '</span>' +
                    '<span class="p-body">' + escapeHtml(preview.replace(/\n/g, ' ⏎ ')) + '</span>';
            }).join('');
            const more = plan.layout.length > MAX
                ? '<span class="p-dim">…还有 ' + (plan.layout.length - MAX) + ' 条</span>' : '';
            const total = plan.layout.reduce((n, x) => n + estimateTokens(x.text), 0);
            const wi = plan.worldInfo;
            const anLine = (() => {
                const anText = anBlockText(wi || { anTop: [], anBottom: [] });
                if (!anText) {
                    return '<span class="p-dim">作者注释：本轮不插入' +
                        (anInterval() === 0 ? '（间隔设为 0，等于关闭）' : '（间隔未到）') +
                        ' —— ↑AT / ↓AT 跟着一起不插</span>';
                }
                return '<span class="p-dim">作者注释：' + AN_POS_NAME[anPosition()] +
                    (anPosition() === AN_POS.inChat
                        ? ' · 深度 ' + anDepth() + ' · ' + (WI_ROLE_LABEL[anRole()] || '系统')
                        : '') +
                    ' · ↑AT ' + (wi ? wi.anTop.length : 0) + ' 条 / ↓AT ' + (wi ? wi.anBottom.length : 0) + ' 条</span>';
            })();
            // 人设这一轮去哪了 —— 位置选得不对时最容易「以为它没生效」
            const pPosNow = personaPosition();
            const personaLine = !personaRaw()
                ? '<span class="p-dim">用户人设描述：还没填「你的昵称」，这一项不插入</span>'
                : '<span class="p-dim">用户人设描述：' + PERSONA_POS_NAME[pPosNow] +
                  (pPosNow === PERSONA_POS.atDepth
                      ? ' · 深度 ' + personaDepth() + ' · ' + (WI_ROLE_LABEL[personaRole()] || '系统')
                      : '') +
                  (personaRidesAn() ? ' · 已并入作者注释' : '') +
                  (pPosNow === PERSONA_POS.topAn || pPosNow === PERSONA_POS.bottomAn
                      ? (personaRidesAn() ? '' : ' · 本轮不插入注释，人设也不插')
                      : '') +
                  '</span>';
            const head = wi
                ? '<span class="p-dim">世界书 ' + wi.scanned.length + ' 条参与扫描 · 本轮插入 ' +
                  wi.activated.length + ' 条</span>'
                : '';
            const outlets = (wi && Object.keys(wi.outlet).length)
                ? '<span class="p-dim">出口条目：' +
                  Object.keys(wi.outlet).map(k => escapeHtml(k) + '（' + wi.outlet[k].length + '）').join('、') +
                  ' —— 出口要插件来消费，本模式不插入</span>'
                : '';
            box.innerHTML = head + anLine + personaLine + outlets +
                '<span class="p-dim">共 ' + plan.layout.length + ' 条 · 约 ' + total + ' tokens</span>' +
                rows + more;
        }

