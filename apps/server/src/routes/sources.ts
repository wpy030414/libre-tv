import type { Context } from 'hono'
import { readFileSync } from 'node:fs'
import { Hono } from 'hono'
import { isUpstreamError, upstreamStatus } from '../sources/http'
import type { RegisteredSource } from '../sources'

type SourceEnv = { Variables: { source: RegisteredSource } }

/** 上游 Response → 客户端 Response，透传 Range/长度/类型（流与图代理共用） */
export function pipeUpstream(upstream: Response): Response {
  if (!upstream.ok && upstream.status !== 206) {
    return Response.json(
      { error: `上游返回 ${upstream.status}` },
      { status: upstream.status === 404 ? 404 : 502 },
    )
  }
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
  // 明确关闭连接复用：体为流式/可能被重新编码时，下游按 keep-alive 复用连接
  // 会把残余字节读到下一个响应上（Vite 代理报 Data after Connection: close）
  headers.set('cache-control', 'public, max-age=3600')
  headers.set('connection', 'close')
  return new Response(upstream.body, { status: upstream.status, headers })
}

export interface SourceRouteDeps {
  meta?: import('../library/cache').MetaCacheStore
  images?: import('../library/cache').ImageCache
}

export function sourceRoutes(sources: Map<string, RegisteredSource>, deps: SourceRouteDeps = {}) {
  const app = new Hono<SourceEnv>()

  app.get('/', (c) => c.json([...sources.values()].map((s) => ({ id: s.id, name: s.name }))))

  // 解析源 + 统一错误映射：源站故障只影响本源
  app.use('/:sourceId/*', async (c, next) => {
    const source = sources.get(c.req.param('sourceId'))
    if (!source) return c.json({ error: `未注册的源：${c.req.param('sourceId')}` }, 404)
    c.set('source', source)
    await next()
  })

  // 统一错误出口：源站故障只影响本源，不拖垮进程
  app.onError((err, c) => {
    if (isUpstreamError(err)) {
      return c.json({ error: err.message }, upstreamStatus(err) as 400)
    }
    console.error('[source]', err)
    return c.json({ error: '源处理失败', detail: (err as Error).message }, 502)
  })

  app.get('/:sourceId/list', async (c) => {
    const page = pageParam(c)
    return c.json(await c.get('source').list(page, c.req.query('category') || undefined))
  })

  app.get('/:sourceId/search', async (c) => {
    const keyword = c.req.query('kw')?.trim()
    if (!keyword) return c.json({ error: '缺少关键词参数 kw' }, 400)
    return c.json(await c.get('source').search(keyword, pageParam(c)))
  })

  app.get('/:sourceId/detail/:vid', async (c) => {
    const source = c.get('source')
    const vid = c.req.param('vid')
    const key = `${source.id}:${vid}`

    // 元数据缓存：元信息几乎不变，命中且直链未过期则零回源
    const cached = deps.meta?.get(key)
    if (cached?.streamValid) {
      c.header('x-cache', 'HIT')
      return c.json(cached.detail)
    }
    if (cached) {
      // 直链过期：只重新解析播放地址，其余元数据沿用缓存
      try {
        const fresh = await source.detail(vid)
        const merged = deps.meta!.patchStream(key, {
          streamUrl: fresh.streamUrl,
          qualities: fresh.qualities,
        })
        c.header('x-cache', 'PARTIAL')
        return c.json(merged ?? fresh)
      } catch {
        // 刷新失败时仍返回缓存（元数据可用，只是暂时不能播放）
        c.header('x-cache', 'STALE')
        return c.json(cached.detail)
      }
    }

    const detail = await source.detail(vid)
    deps.meta?.put(key, detail)
    c.header('x-cache', 'MISS')
    return c.json(detail)
  })

  // 流代理：Range 透传，规避 CORS/防盗链
  app.get('/:sourceId/stream', async (c) => {
    const source = c.get('source')
    const vid = c.req.query('v')
    if (!vid) return c.json({ error: '缺少参数 v' }, 400)
    if (!source.streamUrl || !source.fetchBinary) {
      return c.json({ error: '该源不支持流代理' }, 400)
    }
    const range = c.req.header('range')
    return pipeUpstream(
      await source.fetchBinary(await source.streamUrl(vid, c.req.query('quality')), { range }),
    )
  })

  // 图片代理：仅白名单主机（子域），规避防盗链与混合内容
  app.get('/:sourceId/image', async (c) => {
    const source = c.get('source')
    const target = c.req.query('url')
    if (!target) return c.json({ error: '缺少参数 url' }, 400)
    let u: URL
    try {
      u = new URL(target)
    } catch {
      return c.json({ error: '非法的 url' }, 400)
    }
    if (!source.fetchBinary) return c.json({ error: '该源不支持图片代理' }, 400)
    const allowed =
      u.protocol === 'https:' &&
      source.imageHosts.some((h) => u.hostname === h || u.hostname.endsWith('.' + h))
    if (!allowed) return c.json({ error: '不允许代理该主机' }, 403)

    // 图片缓存：封面基本不变，落盘一次后长期复用
    const hit = deps.images?.find(u.toString())
    if (hit) {
      const buf = readFileSync(deps.images!.path(hit))
      return new Response(buf, {
        headers: {
          'content-type': hit.endsWith('.png') ? 'image/png' : 'image/jpeg',
          'content-length': String(buf.length),
          'cache-control': 'public, max-age=31536000, immutable',
          'x-cache': 'HIT',
        },
      })
    }

    const upstream = await source.fetchBinary(u.toString())
    if (!upstream.ok) return pipeUpstream(upstream)
    const bytes = Buffer.from(await upstream.arrayBuffer())
    const ext = (upstream.headers.get('content-type') ?? '').includes('png') ? 'png' : 'jpg'
    deps.images?.save(u.toString(), bytes, ext)
    return new Response(bytes, {
      headers: {
        'content-type': ext === 'png' ? 'image/png' : 'image/jpeg',
        'content-length': String(bytes.length),
        'cache-control': 'public, max-age=31536000, immutable',
        'x-cache': 'MISS',
      },
    })
  })

  return app
}

function pageParam(c: Context): number {
  const n = Number.parseInt(c.req.query('page') ?? '1', 10)
  return Number.isFinite(n) && n > 0 ? n : 1
}
