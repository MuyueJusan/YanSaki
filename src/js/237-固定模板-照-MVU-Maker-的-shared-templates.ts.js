        // —— 固定模板（照 MVU Maker 的 shared/templates.ts 抄）——
        function stMvuVarListTemplate() {
            return [
                '---',
                '<status_current_variable>',
                '{{format_message_variable::stat_data}}',
                '</status_current_variable>',
                '',
                '## 数据权威声明',
                '',
                '以下 stat_data 变量列表是角色当前状态的**唯一权威数据来源**。',
                '- 所有数值（积分、好感度、HP、MP、数量等）一律以本列表为准',
                '- 大总结、小总结、动向、小圈子等记忆内容中提到的旧数值仅供参考，可能已过时，**不得**用来覆盖本列表',
                '- 更新变量时，必须基于本列表当前值计算增减，而不是基于记忆文本中的数值',
                '- 若记忆与列表冲突，以本列表为准',
                ''
            ].join('\n');
        }

        function stMvuOutputFormatTemplate() {
            return [
                '---',
                '<update_variable_rules>',
                'rule:',
                '  - you must output the update analysis and the actual update commands at once in the end of the next reply',
                "  - 'the update commands must strictly follow the **JSON Patch (RFC 6902)** standard, but can only use the following operations: replace, add, remove; the output must be a valid JSON array containing operation objects'",
                'format: |-',
                '  <UpdateVariable>',
                '  <Analysis>（中文，不超过600字）',
                '    0. 时间:',
                '       正文检查: 根据剧情进展判断时间是否推进,决定是否需要更新时间',
                '       硬约束: 时间格式必须为 YYYY-MM-DD HH:mm;剧情无时间推进时不得更新',
                '    1. 主角:',
                '       正文检查: 检查正文中主角的名称、状态、所处地点等是否变化',
                '       硬约束: 主角名称不得修改;各字段字数不得超过50字',
                '    2. 出场角色:',
                '       正文检查: 检查正文出场的NPC及其状态变化',
                '       硬约束: 正文出场的NPC,心声字段必须更新',
                '    3. 路径:',
                '       正文检查: 检查本次需要更新的变量路径是否都在变量列表中',
                '       硬约束: 路径必须为中文,严格遵守变量列表中的结构;不得擅自将路径翻译为英文',
                '  </Analysis>',
                '  <JSONPatch>',
                '  [',
                '    { "op": "replace", "path": "${/path/to/variable}", "value": ${new_value} },',
                '    { "op": "add", "path": "${/path/to/object/newKey}", "value": ${content} },',
                '    { "op": "remove", "path": "${/path/to/array/0}" }',
                '  ]',
                '  </JSONPatch>',
                '  </UpdateVariable>',
                '</update_variable_rules>',
                '',
                '虽然示例指令的路径有${}包裹,但实际写时不要有${}。',
                ''
            ].join('\n');
        }

