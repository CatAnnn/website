#!/usr/bin/env python3
"""Copy retained photos to current authorized paths, then update four references."""
import argparse
import copy
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

OLD_AWARD = '3c3eb377-23c9-4e82-807c-d9af5e790f12'
TARGET = '23680a03-54bf-43f1-8e28-cd400a957a66'
OLD_OWNER = '5ff81e0f-f183-4b6d-8538-39e42549ed41'
NEW_OWNER = 'e609070a-941e-468d-8478-5afdf52000e6'
KEEP = {'ceb63c92-87e9-4a3f-a1cc-fa0188a6f9ad', '6db2e246-3430-44a7-b2d4-c34870da8b26',
        'a2d1d76d-1a27-49b2-b4ff-c4935594abeb', '7fbeea4b-d85e-4c0d-bf89-e28c6f170463'}
BUCKET = 'hackhub-project-attachments'
IDS = ','.join("'" + i + "'::uuid" for i in sorted(KEEP))


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def plan_rows(rows):
    require({r['id'] for r in rows} == KEEP, 'Expected four recovered nominations; stop for review.')
    plans = []
    for row in rows:
        require(row['hackathon_id'] == TARGET, 'Unexpected campaign association.')
        attachments = row.get('project_attachments')
        require(isinstance(attachments, list), 'Unexpected attachment structure.')
        screenshots = [(n, a) for n, a in enumerate(attachments) if a.get('type') == 'screenshot']
        require(len(screenshots) == 1, 'Expected one photo per recovered nomination.')
        index, photo = screenshots[0]
        key = photo.get('storageKey', '')
        require(bool(re.fullmatch(r'nominations/[a-f0-9-]{36}/[a-f0-9-]{36}/[A-Za-z0-9_-]+\.(?:png|jpg|jpeg|webp)', key)),
                'Unexpected photo key; stop without printing signed URLs.')
        _, campaign, owner, filename = key.split('/')
        if campaign == TARGET:
            require(owner == row['created_by'], 'Current photo owner does not match the nomination.')
            destination = key
        else:
            require(campaign == OLD_AWARD and (owner == row['created_by']
                    or (owner == OLD_OWNER and row['created_by'] == NEW_OWNER)), 'Unexpected historical photo owner.')
            destination = 'nominations/' + TARGET + '/' + row['created_by'] + '/' + filename
        after = copy.deepcopy(row)
        if key != destination:
            after['project_attachments'][index]['storageKey'] = destination
            # Let the existing API issue a fresh signed URL; never retain the expired fallback.
            after['project_attachments'][index]['url'] = ''
        plans.append({'id': row['id'], 'source': key, 'destination': destination,
                      'before': row, 'after': after})
    require(len({p['destination'] for p in plans}) == len(plans), 'Ambiguous destination keys.')
    return plans


def sql_for(plans):
    changed = [p for p in plans if p['before'] != p['after']]
    if not changed:
        return None
    values = literal(json.dumps(changed, ensure_ascii=False))
    return f"""\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='15s';
SET LOCAL statement_timeout='60s';
SET LOCAL standard_conforming_strings=on;
LOCK TABLE ideas IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE photo_plan ON COMMIT DROP AS SELECT value AS data FROM jsonb_array_elements({values}::jsonb);
DO $guard$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM hackathons WHERE id='{TARGET}') THEN RAISE EXCEPTION 'Current campaign missing'; END IF;
 IF EXISTS(SELECT 1 FROM photo_plan p LEFT JOIN ideas i ON i.id=(p.data->>'id')::uuid WHERE to_jsonb(i) IS DISTINCT FROM p.data->'before') THEN RAISE EXCEPTION 'Nomination changed since photo preflight'; END IF;
 IF (SELECT tgenabled FROM pg_trigger WHERE tgrelid='ideas'::regclass AND tgname='trg_ideas_updated_at') IS DISTINCT FROM 'O'::char THEN RAISE EXCEPTION 'Unexpected update trigger state'; END IF;
END $guard$;
ALTER TABLE ideas DISABLE TRIGGER trg_ideas_updated_at;
UPDATE ideas i SET project_attachments=p.data->'after'->'project_attachments'
FROM photo_plan p WHERE i.id=(p.data->>'id')::uuid;
ALTER TABLE ideas ENABLE TRIGGER trg_ideas_updated_at;
DO $verify$ BEGIN
 IF EXISTS(SELECT 1 FROM photo_plan p LEFT JOIN ideas i ON i.id=(p.data->>'id')::uuid WHERE to_jsonb(i) IS DISTINCT FROM p.data->'after') THEN RAISE EXCEPTION 'Photo update changed unexpected fields'; END IF;
END $verify$;
COMMIT;
"""


