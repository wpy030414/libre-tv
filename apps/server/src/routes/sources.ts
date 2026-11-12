import type { Context } from 'hono'
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
  headers.set('cache-control', 'public, max-age=3600')
  return new Response(upstream.body, { status: upstream.status, headers })
}

export function sourceRoutes(sources: Map<string, RegisteredSource>) {
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
    return c.json(await c.get('source').detail(c.req.param('vid')))
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
    return pipeUpstream(await source.fetchBinary(u.toString()))
  })

  return app
}

function pageParam(c: Context): number {
  const n = Number.parseInt(c.req.query('page') ?? '1', 10)
  return Number.isFinite(n) && n > 0 ? n : 1
}
