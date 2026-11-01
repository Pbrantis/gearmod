type Json = Record<string, unknown>
const asObject = (value: unknown): Json => (value && typeof value === 'object' ? value as Json : {})
const short = (text: string, max: number): string => { const flat = text.replace(/\s+/g, ' ').trim(); return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat }

export interface ToolActivity { title: string; detail: string }

/** Resumo de uma ferramenta usada pelo agente (para a linha cinza do chat): título curto + detalhe que aparece ao expandir. */
function describe(name: string, input: Json): ToolActivity {
  const target = [input.file_path, input.path, input.pattern, input.command, input.url, input.query].find((value) => typeof value === 'string') as string | undefined
  const label = name.replace(/^mcp__agentboard__/, '')
  return { title: short(target ? `${label} ${target}` : label, 90), detail: short(JSON.stringify(input, null, 2), 800) }
}

/** Arquivos que o agente alterou (ferramentas de escrita do Claude): usados para perceber trabalho feito na worktree de outro card. */
export function toolEditedFiles(type: string, payload: Json): string[] {
  if (type === 'gemini/tool_use') { const input = asObject(payload.parameters), file = input.file_path ?? input.path; return ['write_file', 'replace', 'edit'].includes(String(payload.tool_name)) && typeof file === 'string' ? [file] : [] }
  if (type !== 'claude/assistant') return []
  const content = asObject(payload.message).content
  return (Array.isArray(content) ? content : []).map(asObject)
    .filter((block) => block.type === 'tool_use' && ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(String(block.name)))
    .map((block) => asObject(block.input).file_path ?? asObject(block.input).notebook_path).filter((value): value is string => typeof value === 'string')
}

/** Extrai as ferramentas usadas de um evento do Claude (`tool_use` em mensagens do assistente) ou do Codex (itens iniciados). */
export function toolActivities(type: string, payload: Json): ToolActivity[] {
  if (type === 'gemini/tool_use' && typeof payload.tool_name === 'string') return [describe(payload.tool_name, asObject(payload.parameters))]
  if (type === 'claude/assistant') {
    const content = asObject(payload.message).content
    return (Array.isArray(content) ? content : []).map(asObject).filter((block) => block.type === 'tool_use' && typeof block.name === 'string').map((block) => describe(block.name as string, asObject(block.input)))
  }
  if (type === 'item/started') {
    const item = asObject(payload.item)
    if (item.type === 'commandExecution' && typeof item.command === 'string') return [{ title: short(`Comando ${item.command}`, 90), detail: short(item.command, 800) }]
    if (item.type === 'mcpToolCall' && typeof item.tool === 'string') return [describe(item.tool, asObject(item.arguments))]
    if (item.type === 'fileChange') return [{ title: 'Alterou arquivos', detail: '' }]
  }
  return []
}
