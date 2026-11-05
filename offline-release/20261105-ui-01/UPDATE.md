# 20261105-ui-01 离线更新说明

## 本次内容

- 点击 Vote 立即保存；保存完成后再次点击 Submitted 立即取消。请求中禁用按钮以避免重复操作，失败时保留原状态并提示错误。
- 右侧 My votes 与服务器确认后的投票同步。点击条目空白区域或姓名／头像定位对应卡片；自动切换 Individual／Team 并清除筛选，小屏幕收起购物车。View details 和 Delete 保留原功能。
- Overview 的 Individual／Team 位于 Award categories and criteria 下方；提名页同类按钮位于 Choose an award category 下方，上下留白。
- Nomination already submitted 标题紫色，说明白色。
- 表单占位提示改为浅灰色、12px；输入正文保留原样。文本框可纵向拖拽，保留随内容自动增高。团队附件提示改为 Optional supplementary materials, document size less than 20 MB，并拒绝大于或等于 20 MiB 的新附件；团队照片仍为 10 MB，个人文件限制不变，已有附件保留。

包含两个 linux/amd64 镜像：

- `hackhub-offline/app:20261105-ui-01`：本次新前端。
- `hackhub-offline/api:20261105-ui-01`：与 20261104-ui-01 后端完全相同的镜像，重新标记版本，保留成员搜索接口。此次未修改后端或新增数据库迁移。

## 上传前后检查

将 `20261105-ui-01.tar.gz` 和 `20261105-ui-01.tar.gz.sha256` 通过云盾上传至实际生产资产的 `/opt/hackhub/incoming/`。

先确认上次磁盘故障已恢复、现有服务健康。Docker 的容器 /tmp 使用 Docker 存储空间，宿主机 /tmp 空闲不能替代 /var 空间：

```bash
docker_root=$(docker info --format '{{.DockerRootDir}}')
df -h "$docker_root" /var/log /opt/hackhub/incoming
df -i "$docker_root"
docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
```

本次建议 Docker 所在分区至少预留 1.5 GiB、incoming 所在分区至少预留 1 GiB，具体增量取决于已有镜像共享层。你此前已成功将 /var 扩到 8 GiB、/var/log 扩到 3 GiB，**不要重复执行 lvextend**。若 API 仍 restarting/unhealthy，先检查最新日志并恢复现有服务，不继续叠加发布。原故障的备份仍可用时，完成原版本回滚命令：

```bash
bash /opt/hackhub/incoming/20261104-ui-01/update.sh rollback \
  /opt/hackhub/backups/before-20261104-ui-01.NlFt3O
```

## 校验和更新

使用现有可操作 Docker、可写运行目录和备份目录的运维账号。仅在上述服务健康和空间检查通过后执行：

```bash
cd /opt/hackhub/incoming &&
sha256sum -c 20261105-ui-01.tar.gz.sha256 &&
test ! -e 20261105-ui-01 &&
tar -xzf 20261105-ui-01.tar.gz &&
cd 20261105-ui-01 &&
sha256sum -c SHA256SUMS &&
bash update.sh update
```

同名目录存在时不覆盖解压，先核对来源；任一步失败即停止并查看输出。更新会短暂重建应用容器，安排在维护时间执行。

脚本使用现有 `/opt/hackhub/runtime/compose.sh`，备份原 images.env、保存实际镜像 ID 并添加回滚标签，只替换 APP_IMAGE 与 API_IMAGE。先检查 API 健康，再更新 app，检查 Nginx、/health 和反向代理的公开 API。保留现有 .env、Compose、SSO、数据库和附件卷；包内 images.env 不可整份覆盖生产。不会自动执行回滚。

manifest 同时记录 OCI 索引 ID 和配置 ID，兼容新旧 Docker Engine。启动后仍核对容器实际镜像 ID 和健康状态。本包基于云盾堡垒机分支，现有生产需兼容该分支已有配置和迁移；本次未新增迁移不代表任意旧版本都不会触发既有迁移。

## 验收与回滚

保存本次脚本输出的 `before-20261105-ui-01.XXXXXX` 备份目录。失败时执行脚本打印的完整回滚命令；手动形式如下，将示例目录替换为本次真实路径：

```bash
bash /opt/hackhub/incoming/20261105-ui-01/update.sh rollback \
  /opt/hackhub/backups/before-20261105-ui-01.XXXXXX
```

回滚恢复前后端镜像，不回滚数据库，不删除卷。不要使用 down -v、清空 Docker 数据目录或删除回滚镜像。容器异常时收集最新输出：

```bash
docker logs --tail 150 hackhub-api
docker inspect --format '{{json .State}}' hackhub-api
docker inspect --format '{{json .State}}' hackhub-app
```

浏览器强制刷新后核验：

1. 原登录／SSO 正常，两个页面的类型切换与标题、卡片无重叠。
2. 测试账号对候选人投票，购物车增加；再次点击取消，购物车移除；刷新页面结果一致。
3. 切换类型或设置筛选后点击购物车候选人，可回到正确卡片；详情和删除仍独立可用。
4. 已提名提示颜色、团队字段占位提示、文本框拖拽、成员搜索和附件限制正确。

## 本地验证记录

53 项相关前端测试通过；生产构建成功；lint 0 错误，2 个原有 RealtimeContext 警告。首次并行运行有一项原图片裁剪测试超时，降低测试并发后全部通过，未修改该功能。

Playwright 使用本地模拟 API，在 1440px 和 390px 下检查间距、颜色、无横向溢出及实际鼠标拖拽；投票／取消、购物车数量与跨类型筛选定位通过。未连接生产 SSO、真实投票数据或 WebSocket，真实业务需按上述步骤验收。

更新脚本通过 Linux 语法检查及隔离模拟的更新、回滚、配置漂移拒绝、未知镜像拒绝、新旧 ID 格式检查。后端沿用上一包已完成单元和 PostgreSQL 集成验证的镜像。本次由用户自行上传替换，尚未操作生产服务器。
