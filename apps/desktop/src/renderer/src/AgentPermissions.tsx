import { useEffect, useState } from 'react'
import type { AgentPermission } from '@agentboard/contracts'

export function AgentPermissions({ chatId }: { chatId?: string }): React.JSX.Element | null {
  const [requests, setRequests] = useState<AgentPermission[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState<string>()
  useEffect(() => {
    setRequests([]); setError('')
    if (!chatId) return
    let disposed = false, revision = 0
    const load = (): void => {
      const current = ++revision
      void window.agentboard.invoke('agents:permissions', { chatId }).then((items) => { if (!disposed && current === revision) setRequests(items) }).catch((reason: unknown) => { if (!disposed) setError(String(reason)) })
    }
    const off = window.agentboard.onRunEvent((event) => { if (event.eventType.startsWith('agentboard/permission-') && event.payload.chatId === chatId) load() })
    load()
    return () => { disposed = true; off() }
  }, [chatId])
  const decide = async (request: AgentPermission, allow: boolean): Promise<void> => {
    setBusy(request.id); setError('')
    try {
      const result = await window.agentboard.invoke('agents:permission-decide', { runId: request.runId, requestId: request.id, allow })
      setRequests((items) => items.filter((item) => item.id !== request.id))
      if (!result.decided) setError('Esta solicitação já foi respondida ou a execução encerrou.')
    } catch (reason) { setError(String(reason)) } finally { setBusy(undefined) }
  }
  if (!requests.length && !error) return null
  return <div aria-live="polite">{requests.map((request) => <article className="msg system" key={request.id}>
    <b>{request.provider === 'claude' ? 'Claude' : 'Codex'} pede permissão</b>
    <PermissionAction request={request} />
    <div className="cx-actions"><button type="button" className="mini" disabled={Boolean(busy)} onClick={() => void decide(request, true)}>Aprovar esta ação</button><button type="button" className="mini secondary" disabled={Boolean(busy)} onClick={() => void decide(request, false)}>Negar</button></div>
  </article>)}{error && <p role="alert">{error}</p>}</div>
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const readable = (value: unknown): string => typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? ''
const codeStyle = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 240, overflow: 'auto' } as const

function PermissionAction({ request }: { request: AgentPermission }): React.JSX.Element {
  const data = request.details, input = record(data.input), item = record(data.item)
  const command = data.command ?? input.command
  const reason = data.reason ?? data.description ?? data.decision_reason
  const cwd = data.cwd ?? input.cwd
  const path = input.file_path ?? input.path
  const changes = Array.isArray(item.changes) ? item.changes.map(record) : []
  const title = command ? 'Executar comando' : request.kind.includes('permissions/') ? 'Ampliar acesso durante este turno' : request.kind.includes('fileChange') || request.kind === 'applyPatchApproval' ? 'Alterar arquivos' : ({ Write: 'Gravar arquivo', Edit: 'Editar arquivo', Read: 'Ler arquivo', Bash: 'Executar comando' }[request.kind] ?? request.kind)
  return <>
    <p><strong>{title}</strong>{reason ? <><br />{readable(reason)}</> : null}</p>
    {command ? <pre style={codeStyle}>{Array.isArray(command) ? command.map(readable).join(' ') : readable(command)}</pre> : null}
    {cwd ? <p>Pasta: <code>{readable(cwd)}</code></p> : null}
    {path ? <p>Arquivo: <code>{readable(path)}</code></p> : null}
    {data.grantRoot ? <p>Acesso solicitado à pasta: <code>{readable(data.grantRoot)}</code></p> : null}
    {input.content !== undefined ? <details><summary>Conteúdo a gravar</summary><pre style={codeStyle}>{readable(input.content)}</pre></details> : null}
    {input.old_string !== undefined ? <details><summary>Substituição solicitada</summary><p>Trecho atual</p><pre style={codeStyle}>{readable(input.old_string)}</pre><p>Novo trecho</p><pre style={codeStyle}>{readable(input.new_string)}</pre></details> : null}
    {changes.map((change, index) => <details key={index}><summary>{readable(change.path ?? 'Arquivo alterado')}</summary><pre style={codeStyle}>{readable(change.diff ?? change)}</pre></details>)}
    {data.permissions ? <details open><summary>Acessos solicitados</summary><pre style={codeStyle}>{readable(data.permissions)}</pre></details> : null}
    <details><summary>Todos os detalhes da solicitação</summary><pre style={codeStyle}>{JSON.stringify(data, null, 2)}</pre></details>
  </>
}
