import { z } from 'zod'

/**
 * Questions with options that the agent asks the user (like Claude Code's AskUserQuestion). They travel inside the agent's message
 * in a ```gearmod-perguntas block with JSON, both through the MCP tool and written directly in the text (agents without MCP).
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

export const questionFence = 'gearmod-perguntas'
const fencePattern = new RegExp('```' + questionFence + '\\s*\\n([\\s\\S]*?)\\n```', 'g')

/** Agent message text with the questions block: `intro` (optional) + block. */
export function questionMessage(block: QuestionBlock, intro = ''): string {
  return `${intro.trim() ? `${intro.trim()}\n\n` : ''}\`\`\`${questionFence}\n${JSON.stringify(block, null, 2)}\n\`\`\``
}

export type MessagePart = { kind: 'text'; text: string } | { kind: 'questions'; block: QuestionBlock }

/** Splits the text into parts: normal Markdown and valid question blocks (an invalid block stays as text). Cuts an incomplete block (streaming). */
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

/** User's answer: readable text that goes back to the agent as a normal message. */
export function answersMessage(block: QuestionBlock, answers: string[][]): string {
  return block.perguntas.map((question, index) => `${question.pergunta}\n→ ${(answers[index] ?? []).join('; ') || '(sem resposta)'}`).join('\n\n')
}
