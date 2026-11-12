import type { DownloadJob, LibraryItem, PlaybackResolve, VideoDetail } from '@libre-tv/shared/types'
import { Hono } from 'hono'
import { readFileSync, statSync } from 'node:fs'
import { getSetting, mediaPath, setSetting, type LibraryDb } from '../library/db'
import type { Downloader } from '../library/downloader'

export interface PlaybackDeps {
  library: LibraryDb
  downloader: Downloader
  getDetail(source: string, id: string): Promise<VideoDetail>
  getStreamUrl(source: string, id: string, quality?: string): Promise<string>
}

/** 流代理：转发上游 Range，不落盘 */
export function streamProxy(
  fetchBinary: (url: string, headers?: Record<string, string | undefined>) => Promise<Response>,
) {
  return async (getUrl: () => Promise<string>, range: string | undefined): Promise<Response> => {
    const upstream = await fetchBinary(await getUrl(), { range })
    const headers = new Headers()
    for (const k of [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'etag',
      'last-modified',
    ]) {
      const v = upstream.headers.get(k)
      if (v) headers.set(k, v)
    }
    return new Response(upstream.body, { status: upstream.status, headers })
  }
}

/**
 * 本地播放（HTTP Range 单文件服务）：
 * 电视浏览器对 <video src> 走 Range 会更稳，这里按 Range 头返回 206。
 */
export function serveLocalFile(path: string, range: string | undefined): Response {
  const size = statSync(path).size
  const buf = readFileSync(path)
  if (!range) {
    return new Response(buf, {
      status: 200,
      headers: {
        'content-type': 'video/mp4',
        'content-length': String(size),
        'accept-ranges': 'bytes',
      },
    })
  }
  const m = range.match(/bytes=(\d*)-(\d*)/)
  if (!m) return new Response(null, { status: 416 })
  const start = m[1] ? Number(m[1]) : 0
  const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
  if (start > end || start >= size) {
    return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } })
  }
  const chunk = buf.subarray(start, end + 1)
  return new Response(chunk, {
    status: 206,
    headers: {
      'content-type': 'video/mp4',
      'content-length': String(chunk.length),
      'content-range': `bytes ${start}-${end}/${size}`,
      'accept-ranges': 'bytes',
    },
  })
}

