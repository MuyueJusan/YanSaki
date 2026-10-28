        // —— 项目记忆 ——
        // 条数与字数都**现数**，不另存一份计数 —— 多一个字段就多一处能对不上的地方
        function stCodeMemoCount() {
            return String(stCode.memo || '').split('\n').filter(x => x.trim()).length;
        }

        function stCodeMemoChars() {
            return String(stCode.memo || '').length;
        }

        // 折叠条上那句话**只有这一处** —— 首次渲染（`stCodeBarHtml` 里）和输入时更新都从这来。
        // ⚠ 原来这两处各写各的（`'📝 记忆 (' + stCodeMemoCount() + ')'` 出现了两遍），
        //   改一处忘一处的话，重画之后会跳回旧格式，而且没人看得出来
        function stCodeMemoLabel() {
            return '📝 记忆 (' + stCodeMemoCount() + ' 条 · ' + stCodeMemoChars() +
                '/' + ST_CODE_MEMO_CHARS + ' 字)';
        }

        // 计数器那个方框的「类 + 文案」也只有这一处 —— 同理
        function stCodeMemoCounter() {
            const c = stCodeMemoChars();
            if (c >= ST_CODE_MEMO_CHARS) {
                return {
                    cls: 'st-note st-bad',
                    text: '⚠ 已到上限 ' + ST_CODE_MEMO_CHARS + ' 字，再写不会保存 —— 请先删掉几条'
                };
            }
            return { cls: 'st-note', text: '已用 ' + c + ' / ' + ST_CODE_MEMO_CHARS + ' 字' };
        }

        // 更新两处：折叠条上的摘要 + 展开后 textarea 下面那个计数器
        // ⚠ 折叠起来时看不见计数器，所以**摘要上也要带字数** ——
        //   「还剩多少」正是决定要不要先删几条的信息
        function stCodeMemoSum() {
            const sum = document.getElementById('st-code-memo-sum');
            if (sum) sum.textContent = stCodeMemoLabel();
            const cnt = document.getElementById('st-code-memo-count');
            if (!cnt) return;
            const k = stCodeMemoCounter();
            cnt.className = k.cls;
            cnt.textContent = k.text;
        }

        // 只换记忆那一块。⚠ 同理不重画整个 pane —— textarea 会被换掉，光标当场丢
        function stCodeMemoRefresh() {
            const ta = document.getElementById('st-code-memo');
            // 正在里面打字就别去动它（模型追加记忆时用户可能正写着）
            if (ta && document.activeElement !== ta) ta.value = String(stCode.memo || '');
            stCodeMemoSum();
        }

        // 输入时**只存不重画** —— 和 stCodeDraftSet 一个道理
        // ⚠ 真正拦住「写超了」的是 textarea 上的 `maxlength`（敲满就敲不动 = 当场能看见）。
        //   这里的 slice 只是**兜底**。⚠ 只留 slice 的话，用户敲满之后还能继续敲，
        //   敲进去的字全被悄悄丢掉、界面上一个字都不提示 —— 那正是「静默截断」，
        //   和 `remember` 那条路（满了**拒绝**并回一句人话）不一致
        function stCodeMemoSet(v) {
            stCode.memo = String(v == null ? '' : v).slice(0, ST_CODE_MEMO_CHARS);
            stCodeSaveMemo();
            stCodeMemoSum();
        }

        function stCodeMemoClear() {
            if (!String(stCode.memo || '').trim()) return;
            if (!window.confirm('清空全部项目记忆？这个动作不能撤销。')) return;
            stCode.memo = '';
            stCodeSaveMemo();
            stCodeMemoRefresh();
            stCodeFlash('项目记忆已清空。');
        }

        function stCodeMemoPopHtml() {
            const n = stCodeMemoCount(), k = stCodeMemoCounter();
            return '<div class="st-sub">项目记忆' + (n ? '（' + n + ' 条）' : '') + '</div>' +
                '<textarea id="st-code-memo" class="st-code-memo"' +
                    // ⚠ `maxlength` 是**第一道闸**：写满就写不动了，用户当场就知道到顶了。
                    //   光靠 stCodeMemoSet 里那个 slice 是**静默**的 —— 敲进去的字全丢、零提示
                    ' maxlength="' + ST_CODE_MEMO_CHARS + '"' +
                    // 属性里的换行要写成 &#10;，直接写 \n 在部分浏览器里会丢
                    ' placeholder="一行一条，比如：&#10;改完必须跑一遍验证套件&#10;注释用中文，讲为什么"' +
                    ' oninput="stCodeMemoSet(this.value)">' + escapeHtml(stCode.memo) + '</textarea>' +
                // 字数计数器。首次渲染就带上内容（这一块没有 post-paint 钩子），
                // 之后由 stCodeMemoSum() 就地更新 —— 两边共用 stCodeMemoCounter()
                '<div class="' + k.cls + '" id="st-code-memo-count">' + k.text + '</div>' +
                '<div class="st-actions" style="margin-top:8px">' +
                    (n ? '<button class="st-mini" type="button" onclick="stCodeMemoClear()">清空</button>' : '') +
                '</div>' +
                '<div class="st-note">每次发消息都会把这段放进 system，并标明' +
                '<b>优先于通用做法</b>。<br>' +
                '也可以直接对 Agent 说「记住…」，它会用 <code>remember</code> 工具追加一条。<br>' +
                '存在本机浏览器里，<b>不进角色卡</b>。</div>';
        }

        // 改一个 skill 的触发词。**不重画** —— 用户正在这个输入框里打字
        function stCodeSkillTrigSet(name, v) {
            const key = String(name || '');
            const sk = stCode.skills.filter(s => s.name === key)[0];
            if (!sk) return;
            sk.triggers = stCodeTrigList(v);
            stCodeSaveSkills();
        }

        function stCodeSkillPopHtml() {
            const busy = !!stCode.skillBusy;
            let h = '<div class="st-sub">导入的 skill</div>';

            // —— 从链接导入 ——
            // ⚠ 取链接的是**页面**，不是模型。模型没有网络能力（见 fetch_url 工具的描述），
            //   而且它也不该替你决定往本机装什么 —— 导入是用户的动作
            h += '<div class="st-code-url">' +
                '<input type="text" id="st-code-skill-url" value="' + escapeHtml(stCode.skillUrl) + '"' +
                    ' placeholder="SKILL.md 直链，或 GitHub 仓库 / 目录链接"' +
                    ' oninput="stCodeSkillUrlSet(this.value)"' +
                    ' onkeydown="if(event.key===\'Enter\'){event.preventDefault();stCodeImportUrl();}">' +
                '<button class="st-code-btn" type="button"' + (busy ? ' disabled' : '') +
                    ' onclick="stCodeImportUrl()">' + (busy ? '取回中…' : '从链接导入') + '</button>' +
                '</div>' +
                '<div class="st-note">支持：单个 <code>SKILL.md</code> / 工具型 <code>.js</code> 的地址、' +
                'GitHub 仓库或目录链接' +
                '（仓库链接会走公开接口列出所有 SKILL.md，未登录限流 60 次/小时；' +
                '单个文件的直链不走这个限额）。<br>' +
                '<b>也可以把 <code>.md</code> / <code>.js</code> 文件或整个文件夹拖进这个面板。</b></div>';

            if (stCode.skillErr) {
                h += '<div class="st-code-skill-msg st-bad">' + escapeHtml(stCode.skillErr) + '</div>';
            }
            if (stCode.skillMsg) {
                h += '<div class="st-code-skill-msg">' + escapeHtml(stCode.skillMsg) + '</div>';
            }

            if (!stCode.skills.length) {
                h += '<div class="st-note" style="margin-top:8px">还没导入。' +
                    '选目录的时候要选 <b>skills 的上一层</b>（里面每个子目录放一个 SKILL.md）。</div>';
            } else {
                const autoNames = (stCodeSession().autoSkills || []);
                h += stCode.skills.map(sk => {
                    const isAuto = autoNames.indexOf(sk.name) >= 0;
                    const isTool = sk.kind === 'tool' && sk.tool;
                    const tg = (Array.isArray(sk.triggers) && sk.triggers.length)
                        ? sk.triggers.join(', ') : '';
                    // 它申请到了哪些能力。⚠ 「能改卡」必须显眼 —— 用户装它时点的那一下
                    //   就是「同意它改我的卡」，之后在列表里也得一眼能认出哪个动过手
                    const perms = isTool ? stCodeSkillPermsOf(sk) : [];
                    // ⚠ `progress` **不在 stCodePermToolNames 里** —— 它不映射任何
                    //   内置工具，所以按工具名拼那句话会漏掉它，然后申请了进度的 skill
                    //   在面板上显示成「读不到卡」，用户会以为它什么都做不了
                    const canProg = perms.indexOf('progress') >= 0;
                    const toolNames = stCodePermToolNames(perms);
                    return '<div class="st-code-skill">' +
                        '<div style="flex:1 1 auto;min-width:0">' +
                            '<div class="st-code-skill-n">' + escapeHtml(sk.name) +
                                (isAuto ? '<span class="st-code-skill-on">已加载</span>' : '') +
                                (isTool ? '<span class="st-code-skill-on">🧰 工具</span>' : '') +
                                (perms.indexOf('card.write') >= 0
                                    ? '<span class="st-code-skill-on st-code-skill-warn">✏️ 能改卡</span>'
                                    : '') +
                                (canProg
                                    ? '<span class="st-code-skill-on">⏳ 能报进度</span>' : '') + '</div>' +
                            '<div class="st-code-skill-d">' + escapeHtml(sk.desc || '(无描述)') +
                                (isTool ? '（工具名 ' + escapeHtml(sk.tool.name) + '）' : '') + '</div>' +
                            (toolNames.length
                                ? '<div class="st-code-skill-d">沙盒里能调：' +
                                    escapeHtml(toolNames.join('、')) + '</div>'
                                : (isTool
                                    ? '<div class="st-code-skill-d">' +
                                        (canProg
                                            ? '纯算自己的东西，读不到卡；只能往界面上报进度'
                                            : '纯算自己的东西，读不到卡（MANIFEST 里没申请 ' +
                                              '<code>card.read</code> / <code>card.write</code>）') +
                                        '</div>'
                                    : '')) +
                            // 触发词输入框。⚠ oninput 里**只存不重画** ——
                            //   重画会把用户正在打字的这个输入框换掉，光标当场丢。
                            // ⚠ 工具型 skill **不给这个框** —— 它的 body 是源码，
                            //   没有「正文进上下文」这回事，给了就是个没有作用的控件
                            (isTool ? '' :
                                '<input type="text" class="st-code-trig" value="' + escapeHtml(tg) + '"' +
                                ' placeholder="触发词，逗号分隔；留空就用名字"' +
                                ' oninput="stCodeSkillTrigSet(\'' + stCodeAttr(sk.name) +
                                '\', this.value)">') +
                        '</div>' +
                        '<button class="st-code-btn st-tiny st-danger" type="button" onclick="stCodeSkillDrop(\'' +
                            stCodeAttr(sk.name) + '\')">移除</button>' +
                        '</div>';
                }).join('');
            }

            h += '<div class="st-actions" style="margin-top:8px">' +
                '<button class="st-mini" type="button" onclick="stCodePickSkillDir()">📁 导入目录</button>' +
                '<button class="st-mini" type="button" onclick="stCodePickSkills()">📄 选文件</button>' +
                (stCode.skills.length
                    ? '<button class="st-mini" type="button" onclick="stCodeSkillClear()">清空</button>' : '') +
                '</div>' +
                '<div class="st-note">skill 存在本机浏览器里（IndexedDB），<b>不进角色卡</b>。<br>' +
                '说话命中触发词的 skill 会<b>自动把正文装进上下文</b>（面板上标「已加载」）；' +
                '其余的 Agent 用 <code>list_skills</code> / <code>read_skill</code> 自己取。<br>' +
                '想强制加载就写 <code>@skill 名字</code>。<br>' +
                '<b>工具型 skill</b>（带 <code>/*!MANIFEST*/</code> 的 <code>.js</code>，' +
                '面板上标 🧰）是另一回事：它<b>注册成一个工具</b>，模型直接调，跑在沙盒里。' +
                '默认<b>摸不到卡、也上不了网</b>；在 MANIFEST 里申请 <code>card.read</code> / ' +
                '<code>card.write</code> 才能在沙盒里读卡 / 改卡 —— ' +
                '<b>权限是导入那一刻定的</b>，运行时不会临时给。' +
                '标了 <b>✏️ 能改卡</b> 的，装它时你点的那一下就是同意它改你的卡。<br>' +
                '申请 <code>progress</code> 的话，它能在跑的过程中用 ' +
                '<code>host.progress("第 3 / 20 条…")</code> 往消息流下面<b>报一行进度</b>；' +
                '没申请的话那句话直接被丢掉（不报错）。</div>' +
                // 格式给一份能直接抄的 —— 只说「要写 manifest」的话，
                // 写 skill 的人还得去别处找长什么样
                '<details class="st-code-menu"><summary>🧰 工具型 skill 长什么样</summary>' +
                '<div class="st-note" style="margin-top:6px">一个 <code>.js</code>，' +
                '<b>开头</b>写一段 MANIFEST 注释，下面定义一个 <code>run(args)</code>：' +
                '<pre style="white-space:pre-wrap;margin:6px 0 0">' +
                escapeHtml('/*!MANIFEST {"name":"count_blocks","description":"数一下状态栏里有几个块。",\n' +
                    '  "parameters":{"type":"object","properties":{}},\n' +
                    '  "perm":["card.read","progress"]}\n' +
                    '}!*/\n' +
                    'async function run(args) {\n' +
                    '  host.progress("正在读状态栏…");\n' +
                    '  var html = await host.call("read_doc", { kind: "statusbar" });\n' +
                    '  return "状态栏里大约有 " + (html.match(/<div/g) || []).length + " 个 div";\n' +
                    '}') +
                '</pre>' +
                '⚠ <code>name</code> 只能用英文字母 / 数字 / 下划线 / 连字符（两套模型协议都是这么要求的），' +
                '而且不能和内置工具重名。<code>description</code> 是模型决定要不要用它的唯一依据。<br>' +
                '要返回值就 <code>return</code>；异步就返回 Promise。<br>' +
                '<b>想读卡 / 改卡</b>：MANIFEST 里写 <code>"perm":["card.read"]</code> 或 ' +
                '<code>["card.write"]</code>，然后在 <code>run</code> 里 ' +
                '<code>await host.call("read_card", {})</code>。<br>' +
                '<code>card.read</code> → read_card / read_doc / read_regex / read_th / ' +
                'list_world_entries / read_world_entry；<br>' +
                '<code>card.write</code> → write_text / write_list / 世界书增删改 / write_doc / ' +
                'write_regex / write_th。<br>' +
                '没申请的能力<b>调不动</b>（导入时就拒，不会装作给了）；一次 run 最多调 ' +
                '<code>' + ST_CODE_SANDBOX_RPC_MAX + '</code> 次。<br>' +
                '<b>联网？做不到</b> —— 沙盒连网都断的，也<b>不给</b> <code>fetch_url</code>' +
                '（不然它能把刚读到的卡发到任意公网地址）。<br>' +
                '<b>跑很久想让人看见</b>：申请 <code>"perm":["progress"]</code>，' +
                '然后 <code>host.progress("第 3 / 20 条")</code> —— ' +
                '<b>不用 await</b>（它没有返回值，就是喊一声），界面消息流下面会实时换那一行。' +
                '不申请的话这句话直接丢掉、不报错。' +
                '太快会被丢（至少隔 ' + ST_CODE_PROG_MS + 'ms 一次，一次 run 最多 ' +
                ST_CODE_PROG_MAX + ' 次）—— 别放在循环最里面。' +
                '</div></details>';
            return h;
        }

        function stCodeHistPopHtml() {
            if (!stCode.sessions.length) return '<div class="st-note">还没有历史会话。</div>';
            const now = Date.now();
            return '<div class="st-sub">本机保存的会话</div>' +
                stCode.sessions.map(s =>
                    '<div class="st-code-hist' + (s.id === stCode.sessionId ? ' st-on' : '') + '">' +
                    '<div class="st-code-hist-t">' +
                        '<div class="st-code-hist-n">' + escapeHtml(s.title || '未命名会话') + '</div>' +
                        '<div class="st-code-hist-s">' + escapeHtml(stCodeWhen(s.ts, now)) + ' · ' +
                            ((s.msgs || []).length) + ' 条消息</div>' +
                    '</div>' +
                    (s.id === stCode.sessionId ? '' :
                        '<button class="st-code-btn st-tiny" type="button" onclick="stCodeOpenSession(\'' +
                        stCodeAttr(s.id) + '\')">打开</button>') +
                    '<button class="st-code-btn st-tiny st-danger" type="button" onclick="stCodeDropSession(\'' +
                        stCodeAttr(s.id) + '\')">删</button>' +
                    '</div>'
                ).join('') +
                '<div class="st-note">会话存在本机浏览器里（localStorage），最多留 ' +
                ST_CODE_MAX_SESS + ' 个。' + (stCode.sessions.length >= ST_CODE_MAX_SESS
                    ? '已经到上限了，新建会挤掉最老的那个。' : '') + '</div>';
        }

        function stCodeThinkPopHtml() {
            return '<div class="st-sub">思维强度</div>' +
                ST_CODE_THINK.map(t =>
                    '<div class="st-code-hist' + (t.id === stCode.think ? ' st-on' : '') + '">' +
                    '<div class="st-code-hist-t">' +
                        '<div class="st-code-hist-n">' + t.ico + ' ' + t.label +
                            ' <span style="font-weight:normal;color:#6b8497">最多 ' + t.steps + ' 步工具</span></div>' +
                        '<div class="st-code-hist-s">' + escapeHtml(t.tip) + '</div>' +
                    '</div>' +
                    (t.id === stCode.think ? '' :
                        '<button class="st-code-btn st-tiny" type="button" onclick="stCodeThinkSet(\'' +
                        stCodeAttr(t.id) + '\')">用这个</button>') +
                    '</div>'
                ).join('') +
                '<div class="st-note">强度只改 system 里「怎么做」那段的措辞和步数上限，' +
                '**不动 temperature** —— 换个强度就换个写法那不叫强度。</div>' +
                '<div class="st-sub" style="margin-top:10px">其它</div>' +
                '<label class="st-check"><input type="checkbox"' + (stCode.autoApply ? ' checked' : '') +
                    ' onchange="stCodeAutoApply(this.checked)"> 工具真的改卡（关掉 = 只演示不写）</label>' +
                // 「第一段」开关。文本**不在这里编辑** —— 那是【AI 助手】页那一格，
                // 一页存两处迟早分叉（谁都不知道该信哪边）
                '<label class="st-check"><input type="checkbox"' + (stCode.useFirstSeg ? ' checked' : '') +
                    ' onchange="stCodeUseFirstSeg(this.checked)"> 带上「第一段」</label>' +
                (stCode.useFirstSeg
                    ? '<div class="st-note">' + (String(stAiCfg().firstSeg || '').trim()
                        ? '第一段会作为<b>最前面</b>的 system 发出去（' +
                          String(stAiCfg().firstSeg || '').trim().length + ' 字）。' +
                          '内容在【AI 助手】页的「第一段」里改 —— 两边共用同一段。'
                        : '⚠ 已经打开，但【AI 助手】页那段是<b>空的</b> —— 空的不会发出去。' +
                          '去那边填一段，或者把这个开关关掉。') + '</div>'
                    : '<div class="st-note">关着的时候发出去的就是<b>一条 system + 会话</b>，' +
                      '没有第一段（Code 页本来就是这样）。</div>');
        }

        function stCodeBarHtml() {
            const th = stCodeThink();
            const s = stCodeSession();
            return '<div class="st-code-bar">' +
                '<details class="st-code-menu"' + (stCode.open.skills ? ' open' : '') +
                    ' ontoggle="stCodeMenuToggle(\'skills\', this.open)">' +
                    '<summary>🧩 当前 skill 列表 (' + stCode.skills.length + ')</summary>' +
                    // 拖拽挂在**整个弹层**上：拖到面板的任何位置都算，不用瞄准那行按钮。
                    // ondragover 必须 preventDefault，否则浏览器不给触发 ondrop
                    '<div class="st-code-pop" id="st-code-skill-pop"' +
                        ' ondragover="stCodeDragOver(event)"' +
                        ' ondragleave="stCodeDragLeave(event)"' +
                        ' ondrop="stCodeDragDrop(event)">' + stCodeSkillPopHtml() + '</div>' +
                '</details>' +
                '<button class="st-code-btn st-main-btn" type="button" onclick="stCodeNewSession()">➕ 新会话</button>' +
                '<details class="st-code-menu"' + (stCode.open.hist ? ' open' : '') +
                    ' ontoggle="stCodeMenuToggle(\'hist\', this.open)">' +
                    '<summary>🕘 历史会话 (' + stCode.sessions.length + ')</summary>' +
                    '<div class="st-code-pop">' + stCodeHistPopHtml() + '</div>' +
                '</details>' +
                '<details class="st-code-menu"' + (stCode.open.think ? ' open' : '') +
                    ' ontoggle="stCodeMenuToggle(\'think\', this.open)">' +
                    '<summary>' + th.ico + ' 思维强度：' + th.label + '</summary>' +
                    '<div class="st-code-pop st-code-pop-r">' + stCodeThinkPopHtml() + '</div>' +
                '</details>' +
                '<details class="st-code-menu"' + (stCode.open.memo ? ' open' : '') +
                    ' ontoggle="stCodeMenuToggle(\'memo\', this.open)">' +
                    '<summary id="st-code-memo-sum">' + stCodeMemoLabel() + '</summary>' +
                    '<div class="st-code-pop st-code-pop-r">' + stCodeMemoPopHtml() + '</div>' +
                '</details>' +
                '<span class="st-code-stat" id="st-code-flash"></span>' +
                '<span class="st-code-grow"></span>' +
                (stCode.trash.length
                    ? '<button class="st-code-btn" type="button" onclick="stCodeUndoDelete()">↶ 撤回删除 (' +
                      stCode.trash.length + ')</button>' : '') +
                // 窄屏 / 竖屏才显示：在「Code」和「Agent」之间切
                '<div class="st-code-view">' +
                    '<button class="st-code-vbtn' + (stCode.view === 'card' ? ' st-on' : '') +
                        '" data-v="card" type="button" onclick="stCodeViewSet(\'card\')">📄 Code</button>' +
                    '<button class="st-code-vbtn' + (stCode.view === 'agent' ? ' st-on' : '') +
                        '" data-v="agent" type="button" onclick="stCodeViewSet(\'agent\')">💬 Agent</button>' +
                '</div>' +
            '</div>';
        }

        function stPaneCode() {
            const s = stCodeSession();
            return '<div class="st-code">' +
                stCodeBarHtml() +
                '<div class="st-code-split" id="st-code-split" data-view="' + stCodeAttr(stCode.view) + '">' +
                    '<div class="st-code-card">' +
                        '<div class="st-code-head"><b>📄 角色卡 JSON</b>' +
                            '<span class="st-code-grow"></span>' +
                            '<button class="st-code-btn st-tiny" type="button" onclick="stCodeCopyJson()">复制</button>' +
                        '</div>' +
                        '<pre class="st-code-json" id="st-code-json">' + stCodeJsonHtml() + '</pre>' +
                    '</div>' +
                    '<div class="st-code-agent">' +
                        '<div class="st-code-head"><b>💬 Agent 会话</b>' +
                            '<span class="st-code-stat">' + escapeHtml(s.title || '新会话') + '</span>' +
                            '<span class="st-code-grow"></span>' +
                            (stCode.running
                                ? '<button class="st-code-btn st-tiny st-danger" type="button" onclick="stCodeStop()">⏹ 停止</button>'
                                : '') +
                        '</div>' +
                        '<div class="st-code-log" id="st-code-log">' + stCodeLogHtml() + '</div>' +
                        // 任务清单夹在消息流和输入框中间：它既不是消息（不该跟着滚走），
                        // 也不该抢输入的注意力。空清单时这里什么都没有，不占位置
                        '<div id="st-code-tasks">' + stCodeTasksHtml() + '</div>' +
                        '<div class="st-code-foot">' +
                            '<textarea id="st-code-input" rows="2"' +
                                ' placeholder="让 Agent 改这张卡…（Ctrl+Enter 发送）"' +
                                ' oninput="stCodeDraftSet(this.value)"' +
                                ' onkeydown="stCodeKey(event)"></textarea>' +
                            '<button class="st-code-btn st-main-btn" type="button" id="st-code-send"' +
                                (stCode.running ? ' disabled' : '') +
                                ' onclick="stCodeSend()">发送</button>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                '<input type="file" id="st-code-skill-file" multiple accept=".md" style="display:none"' +
                    ' onchange="stCodeOnSkillsPicked(event)">' +
                '<input type="file" id="st-code-skill-dir" multiple webkitdirectory directory' +
                    ' style="display:none" onchange="stCodeOnSkillsPicked(event)">' +
            '</div>';
        }

