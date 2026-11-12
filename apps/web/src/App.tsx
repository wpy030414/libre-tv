import type { LibraryItem, VideoSummary } from '@libre-tv/shared/types'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { init, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { api } from '@/api/client'
import { Player } from '@/components/Player'
import { StatusPill, TopTabs } from '@/components/TopTabs'
import { DetailPage } from '@/pages/DetailPage'
import { HomePage } from '@/pages/HomePage'
import { LibraryPage } from '@/pages/LibraryPage'
import { SearchPage } from '@/pages/SearchPage'

type Page =
  | { name: 'home' }
  | { name: 'search' }
  | { name: 'library' }
  | { name: 'detail'; source: string; id: string }

interface PlayTarget {
  source: string
  id: string
  title: string
  url: string
  startAtMs: number
}

const TABS = [
  { key: 'home', label: '首页' },
  { key: 'search', label: '搜索' },
  { key: 'library', label: '本地库' },
]

/** hash 路由：让刷新/深链保持位置，也便于外部直达详情 */
function parseHash(): Page {
  const h = window.location.hash.replace(/^#\/?/, '')
  if (h.startsWith('detail/')) {
    const [, source, id] = h.split('/')
    if (source && id) return { name: 'detail', source, id }
  }
  if (h === 'search') return { name: 'search' }
  if (h === 'library') return { name: 'library' }
  return { name: 'home' }
}

function toHash(p: Page): string {
  switch (p.name) {
    case 'detail':
      return `#/detail/${p.source}/${p.id}`
    case 'home':
      return '#/'
    default:
      return `#/${p.name}`
  }
}

export function App() {
  const [page, setPage] = useState<Page>(parseHash)
  const [playing, setPlaying] = useState<PlayTarget | null>(null)
  const [ready, setReady] = useState(false)

  // 空间导航只需初始化一次；页面切换后重新聚焦顶部 tab
  useEffect(() => {
    init({
      debug: false,
      visualDebug: false,
      shouldFocusDOMNode: true,
      shouldUseNativeEvents: false,
    })
    setReady(true)
  }, [])

  // 页面 → hash，并响应浏览器前进/后退
  useEffect(() => {
    const want = toHash(page)
    if (window.location.hash !== want) window.history.pushState(null, '', want)
  }, [page])

  useEffect(() => {
    const onPop = () => setPage(parseHash())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    if (!ready) return
    const active = page.name === 'detail' ? 'home' : page.name
    // 延迟一帧，等新页面组件挂载后再设焦点
    const t = setTimeout(() => {
      // 该 key 尚未注册时静默（首屏渲染竞态）
      void Promise.resolve(setFocus(active === 'library' ? 'LIBRARY-MODE' : `TAB-${active}`)).catch(
        () => {},
      )
    }, 60)
    return () => clearTimeout(t)
  }, [page, ready])

  const openDetail = useCallback(
    (v: { source: string; id: string } | VideoSummary | LibraryItem) => {
      setPage({ name: 'detail', source: v.source, id: v.id })
    },
    [],
  )

  const startPlay = useCallback(async (t: PlayTarget) => {
    // 在线模式下每次播放都重新解析（签名直链会过期），本地条目直接本地地址
    if (t.url.startsWith('/api/library/media/')) {
      setPlaying(t)
      return
    }
    try {
      const r = await api.play(t.source, t.id)
      setPlaying({ ...t, url: r.url })
    } catch {
      setPlaying(t)
    }
  }, [])

  const tabs = useMemo(() => TABS, [])

  return (
    <div className="relative min-h-screen bg-[hsl(var(--background))] pb-10">
      <StatusPill />
      {!playing ? (
        <TopTabs
          tabs={tabs}
          active={page.name === 'detail' ? 'home' : page.name}
          onSelect={(k) =>
            setPage(
              k === 'search'
                ? { name: 'search' }
                : k === 'library'
                  ? { name: 'library' }
                  : { name: 'home' },
            )
          }
        />
      ) : null}

      <main className="relative">
        {!playing && page.name === 'home' ? <HomePage onSelect={openDetail} /> : null}
        {!playing && page.name === 'search' ? <SearchPage onSelect={openDetail} /> : null}
        {!playing && page.name === 'library' ? (
          <LibraryPage onPlay={startPlay} onSelect={openDetail} />
        ) : null}
        {!playing && page.name === 'detail' ? (
          <DetailPage
            key={`${page.source}:${page.id}`}
            source={page.source}
            id={page.id}
            onPlay={startPlay}
            onBack={() => setPage({ name: 'home' })}
            onSelect={openDetail}
          />
        ) : null}
      </main>

      {playing ? (
        <Player
          src={playing.url}
          title={playing.title}
          startAtMs={playing.startAtMs}
          onExit={() => setPlaying(null)}
          onProgress={(pos, dur) => {
            void api.saveProgress(playing.source, playing.id, pos, dur).catch(() => {})
          }}
        />
      ) : null}
    </div>
  )
}
