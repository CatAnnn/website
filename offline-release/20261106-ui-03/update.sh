#!/usr/bin/env bash
# 仅更新本次发布的前后端镜像，保留生产配置、数据库和附件卷。
set -euo pipefail
umask 077
PACKAGE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
RUNTIME=/opt/hackhub/runtime
VERSION=20261106-ui-03
MODE=${1:-}
BACKUP=${2:-}
[[ "$MODE" == update || "$MODE" == rollback ]] || {
  echo '用法：bash update.sh update | bash update.sh rollback /opt/hackhub/backups/备份目录' >&2
  exit 1
}
[[ -d "$RUNTIME" && -f "$RUNTIME/compose.sh" && -f "$RUNTIME/images.env" && -f "$RUNTIME/.env" ]] || {
  echo '缺少现有生产运行目录或配置，已停止。' >&2; exit 1;
}
cd "$RUNTIME"
bash compose.sh config --quiet
for key in APP_IMAGE API_IMAGE; do
  [[ $(grep -c "^${key}=" images.env) -eq 1 ]] || { echo "$key 必须恰好一行。" >&2; exit 1; }
done

image_id() { docker image inspect --format '{{.Id}}' "$1"; }
container_id() {
  local cid
  cid=$(bash compose.sh ps -q "$1")
  [[ -n "$cid" && "$cid" != *$'\n'* ]] || { echo "$1 必须有且只有一个运行容器。" >&2; return 1; }
  printf '%s\n' "$cid"
}
verify_service() {
  local service=$1 expected=$2 cid
  cid=$(container_id "$service")
  [[ $(docker inspect --format '{{.Image}}' "$cid") == "$expected" ]]
  [[ $(docker inspect --format '{{.State.Status}}' "$cid") == running ]]
  [[ $(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$cid") == healthy ]]
}
replace_images() {
  local app_ref=$1 api_ref=$2 temporary
  # 同目录临时文件替换，且仅修改两行镜像引用。
  temporary=$(mktemp "$RUNTIME/images.env.ui-update.XXXXXX")
  sed -e "s|^APP_IMAGE=.*|APP_IMAGE=$app_ref|" -e "s|^API_IMAGE=.*|API_IMAGE=$api_ref|" images.env > "$temporary"
  chmod --reference=images.env "$temporary"
  mv -- "$temporary" images.env
  bash compose.sh config --quiet
}

if [[ "$MODE" == update ]]; then
  [[ $# -eq 1 ]] || { echo 'update 不接受额外参数。' >&2; exit 1; }
  (cd "$PACKAGE" && sha256sum -c SHA256SUMS)
  [[ $(docker info --format '{{.OSType}}/{{.Architecture}}') =~ ^linux/(x86_64|amd64)$ ]] || {
    echo '本包仅支持 Linux x86_64/amd64。' >&2; exit 1;
  }
  # 先记录正在运行的镜像；现有配置和容器不同步时不自动覆盖。
  for service in app api; do
    key=$(printf '%s' "$service" | tr '[:lower:]' '[:upper:]')_IMAGE
    ref=$(sed -n "s/^${key}=//p" images.env)
    cid=$(container_id "$service")
    running_id=$(docker inspect --format '{{.Image}}' "$cid")
    [[ $(image_id "$ref") == "$running_id" ]] || {
      echo "$service 的 images.env 与运行镜像不一致，请先检查。" >&2; exit 1;
    }
  done
  mkdir -p /opt/hackhub/backups
  BACKUP=$(mktemp -d "/opt/hackhub/backups/before-${VERSION}.XXXXXX")
  cp -p images.env "$BACKUP/images.env"
  printf '备份目录：%s\n' "$BACKUP"
  for service in app api; do
    cid=$(container_id "$service")
    running_id=$(docker inspect --format '{{.Image}}' "$cid")
    printf '%s\n' "$running_id" > "$BACKUP/$service.image-id"
    rollback_ref="hackhub-offline/$service:rollback-$(basename "$BACKUP")"
    docker tag "$running_id" "$rollback_ref"
    printf '%s\n' "$rollback_ref" > "$BACKUP/$service.rollback-ref"
    [[ $(image_id "$rollback_ref") == "$running_id" ]]
  done
  for service in api app; do
    docker load -i "$PACKAGE/images/$service.tar"
    expected=$(awk -F '\t' -v service="$service" '$1 == service { print $3 }' "$PACKAGE/manifest.tsv")
    config_id=$(awk -F '\t' -v service="$service" '$1 == service { print $5 }' "$PACKAGE/manifest.tsv")
    [[ "$expected" =~ ^sha256:[0-9a-f]{64}$ ]]
    [[ "$config_id" =~ ^sha256:[0-9a-f]{64}$ ]]
    # 兼容旧 Engine 的配置摘要和新版 containerd 镜像存储的索引摘要。
    loaded_id=$(image_id "hackhub-offline/$service:$VERSION")
    [[ "$loaded_id" == "$expected" || "$loaded_id" == "$config_id" ]]
    [[ $(docker image inspect --format '{{.Os}}/{{.Architecture}}' "hackhub-offline/$service:$VERSION") == linux/amd64 ]]
  done
  app_ref="hackhub-offline/app:$VERSION"
  api_ref="hackhub-offline/api:$VERSION"
else
  [[ $# -eq 2 && -d "$BACKUP" ]] || { echo '请提供真实备份目录。' >&2; exit 1; }
  BACKUP=$(cd -- "$BACKUP" && pwd)
  [[ "$BACKUP" == /opt/hackhub/backups/before-20261106-ui-03.* ]] || {
    echo '备份目录不属于本次发布。' >&2; exit 1;
  }
  for service in app api; do
    ref=$(cat "$BACKUP/$service.rollback-ref")
    [[ "$ref" == "hackhub-offline/$service:rollback-$(basename "$BACKUP")" ]]
    [[ $(image_id "$ref") == "$(cat "$BACKUP/$service.image-id")" ]]
  done
  app_ref=$(cat "$BACKUP/app.rollback-ref")
  api_ref=$(cat "$BACKUP/api.rollback-ref")
fi

# 切换前后均核对实际镜像；失败时保留备份，并给出明确回滚命令。
trap 'printf "操作失败。备份目录：%s\n回滚命令：bash %q rollback %q\n" "$BACKUP" "$PACKAGE/update.sh" "$BACKUP" >&2' ERR
replace_images "$app_ref" "$api_ref"
bash compose.sh up -d --no-deps --no-build --pull never --wait --wait-timeout 300 api
verify_service api "$(image_id "$api_ref")"
bash compose.sh up -d --no-deps --no-build --pull never --wait --wait-timeout 180 app
verify_service app "$(image_id "$app_ref")"
# 回滚或容器复用时，重载以重新解析后端容器地址。
bash compose.sh exec -T app nginx -t
bash compose.sh exec -T app nginx -s reload
bash compose.sh exec -T app wget -qO- http://127.0.0.1/health
# 经前端反向代理验证后端公开接口，丢弃业务响应内容。
bash compose.sh exec -T app wget -qO- http://127.0.0.1/api/v1/public/awards > /dev/null
bash compose.sh ps -a
trap - ERR
printf '\n镜像切换与容器健康检查完成。备份目录：%s\n请继续在浏览器验证登录、成员搜索及投票页面。\n' "$BACKUP"
