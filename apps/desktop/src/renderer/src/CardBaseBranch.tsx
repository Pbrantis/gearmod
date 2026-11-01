import React, { useEffect, useState } from 'react'
import { plainError } from './NoticeDialog'
import { Select } from './Select'
import { useT } from './i18n'

const overrideKey = (cardId: string): string => `agentboard.card-base-override.${cardId}`

export function CardBaseBranch({ cardId }: { cardId: string }): React.JSX.Element | null {
  const t = useT().board
  const [info, setInfo] = useState<{ branches: string[]; current: string | null; selected: string | null; locked: boolean }>(), [error, setError] = useState('')
  useEffect(() => { void window.agentboard.invoke('cards:branches', { cardId }).then(async (value) => {
    // Cartões antigos herdavam a branch atual do primeiro repositório. Sem uma escolha explícita do usuário,
    // migra-os para a base que está configurada no SDD.
    const overridden = localStorage.getItem(overrideKey(cardId)) === 'true'
    if (!overridden && !value.locked && value.current && value.branches.includes(value.current) && value.selected !== value.current) {
      await window.agentboard.invoke('cards:set-base-branch', { cardId, branch: value.current }); value = { ...value, selected: value.current }
    }
    setInfo(value)
  }).catch((e) => setError(plainError(e))) }, [cardId])
  if (!info) return error ? <span className="error">{error}</span> : null
  const selected = info.selected ?? info.current ?? ''
  const change = (branch: string): void => { void window.agentboard.invoke('cards:set-base-branch', { cardId, branch }).then(() => { localStorage.setItem(overrideKey(cardId), 'true'); setInfo({ ...info, selected: branch }); setError('') }).catch((reason) => setError(plainError(reason))) }
  return <span className="ctxchip ctxbranch"><span>{t.baseBranch.base}</span><Select className="ctxbranch-select" label={t.baseBranch.cardBaseBranch} disabled={info.locked} value={selected} options={info.branches.map((branch) => ({ value: branch, label: branch }))} onChange={change} />{error && <span className="error">{error}</span>}</span>
}
