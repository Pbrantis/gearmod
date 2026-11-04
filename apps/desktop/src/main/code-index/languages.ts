import type { Node } from '@vscode/tree-sitter-wasm'
import { QUERIES } from './queries'

/**
 * Code index languages: WASM grammar (@vscode/tree-sitter-wasm), extensions and how to read the imports.
 * The queries are in queries.ts. Capture convention (the extractor is generic and only understands these):
 *   @def.<kind> + @name            definition (function, method, class, interface, type, enum, struct, trait, const, property, module)
 *   @owner                         on a @def.method: owning type (Go receiver); with @container: block without a symbol (Rust impl)
 *   @import                        import node, interpreted by `imports(node)`
 *   @call/@new/@jsx + @callee [+ @receiver]   call, instantiation, JSX component
 *   @type / @ref                   reference to a type / identifier passed as a value
 *   @extends / @implements         inheritance of the class that wraps the node (or of @owner)
 *   @bind.* @field.* @bindcall.* @bindexpr.* @binddestr.* @bdc.*   variables and fields with a known type
 *   @export.default / @export.local
 */
export interface ImportRecord { spec: string; local: string | null; imported: string | null; reexport?: boolean }
export type Family = 'js' | 'python' | 'go' | 'java' | 'csharp' | 'rust' | 'php' | 'ruby' | 'c'
export interface LanguageConfig {
  wasm: string
  exts: string[]
  family: Family
  imports: (node: Node) => ImportRecord[]
  exported?: (name: string) => boolean
  samePackageDir?: boolean
}

