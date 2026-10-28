        // —— 正则五件套。用 String.raw 是因为正则里有 \1 \/ \s，
        //    普通字符串字面量会把 \1 当八进制转义吃掉 ——
        const ST_MVU_RX_HIDE =
            String.raw`/<(update(?:variable)?)>(?:(?!.*<\/\1>)(?:(?!<\1>).)*$|(?:(?!<\1>).)*<\/\1?>)/gsi`;
        const ST_MVU_RX_WAIT =
            String.raw`/<(update(?:variable)?)>(?!.*<\/\1>)\s*((?:(?!<\1>).)*)\s*$/gsi`;
        const ST_MVU_RX_DONE =
            String.raw`/<(update(?:variable)?)>\s*((?:(?!<\1>).)*)\s*<\/\1>/gsi`;
        // ⚠ 这里全部走内联 style。注意理由**不是**「沙盒 iframe 会剥掉 head 样式」——
        //   那条早先写在注释里，是错的、已推翻（见本文件「运行时判定」那一段）：
        //   合格的块会被当成独立网页塞进 iframe，`<style>` 照样生效。
        //   内联只是因为这两条提示要保证在任何主题 / 任何外层 CSS 下都一样显眼。
        const ST_MVU_RX_HTML_WAIT =
            '```html\n<!doctype html><html><head><meta charset="utf-8"></head><body>' +
            '<div style="color:#f5a623;font-style:italic;padding:8px 12px;' +
            'border-left:3px solid #f5a623;background:rgba(245,166,35,.10);border-radius:4px;' +
            'font-size:13px;line-height:1.6">正在更新变量...</div></body></html>\n```';
        const ST_MVU_RX_HTML_DONE =
            '```html\n<!doctype html><html><head><meta charset="utf-8"></head><body>' +
            '<details open style="border:1px solid #f5a623;border-radius:8px;padding:10px 12px;' +
            'margin:6px 0;background:#0d1320;color:#e8ecf3;font-size:13px">' +
            '<summary style="color:#ffc94d;font-weight:bold;margin-bottom:6px;cursor:pointer;' +
            'user-select:none">变量更新</summary>' +
            '<div style="white-space:pre-wrap;line-height:1.6">$2</div></details></body></html>\n```';
        // 状态栏的 HTML 是个占位实现 —— 真要用得自己画，这里只保证「有东西可改」
        const ST_MVU_RX_HTML_SB =
            '```html\n<!doctype html><html><head><meta charset="utf-8"></head><body>' +
            '<div style="border:1px solid #7b9fd4;border-radius:8px;padding:8px 10px;margin:6px 0;' +
            'background:#0d1320;color:#e8ecf3;font-size:13px;white-space:pre-wrap;' +
            'line-height:1.6">{{format_message_variable::stat_data}}</div></body></html>\n```';

        // 五条正则的名字（照 MVU Maker 的 templates.ts）
        const ST_MVU_RX_NAME = {
            hide: '对AI隐藏变量更新',
            wait: '变量更新中美化',
            done: '变量更新美化',
            sbHide: '对AI隐藏状态栏',
            sbShow: '状态栏界面'
        };

        function stMvuMakeRegex(scriptName, findRegex, replaceString, opts) {
            const o = opts || {};
            const r = stBlankRegex();
            r.scriptName = scriptName;
            r.findRegex = findRegex;
            r.replaceString = replaceString;
            r.placement = o.placement || [2];
            r.markdownOnly = o.markdownOnly === true;
            r.promptOnly = o.promptOnly === true;
            // MVU 那五条都设 runOnEdit: false —— 编辑消息时重新跑会把
            // 已经美化好的面板再套一层
            r.runOnEdit = o.runOnEdit === undefined ? false : o.runOnEdit === true;
            return r;
        }

        // 五件套的参数。placement：[1,2] = 用户输入 + AI 输出都处理；
        // [2] = 只管 AI 输出（占位符只会出现在 AI 回复里）
        function stMvuRegexSpecs() {
            return [
                [ST_MVU_RX_NAME.hide, ST_MVU_RX_HIDE, '',
                    { placement: [1, 2], promptOnly: true, markdownOnly: false }],
                [ST_MVU_RX_NAME.wait, ST_MVU_RX_WAIT, ST_MVU_RX_HTML_WAIT,
                    { placement: [1, 2], promptOnly: false, markdownOnly: true }],
                [ST_MVU_RX_NAME.done, ST_MVU_RX_DONE, ST_MVU_RX_HTML_DONE,
                    { placement: [1, 2], promptOnly: false, markdownOnly: true }],
                [ST_MVU_RX_NAME.sbHide, ST_MVU_PLACEHOLDER, '',
                    { placement: [2], promptOnly: true, markdownOnly: false }],
                [ST_MVU_RX_NAME.sbShow, ST_MVU_PLACEHOLDER, ST_MVU_RX_HTML_SB,
                    { placement: [2], promptOnly: false, markdownOnly: true }]
            ];
        }

        // 认一条正则是不是 MVU 五件套里的，返回 'hide' / 'wait' / 'done' /
        // 'sbHide' / 'sbShow' / null。检测与移除共用这一处判断。
        //
        // ⚠ 主判据必须是**名字**。曾经拿 ST_MVU_RX_TAG 去 test(findRegex)，
        //   那是错的：findRegex 存的是**正则源码**（`<(update(?:variable)?)>`），
        //   里面带元字符，而 ST_MVU_RX_TAG 是个「匹配字面标签」的正则，
        //   拿它去匹配源码文本永远不中 —— 于是装了 MVU 也检测不出来、
        //   点移除也删不干净。名字对不上时再退回内容判断。
        function stMvuRegexKind(r) {
            if (!r) return null;
            const n = String(r.scriptName || '').trim();
            for (const k in ST_MVU_RX_NAME) {
                if (ST_MVU_RX_NAME[k] === n) return k;
            }
            const f = String(r.findRegex || '');
            if (f.indexOf(ST_MVU_PLACEHOLDER) >= 0) {
                if (r.markdownOnly && !r.promptOnly) return 'sbShow';
                if (r.promptOnly && !r.markdownOnly) return 'sbHide';
                return null;
            }
            // 更新类正则的源码里一定出现 update
            if (/update/i.test(f)) {
                if (r.promptOnly && !r.markdownOnly) return 'hide';
                if (r.markdownOnly && !r.promptOnly) {
                    return String(r.replaceString || '').indexOf('正在更新') >= 0 ? 'wait' : 'done';
                }
            }
            return null;
        }

        // 造一条 MVU 世界书条目。MVU 官方标准：position = @D(atDepth 4)，
        // depth 按条目各不同，order 一律 200
        function stMvuMakeEntry(comment, content, depth, enabled) {
            const e = stBlankEntry();
            e.comment = comment;
            e.content = content;
            e.keys = [];
            e.secondaryKeys = [];
            e.constant = true;
            e.selective = false;
            e.enabled = enabled;
            e.position = WI_POS.atDepth;
            e.depth = depth;
            e.role = 0;
            e.order = 200;
            e.useRegex = false;
            return e;
        }

