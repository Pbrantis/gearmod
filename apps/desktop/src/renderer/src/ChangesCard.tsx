import React, { useCallback, useEffect, useState } from 'react'
import type { Review, TestRun } from '@agentboard/contracts'
import { parseChanges, type FileChange } from './changes'
import { CheckIcon, DiffIcon, RefreshIcon } from './icons'
import { plainError } from './NoticeDialog'

const commandKey = (projectId: string): string => `agentboard.testCommand.${projectId}`
const readCommand = (projectId: string): string => { try { return localStorage.getItem(commandKey(projectId)) ?? '' } catch { return '' } }

/**
 * Alterações do card (worktree): +/− do que o agente mudou, arquivos e os dois passos que liberam Done (teste e revisão).
 * Fica flutuando à esquerda do chat; o botão principal mostra só o próximo passo.
 */
export function ChangesCard({ cardId, projectId, busy }: { cardId: string; projectId: string; busy: boolean }): React.JSX.Element {
  const [files, setFiles] = useState<FileChange[]>(), [test, setTest] = useState<TestRun | null>(null), [review, setReview] = useState<Review | null>(null)
  const [open, setOpen] = useState(false), [file, setFile] = useState<string>(), [command, setCommand] = useState(() => readCommand(projectId))
  const [working, setWorking] = useState<'' | 'refresh' | 'test' | 'review'>(''), [error, setError] = useState('')
  const refresh = useCallback(async () => {
    setWorking('refresh')
    try {
      const [snapshot, quality] = await Promise.all([window.agentboard.invoke('worktrees:snapshot', { cardId }), window.agentboard.invoke('quality:status', { cardId })])
      setFiles(snapshot.exists ? parseChanges(snapshot) : []); setTest(quality.test); setReview(quality.review); setError('')
    } catch (reason) { setError(plainError(reason)) } finally { setWorking('') }
  }, [cardId])
  // Recarrega ao abrir e quando o agente termina um turno (é aí que os arquivos mudam).
  useEffect(() => { if (!busy) void refresh() }, [busy, refresh])

  const runTest = async (): Promise<void> => {
    const parts = command.trim().split(/\s+/).filter(Boolean)
    if (!parts.length) { setOpen(true); setError('Informe o comando de teste do projeto (ex.: pytest, npm test).'); return }
    try { localStorage.setItem(commandKey(projectId), command.trim()) } catch { /* só conveniência */ }
    setWorking('test'); setError('')
    try { setTest(await window.agentboard.invoke('tests:run', { cardId, executable: parts[0]!, args: parts.slice(1) })) } catch (reason) { setError(plainError(reason)) } finally { setWorking('') }
  }
  const approve = async (): Promise<void> => {
    setWorking('review'); setError('')
    try {
      const prepared = review ?? await window.agentboard.invoke('reviews:prepare-local', { cardId })
      setReview(prepared.state === 'open' ? await window.agentboard.invoke('reviews:approve-local', { reviewId: prepared.id }) : prepared)
    } catch (reason) { setError(plainError(reason)) } finally { setWorking('') }
  }

  const added = files?.reduce((sum, item) => sum + item.added, 0) ?? 0, removed = files?.reduce((sum, item) => sum + item.removed, 0) ?? 0
  const passed = test?.status === 'passed', approved = review?.state === 'approved' || review?.state === 'merged'
  const selected = files?.find((item) => item.path === file)
  const primary = !passed
    ? <button type="button" className="ch-btn" disabled={Boolean(working) || busy} onClick={() => void runTest()}>{working === 'test' ? <span className="spin sm" /> : test?.status === 'failed' ? 'Testar de novo' : 'Rodar teste'}</button>
    : !approved
      ? <button type="button" className="ch-btn" disabled={Boolean(working) || busy} onClick={() => void approve()}>{working === 'review' ? <span className="spin sm" /> : 'Aprovar'}</button>
      : <span className="ch-ready"><CheckIcon />Pronto para Done</span>

  return <aside className={`changes ${open ? 'open' : ''}`} aria-label="Alterações do card">
    <div className="ch-head">
      <button type="button" className="ch-title" aria-expanded={open} onClick={() => setOpen(!open)}>Alterações<span className="chev" aria-hidden="true">›</span></button>
      <button type="button" className="ch-icon tip" data-tip="Atualizar" aria-label="Atualizar alterações" disabled={Boolean(working)} onClick={() => void refresh()}>{working === 'refresh' ? <span className="spin sm" /> : <RefreshIcon />}</button>
    </div>
    <div className="ch-row">
      <DiffIcon />
      {files === undefined ? <span className="ch-muted">Carregando…</span>
        : files.length ? <><span className="ch-add">+{added}</span><span className="ch-del">−{removed}</span><span className="ch-muted">{files.length} {files.length === 1 ? 'arquivo' : 'arquivos'}</span></>
          : <span className="ch-muted">Nenhuma alteração ainda</span>}
      <span className="ch-spacer" />
      {primary}
    </div>
    <div className="ch-steps">
      <span className={`ch-step ${passed ? 'ok' : test?.status === 'failed' ? 'bad' : ''}`}>{passed ? '✓' : test?.status === 'failed' ? '✕' : '○'} Teste{test?.status === 'failed' ? ' falhou' : passed ? ' passou' : ''}</span>
      <span className={`ch-step ${approved ? 'ok' : ''}`}>{approved ? '✓' : '○'} Revisão{approved ? ' aprovada' : ''}</span>
    </div>
    {open && <div className="ch-body">
      {!!files?.length && <ul className="ch-files">{files.map((item) => <li key={item.path}>
        <button type="button" className={`ch-file ${file === item.path ? 'on' : ''}`} disabled={item.untracked} title={item.path} onClick={() => setFile(file === item.path ? undefined : item.path)}>
          <span className="ch-path">{item.path}</span>{item.untracked ? <span className="ch-new">novo</span> : <><span className="ch-add">+{item.added}</span><span className="ch-del">−{item.removed}</span></>}
        </button></li>)}</ul>}
      {selected && <pre className="ch-diff">{selected.diff.split('\n').map((line, index) => <span key={index} className={line.startsWith('+') && !line.startsWith('+++') ? 'a' : line.startsWith('-') && !line.startsWith('---') ? 'd' : line.startsWith('@@') ? 'h' : undefined}>{line}{'\n'}</span>)}</pre>}
      <label className="ch-cmd">Comando de teste<input className="in" value={command} placeholder="ex.: pytest, npm test" spellCheck={false} onChange={(e) => setCommand(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void runTest() }} /></label>
      {test?.status === 'failed' && <pre className="ch-diff ch-log">{test.summary.slice(-1500)}</pre>}
    </div>}
    {error && <p className="ch-error">{error}</p>}
  </aside>
}
