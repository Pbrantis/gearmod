import React from 'react'
import type { IpcInput } from '@agentboard/contracts'
import { pop, type PopKind } from './popout'
import { WindowLayoutMenu } from './WindowLayoutMenu'
export interface PopTarget { kind: PopKind; projectId: string; cardId?: string | undefined; chatId?: string | undefined; purpose?: IpcInput<'windows:open'>['purpose'] }
export function PopMenu({ target, className = '' }: { target: PopTarget; className?: string }): React.JSX.Element {
  return <WindowLayoutMenu className={className}
    move={(placement) => { if (pop) void window.agentboard.invoke('windows:place', { placement }); else void window.agentboard.invoke('windows:open', { ...target, placement }) }}
    detach={!pop ? () => void window.agentboard.invoke('windows:open', { ...target, placement: 'new' }) : undefined}
    closeWindow={pop ? () => window.close() : undefined} />
}
