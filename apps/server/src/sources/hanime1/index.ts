import type { Page, VideoDetail, VideoSummary } from '@libre-tv/shared/types'
import * as cheerio from 'cheerio'
import { UpstreamClient, UpstreamError, dedupe } from '../http'

/**
 * hanime1.me 源适配器。
 *
 * 站点为 Laravel 服务端渲染（Blade），没有可抓的列表/详情 JSON API：
 * - 浏览/搜索：/search?genre=<分区>&sort=最新上傳&page=N、/search?query=<关键词>&page=N
 * - 详情/播放：/watch?v=<id>，播放地址直接以 <video id="player"> 下多个 <source size> 给出
 *
 * 结构变更时只需改本文件的选择器表（SELECTORS）。
 */

const SELECTORS = {
  card: 'div.video-item-container',
  cardLink: 'a.video-link[href*="watch?v="]',
  cardThumb: 'img.main-thumb',
  cardDuration: '.thumb-container .duration',
  cardTitle: '.title',
  cardUploader: '.subtitle a',
  cardTime: '.subtitle .subtitle-time',
  cardStats: '.stat-item',
  watchTitle: 'h3.video-details-wrapper',
  playerSources: '#player-div-wrapper video#player source',
  poster: '#player-div-wrapper video#player',
  uploader: '#video-artist-name',
  related: '#related-tabcontent',
  genreLink:
    ".meta-stats a[href*='search?genre='], .video-details-wrapper a[href*='search?genre=']",
} as const

export const HANIME1_ID = 'hanime1'
export const HANIME1_NAME = 'Hanime1'

export interface Hanime1Options {
  baseUrl?: string
  proxy?: string
  dnsProxy?: string
  pinnedIp?: string
  cookie?: string
  userAgent?: string
}

export class Hanime1Source {
  readonly id = HANIME1_ID
  readonly name = HANIME1_NAME
  readonly baseUrl: string
  readonly client: UpstreamClient

  constructor(opts: Hanime1Options = {}) {
    this.baseUrl = opts.baseUrl ?? 'https://hanime1.me'
    this.client = new UpstreamClient({
      baseUrl: this.baseUrl,
      userAgent:
        opts.userAgent ??
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      proxy: opts.proxy,
      dnsProxy: opts.dnsProxy,
      pinnedIp: opts.pinnedIp,
      cookie: opts.cookie,
    })
  }

  /** 浏览：按分区列出（category 为空即无 genre 过滤） */
  async list(page = 1, category?: string): Promise<Page<VideoSummary>> {
    const params = new URLSearchParams({ sort: '最新上傳', page: String(clampPage(page)) })
    if (category) params.set('genre', category)
    const html = await this.client.fetchHtml(`/search?${params}`)
    const items = this.parseCards(html)
    return { items, page: clampPage(page), hasMore: items.length > 0 }
  }

  /** 搜索：关键词 */
  async search(keyword: string, page = 1): Promise<Page<VideoSummary>> {
    const params = new URLSearchParams({ query: keyword, page: String(clampPage(page)) })
    const html = await this.client.fetchHtml(`/search?${params}`)
    const items = this.parseCards(html)
    return { items, page: clampPage(page), hasMore: items.length > 0 }
  }

  /** 详情：元数据 + 多清晰度播放地址 + 相关推荐 */
  async detail(id: string): Promise<VideoDetail> {
    const vid = /^\d+$/.test(id) ? id : extractVid(id)
    if (!vid) throw new UpstreamError(`无效的视频 ID：${id}`, 400)
    return this.parseWatch(vid, await this.client.fetchHtml(`/watch?v=${vid}`, 300_000))
  }

