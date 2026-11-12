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
}

export interface VideoDetail extends VideoSummary {
  /** 源站原始页地址 */
  pageUrl: string
  /** 播放地址（m3u8 / mp4），由源适配器解析 */
  streamUrl?: string
  description?: string
  uploader?: string
  uploadDate?: string
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
