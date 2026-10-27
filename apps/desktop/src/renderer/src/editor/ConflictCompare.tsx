import React from 'react'
import { DiffEditor } from './DiffEditor'
import type { EditorOptions } from './base'

/** Um bloco de conflito visto de perto: lado "atual" × lado "chegando", só leitura, lado a lado. */
export function ConflictCompare({ info, path, options, back }: { info: { ours: string; theirs: string; oursLabel: string; theirsLabel: string }; path: string; options: EditorOptions; back(): void }): React.JSX.Element {
  return <div className="wf-diffview"><DiffEditor before={info.ours} after={info.theirs} path={path} layout="split" editable={false} options={options} title={`${info.oursLabel} × ${info.theirsLabel}`} onBack={back} /></div>
}
