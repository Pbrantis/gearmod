/** Layout em janelas da tela de banco: árvore de divisões (linha/coluna) cujas folhas são painéis com abas. */
export type WsTab = { id: string; kind: 'sql' | 'table'; name: string; oid?: number; sql?: string; connectionId?: string }
export type WsPane = { type: 'pane'; id: string; tabs: WsTab[]; active: string }
export type WsSplit = { type: 'split'; id: string; dir: 'row' | 'col'; sizes: number[]; children: WsNode[] }
export type WsNode = WsPane | WsSplit
export type DropZone = 'center' | 'left' | 'right' | 'top' | 'bottom'

const uid = (): string => crypto.randomUUID().slice(0, 8)
/** Abas de tabela com alterações ainda não enviadas; fechar uma delas pede confirmação. */
export const dirtyTabs = new Set<string>()
/** Próximo número de console SQL, olhando as abas que já existem (o contador não volta a 2 depois de recarregar). */
export const nextSqlNumber = (node: WsNode): number => Math.max(1, ...panesOf(node).flatMap((pane) => pane.tabs).filter((tab) => tab.kind === 'sql').map((tab) => tab.name === 'SQL' ? 1 : Number(/^SQL (\d+)$/.exec(tab.name)?.[1] ?? 0))) + 1
export const sqlTab = (n: number, connectionId?: string): WsTab => ({ id: `sql-${uid()}`, kind: 'sql', name: n > 1 ? `SQL ${n}` : 'SQL', sql: 'SELECT 1;', ...(connectionId ? { connectionId } : {}) })
/** Cada aba de tabela é do banco (conexão) em que foi aberta; o mesmo oid pode existir em bancos diferentes. */
export const tableTab = (oid: number, name: string, connectionId?: string): WsTab => ({ id: connectionId ? `t-${connectionId}-${oid}` : `t-${oid}`, kind: 'table', oid, name, ...(connectionId ? { connectionId } : {}) })
export const newPane = (tabs: WsTab[]): WsPane => ({ type: 'pane', id: uid(), tabs, active: tabs[0]!.id })
export const defaultLayout = (tables: WsTab[] = []): WsNode => newPane([sqlTab(1), ...tables])

export const panesOf = (node: WsNode): WsPane[] => node.type === 'pane' ? [node] : node.children.flatMap(panesOf)
export const findTab = (node: WsNode, tabId: string): { pane: WsPane; tab: WsTab } | undefined => { for (const pane of panesOf(node)) { const tab = pane.tabs.find((item) => item.id === tabId); if (tab) return { pane, tab } } }
const mapNode = (node: WsNode, fn: (node: WsNode) => WsNode): WsNode => fn(node.type === 'pane' ? node : { ...node, children: node.children.map((child) => mapNode(child, fn)) })
const mapPane = (root: WsNode, paneId: string, fn: (pane: WsPane) => WsNode): WsNode => mapNode(root, (node) => node.type === 'pane' && node.id === paneId ? fn(node) : node)

/** Remove painéis vazios, colapsa divisões de um filho só, funde divisões aninhadas na mesma direção e renormaliza os tamanhos. */
export function normalize(node: WsNode): WsNode | undefined {
  if (node.type === 'pane') return node.tabs.length ? { ...node, active: node.tabs.some((tab) => tab.id === node.active) ? node.active : node.tabs[0]!.id } : undefined
  const kept: Array<{ node: WsNode; size: number }> = []
  node.children.forEach((child, index) => { const next = normalize(child); if (next) kept.push({ node: next, size: node.sizes[index] ?? 1 / node.children.length }) })
  if (!kept.length) return undefined
  if (kept.length === 1) return kept[0]!.node
  const flat: Array<{ node: WsNode; size: number }> = []
  for (const item of kept) {
    if (item.node.type === 'split' && item.node.dir === node.dir) { const total = item.node.sizes.reduce((sum, value) => sum + value, 0) || 1; item.node.children.forEach((child, i) => flat.push({ node: child, size: item.size * (item.node as WsSplit).sizes[i]! / total })) }
    else flat.push(item)
  }
  const sum = flat.reduce((total, item) => total + item.size, 0) || 1
  return { ...node, children: flat.map((item) => item.node), sizes: flat.map((item) => item.size / sum) }
}
const fix = (node: WsNode): WsNode => normalize(node) ?? defaultLayout()

