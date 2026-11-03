# Promove o build atual (win-unpacked) para a versão HOMOLOGADA em C:\GearMod-homologado e abre.
# Os dados da homologada ficam em %APPDATA%\GearMod e nao sao tocados; so o programa e substituido.
# Uso: .\homologar.ps1
$ErrorActionPreference = 'Stop'
$origem = Join-Path $PSScriptRoot 'apps\desktop\dist\win-unpacked'
$destino = 'C:\GearMod-homologado'
if (-not (Test-Path (Join-Path $origem 'GearMod.exe'))) { throw "Build nao encontrado em $origem (rode build.ps1)" }

# Fecha so a homologada (a de teste roda de outra pasta e continua aberta).
$rodando = Get-Process -Name GearMod -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($destino, [StringComparison]::OrdinalIgnoreCase) }
if ($rodando) {
  Write-Host 'Fechando a homologada atual...'
  $rodando | Stop-Process -Force
  Start-Sleep -Seconds 2
}

New-Item -ItemType Directory -Force $destino | Out-Null
robocopy $origem $destino /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy falhou (codigo $LASTEXITCODE)" }

Start-Process -FilePath (Join-Path $destino 'GearMod.exe')
Get-Item (Join-Path $destino 'GearMod.exe') | Select-Object FullName, LastWriteTime
