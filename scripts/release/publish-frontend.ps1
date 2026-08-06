param(
    [string]$Registry = "harbor.jototech.cn",
    [string]$Project = "fasium",
    [string]$ContextPath = "comfyui-clothing",
    [string]$Tag = "latest"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Require-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $Name"
    }
}

Require-Command -Name "docker"
Require-Command -Name "git"

$shortSha = (git rev-parse --short HEAD).Trim()
if (-not $shortSha) {
    throw "Failed to resolve git commit SHA."
}

$localLatest = "code-frontend:latest"
$localVersioned = "code-frontend:$shortSha"
$remoteLatest = "${Registry}/${Project}/code-frontend:latest"
$remoteVersioned = "${Registry}/${Project}/code-frontend:$shortSha"

Write-Host "Building frontend image from: $ContextPath"
Write-Host "Local tags: $localLatest, $localVersioned"
Write-Host "Remote tags: $remoteLatest, $remoteVersioned"
Write-Host ""

docker build `
    --pull `
    -t $localLatest `
    -t $localVersioned `
    -f (Join-Path $ContextPath "Dockerfile") `
    $ContextPath

docker tag $localLatest $remoteLatest
docker tag $localLatest $remoteVersioned

Write-Host ""
Write-Host "Pushing $remoteVersioned"
docker push $remoteVersioned

Write-Host "Pushing $remoteLatest"
docker push $remoteLatest

Write-Host ""
Write-Host "Frontend publish complete."
Write-Host "Use $remoteVersioned for immutable deployment references, and $remoteLatest for the default compose path."
