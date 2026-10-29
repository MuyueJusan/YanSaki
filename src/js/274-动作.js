        // ===== 动作 =====

        function stAiSetProvider(v) {
            if (!ST_AI_PROVIDERS.some(p => p.value === v)) return;
            stAi.provider = v;
            stAiSave();
            stAiRepaint();
        }

        function stAiSetProto(v) {
            stAi.proto = (v === 'openai' || v === 'anthropic') ? v : '';
            stAiSave();
            stAiRepaint();
        }

        function stAiSetBase(v) { stAi.baseUrl = String(v == null ? '' : v); stAiSave(); }
        function stAiSetKey(v) { stAi.apiKey = String(v == null ? '' : v); stAiSave(); }
        function stAiSetModel(v) { stAi.model = String(v == null ? '' : v); stAiSave(); stAiRefreshCfgStatus(); }

        // 「第一段」：只写状态不重画 —— 这是一个一个字敲的文本框，
        // 重画会把光标顶掉（同 stAiUiSet 那条规矩）
        function stAiSetFirstSeg(v) {
            // 跟随模式下这一格是只读镜像，写进去也只会在下次刷新时被覆盖掉
            if (stAi.mode !== 'own') return;
            stAi.firstSeg = String(v == null ? '' : v);
            stAiSave();
        }

        function stAiSetNum(k, v) {
            if (k === 'temperature') stAi.temperature = stAiNum(v, 0.8, 0, 2);
            else if (k === 'maxTokens') stAi.maxTokens = Math.trunc(stAiNum(v, 4096, 64, 32000));
            stAiSave();
        }

        function stAiSetBool(k, v) {
            if (k === 'stream') stAi.stream = v === true;
            stAiSave();
        }

        // 只刷那条状态行，不整页重画 —— 模型名是在输入框里一个字一个字敲的
        function stAiRefreshCfgStatus() {
            const el = document.getElementById('st-ai-cfg-status');
            if (!el) return;
            const cfg = stAiCfg();
            const ready = stAiReady(cfg);
            el.className = 'st-ai-status' + (ready.ok ? ' st-ok' : ' st-warn');
            el.textContent = '当前生效：' + stAiModeLabel(cfg) +
                ' · 协议 ' + (ST_AI_PROTO_LABEL[cfg.proto] || cfg.proto) +
                (ready.ok ? '' : '\n⚠ ' + ready.why);
        }

        function stAiBusyBtn(id, busy, busyText, idleText) {
            const b = document.getElementById(id);
            if (!b) return;
            b.disabled = !!busy;
            b.textContent = busy ? busyText : idleText;
        }

        function stAiSetStatus(msg, cls) {
            const el = document.getElementById('st-ai-cfg-status');
            if (el) {
                el.className = 'st-ai-status ' + (cls || '');
                el.textContent = msg;
            }
        }

        async function stAiPullModels() {
            const cfg = stAiCfg();
            // needModel: false —— 这一步就是为了挑模型，不能要求先有模型
            const ready = stAiReady(cfg, { needModel: false });
            if (!ready.ok) { stAiSetStatus('⚠ ' + ready.why, 'st-warn'); return; }
            stAiBusyBtn('st-ai-pull-btn', true, '⏳ 获取中…', '🔄 获取模型列表');
            stAiSetStatus('⏳ 正在向 ' + cfg.baseUrl + '/models 要模型列表…', '');
            try {
                const ids = await stAiFetchModels(cfg);
                stAi.models = ids.slice(0, 500);
                if (!stAi.model && ids.length) stAi.model = ids[0];
                stAiSave();
                stAiSetStatus('✅ 拿到 ' + ids.length + ' 个模型' +
                    (cfg.mode === 'own' ? '，模型输入框旁边可以挑' : '。跟随模式下请点主页的【🔌 API 全局配置】按钮选模型。'), 'st-ok');
                stAiRepaint();
            } catch (e) {
                stAiSetStatus('❌ 获取模型失败：' + stAiErrText(e), 'st-bad');
            } finally {
                stAiBusyBtn('st-ai-pull-btn', false, '', '🔄 获取模型列表');
            }
        }

        async function stAiTestConn() {
            const cfg = stAiCfg();
            const ready = stAiReady(cfg);
            if (!ready.ok) { stAiSetStatus('⚠ ' + ready.why, 'st-warn'); return; }
            stAiBusyBtn('st-ai-test-btn', true, '⏳ 测试中…', '🧪 测试连接');
            stAiSetStatus('⏳ 正在发一条「只回 OK」的测试请求…', '');
            try {
                const t0 = Date.now();
                const out = await stAiChat([
                    { role: 'system', content: '你是一个连接测试。只回复两个字符：OK' },
                    { role: 'user', content: 'ping' }
                ], { cfg: cfg, stream: false, maxTokens: 32, temperature: 0, timeout: 30000 });
                stAiSetStatus('✅ 连接成功（' + ((Date.now() - t0) / 1000).toFixed(1) + ' 秒）' +
                    ' 模型回了：' + String(out || '').trim().slice(0, 60) + stAiUsageSuffix(), 'st-ok');
            } catch (e) {
                stAiSetStatus('❌ 连接失败：' + stAiErrText(e), 'st-bad');
            } finally {
                stAiBusyBtn('st-ai-test-btn', false, '', '🧪 测试连接');
            }
        }

        function stAiClearOwn() {
            stAi = Object.assign({}, ST_AI_DEFAULTS, { mode: 'own' });
            stAiSave();
            stAiRepaint();
        }

        async function stAiExpandRun() {
            if (stAiUi.exRunning) return;
            const cfg = stAiCfg();
            const ready = stAiReady(cfg);
            stAiUi.exErr = '';
            stAiUi.exMsg = '';
            if (!ready.ok) { stAiUi.exErr = ready.why; stAiUi.exOpen = true; stRerender(); return; }
            const plan = stAiExpandPlan();
            stAiUi.exRunning = true;
            stAiUi.exOpen = true;
            stAiUi.exPreview = null;
            stAiUi.exRaw = '';
            stRerender();
            try {
                const text = await stAiChat(stAiPlanMessages(plan),
                    { cfg: cfg, temperature: cfg.temperature, maxTokens: Math.max(1024, cfg.maxTokens) });
                stAiUi.exRaw = text;
                const j = stAiJsonOf(text);
                if (!j.ok) throw new Error('模型没返回合法 JSON（' + j.error + '）。可以点「复制原始回复」看看它到底说了什么。');
                const arr = stAiPickArray(j.value, ['entries', 'items', 'list', 'data']);
                if (!arr || !arr.length) throw new Error('回复里的 JSON 没有条目数组（没有 entries）。');
                const list = arr.map(stAiEntryFromAi).filter(Boolean);
                if (!list.length) throw new Error('解析出来的条目全是空的（没正文也没关键词）。');
                stAiUi.exPreview = list;
                // 用量挂在状态行上。条数对不上时跟那句话拼成一句，别两行
                stAiUi.exMsg = stAiUsageWith(list.length !== plan.count
                    ? '要了 ' + plan.count + ' 条，模型给了 ' + list.length + ' 条。'
                    : '');
            } catch (e) {
                stAiUi.exErr = stAiErrText(e);
            } finally {
                stAiUi.exRunning = false;
                stRerender();
            }
        }

        function stAiExpandApply() {
            const list = stAiUi.exPreview || [];
            if (!list.length) return;
            const a = stEditor.card.bookEntries;
            list.forEach(e => a.push(e));
            stAiUi.exPreview = null;
            stAiUi.exRaw = '';
            stAiUi.exMsg = '已加入 ' + list.length + ' 条，现在共 ' + a.length + ' 条。';
            stEditor.dirty = true;
            stSaveDraft();
            stRerender();
            const el = document.getElementById('st-entry-' + (a.length - 1));
            if (el) {
                el.open = true;
                try { el.scrollIntoView({ block: 'nearest' }); } catch (e) {}
            }
        }

        function stAiExpandClear() {
            stAiUi.exPreview = null;
            stAiUi.exRaw = '';
            stAiUi.exErr = '';
            stAiUi.exMsg = '已丢弃这一批结果。';
            stAiRepaint();
        }

