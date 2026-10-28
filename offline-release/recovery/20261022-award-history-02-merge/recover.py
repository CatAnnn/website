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
TARGET = '23680a03-54bf-43f1-8e28-cd400a957a66'
EXISTING_IDEA = 'a70b3411-b01e-4e22-ad4d-e264369d62ac'
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


def merge_payload(payload, existing):
    """Retain current records verbatim; remap only imported history."""
    targets = [h for h in existing['hackathons'] if h['id'] == TARGET]
    require(len(targets) == 1, 'Approved target campaign was not found.')
    require(not any(h['id'] == AWARD for h in existing['hackathons']),
            'Original campaign already exists; review before importing again.')
    current_ideas = [i for i in existing['ideas'] if i['hackathon_id'] == TARGET]
    require({i['id'] for i in current_ideas} == {EXISTING_IDEA},
            'Target nominations changed or history was already imported; stop without overwriting.')
    require(not KEEP.intersection(i['id'] for i in existing['ideas']),
            'Historical nomination IDs already exist; duplicate import refused.')
    payload['hackathons'] = []
    for rows in payload.values():
        for row in rows:
            if 'hackathon_id' in row:
                require(row['hackathon_id'] == AWARD, 'Unexpected source campaign reference.')
                row['hackathon_id'] = TARGET

    # Identically named teams must not be merged: that would change membership/access.
    team_names = {r['name'] for r in existing['teams'] if r['hackathon_id'] == TARGET}
    renamed_teams = []
    for row in payload['teams']:
        if row['name'] in team_names:
            row['name'] += ' [restored-' + row['id'] + ']'
            require(row['name'] not in team_names, 'Recovered team name conflicts with current team.')
            renamed_teams.append(row['id'])
        team_names.add(row['name'])

    # Reuse only criteria whose meaning/weight match, never silently mix scoring systems.
    current_criteria = [r for r in existing['voting_criteria'] if r['hackathon_id'] == TARGET]
    key = lambda r: r['name'].strip().casefold()
    old_by_name = {key(r): r for r in payload['voting_criteria']}
    live_by_name = {key(r): r for r in current_criteria}
    require(len(old_by_name) == len(payload['voting_criteria']) and len(live_by_name) == len(current_criteria),
            'Ambiguous criterion names; manual scoring review is required.')
    require(set(live_by_name).issubset(old_by_name),
            'Current criteria differ from historical criteria; see criteria-review.json. No production import.')
    require(sum(r['weight'] for r in old_by_name.values()) <= 100,
            'Historical criterion weights exceed 100; stop for review.')
    mapping = {}
    imports = []
    for row in payload['voting_criteria']:
        match = live_by_name.get(key(row))
        if match:
            require(row['weight'] == match['weight']
                    and ' '.join((row.get('description') or '').split())
                    == ' '.join((match.get('description') or '').split()),
                    'Criterion weight/description conflict; see criteria-review.json. No production import.')
            mapping[row['id']] = match['id']
        else:
            mapping[row['id']] = row['id']
            imports.append(row)
    payload['voting_criteria'] = imports
    for table, field in [('idea_scores', 'criteria_id'), ('judge_scores', 'criterion_id')]:
        for row in payload[table]:
            if row[field] is not None:
                require(row[field] in mapping, 'Historical score references an unavailable criterion.')
                row[field] = mapping[row[field]]
    existing_judges = {r['user_id'] for r in existing['hackathon_judges'] if r['hackathon_id'] == TARGET}
    payload['hackathon_judges'] = [r for r in payload['hackathon_judges'] if r['user_id'] not in existing_judges]
    for table in TABLES:
        require(not {r['id'] for r in payload[table]}.intersection(r['id'] for r in existing[table]),
                'Existing row ID conflicts in ' + table + '; no overwrite allowed.')
    return {'criterion_mapping': mapping, 'renamed_historical_team_ids': renamed_teams,
            'target_campaign': TARGET, 'preserved_nomination': EXISTING_IDEA}


def business_fingerprint_sql():
    pairs = []
    for table in TABLES:
        pairs += [literal(table), f"md5(COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY id)::text FROM {table} r),'[]'))"]
    return 'SELECT jsonb_build_object(' + ','.join(pairs) + ')'


