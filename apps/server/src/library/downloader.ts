import type { DownloadJob, LibraryItem, VideoDetail } from '@libre-tv/shared/types'
import { createWriteStream, existsSync, statSync, unlinkSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { mediaPath, type LibraryDb } from './db'

export interface DownloaderDeps {
  library: LibraryDb
  /** 取详情（含全量元数据） */
  getDetail(source: string, id: string): Promise<VideoDetail>
  /** 取指定清晰度直链 */
  getStreamUrl(source: string, id: string, quality: string): Promise<string>
  /** 抓图（走源站客户端，带 Referer/Cookie） */
  fetchImage?(url: string): Promise<Response>
  log?: (msg: string) => void
}

/**
 * 单并发下载队列：一次只跑一个任务，避免电视端点连发把带宽打满。
 * 产物：media/<key>-<quality>.mp4 + covers/<key>.jpg + library 表一行（含全量元数据快照）。
 */
export class Downloader {
  private readonly queue: string[] = []
  private readonly jobs = new Map<string, DownloadJob>()
  private running = false
  private abortCurrent: AbortController | null = null

  constructor(private readonly deps: DownloaderDeps) {}

  /** 入队；已下载或已在队列中则返回现有任务 */
  enqueue(source: string, id: string, quality?: string): DownloadJob {
    const key = `${source}:${id}`
    const existing = this.jobs.get(key)
    if (existing && (existing.status === 'queued' || existing.status === 'downloading')) {
      return existing
    }
    const job: DownloadJob = {
      key,
      source,
      id,
      title: '',
      status: 'queued',
      quality: quality ?? 'auto',
      progress: 0,
      receivedBytes: 0,
    }
    this.jobs.set(key, job)
    this.queue.push(key)
    void this.pump()
    return job
  }

  list(): DownloadJob[] {
    return [...this.jobs.values()].sort((a, b) =>
      (b.startedAt ?? '').localeCompare(a.startedAt ?? ''),
    )
  }

  get(key: string): DownloadJob | undefined {
    return this.jobs.get(key)
  }

  /** 取消队列中或进行中的任务 */
  cancel(key: string): boolean {
    const job = this.jobs.get(key)
    if (!job) return false
    if (job.status === 'queued') {
      const i = this.queue.indexOf(key)
      if (i >= 0) this.queue.splice(i, 1)
      job.status = 'error'
      job.error = '已取消'
      return true
    }
    if (job.status === 'downloading') this.abortCurrent?.abort()
    return job.status === 'downloading'
  }

  delete(key: string): boolean {
    const row = this.deps.library.db
      .prepare('SELECT file_name, cover_file FROM library WHERE key = ?')
      .get(key) as { file_name: string; cover_file?: string } | undefined
    if (!row) return false
    for (const f of [row.file_name, row.cover_file].filter(Boolean)) {
      const p = mediaPath(this.deps.library.mediaDir, f!)
      if (existsSync(p)) unlinkSync(p)
    }
    this.deps.library.db.prepare('DELETE FROM library WHERE key = ?').run(key)
    this.jobs.delete(key)
    return true
  }

  private async pump(): Promise<void> {
    if (this.running) return
    const key = this.queue.shift()
    if (!key) return
    const job = this.jobs.get(key)
    if (!job) return
    this.running = true
    try {
      await this.run(job)
    } catch (err) {
      job.status = 'error'
      job.error = (err as Error).message
      this.deps.log?.(`[download] ${key} 失败：${job.error}`)
    } finally {
      this.running = false
      queueMicrotask(() => void this.pump())
    }
  }

  private async run(job: DownloadJob): Promise<void> {
    const { library } = this.deps
    const getDetail = (s: string, id: string) => this.deps.getDetail(s, id)
    const getStreamUrl = (s: string, id: string, q: string) => this.deps.getStreamUrl(s, id, q)
    const fetchImage = this.deps.fetchImage
      ? (url: string) => this.deps.fetchImage!(url)
      : undefined
    const log = this.deps.log
    job.status = 'downloading'
    job.startedAt = new Date().toISOString()

    // 1) 全量元数据快照
    const detail = await getDetail(job.source, job.id)
    job.title = detail.title
    const quality = job.quality !== 'auto' ? job.quality : (detail.qualities?.[0]?.label ?? 'auto')
    job.quality = quality
    if (detail.qualities?.some((q) => q.label === quality)) {
      job.totalBytes = undefined
    }

    const fileSafe = `${job.source}-${job.id}-${quality}`.replace(/[^\w.-]+/g, '_')
    const fileName = `${fileSafe}.mp4`
    const target = mediaPath(library.mediaDir, fileName)
    const part = target + '.part'

    // 2) 流式下载
    const streamUrl = await getStreamUrl(job.source, job.id, quality)
    this.abortCurrent = new AbortController()
    const res = await fetch(streamUrl, {
      headers: { 'user-agent': 'Mozilla/5.0', referer: detail.pageUrl },
      signal: this.abortCurrent.signal,
    })
    if (!res.ok || !res.body) throw new Error(`下载失败：HTTP ${res.status}`)

    const total = Number(res.headers.get('content-length') ?? 0) || undefined
    job.totalBytes = total
    let received = 0
    const body = Readable.fromWeb(res.body as never)
    body.on('data', (chunk: Buffer) => {
      received += chunk.length
      job.receivedBytes = received
      job.progress = total ? Math.min(99, Math.floor((received / total) * 100)) : 0
      // 节流由进度查询端点天然完成，不必额外 debounce
    })

    try {
      await pipeline(body, createWriteStream(part))
      // 完成前校验大小（若上游给了 content-length）
      if (total && statSync(part).size < total) {
        throw new Error(`下载不完整：${statSync(part).size}/${total} 字节`)
      }
      await renameAtomic(part, target)
    } catch (err) {
      if (existsSync(part)) unlinkSync(part)
      if ((err as Error).name === 'AbortError') throw new Error('已取消')
      throw err
    } finally {
      this.abortCurrent = null
    }

    // 3) 封面（失败不阻断下载）
    let coverFile: string | undefined
    if (detail.coverUrl && fetchImage) {
      try {
        const img = await fetchImage(detail.coverUrl)
        if (img.ok) {
          const bytes = Buffer.from(await img.arrayBuffer())
          const ext = img.headers.get('content-type')?.includes('png') ? 'png' : 'jpg'
          coverFile = `covers/${fileSafe}.${ext}`
          await import('node:fs/promises').then((fs) =>
            fs.writeFile(mediaPath(library.mediaDir, coverFile!), bytes),
          )
        }
      } catch (e) {
        log?.(`[download] 封面失败（忽略）：${(e as Error).message}`)
      }
    }

    // 4) 入库（元数据全量快照）
    const item: LibraryItem = {
      key: job.key,
      source: job.source,
      id: job.id,
      meta: detail,
      quality,
      fileName,
      coverFile,
      sizeBytes: statSync(target).size,
      downloadedAt: new Date().toISOString(),
    }
    library.db
      .prepare(
        `INSERT INTO library (key, source, video_id, meta_json, quality, file_name, cover_file, size_bytes, downloaded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET meta_json=excluded.meta_json, quality=excluded.quality,
           file_name=excluded.file_name, cover_file=excluded.cover_file,
           size_bytes=excluded.size_bytes, downloaded_at=excluded.downloaded_at`,
      )
      .run(
        item.key,
        item.source,
        item.id,
        JSON.stringify(item.meta),
        item.quality,
        item.fileName,
        item.coverFile ?? null,
        item.sizeBytes,
        item.downloadedAt,
      )

    job.progress = 100
    job.status = 'done'
    job.finishedAt = new Date().toISOString()
    log?.(`[download] ${job.key} 完成 ${(item.sizeBytes / 1048576).toFixed(1)}MB`)
  }
}

async function renameAtomic(from: string, to: string): Promise<void> {
  const fs = await import('node:fs/promises')
  await fs.rename(from, to)
}
