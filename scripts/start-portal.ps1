$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
Set-Location $taskRoot
$taskNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
if (-not (Test-Path $taskNode)) { $taskNode = 'node' }
if (-not (Test-Path '.local/localhost.pem')) { throw 'Generate a workspace-local HTTPS key and certificate first. See docs/LOCAL_SETUP.md.' }
& $taskNode node_modules/next/dist/bin/next dev apps/platform-admin --hostname localhost --port 3100 --experimental-https --experimental-https-key "$taskRoot/.local/localhost.key" --experimental-https-cert "$taskRoot/.local/localhost.pem"
