import React, { useEffect, useState } from 'react'
import type { GitPolicy, GitRepo, GitRule } from '@agentboard/contracts'
import { gitIcons } from './GitPage'
import { Select } from './Select'
import { plainError } from './NoticeDialog'
import { ruleLabel } from './gitView'
import { ConfirmDialog } from './ConfirmDialog'
import { TrashIcon } from './icons'
import { GitEmpty, gitChangedEvent } from './GitSetup'
import { toast } from './toasts'
import { cachedGit, refreshGit, rememberGit } from './gitConfigCache'

const defaultNotes: Record<GitRule, [string, string]> = {
  ask: ['Pedir minha permissão', 'O agente prepara o commit (mensagem e arquivos) e espera você autorizar no card. Recomendado.'],
  auto: ['Automático', 'O agente commita sozinho ao fechar cada task do card, com a mensagem da task.'],
  never: ['Nunca', 'O agente só deixa as alterações na worktree; quem commita é você.']
}

/** Seção recolhível; fechada, mostra um resumo ao lado do título. */
function Fold({ title, summary, closed = false, children }: { title: string; summary: string; closed?: boolean; children: React.ReactNode }): React.JSX.Element {
  const [shut, setShut] = useState(closed)
  return <div className="f"><span className="foldh" role="button" tabIndex={0} aria-expanded={!shut} onClick={() => setShut(!shut)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShut(!shut) } }}><i>{shut ? '▸' : '▾'}</i>{title}{shut && <small>{summary}</small>}</span>{!shut && children}</div>
}

/** Aba Git de Configurar projeto: quem commita (padrão do projeto), exceções por branch e os repositórios. Salva ao mudar. */
export function GitPolicyPanel({ projectId }: { projectId: string }): React.JSX.Element {
  const warm = cachedGit(projectId)
  const [policy, setPolicy] = useState<GitPolicy | undefined>(warm.policy), [repos, setRepos] = useState<GitRepo[]>(warm.repos ?? []), [reposLoaded, setReposLoaded] = useState(Boolean(warm.repos)), [error, setError] = useState(''), [askRemove, setAskRemove] = useState<number | null>(null)
  useEffect(() => {
    // Já tem o que foi carregado ao abrir o projeto: mostra na hora e confere de novo em segundo plano.
    const now = cachedGit(projectId)
    setPolicy(now.policy); setRepos(now.repos ?? []); setReposLoaded(Boolean(now.repos))
    let alive = true
    void refreshGit(projectId).then((changed) => {
      if (changed) window.dispatchEvent(new Event(gitChangedEvent))
      if (!alive) return
      const fresh = cachedGit(projectId)
      // A regra que o usuário está editando não é trocada por baixo dele.
      setPolicy((current) => current ?? fresh.policy); setRepos(fresh.repos ?? []); setReposLoaded(true)
    }).catch((reason: unknown) => { if (alive) { setError(plainError(reason)); setReposLoaded(true) } })
    return () => { alive = false }
  }, [projectId])
  if (!policy || !reposLoaded) return <div className="stack">{error ? <p className="error">{error}</p> : <small className="hint">Carregando…</small>}</div>
  if (!repos.length) return <GitEmpty projectId={projectId} done={(items) => { rememberGit(projectId, { repos: items }); setRepos(items) }} />
  const save = async (next: GitPolicy): Promise<void> => {
    try { setError(''); setPolicy(next); rememberGit(projectId, { policy: next }); const stored = await window.agentboard.invoke('git:policy-set', { projectId, policy: next }); rememberGit(projectId, { policy: stored }); setPolicy((current) => current && current.rules.length === stored.rules.length ? current : stored); toast.success('Regra de commit salva') } catch (reason) { setError(plainError(reason)) }
  }
  const rules = policy.rules
  const setRule = (index: number, patch: Partial<GitPolicy['rules'][number]>, persist = true): void => {
    const next = { ...policy, rules: rules.map((item, i) => i === index ? { ...item, ...patch } : item) }
    if (persist) void save(next); else setPolicy(next)
  }
  return <div className="stack gpolcfg">
    <Fold title="Commit feito pelo agente" summary={ruleLabel[policy.def]}><div className="stack" style={{ gap: 6 }}><Select label="Commit feito pelo agente" value={policy.def} options={(['ask', 'auto', 'never'] as const).map((value) => ({ value, label: defaultNotes[value][0], sub: defaultNotes[value][1] }))} onChange={(value) => void save({ ...policy, def: value as GitRule })} /><small className="hint">{defaultNotes[policy.def][1]}</small></div></Fold>
    <Fold title="Exceções por branch" summary={`${rules.length} exceç${rules.length === 1 ? 'ão' : 'ões'}`}><small className="hint">Valem por cima do padrão. A primeira que bater com a branch do card vence; use * para qualquer trecho (ex.: release/*).</small>
      <div className="stack" style={{ gap: 6 }}>{rules.map((item, index) => <div className="grule" key={index}><input className="in" value={item.pattern} spellCheck={false} placeholder="nome da branch" aria-label="Branch da exceção" onChange={(e) => setRule(index, { pattern: e.target.value }, false)} onBlur={() => void save(policy)} onKeyDown={(e) => { if (e.key === 'Enter') void save(policy) }} />
        <div className="gseg">{(['auto', 'ask', 'never'] as const).map((value) => <button type="button" key={value} className={item.rule === value ? 'on' : ''} onClick={() => setRule(index, { rule: value })}>{ruleLabel[value]}</button>)}</div>
        <button type="button" className="trashbtn tip" data-tip="Remover exceção" aria-label="Remover exceção" onClick={() => setAskRemove(index)}><TrashIcon /></button></div>)}</div>
      <button type="button" className="mini secondary" style={{ justifySelf: 'start' }} onClick={() => setPolicy({ ...policy, rules: [...rules, { pattern: '', rule: 'auto' }] })}>＋ Adicionar exceção</button></Fold>
    {askRemove !== null && rules[askRemove] && <ConfirmDialog eyebrow="Exceção por branch" title={`Remover a exceção de ${rules[askRemove]!.pattern || 'branch sem nome'}?`} text="Essa branch volta a seguir o padrão do projeto para o commit feito pelo agente." ok="Remover" danger cancel={() => setAskRemove(null)} confirm={() => { const index = askRemove; setAskRemove(null); void save({ ...policy, rules: rules.filter((_, i) => i !== index) }) }} />}
    {error && <p className="error">{error}</p>}
    <Fold title="Repositórios do projeto" closed summary={`${repos.length} repositório${repos.length === 1 ? '' : 's'}`}><div className="stack" style={{ gap: 6 }}>{repos.map((repo) => <div className="grepo-row" key={repo.sourceId}>{gitIcons.repo}<span><b>{repo.name}</b><small>{repo.path}</small></span><span className="pillg ok" title="Branch atual">{gitIcons.branch}{repo.head ?? '—'}</span></div>)}{!repos.length && <small className="hint">Nenhum repositório Git neste projeto ainda.</small>}</div></Fold>
  </div>
}
