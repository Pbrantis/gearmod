import React, { useCallback, useEffect, useRef, useState } from 'react'
import { errorCodeOf, withoutErrorCode, type Review, type TestRun } from '@agentboard/contracts'
import { parseChanges, type FileChange } from './changes'
import { CheckIcon, DiffIcon, ExpandIcon, RefreshIcon } from './icons'
import { ConfirmDialog } from './ConfirmDialog'
import { plainError } from './NoticeDialog'
import { LinkWorktreeDialog } from './LinkWorktreeDialog'
import { useT } from './i18n'

const commandKey = (projectId: string): string => `agentboard.testCommand.${projectId}`
const readCommand = (projectId: string): string => { try { return localStorage.getItem(commandKey(projectId)) ?? '' } catch { return '' } }

/**
 * Alterações do card (worktree): +/− do que o agente mudou, arquivos e os dois passos que liberam Done (teste e revisão).
 * Fica flutuando à esquerda do chat; os dois chips (Testes automatizados e Revisar) são os botões e pedem confirmação.
 */
export function ChangesCard({ cardId, projectId, busy, shared }: { cardId: string; projectId: string; busy: boolean; shared?: string | null }): React.JSX.Element {
  const { board: tb, common } = useT(), t = tb.changesCard
  const [picking, setPicking] = useState(false), [noWorktree, setNoWorktree] = useState(false)
  const [files, setFiles] = useState<FileChange[]>(), [test, setTest] = useState<TestRun | null>(null), [review, setReview] = useState<Review | null>(null)
  const [command, setCommand] = useState(() => readCommand(projectId)), [draftCommand, setDraftCommand] = useState(() => readCommand(projectId))
  const [ask, setAsk] = useState<'' | 'test' | 'review'>(''), [configuring, setConfiguring] = useState<'' | 'save' | 'run'>(''), [working, setWorking] = useState<'' | 'refresh' | 'test' | 'review'>(''), [error, setError] = useState('')
  const loading = useRef(false)
  // `silent`: atualização automática; não mostra o carregando nem sobrepõe uma leitura que ainda está em andamento.
  const refresh = useCallback(async (silent = false) => {
    if (loading.current) return
    loading.current = true
    if (!silent) setWorking('refresh')
    try {
      const [snapshot, quality] = await Promise.all([window.agentboard.invoke('worktrees:snapshot', { cardId }), window.agentboard.invoke('quality:status', { cardId })])
      setFiles(snapshot.exists ? parseChanges(snapshot) : []); setTest(quality.test); setReview(quality.review); setError(''); setNoWorktree(false)
    } catch (reason) {
      // Card sem worktree (ainda não executou, ou o trabalho foi feito na de outro card): não é erro, só oferece vincular.
      if (errorCodeOf(plainError(reason)) === 'no-worktree') { setFiles([]); setNoWorktree(true); setError('') } else setError(withoutErrorCode(plainError(reason)))
    } finally { loading.current = false; if (!silent) setWorking('') }
  }, [cardId])
  // Recarrega ao abrir e quando o agente termina um turno (é aí que os arquivos mudam).
  useEffect(() => { if (!busy) void refresh() }, [busy, refresh])
  // Os arquivos também mudam por fora (outro chat, você no editor, o testador): atualiza sozinho, em silêncio, a cada poucos segundos,
  // ao voltar para a janela e quando o card ou uma ferramenta avisa que algo mudou.
  useEffect(() => {
    const again = (): void => { if (!document.hidden) void refresh(true) }
    const timer = window.setInterval(again, 6000)
    const off = window.agentboard.onRunEvent((event) => { if (['agentboard/card-updated', 'agentboard/run-completed'].includes(event.eventType)) again() })
    window.addEventListener('focus', again)
    return () => { window.clearInterval(timer); off(); window.removeEventListener('focus', again) }
  }, [refresh])

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
  return <aside className="changes" aria-label={t.cardChanges}>
    <div className="ch-head">
      <span className="ch-title">{t.title}</span>
      <button type="button" className="ch-icon tip" data-tip={t.viewWide} aria-label={t.viewWide} disabled={!files?.length} onClick={showAll}><ExpandIcon /></button>
      <button type="button" className="ch-icon tip" data-tip={common.refresh} aria-label={t.refreshChanges} disabled={Boolean(working)} onClick={() => void refresh()}>{working === 'refresh' ? <span className="spin sm" /> : <RefreshIcon />}</button>
    </div>
    <button type="button" className="ch-row ch-rowbtn" disabled={!files?.length} data-tip={t.viewFiles} aria-label={t.viewFiles} onClick={showAll}>
      <DiffIcon />
      {files === undefined ? <span className="ch-muted">{common.loading}</span>
        : files.length ? <><span className="ch-add">+{added}</span><span className="ch-del">−{removed}</span><span className="ch-muted">{t.fileCount(files.length)}</span><span className="chev chev-box" aria-hidden="true"><svg className="chev-svg" viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3" /></svg></span></>
          : <span className="ch-muted">{t.noChangesYet}</span>}
    </button>
    {shared && <p className="ch-muted ch-shared">{t.usingWorktreeOf(shared)} · <button type="button" className="linklike" onClick={() => void window.agentboard.invoke('worktrees:link', { cardId, fromCardId: null }).then(() => { window.dispatchEvent(new Event('agentboard:board-changed')); void refresh() })}>{t.unlink}</button></p>}
    {!shared && noWorktree && <button type="button" className="mini secondary ch-link" onClick={() => setPicking(true)}>{t.useOtherWorktree}</button>}
    {picking && <LinkWorktreeDialog cardId={cardId} close={() => setPicking(false)} linked={() => { setPicking(false); void refresh() }} />}
    <div className="ch-steps">
      <button type="button" className={`ch-step ${passed ? 'ok' : test?.status === 'failed' ? 'bad' : ''}`} data-tip={t.autoTestsTip} disabled={Boolean(working) || busy} onClick={() => command.trim() ? setAsk('test') : configure('run')}>{working === 'test' ? <span className="spin sm" /> : passed ? '✓' : test?.status === 'failed' ? '✕' : '○'} {test?.status === 'failed' ? t.autoTestsFailed : passed ? t.autoTestsPassed : t.autoTests}</button>
      <button type="button" className={`ch-step ${approved ? 'ok' : ''}`} data-tip={t.reviewTip} disabled={Boolean(working) || busy || !passed || approved} onClick={() => setAsk('review')}>{working === 'review' ? <span className="spin sm" /> : approved ? '✓' : '○'} {approved ? t.reviewApproved : t.review}</button>
      <button type="button" className={`ch-step ch-command ${command.trim() ? '' : 'bad'}`} data-tip={command.trim() ? t.currentCommand(command) : t.defineCommandTip} onClick={() => configure('save')}>{command.trim() ? `⌘ ${command}` : t.configureCommand}</button>
      {passed && approved && <span className="ch-ready"><CheckIcon />{t.readyForDone}</span>}
    </div>
    {error && <p className="ch-error">{error}</p>}
    {ask === 'test' && <ConfirmDialog eyebrow={t.autoTests} title={test?.status === 'failed' ? t.runAgainTitle : t.runTestsTitle} text={command.trim() ? t.runTestsText(command.trim()) : t.runTestsNoCommand} ok={t.runTests} cancel={() => setAsk('')} confirm={() => { setAsk(''); void runTest() }} />}
    {ask === 'review' && <ConfirmDialog eyebrow={t.reviewEyebrow} title={t.approveTitle} text={t.approveText(files?.length ?? 0, added, removed)} ok={t.approve} cancel={() => setAsk('')} confirm={() => { setAsk(''); void approve() }} />}
    {configuring && <ConfirmDialog eyebrow={t.autoTests} title={t.commandTitle} text={t.commandText} ok={configuring === 'run' ? t.saveAndRun : t.saveCommand} okDisabled={!draftCommand.trim()} extra={<label className="ch-cmd">{t.command}<input className="in" autoFocus value={draftCommand} placeholder={t.commandPlaceholder} spellCheck={false} onChange={(event) => setDraftCommand(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && draftCommand.trim()) saveConfiguredCommand() }} /></label>} cancel={() => setConfiguring('')} confirm={saveConfiguredCommand} />}
  </aside>
}
