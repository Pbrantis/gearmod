# Gera o instalador NSIS completo do GearMod.
# Uso: powershell -File installer.ps1   (ou .\installer.ps1 no PowerShell)
# Saída: apps\desktop\dist\GearMod-Setup-<versão>-x64.exe
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# pnpm não está no PATH nesta máquina: cria um atalho via corepack só para esta execução.
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  $shim = Join-Path $env:TEMP 'pnpmshim'
  New-Item -ItemType Directory -Force $shim | Out-Null
  corepack enable pnpm --install-directory $shim
  $env:PATH = "$shim;$env:PATH"
}

# Um GearMod.exe aberto (mesmo em segundo plano) trava a pasta dist\win-unpacked e o build falha.
$unpacked = Join-Path $PSScriptRoot 'apps\desktop\dist\win-unpacked'
$running = Get-Process -Name GearMod -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -and $_.Path.StartsWith($unpacked, [StringComparison]::OrdinalIgnoreCase) }
if ($running) {
  Write-Host "Fechando $($running.Count) processo(s) do GearMod que estavam travando o build..."
  $running | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
}

pnpm install
if ($LASTEXITCODE -ne 0) { throw "pnpm install falhou (codigo $LASTEXITCODE)" }

pnpm dist
if ($LASTEXITCODE -ne 0) { throw "pnpm dist falhou (codigo $LASTEXITCODE)" }

Get-ChildItem apps\desktop\dist -Filter 'GearMod-Setup-*.exe' |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1 FullName, LastWriteTime
