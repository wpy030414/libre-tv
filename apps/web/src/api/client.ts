import type {
  DownloadJob,
  LibraryItem,
  Page,
  PlaybackResolve,
  VideoDetail,
  VideoSummary,
} from '@libre-tv/shared/types'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new ApiError(body.error ?? `请求失败（${res.status}）`, res.status)
  }
  return (await res.json()) as T
}

async function send<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    throw new ApiError(data.error ?? `请求失败（${res.status}）`, res.status)
  }
  return (await res.json()) as T
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export const api = {
  listSources: () => get<Array<{ id: string; name: string }>>('/api/sources'),

  list: (source: string, page = 1, category?: string) =>
    get<Page<VideoSummary>>(
      `/api/sources/${source}/list?page=${page}${category ? `&category=${encodeURIComponent(category)}` : ''}`,
    ),

  search: (source: string, kw: string, page = 1) =>
    get<Page<VideoSummary>>(
      `/api/sources/${source}/search?kw=${encodeURIComponent(kw)}&page=${page}`,
    ),

  detail: (source: string, id: string) => get<VideoDetail>(`/api/sources/${source}/detail/${id}`),

  /** 图片统一经服务端代理（源站防盗链 + 签名） */
  image: (source: string, url?: string) =>
    url ? `/api/sources/${source}/image?url=${encodeURIComponent(url)}` : undefined,

  // ---- 本地库 / 双播 ----
  library: () => get<LibraryItem[]>('/api/library/items'),
  mode: () => get<{ offline: boolean }>('/api/library/mode'),
  setMode: (offline: boolean) =>
    send<{ offline: boolean }>('/api/library/mode', 'PUT', { offline }),
  play: (source: string, id: string, quality?: string) =>
    get<PlaybackResolve>(
      `/api/library/play/${source}/${id}${quality ? `?quality=${encodeURIComponent(quality)}` : ''}`,
    ),
  download: (source: string, id: string, quality?: string) =>
    send<DownloadJob>('/api/library/downloads', 'POST', { source, id, quality }),
  downloads: () => get<DownloadJob[]>('/api/library/downloads'),
  cancelDownload: (key: string) => send<{ ok: true }>(`/api/library/downloads/${key}`, 'DELETE'),
  deleteItem: (key: string) => send<{ ok: true }>(`/api/library/items/${key}`, 'DELETE'),

  // ---- 进度 ----
  progress: (source: string, id: string) =>
    get<{ positionMs: number; durationMs: number | null } | null>(
      `/api/library/progress/${source}/${id}`,
    ),
  saveProgress: (source: string, id: string, positionMs: number, durationMs: number) =>
    send<{ ok: true }>(`/api/library/progress/${source}/${id}`, 'PUT', {
      positionMs,
      durationMs,
    }),
}

/** 把秒格式化为 1:02:03 */
export function fmtDuration(sec?: number): string {
  if (!sec || sec <= 0) return ''
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

export function fmtViews(n?: number): string {
  if (!n) return ''
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}萬次`
  return `${n}次`
}

export function fmtBytes(n?: number): string {
  if (!n) return ''
  if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(2)} GB`
  return `${(n / 1048576).toFixed(1)} MB`
}
