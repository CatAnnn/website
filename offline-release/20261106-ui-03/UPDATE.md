# 20261106-ui-03 前后端离线更新

本包调整三页类型按钮、完善名册关键词搜索，并移除提名表单的字数计数显示。需同时更新前后端；生产服务器由用户通过云盾上传并执行更新。

## 修改范围

- Overview、Nomination、Browse & Vote 的 Individual／Team 保持在主标题下方，保留按钮高度和上下间距，整组横向长度约为上方主标题的一半。标题较短或手机屏幕下保留文字所需的最小空间。字号参照 Customer Values。
- Core Team Member 使用 `app/data/BD Namelist.XLSX` 的员工名册。支持 `@` 或全角 `＠` 开头的中文、英文关键词，中文可输入一个汉字，英文至少两个字符；兼容中文输入法组合输入。
- 多成员支持英文分号 `;` 和中文分号 `；` 分隔，选择候选时保留其他成员。支持大小写、姓名顺序及连续英文姓名匹配，最多返回 20 条候选。
- 移除 Team 的 Achievement Summary 下方 `0 / 200 words` 等实时计数显示；Individual 原本没有该计数，保留现状。原有 200 words 上限及超限提示保留。
- 保留现有即时投票、再次点击取消、购物车同步及定位、提名审批和文本框拖拽功能。

## 名册与数据边界

名册由 `app/scripts/build-team-member-directory.py` 从员工姓名列生成，编入后端镜像；不从经理列追加人员，不将整本 Excel 发送到浏览器，不猜测邮箱，不创建账户，也不修改现有审批名册。

接口 `/api/v1/team-members/search?q=...` 需要登录，仅返回目录标识、英文姓名及部门，查询上限 200 字符。今后更新 Excel 后需重新生成目录并重新构建后端。

## 上传和更新

镜像为 `hackhub-offline/api:20261106-ui-03` 与 `hackhub-offline/app:20261106-ui-03`，平台 linux/amd64。本次无新增数据库迁移。将以下两个文件上传至实际生产资产的 `/opt/hackhub/incoming/`：

- `20261106-ui-03.tar.gz`
- `20261106-ui-03.tar.gz.sha256`

先确认当前服务健康及磁盘空间：

```bash
docker_root=$(docker info --format '{{.DockerRootDir}}')
df -h "$docker_root" /var/log /opt/hackhub/incoming
df -i "$docker_root"
docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
```

Docker 所在分区建议至少预留 1.5 GiB，incoming 分区至少 1 GiB。此前完成的 /var、/var/log 扩容不需重复执行。若现有服务异常，先检查日志并恢复。

```bash
cd /opt/hackhub/incoming &&
sha256sum -c 20261106-ui-03.tar.gz.sha256 &&
test ! -e 20261106-ui-03 &&
tar -xzf 20261106-ui-03.tar.gz &&
cd 20261106-ui-03 &&
sha256sum -c SHA256SUMS &&
bash update.sh update
```

若解压目录已存在，上述命令会停止，以免覆盖已有内容。先核实目录及校验结果，不直接删掉或覆盖。

脚本使用 `/opt/hackhub/runtime/compose.sh` 和现有生产配置，备份实际镜像和 `images.env`，仅切换 APP_IMAGE、API_IMAGE。先更新后端并等待健康，再更新前端，核对 Nginx 和公开 API 反向代理。数据库、附件卷、SSO 和其他镜像配置保留。

保存本次输出的真实备份目录。若更新失败，停止后续操作，记录日志，并使用脚本打印的回滚命令。示例中的后缀必须替换为本次真实值：

```bash
bash /opt/hackhub/incoming/20261106-ui-03/update.sh rollback \
  /opt/hackhub/backups/before-20261106-ui-03.XXXXXX
```

不要使用旧发布的备份路径，不执行 `down -v` 或删除 Docker 数据目录。本包基于云盾堡垒机分支；本次无新增迁移，不代表任意更老版本均不会触发分支已有迁移。

## 浏览器验收

1. 强制刷新浏览器并通过正常 SSO 登录。
2. 检查三页 Individual／Team 位于标题下方、长度缩短、字号与 Customer Values 协调，桌面和手机均无重叠或截字。
3. 在 Core Team Member 输入 `@王`、`@王卫民`、`@wang`、`＠WANG Weimin`；核对名单候选及部门。尝试中文输入法选字后搜索。
4. 输入多个成员，分别使用 `;` 和 `；` 分隔，选择候选后确认其他成员保留。
5. 检查团队 Achievement Summary 下方不再显示 `/ 200 words` 计数，超过上限仍提示并阻止提交。
6. 验证投票、取消、购物车同步及定位。

## 验证状态

- Linux 更新／回滚脚本模拟已通过，覆盖索引摘要与配置摘要两种 Docker ID、服务切换顺序、无关配置保留、配置漂移拒绝及错误镜像拒绝。
- 后端 665 项单元测试全部通过，无失败、错误或跳过，覆盖率门禁通过。
- 前端 55 项相关测试通过。受本机测试进程和既有裁剪用例耗时影响，分拆单 worker 执行并给相关测试 30 秒超时；未为通过测试修改业务逻辑。生产构建通过，lint 无错误、两个原有警告。
- Playwright 模拟 API 验证 1440px、768px、390px 下三页布局及成员搜索选择通过，截图已检查。
- 最终前后端镜像在独立内部网络与 tmpfs PostgreSQL 中均为 healthy，Nginx 配置检查通过；未连接生产数据库或附件存储。
- 经最终 Nginx 反向代理验证 10 个唯一人员查询、4 个中英文关键词查询，并与源名册核对身份、排序及数量上限；单汉字、全角＠、认证 401、超长查询 400、首页和公开接口均通过。
- 离线包生成后须运行 verify_release.py，校验压缩包内外 SHA256、镜像导入／身份／架构、最终静态文件与名册一致性；该检查此时尚未执行。
- 当前尚未上传或更新生产服务器。
