import type { VideoSummary } from '@libre-tv/shared/types'
import { curlRequest, CurlError } from './curl'

/**
 * 上游抓取客户端：统一 UA / Referer / 可选代理与 Cookie（过 Cloudflare 用），
 * 传输层走 curl（TLS 指纹可过 CF WAF，见 curl.ts），
 * 带每主机串行频控与短 TTL 的 HTML 缓存，避免电视端快速导航把源站打挂。
 */
export interface UpstreamOptions {
  /** 源站基址，如 https://hanime1.me */
  baseUrl: string
  userAgent: string
  /** 可选：上游请求走的代理（http://host:port） */
  proxy?: string
  /** 可选：仅 DoH 解析走该代理（站点访问仍直连，CF 对代理出口常给挑战页） */
  dnsProxy?: string
  /** 可选：钉死上游 IP，跳过 DoH（`HANIME1_RESOLVE=104.26.8.104`） */
  pinnedIp?: string
  /** 可选：附加 Cookie 头（如 cf_clearance=...） */
  cookie?: string
  /** 同一上游两次请求的最小间隔（ms） */
  minIntervalMs?: number
  /** HTML 缓存 TTL（ms），0 关闭 */
  cacheTtlMs?: number
}

interface CacheEntry {
  expiresAt: number
  body: string
}

export class UpstreamClient {
  private readonly opts: UpstreamOptions & { baseUrl: string; userAgent: string }
  private readonly cache = new Map<string, CacheEntry>()
  private chain: Promise<unknown> = Promise.resolve()
  private lastRequestAt = 0

  constructor(opts: UpstreamOptions) {
    this.opts = { minIntervalMs: 400, cacheTtlMs: 60_000, ...opts }
  }

  /** 抓 HTML（走缓存与频控） */
  async fetchHtml(path: string, ttlMs: number = this.opts.cacheTtlMs ?? 0): Promise<string> {
    const url = new URL(path, this.opts.baseUrl).toString()
    const hit = this.cache.get(url)
    if (hit && hit.expiresAt > Date.now()) return hit.body

    const body = await this.enqueue(async () => {
      const res = await curlRequest({
        url,
        headers: this.baseHeaders(),
        proxy: this.opts.proxy,
        retries: 1,
        resolveMap: await this.resolveMap(new URL(url).hostname),
      })
      if (res.status < 200 || res.status >= 300) {
        throw new UpstreamError(
          `上游返回 HTTP ${res.status}${
            res.status === 403
              ? '（Cloudflare 拦截：请检查 HANIME1_COOKIE 的 cf_clearance 是否过期，或替换 HANIME1_PROXY）'
              : ''
          }`,
          res.status || 502,
        )
      }
      return res.text ?? ''
    })

    if (ttlMs > 0 && this.cache.size > 200) {
      const now = Date.now()
      for (const [k, v] of this.cache) if (v.expiresAt < now) this.cache.delete(k)
    }
    if (ttlMs > 0) this.cache.set(url, { expiresAt: Date.now() + ttlMs, body })
    return body
  }

