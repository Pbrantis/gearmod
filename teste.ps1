# Abre a versão de TESTE (build atual de apps\desktop\dist\win-unpacked) com dados separados da homologada.
# Uso: .\teste.ps1                 abre o perfil "teste"
#      .\teste.ps1 -CopiarDados    antes de abrir, copia os dados da homologada para o perfil de teste (sobrescreve o teste)
param([switch]$CopiarDados)
$ErrorActionPreference = 'Stop'
$exe = Join-Path $PSScriptRoot 'apps\desktop\dist\win-unpacked\AgentBoard.exe'
if (-not (Test-Path $exe)) { throw "Build nao encontrado: $exe (rode build.ps1)" }

$teste = Join-Path $env:APPDATA 'AgentBoard-teste'
if ($CopiarDados) {
  $origem = Join-Path $env:APPDATA 'AgentBoard\data'
  if (-not (Test-Path $origem)) { throw "Dados da homologada nao encontrados: $origem" }
  $ativo = Get-Process -Name AgentBoard -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith((Split-Path $exe), [StringComparison]::OrdinalIgnoreCase) }
  if ($ativo) { throw 'A versao de teste esta aberta; feche-a antes de copiar os dados.' }
  Remove-Item (Join-Path $teste 'data') -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force $teste | Out-Null
  Copy-Item $origem (Join-Path $teste 'data') -Recurse
  Write-Host 'Dados da homologada copiados para o perfil de teste.'
}

$env:AGENTBOARD_PROFILE = 'teste'
Start-Process -FilePath $exe
Write-Host "Versao de teste aberta (dados em $teste)."
