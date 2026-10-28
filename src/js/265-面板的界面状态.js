        // —— 面板的界面状态 ——
        // 这里装的全是「参数」，没有一个是卡片数据。跟着面板走、不进卡、不进草稿。
        // 单独抽出来是因为 stRerender() 会把整个 pane 的 innerHTML 重建一遍 ——
        // 输入框的值必须从状态里读回来，否则用户敲一半就没了
        let stAiUi = {
            // —— 世界书扩写 ——
            exOpen: false,
            exReq: ['detail'],
            exReqFree: '',
            exSource: 'card',      // card = 角色卡设定 / book = 已有世界书 / free = 自由输入
            exFree: '',
            exKeepBook: true,      // 把已有条目也喂给模型，让它别写重复的
            exCount: 3,
            exMood: 'auto',
            exMoodFree: '',
            exFormat: 'plain',
            exDepth: 4,
            exRunning: false,
            exErr: '',
            exMsg: '',
            exRaw: '',
            exPreview: null,
            // —— 开场白生成 ——
            grOpen: false,
            grCount: 1,
            grMood: 'auto',
            grMoodFree: '',
            grLen: 600,
            grExtra: '',
            grIncOff: false,       // 要不要把「已停用」的世界书条目也算进去
            grTarget: 'main',      // main = 覆盖主开场白 / alt = 追加为备选
            grShowInject: false,
            grRunning: false,
            grErr: '',
            grMsg: '',
            grRaw: '',
            grPreview: null,
            // —— 单条改写（世界书页里，每一条条目自己的那个面板）——
            // 跟上面的批量新增是两回事，所以另开一组 en*。混用一套的话，
            // 用户从「新增 3 条」切到「改写这一条」，会发现条数设置被莫名带过来。
            enOpenId: '',        // 哪一条的 AI 面板是展开的。**存 id 不存下标** ——
                                 // 上下移动 / 删除条目时下标会漂，展开的会跳到别人身上
            enReq: ['detail'],
            enReqFree: '',
            enMood: 'auto',
            enMoodFree: '',
            enFormat: 'plain',
            enRef: true,         // 参考其他世界书条目
            enRefScope: 'on',    // on = 仅启用 / all = 全部 / same = 同分组
            enKeepMeta: true,    // 只改正文，保留原关键词 / 位置 / 深度 / 顺序
            enRunning: false,
            enRunId: '',         // 这次生成 / 这份原始回复属于哪一条
            enErr: '',
            enErrId: '',         // 错误属于哪一条 —— 不记的话，A 报的错会挂在 B 的面板上
            enMsg: '',
            enMsgId: '',
            enRaw: '',
            enPreview: null      // { id, entry }
        };

        stAiLoad();
        stAiLoadUi();

        // 只写状态，不重画 —— 给输入框用，重画会把光标顶掉
        function stAiUiSet(k, v) {
            if (!(k in stAiUi)) return;
            stAiUi[k] = v;
            stAiSaveUi();
        }

        // 写状态并重画 —— 给「会让布局变样」的控件用（换来源要换输入框、
        // 勾上「包含停用条目」注入预览要重排）
        function stAiUiSetR(k, v) {
            if (!(k in stAiUi)) return;
            stAiUi[k] = v;
            stAiRepaint();
        }

        function stAiRepaint() {
            stAiSaveUi();
            stRerender();
        }

        function stAiReqToggle(id) {
            const i = stAiUi.exReq.indexOf(id);
            if (i >= 0) stAiUi.exReq.splice(i, 1); else stAiUi.exReq.push(id);
            stAiRepaint();
        }

        function stAiSourcePick(id) {
            stAiUi.exSource = (id === 'book' || id === 'free') ? id : 'card';
            stAiRepaint();
        }

        function stAiMoodPick(key, id) {
            if (key !== 'exMood' && key !== 'grMood' && key !== 'enMood') return;
            stAiUi[key] = id;
            stAiRepaint();
        }

        function stAiFormatPick(id) {
            if (!ST_AI_FORMAT_PRESETS.some(p => p.id === id)) return;
            stAiUi.exFormat = id;
            stAiRepaint();
        }

        // 单条改写用的是自己那套参数（enFormat），不能借 stAiFormatPick ——
        // 那个写死了 exFormat，点一下会把批量面板的格式一起改掉
        function stAiEnFormatPick(id) {
            if (!ST_AI_FORMAT_PRESETS.some(p => p.id === id)) return;
            stAiUi.enFormat = id;
            stAiRepaint();
        }

        function stAiRefPick(id) {
            if (id !== 'on' && id !== 'all' && id !== 'same') return;
            stAiUi.enRefScope = id;
            stAiRepaint();
        }

        function stAiModePick(id) {
            stAi.mode = (id === 'own') ? 'own' : 'follow';
            stAiSave();
            stAiRepaint();
        }

        function stAiTargetPick(id) {
            stAiUi.grTarget = (id === 'alt') ? 'alt' : 'main';
            stAiRepaint();
        }

