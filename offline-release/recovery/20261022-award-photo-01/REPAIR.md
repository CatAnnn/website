# 恢复后旧照片路径修复：20261022-award-photo-01

已确认生产中 4 条旧提名的 storageKey 仍含旧活动 ID，而提名已合并到新活动。下载授权会先校验路径中的活动是否存在，因此生成新图片 URL 被拒绝，旧签名 URL 也不能长期使用。此包修复存储路径与业务关联；原文件是否存在由预检查确定。

## 范围

- 只处理已恢复的 4 条提名，不处理 bd-test，不重新导入提名或投票。
- 将 `nominations/旧活动/旧创建者/文件名` 下的对象复制到 `nominations/当前活动/当前创建者/文件名`。
- 当前活动：`23680a03-54bf-43f1-8e28-cd400a957a66`。旧活动：`3c3eb377-23c9-4e82-807c-d9af5e790f12`。
- 旧创建者 aah5sgh 对应的路径按此前确认迁移到当前 Yaolong 账号；其他原创建者保持不变。
- 先检查 4 个原文件全部存在，校验 SHA256，再复制并逐个核对目标 SHA256。原文件不删除。
- 如果目标已有相同内容，复用；如果已有不同内容则停止，不覆盖。
- 只更新这 4 条提名 screenshot 的 storageKey，并清空过期 URL，前端通过原有接口获取新的签名 URL。
- 不改新建提名、描述、照片名称、提名时间、票数、评分、账号、SSO 或活动状态，不修改权限校验。
- 不改应用代码，不更新镜像，不重启或停止 API。不改变 MinIO 桶权限或服务器配置。

## 上传和运行

将 ZIP 与 `.zip.sha256` 通过 SFTP 上传到 `/opt/hackhub/incoming/`，完整执行：

```bash
bash -euo pipefail <<'SH'
cd /opt/hackhub/incoming
sha256sum -c 20261022-award-photo-01.zip.sha256
python3 -m zipfile -e 20261022-award-photo-01.zip .
cd 20261022-award-photo-01
bash repair.sh
bash repair.sh --apply
SH
```

预检查失败会自动停止，不会继续正式修复。执行用到现有 Compose 的 postgres 和 minio-init 服务及已安装镜像，不拉取新镜像。minio-init 只作为一次性客户端，覆盖其入口命令，不运行原有初始化脚本，不启动依赖服务。

预检查成功应看到：

```text
All four source photos exist in MinIO.
Verified photo objects: 4; references to repair: 4
Preview passed. No images or database rows changed.
```

正式修复会先备份当前数据库，再复制、验证图片，最后事务更新引用。成功应看到：

```text
Four destination photos verified; original files preserved.
Photo repair committed. Updated references: 4.
No API restart needed. Refresh Browse & Vote to request fresh image URLs.
```

刷新 Browse & Vote，必要时 Ctrl+F5。确认旧照片显示、新照片仍显示，5 条提名及原票数评分不变。无需再运行历史提名恢复包。

## 报告与异常

- 报告与备份保存在输出的独立 `/opt/hackhub/incoming/photo-repair-XXXXXX/` 目录，目录和文件限制为当前用户访问。
- `plan.json`：对象路径、校验值和目标存在状态，不包含签名 URL。
- `before.dump`：正式修复前数据库备份，包含私密信息，不要上传或发送。
- `repair.sql`、`private.log` 可能含原始数据，不要发送全文；优先反馈终端摘要。
- 如果提示原图缺失，会列出对应提名 ID；不修改数据库。这时需要文件备份或原图重新上传，数据库备份不含实际照片。
- 访问被拒绝、网络错误不会被误判为原图不存在。
- 复制完成但 SQL 事务失败时，数据库不变，原文件保留，可能有未引用的新副本。修复后重试会核对并复用相同内容，不删除任何原图。
- 若提名在检查后被编辑，事务会停止，避免覆盖他人的修改。更新时间触发器仅在短事务内暂时关闭以保持历史时间，提交前恢复，外键校验不关闭。
- 已成功修复后再次运行会验证目标对象并报告已完成，不重复修改记录。
- 如果连接中断，先检查本次报告目录 COMMITTED 和页面，避免盲目操作。

## 本地测试

使用真实 MinIO 客户端/服务和项目 PostgreSQL 表结构，在无外部网络的隔离环境中验证：源文件缺失拒绝、不同目标内容拒绝覆盖、复制内容 SHA256 一致、图片 Content-Type 保留、源文件保留、仅更新授权范围内的 4 条图片引用、现有新提名不变、时间保留、SQL 回滚、并发编辑拒绝、重复执行无修改，以及终端不输出密钥或原签名 URL。

本地测试没有读取生产文件；生产原文件是否存在，以服务器预检查结果为准。
