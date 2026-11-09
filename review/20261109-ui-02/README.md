# Browse & Vote 规则文案验收

本次只修改 `ProjectShowcase.tsx` 的规则展示区域，使用用户提供的 Team / Individual 标题及两条正文。投票、取消、计数、定位和其他页面保持原实现。

本目录六张截图均为本地演示数据的完整页面截图，不代表生产已更新：

| 类型 | 桌面 1440 | 平板 768 | 手机 390 |
| --- | --- | --- | --- |
| Team | [查看](browse-vote-team-1440.png) | [查看](browse-vote-team-768.png) | [查看](browse-vote-team-390.png) |
| Individual | [查看](browse-vote-individual-1440.png) | [查看](browse-vote-individual-768.png) | [查看](browse-vote-individual-390.png) |

浏览器实际点击 Team / Individual 切换，已逐字核对两条规则、数字编号、白色文字及无页面水平溢出。结果保存在 `validation.json`，截图已视觉检查。

生产构建通过；lint 无错误，仅保留 RealtimeContext 的两条既有警告。离线发布包及生产更新、回滚步骤见 `offline-release/20261109-ui-02/UPDATE.md`。