def build_sql(payload, fingerprint, business_fingerprints):
    require(bool(re.fullmatch('[a-f0-9]{32}', fingerprint)), 'Invalid account fingerprint.')
    require(set(business_fingerprints) == set(TABLES)
            and all(re.fullmatch('[a-f0-9]{32}', v) for v in business_fingerprints.values()),
            'Invalid business fingerprints.')
    ids = ','.join(literal(i) + '::uuid' for i in sorted(KEEP))
    parts = ["\\set ON_ERROR_STOP on", "BEGIN;", "SET LOCAL lock_timeout='15s';",
             "SET LOCAL statement_timeout='120s';", "SET LOCAL standard_conforming_strings=on;",
             'LOCK TABLE profiles, sso_identities, ' + ', '.join(TABLES) + ' IN SHARE ROW EXCLUSIVE MODE;',
             "DO $guard$ BEGIN\n"
             f"IF NOT EXISTS(SELECT 1 FROM hackathons WHERE id='{TARGET}') OR NOT EXISTS(SELECT 1 FROM ideas WHERE id='{EXISTING_IDEA}' AND hackathon_id='{TARGET}') THEN RAISE EXCEPTION 'Approved target records missing'; END IF;\n"
             f"IF EXISTS(SELECT 1 FROM ideas WHERE id IN ({ids})) THEN RAISE EXCEPTION 'Historical nominations already exist: duplicate import refused'; END IF;\n"
             "IF NOT EXISTS(SELECT 1 FROM flyway_schema_history WHERE ltrim(version,'0')='24' AND success) THEN RAISE EXCEPTION 'Migration 024 is required'; END IF;\n"
             "IF (" + account_fingerprint_sql() + ") <> '" + fingerprint + "' THEN RAISE EXCEPTION 'Current accounts or SSO bindings changed'; END IF;\n"
             "IF (" + business_fingerprint_sql() + ")::jsonb <> " + literal(json.dumps(business_fingerprints)) + "::jsonb THEN RAISE EXCEPTION 'Business records changed since rehearsal snapshot'; END IF;\n"
             "IF (SELECT tgenabled FROM pg_trigger WHERE tgrelid='ideas'::regclass AND tgname='trg_ideas_updated_at') IS DISTINCT FROM 'O'::char THEN RAISE EXCEPTION 'Unexpected timestamp trigger state'; END IF;\n"
             "IF (SELECT tgenabled FROM pg_trigger WHERE tgrelid='idea_votes'::regclass AND tgname='trg_idea_vote_count') IS DISTINCT FROM 'O'::char THEN RAISE EXCEPTION 'Unexpected vote trigger state'; END IF;\n"
             "END $guard$;"]
    for table in TABLES:
        parts.append(f'CREATE TEMP TABLE recovery_before_{table} ON COMMIT DROP AS SELECT * FROM {table};')
    # All original records are checked byte-for-value before committing. FK/vote triggers stay active.
    parts.append('ALTER TABLE ideas DISABLE TRIGGER trg_ideas_updated_at;')
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
    parts += ['ALTER TABLE ideas ENABLE TRIGGER trg_ideas_updated_at;', 'DO $verify$ BEGIN']
    for table in TABLES:
        parts += [f"IF EXISTS(SELECT * FROM recovery_before_{table} EXCEPT SELECT * FROM {table}) THEN RAISE EXCEPTION 'Existing {table} records were changed'; END IF;",
                  f"IF (SELECT count(*) FROM {table}) <> (SELECT count(*) FROM recovery_before_{table}) + {len(payload[table])} THEN RAISE EXCEPTION 'Incorrect added row count in {table}'; END IF;"]
    parts += [f"IF (SELECT count(*) FROM ideas WHERE hackathon_id='{TARGET}') <> 5 THEN RAISE EXCEPTION 'Target must contain five nominations'; END IF;",
              f"IF EXISTS(SELECT 1 FROM ideas i WHERE id IN ({ids}) AND (hackathon_id <> '{TARGET}' OR votes <> (SELECT count(*) FROM idea_votes v WHERE v.idea_id=i.id))) THEN RAISE EXCEPTION 'Imported campaign reference or vote counters incorrect'; END IF;",
              "IF (" + account_fingerprint_sql() + ") <> '" + fingerprint + "' THEN RAISE EXCEPTION 'Accounts or SSO bindings unexpectedly changed'; END IF;",
              'END $verify$;', 'COMMIT;']
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
        self.stage = 'initial checks'

    def run(self, command, data=None, output=None, stdin=None):
        result = subprocess.run(command, input=data.encode() if data is not None else None,
                                stdin=stdin, stdout=output or subprocess.PIPE, stderr=self.log,
                                cwd=self.runtime)
        if result.returncode:
            raise RuntimeError('Command failed at stage [' + self.stage + ']; private diagnostics: ' + str(self.report / 'private.log'))
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
        self.stage = 'restore historical backup in isolated container'
        self.restore('history', backup)
        self.stage = 'restore current backup in isolated container'
        self.restore('rehearsal', current_dump)
        self.stage = 'read isolated data'
        old = {t: self.rows('history', t) for t in TABLES}
        old['profiles'] = self.rows('history', 'profiles', 'id,email,name')
        current = json.loads(self.psql('rehearsal', "SELECT jsonb_agg(to_jsonb(p)) FROM (SELECT id,email,name,role,org_code,EXISTS(SELECT 1 FROM sso_identities s WHERE s.profile_id=profiles.id) AS sso_linked FROM profiles) p;"))
        payload = prepare(old, current)
        existing = {t: self.rows('rehearsal', t) for t in TABLES}
        criteria_review = {
            'historical': [{k: c.get(k) for k in ('name', 'weight', 'description')} for c in payload['voting_criteria']],
            'current': [{k: c.get(k) for k in ('name', 'weight', 'description')} for c in existing['voting_criteria'] if c['hackathon_id'] == TARGET]}
        (self.report / 'criteria-review.json').write_text(json.dumps(criteria_review, ensure_ascii=False, indent=2))
        merge_details = merge_payload(payload, existing)
        fingerprint = self.psql('rehearsal', account_fingerprint_sql() + ';')
        business_fingerprints = json.loads(self.psql('rehearsal', business_fingerprint_sql() + ';'))
        sql = build_sql(payload, fingerprint, business_fingerprints)
        (self.report / 'recovery.sql').write_text(sql)
        self.stage = 'rehearse merge transaction in isolated current database'
        self.psql('rehearsal', sql)
        counts = {t: len(payload[t]) for t in TABLES}
        report = {'source_backup': str(backup), 'account_mapping': {OLD: NEW},
                  'counts': counts, 'excluded_test_nominations': 7,
                  'nomination_ids': sorted(KEEP), 'merge': merge_details, 'rehearsal': 'passed'}
        (self.report / 'summary.json').write_text(json.dumps(report, indent=2))
        print('Rehearsal passed. Selected rows: ' + json.dumps(counts), flush=True)
        print('Target campaign: ' + TARGET + '; preserved 1 existing nomination, added 4; total 5.', flush=True)
        if self.args.apply:
            self.stage = 'apply merge transaction to production'
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
        print('Existing campaign, nomination, accounts, passwords, roles, SSO bindings and runtime configuration preserved.', flush=True)
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
