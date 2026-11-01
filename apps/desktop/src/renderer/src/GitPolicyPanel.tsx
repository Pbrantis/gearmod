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
import { useT } from './i18n'

/** Seção recolhível; fechada, mostra um resumo ao lado do título. */
function Fold({ title, summary, closed = false, children }: { title: string; summary: string; closed?: boolean; children: React.ReactNode }): React.JSX.Element {
  const [shut, setShut] = useState(closed)
  return <div className="f"><span className="foldh" role="button" tabIndex={0} aria-expanded={!shut} onClick={() => setShut(!shut)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShut(!shut) } }}><i>{shut ? '▸' : '▾'}</i>{title}{shut && <small>{summary}</small>}</span>{!shut && children}</div>
}

/** Aba Git de Configurar projeto: quem commita (padrão do projeto), exceções por branch e os repositórios. Salva ao mudar. */
export function GitPolicyPanel({ projectId }: { projectId: string }): React.JSX.Element {
  const { common, git: { policy: t } } = useT()
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
  if (!policy || !reposLoaded) return <div className="stack">{error ? <p className="error">{error}</p> : <small className="hint">{common.loading}</small>}</div>
  if (!repos.length) return <GitEmpty projectId={projectId} done={(items) => { rememberGit(projectId, { repos: items }); setRepos(items) }} />
  const save = async (next: GitPolicy): Promise<void> => {
    try { setError(''); setPolicy(next); rememberGit(projectId, { policy: next }); const stored = await window.agentboard.invoke('git:policy-set', { projectId, policy: next }); rememberGit(projectId, { policy: stored }); setPolicy((current) => current && current.rules.length === stored.rules.length ? current : stored); toast.success(t.ruleSaved) } catch (reason) { setError(plainError(reason)) }
  }
  const rules = policy.rules
  const setRule = (index: number, patch: Partial<GitPolicy['rules'][number]>, persist = true): void => {
    const next = { ...policy, rules: rules.map((item, i) => i === index ? { ...item, ...patch } : item) }
    if (persist) void save(next); else setPolicy(next)
  }
  return <div className="stack gpolcfg">
    <Fold title={t.agentCommitTitle} summary={ruleLabel(policy.def)}><div className="stack" style={{ gap: 6 }}><Select label={t.agentCommitTitle} value={policy.def} options={(['ask', 'auto', 'never'] as const).map((value) => ({ value, label: t.defaultNotes[value].title, sub: t.defaultNotes[value].note }))} onChange={(value) => void save({ ...policy, def: value as GitRule })} /><small className="hint">{t.defaultNotes[policy.def].note}</small></div></Fold>
    <Fold title={t.exceptionsTitle} summary={t.exceptionsCount(rules.length)}><small className="hint">{t.exceptionsHint}</small>
      <div className="stack" style={{ gap: 6 }}>{rules.map((item, index) => <div className="grule" key={index}><input className="in" value={item.pattern} spellCheck={false} placeholder={t.branchNamePlaceholder} aria-label={t.exceptionBranch} onChange={(e) => setRule(index, { pattern: e.target.value }, false)} onBlur={() => void save(policy)} onKeyDown={(e) => { if (e.key === 'Enter') void save(policy) }} />
        <div className="gseg">{(['auto', 'ask', 'never'] as const).map((value) => <button type="button" key={value} className={item.rule === value ? 'on' : ''} onClick={() => setRule(index, { rule: value })}>{ruleLabel(value)}</button>)}</div>
        <button type="button" className="trashbtn tip" data-tip={t.removeException} aria-label={t.removeException} onClick={() => setAskRemove(index)}><TrashIcon /></button></div>)}</div>
      <button type="button" className="mini secondary" style={{ justifySelf: 'start' }} onClick={() => setPolicy({ ...policy, rules: [...rules, { pattern: '', rule: 'auto' }] })}>{t.addException}</button></Fold>
    {askRemove !== null && rules[askRemove] && <ConfirmDialog eyebrow={t.exceptionEyebrow} title={t.removeExceptionTitle(rules[askRemove]!.pattern || t.unnamedBranch)} text={t.removeExceptionText} ok={common.remove} danger cancel={() => setAskRemove(null)} confirm={() => { const index = askRemove; setAskRemove(null); void save({ ...policy, rules: rules.filter((_, i) => i !== index) }) }} />}
    {error && <p className="error">{error}</p>}
    <Fold title={t.reposTitle} closed summary={t.reposCount(repos.length)}><div className="stack" style={{ gap: 6 }}>{repos.map((repo) => <div className="grepo-row" key={repo.sourceId}>{gitIcons.repo}<span><b>{repo.name}</b><small>{repo.path}</small></span><span className="pillg ok" data-tip={t.currentBranch}>{gitIcons.branch}{repo.head ?? '—'}</span></div>)}{!repos.length && <small className="hint">{t.noRepos}</small>}</div></Fold>
  </div>
}
