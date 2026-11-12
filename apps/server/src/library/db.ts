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
    -- 详情元数据缓存：元信息很少变动，一次载入后长期复用。
    -- 存解析后的 VideoDetail（而不是原始 HTML），播放直链带签名会过期，
    -- 故单独记录 expires_at，过期时只刷新直链、元数据照旧可用。
    CREATE TABLE IF NOT EXISTS meta_cache (
      key        TEXT PRIMARY KEY,
      payload    TEXT NOT NULL,
      cached_at  TEXT NOT NULL,
      expires_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_library_source ON library(source);
  `)
  mkdirSync(join(mediaDir, 'covers'), { recursive: true })
  mkdirSync(join(mediaDir, '.cover-cache'), { recursive: true })
  return { db, mediaDir }
}

/** 元数据缓存读写（key = `<source>:<id>`） */
export function readMetaCache(
  db: DatabaseSync,
  key: string,
): { payload: string; expiresAt: number | null } | undefined {
  const row = db.prepare('SELECT payload, expires_at FROM meta_cache WHERE key = ?').get(key) as
    | { payload: string; expires_at: number | null }
    | undefined
  return row ? { payload: row.payload, expiresAt: row.expires_at } : undefined
}

export function writeMetaCache(
  db: DatabaseSync,
  key: string,
  payload: string,
  expiresAt: number | null,
): void {
  db.prepare(
    `INSERT INTO meta_cache (key, payload, cached_at, expires_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,
       cached_at=excluded.cached_at, expires_at=excluded.expires_at`,
  ).run(key, payload, new Date().toISOString(), expiresAt)
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
