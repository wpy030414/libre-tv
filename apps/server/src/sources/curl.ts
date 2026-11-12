import { spawn } from 'node:child_process'

/**
 * curl 传输层。
 *
 * 为什么用 curl 而不是 Node fetch：hanime1 前面是 Cloudflare WAF，
 * 判定依据包含 TLS ClientHello 指纹。系统 curl（Schannel/OpenSSL）的指纹能过，
 * Node/undici 的 TLS 指纹即使带上有效 cf_clearance 也会被给到 WAF ban 页。
 * 因此上游请求统一经 curl 子进程发出；响应以临时文件收集（-D 头 / -o body）。
 *
 * 安全：参数全部走 argv 数组，不经 shell；URL 由调用方从常量与已校验 id 构造。
 */

export interface CurlRequest {
  url: string
  headers?: Record<string, string>
  /** 可选代理：http://host:port 或 socks5://host:port */
  proxy?: string
  /** Range 头（流代理） */
  range?: string
  /** 失败重试次数（默认 0；列表/详情可给 1） */
  retries?: number
  /** 超时（秒） */
  timeoutSec?: number
  /** 覆盖解析：host → IPv4（绕开本地 DNS 污染） */
  resolveMap?: Record<string, string>
}

export interface CurlResponse {
  status: number
  headers: Record<string, string>
  /** body 所在的临时文件路径（调用方负责 unlink） */
  bodyFile?: string
  /** 小响应（< maxBuffer）直接返回文本，不再给 bodyFile */
  text?: string
}

const MAX_BUFFER = 8 * 1024 * 1024

export async function curlRequest(req: CurlRequest): Promise<CurlResponse> {
  let attempt = 0
  for (;;) {
    try {
      return await runOnce(req)
    } catch (err) {
      if (attempt++ >= (req.retries ?? 0)) throw err
      // 网络级失败才重试；HTTP 错误码由调用方判定
    }
  }
}

async function runOnce(req: CurlRequest): Promise<CurlResponse> {
  const fs = await import('node:fs/promises')
  const os = await import('node:os')
  const path = await import('node:path')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'libretv-'))
  const headerFile = path.join(dir, 'headers.txt')
  const bodyFile = path.join(dir, 'body.bin')

  const args: string[] = [
    '-sS',
    '-L',
    '--max-redirs',
    '3',
    '--connect-timeout',
    '10',
    '--max-time',
    String(req.timeoutSec ?? 30),
    '-D',
    headerFile,
    '-o',
    bodyFile,
    '-w',
    '%{http_code}',
  ]
  if (req.proxy) args.push('--proxy', req.proxy)
  else {
    // 无代理：强制 IPv4 + 用 DoH 结果覆盖解析（本地 DNS 被污染的站点）
    args.push('-4')
    for (const [host, ip] of Object.entries(req.resolveMap ?? {})) {
      args.push('--resolve', `${host}:443:${ip}`)
    }
  }
  // curl -r 只接受 `start-end`，不接受 HTTP 的 `bytes=start-end` 写法
  if (req.range) args.push('-r', req.range.trim().replace(/^bytes=/i, ''))
  const headers: Record<string, string> = {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
    ...(req.range ? {} : {}),
    ...req.headers,
  }
  // Cloudflare 按头名原始大小写做指纹：小写 user-agent/cookie 会直接进 WAF ban，
  // 因此头名一律规范化为浏览器形态的大小写
  for (const [k, v] of Object.entries(headers)) args.push('-H', `${canonicalHeader(k)}: ${v}`)
  args.push(req.url)

  try {
    const code = await spawnCurl(args)
    const status = Number.parseInt(code.trim(), 10) || 0
    const headerText = await fs.readFile(headerFile, 'utf-8').catch(() => '')
    const respHeaders = parseHeaders(headerText)
    const stat = await fs.stat(bodyFile).catch(() => undefined)
    if (!stat) return { status, headers: respHeaders }
    if (stat.size <= MAX_BUFFER) {
      const text = await fs.readFile(bodyFile, 'utf-8')
      await fs.rm(dir, { recursive: true, force: true })
      return { status, headers: respHeaders, text }
    }
    return { status, headers: respHeaders, bodyFile }
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true })
    const msg = (err as Error).message || String(err)
    if (/code 0|Could not resolve|Connection|timed out|SSL|schannel/i.test(msg)) {
      throw new CurlError(`上游连接失败：${msg.slice(0, 140)}`, 502)
    }
    throw new CurlError(`curl 执行失败：${msg.slice(0, 140)}`, 502)
  }
}

export class CurlError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'CurlError'
  }
}

function parseHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  // 重定向会多次出现头块，取最后一个（最终响应）
  const blocks = raw.split(/\r?\n\r?\n/).filter(Boolean)
  const last = blocks[blocks.length - 1] ?? raw
  for (const line of last.split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i > 0 && !line.startsWith('HTTP/')) {
      out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
    }
  }
  return out
}

function spawnCurl(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('curl', args, { windowsHide: true })
    let out = ''
    let err = ''
    child.stdout.on('data', (d: Buffer) => (out += d.toString()))
    child.stderr.on('data', (d: Buffer) => (err += d.toString()))
    child.on('error', (e) => reject(new Error(e.message)))
    child.on('close', (code: number | null) => {
      if (code === 0) resolve(out)
      else reject(new Error(`curl exit ${code}: ${err.trim() || out.trim()}`))
    })
  })
}

/** 供流代理：把 curl 的 body 文件包装成 Web ReadableStream */
export async function streamFile(file: string): Promise<ReadableStream<Uint8Array>> {
  const { createReadStream } = await import('node:fs')
  const { Readable } = await import('node:stream')
  return Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>
}

/** 头名规范化为浏览器形态（Cloudflare 按原始大小写做 WAF 指纹） */
const CANONICAL: Record<string, string> = {
  'user-agent': 'User-Agent',
  accept: 'Accept',
  'accept-language': 'Accept-Language',
  'accept-encoding': 'Accept-Encoding',
  cookie: 'Cookie',
  referer: 'Referer',
  origin: 'Origin',
  range: 'Range',
  'if-range': 'If-Range',
  'if-none-match': 'If-None-Match',
  'if-modified-since': 'If-Modified-Since',
  'content-type': 'Content-Type',
}

export function canonicalHeader(name: string): string {
  const lower = name.toLowerCase()
  if (CANONICAL[lower]) return CANONICAL[lower]
  return lower.replace(/(^|-)([a-z])/g, (_, d: string, c: string) => d + c.toUpperCase())
}
