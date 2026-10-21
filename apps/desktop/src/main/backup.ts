import { createHash, randomBytes } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type Database from 'better-sqlite3'
import type { BackupSummary } from '@agentboard/contracts'

interface BackupManifest extends BackupSummary {
  databaseFile: string
  databaseSha256: string
  attachmentsDirectory: string
}

export class BackupService {
  constructor(
    private readonly dataDir: string,
    private readonly appVersion: string,
    private readonly retention = 3
  ) {}

  get backupRoot(): string { return join(this.dataDir, 'backups') }
  get attachmentsDir(): string { return join(this.dataDir, 'attachments') }

  async create(db: Database.Database, reason: string): Promise<BackupSummary> {
    await mkdir(this.backupRoot, { recursive: true })
    await mkdir(this.attachmentsDir, { recursive: true })
    const free = await this.freeSpace(this.backupRoot)
    const dbSize = (await stat(db.name)).size
    if (free !== undefined && free < dbSize * 2 + 10 * 1024 * 1024) throw new Error('Insufficient free space for a safe backup')
    db.pragma('wal_checkpoint(PASSIVE)')
    const id = `upgrade-${new Date().toISOString().replace(/:/g, '.')}-${randomBytes(4).toString('hex')}`
    const target = join(this.backupRoot, id)
    const temp = `${target}.partial`
    await mkdir(temp, { recursive: false })
    const databaseFile = 'agentboard.sqlite'
    try {
      await db.backup(join(temp, databaseFile))
      await cp(this.attachmentsDir, join(temp, 'attachments'), { recursive: true, force: false })
      const schemaVersion = (db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get() as { version: number }).version
      const manifest: BackupManifest = {
        id, createdAt: new Date().toISOString(), schemaVersion, appVersion: this.appVersion, reason,
        databaseFile, databaseSha256: await sha256(join(temp, databaseFile)), attachmentsDirectory: 'attachments'
      }
      await writeFile(join(temp, 'manifest.json'), JSON.stringify(manifest, null, 2), { encoding: 'utf8', flag: 'wx' })
      await rename(temp, target)
      await this.prune()
      return summary(manifest)
    } catch (error) {
      await rm(temp, { recursive: true, force: true })
      throw error
    }
  }

  async list(): Promise<BackupSummary[]> {
    await mkdir(this.backupRoot, { recursive: true })
    const entries = await readdir(this.backupRoot, { withFileTypes: true })
    const manifests = await Promise.all(entries.filter((entry) => entry.isDirectory() && !entry.name.endsWith('.partial')).map(async (entry) => {
      try { return summary(JSON.parse(await readFile(join(this.backupRoot, entry.name, 'manifest.json'), 'utf8')) as BackupManifest) }
      catch { return undefined }
    }))
    return manifests.filter((item): item is BackupSummary => item !== undefined).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async restore(backupId: string, databasePath: string): Promise<void> {
    const source = join(this.backupRoot, backupId)
    if (basename(source) !== backupId) throw new Error('Invalid backup id')
    const manifest = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8')) as BackupManifest
    const backupDb = join(source, manifest.databaseFile)
    if (await sha256(backupDb) !== manifest.databaseSha256) throw new Error('Backup checksum mismatch')
    const restoreDb = `${databasePath}.restore`
    const oldDb = `${databasePath}.before-restore`
    await rm(restoreDb, { force: true })
    await cp(backupDb, restoreDb, { force: false })
    const currentExists = await stat(databasePath).then(() => true, () => false)
    if (currentExists) await rename(databasePath, oldDb)
    try {
      await rename(restoreDb, databasePath)
      await rm(join(this.attachmentsDir), { recursive: true, force: true })
      await cp(join(source, manifest.attachmentsDirectory), this.attachmentsDir, { recursive: true })
      await rm(oldDb, { force: true })
    } catch (error) {
      await rm(databasePath, { force: true })
      if (currentExists) await rename(oldDb, databasePath)
      throw error
    }
  }

  private async prune(): Promise<void> {
    const backups = await this.list()
    for (const old of backups.slice(Math.max(3, this.retention))) {
      await rm(join(this.backupRoot, old.id), { recursive: true, force: true })
    }
  }

  private async freeSpace(path: string): Promise<number | undefined> {
    try { const value = await statfs(path); return value.bavail * value.bsize }
    catch { return undefined }
  }
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

function summary(manifest: BackupManifest): BackupSummary {
  return { id: manifest.id, createdAt: manifest.createdAt, schemaVersion: manifest.schemaVersion, appVersion: manifest.appVersion, reason: manifest.reason }
}
