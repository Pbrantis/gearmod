import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { tm } from './i18n'

export type SecureStorage = {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
  getSelectedStorageBackend?: () => string
}

/** Files encrypted by Electron's OS-backed storage; never put secret values in SQLite. */
export class SecretStore {
  constructor(private readonly file: string, private readonly storage: SecureStorage, private readonly platform = process.platform) {}

  private available(): boolean {
    if (!this.storage.isEncryptionAvailable()) return false
    return this.platform !== 'linux' || this.storage.getSelectedStorageBackend?.() !== 'basic_text'
  }

  async read(): Promise<string | null> {
    if (!existsSync(this.file)) return null
    if (!this.available()) throw new Error(tm().secrets.noSecureVault)
    return this.storage.decryptString(await readFile(this.file))
  }

  async write(value: string | null): Promise<void> {
    if (!value) { await rm(this.file, { force: true }); return }
    if (!this.available()) throw new Error(tm().secrets.noSecureVault)
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(this.file, this.storage.encryptString(value), { mode: 0o600 })
  }
}
