# Opens the TEST build (the current apps\desktop\dist\win-unpacked) with data kept apart from the stable install.
# Usage: .\test.ps1              opens the "test" profile (data in %APPDATA%\GearMod-test)
#        .\test.ps1 -CopyData    first copies the stable install's data into the test profile (overwrites the test data)
param([switch]$CopyData)
$ErrorActionPreference = 'Stop'
$exe = Join-Path $PSScriptRoot 'apps\desktop\dist\win-unpacked\GearMod.exe'
if (-not (Test-Path $exe)) { throw "Build not found: $exe (run build.ps1)" }

$testDir = Join-Path $env:APPDATA 'GearMod-test'
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

# The test profile used to be called "teste". Its folder is not renamed, because worktree paths are stored inside it.
$oldTestDir = Join-Path $env:APPDATA 'GearMod-teste'
if (Test-Path $oldTestDir) { Write-Host "The old test profile in $oldTestDir is no longer used. Delete it when you no longer need it; use -CopyData to start the new one from the stable data." }

$env:GEARMOD_PROFILE = 'test'
Start-Process -FilePath $exe
Write-Host "Test build opened (data in $testDir)."
