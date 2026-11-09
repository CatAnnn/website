# 标题与投票规则验收

本目录共 33 张完整页面截图，使用本地演示账号和提名数据，不代表生产已经更新。

- `browse-vote-individual-{1440,768,390}.png`：个人规则，主标题为 `Meet This Year's Nominees`。
- `browse-vote-team-{1440,768,390}.png`：团队规则。
- `overview-{1440,768,390}.png`：赛道标题、小标题和时间线。
- `nomination-{individual,team}-{1440,768,390}.png`：提名类型与赛道选择。
- `nomination-{individual,team}-form-{1440,768,390}.png`：完整提名表单。
- `voting-{1440,768,390}.png`：浏览投票页。
- `profile-{1440,768,390}.png`：个人资料页。
- `my-nomination-detail-{1440,768,390}.png`：我的提名详情。
- `hod-approval-detail-{1440,768,390}.png`：HoD 审批详情。

浏览器实际切换 Team / Individual，已逐字核对规则标题、两条正文、数字编号及白色文字；三种屏宽均无页面水平溢出。主标题精确断言通过，结果保存在 `validation.json`。截图已视觉复核。

本次只调整固定英文标题及指定规则文案，保留姓名、用户填写的名称、赛道数据键和原投票逻辑。相关 11 个测试文件共 87 项测试通过；生产构建通过；lint 无错误，仅有 RealtimeContext 的两条既有警告。

新发布版本为 `20261109-ui-03`，生产更新和回滚步骤见 `offline-release/20261109-ui-03/UPDATE.md`。