  /** 抓二进制（流/图代理用）：不缓存不频控，Range 透传 */
  async fetchBinary(url: string, headers: Record<string, string> = {}): Promise<Response> {
    const range = headers.range
    const res = await curlRequest({
      url,
      headers: { ...this.baseHeaders(), ...stripRange(headers) },
      proxy: this.opts.proxy,
      range,
      timeoutSec: 60,
      resolveMap: await this.resolveMap(new URL(url).hostname),
    })
    if (res.text !== undefined) {
      // 小响应：body 已由 curl 完整读入（可能已解压），上游的 content-length /
      // content-range 不再可信——带上会让下游按错误长度读取，产生
      // 「Data after Connection: close」。这里只保留内容类型类头，长度交给运行时重算。
      return new Response(res.text, {
        status: res.status,
        headers: toWebHeaders(res.headers, { omitLength: true }),
      })
    }
    // 大文件：直接流式回传，读完删除临时文件
    const { streamFile } = await import('./curl')
    const { unlink } = await import('node:fs/promises')
    const body = await streamFile(res.bodyFile!)
    const cleanup = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = body.getReader()
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            controller.enqueue(value)
          }
          controller.close()
        } catch (err) {
          controller.error(err)
        } finally {
          await unlink(res.bodyFile!).catch(() => {})
          await unlink(res.bodyFile!.replace(/body\.bin$/, '')).catch(() => {})
        }
      },
    })
    return new Response(cleanup, {
      status: res.status,
      headers: toWebHeaders(res.headers),
    })
  }

  private baseHeaders(): Record<string, string> {
    return {
      'user-agent': this.opts.userAgent,
      referer: this.opts.baseUrl + '/',
      ...(this.opts.cookie ? { cookie: this.opts.cookie } : {}),
    }
  }

  /** 每主机 10 分钟的 DoH 解析结果缓存 */
  private dnsCache = new Map<string, { ip: string; expiresAt: number }>()

  /** 无代理时给 curl 的 --resolve 映射；解析失败返回空（由 curl 自行解析） */
  private async resolveMap(host: string): Promise<Record<string, string>> {
    if (this.opts.proxy) return {}
    if (!host.includes('.')) return {}
    try {
      return { [host]: await this.resolveIpv4(host) }
    } catch {
      return {}
    }
  }

  /** DoH 自解析：本地 DNS 对 hanime1.me 普遍被污染（解析到无关 IP）。
   *  DoH 查询本身在直连不可达/被污染时也走代理；站点访问仍走直连 IPv4。 */
  private async resolveIpv4(host: string): Promise<string> {
    if (this.opts.pinnedIp) return this.opts.pinnedIp
    const cached = this.dnsCache.get(host)
    if (cached && cached.expiresAt > Date.now()) return cached.ip

    const endpoints = [
      'https://1.1.1.1/dns-query',
      'https://doh.pub/dns-query',
      'https://dns.google/resolve',
    ]
    let lastErr: unknown
    for (const ep of endpoints) {
      for (const proxy of this.opts.dnsProxy ? [this.opts.dnsProxy] : [undefined]) {
        try {
          const res = await curlRequest({
            url: `${ep}?name=${encodeURIComponent(host)}&type=A`,
            headers: { accept: 'application/dns-json' },
            proxy,
            timeoutSec: 8,
          })
          const data = JSON.parse(res.text ?? '{}') as {
            Answer?: Array<{ type: number; data: string }> | { type: number; data: string }
          }
          const answers = Array.isArray(data.Answer)
            ? data.Answer
            : data.Answer
              ? [data.Answer]
              : []
          const ip = answers.find((a) => a.type === 1 && /^\d+\.\d+\.\d+\.\d+$/.test(a.data))?.data
          if (ip) {
            this.dnsCache.set(host, { ip, expiresAt: Date.now() + 600_000 })
            return ip
          }
        } catch (err) {
          lastErr = err
        }
      }
    }
    throw new Error(`DoH 解析失败：${host}（${(lastErr as Error)?.message ?? '无有效 A 记录'}）`)
  }

  private async enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const wait = this.opts.minIntervalMs! - (Date.now() - this.lastRequestAt)
      if (wait > 0) await sleep(wait)
      try {
        return await task()
      } finally {
        this.lastRequestAt = Date.now()
      }
    }
    const next = this.chain.then(run, run)
    this.chain = next.catch(() => {})
    return next
  }
}

function stripRange(h: Record<string, string>): Record<string, string> {
  const { range: _drop, ...rest } = h
  return rest
}

function toWebHeaders(h: Record<string, string>, opts?: { omitLength?: boolean }): Headers {
  const out = new Headers()
  const allow = [
    'content-type',
    'content-length',
    'content-range',
    'accept-ranges',
    'etag',
    'last-modified',
  ]
  for (const k of allow) {
    if (opts?.omitLength && (k === 'content-length' || k === 'content-range')) continue
    if (h[k]) out.set(k, h[k])
  }
  return out
}

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'UpstreamError'
  }
}

export function isUpstreamError(err: unknown): err is UpstreamError {
  if (err instanceof UpstreamError) return true
  if (err instanceof CurlError) return true
  const name = (err as { name?: string })?.name
  return name === 'UpstreamError' || name === 'CurlError'
}

export function upstreamStatus(err: unknown): number {
  const s = (err as { status?: number })?.status
  return typeof s === 'number' && s >= 400 && s <= 599 ? s : 502
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** 从汇总卡片里抽公共字段（列表页与详情页相关推荐共用） */
export function dedupe(videos: VideoSummary[]): VideoSummary[] {
  const seen = new Set<string>()
  return videos.filter((v) => {
    if (seen.has(v.id)) return false
    seen.add(v.id)
    return true
  })
}
