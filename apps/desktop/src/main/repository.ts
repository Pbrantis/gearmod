import { randomUUID } from 'node:crypto'
import type { Note } from '@gearmod/contracts'
import type { AppDatabase } from './database'

export class NoteRepository {
  constructor(private readonly database: AppDatabase) {}

  list(): Note[] {
    return this.database.db.prepare(`SELECT id, body, created_at AS createdAt, updated_at AS updatedAt
      FROM notes ORDER BY created_at DESC`).all() as Note[]
  }

  create(body: string): Note {
    const now = new Date().toISOString()
    const note = { id: randomUUID(), body, createdAt: now, updatedAt: now }
    this.database.db.prepare('INSERT INTO notes(id, body, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(note.id, note.body, note.createdAt, note.updatedAt)
    return note
  }

  delete(id: string): boolean {
    return this.database.db.prepare('DELETE FROM notes WHERE id = ?').run(id).changes > 0
  }
}
