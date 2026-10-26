// Servidor MCP (stdio) do AgentBoard. Roda como processo filho do agente e só fala com o app por um canal local
// (socket Unix ou named pipe) usando o token da execução. Não abre porta de rede nem lê o banco.
import process from 'node:process'
import { createConnection } from 'node:net'
import { createInterface } from 'node:readline'

const socketPath = process.env.AGENTBOARD_SOCKET
const token = process.env.AGENTBOARD_TOKEN

const kinds = ['resumo', 'especificacao', 'plano', 'tasks']
const nota = { type: 'integer', minimum: 0, maximum: 3 }
const evidencias = { type: 'array', maxItems: 30, items: { type: 'object', properties: { tipo: { type: 'string', enum: ['file', 'commit', 'diff', 'message', 'investigation', 'test', 'api', 'artifact'] }, referencia: { type: 'string', description: 'Caminho relativo do arquivo, hash do commit, nome do teste ou trecho da mensagem do usuário' }, linha: { type: 'integer', minimum: 1 }, detalhe: { type: 'string', description: 'O que essa evidência mostra, em uma frase' } }, required: ['tipo', 'referencia'], additionalProperties: false } }
const lista = { type: 'array', items: { type: 'string' }, maxItems: 50 }
const historyTools = [
  { name: 'agentboard_registrar_entendimento', description: 'Discovery: registra o entendimento estruturado da demanda (skill agentboard-discovery). Chame quando o objetivo estiver claro e de novo quando o usuário mudar algo relevante, não a cada mensagem.', inputSchema: { type: 'object', properties: { objetivo: { type: 'string' }, motivacao: { type: 'string' }, escopo: lista, exclusoes: lista, criterios: lista, pendencias: lista, contexto_tecnico: { type: 'string', description: 'Módulos, contratos e repositórios afetados, com caminhos' }, prontidao: { type: 'string', enum: ['pronto', 'precisa_esclarecer'] } }, required: ['objetivo', 'prontidao'], additionalProperties: false } },
  { name: 'agentboard_registrar_exploracao', description: 'Guarda o resultado da exploração do código (só leitura) com a versão atual dos repositórios. O resumo aparece no contexto dos próximos turnos; explore de novo só se o código ou a demanda mudarem.', inputSchema: { type: 'object', properties: { resumo: { type: 'string', description: 'Resumo compacto: o que existe, o que é afetado e implementações parecidas' }, modulos: lista, repositorios: lista, evidencias }, required: ['resumo'], additionalProperties: false } },
  { name: 'agentboard_avaliar_complexidade', description: 'Complexity Engine: registra uma avaliação (nova versão; nunca sobrescreve). Notas de 0 a 3 por dimensão; o app aplica os pesos do projeto, calcula a pontuação e recomenda o fluxo. Reavalie só por um gatilho real (requisito mudou, dependência nova, risco, mudança arquitetural, escopo errado, falhas recorrentes). Justificativas objetivas e verificáveis, sem raciocínio interno.', inputSchema: { type: 'object', properties: { notas: { type: 'object', properties: { escopo: nota, acoplamento: nota, incerteza: nota, risco: nota, novidade: nota, validacao: nota }, required: ['escopo', 'acoplamento', 'incerteza', 'risco', 'novidade', 'validacao'], additionalProperties: false }, justificativas: { type: 'object', description: 'Uma frase por dimensão (mesmas chaves de notas)', additionalProperties: { type: 'string' } }, confianca: { type: 'string', enum: ['baixa', 'media', 'alta'] }, preliminar: { type: 'boolean', description: 'true quando ainda faltam evidências (antes de explorar o código)' }, riscos_criticos: lista, evidencias, gatilho: { type: 'string', enum: ['initial', 'requirements-changed', 'new-dependency', 'risk', 'architecture', 'scope', 'failures'] }, motivo: { type: 'string', description: 'Por que avaliar agora' } }, required: ['notas', 'confianca', 'motivo'], additionalProperties: false } },
  { name: 'agentboard_escolher_fluxo', description: 'Registra o fluxo do card DEPOIS que o usuário confirmou: light (implementar e validar, vira tarefa pequena), spec (Especificação, Plano e Tasks) ou sdd (método configurado do projeto). Fica registrado mesmo quando difere do recomendado.', inputSchema: { type: 'object', properties: { fluxo: { type: 'string', enum: ['light', 'spec', 'sdd'] }, confirmado_pelo_usuario: { type: 'boolean' }, motivo: { type: 'string' } }, required: ['fluxo', 'confirmado_pelo_usuario'], additionalProperties: false } },
  { name: 'agentboard_definir_repositorios', description: 'Define em quais repositórios do projeto o card trabalha (pelo nome, como aparece em "repositorios" no contexto). A worktree do card só é criada nesses repositórios; durante a execução, um repositório novo ganha a sua pasta na hora. Lista vazia = todos.', inputSchema: { type: 'object', properties: { repositorios: { type: 'array', items: { type: 'string' }, maxItems: 50 }, motivo: { type: 'string' } }, required: ['repositorios'], additionalProperties: false } },
  { name: 'agentboard_registrar_decisao', description: 'Registra uma decisão do card. origem "usuario" = o usuário decidiu no chat; "agente" = recomendação sua, que o usuário aprova no card. Para trocar uma decisão, informe substitui com o número dela (a antiga fica no histórico).', inputSchema: { type: 'object', properties: { decisao: { type: 'string' }, tipo: { type: 'string', enum: ['requirement', 'scope', 'assumption', 'technical', 'workflow', 'other'] }, origem: { type: 'string', enum: ['usuario', 'agente'] }, motivo: { type: 'string' }, substitui: { type: 'integer', minimum: 1 } }, required: ['decisao', 'origem'], additionalProperties: false } },
]
const tools = [
  { name: 'agentboard_contexto_do_card', description: 'Devolve o card atual do AgentBoard: id, título, tipo, prioridade, coluna atual, colunas disponíveis e os 4 documentos.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'agentboard_escrever_documento', description: 'Grava um documento do card (Markdown completo, nunca só um trecho). O Tasks precisa ter tasks de primeiro nível no formato "- [ ] T001 ..."; se o formato estiver errado a ferramenta devolve o erro para você corrigir.', inputSchema: { type: 'object', properties: { tipo: { type: 'string', enum: kinds }, markdown: { type: 'string' } }, required: ['tipo', 'markdown'], additionalProperties: false } },
  { name: 'agentboard_criar_card', description: 'Só no chat livre, quando o usuário pedir para planejar algo: cria o card no Backlog e transforma este chat no chat de planejamento dele. Depois siga a skill de planejamento.', inputSchema: { type: 'object', properties: { titulo: { type: 'string', maxLength: 240 }, tipo: { type: 'string', enum: ['feature', 'bug', 'improvement', 'task', 'minor'] }, prioridade: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] }, resumo: { type: 'string' } }, required: ['titulo'], additionalProperties: false } },
  { name: 'agentboard_concluir_planejamento', description: 'Para o planejador: avisa o sistema que o planejamento terminou. Só chame depois de gravar Especificação, Plano e Tasks; sem esta chamada o card NÃO aparece como "Plano pronto".', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'agentboard_marcar_task', description: 'Marca ou desmarca um item de checklist do documento Tasks pela linha (começando em 1).', inputSchema: { type: 'object', properties: { linha: { type: 'integer', minimum: 1 }, feito: { type: 'boolean' } }, required: ['linha', 'feito'], additionalProperties: false } },
  { name: 'agentboard_atualizar_card', description: 'Atualiza o título, o tipo, a prioridade ou a descrição do card (informe só o que mudou). Use no planejamento para dar título a um card novo. Tipo "minor" = tarefa pequena (uma alteração localizada): um agente só implementa e valida, sem Especificação, Plano nem Tasks; nesse caso informe também a descricao do que fazer.', inputSchema: { type: 'object', properties: { titulo: { type: 'string', maxLength: 240 }, tipo: { type: 'string', enum: ['feature', 'bug', 'improvement', 'task', 'minor'] }, prioridade: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] }, descricao: { type: 'string', maxLength: 20000 } }, additionalProperties: false } },
  { name: 'agentboard_propor_mudanca', description: 'Para desenvolvedor e testador: propõe algo que NÃO está nos documentos (mudança de escopo, requisito novo, refatoração extra). Nada é implementado até o usuário autorizar; depois o planejador atualiza os documentos e você é retomado.', inputSchema: { type: 'object', properties: { titulo: { type: 'string' }, o_que_muda: { type: 'string', description: 'O que seria alterado, em detalhe' }, motivo: { type: 'string' } }, required: ['titulo', 'o_que_muda', 'motivo'], additionalProperties: false } },
  { name: 'agentboard_perguntar_ao_planejador', description: 'Para desenvolvedor e testador: registra uma dúvida que você não consegue resolver pelos documentos. Continue só com o que não depende dela e termine a execução; o app leva a dúvida ao planejador (e ao usuário, se preciso) e te retoma com a resposta.', inputSchema: { type: 'object', properties: { pergunta: { type: 'string' } }, required: ['pergunta'], additionalProperties: false } },
  { name: 'agentboard_responder_duvida', description: 'Para o planejador: responde uma dúvida do desenvolvedor ou do testador pelo número (ex.: 1 para D001). Se a resposta mudar a Especificação, o Plano ou as Tasks, atualize os documentos antes.', inputSchema: { type: 'object', properties: { numero: { type: 'integer', minimum: 1 }, resposta: { type: 'string' } }, required: ['numero', 'resposta'], additionalProperties: false } },
  { name: 'agentboard_pedir_ao_usuario', description: 'Para o planejador: só o usuário pode decidir esta dúvida. Envia a pergunta ao usuário; o app retoma quem perguntou quando ele responder.', inputSchema: { type: 'object', properties: { numero: { type: 'integer', minimum: 1 }, pergunta: { type: 'string' } }, required: ['numero', 'pergunta'], additionalProperties: false } },
  { name: 'agentboard_ler_constituicao', description: 'Devolve o texto completo da Constituição do projeto (princípios que valem para todo card). Leia antes de planejar ou de decidir se algo fere um princípio.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'agentboard_escrever_constituicao', description: 'Só no chat da Constituição: grava o texto completo da Constituição do projeto (Markdown inteiro, nunca só um trecho). Grave só depois que o usuário concordar com a mudança.', inputSchema: { type: 'object', properties: { markdown: { type: 'string' } }, required: ['markdown'], additionalProperties: false } },
  { name: 'agentboard_propor_constituicao', description: 'Fora do chat da Constituição: registra uma mudança sugerida (princípio novo, alteração ou remoção) depois que o usuário concordar. Não altera a Constituição; o usuário aplica pela aba Constituição do projeto.', inputSchema: { type: 'object', properties: { titulo: { type: 'string' }, o_que_muda: { type: 'string', description: 'O princípio novo ou o que muda no existente, em detalhe' }, motivo: { type: 'string' } }, required: ['titulo', 'o_que_muda', 'motivo'], additionalProperties: false } },
  { name: 'agentboard_checklist_teste', description: 'Para o testador: grava o checklist do que você vai verificar (Markdown completo, itens "- [ ] ..."), e grava de novo com "- [x]" a cada item verificado. O usuário acompanha ao lado do chat.', inputSchema: { type: 'object', properties: { markdown: { type: 'string' } }, required: ['markdown'], additionalProperties: false } },
  { name: 'agentboard_mover_card', description: 'Move o card de coluna. Use SOMENTE quando o usuário pedir. "agora" move já; "ao_terminar" move quando esta execução terminar. Mover para Done exige teste aprovado e revisão.', inputSchema: { type: 'object', properties: { coluna: { type: 'string', description: 'Nome ou estado da coluna (backlog, todo, doing, test, done)' }, quando: { type: 'string', enum: ['agora', 'ao_terminar'] } }, required: ['coluna', 'quando'], additionalProperties: false } },
  { name: 'agentboard_pedir_commit', description: 'Só na implementação: pede (ou faz, se a regra do projeto for automática) um commit das alterações da worktree do card. A regra vale pela branch do card e está no contexto ("commit"). Com "pedir permissão", o usuário autoriza no card; com "nunca", a ferramenta devolve erro e você deixa as alterações na worktree. Nunca rode git commit direto. Mensagem: primeira linha curta no imperativo, em português.', inputSchema: { type: 'object', properties: { mensagem: { type: 'string', description: 'Mensagem do commit (primeira linha = resumo; o resto vira descrição)' }, arquivos: { type: 'array', items: { type: 'string' }, description: 'Caminhos (relativos à worktree) a incluir. Sem isso, todas as alterações.' }, repositorio: { type: 'string', description: 'Nome do repositório, quando o card mexeu em mais de um e o commit é só de um.' } }, required: ['mensagem'], additionalProperties: false } },
  ...historyTools,
]

