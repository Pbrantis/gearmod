import { describe, expect, it } from 'vitest'
import { finishNotice, Notifier, type OpenTarget } from './notifier'

const base = { status: 'completed' as const, purpose: 'execution' as const, title: 'Botão de reset', hasPlan: false, pending: { changes: 0, questions: 0 } }

describe('finishNotice', () => {
  it('announces conclusion, ready plan and failures, and stays quiet on user stops and plain planning replies', () => {
    expect(finishNotice(base)).toEqual({ title: 'Execução concluída', body: 'Botão de reset' })
    expect(finishNotice({ ...base, purpose: 'test' })?.title).toBe('Teste concluído')
    expect(finishNotice({ ...base, purpose: 'planning', hasPlan: true })?.title).toBe('Plano pronto')
    expect(finishNotice({ ...base, purpose: 'planning' })).toBeNull()
    expect(finishNotice({ ...base, status: 'failed', error: 'sem rede' })).toEqual({ title: 'A execução falhou', body: 'Botão de reset — sem rede' })
    expect(finishNotice({ ...base, status: 'interrupted' })).toBeNull()
    expect(finishNotice({ ...base, purpose: 'free', title: 'Como separo dados?' })?.title).toBe('O agente respondeu')
  })
  it('puts what needs the user before the conclusion', () => {
    expect(finishNotice({ ...base, pending: { changes: 1, questions: 0 } })?.title).toBe('Mudança aguardando sua autorização')
    expect(finishNotice({ ...base, pending: { changes: 0, questions: 2 } })?.title).toBe('Pergunta para você')
  })
})

describe('Notifier', () => {
  it('only shows when enabled and the app is not focused, and the click opens the target', () => {
    const shown: string[] = [], opened: OpenTarget[] = []
    let enabled = true, focused = false, click: () => void = () => undefined
    const notifier = new Notifier({ enabled: () => enabled, focused: () => focused, show: (notice, onClick) => { shown.push(notice.title); click = onClick }, open: (target) => opened.push(target) })
    const target: OpenTarget = { projectId: 'p', cardId: 'c', chatId: 'x', purpose: 'execution' }
    expect(notifier.notify({ title: 'a', body: 'b' }, target)).toBe(true); click(); expect(opened).toEqual([target])
    focused = true; expect(notifier.notify({ title: 'c', body: 'd' }, target)).toBe(false)
    focused = false; enabled = false; expect(notifier.notify({ title: 'e', body: 'f' }, target)).toBe(false)
    expect(shown).toEqual(['a'])
  })
})
