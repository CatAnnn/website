#!/usr/bin/env bash
# Inspect account references before selective recovery. Never writes to production.
set -Eeuo pipefail
umask 077
BACKUP=${1:-/opt/hackhub/runtime/account-reconcile-reports/apply-20261022-051059-IiNSQe/before.dump}
RUNTIME_DIR=${RUNTIME_DIR:-/opt/hackhub/runtime}
REPORT_ROOT=${REPORT_ROOT:-/opt/hackhub/incoming}
test -r "$BACKUP"
report_dir=$(mktemp -d "$REPORT_ROOT/recovery-preview-XXXXXX")
image=${AUDIT_POSTGRES_IMAGE:-}
if [[ -n "${AUDIT_CURRENT_CSV:-}" ]]; then
  # Offline fixture support; normal production use always performs the read-only export below.
  cp -- "$AUDIT_CURRENT_CSV" "$report_dir/current-profiles.csv"
  test -n "$image"
else
  cd "$RUNTIME_DIR"
  production_cid=$(bash compose.sh ps -q postgres)
  test -n "$production_cid"
  image=$(docker inspect "$production_cid" --format '{{.Image}}')
  bash compose.sh exec -T postgres sh -eu -c 'PGOPTIONS="-c default_transaction_read_only=on" psql -Xq -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "COPY (SELECT p.id,p.email,p.name,p.role,p.org_code,EXISTS(SELECT 1 FROM sso_identities s WHERE s.profile_id=p.id) AS sso_linked FROM profiles p ORDER BY p.id) TO STDOUT WITH CSV HEADER"' > "$report_dir/current-profiles.csv"
fi
audit_cid=
cleanup() { if [[ -n "$audit_cid" ]]; then docker rm -fv "$audit_cid" >/dev/null; fi; }
trap cleanup EXIT
audit_cid=$(docker run -d --pull never --network none --label hackhub.backup-audit=true \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_USER=postgres -e POSTGRES_DB=award_preview "$image")
ready=0
for attempt in $(seq 1 60); do
  if docker exec "$audit_cid" pg_isready -U postgres >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
test "$ready" = 1
if ! docker exec -i "$audit_cid" pg_restore -U postgres -d award_preview --no-owner --no-privileges --exit-on-error --single-transaction \
    < "$BACKUP" > "$report_dir/restore.log" 2> "$report_dir/restore-errors.log"; then
  echo "Temporary restore failed. Local error file: $report_dir/restore-errors.log" >&2
  exit 1
fi
docker exec "$audit_cid" psql -Xq -v ON_ERROR_STOP=1 -U postgres -d award_preview \
  -c 'CREATE TABLE recovery_current_profiles(id uuid PRIMARY KEY,email text,name text,role text,org_code text,sso_linked boolean)'
docker exec -i "$audit_cid" psql -Xq -v ON_ERROR_STOP=1 -U postgres -d award_preview \
  -c 'COPY recovery_current_profiles FROM STDIN WITH CSV HEADER' < "$report_dir/current-profiles.csv"
printf 'Source backup: %s\nREAD-ONLY production export; all comparisons run in a temporary container.\n' "$BACKUP" | tee "$report_dir/report.txt"
docker exec -i "$audit_cid" psql -X -v ON_ERROR_STOP=1 -U postgres -d award_preview <<'SQL' | tee -a "$report_dir/report.txt"
BEGIN READ ONLY;
\pset pager off
\echo 'CURRENT ACCOUNTS (passwords, tokens and SSO identifiers excluded):'
SELECT id,name,email,role,org_code,sso_linked FROM recovery_current_profiles ORDER BY name;
\echo 'BACKUP ACCOUNT COMPARISON (same email is only a review hint, not a merge instruction):'
SELECT p.id AS backup_id,p.name,p.email,
       CASE WHEN c.id IS NOT NULL THEN 'SAME_UUID'
            WHEN e.id IS NOT NULL THEN 'DIFFERENT_UUID_SAME_EMAIL_REVIEW'
            ELSE 'MISSING_FROM_CURRENT' END AS account_status,
       coalesce(c.id,e.id) AS current_id_candidate,
       (SELECT count(*) FROM hackathons h WHERE h.created_by=p.id) AS awards_owned,
       (SELECT count(*) FROM ideas i WHERE i.created_by=p.id) AS nominations_created,
       (SELECT count(*) FROM idea_votes v WHERE v.user_id=p.id) AS votes_cast,
       (SELECT count(*) FROM judge_scores j WHERE j.judge_id=p.id) AS scores_cast
FROM profiles p LEFT JOIN recovery_current_profiles c ON c.id=p.id
LEFT JOIN recovery_current_profiles e ON c.id IS NULL AND lower(e.email)=lower(p.email)
ORDER BY account_status,p.email;
\echo 'NOMINATION INVENTORY: title, original nominee and account availability:'
SELECT i.id,i.title,i.status,
       p.name AS nominee_name,p.email AS nominee_email,
       CASE WHEN c.id IS NOT NULL THEN 'SAME_UUID_PRESENT' ELSE 'ACCOUNT_MISSING_REVIEW' END AS nominee_account,
       (SELECT count(*) FROM idea_votes v WHERE v.idea_id=i.id) AS votes,
       (SELECT count(*) FROM judge_scores s WHERE s.idea_id=i.id) AS scores
FROM ideas i
LEFT JOIN LATERAL (
    SELECT a->>'nomineeUserId' AS nominee_id FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(i.project_attachments)='array' THEN i.project_attachments ELSE '[]'::jsonb END
    ) a WHERE a->>'type'='nomination' LIMIT 1
) n ON true
LEFT JOIN profiles p ON p.id::text=coalesce(nullif(n.nominee_id,''),i.created_by::text)
LEFT JOIN recovery_current_profiles c ON c.id=p.id
ORDER BY i.created_at,i.id;
\echo 'ORIGINAL CAMPAIGN OWNER:'
SELECT h.id,h.title,h.status,p.id AS creator_id,p.email AS creator_email,
       (c.id IS NOT NULL) AS creator_still_exists,h.organization_id
FROM hackathons h JOIN profiles p ON p.id=h.created_by
LEFT JOIN recovery_current_profiles c ON c.id=p.id;
COMMIT;
SQL
printf '\nPreview complete; production accounts, SSO bindings and business data unchanged.\nReport: %s/report.txt\n' "$report_dir" | tee -a "$report_dir/report.txt"