function callApp(tool, args) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath)
    let buffer = ''
    socket.on('connect', () => socket.write(`${JSON.stringify({ token, tool, args })}\n`))
    socket.on('data', (chunk) => {
      buffer += chunk.toString()
      const end = buffer.indexOf('\n')
      if (end < 0) return
      socket.end()
      try { resolve(JSON.parse(buffer.slice(0, end))) } catch (error) { reject(error) }
    })
    socket.on('error', reject)
  })
}

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)

// Dica para o agente: o que só lê e o que grava. Nada aqui apaga nem sai da máquina.
const readOnly = new Set(['agentboard_contexto_do_card', 'agentboard_ler_constituicao'])
for (const tool of tools) tool.annotations = { readOnlyHint: readOnly.has(tool.name), destructiveHint: false, openWorldHint: false }

async function handle(message) {
  const { id, method, params } = message
  if (id === undefined) return
  if (method === 'initialize') return send({ id, result: { protocolVersion: params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'agentboard', version: '1.0.0' } } })
  if (method === 'ping') return send({ id, result: {} })
  if (method === 'tools/list') return send({ id, result: { tools } })
  if (method === 'tools/call') {
    if (!tools.some((tool) => tool.name === params?.name)) return send({ id, error: { code: -32602, message: `Ferramenta desconhecida: ${params?.name}` } })
    try {
      const answer = await callApp(params.name, params.arguments ?? {})
      return send({ id, result: { content: [{ type: 'text', text: answer.ok ? answer.text : answer.error }], isError: !answer.ok } })
    } catch (error) {
      return send({ id, result: { content: [{ type: 'text', text: `Não foi possível falar com o AgentBoard: ${error instanceof Error ? error.message : String(error)}` }], isError: true } })
    }
  }
  return send({ id, error: { code: -32601, message: `Método não suportado: ${method}` } })
}

if (!socketPath || !token) { process.stderr.write('AGENTBOARD_SOCKET e AGENTBOARD_TOKEN são obrigatórios\n'); process.exit(1) }
createInterface({ input: process.stdin }).on('line', (line) => { try { void handle(JSON.parse(line)) } catch { /* linha inválida */ } })
