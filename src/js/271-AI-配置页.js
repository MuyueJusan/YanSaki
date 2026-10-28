        // ===== AI 配置页 =====

        function stPaneAi() {
            const cfg = stAiCfg();
            const p = stAiProviderOf(stAi.provider);
            const isCustom = !!p.custom;
            // cfg.proto 已经是解析好的（stAiCfg → stAiProtoOf）—— 别再自己拼一遍，
            // 那条链对「自定义」是错的（会显示 openai，而实际按 URL 猜）
            const protoNow = cfg.proto;
            return stPaneHead('🤖 AI 助手',
                '给编写器用的 AI：<b>世界书条目扩写</b>与<b>开场白生成</b>（那两个面板分别在世界书页和开场白页）。' +
                '配置有两种模式 —— <b>跟随 API 全局配置</b>直接复用主页【🔌 API 全局配置】里的服务商 / Key / 模型，' +
                '在那里改一次这边就跟着变；<b>独立配置</b>在这里另存一套，两边互不干扰。' +
                '<br>⚠ 这套配置<b>只存在浏览器本地</b>（<code>localStorage</code>），' +
                '<b>不会写进角色卡</b> —— 草稿和导出的 JSON 里都不会出现 API Key。') +
                '<div class="st-sub">配置来源</div>' +
                '<div class="st-ai-chips">' +
                    stAiChips([
                        { id: 'follow', label: '🔗 跟随 API 全局配置', text: '复用主页【API 全局配置】里的服务商 / Key / 模型' },
                        { id: 'own', label: '🔑 独立配置', text: '在这里另存一套，跟全局配置互不干扰' }
                    ], stAi.mode, 'stAiModePick') +
                '</div>' +
                (stAi.mode === 'own' ? stAiOwnFields(p, isCustom, protoNow) : stAiFollowFields(cfg)) +
                '<div class="st-ai-status' + (stAiReady(cfg).ok ? ' st-ok' : ' st-warn') + '" id="st-ai-cfg-status">' +
                    '当前生效：' + escapeHtml(stAiModeLabel(cfg)) +
                    ' · 协议 ' + escapeHtml(ST_AI_PROTO_LABEL[cfg.proto] || cfg.proto) +
                    (stAiReady(cfg).ok ? '' : '\n⚠ ' + escapeHtml(stAiReady(cfg).why)) +
                '</div>' +
                '<div class="st-actions">' +
                    '<button class="st-big" type="button" onclick="stAiPullModels()" id="st-ai-pull-btn">' +
                        '🔄 获取模型列表</button>' +
                    '<button class="st-big st-plain" type="button" onclick="stAiTestConn()" id="st-ai-test-btn">' +
                        '🧪 测试连接</button>' +
                    (stAi.mode === 'own'
                        ? '<button class="st-big st-plain" type="button" onclick="stAiClearOwn()">🗑 清空这套配置</button>'
                        : '') +
                '</div>' +
                '<div class="st-sub">第一段</div>' +
                '<div class="st-grid"><div class="st-field st-wide">' +
                    '<label for="st-ai-firstseg">第一段 <span class="st-hint-inline">' +
                        '留空 = 不发。它永远排在发给模型的最前面</span></label>' +
                    // 跟随模式下这一格是只读的 —— 它显示的是 API 全局配置里那段，
                    // 在这里能改就变成了「改了但下次刷新又变回去」的假输入框
                    '<textarea id="st-ai-firstseg" rows="4"' +
                        (stAi.mode === 'follow' ? ' readonly class="st-ai-ro"' : '') +
                        ' placeholder="比如：以下是一段角色扮演对话。请始终保持角色的语气，不要替用户做决定。"' +
                        ' oninput="stAiSetFirstSeg(this.value)">' +
                        escapeHtml(String(cfg.firstSeg || '')) + '</textarea>' +
                '</div></div>' +
                (stAi.mode === 'follow'
                    ? '<div class="st-note">这一格是<b>只读镜像</b> —— 跟随模式下它跟着【🔌 API 全局配置】里那段走。' +
                      '要改就点主页那个按钮，或者把上面的配置来源切成「独立配置」。</div>'
                    : '') +
                '<div class="st-note">' +
                    '它跟各功能面板自己拼的 system / user 是两回事：那两个是程序按你的参数生成的，' +
                    '这一段原样排在最前面。<br>' +
                    '支持 <code>{{char}}</code>（替换成当前角色卡的名字）；' +
                    '这条消息的角色是 <b>system</b> —— 两条协议下它都在最前面（Anthropic 会把它并进顶层 system 字段）。' +
                '</div>' +
                stAiSkeletonPreview() +
                '<div class="st-sub">怎么用</div>' +
                '<div class="st-note">' +
                    '① 先在<b>世界书</b>页的「AI 扩写条目」面板里写要求、点生成；' +
                    '② 再到<b>开场白</b>页的「AI 生成开场白」面板，它会按世界书当时的' +
                    '位置与深度、以及启用 / 停用状态，把注入顺序排好再交给模型。' +
                    '<br>两个面板共用这一页的配置，也共用同一个模型。' +
                '</div>' +
                '<div class="st-sub">拉取到的模型（' + (stAi.models || []).length + ' 个）</div>' +
                ((stAi.models || []).length
                    ? '<div class="st-note">' + escapeHtml((stAi.models || []).join('、')) + '</div>'
                    : '<div class="st-empty">还没拉取过。点上面的「获取模型列表」。</div>') +
                '<div class="st-sub">API 全局配置（只读）</div>' +
                '<div class="st-grid">' +
                    // ⚠ 必须读 apiGlobal，不能读 aiConfig —— 后者是「生效值」，
                    //   【ai对话】一切到独立配置它就跟着变，这张表就会指错地方
                    stAiReadonly('服务商', (AI_PROVIDERS.find(x => x.value === apiGlobal.provider) || {}).label || apiGlobal.provider || '') +
                    stAiReadonly('Base URL', apiGlobal.baseUrl || '（空）') +
                    stAiReadonly('模型', apiGlobal.model || '（未选）') +
                    stAiReadonly('API Key', apiGlobal.apiKey ? '已填写（' + apiGlobal.apiKey.length + ' 字符）' : '（空）') +
                '</div>' +
                '<div class="st-note">这张表只是为了让你看清「跟随」到底跟随到了什么。' +
                    '要改就点主页的【🔌 API 全局配置】按钮。</div>';
        }

        function stAiFollowFields(cfg) {
            return '<div class="st-sub">跟随到的配置</div>' +
                '<div class="st-grid">' +
                    stAiReadonly('服务商', cfg.providerLabel || cfg.provider) +
                    stAiReadonly('Base URL', cfg.baseUrl || '（空）') +
                    stAiReadonly('模型', cfg.model || '（未选）') +
                    stAiReadonly('API Key', cfg.apiKey ? '已填写（' + cfg.apiKey.length + ' 字符）' : '（空）') +
                    stAiReadonly('协议', ST_AI_PROTO_LABEL[cfg.proto] || cfg.proto, '按 Base URL 猜的') +
                    stAiReadonly('温度 / 上限', String(cfg.temperature) + ' / ' + cfg.maxTokens) +
                    stAiReadonly('第一段', cfg.firstSeg
                        ? String(cfg.firstSeg).slice(0, 60) + (String(cfg.firstSeg).length > 60 ? '…' : '')
                        : '（没填，不发送）', '在主页【API 全局配置】的「第一段」里改') +
                '</div>';
        }

        function stAiOwnFields(p, isCustom, protoNow) {
            const protoItems = [{ value: '', label: '自动（按服务商）' }]
                .concat(Object.keys(ST_AI_PROTO_LABEL).map(k => ({
                    value: k, label: ST_AI_PROTO_LABEL[k]
                })));
            const baseVal = isCustom ? stAi.baseUrl : (p.baseUrl || '');
            return '<div class="st-sub">独立配置</div>' +
                '<div class="st-grid">' +
                    '<div class="st-field">' +
                        '<label for="st-ai-provider">服务商</label>' +
                        '<select id="st-ai-provider" onchange="stAiSetProvider(this.value)">' +
                            aiProviderOptionsHtml(stAi.provider) +
                        '</select>' +
                    '</div>' +
                    '<div class="st-field">' +
                        '<label for="st-ai-proto">协议 <span class="st-hint-inline">Anthropic 走 /messages，Gemini 走 generateContent，其余走 /chat/completions</span></label>' +
                        '<select id="st-ai-proto" onchange="stAiSetProto(this.value)">' +
                            protoItems.map(x => '<option value="' + escapeHtml(x.value) + '"' +
                                (x.value === (stAi.proto || '') ? ' selected' : '') + '>' +
                                escapeHtml(x.label) + '</option>').join('') +
                        '</select>' +
                    '</div>' +
                    '<div class="st-field st-wide">' +
                        '<label for="st-ai-base">Base URL' +
                            (isCustom ? ' <span class="st-hint-inline">自定义服务商必须自己填</span>'
                                      : ' <span class="st-hint-inline">跟着服务商走，不可改</span>') +
                        '</label>' +
                        '<input id="st-ai-base" type="text" value="' + escapeHtml(baseVal) + '"' +
                            (isCustom ? '' : ' disabled') +
                            ' placeholder="https://api.example.com/v1"' +
                            ' oninput="stAiSetBase(this.value)">' +
                    '</div>' +
                    '<div class="st-field st-wide">' +
                        '<label for="st-ai-key">API Key <span class="st-hint-inline">' +
                            (stAiIsLocal(baseVal) ? '本机地址可以留空' : '只存本地，不会进卡') + '</span></label>' +
                        '<input id="st-ai-key" type="password" value="' + escapeHtml(stAi.apiKey) + '"' +
                            ' placeholder="sk-..." oninput="stAiSetKey(this.value)" autocomplete="off">' +
                    '</div>' +
                    stAiModelField() +
                    '<div class="st-field">' +
                        '<label for="st-ai-temp">温度 temperature</label>' +
                        '<input id="st-ai-temp" type="number" min="0" max="2" step="0.1"' +
                            ' value="' + escapeHtml(String(stAi.temperature)) + '"' +
                            ' oninput="stAiSetNum(\'temperature\',this.value)">' +
                    '</div>' +
                    '<div class="st-field">' +
                        '<label for="st-ai-maxtok">最大输出 tokens</label>' +
                        '<input id="st-ai-maxtok" type="number" min="64" max="32000" step="256"' +
                            ' value="' + escapeHtml(String(stAi.maxTokens)) + '"' +
                            ' oninput="stAiSetNum(\'maxTokens\',this.value)">' +
                    '</div>' +
                '</div>' +
                '<div class="st-checks">' +
                    '<label class="st-check"><input type="checkbox" id="st-ai-stream"' +
                        (stAi.stream ? ' checked' : '') +
                        ' onchange="stAiSetBool(\'stream\',this.checked)">' +
                        '<span>流式输出（生成时能看到进度）</span></label>' +
                '</div>';
        }

        function stAiModelField() {
            const ids = (stAi.models || []).slice();
            const cur = stAi.model || '';
            if (cur && ids.indexOf(cur) < 0) ids.unshift(cur);
            return '<div class="st-field st-wide">' +
                '<label for="st-ai-model">模型 model <span class="st-hint-inline">' +
                    '可以直接输入，也可以从拉取到的列表里挑</span></label>' +
                '<input id="st-ai-model" list="st-ai-model-list" value="' + escapeHtml(cur) + '"' +
                    ' placeholder="比如 gpt-4o-mini / claude-sonnet-4-20250514 / deepseek-chat"' +
                    ' oninput="stAiSetModel(this.value)">' +
                '<datalist id="st-ai-model-list">' +
                    ids.map(id => '<option value="' + escapeHtml(id) + '"></option>').join('') +
                '</datalist>' +
                '</div>';
        }

