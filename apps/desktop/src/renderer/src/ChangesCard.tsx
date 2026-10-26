import React, { useCallback, useEffect, useState } from 'react'
import type { Review, TestRun } from '@agentboard/contracts'
import { parseChanges, type FileChange } from './changes'
import { CheckIcon, DiffIcon, ExpandIcon, RefreshIcon } from './icons'
import { ConfirmDialog } from './ConfirmDialog'
import { plainError } from './NoticeDialog'

const commandKey = (projectId: string): string => `agentboard.testCommand.${projectId}`
const readCommand = (projectId: string): string => { try { return localStorage.getItem(commandKey(projectId)) ?? '' } catch { return '' } }

/**
 * Alterações do card (worktree): +/− do que o agente mudou, arquivos e os dois passos que liberam Done (teste e revisão).
 * Fica flutuando à esquerda do chat; os dois chips (Testes automatizados e Revisar) são os botões e pedem confirmação.
 */
export function ChangesCard({ cardId, projectId, busy }: { cardId: string; projectId: string; busy: boolean }): React.JSX.Element {
  const [files, setFiles] = useState<FileChange[]>(), [test, setTest] = useState<TestRun | null>(null), [review, setReview] = useState<Review | null>(null)
  const [open, setOpen] = useState(false), [file, setFile] = useState<string>(), [command, setCommand] = useState(() => readCommand(projectId))
  const [ask, setAsk] = useState<'' | 'test' | 'review'>(''), [working, setWorking] = useState<'' | 'refresh' | 'test' | 'review'>(''), [error, setError] = useState('')
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

  /** Abre a visualização ampliada na área principal, só com os arquivos alterados (no lugar do chat). */
  const showAll = (): void => { if (files?.length) window.dispatchEvent(new CustomEvent('agentboard:open-changes', { detail: { projectId, cardId, files } })) }
  const added = files?.reduce((sum, item) => sum + item.added, 0) ?? 0, removed = files?.reduce((sum, item) => sum + item.removed, 0) ?? 0
  const passed = test?.status === 'passed', approved = review?.state === 'approved' || review?.state === 'merged'
  const selected = files?.find((item) => item.path === file)
  return <aside className={`changes ${open ? 'open' : ''}`} aria-label="Alterações do card">
    <div className="ch-head">
      <button type="button" className="ch-title" aria-expanded={open} onClick={() => setOpen(!open)}>Alterações<span className="chev" aria-hidden="true">›</span></button>
      <button type="button" className="ch-icon tip" data-tip="Ver alterações em tela ampla" aria-label="Ver alterações em tela ampla" disabled={!files?.length} onClick={showAll}><ExpandIcon /></button>
      <button type="button" className="ch-icon tip" data-tip="Atualizar" aria-label="Atualizar alterações" disabled={Boolean(working)} onClick={() => void refresh()}>{working === 'refresh' ? <span className="spin sm" /> : <RefreshIcon />}</button>
    </div>
    <button type="button" className="ch-row ch-rowbtn" disabled={!files?.length} title="Ver os arquivos alterados no explorador" aria-label="Ver os arquivos alterados no explorador" onClick={showAll}>
      <DiffIcon />
      {files === undefined ? <span className="ch-muted">Carregando…</span>
        : files.length ? <><span className="ch-add">+{added}</span><span className="ch-del">−{removed}</span><span className="ch-muted">{files.length} {files.length === 1 ? 'arquivo' : 'arquivos'}</span><span className="chev" aria-hidden="true">›</span></>
          : <span className="ch-muted">Nenhuma alteração ainda</span>}
    </button>
    <div className="ch-steps">
      <button type="button" className={`ch-step ${passed ? 'ok' : test?.status === 'failed' ? 'bad' : ''}`} title="Roda o comando de teste do projeto (ex.: npm test) nesta worktree. Para ir para Done, o teste precisa passar e a revisão ser aprovada." disabled={Boolean(working) || busy} onClick={() => setAsk('test')}>{working === 'test' ? <span className="spin sm" /> : passed ? '✓' : test?.status === 'failed' ? '✕' : '○'} Testes automatizados{test?.status === 'failed' ? ' falharam' : passed ? ' passaram' : ''}</button>
      <button type="button" className={`ch-step ${approved ? 'ok' : ''}`} title="Sua aprovação das alterações; libera depois que os testes passam" disabled={Boolean(working) || busy || !passed || approved} onClick={() => setAsk('review')}>{working === 'review' ? <span className="spin sm" /> : approved ? '✓' : '○'} Revisar{approved ? ' · aprovada' : ''}</button>
      {passed && approved && <span className="ch-ready"><CheckIcon />Pronto para Done</span>}
    </div>
    {open && <div className="ch-body">
      {!!files?.length && <ul className="ch-files">{files.map((item) => <li key={item.path}>
        <button type="button" className={`ch-file ${file === item.path ? 'on' : ''}`} disabled={item.untracked} title={item.path} onClick={() => setFile(file === item.path ? undefined : item.path)}>
          <span className="ch-path">{item.path}</span>{item.untracked ? <span className="ch-new">novo</span> : <><span className="ch-add">+{item.added}</span><span className="ch-del">−{item.removed}</span></>}
        </button></li>)}</ul>}
      {selected && <pre className="ch-diff">{selected.diff.split('\n').map((line, index) => <span key={index} className={line.startsWith('+') && !line.startsWith('+++') ? 'a' : line.startsWith('-') && !line.startsWith('---') ? 'd' : line.startsWith('@@') ? 'h' : undefined}>{line}{'\n'}</span>)}</pre>}
      <label className="ch-cmd">Comando de teste do projeto<input className="in" value={command} placeholder="ex.: pytest, npm test" spellCheck={false} onChange={(e) => setCommand(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void runTest() }} /></label>
      {test?.status === 'failed' && <pre className="ch-diff ch-log">{test.summary.slice(-1500)}</pre>}
    </div>}
    {error && <p className="ch-error">{error}</p>}
    {ask === 'test' && <ConfirmDialog eyebrow="Testes automatizados" title={test?.status === 'failed' ? 'Rodar os testes de novo?' : 'Rodar os testes?'} text={command.trim() ? `Vai rodar "${command.trim()}" na worktree deste card. Para ir para Done, os testes precisam passar e a revisão ser aprovada.` : 'Vai rodar o comando de teste do projeto na worktree deste card. Você ainda precisa informar o comando (ex.: pytest, npm test).'} ok="Rodar testes" cancel={() => setAsk('')} confirm={() => { setAsk(''); void runTest() }} />}
    {ask === 'review' && <ConfirmDialog eyebrow="Revisão" title="Aprovar as alterações?" text={`Você confirma que revisou as ${files?.length ?? 0} ${files?.length === 1 ? 'alteração' : 'alterações'} (+${added} −${removed}) e aprova este card. Depois disso ele fica pronto para Done.`} ok="Aprovar" cancel={() => setAsk('')} confirm={() => { setAsk(''); void approve() }} />}
  </aside>
}
