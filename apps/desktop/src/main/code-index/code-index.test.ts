import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CodeIndex } from './code-index'

const dirs: string[] = []
const indexes: CodeIndex[] = []
afterEach(async () => {
  for (const index of indexes.splice(0)) index.close()
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})
const temp = async (): Promise<string> => { const dir = await mkdtemp(join(tmpdir(), 'gearmod-code-index-')); dirs.push(dir); return dir }
const write = async (root: string, files: Record<string, string>): Promise<void> => {
  for (const [path, content] of Object.entries(files)) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), content) }
}
const open = async (): Promise<CodeIndex> => { const index = new CodeIndex(join(await temp(), 'index.sqlite')); indexes.push(index); return index }

const tsProject = {
  'src/history.ts': [
    '/** Histórico do card. */',
    'export class CardHistory {',
    '  record(cardId: string): void { this.versions(cardId) }',
    '  versions(cardId: string): string[] { return [cardId] }',
    '}'
  ].join('\n'),
  'src/index.ts': "export * from './history'\nexport { useDocs } from './docs'\n",
  'src/docs.ts': [
    'export function useDocs() {',
    '  const open = (path: string): string => path',
    '  return { open }',
    '}'
  ].join('\n'),
  'src/bridge.ts': [
    "import { CardHistory, useDocs } from './index'",
    'export class Bridge {',
    '  constructor(private readonly deps: { history?: CardHistory }) {}',
    '  save(cardId: string): void {',
    '    const history = this.deps.history',
    '    history?.record(cardId)',
    '    const { open } = useDocs()',
    "    open('a.md')",
    '  }',
    '}'
  ].join('\n'),
  'src/bridge.test.ts': "import { Bridge } from './bridge'\nvi.mock('./history', () => ({ record: 'CardHistory.record' }))\nnew Bridge({}).save('1')\n"
}

describe('CodeIndex', () => {
  it('links calls by field type, by re-export and by the function inside a hook', async () => {
    const root = await temp(), index = await open()
    await write(root, tsProject)
    const result = await index.index(root)
    expect(result.files).toBe(5)
    const node = index.q(root).node({ symbol: 'CardHistory.record' })
    expect(node).toContain('Bridge.save — src/bridge.ts:6')
    expect(index.q(root).node({ symbol: 'open', file: 'docs.ts' })).toContain('Bridge.save — src/bridge.ts:8')
    expect(index.q(root).node({ symbol: 'versions' })).toContain('CardHistory.record — src/history.ts:3')
  })

  it('impact lists the lines of each call, the tests and the text mentions', async () => {
    const root = await temp(), index = await open()
    await write(root, tsProject)
    await index.index(root)
    const impact = index.q(root).impact('Bridge')
    expect(impact).toContain('src/bridge.test.ts')
    const record = index.q(root).impact('record')
    expect(record).toContain('Bridge.save:4 — calls at lines 6')
    expect(record).toMatch(/Other mentions[\s\S]*src\/bridge\.test\.ts:2/)
  })

  it('explores with flow and code, and summary mode returns only where each thing is', async () => {
    const root = await temp(), index = await open()
    await write(root, tsProject)
    await index.index(root)
    const full = index.q(root).explore('Bridge.save CardHistory.record versions')
    expect(full).toContain('**Flow')
    expect(full).toContain('this.versions(cardId)')
    const summary = index.q(root).explore('Bridge.save CardHistory.record versions', { detail: 'summary' })
    expect(summary).toContain('**Where things are**')
    expect(summary).not.toContain('**Code**')
    // a search in Portuguese reaches the English name
    expect(index.q(root).search('histórico')).toContain('CardHistory')
  })

  it('Python: from package import module and self.method()', async () => {
    const root = await temp(), index = await open()
    await write(root, {
      'core/__init__.py': '',
      'core/helpers.py': 'def send(group, content):\n    return group\n',
      'core/other/helpers.py': 'def unrelated():\n    pass\n',
      'jobs/tasks.py': 'from core import helpers\nfrom core.other.helpers import unrelated\n\nclass Job:\n    def run(self):\n        helpers.send("g", {})\n        self.finish()\n\n    def finish(self):\n        unrelated()\n'
    })
    await index.index(root)
    expect(index.q(root).node({ symbol: 'send' })).toContain('Job.run — jobs/tasks.py:6')
    expect(index.q(root).node({ symbol: 'Job.finish' })).toContain('Job.run — jobs/tasks.py:7')
  })

  it("C#: using by namespace and partial class across several files; ignores Unity's Library", async () => {
    const root = await temp(), index = await open()
    await write(root, {
      'Assets/Scripts/Match.cs': 'namespace Game {\n  public partial class Match {\n    public void Start() { Spawn(); }\n  }\n}\n',
      'Assets/Scripts/MatchCreatures.cs': 'namespace Game {\n  public partial class Match {\n    void Spawn() { }\n  }\n}\n',
      'Assets/Scripts/Hud.cs': 'using Game;\nnamespace Ui {\n  public class Hud {\n    void Draw(Match match) { match.Start(); }\n  }\n}\n',
      'ProjectSettings/ProjectVersion.txt': 'm_EditorVersion: 6000',
      'Library/PackageCache/pkg/Big.cs': 'namespace Pkg { public class Big { } }'
    })
    const result = await index.index(root)
    expect(result.files).toBe(3)
    expect(index.q(root).node({ symbol: 'Match.Start' })).toContain('Ui.Hud.Draw — Assets/Scripts/Hud.cs:4')
    expect(index.q(root).node({ symbol: 'Spawn' })).toContain('Game.Match.Start — Assets/Scripts/Match.cs:3')
  })

  it('updates only what changed and reuses the analysis across folders with the same files', async () => {
    const root = await temp(), copy = await temp(), index = await open()
    await write(root, tsProject)
    await write(copy, tsProject)
    await index.index(root)
    const second = await index.index(copy)
    expect(second.parsed).toBe(0)
    expect(second.reused).toBe(5)
    await writeFile(join(root, 'src/docs.ts'), 'export function useDocs() {\n  const open = (path: string): string => path\n  return { open }\n}\nexport function brandNew(): void { useDocs() }\n')
    await unlink(join(root, 'src/bridge.test.ts'))
    const update = await index.update(root, ['src/docs.ts', 'src/bridge.test.ts'])
    expect(update).toMatchObject({ changed: 2, parsed: 1 })
    expect(index.q(root).search('brandNew')).toContain('src/docs.ts:5')
    expect(index.q(root).node({ symbol: 'useDocs' })).toContain('brandNew')
    expect(index.q(root).impact('Bridge')).not.toContain('bridge.test.ts')
    // the other folder does not change
    expect(index.q(copy).search('brandNew')).toBe('Nothing found for "brandNew".')
    await index.forget(copy)
    expect(index.has(copy)).toBe(false)
    expect(index.status(root).files).toBe(4)
  })
})
