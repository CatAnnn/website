# 白色详情页与附件验收

本目录包含 61 张最终截图，使用本机演示账号、示例照片和自建有效 PDF，未访问生产服务，未上传文件或正式提交提名。旧版本截图保持原样。

## 验收结果

- Browse & Vote 的 Individual、Team 详情内容区和标题栏均为纯白色，标题、正文及关闭按钮为深色 `#111`。
- 两类详情左侧的 `Department:` 行均已移除，保留 `Org. Code` 及其原始值。
- 深色附件条目的文件名与按钮保持白字；缺照片占位仍为可读的深底白字。
- 个人和团队详情、提交预览使用相同站点字体：正文 16px、400 字重、28.8px 行高；标题 18px、700 字重、27px 行高。提交确认预览保持原有深底白字。
- 固定英文标题每个单词首字母大写；正文逐段与原始中英文文本一致，用户姓名及项目名称没有被转换。
- 1440、768、390 像素宽度均通过检查。手机详情采用单列滚动，照片、正文和 PDF 无几何重叠，弹窗无水平溢出。
- 附件默认只显示文件条目，详情页打开前 PDF 请求数为零；本地表单与提交预览默认没有 PDF iframe。点击 Preview Attachment 后才加载真实 PDF，Hide Attachment 后移除 iframe。
- 远程附件及本地文件均核对 `application/pdf` 类型、PDF 文件头和完整字节数；已视觉确认 PDF 页面包含实际文字。PDF 内部字体及颜色由文件本身决定。
- 六组提交预览首次 Submit 均无上传和创建提名请求；Back To Edit 后文字、照片和附件完整保留。

计算样式、背景颜色、文字内容、边界位置、文件字节和请求计数见 `validation.json`。已视觉复核桌面团队详情、手机个人正文、个人确认预览及真实 PDF 内容。

## 截图索引与阅读顺序

`{type}` 为 `individual` 或 `team`，`{width}` 为 `1440`、`768` 或 `390`。

| 文件模式 | 内容 |
| --- | --- |
| `details-{type}-{width}-file.png` | 白色详情初始页面，附件默认关闭 |
| `details-{type}-{width}-text.png` | 详情正文起始 |
| `details-{type}-{width}-text-end.png` | 详情正文末段及文件条目 |
| `details-{type}-{width}-pdf.png` | 按需展开的真实 PDF |
| `preview-{type}-{width}-file.png` | 提交确认预览所在完整页面 |
| `preview-{type}-{width}-dialog.png` | 提交确认预览弹窗 |
| `preview-{type}-{width}-text.png` | 确认预览正文起始 |
| `preview-{type}-{width}-text-middle.png` | 确认预览正文中段 |
| `preview-{type}-{width}-text-end.png` | 确认预览正文末段 |
| `preview-{type}-{width}-pdf.png` | 确认预览中按需展开的 PDF |
| `details-team-390-no-photo.png` | 无照片占位的颜色对比 |

截图通过实际滚动展示长内容，未为截图修改页面 CSS 或高度。可用 `node review/20261110-ui-01/qa.cjs` 在本机 Vite `http://127.0.0.1:4176` 运行验收脚本；脚本使用独立无头浏览器和模拟接口。
