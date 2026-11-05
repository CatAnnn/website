# 20261105-ui-02 前后端离线更新

本包包含名册搜索修复和三页 Individual／Team 按钮调整，需同时更新前后端。保留上一版本所有已完成的功能。此次本地 Docker 磁盘故障已恢复，验证使用隔离数据库与测试密钥，不连接生产。

## 修改范围

- 团队成员候选改为来源于 `app/data/BD Namelist.XLSX` 的 561 位员工，独立于已经登录过系统的用户账户。
- 新增登录后可用的 `/api/v1/team-members/search?q=...`，按中英文姓名检索，忽略大小写、兼容姓与名反向顺序、空格及前导 @，最多返回 20 条。
- 名册没有邮箱列，候选显示英文姓名及部门；不推测邮箱、不增加登录账户、不修改原审批名册。原有用户搜索 API 保留。
- `wang weimin`、`weimin wang`、`wangweimin`、`王卫民` 均匹配 `WANG Weimin`。选择后只替换当前成员，保留其他分号分隔的成员。
- Overview、Nomination、Browse & Vote 三页的 Individual／Team 改成等宽大按钮，并在标题下方左对齐，字号小于所在页面标题。小屏幕自动缩放并允许长标题换行。
- 保留上一版本的即时投票、再次点击取消、购物车定位、文本框拖拽等功能。

## 名册更新方式

```powershell
python app/scripts/build-team-member-directory.py
```

生成文件为 `app/hackhub-api/src/main/resources/team-member-directory.json`，编入后端镜像，不将整本 Excel 发送到浏览器。API 仅返回目录标识、姓名及部门。源文件 SHA256：

```text
97471799b379d8e81a99499e7e1b13986f941cf4c3710747b608f0fdc05deb85
```

生成脚本验证表头、必填字段、重复员工编号；目录只来自员工姓名列，不从经理列追加候选。源 Excel 和现有 `nomination-roster.json` 均不改动。今后修改 Excel 后需重新生成目录并构建后端。

## 发布方式

本次需要同时更新后端和前端，镜像为 `hackhub-offline/api:20261105-ui-02`、`hackhub-offline/app:20261105-ui-02`，平台 linux/amd64。无新数据库迁移。用户通过云盾将完成校验的 `20261105-ui-02.tar.gz` 及 `.tar.gz.sha256` 上传至生产服务器 `/opt/hackhub/incoming/`。

上传后先检查生产服务与存储空间：

```bash
docker_root=$(docker info --format '{{.DockerRootDir}}')
df -h "$docker_root" /var/log /opt/hackhub/incoming
df -i "$docker_root"
docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
```

确认现有服务健康，Docker 所在分区建议预留至少 1.5 GiB、incoming 分区至少 1 GiB。之前已扩容的 /var、/var/log 不重复扩容。上次磁盘故障尚未恢复时先恢复服务。

```bash
cd /opt/hackhub/incoming &&
sha256sum -c 20261105-ui-02.tar.gz.sha256 &&
test ! -e 20261105-ui-02 &&
tar -xzf 20261105-ui-02.tar.gz &&
cd 20261105-ui-02 &&
sha256sum -c SHA256SUMS &&
bash update.sh update
```

脚本使用现有 `/opt/hackhub/runtime/compose.sh` 和生产配置，仅替换 APP_IMAGE、API_IMAGE，先启动后端检查健康，再更新前端，检查 Nginx 及公开 API 反向代理。数据库、附件卷、SSO 和其他镜像配置保留。保留本次输出的真实备份目录；失败后停止并使用脚本打印的回滚命令，不会自动回滚。示例：

```bash
bash /opt/hackhub/incoming/20261105-ui-02/update.sh rollback \
  /opt/hackhub/backups/before-20261105-ui-02.XXXXXX
```

将示例后缀替换为真实备份目录。不要用 ui-01 备份路径代替本次路径，不执行 `down -v` 或删除 Docker 数据目录。本包基于云盾堡垒机分支，无新增迁移不代表任意旧版本都不会触发已有迁移。

## 验收

1. 强制刷新浏览器并使用正常 SSO 登录。
2. 团队成员输入 `wang weimin`，出现 `WANG Weimin / BD/SLP-CO`；也验证中文姓名及颠倒姓、名顺序。
3. 添加多个成员，确认选择候选不影响其他已填成员。
4. 检查三页类型按钮位于标题下方，桌面和手机均无重叠。
5. 验证现有提名、投票取消、购物车同步及定位。

## 当前验证状态

- 后端 663 项单元测试与覆盖率门禁通过，包含实际目录查询及接口认证测试。
- 前端 53 项相关测试通过；生产编译通过；lint 无错误，仅两个原有 RealtimeContext 警告。
- Playwright 模拟 API 验证 1440px、768px、390px 三页尺寸、标题层级、间距、无横向溢出，以及名册候选选择。
- 真实 PostgreSQL 的 3 项集成测试通过：新名册接口在空用户数据库下可查询，同时回归原用户搜索。
- 最终前后端镜像在隔离环境中均 healthy，Nginx 配置、首页、公开 API、实际名册的五种查询方式、认证限制和查询长度限制均通过。
- Linux 更新／回滚脚本模拟通过，涵盖新旧 Docker ID 格式、错误镜像拒绝、配置漂移拒绝及其他配置保留。交付校验包含 tar.gz 内外 SHA256、镜像导入、平台、静态资源和后端名册内容一致性。
- 尚未上传或替换生产服务器。
