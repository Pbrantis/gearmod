/** Messages between the main process (CodeIndexService) and the index utility process (host.ts). */
export type CodeTool = 'explore' | 'node' | 'search' | 'impact' | 'callers' | 'affected' | 'map'

export type HostRequest =
  | { op: 'init'; dbFile: string }
  | { op: 'index'; root: string; exclude?: string[] }
  | { op: 'watch'; root: string; exclude?: string[] }
  | { op: 'unwatch'; root: string }
  | { op: 'forget'; root: string }
  | { op: 'status'; root: string }
  | { op: 'tool'; root: string; tool: CodeTool; args: Record<string, unknown> }
  | { op: 'symbols'; root: string; query: string; limit?: number }
  | { op: 'outline'; root: string; file: string }
  | { op: 'definitions'; root: string; name: string; from?: string }
  | { op: 'references'; root: string; name: string; from?: string }

export type HostMessage =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string }
  | { event: 'updated'; root: string; changed: number }
