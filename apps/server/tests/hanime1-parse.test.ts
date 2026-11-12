import { describe, expect, it } from 'vitest'
import { Hanime1Source, extractVid, parseDuration, parseViews } from '../src/sources/hanime1/index'

// 构造最小 HTML 片段（结构取自 hanime1.me 真实页面，文本用占位，不含敏感内容）
function card(vid: number, extra = '') {
  return `
  <div class="video-item-container">
    <div class="horizontal-card">
      <a href="https://hanime1.me/watch?v=${vid}" class="video-link">
        <div class="thumb-container">
          <img class="main-thumb" src="https://vdownload.hembed.com/image/thumbnail/${vid}l.jpg?secure=x">
          <div class="duration">${extra || '12:34'}</div>
          <div class="stats-container">
            <div class="stat-item"><i class="material-icons">thumb_up</i>96%</div>
            <div class="stat-item">8.5萬次</div>
          </div>
        </div>
        <div class="title">Title ${vid}</div>
      </a>
      <div class="subtitle">
        <a href="https://hanime1.me/search?query=studio">studio-${vid}</a>
        <span class="subtitle-time">• 3週前</span>
      </div>
    </div>
  </div>`
}

const adCard = `
  <div class="video-item-container">
    <div class="horizontal-card">
      <a href="https://l.erodalabs.com/s/abc" class="video-link">
        <div class="thumb-container"><img class="main-thumb" src="https://vdownload.hembed.com/ad.jpg"></div>
        <div class="title">赞助广告</div>
      </a>
    </div>
  </div>`

describe('hanime1 列表解析', () => {
  const src = new Hanime1Source()

  it('抽取卡片必需字段', () => {
    const items = src.parseCards(card(1) + card(2))
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      id: '1',
      source: 'hanime1',
      title: 'Title 1',
      durationSec: 754,
      views: 85000,
      uploader: 'studio-1',
    })
    expect(items[0]!.coverUrl).toContain('hembed.com')
  })

  it('跳过无 watch 链接的广告卡', () => {
    const items = src.parseCards(adCard + card(3))
    expect(items.map((i) => i.id)).toEqual(['3'])
  })

  it('同一 id 去重', () => {
    expect(src.parseCards(card(7) + card(7))).toHaveLength(1)
  })

  it('空页面返回空数组而非报错', () => {
    expect(src.parseCards('<html><body></body></html>')).toEqual([])
  })
})

describe('hanime1 详情解析', () => {
  const src = new Hanime1Source()
  const watch = `
  <html><body>
    <h3 class="video-details-wrapper">[Studio] Some Title</h3>
    <a id="video-artist-name" href="#">Studio Name</a>
    <div id="player-div-wrapper">
      <video id="player" poster="https://vdownload.hembed.com/image/thumbnail/42h.jpg?secure=b">
        <source src="https://vdownload.hembed.com/42-720p.mp4?secure=a" type="video/mp4" size="720">
        <source src="https://vdownload.hembed.com/42-1080p.mp4?secure=c" type="video/mp4" size="1080">
        <source src="https://vdownload.hembed.com/42-480p.mp4?secure=d" type="video/mp4" size="480">
      </video>
    </div>
    <div id="related-tabcontent">${card(43)}</div>
  </body></html>`

  it('解析标题、上传者、清晰度（按高低排序）与相关推荐', () => {
    const d = src.parseWatch('42', watch)
    expect(d.title).toBe('[Studio] Some Title')
    expect(d.uploader).toBe('Studio Name')
    expect(d.qualities?.map((q) => q.label)).toEqual(['1080', '720', '480'])
    expect(d.streamUrl).toContain('1080p')
    expect(d.streamProxyUrl).toBe('/api/sources/hanime1/stream?v=42&quality=1080')
    expect(d.related?.map((r) => r.id)).toEqual(['43'])
  })

  it('无播放源时抛 502 级错误', async () => {
    expect(() => src.parseWatch('42', '<video id="player"></video>')).toThrow(/播放地址解析失败/)
  })
})

describe('工具函数', () => {
  it('extractVid', () => {
    expect(extractVid('https://hanime1.me/watch?v=409030')).toBe('409030')
    expect(extractVid('/watch?x=1&v=12')).toBe('12')
    expect(extractVid('https://example.com/')).toBeUndefined()
  })

  it('parseDuration', () => {
    expect(parseDuration('09:34')).toBe(574)
    expect(parseDuration('1:03:06')).toBe(3786)
    expect(parseDuration('bad')).toBeUndefined()
  })

  it('parseViews', () => {
    expect(parseViews('8.5萬次')).toBe(85000)
    expect(parseViews('1.2万')).toBe(12000)
    expect(parseViews('3,412次')).toBe(3412)
    expect(parseViews('12.3M')).toBe(12300000)
  })
})
