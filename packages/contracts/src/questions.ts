import { z } from 'zod'

/**
 * Perguntas com opções que o agente faz ao usuário (como o AskUserQuestion do Claude Code). Viajam dentro da mensagem do agente
 * num bloco ```agentboard-perguntas com JSON, tanto pela ferramenta MCP quanto escritas direto no texto (agentes sem MCP).
 */
export const questionOptionSchema = z.object({ rotulo: z.string().trim().min(1).max(120), descricao: z.string().trim().max(400).optional() })
export const userQuestionSchema = z.object({
  pergunta: z.string().trim().min(1).max(500),
  cabecalho: z.string().trim().max(24).optional(),
  multipla: z.boolean().optional(),
  opcoes: z.array(questionOptionSchema).min(2).max(6)
})
export const questionBlockSchema = z.object({ perguntas: z.array(userQuestionSchema).min(1).max(4) })
export type UserQuestion = z.output<typeof userQuestionSchema>
export type QuestionBlock = z.output<typeof questionBlockSchema>

export const questionFence = 'agentboard-perguntas'
const fencePattern = new RegExp('```' + questionFence + '\\s*\\n([\\s\\S]*?)\\n```', 'g')

/** Texto da mensagem do agente com o bloco de perguntas: `intro` (opcional) + bloco. */
export function questionMessage(block: QuestionBlock, intro = ''): string {
  return `${intro.trim() ? `${intro.trim()}\n\n` : ''}\`\`\`${questionFence}\n${JSON.stringify(block, null, 2)}\n\`\`\``
}

export type MessagePart = { kind: 'text'; text: string } | { kind: 'questions'; block: QuestionBlock }

/** Separa o texto em partes: Markdown normal e blocos de perguntas válidos (um bloco inválido continua como texto). Corta um bloco ainda incompleto (streaming). */
export function splitQuestionBlocks(body: string): MessagePart[] {
  const open = body.indexOf('```' + questionFence)
  const complete = open >= 0 && !fencePattern.test(body.slice(open)) ? body.slice(0, open) : body
  fencePattern.lastIndex = 0
  const parts: MessagePart[] = []
  let last = 0
  for (const match of complete.matchAll(fencePattern)) {
    let block: QuestionBlock | null = null
    try { const parsed = questionBlockSchema.safeParse(JSON.parse(match[1]!)); block = parsed.success ? parsed.data : null } catch { block = null }
    if (!block) continue
    if (match.index! > last) parts.push({ kind: 'text', text: complete.slice(last, match.index) })
    parts.push({ kind: 'questions', block }); last = match.index! + match[0].length
  }
  if (last < complete.length) parts.push({ kind: 'text', text: complete.slice(last) })
  return parts.filter((part) => part.kind === 'questions' || part.text.trim())
}

/** Resposta do usuário: um texto legível que volta ao agente como mensagem normal. */
export function answersMessage(block: QuestionBlock, answers: string[][]): string {
  return block.perguntas.map((question, index) => `${question.pergunta}\n→ ${(answers[index] ?? []).join('; ') || '(sem resposta)'}`).join('\n\n')
}
