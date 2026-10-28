import base64,copy,hashlib,importlib.util,json,os,secrets,subprocess,tempfile,time,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
module=ROOT/'offline-release/recovery/20261022-award-photo-01/repair.py'
spec=importlib.util.spec_from_file_location('photo',module); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
work=Path(tempfile.mkdtemp(prefix='photo-test-')); os.chmod(work,0o700)
os.environ['MINIO_ROOT_USER']='test-'+secrets.token_hex(6)
os.environ['MINIO_ROOT_PASSWORD']=secrets.token_hex(24)
cids=[]; network='photo-test-'+secrets.token_hex(6)
def run(cmd,data=None,check=True):
 r=subprocess.run(cmd,input=data,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if check and r.returncode: raise RuntimeError('Fixture command failed: '+r.stderr[:600])
 return r

def sql(text,check=True):
 return run(['docker','exec','-i',pg,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres'],text,check)

def ins(table,row):
 return 'INSERT INTO '+table+' ('+','.join(row)+') SELECT '+','.join(row)+' FROM jsonb_populate_record(NULL::'+table+','+m.literal(json.dumps(row))+'::jsonb);'
try:
 run(['docker','network','create','--internal',network])
 mini=run(['docker','run','-d','--network',network,'--network-alias','minio','-e','MINIO_ROOT_USER','-e','MINIO_ROOT_PASSWORD','minio/minio:latest','server','/data']).stdout.strip(); cids.append(mini)
 pg=run(['docker','run','-d','--network','none','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_USER=postgres','-e','POSTGRES_DB=postgres','postgres:16-alpine']).stdout.strip(); cids.append(pg)
 for _ in range(60):
  if run(['docker','exec',pg,'pg_isready','-U','postgres'],check=False).returncode==0: break
  time.sleep(.5)
 runtime=work/'runtime';runtime.mkdir()
 (runtime/'compose.sh').write_text('''#!/bin/bash
set -eu
case "$1" in
exec) shift 3; docker exec -i '''+pg+''' "$@";;
run) shift 9; docker run --rm -i --network '''+network+''' -e MINIO_ROOT_USER -e MINIO_ROOT_PASSWORD --entrypoint /bin/sh minio/mc:latest "$@";;
*) exit 2;;
esac
''')
 args=type('Args',(),{'runtime':str(runtime),'report_root':str(work),'apply':False})()
 helper=m.Repair(args)
 helper.mc('mc ready photos >/dev/null\nmc mb photos/'+m.BUCKET+' >/dev/null\n')
 migrations=ROOT/'app/hackhub-api/src/main/resources/db/migration'
 for n in [1,2,10,11,12,13,23,24]: sql(next(migrations.glob('V%03d__*'%n)).read_text())
 uid=m.NEW_OWNER; second=str(uuid.uuid4())
 for user in [uid,second]: sql(ins('profiles',dict(id=user,email=user+'@example.invalid',name='Fixture user',role='admin',password_hash='NOT_A_REAL_PASSWORD')))
 sql(ins('hackathons',dict(id=m.TARGET,title='Current campaign',description='Keep settings',start_date='2026-10-22',end_date='2026-12-31',registration_key='TEST_REGISTRATION',allowed_participants=100,created_by=uid,status='draft')))
 all_ids=sorted(m.KEEP)+['a70b3411-b01e-4e22-ad4d-e264369d62ac']
 sourcekeys=[]
 for n,idea in enumerate(all_ids):
  owner=second if n==0 else uid
  old_owner=second if n==0 else m.OLD_OWNER
  key='nominations/'+(m.OLD_AWARD if n<4 else m.TARGET)+'/'+(old_owner if n<4 else uid)+'/'+str(uuid.uuid4())+'.png'
  sourcekeys.append(key)
  sql(ins('ideas',dict(id=idea,title='Photo '+str(n),description='Keep original text',hackathon_id=m.TARGET,created_by=owner,project_attachments=[{'type':'nomination','nomineeUserId':owner,'name':'Keep name'},{'type':'screenshot','storageKey':key,'url':'/storage/test?X-Amz-Signature=TEST_SIGNED_SENTINEL','name':'old-photo.png'}])))
 def rows(): return json.loads(sql('SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM ideas i;').stdout)
 before=rows(); four=[r for r in before if r['id'] in m.KEEP]; plans=m.plan_rows(four)
 statement=m.sql_for(plans)
 # SQL rollback and concurrent updates must leave all original rows intact.
 assert sql(statement.replace('COMMIT;','SELECT 1/0; COMMIT;'),check=False).returncode != 0
 assert rows()==before
 assert sql("BEGIN; UPDATE ideas SET title='concurrent edit' WHERE id='"+all_ids[0]+"';\n"+statement,check=False).returncode !=0
 assert rows()==before
 assert sql("SELECT tgenabled FROM pg_trigger WHERE tgname='trg_ideas_updated_at';").stdout.strip()=='O'
 png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVt8AAAAASUVORK5CYII=')
 expected=hashlib.sha256(png).hexdigest()
 def upload(key,content):
  encoded=base64.b64encode(content).decode()
  helper.mc("printf '%s' '"+encoded+"' | base64 -d >/tmp/picture.png\nmc cp --attr 'Content-Type=image/png' /tmp/picture.png photos/"+m.BUCKET+'/'+key+' >/dev/null\n')
 for key in sourcekeys[:3]+sourcekeys[4:]: upload(key,png)
 common=['python3',str(module),'--runtime',str(runtime),'--report-root',str(work)]
 missing=run(common,check=False)
 assert missing.returncode==1 and 'Original photos missing' in missing.stdout,missing.stdout
 assert rows()==before
 upload(sourcekeys[3],png)
 preview=run(common)
 assert 'Preview passed' in preview.stdout and rows()==before
 # Existing different destination must never be overwritten, including APPLY mode.
 conflict=plans[0]['destination']; upload(conflict,b'DIFFERENT_TEST_BYTES')
 collision=run(common+['--apply'],check=False)
 assert collision.returncode==1 and 'refusing overwrite' in collision.stdout,collision.stdout
 assert helper.digest(conflict)==hashlib.sha256(b'DIFFERENT_TEST_BYTES').hexdigest()
 assert rows()==before
 helper.mc('mc rm photos/'+m.BUCKET+'/'+conflict+' >/dev/null\n')
 apply=run(common+['--apply'])
 assert 'Photo repair committed' in apply.stdout,apply.stdout
 after={r['id']:r for r in rows()}
 for p in plans:
  assert after[p['id']]==p['after']
  assert helper.digest(p['source'])==expected
  assert helper.digest(p['destination'])==expected
  assert helper.stat(p['destination'])['metadata']['Content-Type']=='image/png'
 assert after[all_ids[4]]==next(r for r in before if r['id']==all_ids[4])
 assert sql("SELECT count(*) FROM hackathons WHERE status='draft';").stdout.strip()=='1'
 repeat=run(common+['--apply'])
 assert 'already point to current campaign' in repeat.stdout
 for output in [missing.stdout,preview.stdout,collision.stdout,apply.stdout,repeat.stdout]:
  assert 'TEST_SIGNED_SENTINEL' not in output and os.environ['MINIO_ROOT_PASSWORD'] not in output
 (work/'results.txt').write_text(missing.stdout+'\n'+preview.stdout+'\n'+collision.stdout+'\n'+apply.stdout+'\n'+repeat.stdout)
 print('PASS: real MinIO objects + PostgreSQL; missing-source/collision rejection; 4 byte-identical copies and originals retained; content type preserved; current owner/campaign keys; only photo references changed; SQL rollback/concurrent-change protection; new nomination unchanged; repeat no-op; no credential/signed-URL output.')
 print('Test report:',work/'results.txt')
 helper.log.close()
finally:
 for c in cids: subprocess.run(['docker','rm','-fv',c],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 subprocess.run(['docker','network','rm',network],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
