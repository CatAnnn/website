# 20261104-ui-01 前后端离线更新

本包包含 `hackhub-offline/app:20261104-ui-01` 和 `hackhub-offline/api:20261104-ui-01` 两个 `linux/amd64` 镜像。前端包含本次提名表单和投票页调整，后端提供已登录用户的姓名／邮箱检索接口。此次无数据库迁移。

本次修改未新增迁移；但镜像基于仓库“云盾堡垒机”分支构建，生产原版本仍须与该分支既有接口、配置及迁移状态兼容。若生产落后于此分支，需先核对已有迁移，不能把“本次无新迁移”理解为导入任意旧版本生产都不会迁移。真实服务器更新和浏览器验收须按下文执行。

## 本机构建与验证记录

- 前端相关 47 项测试通过，`npm run build` 成功；lint 为 0 个错误，保留既有 `RealtimeContext` 的 2 个警告。
- 后端 656 项测试及 2 项使用真实 PostgreSQL 的用户检索集成测试通过。
- 最终前端镜像的 Nginx 配置、首页、`/health` 和容器健康检查通过。
- Playwright 使用本地模拟接口检查桌面和 390px 移动端：成员候选下拉、摘要随输入自动增高并推动下方字段、两类投票规则常显、旧计数区移除均通过。
- 源文件 UTF-8 检查通过，验证使用的源码与前端镜像构建上下文一致。部署脚本通过语法及隔离模拟测试，涵盖更新、回滚、新旧 Docker ID 格式、配置漂移和未知导入镜像拒绝。

以上为本地验证记录。尚无堡垒机入口及目标资产信息，未上传或替换生产镜像；真实生产 SSO、成员数据与投票业务验收尚未执行。

上传目录是 `/opt/hackhub/incoming`；现有运行目录是 `/opt/hackhub/runtime`。服务器只导入镜像并重建 `api`、`app` 两个服务，使用服务器现有的 `compose.sh`、Compose、`.env` 和 SSO 配置。包内 `images.env` 仅用于说明版本，不能整份覆盖生产 `images.env`。

## 上传、解压和校验

通过云盾堡垒机的目标资产文件传输功能，将以下两个文件上传至目标服务器 `/opt/hackhub/incoming/`：

- `20261104-ui-01.tar.gz`
- `20261104-ui-01.tar.gz.sha256`

确认目标是实际运行 Docker 的生产资产。上传到跳板机中转目录后，还需通过云盾传输到目标资产。然后在目标服务器终端执行：

```bash
set -e
cd /opt/hackhub/incoming
sha256sum -c 20261104-ui-01.tar.gz.sha256
test ! -e 20261104-ui-01
tar -xzf 20261104-ui-01.tar.gz
cd 20261104-ui-01
sha256sum -c SHA256SUMS
uname -m
docker version
docker compose version
df -h /opt/hackhub
```

校验全部通过、架构为 `x86_64` 后继续。已有同名目录时先核对来源，不覆盖解压。Docker Compose 应支持 `--wait`、`--pull never` 和既有包装脚本使用的多次 `--env-file`。预留压缩包、解压镜像和镜像导入所需空间。

## 更新生产镜像

在可操作 Docker、可写 `/opt/hackhub/runtime` 和 `/opt/hackhub/backups` 的现有运维账号下运行。更新会重建前后端容器，期间可能短暂中断，安排在维护时间执行：

```bash
cd /opt/hackhub/incoming/20261104-ui-01
bash update.sh update
```

脚本会检查现有镜像配置与运行容器是否一致，备份 `images.env`，记录两个实际运行镜像 ID，并为旧镜像保留独立回滚标签；然后导入、核对本包镜像 ID／架构，只修改生产 `APP_IMAGE`、`API_IMAGE` 两行。先等 API 健康，再启动前端并重载 Nginx，核对两个实际运行镜像及健康状态，并通过前端反向代理请求 `/api/v1/public/awards` 验证后端通路。脚本不会修改生产其他配置、SSO、数据库或附件卷。

保存脚本输出的备份路径，例如 `/opt/hackhub/backups/before-20261104-ui-01.ABC123`。任何步骤失败应停止，按输出排查或回滚；不要反复执行更新来掩盖失败。不要执行 `down -v`、清理卷，验收前不要删除回滚镜像标签。

`manifest.tsv` 同时记录构建机的 `image_id` 与镜像配置文件原始字节的 SHA-256 `config_id`。Docker Desktop/containerd 镜像存储可能返回 OCI 索引 ID，旧 Docker Engine 则可能在 `docker load` 后返回配置 ID，因此导入校验接受这两个已随包校验的摘要之一。启动后仍严格比较目标服务器本机的镜像 ID 与容器实际 `.Image`，并核对健康状态；不会因 Docker 版本差异跳过镜像身份检查。

## 浏览器验收

- 通过现有网站入口登录，确认原登录／SSO 可用。
- Team 提名表单：`Nominator Name`、提示文字、照片与附件尺寸、可伸缩文本框显示正常。
- Core Team Member 输入 `@` 后按姓名或邮箱查找现有用户，选择候选后继续填写成员；确认其他成员和已有提名内容保留。
- 用未填写必填项、超限文件验证表单仍提示错误；正常提交或编辑后查看保存内容。
- Team 与 Individual 各显示对应固定投票规则；“Meet this year's nominees”下的计数区已移除，右侧已保存投票、投票／撤销仍正常。

镜像健康检查不能替代以上业务验收。

## 回滚

把下面路径替换为本次更新实际输出的备份目录：

```bash
cd /opt/hackhub/incoming/20261104-ui-01
bash update.sh rollback /opt/hackhub/backups/before-20261104-ui-01.ABC123
```

脚本校验备份中的旧镜像 ID 与保留标签一致，只把两条镜像引用改为旧镜像的回滚标签，保留其他服务之后可能发生的版本更新；依次重建 API、前端，再重载 Nginx并核对健康状态。回滚标签可能不同于原标签，但实际镜像 ID 必须等于更新前记录。此操作不恢复数据库，业务数据保留。
