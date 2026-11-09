# 20261110-ui-01 详情白底与字段调整

本次按截图将 Browse & Vote 的 Individual、Team 详情统一为白底深色文字，删除详情左侧 `Department:` 行，保留 `Org. Code`。两类详情继续使用相同字体、字号、行距和标题格式，手机保持单列滚动。

深色附件文件条目保留白字，默认不加载 PDF，点击 Preview Attachment 后才展开。个人与团队提交确认预览继续采用一致字体和深色白字样式。投票、取消、计数、定位、草稿、上传与提交流程保持原实现。

仅发布前端镜像 `hackhub-offline/app:20261110-ui-01`，平台 `linux/amd64`，保留后端镜像、数据库、附件卷、SSO 和生产配置。

## 上传与更新

将 `20261110-ui-01.tar.gz` 与 `20261110-ui-01.tar.gz.sha256` 上传至 `/opt/hackhub/incoming/`，执行：

```bash
cd /opt/hackhub/incoming &&
sha256sum -c 20261110-ui-01.tar.gz.sha256 &&
test ! -e 20261110-ui-01 &&
tar -xzf 20261110-ui-01.tar.gz &&
cd 20261110-ui-01 &&
sha256sum -c SHA256SUMS &&
bash update.sh update
```

若该版本已解压且尚未更新，可进入该目录，校验 SHA256SUMS 后执行 update。校验失败应重新上传正确文件，不修改校验文件来强行通过。

## 验收

Ctrl + F5 强制刷新。分别打开 Individual、Team 的 View details，核对白底深色文字、Department 行已移除、Org. Code 保留；核对标题大小写与字体一致。附件默认仅显示文件，点击才打开 PDF，关闭后回到文件入口。长正文和附件可滚动查看，互不覆盖。

本地演示截图与验收记录位于项目根目录 `review/20261110-ui-01/`，不代表生产已更新或真实生产附件存储已验证。

## 回滚

保存本次脚本输出的真实备份目录，按输出命令回滚，例如：

```bash
bash /opt/hackhub/incoming/20261110-ui-01/update.sh rollback \
  /opt/hackhub/backups/before-20261110-ui-01.XXXXXX
```

将 `XXXXXX` 替换为本次真实备份后缀。
