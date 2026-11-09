# 20261109-ui-02 投票规则文案更新

本次仅修改 Browse & Vote 规则区域的显示文案：切换 Team 或 Individual 时分别显示用户指定标题及两条规则，并使用数字编号。原有投票、取消、计数和定位逻辑保持不变。

仅发布前端镜像 `hackhub-offline/app:20261109-ui-02`，平台 `linux/amd64`。后端、数据库、附件卷、SSO 和生产配置保持现状。

## 上传与更新

将 `20261109-ui-02.tar.gz` 与 `20261109-ui-02.tar.gz.sha256` 上传到 `/opt/hackhub/incoming/`，然后执行：

```bash
cd /opt/hackhub/incoming &&
sha256sum -c 20261109-ui-02.tar.gz.sha256 &&
test ! -e 20261109-ui-02 &&
tar -xzf 20261109-ui-02.tar.gz &&
cd 20261109-ui-02 &&
sha256sum -c SHA256SUMS &&
bash update.sh update
```

若哈希不符，重新上传正确文件，不修改校验文件来强行通过。脚本备份当前前端并仅切换 APP_IMAGE，检查后端未变、前端健康及 Nginx 反向代理。

## 页面验收

浏览器 Ctrl + F5 强制刷新，打开 Browse & Vote。Team 应显示：

**Team Awards — Voting Rules**

1. Click "Vote" to submit; click "Submitted" again to withdraw your vote.
2. You may vote for up to 3 nominees per category.

Individual 应显示：

**Individual Awards — Voting Rules**

1. Click "Vote" to submit; click "Submitted" again to withdraw your vote.
2. You may vote for up to 2 nominees within your department and up to 2 nominees in other departments per category. These two quotas are counted separately.

## 回滚

保存本次脚本输出的真实备份目录。如需回滚，使用输出的完整命令：

```bash
bash /opt/hackhub/incoming/20261109-ui-02/update.sh rollback \
  /opt/hackhub/backups/before-20261109-ui-02.XXXXXX
```

将 `XXXXXX` 替换为本次真实备份后缀，不使用上一个版本的备份目录。

本地完整页面截图放在项目根目录 `review/20261109-ui-02/`，使用演示数据；生产由用户上传并执行更新。
