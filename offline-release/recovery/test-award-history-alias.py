import copy,importlib.util,json,os,subprocess,tempfile,time,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
module=ROOT/'offline-release/recovery/20261022-award-history-03-merge/recover.py'
spec=importlib.util.spec_from_file_location('recover',module); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
work=Path(tempfile.mkdtemp(prefix='award-history-test-')); os.chmod(work,0o700)
cids=[]
def run(cmd, data=None, check=True):
 r=subprocess.run(cmd,input=data,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if check and r.returncode: raise RuntimeError('Test command failed: '+r.stderr[:900])
 return r

def sql(db,text,check=True):
 return run(['docker','exec','-i',cid,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',db],text,check)

def ins(table,row):
 return 'INSERT INTO '+table+' ('+','.join(row)+') SELECT '+','.join(row)+' FROM jsonb_populate_record(NULL::'+table+','+m.literal(json.dumps(row))+'::jsonb);'
try:
 cid=run(['docker','run','-d','--network','none','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_USER=postgres','-e','POSTGRES_DB=postgres','--health-cmd','pg_isready -U postgres','--health-interval','1s','postgres:16-alpine']).stdout.strip(); cids.append(cid)
 for _ in range(40):
  if run(['docker','exec',cid,'pg_isready','-U','postgres'],check=False).returncode==0: break
  time.sleep(.5)
 sql('postgres','CREATE DATABASE history;')
 migrations=ROOT/'app/hackhub-api/src/main/resources/db/migration'
 for n in [1,2,6,7,9,10,11,12,13,14,15,23]:
  file=next(migrations.glob('V%03d__*'%n)); sql('history',file.read_text())
 sql('history','ALTER TABLE profiles ADD COLUMN org_code text; CREATE TABLE flyway_schema_history(version varchar,success boolean); INSERT INTO flyway_schema_history VALUES (\'023\',true);')
 real={m.NEW:m.EMAIL,'87af8e00-ac7a-4e84-911f-2c223cc3c36d':'Lynette.LI@cn.bosch.com','33bfadff-4ada-4aa1-a073-0477e44fb228':'Yining.MA@cn.bosch.com','3c4b192d-4d2a-42e9-a874-ed759a747b27':'Sicheng.Feng@cn.bosch.com','117813e1-77bf-46ca-88cb-1163891ca947':'Sophie.Wang@cn.bosch.com','6ac95600-869a-45ea-b45e-0a3df84298b3':'fixed-term.Yiheng.LU@cn.bosch.com'}
 testids=[str(uuid.uuid4()) for _ in range(6)]
 profiles=dict(real); profiles[m.OLD]='aah5sgh@bosch.com'; profiles[str(uuid.uuid4())]='Sicheng.Feng@bosch.com'; profiles.update({u:'bd-test.'+str(i)+'@bosch.com' for i,u in enumerate(testids)})
 for uid,email in profiles.items():
  sql('history',ins('profiles',dict(id=uid,email=email,name=email.split('@')[0],role='admin' if uid in real else 'participant',password_hash='TEST_PASSWORD_SENTINEL',skills=[],org_code='HRL')))
 sql('history',ins('hackathons',dict(id=m.AWARD,title='2026 Digital Pioneer Award',description="Preserve 'quotes' and \\ path",start_date='2026-09-01',end_date='2027-01-01',registration_key='fixture-registration',status='open',allowed_participants=100,created_by=m.OLD)))
 selected=sorted(m.KEEP); removed=[str(uuid.uuid4()) for _ in range(7)]
 ids=selected+removed
 lyn=list(real)[1]; yin=list(real)[2]
 nominee=[yin,m.OLD,lyn,m.OLD]+[testids[n%6] for n in range(7)]
 teamids=[]
 for n,i in enumerate(ids):
  team=str(uuid.uuid4()); teamids.append(team)
  sql('history',ins('teams',dict(id=team,name='Team '+str(n),hackathon_id=m.AWARD,created_by=m.OLD)))
  sql('history',ins('team_members',dict(team_id=team,user_id=nominee[n],role='leader')))
  sql('history',ins('ideas',dict(id=i,title='Nomination '+str(n),description='Original text',hackathon_id=m.AWARD,team_id=team,created_by=yin if n==0 else m.OLD,project_attachments=[{'type':'nomination','nomineeUserId':nominee[n],'url':'/storage/fixture.png'},{'type':'image','url':'/storage/photo.png'}],created_at='2026-09-01',updated_at='2026-09-02')))
 voters=[m.OLD,lyn,yin]
 counts=[1,2,3,0,1,3,0,2,2,1,2]
 for i,count in zip(ids,counts):
  for v in voters[:count]: sql('history',ins('idea_votes',dict(idea_id=i,user_id=v,created_at='2026-09-10')))
 criteria=[str(uuid.uuid4()) for _ in range(2)]
 definitions=[('Behavior Demonstration',70,'Track-specific behavior demonstrated by the nominee'),('Business Impact',30,'Measured customer or business outcomes')]
 for c,(name,weight,description) in zip(criteria,definitions):
  sql('history',ins('voting_criteria',dict(id=c,hackathon_id=m.AWARD,name=name,weight=weight,description=description)))
 for i,count in [(selected[2],4),(removed[0],4),(removed[1],4),(removed[2],2)]:
  for n in range(count): sql('history',ins('judge_scores',dict(hackathon_id=m.AWARD,idea_id=i,judge_id=[lyn,yin][n//2],criterion_id=criteria[n%2],score=7+n%2,created_at='2026-09-11')))
 sql('history',ins('hackathon_judges',dict(hackathon_id=m.AWARD,user_id=lyn,invited_by=m.OLD)))
 sql('history',ins('comments',dict(idea_id=selected[0],user_id=m.OLD,content="Keep the user's text")))
 sql('history',ins('final_submissions',dict(hackathon_id=m.AWARD,team_id=teamids[0],idea_id=selected[0],title='Final',submitted_by=m.OLD)))
 # Check vote-trigger history timestamp preservation using actual old source timestamps.
 with (work/'history.dump').open('wb') as f: subprocess.run(['docker','exec',cid,'pg_dump','-U','postgres','-Fc','history'],stdout=f,check=True)
 sql('postgres','CREATE DATABASE production;')
 with (work/'history.dump').open('rb') as f: subprocess.run(['docker','exec','-i',cid,'pg_restore','-U','postgres','-d','production','--no-owner','--no-privileges'],stdin=f,stdout=subprocess.DEVNULL,check=True)
 sql('production',"TRUNCATE hackathons CASCADE; DELETE FROM profiles WHERE id NOT IN ("+','.join(m.literal(x) for x in real)+");")
 leqi=str(uuid.uuid4()); sql('production',ins('profiles',dict(id=leqi,email='fixed-term.leqi.wang@cn.bosch.com',name='Leqi',password_hash='LIVE_PASSWORD_SENTINEL')))
 for u in list(real)+[leqi]: sql('production',ins('sso_identities',dict(tenant_id=str(uuid.uuid4()),object_id=str(uuid.uuid4()),profile_id=u)))
 sql('production',next(migrations.glob('V024__*')).read_text()+"INSERT INTO flyway_schema_history VALUES ('024',true);")
 sql('production',"UPDATE profiles SET password_hash='LIVE_PASSWORD_SENTINEL';")
 def rows(db,t,cols='*'): return json.loads(sql(db,f"SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM (SELECT {cols} FROM {t}) r;").stdout)
 def seed_current(compatible=False):
  sql('production',ins('hackathons',dict(id=m.TARGET,title='2026 Digital Pioneer Award',description='KEEP CURRENT CONFIG',start_date='2026-10-22',end_date='2026-12-31',registration_key='new-campaign-fixture',status='draft',allowed_participants=321,created_by=m.NEW)))
  team=str(uuid.uuid4())
  sql('production',ins('teams',dict(id=team,name='Team 0',hackathon_id=m.TARGET,created_by=m.NEW)))
  sql('production',ins('team_members',dict(team_id=team,user_id=m.NEW,role='leader')))
  sql('production',ins('ideas',dict(id=m.EXISTING_IDEA,title='Yaolong Zhang',description='KEEP CURRENT NOMINATION',hackathon_id=m.TARGET,team_id=team,created_by=m.NEW,project_attachments=[{'type':'nomination','nomineeUserId':m.NEW,'url':'/storage/current-photo.png'}])))
  if compatible: seed_criteria()
 def seed_criteria():
  for name,weight,description in definitions:
   sql('production',ins('voting_criteria',dict(hackathon_id=m.TARGET,name='Behavior' if name=='Behavior Demonstration' else name,weight=weight,description=description)))
  sql('production',ins('hackathon_judges',dict(hackathon_id=m.TARGET,user_id=lyn,invited_by=m.NEW)))
 def business(): return {t:rows('production',t) for t in m.TABLES}
 def fingerprints(): return json.loads(sql('production',m.business_fingerprint_sql()).stdout)
 def assert_preserved(before):
  for t,previous in before.items():
   now={r['id']:r for r in rows('production',t)}
   assert all(now[r['id']]==r for r in previous),t
 seed_current()
 old={t:rows('history',t) for t in m.TABLES}; old['profiles']=rows('history','profiles','id,email,name')
 current=json.loads(sql('production',"SELECT jsonb_agg(to_jsonb(p)) FROM (SELECT id,email,name,role,org_code,true AS sso_linked FROM profiles) p;").stdout)
 finger=sql('production',m.account_fingerprint_sql()).stdout.strip()
 # Empty current criteria: original standards are inserted, then rollback restores the fixture.
 payload=m.prepare(copy.deepcopy(old),current)
 details=m.merge_payload(payload,business())
 assert len(payload['voting_criteria'])==2 and details['renamed_historical_team_ids']
 empty_statement=m.build_sql(payload,finger,fingerprints())
 sql('production',empty_statement.replace('COMMIT;','ROLLBACK;'))
 assert sql('production','SELECT count(*) FROM voting_criteria;').stdout.strip()=='0'
 # Matching current standards: use their existing IDs; retain current judge assignment.
 seed_criteria()
 before=business()
 # Reproduce the production failure with v02 using the exact reported standards.
 previous_spec=importlib.util.spec_from_file_location('previous',ROOT/'offline-release/recovery/20261022-award-history-02-merge/recover.py')
 previous=importlib.util.module_from_spec(previous_spec); previous_spec.loader.exec_module(previous)
 try:
  previous.merge_payload(previous.prepare(copy.deepcopy(old),current),before)
  raise AssertionError('v02 unexpectedly accepted production alias')
 except RuntimeError as exc:
  assert 'Current criteria differ' in str(exc)
 payload=m.prepare(copy.deepcopy(old),current)
 details=m.merge_payload(payload,before)
 assert not payload['hackathons'] and not payload['voting_criteria'] and not payload['hackathon_judges']
 live_criteria={r['id'] for r in before['voting_criteria']}
 assert all(r['criterion_id'] in live_criteria for r in payload['judge_scores'])
 live_by_id={r['id']:r for r in before['voting_criteria']}
 original_scores={r['id']:r for r in old['judge_scores']}
 for r in payload['judge_scores']:
  prior=original_scores[r['id']]
  expected='Behavior' if prior['criterion_id']==criteria[0] else 'Business Impact'
  assert live_by_id[r['criterion_id']]['name']==expected
  assert r['score']==prior['score'] and r['judge_id']==prior['judge_id']
 statement=m.build_sql(payload,finger,fingerprints())
 assert 'PASSWORD_SENTINEL' not in statement
 bad=statement.replace('COMMIT;',"SELECT 1/0; COMMIT;")
 assert sql('production',bad,False).returncode != 0
 assert_preserved(before)
 assert sql('production','SELECT count(*) FROM ideas;').stdout.strip()=='1'
 assert sql('production',"SELECT tgenabled FROM pg_trigger WHERE tgname='trg_ideas_updated_at';").stdout.strip()=='O'
 assert sql('production',statement.replace(finger,'0'*32),False).returncode != 0
 # Actual concurrent change to an existing record is rejected by business fingerprint.
 altered="BEGIN; UPDATE ideas SET description='unreviewed' WHERE id='"+m.EXISTING_IDEA+"';\n"+statement
 assert sql('production',altered,False).returncode != 0
 assert_preserved(before)
 try: m.prepare(copy.deepcopy(old),[x for x in current if x['id']!=m.NEW]); raise AssertionError('accepted missing account')
 except RuntimeError: pass
 for field,value in [('weight',60),('description','Different scoring meaning'),('name','Behavioral Competence')]:
  conflict=copy.deepcopy(before)
  next(c for c in conflict['voting_criteria'] if c['name']=='Behavior')[field]=value
  try: m.merge_payload(m.prepare(copy.deepcopy(old),current),conflict); raise AssertionError('accepted scoring conflict')
  except RuntimeError: pass
 # Two current aliases must never become an ambiguous many-to-one mapping.
 ambiguous=copy.deepcopy(before)
 duplicate=copy.deepcopy(next(c for c in ambiguous['voting_criteria'] if c['name']=='Behavior'))
 duplicate['id']=str(uuid.uuid4()); duplicate['name']='Behavior Demonstration'
 ambiguous['voting_criteria'].append(duplicate)
 try:
  m.merge_payload(m.prepare(copy.deepcopy(old),current),ambiguous)
  raise AssertionError('accepted ambiguous alias')
 except RuntimeError as exc:
  assert 'Ambiguous criterion names' in str(exc)
 sql('production',statement)
 assert_preserved(before)
 assert sql('production',m.account_fingerprint_sql()).stdout.strip()==finger
 assert sql('production','SELECT count(*) FROM hackathons;').stdout.strip()=='1'
 assert sql('production','SELECT count(*) FROM ideas;').stdout.strip()=='5'
 assert sql('production','SELECT count(*) FROM idea_votes;').stdout.strip()=='6'
 assert sql('production','SELECT count(*) FROM judge_scores;').stdout.strip()=='4'
 assert sql('production',"SELECT status FROM hackathons;").stdout.strip()=='draft'
 assert sql('production',"SELECT count(*) FROM profiles WHERE email LIKE 'bd-test%';").stdout.strip()=='0'
 assert sql('production',f"SELECT count(*) FROM ideas WHERE project_attachments @> '[{{\"nomineeUserId\":\"{m.OLD}\"}}]';").stdout.strip()=='0'
 ids_sql=','.join(m.literal(i) for i in m.KEEP)
 assert sql('production','SELECT updated_at FROM ideas WHERE id IN ('+ids_sql+') ORDER BY id;').stdout == sql('history','SELECT updated_at FROM ideas WHERE id IN ('+ids_sql+') ORDER BY id;').stdout
 assert sql('production',statement,False).returncode != 0
 # End-to-end CLI uses a disposable production clone and a separate fake API container.
 sql('production','TRUNCATE hackathons CASCADE;')
 seed_current(compatible=True)
 before=business()
 api=run(['docker','run','-d','--network','none','-e','POSTGRES_HOST_AUTH_METHOD=trust','--health-cmd','pg_isready -U postgres','--health-interval','1s','postgres:16-alpine']).stdout.strip(); cids.append(api)
 for _ in range(40):
  if run(['docker','inspect',api,'--format','{{.State.Health.Status}}']).stdout.strip()=='healthy': break
  time.sleep(.5)
 runtime=work/'runtime'; runtime.mkdir()
 # Explicitly route to production database rather than the container's default database.
 (runtime/'compose.sh').write_text('''#!/bin/bash
set -eu
case "$1" in
ps) if [[ "$3" == postgres ]]; then echo '''+cid+'''; else echo '''+api+'''; fi;;
exec) shift 3; docker exec -i -e POSTGRES_DB=production '''+cid+''' "$@";;
stop) docker stop '''+api+''' >/dev/null;;
start) docker start '''+api+''' >/dev/null;;
*) exit 2;;
esac
''')
 common=['python3',str(module),'--runtime',str(runtime),'--report-root',str(work),'--backup',str(work/'history.dump')]
 preview=run(common)
 assert 'Preview complete' in preview.stdout
 assert sql('production','SELECT count(*) FROM hackathons;').stdout.strip()=='1'
 apply=run(common+['--apply'])
 assert 'Database recovery committed' in apply.stdout and 'Production API: healthy' in apply.stdout
 assert sql('production',m.account_fingerprint_sql()).stdout.strip()==finger
 assert sql('production','SELECT count(*) FROM ideas;').stdout.strip()=='5'
 assert_preserved(before)
 assert 'PASSWORD_SENTINEL' not in preview.stdout+apply.stdout
 repeat=run(common+['--apply'],check=False)
 assert repeat.returncode==1 and 'Production API: healthy' in repeat.stdout
 assert sql('production','SELECT count(*) FROM ideas;').stdout.strip()=='5'
 assert_preserved(before)
 assert sql('production',m.account_fingerprint_sql()).stdout.strip()==finger
 (work/'results.txt').write_text(preview.stdout+'\n'+apply.stdout+'\nREPEATED APPLY REJECTED\n'+repeat.stdout)
 print('PASS: current draft/nomination/all existing rows unchanged; 1+4=5 nominations; six imported votes/four scores; production v02 failure reproduced; exact 70/30 alias mapping; unchanged scores/current criteria; ambiguous alias and changed rubric/weight rejection; team name collision isolation; approved account remap; timestamps and SSO preserved; rollback; concurrent-change/repeat rejection; CLI preview/apply and API restart.')
 print('Test report:',work/'results.txt')
finally:
 for c in cids: subprocess.run(['docker','rm','-fv',c],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
