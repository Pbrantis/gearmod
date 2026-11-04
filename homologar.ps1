# Promotes the current build (win-unpacked) to the STABLE install in C:\GearMod-homologado and opens it.
# The stable install's data lives in %APPDATA%\GearMod and is not touched; only the program files are replaced.
# Usage: .\homologar.ps1
$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'apps\desktop\dist\win-unpacked'
$target = 'C:\GearMod-homologado'
if (-not (Test-Path (Join-Path $source 'GearMod.exe'))) { throw "Build not found in $source (run build.ps1)" }

# Close only the stable install (the test build runs from another folder and stays open).
$running = Get-Process -Name GearMod -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($target, [StringComparison]::OrdinalIgnoreCase) }
if ($running) {
  Write-Host 'Closing the current stable install...'
  # Some app process may already have exited between listing and stopping: that is not an error.
  $running | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
}

New-Item -ItemType Directory -Force $target | Out-Null
robocopy $source $target /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed (exit code $LASTEXITCODE)" }

Start-Process -FilePath (Join-Path $target 'GearMod.exe')
Get-Item (Join-Path $target 'GearMod.exe') | Select-Object FullName, LastWriteTime
