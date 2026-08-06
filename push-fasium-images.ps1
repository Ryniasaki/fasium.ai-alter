param(
    [string]$Registry = "harbor.jototech.cn",
    [string]$Project = "fasium",
    [string]$Tag = "latest",
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$images = @(
    "code-frontend",
    "code-runninghub-service",
    "code-tenant-service",
    "code-tenant-worker"
)

function Require-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $Name"
    }
}

Require-Command -Name "docker"

Write-Host "Target registry: $Registry/$Project"
Write-Host "Tag: $Tag"
Write-Host ""

foreach ($image in $images) {
    $source = "${image}:$Tag"
    $target = "${Registry}/${Project}/${image}:$Tag"

    $exists = docker image inspect $source *> $null
    if (-not $?) {
        throw "Local image not found: $source"
    }

    Write-Host "Tagging $source -> $target"
    if (-not $DryRun) {
        docker tag $source $target
    }

    Write-Host "Pushing $target"
    if (-not $DryRun) {
        docker push $target
    }

    Write-Host "Done: $target"
    Write-Host ""
}

if ($DryRun) {
    Write-Host "Dry run completed. No tags/pushes were executed."
} else {
    Write-Host "All images pushed successfully."
}
