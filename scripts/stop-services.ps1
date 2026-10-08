$ErrorActionPreference = 'Stop'
$dataDirectory = (Resolve-Path (Join-Path $PSScriptRoot '../.local/postgres')).Path
& 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe' -D $dataDirectory -m fast -w stop
& "$PSScriptRoot/dev.ps1" exec node scripts/stop-redis.mjs
exit $LASTEXITCODE
