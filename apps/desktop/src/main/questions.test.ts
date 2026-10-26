import { describe, expect, it } from 'vitest'
import { questionRule } from './agent-context'
import { answersMessage, questionMessage, splitQuestionBlocks, type QuestionBlock } from '@agentboard/contracts'

const block: QuestionBlock = { perguntas: [{ pergunta: 'Quem recebe o botão?', cabecalho: 'Botão', opcoes: [{ rotulo: 'Admin', descricao: 'Só administradores' }, { rotulo: 'Todos' }] }] }

describe('question blocks', () => {
  it('round-trips a block with an intro and keeps text around it', () => {
    const parts = splitQuestionBlocks(`${questionMessage(block, 'Antes de seguir:')}\n\nDepois eu continuo.`)
    expect(parts.map((part) => part.kind)).toEqual(['text', 'questions', 'text'])
    expect(parts[1]).toEqual({ kind: 'questions', block })
  })
  it('treats an invalid block as plain text and hides an unfinished one while streaming', () => {
    expect(splitQuestionBlocks('```agentboard-perguntas\n{"perguntas":[]}\n```')).toEqual([{ kind: 'text', text: '```agentboard-perguntas\n{"perguntas":[]}\n```' }])
    expect(splitQuestionBlocks('Pensando…\n```agentboard-perguntas\n{"perguntas":[{"perg')).toEqual([{ kind: 'text', text: 'Pensando…\n' }])
  })
  it('formats the answers as a readable message', () => {
    expect(answersMessage(block, [['Admin']])).toBe('Quem recebe o botão?\n→ Admin')
    expect(answersMessage(block, [[]])).toContain('(sem resposta)')
  })
  it('o exemplo ensinado aos agentes é um bloco válido', () => {
    const sample = /```agentboard-perguntas com este JSON: (\{.*\})\. De 1 a 4/.exec(questionRule)![1]!
    const parts = splitQuestionBlocks(`Antes:

\`\`\`agentboard-perguntas
${sample}
\`\`\``)
    expect(parts.map((part) => part.kind)).toEqual(['text', 'questions'])
  })
})
