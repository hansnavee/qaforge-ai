Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if ($args.Count -lt 1) {
  Write-Host 'Usage: qaforge-runner.ps1 --api <API_URL> --token <TOKEN>'
  Write-Host 'Run from any PowerShell folder. This file always uses the QAForge clone next to it.'
  exit 1
}
pnpm --filter @qaforge/worker local-runner @args
