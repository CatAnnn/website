"""校验离线包内容、镜像身份、文件编码及构建静态产物。"""
import csv
import hashlib
import io
from pathlib import Path
import subprocess
import tarfile

root = Path(__file__).resolve().parents[2]
version = '20261109-ui-02'
release = root / 'offline-release/releases' / version
archive = release.with_suffix('.tar.gz')
digest = lambda raw: hashlib.sha256(raw).hexdigest()
expected = archive.with_suffix('.gz.sha256').read_text().split()[0]
assert digest(archive.read_bytes()) == expected
allowed = {'images/app.tar', 'images.env', 'manifest.tsv', 'UPDATE.md', 'update.sh', 'SHA256SUMS'}
with tarfile.open(archive) as package:
    names = {item.name[len(version) + 1:] for item in package.getmembers() if item.isfile() and item.name.startswith(version + '/')}
    assert all(item.name.startswith(version + '/') for item in package.getmembers() if item.isfile())
    assert names == allowed, names
    checks = package.extractfile(version + '/SHA256SUMS').read().decode('utf-8')
    for line in checks.splitlines():
        sha, name = line.split('  ', 1)
        raw = package.extractfile(version + '/' + name).read()
        assert digest(raw) == sha, name
        assert raw == (release / name).read_bytes(), name
    script = package.extractfile(version + '/update.sh').read()
    assert b'\r' not in script and not script.startswith(b'\xef\xbb\xbf')
    assert '\ufffd' not in script.decode('utf-8')
for entry in csv.DictReader(io.StringIO((release / 'manifest.tsv').read_text()), delimiter='\t'):
    subprocess.run(['docker', 'load', '-i', str(release / 'images' / (entry['service'] + '.tar'))], check=True)
    actual = subprocess.check_output(['docker', 'image', 'inspect', '--format', '{{.Id}}', entry['image']], text=True).strip()
    assert actual in (entry['image_id'], entry['config_id'])
    assert subprocess.check_output(['docker', 'image', 'inspect', '--format', '{{.Os}}/{{.Architecture}}', entry['image']], text=True).strip() == 'linux/amd64'
# 比较实际运行镜像中的静态文件与构建输出，确认交付的是本次编译结果。
dist = root / 'app/hackhub-app/dist'
files = [file for file in dist.rglob('*') if file.is_file()]
runtime_hashes = subprocess.check_output(['docker', 'exec', 'hackhub-ui1109rules-app', 'sh', '-c', 'find /usr/share/nginx/html -type f -exec sha256sum {} +'], text=True)
lookup = {line.split('  ', 1)[1]: line.split('  ', 1)[0] for line in runtime_hashes.splitlines()}
for file in files:
    relative = file.relative_to(dist).as_posix()
    assert lookup['/usr/share/nginx/html/' + relative] == digest(file.read_bytes()), relative
changed = subprocess.check_output(['git', 'diff', 'HEAD', '--name-only'], cwd=root, text=True).splitlines()
for name in changed:
    if Path(name).suffix not in {'.ts', '.tsx', '.java', '.json', '.css', '.md', '.sh', '.ps1', '.py', '.cjs'}:
        continue
    text = (root / name).read_text(encoding='utf-8-sig')
    assert '\ufffd' not in text, name
print(f'PASS: outer/inner SHA256, six allowed payload files, shell LF/UTF-8, image load/identity/platform, {len(files)} runtime static files, source UTF-8')
print(f'ARCHIVE_BYTES={archive.stat().st_size}\nSHA256={expected}')
