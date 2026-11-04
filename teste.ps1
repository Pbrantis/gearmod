# Opens the TEST build (the current apps\desktop\dist\win-unpacked) with data kept apart from the stable install.
# Usage: .\teste.ps1              opens the "teste" profile
#        .\teste.ps1 -CopyData    first copies the stable install's data into the test profile (overwrites the test data)
param([Alias('CopiarDados')][switch]$CopyData)
$ErrorActionPreference = 'Stop'
$exe = Join-Path $PSScriptRoot 'apps\desktop\dist\win-unpacked\GearMod.exe'
if (-not (Test-Path $exe)) { throw "Build not found: $exe (run build.ps1)" }

$testDir = Join-Path $env:APPDATA 'GearMod-teste'
if ($CopyData) {
  $source = Join-Path $env:APPDATA 'GearMod\data'
  if (-not (Test-Path $source)) { throw "Stable install data not found: $source" }
  $open = Get-Process -Name GearMod -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith((Split-Path $exe), [StringComparison]::OrdinalIgnoreCase) }
  if ($open) { throw 'The test build is open; close it before copying the data.' }
  Remove-Item (Join-Path $testDir 'data') -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force $testDir | Out-Null
  Copy-Item $source (Join-Path $testDir 'data') -Recurse
  Write-Host 'Stable install data copied to the test profile.'
}

$env:GEARMOD_PROFILE = 'teste'
Start-Process -FilePath $exe
Write-Host "Test build opened (data in $testDir)."
