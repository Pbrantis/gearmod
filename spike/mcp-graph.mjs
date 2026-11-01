// Servidor MCP (stdio) do índice de código. Indexa a pasta ao subir (reaproveitando o banco), observa mudanças
// e responde às ferramentas. Variáveis: GRAPH_ROOT, GRAPH_DB, GRAPH_EXCLUDE (vírgulas), GRAPH_TOOLS=core|all.
import { createInterface } from 'node:readline'
import { CodeIndex } from './graph/index.mjs'

const root = process.env.GRAPH_ROOT ?? process.cwd()
const exclude = (process.env.GRAPH_EXCLUDE ?? '').split(',').filter(Boolean)
const ci = new CodeIndex(process.env.GRAPH_DB ?? new URL('./graph.sqlite', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'))
const ready = ci.index(root, { exclude }).then(() => ci.watch(root, { exclude }))

const s = (description, properties = {}, required = []) => ({ description, inputSchema: { type: 'object', properties, required } })
const str = (description) => ({ type: 'string', description })
const num = (description) => ({ type: 'number', description })
const bool = (description) => ({ type: 'boolean', description })

// GRAPH_DETAIL=completo (padrão) | resumo: o que codigo_explorar devolve quando o agente não diz.
// O resumo saiu mais caro na medição (o agente lia os arquivos depois), então o padrão é o completo.
const DETAIL = process.env.GRAPH_DETAIL === 'resumo' ? 'resumo' : 'completo'
const EXPLORE_DESC = DETAIL === 'resumo'
  ? 'Ferramenta principal: use PRIMEIRO para entender uma área, um fluxo ou um bug, e antes de editar. Devolve numa chamada o caminho de chamadas, quem depende de cada símbolo e os testes, onde está cada símbolo (arquivo e linhas exatas, com assinatura) e o código dos trechos principais. Para o resto, leia só as linhas indicadas (Read com offset/limit) ou peça detalhe="completo". Aceita pergunta em linguagem natural ou nomes de símbolos/arquivos (ex.: "recordExploration codeVersions history.ts").'
  : 'Ferramenta principal: use PRIMEIRO para entender uma área, um fluxo ou um bug, e antes de editar. Devolve numa chamada o código atual dos símbolos relevantes agrupado por arquivo (equivale a já ter lido esses trechos), o caminho de chamadas entre eles, quem depende deles e os testes. Aceita pergunta em linguagem natural ou nomes de símbolos/arquivos (ex.: "recordExploration codeVersions history.ts").'

const CORE = {
  codigo_explorar: s(EXPLORE_DESC,
    { pergunta: str('Pergunta ou nomes de símbolos/arquivos'), detalhe: str(`resumo (padrão${DETAIL === 'resumo' ? '' : ' aqui: completo'}) ou completo (código de todos os símbolos)`), maxArquivos: num('Máximo de arquivos com código no modo completo (padrão 12)') }, ['pergunta']),
  codigo_no: s('Um símbolo pelo nome: local, assinatura, código (codigo=true), quem usa, o que usa e testes. Ou, só com `arquivo`, lê o arquivo como o Read (linhas numeradas, offset/limite) e diz quem depende dele; `soSimbolos` dá só o esqueleto do arquivo.',
    { simbolo: str('Nome (ou Classe.metodo)'), arquivo: str('Caminho ou nome do arquivo'), codigo: bool('Incluir o corpo do símbolo'), linha: num('Desempata pela linha'), offset: num('Modo arquivo: linha inicial'), limite: num('Modo arquivo: máximo de linhas'), soSimbolos: bool('Modo arquivo: só a lista de símbolos') }),
  codigo_buscar: s('Busca rápida de símbolos por nome ou palavra (também em português). Só locais, sem código.',
    { consulta: str('Nome ou palavras'), tipo: str('function, method, class, interface, type, const…'), limite: num('Padrão 10') }, ['consulta']),
  codigo_impacto: s('O que é afetado se um símbolo mudar (chamadores diretos e indiretos, por arquivo) e quais testes rodar. Use antes de refatorar.',
    { simbolo: str('Nome do símbolo'), arquivo: str('Desempata quando há vários com o mesmo nome'), profundidade: num('Níveis (padrão 2)') }, ['simbolo'])
}
const EXTRA = {
  codigo_chamadores: s('Quem chama/usa um símbolo, até N níveis.', { simbolo: str('Nome'), arquivo: str('Desempate'), profundidade: num('Padrão 1') }, ['simbolo']),
  codigo_chamados: s('O que um símbolo chama, até N níveis.', { simbolo: str('Nome'), arquivo: str('Desempate'), profundidade: num('Padrão 1') }, ['simbolo']),
  codigo_arquivos: s('Árvore de arquivos indexados com linguagem e quantidade de símbolos. Mais rápido que Glob para ver a estrutura.', { pasta: str('Prefixo'), padrao: str('Glob, ex.: *.tsx'), formato: str('tree, flat ou grouped'), profundidade: num('Níveis de pasta') }),
  codigo_testes_afetados: s('Testes que dependem dos arquivos alterados (padrão: o que mudou no Git).', { arquivos: { type: 'array', items: { type: 'string' } } }),
  codigo_mapa: s('Visão geral do projeto: arquivos mais centrais com suas classes e funções, dentro de um orçamento de tokens.', { tokens: num('Padrão 1500'), pasta: str('Prefixo'), foco: { type: 'array', items: { type: 'string' }, description: 'Arquivos que puxam o ranking' } }),
  codigo_status: s('Saúde do índice: arquivos, símbolos, arestas, última indexação.')
}
const TOOLS = process.env.GRAPH_TOOLS === 'all' ? { ...CORE, ...EXTRA } : CORE

async function call(name, a) {
  await ready
  const q = ci.q(root)
  switch (name) {
    case 'codigo_explorar': return q.explore(a.pergunta ?? '', { maxFiles: a.maxArquivos ?? 12, detail: a.detalhe === 'completo' || a.detalhe === 'resumo' ? a.detalhe : DETAIL })
    case 'codigo_no': return q.node({ symbol: a.simbolo, file: a.arquivo, includeCode: !!a.codigo, line: a.linha, offset: a.offset, limit: a.limite, symbolsOnly: !!a.soSimbolos })
    case 'codigo_buscar': return q.search(a.consulta ?? '', { kind: a.tipo, limit: a.limite ?? 10 })
    case 'codigo_impacto': return q.impact(a.simbolo, { file: a.arquivo, depth: a.profundidade ?? 2 })
    case 'codigo_chamadores': return q.callers(a.simbolo, { file: a.arquivo, depth: a.profundidade ?? 1 })
    case 'codigo_chamados': return q.callees(a.simbolo, { file: a.arquivo, depth: a.profundidade ?? 1 })
    case 'codigo_arquivos': return q.filesTree({ path: a.pasta ?? '', pattern: a.padrao, format: a.formato ?? 'tree', depth: a.profundidade })
    case 'codigo_testes_afetados': return q.affected({ files: a.arquivos })
    case 'codigo_mapa': return q.map({ tokens: a.tokens ?? 1500, path: a.pasta ?? '', focus: a.foco ?? [] })
    case 'codigo_status': return q.status()
  }
  throw new Error(`Ferramenta desconhecida: ${name}`)
}

const send = (m) => process.stdout.write(JSON.stringify(m) + '\n')
createInterface({ input: process.stdin }).on('line', async (line) => {
  let m
  try { m = JSON.parse(line) } catch { return }
  if (m.id === undefined) return
  if (m.method === 'initialize') return send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'agentboard-graph', version: '0.2.0' } } })
  if (m.method === 'ping') return send({ jsonrpc: '2.0', id: m.id, result: {} })
  if (m.method === 'tools/list') return send({ jsonrpc: '2.0', id: m.id, result: { tools: Object.entries(TOOLS).map(([name, t]) => ({ name, ...t, annotations: { readOnlyHint: true } })) } })
  if (m.method === 'tools/call') {
    try { send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: String(await call(m.params.name, m.params.arguments ?? {})) }] } }) }
    catch (e) { send({ jsonrpc: '2.0', id: m.id, result: { isError: true, content: [{ type: 'text', text: String(e?.message ?? e) }] } }) }
    return
  }
  send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Método não suportado' } })
})
process.on('SIGTERM', () => { ci.close(); process.exit(0) })
