$ErrorActionPreference = 'Stop'
& "$PSScriptRoot/dev.ps1" setup:local
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$redisConfig = (Resolve-Path (Join-Path $PSScriptRoot '../.local/redis.conf')).Path
$wslPath = '/mnt/' + $redisConfig.Substring(0,1).ToLower() + $redisConfig.Substring(2).Replace('\','/')
& wsl -d Ubuntu-22.04 -u root -- redis-server $wslPath
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& "$PSScriptRoot/dev.ps1" exec node scripts/check-services.mjs
exit $LASTEXITCODE
