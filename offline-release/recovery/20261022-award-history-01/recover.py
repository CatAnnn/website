#!/usr/bin/env python3
"""One-off, explicitly scoped recovery; uses only Python's standard library."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import tempfile
import time

OLD = '5ff81e0f-f183-4b6d-8538-39e42549ed41'
NEW = 'e609070a-941e-468d-8478-5afdf52000e6'
EMAIL = 'fixed-term.Yaolong.ZHANG@cn.bosch.com'
AWARD = '3c3eb377-23c9-4e82-807c-d9af5e790f12'
KEEP = {'ceb63c92-87e9-4a3f-a1cc-fa0188a6f9ad',
        '6db2e246-3430-44a7-b2d4-c34870da8b26',
        'a2d1d76d-1a27-49b2-b4ff-c4935594abeb',
        '7fbeea4b-d85e-4c0d-bf89-e28c6f170463'}
TABLES = ('hackathons', 'teams', 'team_members', 'voting_criteria',
          'hackathon_judges', 'ideas', 'idea_votes', 'idea_scores',
          'judge_scores', 'final_submissions', 'comments')
USER_FIELDS = ('created_by', 'user_id', 'judge_id', 'invited_by', 'submitted_by')
DEFAULT_BACKUP = '/opt/hackhub/runtime/account-reconcile-reports/apply-20261022-051059-IiNSQe/before.dump'


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def account_fingerprint_sql():
    return "SELECT md5(COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY id)::text FROM profiles p),'[]') || COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY tenant_id,object_id)::text FROM sso_identities s),'[]'))"


def prepare(old, current):
    profiles = {p['id']: p for p in old['profiles']}
    live = {p['id']: p for p in current}
    require(NEW in live and live[NEW]['email'].lower() == EMAIL.lower()
            and live[NEW]['role'] == 'admin' and live[NEW]['sso_linked'],
            'Target SSO administrator does not match the approved mapping.')
    require(OLD not in live and not any(p['email'].lower().startswith('bd-test') for p in live.values()),
            'Current accounts differ from the reviewed state; stop for review.')
    require(OLD in profiles and profiles[OLD]['email'].lower() == 'aah5sgh@bosch.com',
            'Historical account does not match.')
    require(len(old['ideas']) == 11 and len(old['idea_votes']) == 17
            and len(old['judge_scores']) == 14, 'Backup totals differ from the reviewed inventory.')
    excluded = {p['id'] for p in profiles.values() if p['email'].lower().startswith('bd-test')}
    require(len(excluded) == 6, 'Expected six excluded test accounts.')

    def nominee_ids(row):
        entries = row.get('project_attachments') or []
        require(isinstance(entries, list), 'Unexpected nomination metadata format.')
        ids = [a.get('nomineeUserId') or row['created_by'] for a in entries if a.get('type') == 'nomination']
        return ids or [row['created_by']]

    selected = [i for i in old['ideas'] if i['created_by'] not in excluded
                and not (set(nominee_ids(i)) & excluded)]
    require({i['id'] for i in selected} == KEEP, 'Filtered nominations differ from the approved four IDs.')
    require(all(i['hackathon_id'] == AWARD for i in selected), 'Unexpected nomination campaign.')
    campaigns = [h for h in old['hackathons'] if h['id'] == AWARD]
    require(len(campaigns) == 1 and campaigns[0]['created_by'] == OLD
            and campaigns[0]['organization_id'] is None, 'Unexpected campaign ownership or organization.')
    team_ids = {i['team_id'] for i in selected if i['team_id']}
    payload = {'hackathons': campaigns,
               'teams': [t for t in old['teams'] if t['id'] in team_ids],
               'team_members': [t for t in old['team_members'] if t['team_id'] in team_ids and t['user_id'] not in excluded],
               'voting_criteria': [r for r in old['voting_criteria'] if r['hackathon_id'] == AWARD],
               'hackathon_judges': [r for r in old['hackathon_judges'] if r['hackathon_id'] == AWARD and r['user_id'] not in excluded],
               'ideas': selected}
    for table in ('idea_votes', 'idea_scores', 'judge_scores', 'comments'):
        payload[table] = [r for r in old[table] if r['idea_id'] in KEEP
                          and r.get('user_id', r.get('judge_id')) not in excluded]
    payload['final_submissions'] = [r for r in old['final_submissions'] if r['hackathon_id'] == AWARD
                                   and (r['idea_id'] in KEEP or (r['idea_id'] is None and r['team_id'] in team_ids))
                                   and r['submitted_by'] not in excluded]
    require(len(payload['idea_votes']) == 6 and len(payload['judge_scores']) == 4,
            'Selected votes/scores differ from approved totals.')
    require({t['id'] for t in payload['teams']} == team_ids, 'Missing nomination team.')
    for table, rows in payload.items():
        for row in rows:
            for field in USER_FIELDS:
                value = row.get(field)
                if value == OLD:
                    row[field] = NEW
                elif value in excluded and field == 'invited_by':
                    row[field] = None
                if row.get(field) is not None:
                    require(row[field] in live, 'Unresolved account reference in ' + table + '.' + field)
    for row in selected:
        entries = row.get('project_attachments') or []
        for entry in entries:
            if entry.get('type') == 'nomination':
                nominee = entry.get('nomineeUserId') or row['created_by']
                nominee = NEW if nominee == OLD else nominee
                require(nominee in live, 'Unresolved nominee identity.')
                entry['nomineeUserId'] = nominee
                # Preserve original photo URLs/descriptions and use the live identity label.
                entry['name'] = live[nominee]['name']
                if live[nominee].get('org_code'):
                    entry['nomineeOrgCode'] = live[nominee]['org_code']
        row['project_attachments'] = entries
        # The production AFTER INSERT trigger will count each imported vote once.
        row['votes'] = 0
    return payload


def build_sql(payload, fingerprint):
    require(bool(re.fullmatch('[a-f0-9]{32}', fingerprint)), 'Invalid account fingerprint.')
    parts = ["\\set ON_ERROR_STOP on", "BEGIN;", "SET LOCAL lock_timeout='15s';",
             "SET LOCAL statement_timeout='120s';", "SET LOCAL standard_conforming_strings=on;",
             'LOCK TABLE profiles, sso_identities, ' + ', '.join(TABLES) + ' IN SHARE ROW EXCLUSIVE MODE;',
             "DO $guard$ BEGIN\n"
             "IF EXISTS(SELECT 1 FROM hackathons) OR EXISTS(SELECT 1 FROM ideas) THEN RAISE EXCEPTION 'Campaign data already exists: no overwrite or duplicate import'; END IF;\n"
             "IF NOT EXISTS(SELECT 1 FROM flyway_schema_history WHERE ltrim(version,'0')='24' AND success) THEN RAISE EXCEPTION 'Migration 024 is required'; END IF;\n"
             "IF (" + account_fingerprint_sql() + ") <> '" + fingerprint + "' THEN RAISE EXCEPTION 'Current accounts or SSO bindings changed'; END IF;\n"
             "IF (SELECT tgenabled FROM pg_trigger WHERE tgrelid='ideas'::regclass AND tgname='trg_ideas_updated_at') IS DISTINCT FROM 'O'::char THEN RAISE EXCEPTION 'Unexpected timestamp trigger state'; END IF;\n"
             "IF (SELECT tgenabled FROM pg_trigger WHERE tgrelid='idea_votes'::regclass AND tgname='trg_idea_vote_count') IS DISTINCT FROM 'O'::char THEN RAISE EXCEPTION 'Unexpected vote trigger state'; END IF;\n"
             "END $guard$;",
             # Transactional DDL, no FK or vote triggers disabled. Preserve historical updated_at.
             'ALTER TABLE ideas DISABLE TRIGGER trg_ideas_updated_at;']
    for table in TABLES:
        rows = payload[table]
        if not rows:
            continue
        columns = list(rows[0])
        require(all(set(r) == set(columns) for r in rows), 'Inconsistent backup columns.')
        require(all(re.fullmatch('[a-z_]+', c) for c in columns), 'Unexpected column identifier.')
        names = ','.join('"' + c + '"' for c in columns)
        data = literal(json.dumps(rows, ensure_ascii=False))
        parts.append(f'INSERT INTO {table} ({names}) SELECT {names} FROM jsonb_populate_recordset(NULL::{table}, {data}::jsonb);')
    parts += ['ALTER TABLE ideas ENABLE TRIGGER trg_ideas_updated_at;',
              "DO $verify$ BEGIN\n"
              "IF (SELECT count(*) FROM hackathons) <> 1 OR (SELECT count(*) FROM ideas) <> 4 OR (SELECT count(*) FROM idea_votes) <> 6 OR (SELECT count(*) FROM judge_scores) <> 4 THEN RAISE EXCEPTION 'Post-import totals incorrect'; END IF;\n"
              "IF EXISTS(SELECT 1 FROM ideas i WHERE votes <> (SELECT count(*) FROM idea_votes v WHERE v.idea_id=i.id)) THEN RAISE EXCEPTION 'Vote counters incorrect'; END IF;\n"
              "IF (" + account_fingerprint_sql() + ") <> '" + fingerprint + "' THEN RAISE EXCEPTION 'Accounts or SSO bindings unexpectedly changed'; END IF;\n"
              "END $verify$;", 'COMMIT;']
    return '\n'.join(parts) + '\n'


class Recovery:
    def __init__(self, args):
        self.args = args
        self.runtime = Path(args.runtime).resolve()
        self.report = Path(tempfile.mkdtemp(prefix='award-recovery-', dir=args.report_root))
        self.log = open(self.report / 'private.log', 'ab')
        self.cid = ''
        self.stopped = False
        self.committed = False

    def run(self, command, data=None, output=None, stdin=None):
        result = subprocess.run(command, input=data.encode() if data is not None else None,
                                stdin=stdin, stdout=output or subprocess.PIPE, stderr=self.log,
                                cwd=self.runtime)
        if result.returncode:
            raise RuntimeError('A command failed; private diagnostics: ' + str(self.report / 'private.log'))
        return result.stdout.decode().strip() if output is None else ''

    def compose(self, *args, **kwargs):
        return self.run(['bash', 'compose.sh', *args], **kwargs)

    def psql(self, database, sql):
        return self.run(['docker', 'exec', '-i', self.cid, 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1',
                         '-U', 'postgres', '-d', database], data=sql)

    def restore(self, database, file):
        self.run(['docker', 'exec', self.cid, 'createdb', '-U', 'postgres', database])
        with open(file, 'rb') as src:
            self.run(['docker', 'exec', '-i', self.cid, 'pg_restore', '-U', 'postgres', '-d', database,
                      '--no-owner', '--no-privileges', '--exit-on-error', '--single-transaction'], stdin=src, output=self.log)

    def rows(self, database, table, columns='*'):
        return json.loads(self.psql(database, f"SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb) FROM (SELECT {columns} FROM {table}) r;"))

    def execute(self):
        print('Mode:', 'APPLY (brief API outage)' if self.args.apply else 'PREVIEW (no production writes)', flush=True)
        print('Private backup/report directory:', self.report, flush=True)
        backup = Path(self.args.backup).resolve()
        require(backup.is_file(), 'Historical backup is missing.')
        production = self.compose('ps', '-q', 'postgres')
        require(bool(production), 'Production PostgreSQL is not running.')
        image = self.run(['docker', 'inspect', production, '--format', '{{.Image}}'])
        api = self.compose('ps', '-q', 'api')
        require(bool(api), 'API must be running before recovery.')
        require(self.run(['docker', 'inspect', api, '--format', '{{.State.Health.Status}}']) == 'healthy', 'API is not healthy.')
        config_paths = [self.runtime / f for f in ('.env', 'images.env', 'compose.yml', 'compose.sh', 'compose.sso.yml') if (self.runtime / f).is_file()]
        config_hashes = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in config_paths}
        if self.args.apply:
            self.stopped = True
            self.compose('stop', 'api', output=self.log)
        current_dump = self.report / 'before.dump'
        with current_dump.open('wb') as dst:
            self.compose('exec', '-T', 'postgres', 'sh', '-eu', '-c',
                         'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc', output=dst)
        require(current_dump.stat().st_size > 0, 'Current database backup is empty.')
        self.cid = self.run(['docker', 'run', '-d', '--pull', 'never', '--network', 'none',
                             '--label', 'hackhub.recovery-preview=true', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', image])
        for _ in range(60):
            result = subprocess.run(['docker', 'exec', self.cid, 'pg_isready', '-U', 'postgres'], stdout=self.log, stderr=self.log)
            if result.returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError('Temporary PostgreSQL did not start.')
        print('Restoring both backups into an isolated container...', flush=True)
        self.restore('history', backup)
        self.restore('rehearsal', current_dump)
        old = {t: self.rows('history', t) for t in TABLES}
        old['profiles'] = self.rows('history', 'profiles', 'id,email,name')
        current = json.loads(self.psql('rehearsal', "SELECT jsonb_agg(to_jsonb(p)) FROM (SELECT id,email,name,role,org_code,EXISTS(SELECT 1 FROM sso_identities s WHERE s.profile_id=profiles.id) AS sso_linked FROM profiles) p;"))
        payload = prepare(old, current)
        fingerprint = self.psql('rehearsal', account_fingerprint_sql() + ';')
        sql = build_sql(payload, fingerprint)
        (self.report / 'recovery.sql').write_text(sql)
        self.psql('rehearsal', sql)
        counts = {t: len(payload[t]) for t in TABLES}
        report = {'source_backup': str(backup), 'account_mapping': {OLD: NEW},
                  'counts': counts, 'excluded_test_nominations': 7,
                  'nomination_ids': sorted(KEEP), 'rehearsal': 'passed'}
        (self.report / 'summary.json').write_text(json.dumps(report, indent=2))
        print('Rehearsal passed. Selected rows: ' + json.dumps(counts), flush=True)
        if self.args.apply:
            print('Applying the verified transaction to production...', flush=True)
            self.compose('exec', '-T', 'postgres', 'sh', '-eu', '-c',
                         'psql -Xq -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"', data=sql, output=self.log)
            self.committed = True
            (self.report / 'COMMITTED').write_text('Recovery transaction committed. Do not reapply.\n')
            verification = "SELECT 'awards',count(*) FROM hackathons UNION ALL SELECT 'nominations',count(*) FROM ideas UNION ALL SELECT 'votes',count(*) FROM idea_votes UNION ALL SELECT 'judge_scores',count(*) FROM judge_scores;"
            result = self.compose('exec', '-T', 'postgres', 'sh', '-eu', '-c',
                                  'psql -XAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"', data=verification)
            print(result, flush=True)
        require(all(hashlib.sha256(p.read_bytes()).hexdigest() == h for p, h in config_hashes.items()), 'Runtime config changed externally; inspect before proceeding.')
        print('Existing accounts, passwords, roles, SSO bindings and runtime configuration preserved.', flush=True)
        print('Database recovery committed.' if self.committed else 'Preview complete. No production data was changed.', flush=True)

    def cleanup(self):
        try:
            if self.stopped:
                # start reuses the existing container and the existing image/config.
                self.compose('start', 'api', output=self.log)
                self.stopped = False
                api = self.compose('ps', '-q', 'api')
                for _ in range(90):
                    if self.run(['docker', 'inspect', api, '--format', '{{.State.Health.Status}}']) == 'healthy':
                        print('Production API: healthy', flush=True)
                        break
                    time.sleep(2)
                else:
                    raise RuntimeError('API has not become healthy. Inspect service status; do not reapply recovery.')
        finally:
            if self.cid:
                self.run(['docker', 'rm', '-fv', self.cid], output=self.log)
                self.cid = ''


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--backup', default=DEFAULT_BACKUP)
    parser.add_argument('--runtime', default='/opt/hackhub/runtime')
    parser.add_argument('--report-root', default='/opt/hackhub/incoming')
    args = parser.parse_args()
    os.umask(0o077)
    # Graceful Ctrl-C/TERM still restarts a paused API and removes our temp container.
    def interrupted(signum, frame):
        raise RuntimeError('Interrupted; check the report and production state before retrying.')
    signal.signal(signal.SIGTERM, interrupted)
    recovery = Recovery(args)
    failed = False
    try:
        recovery.execute()
    except (Exception, KeyboardInterrupt) as exc:
        failed = True
        print('STOP:', str(exc) if isinstance(exc, RuntimeError) else 'Unexpected error; do not reapply blindly.', flush=True)
        print('Commit confirmed:', recovery.committed, '| Private report:', recovery.report, flush=True)
    finally:
        try:
            recovery.cleanup()
        except Exception:
            failed = True
            print('Cleanup/start check failed. Inspect API status and private.log. Do not rerun the import.', flush=True)
        recovery.log.close()
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
