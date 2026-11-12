import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { createSources } from './sources'
import { sourceRoutes } from './routes/sources'
import { openLibraryDb } from './library/db'
import { Downloader } from './library/downloader'
import { libraryRoutes } from './routes/library'
import { createImageCache, createMetaCache } from './library/cache'

// 从仓库根加载 .env：
// 开发时本文件在 apps/server/src/ → 向上三级；生产产物在 apps/server/dist/ → 同样三级
const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..', '..', '..')
config({ path: join(repoRoot, '.env') })

const PORT = parseInt(process.env.PORT || '11408', 10)

const sources = createSources({
  hanime1Proxy: process.env.HANIME1_PROXY || undefined,
  hanime1DnsProxy: process.env.HANIME1_DNS_PROXY || undefined,
  hanime1PinnedIp: process.env.HANIME1_RESOLVE || undefined,
  hanime1Cookie: process.env.HANIME1_COOKIE || undefined,
  hanime1BaseUrl: process.env.HANIME1_BASE_URL || undefined,
})

const library = openLibraryDb(process.env.DATA_DIR || join(repoRoot, 'data'))

const downloader = new Downloader({
  library,
  getDetail: async (sourceId, id) => {
    const s = sources.get(sourceId)
    if (!s) throw new Error(`未注册的源：${sourceId}`)
    return s.detail(id)
  },
  getStreamUrl: async (sourceId, id, quality) => {
    const s = sources.get(sourceId)
    if (!s?.streamUrl) throw new Error(`源不支持流：${sourceId}`)
    return s.streamUrl(id, quality)
  },
  fetchImage: async (url) => {
    const s = sources.get('hanime1')
    return s?.fetchBinary ? s.fetchBinary(url) : fetch(url)
  },
  log: (m) => console.log(m),
})

const app = new Hono()

// API 路由
app.get('/api/health', (c) => c.json({ status: 'ok' }))
const metaCache = createMetaCache(library)
const imageCache = createImageCache(join(library.mediaDir, '.cover-cache'))

app.route('/api/sources', sourceRoutes(sources, { meta: metaCache, images: imageCache }))
app.route(
  '/api/library',
  libraryRoutes({
    library,
    downloader,
    getDetail: async (s, id) => sources.get(s)!.detail(id),
    getStreamUrl: async (s, id, q) => sources.get(s)!.streamUrl!(id, q),
  }),
)

// --- 生产模式：托管前端静态文件 ---
// dist/ 目录结构预期：dist/index.js + dist/client/（vp build 产物）
const clientDir = join(__dirname, 'client')
if (existsSync(clientDir)) {
  app.get('/assets/*', async (c) => {
    const filePath = join(clientDir, c.req.path)
    if (!existsSync(filePath)) return c.notFound()
    const ext = filePath.split('.').pop() || ''
    const mime: Record<string, string> = {
      js: 'application/javascript',
      mjs: 'application/javascript',
      css: 'text/css',
      html: 'text/html',
      svg: 'image/svg+xml',
      png: 'image/png',
      ico: 'image/x-icon',
      json: 'application/json',
      woff2: 'font/woff2',
      woff: 'font/woff',
    }
    return c.body(readFileSync(filePath), 200, {
      'Content-Type': mime[ext] || 'application/octet-stream',
    })
  })

  // SPA fallback：所有非 /api 路径返回 index.html
  app.get('*', (c) => {
    if (c.req.path.startsWith('/api')) return c.notFound()
    const html = readFileSync(join(clientDir, 'index.html'), 'utf-8')
    return c.html(html)
  })
}

console.log(`Server starting on port ${PORT}...`)
serve({ fetch: app.fetch, port: PORT })
