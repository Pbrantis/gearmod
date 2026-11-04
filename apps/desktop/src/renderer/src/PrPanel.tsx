import React, { useEffect, useState } from 'react'
import type { PullRequestDetail, PullRequestList, PullRequestSummary } from '@gearmod/contracts'
import { toast } from './toasts'
import type { PullRequestsState } from './usePullRequests'
import { plainError } from './NoticeDialog'
import { Select } from './Select'
import { Checkbox } from './Checkbox'
import { KeyIcon } from './icons'
import { useT, dateLocale } from './i18n'

const when = (value: string): string => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(dateLocale(), { dateStyle: 'short', timeStyle: 'short' }) }
const message = (error: unknown): string => plainError(error)

/** PR detail: description, conversation, files, diff and the comment and review actions. */
function PrDetail({ sourceId, provider, pr, back, changed }: { sourceId: string; provider: 'github' | 'gitlab' | null; pr: PullRequestSummary; back(): void; changed(): void }): React.JSX.Element {
  const { common, git: { pr: t } } = useT(), decisionLabel = t.decision, reviewLabel = t.review
  const [detail, setDetail] = useState<PullRequestDetail>(), [error, setError] = useState(''), [text, setText] = useState(''), [busy, setBusy] = useState(''), [diff, setDiff] = useState(false)
  const load = (): void => { void window.gearmod.invoke('prs:view', { sourceId, number: pr.number }).then(setDetail, (reason) => setError(message(reason))) }
  useEffect(load, [sourceId, pr.number])
  const act = async (name: string, run: () => Promise<unknown>, done: string): Promise<void> => {
    setBusy(name)
    try { await run(); setText(''); toast.success(done); load(); changed() } catch (reason) { toast.error(t.failed, message(reason)) } finally { setBusy('') }
  }
  const review = (action: 'approve' | 'request-changes' | 'comment', done: string) => act(action, () => window.gearmod.invoke('prs:review', { sourceId, number: pr.number, action, body: text }), done)
  const openWeb = (): void => { void window.gearmod.invoke('prs:open', { sourceId, url: pr.url }).catch((reason) => toast.error(t.openFailed, message(reason))) }
  return <div className="prdetail">
    <div className="prbar"><button type="button" className="mini secondary" onClick={back}>{t.back}</button><button type="button" className="mini secondary" onClick={openWeb}>{t.openOn(provider === 'gitlab' ? 'GitLab' : 'GitHub')}</button></div>
    <h3>#{pr.number} {pr.title}</h3>
    <div className="gmeta"><span><code>{pr.head}</code> → <code>{pr.base}</code></span><span>{pr.author}{pr.draft ? ` · ${t.draft}` : ''}{(detail?.reviewDecision ?? pr.reviewDecision) ? ` · ${decisionLabel[(detail?.reviewDecision ?? pr.reviewDecision)!] ?? detail?.reviewDecision}` : ''}</span>{detail && <span>{t.diffStat(detail.additions, detail.deletions, detail.files.length)}{detail.mergeable === 'CONFLICTING' ? ` · ${t.withConflict}` : ''}</span>}</div>
    {error && <p className="error">{error}</p>}
    {!detail && !error && <p className="gempty">{common.loading}</p>}
    {detail && <>
      {detail.body.trim() && <div className="prbody">{detail.body}</div>}
      <details className="prfiles"><summary>{t.changedFiles(detail.files.length)}</summary>{detail.files.map((file) => <div className="prfile" key={file.path}><span className="pth" data-tip={file.path}>{file.path}</span><span className="nums"><b className="a">+{file.additions}</b> <b className="d">−{file.deletions}</b></span></div>)}</details>
      <div className="prdiffhead"><button type="button" className="mini secondary" onClick={() => setDiff(!diff)}>{diff ? t.hideDiff : t.showDiff}</button></div>
      {diff && <pre className="prdiff">{detail.diff ? detail.diff.split('\n').map((line, index) => <span key={index} className={line.startsWith('+') && !line.startsWith('+++') ? 'a' : line.startsWith('-') && !line.startsWith('---') ? 'd' : line.startsWith('@@') ? 'h' : ''}>{line}{'\n'}</span>) : t.noDiff}</pre>}
      <div className="prthread">
        {detail.reviews.map((item, index) => <div className="prmsg" key={`r${index}`}><b>{item.author} {reviewLabel[item.state] ?? item.state.toLowerCase()}</b><small>{when(item.at)}</small>{item.body.trim() && <p>{item.body}</p>}</div>)}
        {detail.comments.map((item, index) => <div className="prmsg" key={`c${index}`}><b>{item.author}</b><small>{when(item.at)}</small><p>{item.body}</p></div>)}
        {!detail.reviews.length && !detail.comments.length && <p className="gempty">{t.noComments}</p>}
      </div>
      <label className="f"><span>{t.commentOrReview}</span><textarea className="in" rows={4} value={text} onChange={(event) => setText(event.target.value)} placeholder={t.commentPlaceholder} /></label>
      <div className="pract">
        <button type="button" className="mini" disabled={Boolean(busy) || !text.trim()} onClick={() => void act('comment', () => window.gearmod.invoke('prs:comment', { sourceId, number: pr.number, body: text }), t.commentPosted)}>{busy === 'comment' ? '…' : t.comment}</button>
        <button type="button" className="mini" disabled={Boolean(busy)} onClick={() => void review('approve', t.approved)}>{busy === 'approve' ? '…' : t.approve}</button>
        {provider !== 'gitlab' && <button type="button" className="mini danger" disabled={Boolean(busy) || !text.trim()} onClick={() => void review('request-changes', t.changesRequested)}>{busy === 'request-changes' ? '…' : t.requestChanges}</button>}
      </div>
    </>}
  </div>
}

