# Token comparison across configurations (no graph, CodeGraph and variations of the GearMod graph).
# Run from the worktree root:
#   powershell -ExecutionPolicy Bypass -File .\spike\run-bench.ps1 -Set bit -Repeat 3
#   powershell -ExecutionPolicy Bypass -File .\spike\run-bench.ps1 -Configs abresumo,abexplor -Repeat 2
# -Set: set in spike/bench-sets/<set>.json (folder, questions and answer key)
# -Configs: baseline, codegraph, abfull (graph, full code), abresumo (graph in summary mode),
#           abexplor (summary + Haiku explorer subagent), abtudo (summary + subagent + map in context)
# -Model opus|sonnet (default sonnet) · -Repeat N (rounds, one after the other) · -Only q1,q3
param([string]$Set = 'gearmod', [string[]]$Configs = @('baseline', 'codegraph', 'abfull'), [string]$Model = 'sonnet', [int]$Repeat = 1, [string[]]$Only = @())
# with -File, "a,b,c" arrives as a single string
$Configs = @($Configs | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
$Only = @($Only | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
# 'Continue': in PowerShell 5, with 'Stop', any text on stderr from an external program becomes a fatal error
$ErrorActionPreference = 'Continue'
$spike = $PSScriptRoot
$wt = Split-Path $spike -Parent
$cfg = Get-Content (Join-Path $spike "bench-sets\$Set.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$root = (Resolve-Path (Join-Path $wt $cfg.root)).Path
$out = Join-Path $spike $(if ($Set -eq 'gearmod') { 'bench' } else { "bench-$Set" })
New-Item -ItemType Directory -Force $out | Out-Null
Write-Host "Projeto: $root - configs: $($Configs -join ', ')"

# Inside the desktop app, the terminal inherits variables from its session (ANTHROPIC_BASE_URL, CLAUDE_CODE_*), and the child `claude`
# tries an authentication that only works there. Without them, it uses the user's normal login.
Get-ChildItem Env: | Where-Object { $_.Name -match '^(CLAUDE|ANTHROPIC)' } | ForEach-Object { [Environment]::SetEnvironmentVariable($_.Name, $null, 'Process') }

# Warms up the indexes (parallel runs only read).
$env:GRAPH_EXCLUDE = $cfg.exclude
node --disable-warning=ExperimentalWarning (Join-Path $spike 'cli.mjs') $root index | Out-Null
$cgNode = Join-Path $spike 'node_modules\@colbymchenry\codegraph-win32-x64\node.exe'
$cgJs = Join-Path $spike 'node_modules\@colbymchenry\codegraph-win32-x64\lib\dist\bin\codegraph.js'
if ($Configs -contains 'codegraph' -and -not (Test-Path (Join-Path $root '.codegraph'))) { & $cgNode --liftoff-only --disable-warning=ExperimentalWarning (Join-Path $spike 'cg-index.cjs') $root | Out-Null }
# Project map (~1000 tokens) for the configuration that puts it in context
$mapFile = Join-Path $out 'mapa.txt'
"Mapa do projeto (arquivos mais centrais e seus símbolos, gerado pelo índice de código):`n" + (node --disable-warning=ExperimentalWarning (Join-Path $spike 'cli.mjs') $root map 1000 2>$null | Out-String) | Set-Content $mapFile -Encoding UTF8

$abServer = { param($detail) @{ mcpServers = @{ graph = @{ command = 'node'; args = @('--disable-warning=ExperimentalWarning', (Join-Path $spike 'mcp-graph.mjs')); env = @{ GRAPH_ROOT = $root; GRAPH_DB = (Join-Path $spike 'graph.sqlite'); GRAPH_EXCLUDE = $cfg.exclude; GRAPH_DETAIL = $detail } } } } }
$hintGraph = ' Ha ferramentas de mapa de codigo disponiveis (mcp__graph__*); prefira-as a abrir arquivos inteiros.'
$hintExplor = ' Ha ferramentas de mapa de codigo (mcp__graph__*) e um subagente explorador (ferramenta Agent, subagent_type explorador). Para entender o codigo, delegue a busca ao explorador com a pergunta e use o relatorio dele; depois leia so trechos pontuais se precisar confirmar algo.'
$agentsFile = Join-Path $spike 'agents\explorador.json'
$all = @{
  'baseline'  = @{ mcp = @{ mcpServers = @{} }; tools = 'Read,Grep,Glob'; hint = ''; extra = @() }
  'codegraph' = @{ mcp = @{ mcpServers = @{ graph = @{ command = $cgNode; args = @('--liftoff-only', '--disable-warning=ExperimentalWarning', $cgJs, 'serve', '--mcp', '--path', $root, '--no-watch') } } }; tools = 'Read,Grep,Glob'; hint = $hintGraph; extra = @() }
  'abfull'    = @{ mcp = (& $abServer 'completo'); tools = 'Read,Grep,Glob'; hint = $hintGraph; extra = @() }
  'abresumo'  = @{ mcp = (& $abServer 'resumo'); tools = 'Read,Grep,Glob'; hint = $hintGraph; extra = @() }
  'abexplor'  = @{ mcp = (& $abServer 'resumo'); tools = 'Read,Grep,Glob,Agent'; hint = $hintExplor; extra = @('--agents', $agentsFile) }
  'abtudo'    = @{ mcp = (& $abServer 'resumo'); tools = 'Read,Grep,Glob,Agent'; hint = $hintExplor; extra = @('--agents', $agentsFile, '--append-system-prompt-file', $mapFile) }
}
foreach ($k in $Configs) { if (-not $all.ContainsKey($k)) { throw "Configuração desconhecida: $k" }; $all[$k].mcp | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $out "$k.mcp.json") }

$names = $cfg.questions.PSObject.Properties.Name
# The questions of a round run in parallel; the rounds (-Repeat) run one after the other.
foreach ($i in 1..$Repeat) {
  $jobs = foreach ($q in $names) {
    if ($Only.Count -and $Only -notcontains $q) { continue }
    foreach ($k in $Configs) {
      $c = $all[$k]
      # no double quotes in the text: PowerShell would cut the question when passing it to claude
      $prompt = ($cfg.questions.$q -replace '"', '') + $c.hint
      Start-Job -Name "$q-$k-$i" -ArgumentList $root, $out, $q, $k, $prompt, $Model, $i, $c.tools, $c.extra -ScriptBlock {
        param($root, $out, $q, $k, $prompt, $model, $i, $tools, $extra)
        Set-Location $root
        $sw = [Diagnostics.Stopwatch]::StartNew()
        $res = claude -p $prompt --output-format json --model $model --strict-mcp-config --mcp-config (Join-Path $out "$k.mcp.json") --tools $tools --allowedTools "$tools,mcp__graph" --max-turns 60 @extra 2>&1
        $sw.Stop()
        ($res | Out-String) | Set-Content (Join-Path $out "$q-$k-$i.json")
        "$q-$k-$i $([int]$sw.Elapsed.TotalSeconds)s" | Add-Content (Join-Path $out 'times.txt')
      }
    }
  }
  $jobs | Wait-Job | Out-Null
  $jobs | Receive-Job
  Write-Host "rodada $i de $Repeat terminada"
}
node (Join-Path $spike 'bench-report.mjs') $out
node (Join-Path $spike 'bench-check.mjs') $out $Set
