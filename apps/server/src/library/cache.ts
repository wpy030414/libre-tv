import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { VideoDetail } from '@libre-tv/shared/types'
import { readMetaCache, writeMetaCache, type LibraryDb } from './db'

/**
 * 元数据与封面缓存。
 *
 * 依据：元信息（标题/封面/标签/上传者/相关推荐）几乎不变，一次载入后即可长期复用；
 * 变化的是播放直链——它带签名与时间戳，过期后需重新解析。
 *
 * 策略：
 * - 详情：命中 meta_cache 且直链未过期 → 直接返回；直链过期 → 仅刷新直链，元数据仍用缓存。
 * - 封面：以原图 URL 的哈希为文件名落盘；URL 命中时直接读文件，不再回源。
 */

const META_FRESH_MS = 7 * 24 * 3600_000 // 元数据 7 天内视为新鲜
const STREAM_SKEW_MS = 5 * 60_000 // 直链提前 5 分钟视为过期

export interface MetaCacheStore {
  /** 命中缓存返回详情（直链可能已过期，由调用方判断） */
  get(key: string): { detail: VideoDetail; streamValid: boolean } | undefined
  put(key: string, detail: VideoDetail): void
  /** 只更新直链，保留其余元数据 */
  patchStream(
    key: string,
    patch: Pick<VideoDetail, 'streamUrl' | 'qualities'>,
  ): VideoDetail | undefined
}

export function createMetaCache(library: LibraryDb): MetaCacheStore {
  return {
    get(key) {
      const row = readMetaCache(library.db, key)
      if (!row) return undefined
      let detail: VideoDetail
      try {
        detail = JSON.parse(row.payload) as VideoDetail
      } catch {
        return undefined
      }
      const streamValid = row.expiresAt === null || row.expiresAt > Date.now() + STREAM_SKEW_MS
      return { detail, streamValid }
    },
    put(key, detail) {
      writeMetaCache(library.db, key, JSON.stringify(detail), Date.now() + META_FRESH_MS)
    },
    patchStream(key, patch) {
      const row = readMetaCache(library.db, key)
      if (!row) return undefined
      let detail: VideoDetail
      try {
        detail = JSON.parse(row.payload) as VideoDetail
      } catch {
        return undefined
      }
      const merged: VideoDetail = { ...detail, ...patch, streamProxyUrl: detail.streamProxyUrl }
      writeMetaCache(library.db, key, JSON.stringify(merged), Date.now() + META_FRESH_MS)
      return merged
    },
  }
}

/** 签名直链里的过期时间戳（秒），取不到时返回 undefined */
export function streamExpiresAt(url?: string): number | undefined {
  if (!url) return undefined
  const m = url.match(/[?&](?:secure|expires?|e)=([^&]+)/i)
  if (!m) return undefined
  // hanime1 的 secure 形如 `<sig>,<unix-seconds>`
  const sec = m[1]!.split(',').find((p) => /^\d{10}$/.test(p))
  return sec ? Number(sec) * 1000 : undefined
}

export interface ImageCache {
  /** 命中返回本地文件名（相对缓存目录） */
  find(url: string): string | undefined
  save(url: string, bytes: Buffer, ext: string): string
  path(file: string): string
}

export function createImageCache(cacheDir: string): ImageCache {
  mkdirSync(cacheDir, { recursive: true })
  const key = (url: string) => createHash('sha1').update(url).digest('hex').slice(0, 20)

  // 索引：url → 文件名（仅本次进程内，磁盘文件本身可跨重启复用）
  const index = new Map<string, string>()
  const keyIndexFile = join(cacheDir, 'index.json')
  try {
    const raw = JSON.parse(readFileSync(keyIndexFile, 'utf-8')) as Record<string, string>
    for (const [u, f] of Object.entries(raw)) {
      const p = join(cacheDir, f)
      if (existsSync(p) && statSync(p).size > 0) index.set(u, f)
    }
  } catch {
    /* 首次启动无索引 */
  }

  let dirty = false
  const persist = () => {
    if (!dirty) return
    dirty = false
    try {
      writeFileSync(keyIndexFile, JSON.stringify(Object.fromEntries(index)))
    } catch {
      /* 索引写失败不影响读缓存 */
    }
  }
  const timer = setInterval(persist, 10_000)
  timer.unref()

  return {
    find(url) {
      const f = index.get(url)
      if (!f) return undefined
      return existsSync(join(cacheDir, f)) ? f : undefined
    },
    save(url, bytes, ext) {
      const f = `${key(url)}.${ext}`
      writeFileSync(join(cacheDir, f), bytes)
      index.set(url, f)
      dirty = true
      return f
    },
    path(file) {
      return join(cacheDir, file)
    },
  }
}
