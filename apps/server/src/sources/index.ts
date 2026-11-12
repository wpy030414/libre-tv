import type { SourceAdapter } from '@libre-tv/shared/types'
import { Hanime1Source } from './hanime1'

/**
 * 源注册表：新增源只需在此登记，路由与前端无需改动。
 * 上层依赖 SourceAdapter 契约（list/search/detail）；
 * 流/图代理额外需要 streamUrl 与 fetchBinary。
 */
export interface RegisteredSource extends SourceAdapter {
  streamUrl?(id: string, label?: string): Promise<string>
  /** 以给定请求头抓上游二进制（Range 透传） */
  fetchBinary?(url: string, headers?: Record<string, string | undefined>): Promise<Response>
  /** 图片代理白名单（主机后缀） */
  imageHosts: readonly string[]
}

export interface SourceEnv {
  hanime1Proxy?: string
  hanime1DnsProxy?: string
  hanime1PinnedIp?: string
  hanime1Cookie?: string
  hanime1BaseUrl?: string
}

export function createSources(env: SourceEnv): Map<string, RegisteredSource> {
  const hanime1 = new Hanime1Source({
    baseUrl: env.hanime1BaseUrl,
    proxy: env.hanime1Proxy,
    dnsProxy: env.hanime1DnsProxy,
    pinnedIp: env.hanime1PinnedIp,
    cookie: env.hanime1Cookie,
  })
  const sources: RegisteredSource[] = [
    {
      id: hanime1.id,
      name: hanime1.name,
      list: hanime1.list.bind(hanime1),
      search: hanime1.search.bind(hanime1),
      detail: hanime1.detail.bind(hanime1),
      streamUrl: hanime1.streamUrl.bind(hanime1),
      imageHosts: Hanime1Source.IMAGE_HOSTS,
      fetchBinary: async (url, headers) => {
        const h: Record<string, string> = {}
        for (const [k, v] of Object.entries(headers ?? {})) if (v) h[k] = v
        return hanime1.client.fetchBinary(url, h)
      },
    },
  ]
  return new Map(sources.map((s) => [s.id, s]))
}
