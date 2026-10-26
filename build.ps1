# Gera o instalador do AgentBoard em apps\desktop\dist.
# Uso: powershell -File build.ps1   (ou .\build.ps1 no PowerShell)
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
pnpm dist
if ($LASTEXITCODE -ne 0) { throw "pnpm dist falhou (codigo $LASTEXITCODE)" }

Get-ChildItem apps\desktop\dist -Filter *.exe | Select-Object FullName, LastWriteTime
