        // ===== 开场白 =====

        function stPaneGreet() {
            const c = stEditor.card;
            const alts = c.alternateGreetings;
            return stPaneHead('💬 开场白',
                '主开场白是 <code>first_mes</code>，备选是 <code>alternate_greetings</code>。' +
                '酒馆模式导入这张卡后，开场白下拉里就能在这几条之间切换。' +
                '<code>group_only_greetings</code> 只有群聊会用，本应用不消费，但会原样写进 V3 卡里。') +
                stAiGreetPanel() +
                '<div class="st-grid">' +
                    stArea('主开场白 first_mes', 'card.firstMes', {
                        id: 'first', rows: 10, tall: true,
                        ph: '角色的第一句话。可以带 *动作描写* 和 {{user}} / {{char}}'
                    }) +
                '</div>' +
                '<div class="st-sub">备选开场白（' + alts.length + ' 条）</div>' +
                (alts.length
                    ? alts.map((g, i) =>
                        '<div class="st-field st-wide" style="margin-bottom:8px">' +
                            '<label for="st-alt-' + i + '">备选 ' + (i + 1) +
                                '<span class="st-greet-num">' + String(g).length + ' 字</span></label>' +
                            '<textarea id="st-alt-' + i + '" rows="5"' +
                                ' oninput="stSetGreeting(' + i + ',this.value)">' +
                                escapeHtml(g) + '</textarea>' +
                            '<div class="st-row" style="margin-top:5px">' +
                                '<button class="st-mini" type="button" onclick="stMoveGreeting(' + i + ',-1)"' +
                                    (i === 0 ? ' disabled' : '') + '>↑</button>' +
                                '<button class="st-mini" type="button" onclick="stMoveGreeting(' + i + ',1)"' +
                                    (i === alts.length - 1 ? ' disabled' : '') + '>↓</button>' +
                                '<button class="st-mini st-danger" type="button" onclick="stDelGreeting(' + i + ')">✕ 删除</button>' +
                            '</div>' +
                        '</div>').join('')
                    : '<div class="st-empty">还没有备选开场白。</div>') +
                '<div class="st-actions">' +
                    '<button class="st-big" type="button" onclick="stAddGreeting()">✚ 添加备选开场白</button>' +
                '</div>' +
                (c.spec === 'v3'
                    ? '<div class="st-sub">群聊专用开场白（' + c.groupOnlyGreetings.length + ' 条）</div>' +
                      (c.groupOnlyGreetings.length
                          ? c.groupOnlyGreetings.map((g, i) =>
                              '<div class="st-field st-wide" style="margin-bottom:8px">' +
                                  '<label for="st-go-' + i + '">群聊开场白 ' + (i + 1) + '</label>' +
                                  '<textarea id="st-go-' + i + '" rows="4"' +
                                      ' oninput="stSetList(' + "'card.groupOnlyGreetings'" + ',' + i + ',this.value)">' +
                                      escapeHtml(g) + '</textarea>' +
                                  '<div class="st-row" style="margin-top:5px">' +
                                      '<button class="st-mini st-danger" type="button" onclick="stDelListItem(' +
                                          "'card.groupOnlyGreetings'" + ',' + i + ')">✕ 删除</button>' +
                                  '</div>' +
                              '</div>').join('')
                          : '<div class="st-empty">还没有。</div>') +
                      '<div class="st-actions">' +
                          '<button class="st-big" type="button" onclick="stAddListItem(' +
                              "'card.groupOnlyGreetings'" + ')">✚ 添加群聊开场白</button>' +
                      '</div>'
                    : '');
        }

