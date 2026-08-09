# Deploy QAForge API (and optionally worker) to Railway from this machine.
# Use when GitHub auto-deploy is unavailable (missing Railway GitHub App access).
#
# Prerequisites: `npx @railway/cli login` (once)
#
# Usage:
#   .\scripts\railway-deploy.ps1
#   .\scripts\railway-deploy.ps1 -Service both

param(
  [ValidateSet('api', 'worker', 'both')]
  [string]$Service = 'api'
)

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

function Deploy-One([string]$name) {
  Write-Host "Deploying $name..."
  npx --yes @railway/cli up `
    --service $name `
    --environment production `
    --ci `
    --detach `
    --yes `
    --message "local deploy $name $(git rev-parse --short HEAD)"
  npx --yes @railway/cli service source connect `
    --service $name `
    --repo hansnavee/qaforge-ai `
    --branch master `
    --json | Out-Null
}

if ($Service -eq 'api' -or $Service -eq 'both') { Deploy-One 'api' }
if ($Service -eq 'worker' -or $Service -eq 'both') { Deploy-One 'worker' }

Write-Host "Done. Watch status with: npx @railway/cli service status --service api"
Write-Host "If GitHub auto-deploy is still dead, connect GitHub at https://railway.com/account/github"
