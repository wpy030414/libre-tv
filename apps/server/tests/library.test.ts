import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openLibraryDb, getSetting, mediaPath, setSetting } from '../src/library/db'
import { serveLocalFile } from '../src/routes/library'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'libretv-test-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('本地库 db', () => {
  it('建表并读写设置', () => {
    const lib = openLibraryDb(dir)
    expect(getSetting(lib.db, 'mode.offline')).toBeUndefined()
    setSetting(lib.db, 'mode.offline', '1')
    expect(getSetting(lib.db, 'mode.offline')).toBe('1')
    setSetting(lib.db, 'mode.offline', '0')
    expect(getSetting(lib.db, 'mode.offline')).toBe('0')
    lib.db.close()
  })

  it('mediaPath 拒绝目录穿越', () => {
    const lib = openLibraryDb(dir)
    expect(() => mediaPath(lib.mediaDir, '../../etc/passwd')).toThrow(/非法文件路径/)
    expect(mediaPath(lib.mediaDir, 'ok.mp4')).toContain('ok.mp4')
    lib.db.close()
  })
})

describe('本地文件 Range 服务', () => {
  const payload = Buffer.from('0123456789abcdef')

  it('无 Range 返回 200 全量', async () => {
    const f = join(dir, 'a.mp4')
    writeFileSync(f, payload)
    const res = serveLocalFile(f, undefined)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe('16')
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe(payload.toString())
  })

  it('Range 返回 206 与正确切片', async () => {
    const f = join(dir, 'b.mp4')
    writeFileSync(f, payload)
    const res = serveLocalFile(f, 'bytes=4-7')
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 4-7/16')
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('4567')
  })

  it('越界 Range 返回 416', () => {
    const f = join(dir, 'c.mp4')
    writeFileSync(f, payload)
    expect(serveLocalFile(f, 'bytes=100-200').status).toBe(416)
  })
})

describe('本地文件 MIME', () => {
  it('封面按 jpg、视频按 mp4 返回', () => {
    const img = join(dir, 'cover.jpg')
    const vid = join(dir, 'movie.mp4')
    writeFileSync(img, Buffer.from([0xff, 0xd8, 0xff, 0xe0]))
    writeFileSync(vid, Buffer.alloc(64))
    expect(serveLocalFile(img, undefined).headers.get('content-type')).toBe('image/jpeg')
    expect(serveLocalFile(vid, undefined).headers.get('content-type')).toBe('video/mp4')
  })
})
