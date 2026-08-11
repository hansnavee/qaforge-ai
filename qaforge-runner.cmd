@echo off
setlocal
cd /d "%~dp0"
if "%~1"=="" (
  echo Usage: qaforge-runner.cmd --api ^<API_URL^> --token ^<TOKEN^>
  echo Run from any CMD folder. This file always uses the QAForge clone next to it.
  exit /b 1
)
call pnpm --filter @qaforge/worker local-runner %*
exit /b %ERRORLEVEL%
