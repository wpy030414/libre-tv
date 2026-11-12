import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * 本地库（离线下载归档）。用内置 node:sqlite，零外部依赖。
 * 表结构与 drizzle/sqlite 迁移保持同口径，未来可平滑切到 drizzle。
 */
export interface LibraryDb {
  db: DatabaseSync
  /** 下载文件根目录 */
  mediaDir: string
}

export function openLibraryDb(dataDir = 'data'): LibraryDb {
  const root = resolve(dataDir)
  const mediaDir = join(root, 'media')
  mkdirSync(mediaDir, { recursive: true })
  mkdirSync(join(mediaDir, 'covers'), { recursive: true })

  const db = new DatabaseSync(join(root, 'library.db'))
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS library (
      key           TEXT PRIMARY KEY,
      source        TEXT NOT NULL,
      video_id      TEXT NOT NULL,
      meta_json     TEXT NOT NULL,
      quality       TEXT NOT NULL,
      file_name     TEXT NOT NULL,
      cover_file    TEXT,
      size_bytes    INTEGER NOT NULL,
      downloaded_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS progress (
      key         TEXT PRIMARY KEY,
      position_ms INTEGER NOT NULL,
      duration_ms INTEGER,
      updated_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_library_source ON library(source);
  `)
  return { db, mediaDir }
}

export function getSetting(db: DatabaseSync, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value
}

export function setSetting(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value)
}

export function mediaPath(mediaDir: string, fileName: string): string {
  const p = resolve(mediaDir, fileName)
  if (!p.startsWith(resolve(mediaDir))) throw new Error('非法文件路径')
  return p
}

export function ensureDir(p: string): void {
  mkdirSync(dirname(p), { recursive: true })
}
