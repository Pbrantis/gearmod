import React, { useState } from 'react'
import type { GitSnapshot, Review, TestRun } from '@agentboard/contracts'

/** Worktree, teste e revisão do card: os passos que liberam Done (o gate continua no processo main). */
export function QualityPanel({ cardId }: { cardId: string }): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<GitSnapshot>(), [test, setTest] = useState<TestRun>(), [review, setReview] = useState<Review>(), [executable, setExecutable] = useState('pnpm'), [args, setArgs] = useState('test'), [error, setError] = useState('')
  const guard = async (action: () => Promise<void>): Promise<void> => { try { setError(''); await action() } catch (reason) { setError(String(reason).replace(/^Error: /, '')) } }
  return <div className="convbox">
    <div><button type="button" className="mini secondary" onClick={() => void guard(async () => setSnapshot(await window.agentboard.invoke('worktrees:snapshot', { cardId })))}>Ver status e diff</button>{snapshot && <pre className="qpre">{snapshot.status}{snapshot.diff}</pre>}</div>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6 }}><input className="in" value={executable} onChange={(e) => setExecutable(e.target.value)} aria-label="Executável de teste" /><input className="in" value={args} onChange={(e) => setArgs(e.target.value)} aria-label="Argumentos do teste" /><button type="button" className="mini" onClick={() => void guard(async () => setTest(await window.agentboard.invoke('tests:run', { cardId, executable, args: args.split(/\s+/).filter(Boolean) })))}>Rodar teste</button></div>
    {test && <p>Teste: <b>{test.status}</b> (exit {test.exitCode})</p>}
    <div>{!review ? <button type="button" className="mini secondary" onClick={() => void guard(async () => setReview(await window.agentboard.invoke('reviews:prepare-local', { cardId })))}>Preparar revisão local</button> : review.state === 'open' ? <button type="button" className="mini" onClick={() => void guard(async () => setReview(await window.agentboard.invoke('reviews:approve-local', { reviewId: review.id })))}>Aprovar revisão local</button> : <p>Revisão: <b>{review.state}</b></p>}</div>
    {error && <p className="error">{error}</p>}
  </div>
}