export const kids = (node: Node | null | undefined): Node[] => (node ? node.namedChildren.filter((child): child is Node => child !== null) : [])
const unquote = (node: Node | null | undefined): string => node?.text.replace(/^['"`]|['"`]$/g, '') ?? ''
const last = (text: string, sep: string): string => text.split(sep).at(-1) ?? text

function jsImports(node: Node): ImportRecord[] {
  const out: ImportRecord[] = []
  if (node.type === 'call_expression') {
    const spec = unquote(kids(node.childForFieldName('arguments'))[0])
    // const { a, b: c } = require('x')  |  const x = require('x')
    const parent = node.parent
    const decl = parent?.type === 'variable_declarator' ? parent : parent?.type === 'await_expression' && parent.parent?.type === 'variable_declarator' ? parent.parent : null
    const pattern = decl?.childForFieldName('name')
    if (pattern?.type === 'identifier') out.push({ spec, local: pattern.text, imported: '*' })
    else if (pattern?.type === 'object_pattern') {
      for (const item of kids(pattern)) {
        if (item.type === 'shorthand_property_identifier_pattern') out.push({ spec, local: item.text, imported: item.text })
        else if (item.type === 'pair_pattern') out.push({ spec, local: item.childForFieldName('value')?.text ?? null, imported: item.childForFieldName('key')?.text ?? null })
      }
    } else out.push({ spec, local: null, imported: null })
    return out
  }
  const spec = unquote(node.childForFieldName('source'))
  const specifier = (item: Node): ImportRecord => ({ spec, local: (item.childForFieldName('alias') ?? item.childForFieldName('name'))?.text ?? null, imported: item.childForFieldName('name')?.text ?? null })
  if (node.type === 'export_statement') {
    // export * from 'x' | export * as ns from 'x' | export { a, b as c } from 'x'
    const clause = kids(node).find((child) => child.type === 'export_clause')
    const namespace = kids(node).find((child) => child.type === 'namespace_export')
    if (clause) for (const item of kids(clause)) out.push({ ...specifier(item), reexport: true })
    else if (namespace) out.push({ spec, local: kids(namespace).at(-1)?.text ?? null, imported: '*', reexport: true })
    else out.push({ spec, local: '*', imported: '*', reexport: true })
    return out
  }
  const clause = kids(node).find((child) => child.type === 'import_clause')
  if (!clause) return [{ spec, local: null, imported: null }]
  for (const child of kids(clause)) {
    if (child.type === 'identifier') out.push({ spec, local: child.text, imported: 'default' })
    else if (child.type === 'namespace_import') out.push({ spec, local: kids(child).at(-1)?.text ?? null, imported: '*' })
    else if (child.type === 'named_imports') for (const item of kids(child)) if (item.type === 'import_specifier') out.push(specifier(item))
  }
  return out
}

function pyImports(node: Node): ImportRecord[] {
  const out: ImportRecord[] = []
  if (node.type === 'import_statement') {
    for (const item of kids(node)) {
      if (item.type === 'aliased_import') out.push({ spec: item.childForFieldName('name')?.text ?? '', local: item.childForFieldName('alias')?.text ?? null, imported: '*' })
      else out.push({ spec: item.text, local: item.text.split('.')[0] ?? item.text, imported: item.text.includes('.') ? 'pkg' : '*' })
    }
    return out
  }
  const moduleNode = node.childForFieldName('module_name')
  const spec = moduleNode?.text ?? ''
  for (const item of kids(node)) {
    // web-tree-sitter nodes are not the same object on each call: compare by position
    if (moduleNode && item.startIndex === moduleNode.startIndex) continue
    if (item.type === 'wildcard_import') out.push({ spec, local: '*', imported: '*', reexport: true })
    else if (item.type === 'aliased_import') out.push({ spec, local: item.childForFieldName('alias')?.text ?? null, imported: last(item.childForFieldName('name')?.text ?? '', '.') })
    else if (item.type === 'dotted_name') out.push({ spec, local: last(item.text, '.'), imported: last(item.text, '.') })
  }
  return out
}

function goImports(node: Node): ImportRecord[] {
  const specs: Node[] = []
  const walk = (item: Node): void => { if (item.type === 'import_spec') specs.push(item); else kids(item).forEach(walk) }
  walk(node)
  return specs.map((item) => {
    const spec = unquote(item.childForFieldName('path'))
    return { spec, local: item.childForFieldName('name')?.text ?? last(spec, '/').replace(/^go-|\.v\d+$/g, ''), imported: '*' }
  })
}

function javaImports(node: Node): ImportRecord[] {
  const text = node.text.replace(/^import\s+(static\s+)?/, '').replace(/;\s*$/, '').trim()
  if (text.endsWith('.*')) return [{ spec: text.slice(0, -2), local: '*', imported: '*', reexport: true }]
  return [{ spec: text, local: last(text, '.'), imported: last(text, '.') }]
}

function csImports(node: Node): ImportRecord[] {
  const name = kids(node).find((child) => child.type === 'qualified_name' || child.type === 'identifier')
  return name ? [{ spec: name.text, local: '*', imported: '*', reexport: true }] : []
}

function rustImports(node: Node): ImportRecord[] {
  // use crate::a::b::{C, d::E as F};  -> one line per name
  const out: ImportRecord[] = []
  const walk = (item: Node | null, prefix: string): void => {
    if (!item) return
    if (item.type === 'use_as_clause') { const path = item.childForFieldName('path')?.text ?? ''; out.push({ spec: prefix + path, local: item.childForFieldName('alias')?.text ?? null, imported: last(path, '::') }) }
    else if (item.type === 'scoped_use_list') walk(item.childForFieldName('list'), `${prefix}${item.childForFieldName('path')?.text ?? ''}::`)
    else if (item.type === 'use_list') for (const child of kids(item)) walk(child, prefix)
    else if (item.type === 'use_wildcard') out.push({ spec: prefix + item.text.replace(/::\*$/, ''), local: '*', imported: '*', reexport: true })
    else if (['scoped_identifier', 'identifier', 'crate', 'self', 'super'].includes(item.type)) { const path = prefix + item.text; out.push({ spec: path, local: last(path, '::'), imported: last(path, '::') }) }
  }
  walk(node.childForFieldName('argument'), '')
  return out
}

function phpImports(node: Node): ImportRecord[] {
  const out: ImportRecord[] = []
  const walk = (item: Node): void => {
    if (item.type !== 'namespace_use_clause') { kids(item).forEach(walk); return }
    const children = kids(item)
    const name = children.find((child) => child.type === 'qualified_name' || child.type === 'name')
    const alias = item.childForFieldName('alias') ?? children.find((child, index) => index > 0 && child.type === 'name')
    if (name) out.push({ spec: name.text.replace(/^\\/, ''), local: alias?.text ?? last(name.text, '\\'), imported: last(name.text, '\\') })
  }
  walk(node)
  return out
}

function rubyImports(node: Node): ImportRecord[] {
  const spec = kids(node.childForFieldName('arguments'))[0]?.text.replace(/^['"]|['"]$/g, '')
  return spec ? [{ spec: (node.childForFieldName('method')?.text === 'require_relative' ? './' : '') + spec, local: '*', imported: '*', reexport: true }] : []
}

function cImports(node: Node): ImportRecord[] {
  const path = node.childForFieldName('path')
  if (!path) return []
  const spec = path.text.replace(/^["<]|[">]$/g, '')
  return [{ spec: path.type === 'system_lib_string' ? spec : `./${spec}`, local: '*', imported: '*', reexport: true }]
}

export const LANGUAGES: Record<string, LanguageConfig> = {
  typescript: { wasm: 'typescript', exts: ['.ts', '.mts', '.cts'], imports: jsImports, family: 'js' },
  tsx: { wasm: 'tsx', exts: ['.tsx'], imports: jsImports, family: 'js' },
  javascript: { wasm: 'javascript', exts: ['.js', '.mjs', '.cjs', '.jsx'], imports: jsImports, family: 'js' },
  python: { wasm: 'python', exts: ['.py', '.pyi'], imports: pyImports, family: 'python', exported: (name) => !name.startsWith('_') },
  go: { wasm: 'go', exts: ['.go'], imports: goImports, family: 'go', samePackageDir: true, exported: (name) => /^[A-Z]/.test(name) },
  java: { wasm: 'java', exts: ['.java'], imports: javaImports, family: 'java', samePackageDir: true },
  csharp: { wasm: 'c-sharp', exts: ['.cs'], imports: csImports, family: 'csharp' },
  rust: { wasm: 'rust', exts: ['.rs'], imports: rustImports, family: 'rust' },
  php: { wasm: 'php', exts: ['.php'], imports: phpImports, family: 'php' },
  ruby: { wasm: 'ruby', exts: ['.rb'], imports: rubyImports, family: 'ruby' },
  cpp: { wasm: 'cpp', exts: ['.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh', '.hxx'], imports: cImports, family: 'c' }
}

export const queriesOf = (lang: string): string => QUERIES[lang] ?? ''
export const familyOf = (lang: string | null | undefined): Family | null => (lang ? LANGUAGES[lang]?.family ?? null : null)

const extToLang = new Map<string, string>()
for (const [lang, config] of Object.entries(LANGUAGES)) for (const ext of config.exts) extToLang.set(ext, lang)

export function langOf(path: string): string | null {
  const dot = path.lastIndexOf('.')
  return dot < 0 ? null : extToLang.get(path.slice(dot).toLowerCase()) ?? null
}

export const isTest = (path: string): boolean => /(^|\/)(__tests__|tests?|spec|e2e)\/|(^|\/)tests?\.py$|(^|\/)test_[^/]*\.py$|_test\.py$|\.(test|spec|e2e)\.[cm]?[jt]sx?$|_test\.go$|Tests?\.(cs|java)$|_spec\.rb$/.test(path)
export const isGenerated = (path: string): boolean => /(^|\/)(generated|__generated__|gen|vendor|third_party)\/|\.(min|bundle)\.js$|\.d\.ts$|\.pb\.go$|_pb2\.py$|\.g\.cs$|\.designer\.cs$/i.test(path)
