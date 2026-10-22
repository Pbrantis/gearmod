// Servidor MCP (stdio) do AgentBoard. Roda como processo filho do agente e só fala com o app por um canal local
// (socket Unix ou named pipe) usando o token da execução. Não abre porta de rede nem lê o banco.
import process from 'node:process'
import { createConnection } from 'node:net'
import { createInterface } from 'node:readline'

const socketPath = process.env.AGENTBOARD_SOCKET
const token = process.env.AGENTBOARD_TOKEN

const kinds = ['resumo', 'especificacao', 'plano', 'tasks']
const tools = [
  { name: 'agentboard_contexto_do_card', description: 'Devolve o card atual do AgentBoard: id, título, tipo, prioridade, coluna atual, colunas disponíveis e os 4 documentos.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'agentboard_escrever_documento', description: 'Grava um documento do card (Markdown completo, nunca só um trecho). O Tasks precisa ter tasks de primeiro nível no formato "- [ ] T001 ..."; se o formato estiver errado a ferramenta devolve o erro para você corrigir.', inputSchema: { type: 'object', properties: { tipo: { type: 'string', enum: kinds }, markdown: { type: 'string' } }, required: ['tipo', 'markdown'], additionalProperties: false } },
  { name: 'agentboard_concluir_planejamento', description: 'Para o planejador: avisa o sistema que o planejamento terminou. Só chame depois de gravar Especificação, Plano e Tasks; sem esta chamada o card NÃO aparece como "Plano pronto".', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'agentboard_marcar_task', description: 'Marca ou desmarca um item de checklist do documento Tasks pela linha (começando em 1).', inputSchema: { type: 'object', properties: { linha: { type: 'integer', minimum: 1 }, feito: { type: 'boolean' } }, required: ['linha', 'feito'], additionalProperties: false } },
  { name: 'agentboard_atualizar_card', description: 'Atualiza o título, o tipo ou a prioridade do card (informe só o que mudou). Use no planejamento para dar título a um card novo.', inputSchema: { type: 'object', properties: { titulo: { type: 'string', maxLength: 240 }, tipo: { type: 'string', enum: ['feature', 'bug', 'improvement', 'task'] }, prioridade: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] } }, additionalProperties: false } },
  { name: 'agentboard_propor_mudanca', description: 'Para desenvolvedor e testador: propõe algo que NÃO está nos documentos (mudança de escopo, requisito novo, refatoração extra). Nada é implementado até o usuário autorizar; depois o planejador atualiza os documentos e você é retomado.', inputSchema: { type: 'object', properties: { titulo: { type: 'string' }, o_que_muda: { type: 'string', description: 'O que seria alterado, em detalhe' }, motivo: { type: 'string' } }, required: ['titulo', 'o_que_muda', 'motivo'], additionalProperties: false } },
  { name: 'agentboard_perguntar_ao_planejador', description: 'Para desenvolvedor e testador: registra uma dúvida que você não consegue resolver pelos documentos. Continue só com o que não depende dela e termine a execução; o app leva a dúvida ao planejador (e ao usuário, se preciso) e te retoma com a resposta.', inputSchema: { type: 'object', properties: { pergunta: { type: 'string' } }, required: ['pergunta'], additionalProperties: false } },
  { name: 'agentboard_responder_duvida', description: 'Para o planejador: responde uma dúvida do desenvolvedor ou do testador pelo número (ex.: 1 para D001). Se a resposta mudar a Especificação, o Plano ou as Tasks, atualize os documentos antes.', inputSchema: { type: 'object', properties: { numero: { type: 'integer', minimum: 1 }, resposta: { type: 'string' } }, required: ['numero', 'resposta'], additionalProperties: false } },
  { name: 'agentboard_pedir_ao_usuario', description: 'Para o planejador: só o usuário pode decidir esta dúvida. Envia a pergunta ao usuário; o app retoma quem perguntou quando ele responder.', inputSchema: { type: 'object', properties: { numero: { type: 'integer', minimum: 1 }, pergunta: { type: 'string' } }, required: ['numero', 'pergunta'], additionalProperties: false } },
  { name: 'agentboard_mover_card', description: 'Move o card de coluna. Use SOMENTE quando o usuário pedir. "agora" move já; "ao_terminar" move quando esta execução terminar. Mover para Done exige teste aprovado e revisão.', inputSchema: { type: 'object', properties: { coluna: { type: 'string', description: 'Nome ou estado da coluna (backlog, todo, doing, test, done)' }, quando: { type: 'string', enum: ['agora', 'ao_terminar'] } }, required: ['coluna', 'quando'], additionalProperties: false } }
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
