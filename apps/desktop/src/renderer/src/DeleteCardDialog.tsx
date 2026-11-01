import React, { useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog'
import { Checkbox } from './Checkbox'
import { useT } from './i18n'

/** A opção vale apenas para a pasta de artefatos gerenciada do card. */
export function DeleteCardDialog({ title, cancel, confirm }: { title: string; cancel(): void; confirm(deleteArtifacts: boolean): void }): React.JSX.Element {
  const { board: t, common } = useT()
  const [deleteArtifacts, setDeleteArtifacts] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  return <ConfirmDialog eyebrow={t.deleteCard.eyebrow} title={title || common.card} text={t.deleteCard.text} ok={common.delete} okDisabled={submitting} danger cancel={cancel} confirm={() => { setSubmitting(true); confirm(deleteArtifacts) }} extra={<label className="delete-card-artifacts"><Checkbox checked={deleteArtifacts} disabled={submitting} onChange={setDeleteArtifacts} /><span><b>{t.deleteCard.alsoArtifacts}</b><small>{t.deleteCard.alsoArtifactsHint}</small></span></label>} />
}