class Repair:
    def __init__(self, args):
        self.args = args
        self.runtime = Path(args.runtime).resolve()
        self.report = Path(tempfile.mkdtemp(prefix='photo-repair-', dir=args.report_root))
        self.log = open(self.report / 'private.log', 'ab')
        self.stage = 'initialization'

    def run(self, args, data=None, output=None, check=True):
        kwargs = {'input': data.encode()} if data is not None else {'stdin': subprocess.DEVNULL}
        result = subprocess.run(['bash', 'compose.sh', *args], cwd=self.runtime,
                                stdout=output or subprocess.PIPE, stderr=self.log, **kwargs)
        if check and result.returncode:
            raise RuntimeError('Command failed at ' + self.stage + '; private diagnostics saved in report directory.')
        return result.returncode, result.stdout.decode().strip() if output is None else ''

    def psql(self, sql):
        return self.run(['exec', '-T', 'postgres', 'sh', '-eu', '-c',
                         'psql -XqAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'], data=sql)[1]

    def mc(self, script, check=True):
        # Use the installed Compose service/image and its existing credentials; no values printed.
        setup = 'set -eu\numask 077\nexport MC_CONFIG_DIR=/tmp/photo-mc\n'
        setup += 'mc alias set photos http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1\n'
        return self.run(['run', '--rm', '-T', '--no-deps', '--pull', 'never', '--entrypoint', '/bin/sh',
                         'minio-init', '-eu', '-s'], data=setup + script, check=check)

    def stat(self, key):
        status, output = self.mc('mc --json stat photos/' + BUCKET + '/' + key + '\n', check=False)
        try:
            entries = [json.loads(line) for line in output.splitlines() if line.strip()]
        except ValueError:
            raise RuntimeError('Unrecognized storage response; no changes made in this storage check.')
        successes = [e for e in entries if e.get('status') == 'success']
        if status == 0 and len(successes) == 1:
            require(successes[0].get('size', 0) > 0, 'Empty photo object; stop for review.')
            return successes[0]
        self.log.write(output.encode() + b'\n')
        self.log.flush()
        def codes(value):
            found = []
            if isinstance(value, dict):
                for k, v in value.items():
                    if k.lower() == 'code' and isinstance(v, str):
                        found.append(v)
                    found += codes(v)
            elif isinstance(value, list):
                for v in value:
                    found += codes(v)
            return found
        missing_object = any(
            isinstance(e.get('error'), dict)
            and isinstance(e['error'].get('cause'), dict)
            and e['error']['cause'].get('message') == 'Object does not exist'
            for e in entries)
        if missing_object or any(c in ('NoSuchKey', 'NoSuchObject', 'NotFound') for c in codes(entries)):
            return None
        # Do not classify AccessDenied/network/credential failures as missing files.
        raise RuntimeError('Storage check failed (not confirmed missing); private credentials are not printed.')

    def digest(self, key):
        _, output = self.mc('mc cp photos/' + BUCKET + '/' + key + ' /tmp/photo-bytes >/dev/null\nsha256sum /tmp/photo-bytes\n')
        value = output.split()[0] if output else ''
        require(bool(re.fullmatch('[0-9a-f]{64}', value)), 'Failed to verify image bytes.')
        return value

    def execute(self):
        print('Mode:', 'APPLY PHOTO REPAIR' if self.args.apply else 'PREVIEW (no production changes)', flush=True)
        print('Private report:', self.report, flush=True)
        self.stage = 'read current photo references'
        rows = json.loads(self.psql(f"BEGIN READ ONLY; SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM ideas i WHERE id IN ({IDS}); COMMIT;"))
        plans = plan_rows(rows or [])
        self.stage = 'check original objects'
        # Check all original files before any copying or database changes.
        missing = []
        for p in plans:
            if self.stat(p['source']) is None:
                missing.append(p['id'])
        require(not missing, 'Original photos missing for nomination IDs: ' + ', '.join(missing)
                + '. No database changes; file backup/re-upload is required.')
        print('All four source photos exist in MinIO.', flush=True)
        self.stage = 'verify sources and destinations'
        for p in plans:
            p['sha256'] = self.digest(p['source'])
            p['destination_exists'] = self.stat(p['destination']) is not None
            if p['destination_exists']:
                require(self.digest(p['destination']) == p['sha256'], 'Destination already contains different bytes; refusing overwrite.')
        changes = [p for p in plans if p['before'] != p['after']]
        print('Verified photo objects: 4; references to repair:', len(changes), flush=True)
        safe_plan = [{k:p[k] for k in ('id', 'source', 'destination', 'sha256', 'destination_exists')} for p in plans]
        (self.report / 'plan.json').write_text(json.dumps(safe_plan, indent=2))
        if not self.args.apply:
            print('Preview passed. No images or database rows changed.', flush=True)
            return
        if not changes:
            print('All photo references already point to current campaign and owner; no database changes.', flush=True)
            return
        self.stage = 'backup current database'
        with (self.report / 'before.dump').open('wb') as dst:
            self.run(['exec', '-T', 'postgres', 'sh', '-eu', '-c',
                      'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'], output=dst)
        require((self.report / 'before.dump').stat().st_size > 0, 'Database backup empty.')
        self.stage = 'copy and verify photos'
        for p in changes:
            # Recheck immediately before copying; an interrupted previous run is safe to resume.
            if self.stat(p['destination']) is None:
                self.mc('mc cp photos/' + BUCKET + '/' + p['source'] + ' photos/' + BUCKET + '/' + p['destination'] + ' >/dev/null\n')
            require(self.digest(p['destination']) == p['sha256'], 'Copied photo hash mismatch; database unchanged.')
        print('Four destination photos verified; original files preserved.', flush=True)
        self.stage = 'commit photo-reference transaction'
        sql = sql_for(plans)
        (self.report / 'repair.sql').write_text(sql)
        self.psql(sql)
        (self.report / 'COMMITTED').write_text('Photo-reference transaction committed.\n')
        print('Photo repair committed. Updated references: ' + str(len(changes)) + '.', flush=True)
        print('No API restart needed. Refresh Browse & Vote to request fresh image URLs.', flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--runtime', default='/opt/hackhub/runtime')
    parser.add_argument('--report-root', default='/opt/hackhub/incoming')
    args = parser.parse_args()
    os.umask(0o077)
    repair = Repair(args)
    try:
        repair.execute()
        return 0
    except (Exception, KeyboardInterrupt) as exc:
        print('STOP:', str(exc) if isinstance(exc, RuntimeError) else 'Unexpected error; inspect private diagnostics locally.', flush=True)
        print('Stage:', repair.stage, '| Report:', repair.report, flush=True)
        print('Original photo objects were not deleted. Do not rerun nomination recovery.', flush=True)
        return 1
    finally:
        repair.log.close()


if __name__ == '__main__':
    raise SystemExit(main())
