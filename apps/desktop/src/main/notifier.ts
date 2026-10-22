import type { ChatPurpose } from '@agentboard/contracts'

export type FinishStatus = 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled'
export interface NoticeInput {
  status: FinishStatus
  purpose: ChatPurpose
  /** Título do card (ou do chat livre). */
  title: string
  hasPlan: boolean
  pending: { changes: number; questions: number }
  error?: string | null
}
export interface Notice { title: string; body: string }

const clip = (text: string, max = 140): string => { const flat = text.replace(/\s+/g, ' ').trim(); return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat }

/** O que avisar quando um agente termina (null = não vale notificação): conclusão, plano pronto, falha ou algo que precisa do usuário. */
export function finishNotice(input: NoticeInput): Notice | null {
  if (input.status !== 'completed' && input.status !== 'failed') return null
  const name = input.title.trim() || 'Novo card'
  if (input.pending.changes > 0) return { title: 'Mudança aguardando sua autorização', body: name }
  if (input.pending.questions > 0) return { title: 'Pergunta para você', body: name }
  if (input.status === 'failed') {
    const what = input.purpose === 'planning' ? 'O planejamento falhou' : input.purpose === 'test' ? 'O teste falhou' : input.purpose === 'free' ? 'O chat falhou' : 'A execução falhou'
    return { title: what, body: input.error ? `${name} — ${clip(input.error, 100)}` : name }
  }
  if (input.purpose === 'execution') return { title: 'Execução concluída', body: name }
  if (input.purpose === 'test') return { title: 'Teste concluído', body: name }
  if (input.purpose === 'planning') return input.hasPlan ? { title: 'Plano pronto', body: name } : null
  return { title: 'O agente respondeu', body: name }
}

export interface OpenTarget { projectId: string; cardId: string | null; chatId: string | null; purpose: ChatPurpose | null }

/** Envia a notificação do sistema (só com o app fora de foco e se estiver ligada); o clique abre o chat do card ou o chat livre. */
export class Notifier {
  constructor(private readonly deps: { enabled(): boolean; focused(): boolean; show(notice: Notice, onClick: () => void): void; open(target: OpenTarget): void }) {}

  notify(notice: Notice, target: OpenTarget): boolean {
    if (!this.deps.enabled() || this.deps.focused()) return false
    this.deps.show(notice, () => this.deps.open(target))
    return true
  }
}
