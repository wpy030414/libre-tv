import type { LibraryItem, VideoSummary } from '@libre-tv/shared/types'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { destroy, init, setFocus } from '@noriginmedia/norigin-spatial-navigation'
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

// 必须在任何 useFocusable 注册之前完成初始化：子组件的 useFocusable 在
// 渲染期注册，而父组件的 useEffect 更晚执行。放在模块顶层可保证顺序。
init({
  debug: false,
  visualDebug: false,
  shouldFocusDOMNode: true,
  shouldUseNativeEvents: false,
})

export function App() {
  const [page, setPage] = useState<Page>(parseHash)
  const [playing, setPlaying] = useState<PlayTarget | null>(null)
  const [ready, setReady] = useState(false)

  // 空间导航初始化。
  // 注意：库的 init() 在 enabled 为 true 时整段跳过初始化（含 layoutAdapter），
  // 而 React StrictMode 会挂载→卸载→再挂载，第二次 init 若不先 destroy 会留下
  // layoutAdapter=undefined，随后 updateLayout 抛 measureLayout 错误。
  useEffect(() => {
    // StrictMode 的卸载会 destroy 掉全局单例，重新挂载时必须再 init，
    // 否则后续 addFocusable 时 layoutAdapter 为 undefined
    init({
      debug: false,
      visualDebug: false,
      shouldFocusDOMNode: true,
      shouldUseNativeEvents: false,
    })
    setReady(true)
    return () => {
      setReady(false)
      destroy()
    }
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
    // 不主动触发 updateAllLayouts：库会遍历所有已注册焦点节点，
    // 页面切换瞬间旧节点已卸载但尚未注销，遍历会对 undefined 调 measureLayout。
    // 改为等新页面挂载并自注册后（两帧）再设焦点。
    const active = page.name === 'detail' ? 'home' : page.name
    const key = active === 'library' ? 'LIBRARY-MODE' : `TAB-${active}`
    let inner: ReturnType<typeof setTimeout> | undefined
    const t = setTimeout(() => {
      inner = setTimeout(() => {
        try {
          void setFocus(key).catch(() => {})
        } catch {
          /* key 未注册：保持现状 */
        }
      }, 80)
    }, 32)
    return () => {
      clearTimeout(t)
      if (inner) clearTimeout(inner)
    }
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
