import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { accountKey, accountKeyFromProvider, readAccountEmail } from './account'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
const folder = async (): Promise<string> => { const root = await mkdtemp(join(tmpdir(), 'gearmod-account-')); roots.push(root); await mkdir(root, { recursive: true }); return root }
const jwt = (payload: object): string => `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.y`

describe('readAccountEmail', () => {
  it('reads the Codex account from the id_token and the Claude account from .claude.json', async () => {
    const codex = await folder(), claude = await folder()
    await writeFile(join(codex, 'auth.json'), JSON.stringify({ tokens: { id_token: jwt({ email: 'ana@empresa.com' }) } }))
    await writeFile(join(claude, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'bia@pessoal.com' } }))
    expect(readAccountEmail({ provider: 'codex', configDir: codex })).toBe('ana@empresa.com')
    expect(readAccountEmail({ provider: 'claude', configDir: claude })).toBe('bia@pessoal.com')
  })
  it('returns null when there is no file, no token or a broken value', async () => {
    const empty = await folder(), broken = await folder()
    await writeFile(join(broken, 'auth.json'), JSON.stringify({ tokens: { id_token: 'lixo' } }))
    await writeFile(join(broken, '.claude.json'), '{ nao e json')
    expect(readAccountEmail({ provider: 'codex', configDir: empty })).toBeNull()
    expect(readAccountEmail({ provider: 'codex', configDir: broken })).toBeNull()
    expect(readAccountEmail({ provider: 'claude', configDir: broken })).toBeNull()
  })
})

describe('accountKey', () => {
  it('produz uma chave opaca estável sem preservar a identidade', () => {
    const key = accountKey('claude', 'Pessoa@Exemplo.com')!
    expect(key).toMatch(/^acct_[a-f0-9]{32}$/)
    expect(key).not.toContain('Pessoa')
    expect(key).toBe(accountKey('claude', ' pessoa@exemplo.com '))
  })
  it('aceita apenas campos explícitos do provedor', () => {
    expect(accountKeyFromProvider('codex', { account: { userId: 'u-1' } })).toBe(accountKey('codex', 'u-1'))
    expect(accountKeyFromProvider('codex', { sessionPath: 'C:/secret' })).toBeNull()
  })
})
