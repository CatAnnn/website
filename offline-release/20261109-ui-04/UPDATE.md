# 20261109-ui-04 提名详情与预览展示更新

本次检查并修复 Browse & Vote 的 Individual / Team 提名详情、提交确认预览的展示一致性：

- 团队详情正确识别已提交内容中的固定分段标题，标题按每个单词首字母大写显示，保留用户填写的正文。
- 统一个人与团队详情、确认预览的字体、字号和行距；窄屏详情采用适合阅读的布局。
- 图片、正文与附件各自占据布局空间，PDF 默认仅为文件条目，点击后才展开。
- 保留投票、取消、计数、定位、保存草稿及确认后提交的原有业务逻辑。

包含此前的标题大小写及 Individual / Team 两套投票规则文案。

镜像为 `hackhub-offline/app:20261109-ui-04`，平台 `linux/amd64`。本次仅更新前端，保留后端镜像、数据库、附件卷、SSO 及生产配置。

## 上传与更新

将 `20261109-ui-04.tar.gz` 和 `20261109-ui-04.tar.gz.sha256` 上传至 `/opt/hackhub/incoming/`，执行：

```bash
cd /opt/hackhub/incoming &&
sha256sum -c 20261109-ui-04.tar.gz.sha256 &&
test ! -e 20261109-ui-04 &&
tar -xzf 20261109-ui-04.tar.gz &&
cd 20261109-ui-04 &&
sha256sum -c SHA256SUMS &&
bash update.sh update
```

若校验失败，应重新上传正确文件，不修改校验文件来强行通过。脚本会备份当前前端，并核对更新前后后端未变和服务健康。

## 页面验收

1. Ctrl + F5 强制刷新，分别打开 Individual 与 Team 的 View details。
2. 核对分段标题、正文、图片完整显示；窄屏可正常滚动。
3. 附件默认显示文件名，点击 Preview Attachment 才加载 PDF，关闭后回到文件条目。
4. 个人与团队填写表单后，首次提交打开确认预览，核对字体和附件；返回编辑时保留内容，二次确认后才提交。

本地演示截图与验收结果见项目根目录 `review/20261109-ui-04/`。本地测试不代表已实际更新生产或验证真实生产附件存储。

## 回滚

使用本次脚本输出的完整命令及真实备份目录，例如：

```bash
bash /opt/hackhub/incoming/20261109-ui-04/update.sh rollback \
  /opt/hackhub/backups/before-20261109-ui-04.XXXXXX
```

将 `XXXXXX` 替换为本次真实后缀，勿使用其他版本的备份目录。
