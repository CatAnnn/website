#!/usr/bin/env bash
# Restore trusted local backups only into a disposable, network-isolated container.
# No production database connection, ports, or production volume mounts.
set -Eeuo pipefail
umask 077
RUNTIME_DIR=${RUNTIME_DIR:-/opt/hackhub/runtime}
REPORT_ROOT=${REPORT_ROOT:-/opt/hackhub/incoming}
backups=()
if [[ $# -gt 0 ]]; then
  backups=("$@")
else
  for root in /opt/hackhub/backups /opt/hackhub/runtime/account-reconcile-reports; do
    if [[ -d "$root" ]]; then
      while IFS= read -r -d '' file; do backups+=("$file"); done < <(find "$root" -maxdepth 5 -type f -name '*.dump' -print0 | sort -z)
    fi
  done
fi
[[ ${#backups[@]} -gt 0 ]] || { echo 'No .dump backups found.' >&2; exit 1; }
for file in "${backups[@]}"; do
  [[ -r "$file" && -s "$file" ]] || { echo "Unreadable or empty backup: $file" >&2; exit 1; }
done
image=${AUDIT_POSTGRES_IMAGE:-}
if [[ -z "$image" ]]; then
  cd "$RUNTIME_DIR"
  production_cid=$(bash compose.sh ps -q postgres)
  test -n "$production_cid"
  image=$(docker inspect "$production_cid" --format '{{.Image}}')
fi
docker image inspect "$image" >/dev/null
test -d "$REPORT_ROOT"
report_dir=$(mktemp -d "$REPORT_ROOT/backup-audit-XXXXXX")
audit_cid=
cleanup() {
  if [[ -n "$audit_cid" ]]; then
    docker rm -fv "$audit_cid" >/dev/null || echo "Temporary container cleanup failed: $audit_cid" >&2
  fi
}
trap cleanup EXIT
# Trust applies only inside this temporary container; it has no network or host ports.
audit_cid=$(docker run -d --pull never --network none --label hackhub.backup-audit=true \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_USER=postgres -e POSTGRES_DB=postgres "$image")
ready=0
for attempt in $(seq 1 60); do
  if docker exec "$audit_cid" pg_isready -U postgres >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]] || { echo 'Temporary PostgreSQL did not start.' >&2; exit 1; }
printf 'Backup inspection only. Report: %s/report.txt\n' "$report_dir"
index=0
failures=0
for file in "${backups[@]}"; do
  index=$((index + 1))
  database="audit_$index"
  printf '\nBACKUP %s: %s\n' "$index" "$file" | tee -a "$report_dir/report.txt"
  if ! docker exec -i "$audit_cid" pg_restore --list < "$file" > "$report_dir/$index.toc" 2> "$report_dir/$index.error.log"; then
    echo "INVALID BACKUP; details saved locally in $report_dir/$index.error.log" | tee -a "$report_dir/report.txt"
    failures=$((failures + 1)); continue
  fi
  docker exec "$audit_cid" createdb -U postgres "$database"
  if ! docker exec -i "$audit_cid" pg_restore -U postgres -d "$database" --no-owner --no-privileges --exit-on-error --single-transaction \
      < "$file" > "$report_dir/$index.restore.log" 2> "$report_dir/$index.error.log"; then
    echo "RESTORE FAILED; details saved locally in $report_dir/$index.error.log" | tee -a "$report_dir/report.txt"
    failures=$((failures + 1)); continue
  fi
  if docker exec -i "$audit_cid" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database" > "$report_dir/$index.summary.txt" 2> "$report_dir/$index.query-error.log" <<'SQL'
BEGIN READ ONLY;
SELECT 'profiles' AS data_set, count(*) AS rows FROM profiles
UNION ALL SELECT 'awards', count(*) FROM hackathons
UNION ALL SELECT 'nominations', count(*) FROM ideas
UNION ALL SELECT 'votes', count(*) FROM idea_votes
UNION ALL SELECT 'judge_scores', count(*) FROM judge_scores;
SELECT h.id, h.title, h.status,
       (SELECT count(*) FROM ideas i WHERE i.hackathon_id=h.id) AS nominations,
       (SELECT count(*) FROM idea_votes v JOIN ideas i ON i.id=v.idea_id WHERE i.hackathon_id=h.id) AS votes
FROM hackathons h ORDER BY h.created_at;
SELECT min(created_at) AS earliest_nomination, max(updated_at) AS latest_nomination_update FROM ideas;
COMMIT;
SQL
  then
    cat "$report_dir/$index.summary.txt" | tee -a "$report_dir/report.txt"
  else
    echo "SUMMARY FAILED; do not interpret as empty. Details: $report_dir/$index.query-error.log" | tee -a "$report_dir/report.txt"
    failures=$((failures + 1))
  fi
  # This database exists only inside the newly created temporary container.
  docker exec "$audit_cid" dropdb -U postgres "$database"
done
printf '\nInspection finished; production database and backups unchanged. Failed inspections: %s\nReport: %s/report.txt\n' "$failures" "$report_dir" | tee -a "$report_dir/report.txt"
[[ "$failures" == 0 ]]
