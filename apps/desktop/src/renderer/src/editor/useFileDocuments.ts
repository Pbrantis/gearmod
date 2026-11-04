import { useCallback, useEffect, useRef, useState } from 'react'
import { plainError } from '../NoticeDialog'
import { useAsk } from '../useAsk'
import { fileKind } from '../FileAppearance'
import { fromDisk, isMarkdown, nameOf, slashed, type Document } from './documents'
import { withEol } from './position'
import { tr } from '../i18n'

/**
 * Open documents of a project/card: read (`workspace:read`), save with `expected`, reload, the diff's "before" and autosave.
 * Files mode keeps several (tabs); the chat panel keeps just one.
 */
export function useFileDocuments({ projectId, cardId, autosave, diffFirst, readOnlyChatId }: { projectId: string; cardId: string | null; autosave: boolean; diffFirst(path: string): boolean; readOnlyChatId?: string | undefined }): {
  documents: Document[]; setDocuments: React.Dispatch<React.SetStateAction<Document[]>>; latest: React.MutableRefObject<Document[]>; active: string; setActive(path: string): void; current: Document | undefined
  loading: boolean; setLoading(value: boolean): void; error: string; setError(value: string): void
  update(path: string, patch: Partial<Document>): void; save(path: string): Promise<boolean>; open(path: string, options?: { transient?: boolean }): Promise<string | undefined>; reload(path: string): Promise<void>; dialog: React.ReactNode
} {
  const context = { projectId, cardId }
  const [documents, setDocuments] = useState<Document[]>([]), [active, setActive] = useState(''), [loading, setLoading] = useState(false), [error, setError] = useState('')
  const latest = useRef(documents), loadingId = useRef(0), pending = useRef(new Set<string>()), diff = useRef(diffFirst)
  latest.current = documents; diff.current = diffFirst
  const current = documents.find((item) => item.path === active)
  /** Editing the text (without a new `saved` coming along, which is a reload from disk) pins the temporary tab. */
  const update = useCallback((path: string, patch: Partial<Document>): void => { const pins = 'content' in patch && !('saved' in patch) && !('transient' in patch); setDocuments((all) => all.map((item) => item.path === path ? { ...item, ...patch, ...(pins ? { transient: false } : {}) } : item)) }, [])
  const save = useCallback(async (path: string): Promise<boolean> => {
    const file = latest.current.find((item) => item.path === path)
    if (!file) return false
    if (file.content === file.saved) return true
    if (file.binary || file.truncated || file.locked) return false
    if (pending.current.has(path)) return false
    pending.current.add(path)
    try {
      const text = withEol(file.content, file.eol)
      await window.gearmod.invoke('workspace:write', { projectId, cardId, path, content: text, expected: file.disk })
      setDocuments((all) => all.map((item) => item.path === path ? { ...item, saved: file.content, disk: text, error: '', transient: false } : item)); return true
    } catch (reason) { update(path, { error: plainError(reason) }); return false }
    finally { pending.current.delete(path) }
  }, [projectId, cardId, update])
  const open = useCallback(async (path: string, options?: { transient?: boolean }): Promise<string | undefined> => {
    const transient = Boolean(options?.transient), existing = latest.current.find((item) => item.path === path)
    if (existing) { if (!transient && existing.transient) update(existing.path, { transient: false }); setActive(existing.path); return existing.path }
    const id = ++loadingId.current; setLoading(true); setError('')
    try {
      const file = await window.gearmod.invoke('workspace:read', { projectId, cardId, path })
      const opened: Document = { ...fromDisk(file), preview: isMarkdown(file.path) || fileKind(file.path) === 'image', error: '', diffView: diff.current(file.path), transient }
      // Temporary tab: the previous one (if untouched) gives way to the new one, in the same position.
      setDocuments((all) => { if (all.some((item) => item.path === file.path)) return all; const at = transient ? all.findIndex((item) => item.transient && item.content === item.saved) : -1; return at < 0 ? [...all, opened] : all.map((item, index) => index === at ? opened : item) }); if (id === loadingId.current) setActive(file.path)
      return file.path
    } catch (reason) {
      // Path the agent cited that is outside the project roots: if the chat can read it, opens it read-only.
      if (readOnlyChatId) {
        try {
          const file = await window.gearmod.invoke('files:read', { chatId: readOnlyChatId, path })
          setDocuments((all) => all.some((item) => item.path === file.path) ? all : [...all, { ...fromDisk(file), preview: isMarkdown(file.path), error: '', locked: true }]); if (id === loadingId.current) setActive(file.path)
          return file.path
        } catch { /* keeps the original error */ }
      }
      if (id === loadingId.current) setError(plainError(reason))
    }
    finally { if (id === loadingId.current) setLoading(false) }
    return undefined
  }, [projectId, cardId, readOnlyChatId, update])
  const { ask, dialog } = useAsk()
  const reload = useCallback(async (path: string): Promise<void> => {
    const document = latest.current.find((item) => item.path === path)
    if (document && document.content !== document.saved && !(await ask({ eyebrow: tr().files.editor.documents.reloadEyebrow, title: tr().files.workspace.discardTitle, text: tr().files.editor.documents.reloadText(nameOf(path)), ok: tr().files.workspace.discard, danger: true }))) return
    setLoading(true)
    try { const file = await window.gearmod.invoke('workspace:read', { projectId, cardId, path }); if (document) update(path, { ...fromDisk(file), error: '' }); else await open(path) } catch (reason) { setError(plainError(reason)) } finally { setLoading(false) }
  }, [projectId, cardId, update, open, ask])
  // The diff's "before" comes from Git once per open file.
  useEffect(() => {
    if (!current?.diffView || current.versions) return
    const path = current.path; let alive = true
    void window.gearmod.invoke('workspace:versions', { ...context, path }).then((versions) => { if (alive) update(path, { versions }) }).catch((reason) => { if (alive) update(path, { diffView: false, error: plainError(reason) }) })
    return () => { alive = false }
  }, [current?.diffView, current?.path, Boolean(current?.versions)])
  useEffect(() => {
    if (!autosave) return
    const timer = window.setTimeout(() => { documents.filter((item) => item.content !== item.saved && !item.error).forEach((item) => { void save(item.path) }) }, 800)
    return () => window.clearTimeout(timer)
  }, [documents, autosave, save])
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent): void => { if (latest.current.some((item) => item.content !== item.saved)) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', unload); return () => window.removeEventListener('beforeunload', unload)
  }, [])
  // Open files are watched: what the agent (or another program) writes shows up here without needing a reload.
  const watchId = useRef(crypto.randomUUID()), noticeTimers = useRef(new Map<string, number>())
  const paths = documents.filter((item) => !item.locked).map((item) => item.path).join('\n')
  useEffect(() => { void window.gearmod.invoke('workspace:watch', { projectId, cardId, watchId: watchId.current, paths: paths ? paths.split('\n') : [] }).catch(() => undefined) }, [paths, projectId, cardId])
  useEffect(() => () => { void window.gearmod.invoke('workspace:watch', { projectId, cardId, watchId: watchId.current, paths: [] }).catch(() => undefined) }, [projectId, cardId])
  const sync = useCallback(async (path: string, deleted = false): Promise<void> => {
    const file = latest.current.find((item) => item.path === path)
    if (!file || file.locked || pending.current.has(path)) return
    if (deleted) { update(path, { deleted: true }); return }
    let read: Awaited<ReturnType<typeof window.gearmod.invoke<'workspace:read'>>>
    try { read = await window.gearmod.invoke('workspace:read', { projectId, cardId, path }) } catch { update(path, { deleted: true }); return }
    const now = latest.current.find((item) => item.path === path)
    if (!now || pending.current.has(path) || read.truncated || read.binary) return
    const disk = fromDisk(read)
    if (disk.disk === now.disk) { if (now.deleted) update(path, { deleted: false }); return }
    if (disk.content === now.content) { update(path, { saved: disk.saved, disk: disk.disk, eol: disk.eol, conflict: undefined, deleted: false }); return }
    if (now.content === now.saved) {
      update(path, { ...disk, conflict: undefined, deleted: false, notice: tr().files.editor.documents.updatedOutside })
      window.clearTimeout(noticeTimers.current.get(path)); noticeTimers.current.set(path, window.setTimeout(() => update(path, { notice: undefined }), 3000))
    } else update(path, { conflict: { content: disk.content, disk: disk.disk, eol: disk.eol }, deleted: false })
  }, [projectId, cardId, update])
  const syncAll = useCallback((): void => { for (const item of latest.current) void sync(item.path) }, [sync])
  useEffect(() => window.gearmod.onRunEvent((event) => {
    if (event.eventType === 'gearmod/file-changed') { const payload = event.payload as { path: string; deleted?: boolean }; const match = latest.current.find((item) => slashed(item.path) === slashed(payload.path)); if (match) void sync(match.path, Boolean(payload.deleted)) }
    else if (event.eventType === 'gearmod/run-completed') syncAll()
  }), [sync, syncAll])
  // `fs.watch` sometimes misses events (on Windows, mostly): returning to the window checks everything again.
  useEffect(() => { window.addEventListener('focus', syncAll); return () => window.removeEventListener('focus', syncAll) }, [syncAll])
  return { documents, setDocuments, latest, active, setActive, current, loading, setLoading, error, setError, update, save, open, reload, dialog }
}
