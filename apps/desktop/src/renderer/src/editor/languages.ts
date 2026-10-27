import type { Extension } from '@codemirror/state'
import { StreamLanguage, type StreamParser } from '@codemirror/language'
import { extensionOf } from '../FileAppearance'

const stream = (parser: StreamParser<unknown>): Extension => StreamLanguage.define(parser)
type Loader = () => Promise<Extension>
const legacy = (load: () => Promise<StreamParser<unknown>>, line: string): Loader => async () => { const parser = await load(); return stream({ ...parser, languageData: { ...parser.languageData, commentTokens: { line } } }) }
const loaders: Record<string, Loader> = {}
const register = (extensions: string[], loader: Loader): void => { for (const extension of extensions) loaders[extension] = loader }
register(['js', 'mjs', 'cjs', 'jsx'], async () => (await import('@codemirror/lang-javascript')).javascript({ jsx: true }))
register(['ts', 'mts', 'cts'], async () => (await import('@codemirror/lang-javascript')).javascript({ typescript: true }))
register(['tsx'], async () => (await import('@codemirror/lang-javascript')).javascript({ typescript: true, jsx: true }))
register(['json', 'jsonc'], async () => (await import('@codemirror/lang-json')).json())
register(['css', 'scss', 'less'], async () => (await import('@codemirror/lang-css')).css())
register(['html', 'htm'], async () => (await import('@codemirror/lang-html')).html())
register(['md', 'mdx', 'markdown'], async () => (await import('@codemirror/lang-markdown')).markdown())
register(['py'], async () => (await import('@codemirror/lang-python')).python())
register(['sql'], async () => (await import('@codemirror/lang-sql')).sql())
register(['xml', 'svg', 'csproj'], async () => (await import('@codemirror/lang-xml')).xml())
register(['yml', 'yaml'], async () => (await import('@codemirror/lang-yaml')).yaml())
register(['sh', 'bash'], legacy(async () => (await import('@codemirror/legacy-modes/mode/shell')).shell, '#'))
register(['ps1'], legacy(async () => (await import('@codemirror/legacy-modes/mode/powershell')).powerShell, '#'))
register(['toml'], legacy(async () => (await import('@codemirror/legacy-modes/mode/toml')).toml, '#'))
register(['ini', 'conf', 'env'], legacy(async () => (await import('@codemirror/legacy-modes/mode/properties')).properties, '#'))
register(['go'], legacy(async () => (await import('@codemirror/legacy-modes/mode/go')).go, '//'))
register(['rs'], legacy(async () => (await import('@codemirror/legacy-modes/mode/rust')).rust, '//'))
register(['java'], legacy(async () => (await import('@codemirror/legacy-modes/mode/clike')).java, '//'))
register(['cs'], legacy(async () => (await import('@codemirror/legacy-modes/mode/clike')).csharp, '//'))
register(['cpp', 'h'], legacy(async () => (await import('@codemirror/legacy-modes/mode/clike')).cpp, '//'))

/** Linguagem pela extensão, carregada sob demanda para não pesar a abertura do app; `null` = texto puro. */
export async function languageFor(path: string): Promise<Extension | null> {
  const name = path.split(/[\\/]/).at(-1) ?? ''
  const load = loaders[name === '.env' || name.startsWith('.env.') ? 'env' : extensionOf(path)]
  return load ? load() : null
}

const names: Record<string, string> = { js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'JavaScript React', ts: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript', tsx: 'TypeScript React', json: 'JSON', jsonc: 'JSON', css: 'CSS', scss: 'SCSS', less: 'Less', html: 'HTML', htm: 'HTML', md: 'Markdown', mdx: 'Markdown', markdown: 'Markdown', py: 'Python', sql: 'SQL', xml: 'XML', svg: 'SVG', csproj: 'XML', yml: 'YAML', yaml: 'YAML', sh: 'Shell', bash: 'Shell', ps1: 'PowerShell', toml: 'TOML', ini: 'INI', conf: 'Configuração', env: 'Variáveis de ambiente', go: 'Go', rs: 'Rust', java: 'Java', cs: 'C#', cpp: 'C++', h: 'C/C++' }
/** Nome da linguagem para a barra de status; `Texto` quando não há realce. */
export const languageName = (path: string): string => { const name = path.split(/[\\/]/).at(-1) ?? ''; return names[name === '.env' || name.startsWith('.env.') ? 'env' : extensionOf(path)] ?? 'Texto' }