  /** 纯解析：watch 页 HTML → VideoDetail（便于离线验证） */
  parseWatch(vid: string, html: string): VideoDetail {
    const $ = cheerio.load(html)

    const qualities = $(SELECTORS.playerSources)
      .map((_, el) => ({
        label: $(el).attr('size') ?? 'auto',
        url: $(el).attr('src') ?? '',
      }))
      .get()
      .filter((q) => q.url)
      .sort((a, b) => Number(b.label) - Number(a.label))
    if (qualities.length === 0) {
      throw new UpstreamError('播放地址解析失败（页面结构可能已变更）', 502)
    }

    const best = qualities[0]!
    const title =
      $(SELECTORS.watchTitle).first().text().trim().replace(/\s+/g, ' ') ||
      $('meta[property="og:title"]').attr('content')?.trim() ||
      vid
    const poster =
      $(SELECTORS.poster).first().attr('poster') ??
      $('meta[property="og:image"]').attr('content') ??
      undefined
    const related = dedupe(this.parseCards($(SELECTORS.related).html() ?? '')).filter(
      (v) => v.id !== vid,
    )

    return {
      id: vid,
      source: this.id,
      title,
      coverUrl: poster,
      pageUrl: `${this.baseUrl}/watch?v=${vid}`,
      streamUrl: best.url,
      streamProxyUrl: `/api/sources/${this.id}/stream?v=${vid}&quality=${encodeURIComponent(best.label)}`,
      qualities,
      uploader: $(SELECTORS.uploader).first().text().trim() || undefined,
      related,
      tags: this.parseTags($),
    }
  }

  /** 按清晰度取直链（流代理用；解析失败时回退详情） */
  async streamUrl(vid: string, label?: string): Promise<string> {
    const detail = await this.detail(vid)
    const hit = label ? detail.qualities?.find((q) => q.label === label) : undefined
    return hit?.url ?? detail.streamUrl!
  }

  parseCards(html: string): VideoSummary[] {
    const $ = cheerio.load(html)
    const items: VideoSummary[] = []
    $(SELECTORS.card).each((_, el) => {
      const card = $(el)
      const link = card.find(SELECTORS.cardLink).first()
      const vid = extractVid(link.attr('href') ?? '')
      if (!vid) return // 广告卡无 watch 链接
      const thumb = card.find(SELECTORS.cardThumb).first()
      items.push({
        id: vid,
        source: this.id,
        title: card.find(SELECTORS.cardTitle).first().text().trim().replace(/\s+/g, ' ') || vid,
        coverUrl: thumb.attr('src') ?? thumb.attr('data-src') ?? undefined,
        durationSec: parseDuration(card.find(SELECTORS.cardDuration).first().text()),
        views: parseViews(card.find(SELECTORS.cardStats).last().text()),
        uploader: card.find(SELECTORS.cardUploader).first().text().trim() || undefined,
      } satisfies VideoSummary)
    })
    return dedupe(items)
  }

  private parseTags($: cheerio.CheerioAPI): string[] {
    const tags = new Set<string>()
    $(SELECTORS.genreLink).each((_, el) => {
      const href = $(el).attr('href') ?? ''
      const genre = href.includes('genre=') ? href.split('genre=')[1]?.split('&')[0] : undefined
      if (genre) tags.add(decodeURIComponent(genre.replace(/\+/g, ' ')))
    })
    return [...tags]
  }

  /** 预热的图片代理白名单：仅允许回源这些主机 */
  static readonly IMAGE_HOSTS = ['hembed.com', 'hanime1.me', 'hanimeone.me']
}

function clampPage(page: number): number {
  const n = Number.isFinite(page) ? Math.trunc(page) : 1
  return Math.min(Math.max(n, 1), 500)
}

export function extractVid(href: string): string | undefined {
  const m = href.match(/[?&]v=(\d+)/)
  return m?.[1]
}

/** '09:34' / '1:03:06' → 秒 */
export function parseDuration(text: string): number | undefined {
  const m = text.trim().match(/^(\d+:)?(\d{1,2}):(\d{2})$/)
  if (!m) return undefined
  const h = m[1] ? Number.parseInt(m[1], 10) : 0
  return h * 3600 + Number(m[2]) * 60 + Number(m[3])
}

/** '8.5萬次' / '1.2萬' / '3,412次' → 数字 */
export function parseViews(text: string): number | undefined {
  const t = text.replace(/[次\s]/g, '')
  const m = t.match(/([\d.,]+)\s*(萬|万|亿|億|K|M)?/)
  if (!m) return undefined
  const n = Number.parseFloat(m[1]!.replace(/,/g, ''))
  if (!Number.isFinite(n)) return undefined
  const unit = m[2]
  if (unit === '萬' || unit === '万') return Math.round(n * 10_000)
  if (unit === '億' || unit === '亿') return Math.round(n * 100_000_000)
  if (unit === 'K') return Math.round(n * 1_000)
  if (unit === 'M') return Math.round(n * 1_000_000)
  return Math.round(n)
}
