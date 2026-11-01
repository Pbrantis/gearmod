# Gera somente o executável portátil do AgentBoard.
# Uso: powershell -File build.ps1   (ou .\build.ps1 no PowerShell)
# Saída: apps\desktop\dist\win-unpacked\AgentBoard.exe
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# pnpm nao esta no PATH nesta maquina: cria um atalho via corepack so para esta execucao.
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  $shim = Join-Path $env:TEMP 'pnpmshim'
  New-Item -ItemType Directory -Force $shim | Out-Null
  corepack enable pnpm --install-directory $shim
  $env:PATH = "$shim;$env:PATH"
}

# Um AgentBoard.exe aberto (mesmo em segundo plano) trava a pasta dist\win-unpacked e o build falha.
$unpacked = Join-Path $PSScriptRoot 'apps\desktop\dist\win-unpacked'
$running = Get-Process -Name AgentBoard -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -and $_.Path.StartsWith($unpacked, [StringComparison]::OrdinalIgnoreCase) }
if ($running) {
  Write-Host "Fechando $($running.Count) processo(s) do AgentBoard que estavam travando o build..."
  $running | Stop-Process -Force
  Start-Sleep -Seconds 2
}

pnpm install
if ($LASTEXITCODE -ne 0) { throw "pnpm install falhou (codigo $LASTEXITCODE)" }

Push-Location (Join-Path $PSScriptRoot 'apps\desktop')
try {
  pnpm run build
  if ($LASTEXITCODE -ne 0) { throw "pnpm run build falhou (codigo $LASTEXITCODE)" }

  pnpm exec electron-builder --win --dir
  if ($LASTEXITCODE -ne 0) { throw "electron-builder --win --dir falhou (codigo $LASTEXITCODE)" }
}
finally {
  Pop-Location
}

Get-Item (Join-Path $unpacked 'AgentBoard.exe') | Select-Object FullName, LastWriteTime
