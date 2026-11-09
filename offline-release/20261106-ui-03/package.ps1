# 将已经构建并验证的两个镜像导出为允许清单限定的离线包。
$ErrorActionPreference = 'Stop'
$version = '20261106-ui-03'
$releaseRoot = Join-Path (Split-Path $PSScriptRoot -Parent) 'releases'
$output = Join-Path $releaseRoot $version
$archive = Join-Path $releaseRoot "$version.tar.gz"
$utf8 = [System.Text.UTF8Encoding]::new($false)
if ((Test-Path -LiteralPath $output) -or (Test-Path -LiteralPath $archive)) {
    throw '发布目录或压缩包已存在，请先核对，不覆盖已有发布。'
}
$images = @{}
foreach ($service in @('app', 'api')) {
    $reference = "hackhub-offline/${service}:$version"
    $raw = & docker image inspect $reference
    if ($LASTEXITCODE -ne 0) { throw "镜像不存在：$reference" }
    $details = ($raw | ConvertFrom-Json)[0]
    if ($details.Os -ne 'linux' -or $details.Architecture -ne 'amd64') { throw "镜像架构不正确：$reference" }
    $images[$service] = @{ Reference = $reference; Id = $details.Id }
}
New-Item -ItemType Directory -Path (Join-Path $output 'images') -Force | Out-Null
foreach ($name in @('UPDATE.md', 'update.sh')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $output $name)
}
$manifest = "service`timage`timage_id`tplatform`tconfig_id`n"
$readConfigId = @'
import hashlib, json, sys, tarfile
with tarfile.open(sys.argv[1], 'r') as archive:
    entries = json.load(archive.extractfile('manifest.json'))
    matching = [item for item in entries if sys.argv[2] in (item.get('RepoTags') or [])]
    assert len(matching) == 1, 'Expected exactly one matching image tag'
    raw = archive.extractfile(matching[0]['Config']).read()
    config = json.loads(raw)
    assert config['os'] == 'linux' and config['architecture'] == 'amd64', 'Wrong config architecture'
    print('sha256:' + hashlib.sha256(raw).hexdigest())
'@
$references = ''
foreach ($service in @('app', 'api')) {
    $details = $images[$service]
    & docker image save -o (Join-Path $output "images/$service.tar") $details.Reference
    if ($LASTEXITCODE -ne 0) { throw "镜像导出失败：$service" }
    # 旧 Docker Engine 使用配置内容摘要，新版可能返回 OCI 索引摘要，两者都记录。
    $configId = & python -c $readConfigId (Join-Path $output "images/$service.tar") $details.Reference
    if ($LASTEXITCODE -ne 0 -or $configId -notmatch '^sha256:[0-9a-f]{64}$') { throw "镜像配置摘要读取失败：$service" }
    $manifest += "$service`t$($details.Reference)`t$($details.Id)`tlinux/amd64`t$configId`n"
    $references += "$($service.ToUpperInvariant())_IMAGE=$($details.Reference)`n"
}
[System.IO.File]::WriteAllText((Join-Path $output 'manifest.tsv'), $manifest, $utf8)
[System.IO.File]::WriteAllText((Join-Path $output 'images.env'), $references, $utf8)
$allowed = @('images/app.tar', 'images/api.tar', 'images.env', 'manifest.tsv', 'UPDATE.md', 'update.sh')
$checksums = ''
foreach ($relative in $allowed) {
    $hash = (Get-FileHash -LiteralPath (Join-Path $output $relative) -Algorithm SHA256).Hash.ToLowerInvariant()
    $checksums += "$hash  $relative`n"
}
[System.IO.File]::WriteAllText((Join-Path $output 'SHA256SUMS'), $checksums, $utf8)
# 只打包刚生成的发布目录，不包含仓库、源码、生产配置或凭据。
& tar -czf $archive -C $releaseRoot $version
if ($LASTEXITCODE -ne 0) { throw '生成 tar.gz 失败。' }
if ((Get-Item -LiteralPath $archive).Length -ge 2GB) { throw '压缩包超过堡垒机单文件 2 GB 限制。' }
$archiveHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText("$archive.sha256", "$archiveHash  $version.tar.gz`n", $utf8)
Get-Item -LiteralPath $archive, "$archive.sha256" | Select-Object FullName, Length
