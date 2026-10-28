        // ===== 导出 =====

        function stPaneExport() {
            const c = stEditor.card;
            const warns = [];
            if (!String(c.name || '').trim()) warns.push('还没填角色名，导出时会写成「未命名角色」。');
            if (c.spec === 'v1') {
                const drops = [];
                if (c.bookEntries.length) drops.push('世界书');
                if (c.regex.length) drops.push('正则');
                if (c.thScripts.length) drops.push('酒馆助手脚本');
                if (c.alternateGreetings.length) drops.push('备选开场白');
                if (drops.length) warns.push('V1 装不下' + drops.join(' / ') + '，导出会丢掉。');
            }
            if (!stEditor.avatar) warns.push('没选头像 —— PNG 会画一张占位图（JSON 不受影响）。');
            if (c.regex.length) {
                warns.push('本应用不会执行正则脚本，它们只是被写进卡里。');
            }
            if (c.thScripts.length) {
                warns.push('本应用不会执行酒馆助手脚本，它们只是被写进卡里 —— ' +
                    '要跑得在装了酒馆助手的 SillyTavern 里。');
            }
            const json = stCardToStJson();
            const jsonText = JSON.stringify(json, null, 2);
            return stPaneHead('💾 导出',
                '写成 <b>PNG 角色卡</b>（卡数据塞在 <code>' +
                (c.spec === 'v3' ? 'ccv3' : 'chara') + '</code> 数据块里，SillyTavern 直接认）' +
                '或者 <b>JSON</b>（V1 / V2 / V3 都能选）。') +
                '<div class="st-sub">头像</div>' +
                '<div class="st-avatar-box">' +
                    (stEditor.avatar
                        ? '<img class="st-avatar-prev" alt="头像预览" src="' +
                          escapeHtml(stEditor.avatar) + '">'
                        : '<div class="st-avatar-prev"></div>') +
                    '<div>' +
                        '<div class="st-avatar-meta">' +
                            (stEditor.avatar
                                ? '已选：' + escapeHtml(stEditor.avatarName || '（没有文件名）') +
                                  '<br>大小约 ' + Math.round(stEditor.avatar.length / 1024) + ' KB'
                                : '还没选头像。不选也能导出 —— 会画一张 ' +
                                  ST_PLACEHOLDER_W + '×' + ST_PLACEHOLDER_H + ' 的占位图。') +
                            (stEditor.avatar && stEditor.avatar.length > ST_AVATAR_MAX
                                ? '<br><b>超过 ' + Math.round(ST_AVATAR_MAX / 1024) +
                                  ' KB，草稿不会把它存进浏览器存储，刷新后要重选。</b>'
                                : '') +
                        '</div>' +
                        '<div class="st-actions">' +
                            '<button class="st-mini" type="button" onclick="stPickAvatar()">📁 选择图片</button>' +
                            (stEditor.avatar
                                ? '<button class="st-mini st-danger" type="button" onclick="stClearAvatar()">✕ 清除</button>'
                                : '') +
                        '</div>' +
                    '</div>' +
                '</div>' +
                (warns.length
                    ? '<div class="st-note st-warn">' + warns.map(escapeHtml).join('<br>') + '</div>'
                    : '<div class="st-note">没有发现问题，可以直接导出。</div>') +
                '<div class="st-sub">导出</div>' +
                '<div class="st-actions">' +
                    '<button class="st-big" type="button" id="st-png-btn" onclick="stExportPng()">🖼 导出 PNG 角色卡</button>' +
                    '<button class="st-big st-plain" type="button" id="st-json-btn" onclick="stExportJson()">📄 导出 JSON</button>' +
                '</div>' +
                '<div class="st-note" id="st-export-note">' +
                    (stEditor.lastExport
                        ? '上次导出：' + escapeHtml(stEditor.lastExport)
                        : '这个会话里还没导出过。') +
                '</div>' +
                '<div class="st-sub">将要写入的 JSON（' + jsonText.length + ' 字符 · ' +
                    '约 ' + estimateTokens(jsonText) + ' tokens）</div>' +
                '<pre class="st-json" id="st-export-json">' + escapeHtml(jsonText) + '</pre>';
        }