export function libraryRoutes(deps: PlaybackDeps) {
  const app = new Hono()

  // ---- 离线开关（全局设置）----
  app.get('/mode', (c) => c.json({ offline: getSetting(deps.library.db, 'mode.offline') === '1' }))
  app.put('/mode', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { offline?: boolean }
    setSetting(deps.library.db, 'mode.offline', body.offline ? '1' : '0')
    return c.json({ offline: !!body.offline })
  })

  // ---- 本地库 ----
  app.get('/items', (c) => {
    const rows = deps.library.db
      .prepare('SELECT * FROM library ORDER BY downloaded_at DESC')
      .all() as unknown as RowShape[]
    return c.json(rows.map(rowToItem))
  })

  app.get('/items/:key', (c) => {
    const row = deps.library.db
      .prepare('SELECT * FROM library WHERE key = ?')
      .get(c.req.param('key')) as RowShape | undefined
    if (!row) return c.json({ error: '本地库无此条目' }, 404)
    return c.json(rowToItem(row))
  })

  app.delete('/items/:key', (c) =>
    deps.downloader.delete(c.req.param('key'))
      ? c.json({ ok: true })
      : c.json({ error: '本地库无此条目' }, 404),
  )

  // ---- 下载任务 ----
  app.post('/downloads', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      source?: string
      id?: string
      quality?: string
    }
    if (!body.source || !body.id) return c.json({ error: '需要 source 与 id' }, 400)
    const job = deps.downloader.enqueue(body.source, body.id, body.quality)
    return c.json(job, 202)
  })
  app.get('/downloads', (c) => c.json(deps.downloader.list()))
  app.get('/downloads/:key', (c) => {
    const job: DownloadJob | undefined = deps.downloader.get(c.req.param('key'))
    return job ? c.json(job) : c.json({ error: '无此任务' }, 404)
  })
  app.delete('/downloads/:key', (c) =>
    deps.downloader.cancel(c.req.param('key'))
      ? c.json({ ok: true })
      : c.json({ error: '任务不存在或已结束' }, 404),
  )

  // ---- 媒体文件（本地播放 / 本地封面）----
  app.get('/media/:file{.+}', (c) => {
    const file = c.req.param('file')
    try {
      const p = mediaPath(deps.library.mediaDir, file)
      if (!statSync(p).isFile()) return c.notFound()
      return serveLocalFile(p, c.req.header('range'))
    } catch {
      return c.notFound()
    }
  })

  /**
   * 播放来源解析——双播模式的核心出口：
   * offline=1 → 必返回本地；本地无片 → 404
   * offline=0 → 本地优先（已下载）；否则走源站直放（经流代理）
   */
  app.get('/play/:source/:id', async (c) => {
    const source = c.req.param('source')
    const id = c.req.param('id')
    const key = `${source}:${id}`
    const offline = getSetting(deps.library.db, 'mode.offline') === '1'
    const row = deps.library.db.prepare('SELECT * FROM library WHERE key = ?').get(key) as
      | RowShape
      | undefined

    if (row) {
      const item = rowToItem(row)
      const result: PlaybackResolve = {
        url: `/api/library/media/${item.fileName}`,
        source: 'local',
        quality: item.quality,
        localQualities: [item.quality],
      }
      return c.json(result)
    }
    if (offline) return c.json({ error: '离线模式下该视频未下载' }, 404)

    const detail = await deps.getDetail(source, id)
    const quality = c.req.query('quality') ?? detail.qualities?.[0]?.label ?? 'auto'
    const result: PlaybackResolve = {
      url: `/api/sources/${source}/stream?v=${encodeURIComponent(id)}&quality=${encodeURIComponent(quality)}`,
      source: 'cdn',
      quality,
      localQualities: [],
    }
    return c.json(result)
  })

  // ---- 播放进度 ----
  app.get('/progress/:source/:id', (c) => {
    const key = `${c.req.param('source')}:${c.req.param('id')}`
    const row = deps.library.db.prepare('SELECT * FROM progress WHERE key = ?').get(key) as
      | { key: string; position_ms: number; duration_ms: number | null; updated_at: string }
      | undefined
    return c.json(
      row
        ? { positionMs: row.position_ms, durationMs: row.duration_ms, updatedAt: row.updated_at }
        : null,
    )
  })
  app.put('/progress/:source/:id', async (c) => {
    const key = `${c.req.param('source')}:${c.req.param('id')}`
    const body = (await c.req.json().catch(() => ({}))) as {
      positionMs?: number
      durationMs?: number
    }
    const pos = Math.max(0, Math.round(body.positionMs ?? 0))
    deps.library.db
      .prepare(
        `INSERT INTO progress (key, position_ms, duration_ms, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET position_ms=excluded.position_ms,
           duration_ms=excluded.duration_ms, updated_at=excluded.updated_at`,
      )
      .run(key, pos, body.durationMs ? Math.round(body.durationMs) : null, new Date().toISOString())
    return c.json({ ok: true })
  })

  return app
}

interface RowShape {
  key: string
  source: string
  video_id: string
  meta_json: string
  quality: string
  file_name: string
  cover_file: string | null
  size_bytes: number
  downloaded_at: string
}

function rowToItem(r: RowShape): LibraryItem {
  return {
    key: r.key,
    source: r.source,
    id: r.video_id,
    meta: JSON.parse(r.meta_json) as VideoDetail,
    quality: r.quality,
    fileName: r.file_name,
    coverFile: r.cover_file ?? undefined,
    sizeBytes: r.size_bytes,
    downloadedAt: r.downloaded_at,
  }
}

export type { LibraryItem }
