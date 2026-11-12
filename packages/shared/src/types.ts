/**
 * 视频源统一契约：每个源（hanime1 等）在 server 侧实现一份 SourceAdapter，
 * 归一化为下列结构后经 /api 暴露，前端只消费归一化结果，不感知源站差异。
 */

export interface VideoSummary {
  /** 源内唯一 ID（如 hanime1 的 watch?v= 参数） */
  id: string
  /** 所属源标识，对应 SourceAdapter.id */
  source: string
  title: string
  coverUrl?: string
  /** 时长（秒） */
  durationSec?: number
  views?: number
  tags?: string[]
  /** 上传者 / 社团名 */
  uploader?: string
}

export interface VideoQuality {
  /** 清晰度标签，如 '1080' */
  label: string
  /** 该清晰度的直链（多为带签名的临时 URL） */
  url: string
}

export interface VideoDetail extends VideoSummary {
  /** 源站原始页地址 */
  pageUrl: string
  /** 播放地址（m3u8 / mp4），由源适配器解析 */
  streamUrl?: string
  /** 经本服务代理的播放地址（Range 转发，规避 CORS/防盗链） */
  streamProxyUrl?: string
  /** 全部可选清晰度 */
  qualities?: VideoQuality[]
  description?: string
  uploader?: string
  uploadDate?: string
  /** 相关推荐 */
  related?: VideoSummary[]
}

export interface Page<T> {
  items: T[]
  page: number
  hasMore: boolean
}

export interface SourceAdapter {
  /** 源唯一标识（小写短横线），如 'hanime1' */
  id: string
  name: string
  list(page: number, category?: string): Promise<Page<VideoSummary>>
  search(keyword: string, page?: number): Promise<Page<VideoSummary>>
  detail(id: string): Promise<VideoDetail>
}

/* ===== 播放与本地库 ===== */

/** 播放来源：cdn = 源站直链（经服务端代理），local = 已下载到本机 */
export type PlaySource = 'cdn' | 'local'

/** 离线库条目：下载完成后的自包含记录，不再依赖源站 */
export interface LibraryItem {
  /** 源标识 + id 的复合键：`<source>:<id>` */
  key: string
  source: string
  id: string
  /** 下载时捕获的全量元数据（详情页快照） */
  meta: VideoDetail
  /** 已下载清晰度标签 */
  quality: string
  /** 本地文件名（相对下载根目录） */
  fileName: string
  /** 本地封面文件名（相对封面目录），无封面时为空 */
  coverFile?: string
  sizeBytes: number
  /** 下载时间 ISO 字符串 */
  downloadedAt: string
}

export type DownloadStatus = 'queued' | 'downloading' | 'done' | 'error'

export interface DownloadJob {
  key: string
  source: string
  id: string
  title: string
  status: DownloadStatus
  quality: string
  /** 0-100 */
  progress: number
  receivedBytes: number
  totalBytes?: number
  error?: string
  startedAt?: string
  finishedAt?: string
}

export interface PlaybackResolve {
  /** 实际播放地址（前端可直接塞进 <video src>） */
  url: string
  source: PlaySource
  quality: string
  /** 可用的本地清晰度（若有） */
  localQualities?: string[]
}
