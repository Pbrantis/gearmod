import React, { useCallback, useEffect, useState } from 'react'
import type { Approval } from '@agentboard/contracts'
import { plainError } from './NoticeDialog'
import { DiffEditor } from './editor/DiffEditor'
import { usePreferences } from './editor/preferences'
import { tr, useT } from './i18n'

/** Pedidos de aprovação (S02) deste card: recarrega quando o card muda ou uma ferramenta do agente é usada. */
export function useApprovals(cardId: string): { items: Approval[]; reload(): Promise<void> } {
  const [items, setItems] = useState<Approval[]>([])
  const reload = useCallback(async (): Promise<void> => { if (!cardId) return setItems([]); try { setItems(await window.agentboard.invoke('approvals:list', { cardId })) } catch { /* o chat segue sem o aviso */ } }, [cardId])
  useEffect(() => { void reload() }, [reload])
  useEffect(() => window.agentboard.onRunEvent((event) => { if (['agentboard/card-updated', 'agentboard/run-completed'].includes(event.eventType)) void reload() }), [reload])
  return { items, reload }
}

/** Título e descrição por tipo de pedido; tipos ainda não conhecidos caem no genérico (não bloqueia nenhum pedido novo). */
function describe(approval: Approval): { title: string; detail: string } {
  const payload = approval.payload, a = tr().chat.approval
  switch (approval.kind) {
    case 'workflow-choice': return { title: a.switchWorkflow(payload.workflow === 'sdd' ? (payload.method === 'native' ? a.sddNative : payload.method === 'speckit' ? a.sddSpecKit : a.sddNoMethod) : payload.workflow === 'light' ? a.workflowLight : payload.workflow === 'spec' ? a.workflowSpec : String(payload.workflow ?? '')), detail: typeof payload.reason === 'string' && payload.reason ? payload.reason : a.workflowReason }
    case 'git-commit': return { title: a.commitIn(String(payload.repo ?? a.aRepository)), detail: typeof payload.message === 'string' ? payload.message.split('\n')[0]! : '' }
    case 'agent-move': return { title: a.moveCard(String(payload.columnLabel ?? '')), detail: a.moveCardDetail }
    case 'usage-ledger-purge': return { title: a.purgeUsage, detail: a.purgeUsageDetail }
    case 'constitution-apply': return { title: a.changeConstitution, detail: a.reviewOf(String(payload.path ?? '')) }
    default: return { title: a.agentRequest(approval.kind), detail: '' }
  }
}

/** Cartão genérico de aprovação (S02): mostra o pedido pendente e deixa o usuário autorizar ou negar. Usado no chat do card. */
export function ApprovalAsk({ approval, onDecided }: { approval: Approval; onDecided(approval: Approval): void }): React.JSX.Element {
  const t = useT(), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [preferences] = usePreferences()
  const options = { wrap: preferences.wrap, tabSize: preferences.tabSize, indentWithTab: preferences.indent, whitespace: preferences.whitespace, guides: preferences.guides, scrollPastEnd: preferences.beyond }
  const { title, detail } = describe(approval)
  const decide = async (approve: boolean): Promise<void> => {
    setBusy(true); setError('')
    try { onDecided(await window.agentboard.invoke('approvals:decide', { id: approval.id, approve })) } catch (reason) { setError(plainError(reason)); onDecided(approval) } finally { setBusy(false) }
  }
  return <div className="cask">
    <div className="cgprop-h"><b>{title}</b><small>{t.chat.approval.asksApproval}</small></div>
    {detail && <p className="cgprop-msg">{detail}</p>}
    {approval.kind === 'constitution-apply' && typeof approval.payload.content === 'string' && <div className="wf-diffview" style={{ height: 260 }}><DiffEditor before={typeof approval.payload.before === 'string' ? approval.payload.before : null} after={approval.payload.content} path={String(approval.payload.path ?? '')} layout={preferences.diffLayout} editable={false} options={options} /></div>}
    {error && <p className="error">{error}</p>}
    {approval.status === 'approved' ? <button type="button" className="mini" disabled={busy} onClick={() => { setBusy(true); void window.agentboard.invoke('approvals:apply-constitution', { id: approval.id }).then(onDecided).catch((reason) => setError(plainError(reason))).finally(() => setBusy(false)) }}>{t.chat.approval.retryApply}</button> : <div className="cgrow"><button type="button" className="mini" disabled={busy} onClick={() => void decide(true)}>{t.chat.approval.approve}</button><span className="grow1" /><button type="button" className="mini secondary" disabled={busy} onClick={() => void decide(false)}>{t.chat.approval.deny}</button></div>}
  </div>
}

/** No chat do card: todos os pedidos pendentes de aprovação (qualquer tipo), um cartão cada. */
export function ApprovalAsks({ cardId }: { cardId: string }): React.JSX.Element | null {
  const { items, reload } = useApprovals(cardId)
  // git-commit só espelha o approval_record para auditoria (S06); a decisão em si continua pelo cartão de commit (CommitAsks), sem duplicar o pedido na tela.
  const pending = items.filter((item) => (item.status === 'requested' && item.kind !== 'git-commit' && !item.kind.startsWith('speckit-')) || (item.kind === 'constitution-apply' && item.status === 'approved' && !item.consumedAt))
  if (!pending.length) return null
  return <>{pending.map((item) => <ApprovalAsk key={item.id} approval={item} onDecided={() => void reload()} />)}</>
}
