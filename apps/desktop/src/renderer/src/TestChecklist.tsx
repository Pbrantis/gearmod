import React, { useState } from 'react'
import { checklistKey, type CardChecklist } from '@agentboard/contracts'
import { InlineMarkdown } from './markdown'
import { toggleChecklist } from './checklistToggle'
import { MarkBadges } from './MarkBadges'
import { plainError } from './NoticeDialog'
import { useT } from './i18n'

const itemLine = /^(\s*)[-*+]\s+\[( |x|X)\]\s+(.*)$/, headingLine = /^#{1,6}\s+(.*)$/

/** Checklist do teste no card: dá para marcar e desmarcar cada item, e cada item marcado mostra se foi você ou o agente. */
export function TestChecklist({ data }: { data: CardChecklist }): React.JSX.Element {
  const t = useT().board.testChecklist
  const [problem, setProblem] = useState('')
  const flip = (line: number, text: string, checked: boolean): void => { setProblem(''); void toggleChecklist(data.cardId, line, text, checked).catch((reason: unknown) => setProblem(plainError(reason))) }
  return <div className="testchecklist">
    {data.contentMd.split(/\r?\n/).map((raw, line) => {
      if (!raw.trim()) return null
      const item = itemLine.exec(raw)
      if (item) {
        const done = item[2] !== ' ', text = item[3]!.trim(), mark = data.marks[checklistKey(text)]
        return <div key={line} className={`tc-item ${done ? 'done' : ''} ${item[1] ? 'sub' : ''}`}>
          <button type="button" className="pg-mark sm btn" role="checkbox" aria-checked={done} aria-label={done ? t.uncheckItem(text) : t.checkItem(text)} data-tip={done ? t.uncheckTip : t.checkTip} onClick={() => flip(line, text, !done)}>{done && <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2 5 8.6l4.5-5" /></svg>}</button>
          <span className="tc-text"><InlineMarkdown text={text} /></span>
          <MarkBadges mark={mark} checked={done} />
        </div>
      }
      const heading = headingLine.exec(raw)
      return heading ? <h4 key={line} className="tc-h">{heading[1]}</h4> : <p key={line} className="tc-p"><InlineMarkdown text={raw.trim()} /></p>
    })}
    {problem && <p className="hint err" role="alert">{problem}</p>}
  </div>
}
