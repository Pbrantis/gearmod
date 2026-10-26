import React, { useEffect, useRef, useState } from 'react'
import type { AgentPurpose, ChatMessage } from '@agentboard/contracts'
import thinkingGif from './assets/thinking.gif'

/** Mascote do AgentBoard "pensando" (GIF animado): indicador de agente trabalhando. */
export function ThinkingMascot({ size = 22 }: { size?: number }): React.JSX.Element {
  return <img className="mascot" src={thinkingGif} width={size} height={size} alt="" draggable={false} />
}

const verbs: Record<AgentPurpose | 'free', string[]> = {
  planning: ['Planejando', 'Pensando', 'Analisando', 'Estruturando'],
  execution: ['Implementando', 'Trabalhando', 'Pensando', 'Ajustando'],
  test: ['Testando', 'Conferindo', 'Analisando'],
  free: ['Pensando', 'Refletindo', 'Analisando']
}

/** O que o agente está fazendo agora, pela última ferramenta usada neste turno (depois da última mensagem minha). */
export function activityVerb(messages: ChatMessage[]): string | null {
  const lastUser = messages.map((item) => item.role).lastIndexOf('user')
  const tool = messages.slice(lastUser + 1).filter((item) => item.role === 'tool').at(-1)
  if (!tool) return null
  const name = tool.body.split('\n')[0]!.split(' ')[0]!.toLowerCase()
  if (['read', 'grep', 'glob', 'ls'].includes(name)) return 'Lendo o projeto'
  if (['bash', 'comando'].includes(name)) return 'Executando comando'
  if (['write', 'edit', 'multiedit', 'alterou', 'agentboard_escrever_documento'].includes(name)) return 'Escrevendo'
  if (['websearch', 'webfetch'].includes(name)) return 'Pesquisando'
  if (name.startsWith('agentboard_')) return 'Atualizando o card'
  return null
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000)), minutes = Math.floor(total / 60), seconds = total % 60
  return minutes ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`
}

/** Linha "átomo + verbo + tempo" enquanto o agente trabalha (como o Claude Code e o Codex). */
export function ThinkingIndicator({ purpose, messages, since }: { purpose: AgentPurpose | 'free'; messages: ChatMessage[]; since: number }): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id) }, [])
  const list = verbs[purpose], elapsed = now - since
  const verb = activityVerb(messages) ?? list[Math.floor(elapsed / 3500) % list.length]!
  return <div className="thinking" role="status" aria-live="polite" aria-label={`${verb}, ${formatElapsed(elapsed)}`}><ThinkingMascot /><span className="tverb">{verb}…</span><span className="tmeta">{formatElapsed(elapsed)}</span></div>
}

/** Início do trabalho atual (para o cronômetro): usa a hora de início da execução quando conhecida, senão o momento em que ficou ocupado. */
export function useBusySince(busy: boolean, startedAt?: string): number {
  const ref = useRef(Date.now())
  const was = useRef(false)
  if (busy && !was.current) ref.current = startedAt ? Date.parse(startedAt) || Date.now() : Date.now()
  was.current = busy
  return ref.current
}

/** Mostra o texto aos poucos (efeito de digitação): acompanha o que chega do agente, mais rápido quando há muito atrasado. */
export function useTypewriter(target: string): string {
  const [shown, setShown] = useState(''), state = useRef({ target, count: 0 })
  state.current.target = target
  if (state.current.count > target.length) state.current.count = 0
  useEffect(() => {
    const id = window.setInterval(() => {
      const current = state.current
      if (current.count >= current.target.length) return
      current.count = Math.min(current.target.length, current.count + Math.max(1, Math.ceil((current.target.length - current.count) / 10)))
      setShown(current.target.slice(0, current.count))
    }, 28)
    return () => window.clearInterval(id)
  }, [])
  return target ? shown.slice(0, target.length) : ''
}
