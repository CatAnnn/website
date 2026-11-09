# 20261109-ui-01 前端离线更新

本次按 `1109修改.txt` 修改提名相关页面，镜像为 `hackhub-offline/app:20261109-ui-01`，平台为 `linux/amd64`。

## 修改范围

- 相关标题使用单词首字母大写，提名标题按原文改为 `Start You Nomation`。
- 三处 Individual / Team 按钮高度和上下留白缩为原来的约 2/3；提名区域顶部留白减少 1/3；三赛道装饰线固定为 100px。
- 个人信息显示完整邮箱；团队详情隐藏标签；提交结果和我的提名详情移除 Number，并将赛道、名称提前，Requested for 改为 Name。
- 个人和团队提名均增加提交前预览，确认后才上传并提交；返回编辑保留填写内容。
- PDF 默认只显示文件入口，按需打开预览。图片、附件和正文分别占据布局空间。
- 提供 Save Draft、恢复提示、恢复入口及删除草稿；草稿按登录用户、活动、个人/团队及编辑记录隔离，保存文字、照片与附件。

草稿保存在当前浏览器的 IndexedDB，退出页面或重开浏览器后可恢复；不跨设备同步。清除网站数据、使用另一个浏览器或无痕窗口会影响草稿可用性。保存成功以页面提示为准。最终提交仍调用已有接口，由现有 Excel HoD 名册映射进行审核；本次无后端修改或数据库迁移。

## 上传与更新

通过云盾将以下两个文件上传至生产资产的 `/opt/hackhub/incoming/`：

- `20261109-ui-01.tar.gz`
- `20261109-ui-01.tar.gz.sha256`

先确认 Docker 所在分区及 incoming 目录空间足够，现有服务健康：

```bash
docker_root=$(docker info --format '{{.DockerRootDir}}')
df -h "$docker_root" /opt/hackhub/incoming
docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
```

然后执行，任何一步失败都会停止后续操作：

```bash
cd /opt/hackhub/incoming &&
sha256sum -c 20261109-ui-01.tar.gz.sha256 &&
test ! -e 20261109-ui-01 &&
tar -xzf 20261109-ui-01.tar.gz &&
cd 20261109-ui-01 &&
sha256sum -c SHA256SUMS &&
bash update.sh update
```

必须先看到校验 `OK`。若压缩包哈希不符，应重新上传正确文件，不修改校验文件来强行通过。

脚本使用现有 `/opt/hackhub/runtime/compose.sh`，备份当前前端镜像和 `images.env`，只替换 `APP_IMAGE` 并重建前端。后端镜像、生产环境配置、SSO、数据库及附件卷保持现状。更新前后核对后端健康状态及镜像身份，前端健康后检查 Nginx 和公开 API 反向代理。

## 回滚

保存本次输出的真实备份目录。出现问题时执行脚本打印的回滚命令，例如：

```bash
bash /opt/hackhub/incoming/20261109-ui-01/update.sh rollback \
  /opt/hackhub/backups/before-20261109-ui-01.XXXXXX
```

将 `XXXXXX` 替换为真实后缀。回滚仅恢复前端，不操作数据库或附件数据。

## 验收

1. 浏览器强制刷新，使用正常 SSO 登录，核对邮箱显示。
2. 检查 Overview、Nomination、Browse & Vote 的标题、按钮及赛道线条。
3. 分别填写个人与团队表单，保存草稿，离开后重新进入并恢复；核对文字、照片和附件。
4. 点击提交，核对完整预览；返回编辑后数据仍在；确认提交后出现在 My Nominations 和对应 HoD 审核列表。
5. 打开提名详情，PDF 默认不加载，点击后才预览，正文不被遮挡；团队详情不显示标签。
6. 回归已有投票、取消、右下角按类型计数及购物车定位。

本地截图放在项目根目录 `review/`，使用验收数据，不代表生产服务器已更新。

本地已通过前端生产构建、74 项定向测试及镜像内 Nginx → 现有 API 的健康、页面和员工名册搜索检查。Lint 无错误，仅有 RealtimeContext 原有两条警告。更新/回滚模拟涵盖镜像身份校验、配置保留、配置漂移和错误导入镜像的拒绝处理。实际生产 SSO、附件存储及 HoD 审核仍需按上方步骤验收。
