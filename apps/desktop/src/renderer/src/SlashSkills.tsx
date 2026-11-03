import React, { useEffect, useRef, useState } from 'react'
import type { AgentProfile, SkillEntry, SkillRef } from '@gearmod/contracts'
import { useT } from './i18n'

/** Skills globais e do projeto, as do projeto primeiro (mesma ordem do menu de skills do card). */
export function useProjectSkills(projectId: string): SkillEntry[] {
  const [skills, setSkills] = useState<SkillEntry[]>([])
  useEffect(() => {
    void Promise.all([window.gearmod.invoke('skills:list', { scope: 'global' }), window.gearmod.invoke('skills:list', { scope: 'project', projectId })])
      .then(([global, local]) => setSkills([...local, ...global])).catch(() => undefined)
  }, [projectId])
  return skills
}

/**
 * Menu do "/" no campo do chat: digitar `/` lista as skills do agente e escolher uma escreve `/nome ` no texto.
 * Usado por todos os chats (card, livre e Constituição), para o comportamento ser o mesmo em todos.
 */
export function useSlashSkills({ available, provider, input, setInput, area, choose }: {
  available: SkillEntry[]
  provider: AgentProfile['provider'] | undefined
  input: string
  setInput: (value: string) => void
  area: React.RefObject<HTMLTextAreaElement | null>
  choose: (skill: SkillRef) => void
}): { caret: (at: number) => void; keyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => boolean; reset: () => void; menu: React.ReactNode } {
  const c = useT().chat.cardChat
  const [caret, setCaret] = useState(0), [index, setIndex] = useState(0), [closedAt, setClosedAt] = useState(-1)
  const slash = /(^|\s)\/([^\s/]*)$/.exec(input.slice(0, caret)), query = slash?.[2] ?? '', start = slash ? caret - query.length - 1 : -1
  const matches = slash ? available.filter((item) => `${item.name} ${item.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) : []
  const open = start !== closedAt && matches.length > 0
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (open) menuRef.current?.querySelector<HTMLElement>('.atitem.on')?.scrollIntoView({ block: 'nearest' }) }, [open, index])
  const pick = (entry: SkillEntry): void => {
    const path = provider ? entry.paths[provider] : null
    if (!path) return
    const written = `/${entry.name} `, next = input.slice(0, start) + written + input.slice(caret), at = start + written.length
    setInput(next); setCaret(at); setClosedAt(-1); choose({ name: entry.name, path })
    window.requestAnimationFrame(() => { const field = area.current; if (field) { field.focus(); field.setSelectionRange(at, at) } })
  }
  const keyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open || event.nativeEvent.isComposing) return false
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setIndex((value) => (value + (event.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length); return true }
    if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); const entry = matches[index]; if (entry) pick(entry); return true }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setClosedAt(start); return true }
    return false
  }
  const menu = open ? <div ref={menuRef} className="atmenu skillslash-menu" role="listbox" aria-label={c.availableSkills} onMouseDown={(event) => event.preventDefault()}>{matches.map((entry, position) => <button type="button" role="option" aria-selected={position === index} key={entry.id} className={`atitem ${position === index ? 'on' : ''}`} onMouseEnter={() => setIndex(position)} onClick={() => pick(entry)}><span className="skillslash-name">/{entry.name}</span><span className="atpath">{entry.description || (entry.scope === 'project' ? c.projectSkill : c.globalSkill)}</span></button>)}</div> : null
  return { caret: setCaret, keyDown, reset: () => setIndex(0), menu }
}
