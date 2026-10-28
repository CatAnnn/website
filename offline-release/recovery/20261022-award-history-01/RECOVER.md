# 历史提名定向恢复（20261022-award-history-01）

本包是数据库恢复工具，不含新镜像。本地验证不代表已经恢复生产。

## 已确认的恢复范围

- 活动：`2026 Digital Pioneer Award`，ID `3c3eb377-23c9-4e82-807c-d9af5e790f12`。
- 保留 4 条提名：Yining.MA 一条、Yaolong.Zhang 两条、Lynette 一条。
- 保留这些提名的 6 条投票记录、4 条评委评分记录，以及必要的团队、成员、评分标准、评委分配、提交材料和评论。
- 排除所有 `bd-test` 账号及对应的 7 条提名和相关投票、评分。不会重新创建测试账号。
- 按用户确认，将 `aah5sgh@bosch.com` 的相关业务外键及提名元数据中的账号 ID，迁移到 `fixed-term.Yaolong.ZHANG@cn.bosch.com`（ID `e609070a-941e-468d-8478-5afdf52000e6`）。不恢复旧账号、旧密码或旧 SSO 绑定。
- 其他现有账号、角色、密码、部门和 SSO 绑定保持原状；不修改 `.env`、Compose、镜像版本、SSO 配置或数据卷。
- 保留活动原有状态、起止日期、描述、照片地址和历史时间戳，不擅自延期或修改投票规则。
- 部门只采用当前真实账号数据；本包不配置 Entra、不将期望的部门值硬写进数据库。SSO 管理员仍需在 ID token 中下发 `department`，员工重新完成 SSO 后同步。

默认历史备份：

```text
/opt/hackhub/runtime/account-reconcile-reports/apply-20261022-051059-IiNSQe/before.dump
```

## 上传、解压、预演

通过 SFTP 将 ZIP 及对应 `.zip.sha256` 上传到 `/opt/hackhub/incoming/`。执行：

```bash
bash -euo pipefail <<'SH'
cd /opt/hackhub/incoming
sha256sum -c 20261022-award-history-01.zip.sha256
python3 -m zipfile -e 20261022-award-history-01.zip .
cd 20261022-award-history-01
bash recover.sh
SH
```

默认只预演：读取生产库备份，在无网络、无宿主数据卷挂载、无开放端口的临时 PostgreSQL 中恢复历史库和当前库，再执行完整恢复事务。不会向生产库写入数据，也不会暂停生产 API。

成功应出现：

```text
Rehearsal passed. Selected rows: ...
Preview complete. No production data was changed.
```

核对 Selected rows 中：`hackathons=1`、`ideas=4`、`idea_votes=6`、`judge_scores=4`。其他关联表数量会根据真实备份生成，不能事先猜测。

如出现 STOP 或校验失败，不进入正式恢复步骤；只发送终端摘要，不发送私密备份、恢复 SQL 或 private.log 全文。

## 正式恢复

预演成功后执行下面命令。会短暂停止 API，期间网站 API 请求可能失败；脚本结束会启动原 API 容器并等待健康检查。

```bash
bash -euo pipefail <<'SH'
cd /opt/hackhub/incoming/20261022-award-history-01
bash recover.sh --apply
SH
```

正式模式重新备份当前生产库、重新隔离预演，通过后才以单个事务写入生产。原始数据库备份保存在输出的独立 `award-recovery-XXXXXX/before.dump`，目录权限 700，文件权限受 umask 077 保护。

事务在写入前锁定涉及的表并核对账号/SSO 指纹、V024 状态、计票触发器。任何已有活动、账号映射不符、计数不符、缺失关联、唯一约束冲突都会停止，不执行覆盖。导入时投票计数从零由现有触发器逐条增加；仅在事务内临时关闭提名更新时间触发器以保留历史时间戳，提交前恢复。外键和自动计票始终启用。

成功应出现：

```text
awards|1
nominations|4
votes|6
judge_scores|4
Existing accounts, passwords, roles, SSO bindings and runtime configuration preserved.
Database recovery committed.
Production API: healthy
```

最后在浏览器刷新 Browse & Vote，确认只显示保留的 4 条提名，查看详情和原投票记录。照片实际文件存放在 MinIO；数据库备份只包含文件地址，如果照片文件此前也被删除，需另外恢复文件，不能通过本包补回。

## 失败处理

- SQL 事务在提交前失败会回滚，脚本会尝试恢复 API；不会通过整库覆盖回滚。
- 脚本重复执行会因已有活动而停止，防止重复导入。
- 连接断开可能造成提交结果不明。不要根据没有看到成功字样就盲目重跑：检查输出目录里的 `COMMITTED` 文件、数据库计数和 API 状态。
- 如果出现启动/清理失败，可先执行以下命令检查并启动原 API：

```bash
cd /opt/hackhub/runtime
bash compose.sh start api
bash compose.sh ps
```

- `before.dump` 是恢复前的安全备份；恢复后若已经有新操作，不能直接整库回退，否则会丢失新数据。需要结合当前状态制定回退步骤。
- 不执行 `down -v`，不清空数据库，不删除生产数据卷，不重置校验和。

## 本地验证范围

使用项目真实 PostgreSQL 表结构、V023 SSO 表和 V024 保护约束构建隔离夹具，验证了：11 条筛选为 4 条、6 条投票与 4 条评分、账号外键及 JSON 提名身份映射、历史时间保留、账号及 SSO 绑定不变、自动计票不重复、错误事务回滚、重复执行拒绝，以及完整命令行预演/正式流程和 API 自动启动。

生产备份的具体内容只在生产服务器的隔离预演中验证，本机没有读取生产备份。
