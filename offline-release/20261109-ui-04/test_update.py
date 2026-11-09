"""在隔离 Linux 容器中模拟更新、回滚和前置检查，不连接生产。"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    runtime = root / "runtime"
    package = root / "package"
    commands = root / "bin"
    for item in (runtime, package / "images", commands):
        item.mkdir(parents=True)
    source = Path(__file__).with_name("update.sh").read_text()
    source = source.replace("/opt/hackhub", str(root))
    (package / "update.sh").write_text(source)
    original = "APP_IMAGE=old/app:stable\nAPI_IMAGE=old/api:stable\nPOSTGRES_IMAGE=postgres:16\nMINIO_IMAGE=minio:stable\n"
    (runtime / "images.env").write_text(original)
    (runtime / ".env").write_text("PRESERVE_THIS=unchanged\n")
    old = {"app": "sha256:" + "a" * 64, "api": "sha256:" + "b" * 64}
    index_ids = {"app": "sha256:" + "c" * 64, "api": "sha256:" + "d" * 64}
    config_ids = {"app": "sha256:" + "e" * 64, "api": "sha256:" + "f" * 64}
    new = config_ids if os.environ.get("MOCK_ID_KIND") == "config" else index_ids
    state = {"images": {"old/app:stable": old["app"], "old/api:stable": old["api"]}, "running": old.copy(), "up": []}
    state_path = root / "state.json"
    state_path.write_text(json.dumps(state))
    manifest = "service\timage\timage_id\tplatform\tconfig_id\n"
    for service in ("app",):
        (package / "images" / f"{service}.tar").write_text(service)
        manifest += f"{service}\thackhub-offline/{service}:20261109-ui-04\t{index_ids[service]}\tlinux/amd64\t{config_ids[service]}\n"
    (package / "manifest.tsv").write_text(manifest)
    (package / "SHA256SUMS").write_text("".join(f"{digest(package / filename)}  {filename}\n" for filename in ("images/app.tar", "manifest.tsv", "update.sh")))
    mock = '''#!/usr/bin/env python3
import json, os, pathlib, sys
root = pathlib.Path(os.environ['MOCK_ROOT'])
p = root / 'state.json'
s = json.loads(p.read_text())
a = sys.argv[1:]
if pathlib.Path(sys.argv[0]).name == 'compose-mock':
    if a[:1] == ['config']: pass
    elif a[:2] == ['ps', '-q']: print(a[2] + '-cid')
    elif a[:1] == ['ps']: print('app api healthy')
    elif a[:1] == ['up']:
        service = a[-1]
        env = dict(line.split('=', 1) for line in (root / 'runtime/images.env').read_text().splitlines())
        s['running'][service] = s['images'][env[service.upper() + '_IMAGE']]
        s['up'].append(service)
    elif a[:1] == ['exec']: pass
    else: raise AssertionError(a)
else:
    if a[:1] == ['info']: print('linux/x86_64')
    elif a[:2] == ['image', 'inspect']:
        ref = a[-1]
        if ref not in s['images']: sys.exit(1)
        print(s['images'][ref] if '{{.Id}}' in a else 'linux/amd64')
    elif a[:1] == ['inspect']:
        service = a[-1].removesuffix('-cid')
        fmt = a[2]
        print(s['running'][service] if fmt == '{{.Image}}' else 'running' if fmt == '{{.State.Status}}' else 'healthy')
    elif a[:1] == ['tag']:
        assert a[1] in s['images'].values()
        s['images'][a[2]] = a[1]
    elif a[:1] == ['load']:
        service = pathlib.Path(a[-1]).stem
        kind = os.environ.get('MOCK_ID_KIND', 'index')
        code = ('e' if service == 'app' else 'f') if kind == 'config' else ('c' if service == 'app' else 'd')
        if kind == 'invalid': code = '0'
        s['images']['hackhub-offline/' + service + ':20261109-ui-04'] = 'sha256:' + code * 64
    else: raise AssertionError(a)
p.write_text(json.dumps(s))
'''
    for name in ("docker", "compose-mock"):
        command = commands / name
        command.write_text(mock)
        command.chmod(0o755)
    (runtime / "compose.sh").write_text('#!/usr/bin/env bash\nexec compose-mock "$@"\n')
    environment = dict(os.environ, MOCK_ROOT=str(root), PATH=str(commands) + ":" + os.environ["PATH"])
    def run(*arguments, expected=0):
        result = subprocess.run(["bash", str(package / "update.sh"), *arguments], env=environment, text=True, capture_output=True)
        if result.returncode != expected:
            raise AssertionError(result.stdout + result.stderr)
        return result

    run("update")
    updated = json.loads(state_path.read_text())
    assert updated["running"] == {"app": new["app"], "api": old["api"]}
    assert updated["up"] == ["app"]
    assert "API_IMAGE=old/api:stable\nPOSTGRES_IMAGE=postgres:16\nMINIO_IMAGE=minio:stable\n" in (runtime / "images.env").read_text()
    assert (runtime / ".env").read_text() == "PRESERVE_THIS=unchanged\n"
    backups = list((root / "backups").iterdir())
    assert len(backups) == 1
    assert (backups[0] / "images.env").read_text() == original
    run("rollback", str(backups[0]))
    rolled_back = json.loads(state_path.read_text())
    assert rolled_back["running"] == old
    assert rolled_back["up"] == ["app", "app"]
    assert "API_IMAGE=old/api:stable\nPOSTGRES_IMAGE=postgres:16\nMINIO_IMAGE=minio:stable\n" in (runtime / "images.env").read_text()
    before = (runtime / "images.env").read_text()
    rolled_back["running"]["app"] = new["app"]
    state_path.write_text(json.dumps(rolled_back))
    run("update", expected=1)
    assert (runtime / "images.env").read_text() == before
    assert len(list((root / "backups").iterdir())) == 1
    rolled_back["running"] = old.copy()
    state_path.write_text(json.dumps(rolled_back))
    environment["MOCK_ID_KIND"] = "invalid"
    run("update", expected=1)
    assert (runtime / "images.env").read_text() == before
    assert json.loads(state_path.read_text())["up"] == ["app", "app"]
    print("PASS: " + os.environ.get("MOCK_ID_KIND", "index") + " IDs, update, rollback, image identity, service order, unrelated settings preservation, drift refusal, invalid imported ID refusal")
