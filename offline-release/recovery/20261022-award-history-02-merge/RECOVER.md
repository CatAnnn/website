# 合并恢复旧提名：20261022-award-history-02-merge

本包替代之前要求生产活动为空的 history-01 包。只处理数据库历史记录，不含镜像，不修改网站代码。生产操作由用户执行；本地测试不代表生产已经恢复。

## 用户已确认的合并范围

- 当前活动：`23680a03-54bf-43f1-8e28-cd400a957a66`，2026 Digital Pioneer Award。
- 原样保留新提名：`a70b3411-b01e-4e22-ad4d-e264369d62ac`，Yaolong Zhang。
- 从历史活动 `3c3eb377-23c9-4e82-807c-d9af5e790f12` 中恢复 4 条提名：Yining.MA 一条、Yaolong.Zhang 两条、Lynette 一条。将这些记录的活动关联改为当前活动。
- 最终同一个活动有 5 条提名，新增 6 条历史投票记录、4 条评委评分记录。
- 排除全部 bd-test 账号及其对应的 7 条提名，不恢复旧账号。
- 将旧账号 aah5sgh@bosch.com 的历史业务关联和提名 JSON 内的账号 ID 迁移到当前 fixed-term.Yaolong.ZHANG@cn.bosch.com 账号。
- 保留当前活动的名称、描述、起止日期、可见性、评审模式等全部字段，包括当前 draft 状态；不自动发布活动。
- 保留现有账号、密码、角色、部门、SSO 绑定、.env、Compose、镜像版本及现有业务记录。不按姓名合并或删除提名。

默认读取历史备份：

```text
/opt/hackhub/runtime/account-reconcile-reports/apply-20261022-051059-IiNSQe/before.dump
```

## 1. 上传与预演

将本 ZIP 和同名 `.zip.sha256` 文件通过 SFTP 上传到 `/opt/hackhub/incoming/`，然后执行：

```bash
bash -euo pipefail <<'SH'
cd /opt/hackhub/incoming
sha256sum -c 20261022-award-history-02-merge.zip.sha256
python3 -m zipfile -e 20261022-award-history-02-merge.zip .
cd 20261022-award-history-02-merge
bash recover.sh
SH
```

默认仅预演：读取生产备份，在隔离 PostgreSQL 容器内恢复历史库及当前库，验证完整合并事务。不修改生产数据库，不暂停 API。临时容器无网络、无开放端口，也不挂载生产数据卷。

成功应显示：

```text
Rehearsal passed. Selected rows: ...
Target campaign: 23680a03-54bf-43f1-8e28-cd400a957a66; preserved 1 existing nomination, added 4; total 5.
Preview complete. No production data was changed.
```

Selected rows 是“新增记录数”：`hackathons=0`、`ideas=4`、`idea_votes=6`、`judge_scores=4`。活动本身不重新插入，所以 hackathons 为 0 正常。其他关联表数量由真实备份确定。

如果出现 STOP，不继续正式恢复，反馈终端摘要。若提示评分标准不一致，可反馈本次报告目录中的 `criteria-review.json`，其中仅列标准名称、权重和说明。不要发送 before.dump、recovery.sql 或 private.log 全文。

## 2. 正式合并

只有预演成功后执行：

```bash
bash -euo pipefail <<'SH'
cd /opt/hackhub/incoming/20261022-award-history-02-merge
bash recover.sh --apply
SH
```

正式模式会短暂停止 API，备份生产库并重新隔离预演，成功后执行单个事务，再启动原 API 容器并等待健康。期间 API 请求可能暂时失败。

按目前提供的生产状态，成功输出应包含：

```text
awards|1
nominations|5
votes|6
judge_scores|4
Database recovery committed.
Production API: healthy
```

上述末尾数字是生产总数；若运行前又产生投票，现有投票会保留，最终总数为原有数量加 6。若出现新的提名，则超出这次确认的 1+4 范围，脚本会停止，避免自行决定新的合并范围。

## 3. 合并与保护机制

- 只插入确认的历史记录，不 UPDATE/DELETE 现有业务记录，不覆盖现有活动。
- 事务锁定相关表，核对生产账号/SSO 和业务数据是否与演练快照一致。
- 每张涉及表的现有行都会在事务内保留快照，提交前逐行核对内容完全不变，并检查每张表的新增数量。
- 若旧提名 ID 已经存在，拒绝重复导入；不会用 ON CONFLICT 忽略冲突后假报成功。
- 当前评分标准与历史标准名称、权重、说明一致时，复用当前标准 ID；缺失的标准按历史记录补入；含义或权重冲突时停止，不自动改评分规则。当前已存在的评委分配保持不变。
- 为避免错误合并团队成员及访问权限，遇到团队同名时，仅给新导入的历史团队名称添加 `[restored-历史团队ID]` 后缀。现有团队不变，处理结果记入 summary.json。
- 原始提名、投票、评分时间保留。计票触发器保持启用，导入提名时初始票数为 0，再逐条导入投票，避免票数重复累计。提名更新时间触发器仅在事务内临时关闭以保留历史时间，提交前恢复；外键始终启用。
- 任何提交前错误都会回滚；脚本会尝试自动启动 API。
- 每次报告及生产备份保存在输出的独立 `/opt/hackhub/incoming/award-recovery-XXXXXX/` 目录，权限受 umask 077 保护。

## 4. 恢复后检查与异常处理

1. 刷新 Browse & Vote，确认同一活动下共 5 条提名；新建的那一条保留，历史的两条 Yaolong 提名也分别保留。
2. 查看历史详情、投票记录和评委评分。图片地址保留，但图片文件本身在 MinIO 中，数据库恢复不能补回已删除的文件。
3. 当前活动仍为 draft。本包不自动发布；如果需要开放活动，管理员应核对日期和设置后按网站现有流程操作。
4. Department 不会因本次历史恢复自动补齐，仍需 Entra 向 ID token 下发 department，并由员工重新完成 SSO 登录同步。
5. 如果连接断开，不要盲目重跑：检查报告目录的 COMMITTED 文件和生产记录数量。单凭没看到成功文字不能断言未提交。
6. API 未恢复健康时，可以检查并启动原容器：

```bash
cd /opt/hackhub/runtime
bash compose.sh start api
bash compose.sh ps
```

不要整库覆盖生产、清空表、删除活动、执行 down -v 或删除数据卷。恢复后的新业务操作需要保留；如需回退，先核对当前数据，再制定定向回退步骤。

## 5. 本地验证

基于项目真实 PostgreSQL schema、V023 SSO 绑定表和 V024 保护约束，测试了：

- 当前活动 draft 状态和全部字段、现有提名和其他现有记录原样保留。
- 1+4=5 条提名、6 条历史投票、4 条评分及账号/JSON 身份映射。
- 当前评分标准为空时导入、相同时复用，不同名称/权重/说明时拒绝。
- 同名团队隔离、现有评委分配复用、历史时间与计票正确。
- 错误事务回滚、数据变化拒绝、重复执行拒绝。
- 完整 CLI 预演、正式流程以及成功/失败后的 API 启动检查（隔离测试容器）。

本地测试使用夹具，不包含生产备份；生产实际数据的兼容性由服务器上的隔离预演验证。
