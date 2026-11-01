import React, { useRef, useState } from 'react'
import { tr, useT } from './i18n'

const size = 96

/** Reduz a imagem escolhida para um quadrado de 96px (recorte central) e devolve um PNG em data URL: leve para guardar no banco. */
async function shrink(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error(tr().settings.icon.notImage)
  // Lê como data URL: a política de segurança da página só aceita imagens `data:` (uma URL `blob:` era bloqueada).
  const url = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error(tr().settings.icon.cannotRead)); reader.readAsDataURL(file) })
  const image = await new Promise<HTMLImageElement>((resolve, reject) => { const item = new Image(); item.onload = () => resolve(item); item.onerror = () => reject(new Error(tr().settings.icon.cannotOpen)); item.src = url })
  const side = Math.min(image.naturalWidth, image.naturalHeight)
  const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size
  const context = canvas.getContext('2d')
  if (!context || !side) throw new Error(tr().settings.icon.cannotOpen)
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, size, size)
  return canvas.toDataURL('image/png')
}

/** Ícone do projeto na barra lateral: a imagem escolhida ou, sem ela, a inicial do nome. */
export function ProjectAvatar({ name, icon }: { name: string; icon: string | null | undefined }): React.JSX.Element {
  return <i className={icon ? 'img' : undefined}>{icon ? <img src={icon} alt="" draggable={false} /> : name.trim()[0]?.toUpperCase() ?? '·'}</i>
}

/** Escolher, trocar ou remover o ícone do projeto (criar projeto e configurações). */
export function ProjectIconPicker({ name, icon, onChange, compact = false }: { name: string; icon: string | null; onChange(icon: string | null): void; compact?: boolean }): React.JSX.Element {
  const t = useT(), ti = t.settings.icon
  const input = useRef<HTMLInputElement>(null), [error, setError] = useState('')
  const pick = async (file: File | undefined): Promise<void> => {
    if (!file) return
    try { setError(''); onChange(await shrink(file)) } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  const choose = <button type="button" className="iconprev editable" aria-label={icon ? ti.changeAria : ti.chooseAria} data-tip={error || (icon ? ti.changeTip : ti.chooseTip)} onClick={() => input.current?.click()}><ProjectAvatar name={name || 'P'} icon={icon} /><span className="iconedit" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></svg></span></button>
  const file = <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = '' }} />
  if (compact) return <span className="iconpick compact">{choose}{icon && <button type="button" className="iconremove" aria-label={ti.removeAria} data-tip={ti.removeTip} onClick={() => onChange(null)}>×</button>}{file}{error && <span className="iconpick-error" role="status">{error}</span>}</span>
  return <div className="f"><span>{ti.label}</span>
    <div className="iconpick">
      {choose}
      {icon && <button type="button" className="mini secondary" onClick={() => onChange(null)}>{t.common.remove}</button>}
      <small className="hint">{error || ti.formats}</small>
      {file}
    </div>
  </div>
}
