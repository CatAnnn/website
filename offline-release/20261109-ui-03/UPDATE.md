# 20261109-ui-03 标题与投票规则更新

本次将固定英文页面、区块和弹窗标题统一为每个单词首字母大写，例如 `Meet This Year's Nominees`，并保留缩写、用户姓名及用户填写的提名名称。正文、投票、取消、计数和定位逻辑保持原实现。

Browse & Vote 随类型切换显示以下规则：

**Individual Awards — Voting Rules**

1. Click "Vote" to submit; click "Submitted" again to withdraw your vote.
2. You may vote for up to 2 nominees within your department and up to 2 nominees in other departments per category. These two quotas are counted separately.

**Team Awards — Voting Rules**

1. Click "Vote" to submit; click "Submitted" again to withdraw your vote.
2. You may vote for up to 3 nominees per category.

仅发布前端镜像 `hackhub-offline/app:20261109-ui-03`，平台 `linux/amd64`。保留后端、数据库、附件卷、SSO 及生产配置。

## 上传与更新

将以下两个文件上传至 `/opt/hackhub/incoming/`：

- `20261109-ui-03.tar.gz`
- `20261109-ui-03.tar.gz.sha256`

然后执行：

```bash
cd /opt/hackhub/incoming &&
sha256sum -c 20261109-ui-03.tar.gz.sha256 &&
test ! -e 20261109-ui-03 &&
tar -xzf 20261109-ui-03.tar.gz &&
cd 20261109-ui-03 &&
sha256sum -c SHA256SUMS &&
bash update.sh update
```

校验失败时重新上传正确文件，不修改校验文件来强行通过。脚本仅替换 APP_IMAGE，并保留当前前端的回滚镜像和备份。

## 页面验收

浏览器 Ctrl + F5 强制刷新，确认主标题为 `Meet This Year's Nominees`；分别点击 Individual 与 Team，逐项核对上方规则。其他页面固定标题采用相同首字母大写规则。

本地完整页面截图及验收结果位于项目根目录 `review/20261109-ui-03/`，使用演示数据，不代表生产已更新。

## 回滚

使用本次脚本输出的真实备份目录，例如：

```bash
bash /opt/hackhub/incoming/20261109-ui-03/update.sh rollback \
  /opt/hackhub/backups/before-20261109-ui-03.XXXXXX
```

将 `XXXXXX` 替换为本次备份的真实后缀。不要使用其他发布版本的备份路径。