/** Form to open a PR from a local branch of the repository (the branch is published to origin). */
function PrCreate({ sourceId, branches, head, back, created }: { sourceId: string; branches: string[]; head: string | null; back(): void; created(): void }): React.JSX.Element {
  const t = useT().git.pr
  const [from, setFrom] = useState(head && branches.includes(head) ? head : branches[0] ?? ''), [base, setBase] = useState(() => ['main', 'master', 'develop'].find((name) => branches.includes(name) && name !== head) ?? branches.find((name) => name !== head) ?? '')
  const [title, setTitle] = useState(''), [body, setBody] = useState(''), [draft, setDraft] = useState(true), [busy, setBusy] = useState(false)
  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault(); setBusy(true)
    try { const { url } = await window.gearmod.invoke('prs:create', { sourceId, head: from, base, title, body, draft }); toast.success(t.opened, url); created() } catch (reason) { toast.error(t.createFailed, message(reason)) } finally { setBusy(false) }
  }
  return <form className="prdetail" onSubmit={(event) => void submit(event)}>
    <div className="prbar"><button type="button" className="mini secondary" onClick={back}>{t.back}</button></div>
    <h3>{t.newPr}</h3>
    <div className="f"><span>{t.fromBranch}</span><Select label={t.fromBranch} value={from} options={branches.map((name) => ({ value: name, label: name }))} onChange={setFrom} /></div>
    <div className="f"><span>{t.toBranch}</span><Select label={t.toBranch} value={base} options={branches.filter((name) => name !== from).map((name) => ({ value: name, label: name }))} onChange={setBase} /></div>
    <label className="f"><span>{t.title}</span><input className="in" value={title} maxLength={240} onChange={(event) => setTitle(event.target.value)} autoFocus /></label>
    <label className="f"><span>{t.description}</span><textarea className="in" rows={5} value={body} onChange={(event) => setBody(event.target.value)} /></label>
    <label className="prcheck"><Checkbox checked={draft} onChange={setDraft} /> {t.openAsDraft}</label>
    <p className="hint">{t.willPush(from)}</p>
    <div className="pract"><button type="submit" disabled={busy || !from || !base || !title.trim()}>{busy ? t.opening : t.openPr}</button></div>
  </form>
}

/** Opens the project settings on the Git tab, where the accounts (tokens) live. */
export const openGitAccounts = (): void => { window.dispatchEvent(new CustomEvent('gearmod:open-project-config', { detail: { tab: 'git', focus: 'git-accounts' } })) }

