"""启动或清理本机发布验收环境，只使用临时数据库和仓库测试密钥。"""
import os
from pathlib import Path
import re
import subprocess
import sys
import time


ROOT = Path(__file__).resolve().parents[1]
NETWORK = 'hackhub-ui1109-smoke-net'
CONTAINERS = ['hackhub-ui1109-app', 'hackhub-ui1109-api', 'hackhub-ui1109-pg']
VERSION = '20261109-ui-01'
API_VERSION = '20261106-ui-03'


def docker(*args, env=None):
    return subprocess.check_output(['docker', *args], text=True, env=env).strip()


def healthy(name, timeout=240):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        status = docker('inspect', '--format', '{{.State.Status}}/{{.State.Health.Status}}', name)
        if status == 'running/healthy':
            print(name + ': healthy', flush=True)
            return
        if status.startswith(('exited/', 'dead/')):
            raise RuntimeError(name + ': ' + status + '; inspect container logs')
        time.sleep(3)
    raise TimeoutError(name + ': health timeout; inspect container logs')


def start():
    # 拒绝覆盖已有同名容器或网络，失败时保留现场供诊断。
    existing = set(docker('ps', '-a', '--format', '{{.Names}}').splitlines())
    assert not existing.intersection(CONTAINERS), 'Smoke containers already exist'
    networks = set(docker('network', 'ls', '--format', '{{.Name}}').splitlines())
    assert NETWORK not in networks, 'Smoke network already exists'
    for service in ('app', 'api'):
        assert docker('image', 'inspect', '--format', '{{.Os}}/{{.Architecture}}',
                      f'hackhub-offline/{service}:{VERSION if service == "app" else API_VERSION}') == 'linux/amd64'
    docker('network', 'create', '--internal', NETWORK)
    # 数据库仅保存在 tmpfs；不发布数据库端口，也不接入任何已有服务。
    docker('run', '-d', '--pull=never', '--name', 'hackhub-ui1109-pg', '--network', NETWORK,
           '--network-alias', 'postgres', '--tmpfs', '/var/lib/postgresql/data:rw,size=512m',
           '-e', 'POSTGRES_DB=hackhub', '-e', 'POSTGRES_USER=hackhub',
           '-e', 'POSTGRES_PASSWORD=local-smoke-only',
           '--health-cmd', 'pg_isready -U hackhub -d hackhub', '--health-interval', '3s',
           '--health-timeout', '3s', '--health-retries', '20', 'postgres:16-alpine')
    healthy('hackhub-ui1109-pg', 90)
    source = (ROOT / 'app/hackhub-api/src/test/resources/application-integrationtest.yml').read_text(encoding='utf-8')
    environment = os.environ.copy()
    for kind in ('PRIVATE', 'PUBLIC'):
        match = re.search(rf'-----BEGIN {kind} KEY-----[\s\S]*?-----END {kind} KEY-----', source)
        assert match is not None
        environment[f'JWT_{kind}_KEY'] = '\n'.join(line.strip() for line in match[0].splitlines())
    # minio 别名仅供 Nginx 启动时解析；本次验收不访问附件或存储接口。
    docker('run', '-d', '--pull=never', '--name', 'hackhub-ui1109-api', '--network', NETWORK,
           '--network-alias', 'api', '--network-alias', 'minio',
           '-e', 'JWT_PRIVATE_KEY', '-e', 'JWT_PUBLIC_KEY',
           '-e', 'SPRING_DATASOURCE_URL=jdbc:postgresql://postgres:5432/hackhub',
           '-e', 'SPRING_DATASOURCE_USERNAME=hackhub', '-e', 'SPRING_DATASOURCE_PASSWORD=local-smoke-only',
           '-e', 'APP_SSO_ENABLED=false', '-e', 'APP_AUTH_COOKIE_SECURE=false',
           f'hackhub-offline/api:{API_VERSION}', env=environment)
    healthy('hackhub-ui1109-api')
    docker('run', '-d', '--pull=never', '--name', 'hackhub-ui1109-app', '--network', NETWORK,
           f'hackhub-offline/app:{VERSION}')
    healthy('hackhub-ui1109-app', 90)
    docker('exec', 'hackhub-ui1109-app', 'nginx', '-t')
    print('PASS: isolated final-image fixture ready; run smoke inside hackhub-ui1109-smoke-net with SMOKE_BASE_URL=http://hackhub-ui1109-app', flush=True)


def cleanup():
    # 只移除本脚本创建且属于独立验收网络的容器，拒绝处理其他容器。
    existing = set(docker('ps', '-a', '--format', '{{.Names}}').splitlines())
    for name in CONTAINERS:
        if name in existing:
            attached = docker('inspect', '--format', '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}', name).split()
            assert attached == [NETWORK], f'Unexpected network for {name}: {attached}'
            docker('rm', '-f', name)
    if NETWORK in set(docker('network', 'ls', '--format', '{{.Name}}').splitlines()):
        docker('network', 'rm', NETWORK)
    print('PASS: removed only ui1109 smoke containers and network', flush=True)


if __name__ == '__main__':
    assert len(sys.argv) == 2 and sys.argv[1] in ('start', 'cleanup'), 'Usage: python test/ui1109-runtime-fixture.py start|cleanup'
    (start if sys.argv[1] == 'start' else cleanup)()
