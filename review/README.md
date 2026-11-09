# 1109 页面验收截图

本目录包含 **39 张截图**，使用本机 Vite 页面及演示账号 `reviewer@example.test`、演示提名和示例图片，不含生产账号或真实提名数据。截图不代表生产服务器已经更新。

## 截图索引

| 文件 | 内容 |
| --- | --- |
| `overview-{1440,768,390}.png` | 首页赛道与 Individual / Team 按钮 |
| `nomination-{individual,team}-{1440,768,390}.png` | 提名类型与赛道选择 |
| `nomination-{individual,team}-form-{1440,768,390}.png` | 完整个人、团队提名表单 |
| `voting-{1440,768,390}.png` | 浏览及投票页 |
| `profile-{1440,768,390}.png` | 个人信息显示完整邮箱 |
| `my-nomination-detail-{1440,768,390}.png` | 我的提名详情 |
| `hod-approval-detail-{1440,768,390}.png` | HoD 审批详情 |
| `{individual,team}-draft-restored.png` | 草稿刷新后恢复，包含照片和 PDF |
| `{individual,team}-submit-preview.png` | 二次确认预览所在完整页面 |
| `{individual,team}-submit-preview-dialog.png` | 二次确认弹窗清晰截图 |
| `{individual,team}-submit-success.png` | 确认后的提交成功页 |
| `voting-{individual,team}-detail-{1440,390}.png` | 投票提名详情，PDF 默认关闭 |

## 浏览器验收结果

- 1440、768、390 像素布局检查通过：页面无水平溢出；赛道线条固定 100 × 4 px；类型按钮字体保留 18.88 px，高度按确认比例收紧。
- 真实 IndexedDB 验证通过：刷新后保留草稿内容及 File 名称、类型、修改时间与字节；账号、活动、个人/团队及编辑记录隔离；删除一个草稿不影响另一个。
- 个人和团队均完成“填写 → 保存草稿 → 刷新 → 恢复 → 首次提交预览 → 确认提交”。首次提交不上传文件、不创建提名；确认后各上传照片/PDF 两个文件并提交一次；成功后相应草稿清除。
- 团队预览返回编辑后文字保留。个人/团队预览图片与后续正文无重叠，PDF 仅在点击 Preview Attachment 后出现，关闭后移除 iframe。
- 浏览投票详情的个人/团队照片与正文在桌面和手机尺寸均无重叠；团队 Tags 已隐藏，附件新文字为白色。
- 修复后重拍草稿/预览/成功截图；团队草稿提示计算颜色断言为 `rgb(255, 255, 255)`。已人工查看预览弹窗、草稿恢复页及详情截图。

## 验证边界与复现

页面接口采用本地演示路由，验证真实浏览器交互、布局和 IndexedDB；文件上传与创建提名响应由本地测试模拟，不代表真实生产存储或 HoD 已收到提名。本地演示没有 WebSocket 后端，控制台中的 `/ws/info` 连接错误来源于此。

手机详情沿用原有固定比例弹窗及内部滚动，不扩大修改既有功能。完整页面截图保留页面和弹窗上下文，另提供独立确认弹窗截图便于查看文字。

本机 Vite 地址为 `http://127.0.0.1:4176`。依次执行 `capture-layout.cjs`、`../test/ui1109-draft-browser.cjs`、`capture-preview.cjs`、`capture-details.cjs`；脚本通过 MCP Playwright `browser_run_code_unsafe` 的 `filename` 参数执行。脚本只清理自己使用的演示草稿键。