export function activate(root: WsNode, paneId: string, tabId: string): WsNode { return mapPane(root, paneId, (pane) => ({ ...pane, active: tabId })) }
/** Abre uma aba no painel indicado; se ela já existe em algum painel, só a ativa. */
export function openTab(root: WsNode, tab: WsTab, paneId?: string): WsNode {
  const found = findTab(root, tab.id)
  if (found) return activate(root, found.pane.id, tab.id)
  const target = panesOf(root).find((pane) => pane.id === paneId) ?? panesOf(root)[0]!
  return mapPane(root, target.id, (pane) => ({ ...pane, tabs: [...pane.tabs, tab], active: tab.id }))
}
export function closeTab(root: WsNode, tabId: string): WsNode {
  return fix(mapNode(root, (node) => {
    if (node.type !== 'pane' || !node.tabs.some((tab) => tab.id === tabId)) return node
    const index = node.tabs.findIndex((tab) => tab.id === tabId), tabs = node.tabs.filter((tab) => tab.id !== tabId)
    return { ...node, tabs, active: node.active === tabId ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? '') : node.active }
  }))
}
/** Troca o banco em que a aba de SQL executa. */
export function setTabConnection(root: WsNode, tabId: string, connectionId: string): WsNode { return mapNode(root, (node) => node.type === 'pane' && node.tabs.some((tab) => tab.id === tabId) ? { ...node, tabs: node.tabs.map((tab) => tab.id === tabId ? { ...tab, connectionId } : tab) } : node) }
/** Fecha todas as abas dos bancos informados (banco removido da lista). */
export function dropConnections(root: WsNode, ids: string[]): WsNode {
  return panesOf(root).flatMap((pane) => pane.tabs).filter((tab) => tab.connectionId && ids.includes(tab.connectionId)).reduce((current, tab) => closeTab(current, tab.id), root)
}
export function setSql(root: WsNode, tabId: string, sql: string): WsNode { return mapNode(root, (node) => node.type === 'pane' && node.tabs.some((tab) => tab.id === tabId) ? { ...node, tabs: node.tabs.map((tab) => tab.id === tabId ? { ...tab, sql } : tab) } : node) }
export function resize(root: WsNode, splitId: string, sizes: number[]): WsNode { return mapNode(root, (node) => node.type === 'split' && node.id === splitId ? { ...node, sizes } : node) }

/** Põe a aba no painel indicado, antes da aba `beforeId` (ou no fim): reordena dentro do painel ou traz de outro. */
export function placeTab(root: WsNode, tabId: string, paneId: string, beforeId?: string): WsNode {
  const found = findTab(root, tabId); if (!found || beforeId === tabId) return root
  const removed = mapNode(root, (node) => node.type === 'pane' && node.id === found.pane.id ? { ...node, tabs: node.tabs.filter((tab) => tab.id !== tabId), active: node.active === tabId ? (node.tabs.find((tab) => tab.id !== tabId)?.id ?? '') : node.active } : node)
  return fix(mapPane(removed, paneId, (pane) => {
    const tabs = pane.tabs.filter((tab) => tab.id !== tabId), at = beforeId ? tabs.findIndex((tab) => tab.id === beforeId) : -1
    tabs.splice(at < 0 ? tabs.length : at, 0, found.tab)
    return { ...pane, tabs, active: tabId }
  }))
}
/** Move a aba para outro painel (centro) ou divide o painel de destino na borda escolhida. */
export function moveTab(root: WsNode, tabId: string, paneId: string, zone: DropZone): WsNode {
  const found = findTab(root, tabId); if (!found) return root
  if (found.pane.id === paneId && (zone === 'center' || found.pane.tabs.length === 1)) return activate(root, paneId, tabId)
  const removed = mapNode(root, (node) => node.type === 'pane' && node.id === found.pane.id ? { ...node, tabs: node.tabs.filter((tab) => tab.id !== tabId), active: node.active === tabId ? (node.tabs.find((tab) => tab.id !== tabId)?.id ?? '') : node.active } : node)
  const placed = mapPane(removed, paneId, (pane) => {
    if (zone === 'center') return { ...pane, tabs: [...pane.tabs, found.tab], active: tabId }
    const fresh = newPane([found.tab]), before = zone === 'left' || zone === 'top'
    return { type: 'split', id: uid(), dir: zone === 'left' || zone === 'right' ? 'row' : 'col', sizes: [0.5, 0.5], children: before ? [fresh, pane] : [pane, fresh] }
  })
  return fix(placed)
}

const isTab = (value: unknown): value is WsTab => typeof value === 'object' && value !== null && typeof (value as WsTab).id === 'string' && ((value as WsTab).kind === 'sql' || (value as WsTab).kind === 'table') && typeof (value as WsTab).name === 'string' && ((value as WsTab).kind === 'sql' || Number.isSafeInteger((value as WsTab).oid)) && ((value as WsTab).connectionId === undefined || typeof (value as WsTab).connectionId === 'string')
/** Valida um layout salvo no armazenamento local; devolve undefined se estiver corrompido. */
export function parseLayout(value: unknown, depth = 0): WsNode | undefined {
  if (typeof value !== 'object' || value === null || depth > 8) return undefined
  const item = value as Record<string, unknown>
  if (item.type === 'pane') {
    if (typeof item.id !== 'string' || typeof item.active !== 'string' || !Array.isArray(item.tabs)) return undefined
    const tabs = item.tabs.filter(isTab).slice(0, 50).map((tab) => ({ id: tab.id, kind: tab.kind, name: tab.name, ...(tab.oid !== undefined ? { oid: tab.oid } : {}), ...(tab.connectionId ? { connectionId: tab.connectionId.slice(0, 64) } : {}), ...(typeof tab.sql === 'string' ? { sql: tab.sql.slice(0, 200000) } : {}) }))
    return normalize({ type: 'pane', id: item.id, tabs, active: item.active })
  }
  if (item.type !== 'split' || typeof item.id !== 'string' || (item.dir !== 'row' && item.dir !== 'col') || !Array.isArray(item.children) || !Array.isArray(item.sizes) || item.children.length > 8) return undefined
  const children = item.children.map((child) => parseLayout(child, depth + 1))
  if (children.some((child) => !child) || item.sizes.length !== children.length || item.sizes.some((size) => typeof size !== 'number' || !(size > 0))) return undefined
  return normalize({ type: 'split', id: item.id, dir: item.dir, sizes: item.sizes as number[], children: children as WsNode[] })
}
