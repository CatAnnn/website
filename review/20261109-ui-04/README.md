# 详情与提交预览验收

本目录使用本机演示账号、示例照片及自建有效 PDF，未访问生产服务，未上传文件或正式提交提名。截图保持真实页面布局，通过实际滚动展示长内容；没有为截图临时改变页面高度或 CSS。

## 结果

- 个人、团队详情均正确显示三段固定标题。团队旧格式提交文本的标题已识别为标题，正文逐段核对与原始中英文文本一致。
- 详情与两类提交预览字体一致：正文 16px、400 字重、28.8px 行高；小标题 18px、700 字重、27px 行高。正文与标题均为白色，使用相同正文字体。
- 固定英文标题各单词首字母大写。用户姓名、项目名称和填写正文保持原值。
- 1440、768、390 像素宽度均检查通过。手机详情单列显示，长正文在弹窗内滚动；照片、正文和 PDF 无几何重叠，也无弹窗水平溢出。
- 附件默认只有文件入口：详情页打开前没有 PDF 请求，表单及提交预览没有自动创建 PDF iframe。点击 Preview Attachment 后才加载，Hide Attachment 后移除 iframe。
- 远程附件与本地上传文件均使用 `review-evidence.pdf`，核对了 `application/pdf` 类型、PDF 头及完整字节数。已视觉确认 PDF 显示实际文字；PDF 内部的字体和颜色来自文件本身，不由网页正文样式覆盖。
- 首次点击 Submit 只打开预览，整个验收上传次数为 0，创建提名次数为 0。Back To Edit 后文字、照片、PDF 仍保留。
- 无照片场景的深色占位区域与白色文字可读。

详细计算样式、边界位置、文件校验和请求计数见 `validation.json`。基线问题记录在 `baseline.json`：原团队仅识别 1 个标题，390px 详情弹窗只有约 197px 高。

## 截图索引与阅读顺序

`{type}` 为 `individual` 或 `team`；`{width}` 为 `1440`、`768` 或 `390`。

| 文件模式 | 内容与阅读顺序 |
| --- | --- |
| `details-{type}-{width}-file.png` | 详情打开后的初始页面，PDF 默认关闭 |
| `details-{type}-{width}-text.png` | 实际滚动至正文起始 |
| `details-{type}-{width}-text-end.png` | 实际滚动至正文末段及附件入口 |
| `details-{type}-{width}-pdf.png` | 按需展开的真实 PDF |
| `preview-{type}-{width}-file.png` | 提交确认预览所在完整页面，PDF 默认关闭 |
| `preview-{type}-{width}-dialog.png` | 预览弹窗当前视窗清晰截图；长内容需结合后续截图 |
| `preview-{type}-{width}-text.png` | 滚动至预览正文起始 |
| `preview-{type}-{width}-text-middle.png` | 滚动至成果与影响中段 |
| `preview-{type}-{width}-text-end.png` | 滚动至文化段落与底部确认按钮 |
| `preview-{type}-{width}-pdf.png` | 点击后展开的本地 PDF 文件 |
| `details-team-390-no-photo.png` | 手机无照片占位可读性 |
| `before-team-detail-{1440,390}.png` | 修复前基线对照，非最终页面 |

共 63 张 PNG：61 张最终验收截图和 2 张基线对照。`qa.cjs` 为独立本机浏览器复现脚本；PDF 为演示附件，不包含业务数据。