/** Why the PRs did not load, with the right output: update the expired token or add one (in place of gh/glab). */
export function PrAccessNotice({ list }: { list: PullRequestList }): React.JSX.Element | null {
  const ta = useT().git.accounts
  if (list.problem === 'invalid-token') return <div className="cx-note warn gacc-note"><i className="gacc-dot" aria-hidden="true" /><span>{list.error ?? ta.invalidBanner}</span><button type="button" className="mini secondary withicon" onClick={openGitAccounts}><KeyIcon />{ta.updateToken}</button></div>
  if (list.problem === 'no-cli' || list.problem === 'not-logged-in') return <div className="cx-note gacc-note"><span>{list.error}</span><button type="button" className="mini secondary withicon" onClick={openGitAccounts}><KeyIcon />{ta.needToken}</button></div>
  return list.error ? <p className="error">{list.error}</p> : null
}

/** Git right sidebar: the repository's open PRs, with a yellow dot on those with news. */
export function PrPanel({ sourceId, repoName, branches, head, prs, focus, close }: { focus?: { number: number; at: number }; sourceId: string; repoName: string; branches: string[]; head: string | null; prs: PullRequestsState; close(): void }): React.JSX.Element {
  const { common, git: { pr: t } } = useT(), decisionLabel = t.decision
  const [open, setOpen] = useState<PullRequestSummary>(), [creating, setCreating] = useState(false), [loading, setLoading] = useState(false)
  const list = prs.lists[sourceId]
  useEffect(() => { setOpen(undefined); setCreating(false) }, [sourceId])
  useEffect(() => { const found = focus && list?.prs.find((item) => item.number === focus.number); if (found) { prs.markSeen(sourceId, found); setCreating(false); setOpen(found) } }, [focus?.at])
  const pick = (pr: PullRequestSummary): void => { prs.markSeen(sourceId, pr); setOpen(pr) }
  const reload = (): void => { setLoading(true); void prs.refresh(sourceId).finally(() => setLoading(false)) }
  if (creating) return <aside className="gdetail gprs"><PrCreate sourceId={sourceId} branches={branches} head={head} back={() => setCreating(false)} created={() => { setCreating(false); reload() }} /></aside>
  if (open) return <aside className="gdetail gprs"><PrDetail key={open.number} sourceId={sourceId} provider={list?.provider ?? null} pr={list?.prs.find((item) => item.number === open.number) ?? open} back={() => setOpen(undefined)} changed={() => { void prs.refresh(sourceId) }} /></aside>
  return <aside className="gdetail gprs">
    <div className="prbar"><h3>{t.panelTitle(repoName)}</h3><button type="button" className="x" onClick={close} data-tip={common.close} aria-label={common.close}>×</button></div>
    <div className="pract"><button type="button" className="mini secondary" onClick={() => setCreating(true)} disabled={list?.supported === false || branches.length < 2}>{t.newButton}</button><button type="button" className="mini secondary" onClick={reload} disabled={loading}>{loading ? '…' : common.refresh}</button></div>
    {!list && <p className="gempty">{common.loading}</p>}
    {list && !list.supported && <p className="hint">{list.error}</p>}
    {list?.supported && list.error && <PrAccessNotice list={list} />}
    {list?.supported && !list.error && !list.prs.length && <p className="gempty">{t.noOpen}</p>}
    {list?.prs.map((pr) => <button type="button" className="prrow" key={pr.number} onClick={() => pick(pr)}>
      <span className="prtitle">{prs.isUnread(sourceId, pr) && <i className="ydot" data-tip={t.newsTip} />}#{pr.number} {pr.title}</span>
      <small>{pr.author} · <code>{pr.head}</code>{pr.draft ? ` · ${t.draft}` : ''}{pr.reviewRequested ? ` · ${t.reviewRequested}` : ''}{pr.reviewDecision ? ` · ${decisionLabel[pr.reviewDecision] ?? pr.reviewDecision}` : ''}{pr.comments ? ` · ${t.commentsCount(pr.comments)}` : ''}</small>
    </button>)}
  </aside>
}
