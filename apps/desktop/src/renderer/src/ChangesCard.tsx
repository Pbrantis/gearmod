import React, { useCallback, useEffect, useState } from 'react'
import type { Review, TestRun } from '@agentboard/contracts'
import { groupChanges, parseChanges, type FileChange } from './changes'
import { CheckIcon, DiffIcon, ExpandIcon, RefreshIcon } from './icons'
import { ConfirmDialog } from './ConfirmDialog'
import { plainError } from './NoticeDialog'

const commandKey = (projectId: string): string => `agentboard.testCommand.${projectId}`
const readCommand = (projectId: string): string => { try { return localStorage.getItem(commandKey(projectId)) ?? '' } catch { return '' } }

/**
 * Alterações do card (worktree): +/− do que o agente mudou, arquivos e os dois passos que liberam Done (teste e revisão).
 * Fica flutuando à esquerda do chat; os dois chips (Testes automatizados e Revisar) são os botões e pedem confirmação.
 */
export function ChangesCard({ cardId, projectId, busy, openFile }: { cardId: string; projectId: string; busy: boolean; openFile?(path: string): void }): React.JSX.Element {
  const [files, setFiles] = useState<FileChange[]>(), [test, setTest] = useState<TestRun | null>(null), [review, setReview] = useState<Review | null>(null)
  const [command, setCommand] = useState(() => readCommand(projectId)), [draftCommand, setDraftCommand] = useState(() => readCommand(projectId))
  const [ask, setAsk] = useState<'' | 'test' | 'review'>(''), [configuring, setConfiguring] = useState<'' | 'save' | 'run'>(''), [working, setWorking] = useState<'' | 'refresh' | 'test' | 'review'>(''), [error, setError] = useState('')
  const refresh = useCallback(async () => {
    setWorking('refresh')
    try {
      const [snapshot, quality] = await Promise.all([window.agentboard.invoke('worktrees:snapshot', { cardId }), window.agentboard.invoke('quality:status', { cardId })])
      setFiles(snapshot.exists ? parseChanges(snapshot) : []); setTest(quality.test); setReview(quality.review); setError('')
    } catch (reason) { setError(plainError(reason)) } finally { setWorking('') }
  }, [cardId])
  // Recarrega ao abrir e quando o agente termina um turno (é aí que os arquivos mudam).
  useEffect(() => { if (!busy) void refresh() }, [busy, refresh])

  const runTest = async (value = command): Promise<void> => {
    const nextCommand = value.trim(), parts = nextCommand.split(/\s+/).filter(Boolean)
    if (!parts.length) { setDraftCommand(''); setConfiguring('run'); return }
    setCommand(nextCommand); setDraftCommand(nextCommand)
    try { localStorage.setItem(commandKey(projectId), nextCommand) } catch { /* só conveniência */ }
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
  const configure = (action: 'save' | 'run'): void => { setDraftCommand(command); setConfiguring(action) }
  const saveConfiguredCommand = (): void => {
    const next = draftCommand.trim(); if (!next) return
    setCommand(next); try { localStorage.setItem(commandKey(projectId), next) } catch { /* só conveniência */ }
    const action = configuring; setConfiguring(''); if (action === 'run') void runTest(next)
  }
  return <aside className="changes" aria-label="Alterações do card">
    <div className="ch-head">
      <span className="ch-title">Alterações</span>
      <button type="button" className="ch-icon tip" data-tip="Ver alterações em tela ampla" aria-label="Ver alterações em tela ampla" disabled={!files?.length} onClick={showAll}><ExpandIcon /></button>
      <button type="button" className="ch-icon tip" data-tip="Atualizar" aria-label="Atualizar alterações" disabled={Boolean(working)} onClick={() => void refresh()}>{working === 'refresh' ? <span className="spin sm" /> : <RefreshIcon />}</button>
    </div>
    <button type="button" className="ch-row ch-rowbtn" disabled={!files?.length} title="Ver os arquivos alterados no explorador" aria-label="Ver os arquivos alterados no explorador" onClick={showAll}>
      <DiffIcon />
      {files === undefined ? <span className="ch-muted">Carregando…</span>
        : files.length ? <><span className="ch-add">+{added}</span><span className="ch-del">−{removed}</span><span className="ch-muted">{files.length} {files.length === 1 ? 'arquivo' : 'arquivos'}</span><span className="chev" aria-hidden="true">›</span></>
          : <span className="ch-muted">Nenhuma alteração ainda</span>}
    </button>
    {files && files.length > 0 && <div className="ch-files" role="list" aria-label="Arquivos alterados">{(() => { const groups = groupChanges(files, []); return groups.map((group) => <React.Fragment key={group.root ?? ''}>{groups.length > 1 && <div className="ch-repohead" role="presentation" title={group.root ?? undefined}><span>{group.name}</span><span className="ch-add">+{group.added}</span><span className="ch-del">−{group.removed}</span></div>}{group.files.slice(0, 8).map((file) => <button key={`${file.root ?? ''}:${file.path}`} type="button" role="listitem" className="ch-file" title={file.path} onClick={() => openFile ? openFile(file.root ? `${file.root.replace(/[\\/]+$/, '')}/${file.path}` : file.path) : showAll()}><span className="ch-fname">{file.path.split('/').at(-1)}</span>{file.untracked ? <span className="ch-new">novo</span> : <><span className="ch-add">+{file.added}</span><span className="ch-del">−{file.removed}</span></>}</button>)}{group.files.length > 8 && <button type="button" className="ch-more" onClick={showAll}>+{group.files.length - 8} arquivos…</button>}</React.Fragment>) })()}</div>}
    <div className="ch-steps">
      <button type="button" className={`ch-step ${passed ? 'ok' : test?.status === 'failed' ? 'bad' : ''}`} title="Roda o comando de teste do projeto nesta worktree. É diferente do checklist manual do chat de Teste." disabled={Boolean(working) || busy} onClick={() => command.trim() ? setAsk('test') : configure('run')}>{working === 'test' ? <span className="spin sm" /> : passed ? '✓' : test?.status === 'failed' ? '✕' : '○'} Testes automatizados{test?.status === 'failed' ? ' falharam' : passed ? ' passaram' : ''}</button>
      <button type="button" className={`ch-step ${approved ? 'ok' : ''}`} title="Sua aprovação das alterações; libera depois que os testes passam" disabled={Boolean(working) || busy || !passed || approved} onClick={() => setAsk('review')}>{working === 'review' ? <span className="spin sm" /> : approved ? '✓' : '○'} Revisar{approved ? ' · aprovada' : ''}</button>
      <button type="button" className={`ch-step ch-command ${command.trim() ? '' : 'bad'}`} title={command.trim() ? `Comando atual: ${command}` : 'Defina qual comando executa os testes deste projeto'} onClick={() => configure('save')}>{command.trim() ? `⌘ ${command}` : '⌘ Configurar comando'}</button>
      {passed && approved && <span className="ch-ready"><CheckIcon />Pronto para Done</span>}
    </div>
    {error && <p className="ch-error">{error}</p>}
    {ask === 'test' && <ConfirmDialog eyebrow="Testes automatizados" title={test?.status === 'failed' ? 'Rodar os testes de novo?' : 'Rodar os testes?'} text={command.trim() ? `Vai rodar "${command.trim()}" na worktree deste card. Para ir para Done, os testes precisam passar e a revisão ser aprovada.` : 'Vai rodar o comando de teste do projeto na worktree deste card. Você ainda precisa informar o comando (ex.: pytest, npm test).'} ok="Rodar testes" cancel={() => setAsk('')} confirm={() => { setAsk(''); void runTest() }} />}
    {ask === 'review' && <ConfirmDialog eyebrow="Revisão" title="Aprovar as alterações?" text={`Você confirma que revisou as ${files?.length ?? 0} ${files?.length === 1 ? 'alteração' : 'alterações'} (+${added} −${removed}) e aprova este card. Depois disso ele fica pronto para Done.`} ok="Aprovar" cancel={() => setAsk('')} confirm={() => { setAsk(''); void approve() }} />}
    {configuring && <ConfirmDialog eyebrow="Testes automatizados" title="Comando de teste do projeto" text="Informe o comando que deve passar para liberar este card para Done. O checklist do chat de Teste é separado desta execução automatizada." ok={configuring === 'run' ? 'Salvar e rodar' : 'Salvar comando'} okDisabled={!draftCommand.trim()} extra={<label className="ch-cmd">Comando<input className="in" autoFocus value={draftCommand} placeholder="ex.: pnpm test, npm test, pytest" spellCheck={false} onChange={(event) => setDraftCommand(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && draftCommand.trim()) saveConfiguredCommand() }} /></label>} cancel={() => setConfiguring('')} confirm={saveConfiguredCommand} />}
  </aside>
}
