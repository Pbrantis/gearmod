import React, { useEffect, useRef, useState } from 'react'
import { defaultAgentColor, type AgentProfile, type CardUsage, type TokenCount } from '@agentboard/contracts'
import { AgentIcon } from './AgentIcon'
import { TokenIcon } from './icons'
import { useEscape } from './useEscape'
import { dateLocale, tr, useT } from './i18n'

/** 950 · 9,5k · 212k · 2,6 mi (pt-BR) ou 9.5k · 2.6M (en): milhar vira "k" e milhão vira "mi"/"M". */
export const short = (value: number): string => (value < 1000 ? String(value) : value < 999_500 ? `${(value / 1000).toFixed(value < 10_000 ? 1 : 0).replace(/[.,]0$/, '')}k` : `${(value / 1_000_000).toFixed(1).replace(/[.,]0$/, '')}${tr().chat.tokens.million}`).replace('.', (0.5).toLocaleString(dateLocale()).charAt(1))
const stepKeys = ['planning', 'execution', 'test'] as const
const spent = (count: TokenCount): number => count.input + count.output
const detail = (count: TokenCount): string => tr().chat.tokens.detail(count.input.toLocaleString(dateLocale()), count.output.toLocaleString(dateLocale()), count.cached.toLocaleString(dateLocale()), count.runs)

/**
 * Tokens do card. No quadro (`compact`): só o ícone, com o detalhe ao passar o mouse. No editor: um botão com o total em destaque e o
 * cache embaixo; clicar abre a divisão por etapa, com cada agente num chip. O cache (leitura barata) fica sempre separado do total.
 */
export function TokenUsage({ cardId, small = false, compact = false, onOpenDetails }: { cardId: string; small?: boolean; compact?: boolean; onOpenDetails?(): void }): React.JSX.Element {
  const all = useT().chat, t = all.tokens
  const steps = stepKeys.map((key) => ({ key, label: all.steps[key] }))
  const [usage, setUsage] = useState<CardUsage>(), [profiles, setProfiles] = useState<AgentProfile[]>([]), [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; up: boolean } | null>(null), button = useRef<HTMLButtonElement>(null), box = useRef<HTMLDivElement>(null)
  useEffect(() => { void window.agentboard.invoke('cards:usage', { cardId }).then(setUsage).catch(() => undefined) }, [cardId])
  useEffect(() => { if (!compact) void window.agentboard.invoke('profiles:list', undefined).then(setProfiles).catch(() => undefined) }, [compact])
  // Com `onOpenDetails` o resumo abre ao passar o mouse e o clique leva aos detalhes; sem ele, o resumo abre por clique (fecha ao clicar fora ou com Esc).
  useEffect(() => {
    if (compact || onOpenDetails || !pos) return
    const outside = (event: MouseEvent): void => { if (!box.current?.contains(event.target as Node)) setPos(null) }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [compact, pos, onOpenDetails])
  useEscape(() => setPos(null), !compact && !onOpenDetails && Boolean(pos))
  const show = (): void => { const rect = button.current?.getBoundingClientRect(); if (!rect) return
    // Sem espaço embaixo, abre para cima; o total continua colado no botão.
    const up = window.innerHeight - rect.bottom < 320 && rect.top > window.innerHeight - rect.bottom, left = Math.max(8, Math.min(rect.left, window.innerWidth - 300))
    setPos(up ? { left, bottom: window.innerHeight - rect.top + 8, up } : { left, top: rect.bottom + 8, up }) }
  const shown = steps.filter((step) => !(small && step.key === 'test')).map((step) => ({ ...step, count: usage?.[step.key] })).filter((step) => step.count && step.count.runs > 0)
  const total = shown.reduce((sum, step) => sum + spent(step.count!), 0), cached = shown.reduce((sum, step) => sum + step.count!.cached, 0)
  // No quadro: só aparece quando o card já gastou tokens.
  if (compact && !shown.length) return <></>
  const profileOf = (agent: CardUsage['agents'][number]): Pick<AgentProfile, 'provider' | 'label' | 'color'> => profiles.find((item) => item.id === agent.profileId) ?? { provider: agent.provider, label: agent.label, color: defaultAgentColor(agent.provider) }
  const popover = pos && <div className={`tokpop ${pos.up ? 'up' : ''} ${compact ? '' : 'open'}`} role={compact || onOpenDetails ? 'tooltip' : 'dialog'} aria-label={t.perStep} style={{ left: pos.left, top: pos.top, bottom: pos.bottom, maxHeight: 'calc(100vh - 24px)' }}>
    <div className="tokhead"><span>{t.used}</span><b>{shown.length ? short(total) : '—'}</b>{cached > 0 && <small>{t.plusCache(short(cached))}</small>}</div>
    {!shown.length ? <small className="hint">{usage ? t.noUseYet : t.loading}</small> : shown.map(({ key, label, count }) => { const agents = (usage?.agents ?? []).filter((agent) => agent.purpose === key), single = agents.length === 1
      // Um agente só: o número dele é o da etapa, então o chip (com o número dentro) fica alinhado à direita da própria linha da etapa.
      const chip = (agent: CardUsage['agents'][number], withNumber: boolean): React.JSX.Element => <span className="tokchip" key={agent.profileId} data-tip={detail(agent)}><AgentIcon profile={profileOf(agent)} size="sm" tip={false} /><span>{agent.label}</span>{withNumber && <b>{short(spent(agent))}</b>}</span>
      return <div className="tokstep" key={key}>
        <div className="tokrow" data-tip={detail(count!)}><span className="toklabel">{small && key === 'execution' ? t.task : label}</span>{single ? chip(agents[0]!, true) : <b>{short(spent(count!))}</b>}<small>{count!.cached ? t.plusCache(short(count!.cached)) : ''}</small></div>
        {agents.length > 1 && <div className="tokchips">{agents.map((agent) => chip(agent, true))}</div>}
      </div> })}
    {onOpenDetails && <small className="tokmore">{t.clickForDetails}</small>}
  </div>
  if (compact) return <div className="f tokuse compact" onClick={(e) => e.stopPropagation()}>
    <button type="button" className="tokicon" ref={button} aria-label={t.usedLabel(short(total))} onMouseEnter={show} onMouseLeave={() => setPos(null)} onFocus={show} onBlur={() => setPos(null)}><TokenIcon /></button>
    {popover}
  </div>
  return <div className="f tokuse" ref={box} onClick={(e) => e.stopPropagation()}>
    <button type="button" className={`tokbtn ${pos ? 'on' : ''}`} ref={button} aria-expanded={Boolean(pos)} aria-label={t.buttonLabel(shown.length ? short(total) : null, cached ? short(cached) : null)} onMouseEnter={onOpenDetails ? show : undefined} onMouseLeave={onOpenDetails ? () => setPos(null) : undefined} onClick={() => { if (onOpenDetails) { setPos(null); onOpenDetails() } else if (pos) setPos(null); else show() }}>
      <span className="tokbtn-label"><TokenIcon />{t.used}</span>
      <span className="tokbtn-value"><b>{shown.length ? short(total) : '—'}</b>{cached > 0 && <small>{t.ofCache(short(cached))}</small>}</span>
    </button>
    {popover}
  </div>
}
