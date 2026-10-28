        // ===== 酒馆助手（JS-Slash-Runner）脚本 =====
        // 存在卡的 data.extensions.tavern_helper 里（扩展源码 settings.ts 的
        // setting_field = 'tavern_helper'）。形状照 type/scripts.ts 抄：
        //   Script = { type:'script', enabled, name, id, content, info,
        //              button:{enabled, buttons:[{name,visible}]},
        //              data:{}, export_with:{data,button} }
        //   Folder = { type:'folder', enabled, name, id, icon, color, scripts:[Script] }
        // 注意 Folder.scripts 装的是 Script 而不是 ScriptTree —— 文件夹不能再套文件夹，
        // 所以树最多两层。界面上也就只渲染两层。
        // 草稿里用 kind 区分（'script' / 'folder'），导出时再写成 type
        const ST_TH_FOLDER_ICON = 'fa-solid fa-folder';
        const ST_TH_FOLDER_COLOR = '#7b9fd4';

        function stBlankThScript() {
            return {
                kind: 'script',
                id: stUuid(),
                // ST 的 zod 默认是 false —— 新建的脚本本来就是关着的，要手动开
                enabled: false,
                name: '',
                content: '',
                info: '',
                buttonEnabled: true,
                buttons: [],
                // data 是个自由对象。界面上当 JSON 文本框编辑，存成字符串，
                // 导出时再解析回对象
                dataText: '{}',
                exportData: true,
                exportButton: true
            };
        }

        function stBlankThFolder() {
            return {
                kind: 'folder',
                id: stUuid(),
                enabled: true,
                name: '',
                icon: ST_TH_FOLDER_ICON,
                color: ST_TH_FOLDER_COLOR,
                scripts: []
            };
        }

        function stBlankThButton() {
            return { name: '', visible: true };
        }

        const stBool = v => v === true || v === 'true';

        function stThDataText(v) {
            if (v === undefined || v === null) return '{}';
            if (typeof v === 'string') return v;
            try { return JSON.stringify(v, null, 2); } catch (e) { return '{}'; }
        }

        // 解析失败返回 null，让调用方决定是退回 {} 还是报错
        function stThDataParse(text) {
            const t = String(text == null ? '' : text).trim();
            if (!t) return {};
            let o = null;
            try { o = JSON.parse(t); } catch (e) { return null; }
            if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
            return o;
        }

        // 一个读取器同时吃两种形状：卡里导出的原始 JSON（type / button / data / export_with），
        // 以及草稿里存过的（kind / buttonEnabled / dataText / exportData）。
        // 分成两个函数也行，但那样 localStorage 里存的老草稿就得多一条迁移路径
        function stThScriptFromRaw(x) {
            const s = stBlankThScript();
            if (!x || typeof x !== 'object' || Array.isArray(x)) return s;
            s.id = stStr(x.id) || s.id;
            s.enabled = stBool(x.enabled);
            s.name = stStr(x.name);
            s.content = stStr(x.content);
            s.info = stStr(x.info);
            const btn = (x.button && typeof x.button === 'object' && !Array.isArray(x.button))
                ? x.button : null;
            if (btn) {
                s.buttonEnabled = btn.enabled !== false;
                s.buttons = Array.isArray(btn.buttons) ? btn.buttons
                    .filter(b => b && typeof b === 'object')
                    .map(b => ({ name: stStr(b.name), visible: b.visible !== false })) : [];
            } else {
                s.buttonEnabled = x.buttonEnabled !== false;
                s.buttons = Array.isArray(x.buttons) ? x.buttons
                    .filter(b => b && typeof b === 'object')
                    .map(b => ({ name: stStr(b.name), visible: b.visible !== false })) : [];
            }
            s.dataText = (x.dataText !== undefined) ? stStr(x.dataText) : stThDataText(x.data);
            const ew = (x.export_with && typeof x.export_with === 'object' &&
                !Array.isArray(x.export_with)) ? x.export_with : null;
            if (ew) {
                s.exportData = ew.data !== false;
                s.exportButton = ew.button !== false;
            } else {
                s.exportData = x.exportData !== false;
                s.exportButton = x.exportButton !== false;
            }
            return s;
        }

        function stThFolderFromRaw(x) {
            const f = stBlankThFolder();
            if (!x || typeof x !== 'object' || Array.isArray(x)) return f;
            f.id = stStr(x.id) || f.id;
            f.enabled = x.enabled !== false;
            f.name = stStr(x.name);
            f.icon = stStr(x.icon) || f.icon;
            f.color = stStr(x.color) || f.color;
            f.scripts = Array.isArray(x.scripts)
                ? x.scripts.filter(s => s && typeof s === 'object').map(stThScriptFromRaw) : [];
            return f;
        }

        // 认 type 而不是猜字段；没写 type 的老数据按「有 scripts 数组就是文件夹」判
        function stThNodeFromRaw(x) {
            if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
            const t = stStr(x.type);
            if (t === 'folder') return stThFolderFromRaw(x);
            if (t === 'script') return stThScriptFromRaw(x);
            if (Array.isArray(x.scripts)) return stThFolderFromRaw(x);
            return stThScriptFromRaw(x);
        }

        function stThScriptToRaw(s) {
            return {
                type: 'script',
                enabled: !!s.enabled,
                name: s.name,
                id: s.id,
                content: s.content,
                info: s.info,
                button: {
                    enabled: s.buttonEnabled !== false,
                    buttons: s.buttons.map(b => ({ name: b.name, visible: b.visible !== false }))
                },
                data: stThDataParse(s.dataText) || {},
                export_with: {
                    data: s.exportData !== false,
                    button: s.exportButton !== false
                }
            };
        }

        function stThFolderToRaw(f) {
            return {
                type: 'folder',
                enabled: f.enabled !== false,
                name: f.name,
                id: f.id,
                icon: f.icon || ST_TH_FOLDER_ICON,
                color: f.color || ST_TH_FOLDER_COLOR,
                scripts: f.scripts.map(stThScriptToRaw)
            };
        }

        function stThNodeToRaw(n) {
            return n.kind === 'folder' ? stThFolderToRaw(n) : stThScriptToRaw(n);
        }

        // 卡里的 extensions 读成草稿。认新键 tavern_helper，也认老键 TavernHelper_scripts
        // （扩展自己就是从老键迁过去的）
        function stThScriptsFromExtensions(ext) {
            const e = (ext && typeof ext === 'object') ? ext : {};
            const th = (e.tavern_helper && typeof e.tavern_helper === 'object' &&
                !Array.isArray(e.tavern_helper)) ? e.tavern_helper : null;
            let list = th ? th.scripts : null;
            if (!Array.isArray(list)) list = e.TavernHelper_scripts;
            if (!Array.isArray(list)) return [];
            return list.map(stThNodeFromRaw).filter(Boolean);
        }

        // 导入脚本 JSON 时的守门员。导出格式永远是 type:'script'，
        // 但手写的可能没写 type —— 那就要求 name + content 两个都在，
        // 否则随便一个 JSON 都会被当成空脚本收下
        function stLooksLikeThScript(raw) {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
            const t = stStr(raw.type);
            if (t === 'script' || t === 'folder') return true;
            return Object.prototype.hasOwnProperty.call(raw, 'name') &&
                Object.prototype.hasOwnProperty.call(raw, 'content');
        }

