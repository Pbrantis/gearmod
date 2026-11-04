# Builds the full GearMod NSIS installer.
# Usage: powershell -File installer.ps1   (or .\installer.ps1 in PowerShell)
# Output: apps\desktop\dist\GearMod-Setup-<version>-x64.exe
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# If pnpm is not on PATH, create a shim through corepack for this run only.
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  $shim = Join-Path $env:TEMP 'pnpmshim'
  New-Item -ItemType Directory -Force $shim | Out-Null
  corepack enable pnpm --install-directory $shim
  $env:PATH = "$shim;$env:PATH"
}

# An open GearMod.exe (even in the background) locks dist\win-unpacked and the build fails.
$unpacked = Join-Path $PSScriptRoot 'apps\desktop\dist\win-unpacked'
$running = Get-Process -Name GearMod -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -and $_.Path.StartsWith($unpacked, [StringComparison]::OrdinalIgnoreCase) }
if ($running) {
  Write-Host "Closing $($running.Count) GearMod process(es) that were locking the build..."
  $running | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
}

pnpm install
if ($LASTEXITCODE -ne 0) { throw "pnpm install failed (exit code $LASTEXITCODE)" }

pnpm dist
if ($LASTEXITCODE -ne 0) { throw "pnpm dist failed (exit code $LASTEXITCODE)" }

Get-ChildItem apps\desktop\dist -Filter 'GearMod-Setup-*.exe' |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1 FullName, LastWriteTime
