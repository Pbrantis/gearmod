import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SecretStore } from './secrets'

describe('SecretStore', () => {
  it('stores encrypted bytes outside SQLite and rejects Linux basic_text', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentboard-secret-'))
    try {
      const crypto = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(`x:${value}`), decryptString: (value: Buffer) => value.toString().slice(2), getSelectedStorageBackend: () => 'kwallet' }
      const store = new SecretStore(join(root, 'secret'), crypto, 'win32')
      await store.write('value'); await expect(store.read()).resolves.toBe('value')
      await expect(new SecretStore(join(root, 'other'), { ...crypto, getSelectedStorageBackend: () => 'basic_text' }, 'linux').write('x')).rejects.toThrow(/cofre seguro/)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
