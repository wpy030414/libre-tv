import type { VideoSummary } from '@libre-tv/shared/types'
import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { PosterRow } from '@/components/PosterCard'

const SHELVES: Array<{ key: string; title: string; category?: string }> = [
  { key: 'new', title: '最新上傳' },
  { key: '裏番', title: '裏番', category: '裏番' },
  { key: 'motion', title: 'Motion Anime', category: 'Motion Anime' },
  { key: '3dcg', title: '3DCG', category: '3DCG' },
]

interface RowState {
  title: string
  items: VideoSummary[]
  loading: boolean
  error?: string
}

/**
 * 首页：每行独立请求、独立渲染。
 * 不依赖 Promise.all——单行变慢或失败不会让整页空白，标题也不会因整体状态抖动而闪烁。
 */
export function HomePage({ onSelect }: { onSelect: (v: VideoSummary) => void }) {
  const [rows, setRows] = useState<RowState[]>(() =>
    SHELVES.map((s) => ({ title: s.title, items: [], loading: true })),
  )

  useEffect(() => {
    let alive = true
    const patch = (i: number, next: Partial<RowState>) => {
      if (!alive) return
      setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...next } : r)))
    }

    // 逐行发起，谁先回来谁先渲染；不因一行失败拖垮整页
    SHELVES.forEach((s, i) => {
      void api
        .list('hanime1', 1, s.category)
        .then((page) => patch(i, { items: page.items, loading: false }))
        .catch((e: Error) => patch(i, { loading: false, error: e.message }))
    })

    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="space-y-2 pb-24">
      {rows.map((r, i) =>
        r.loading ? (
          <ShelfSkeleton key={r.title} title={r.title} index={i} />
        ) : r.error ? (
          <section key={r.title} className="space-y-3">
            <h2 className="px-12 text-lg font-semibold tracking-tight text-zinc-300">{r.title}</h2>
            <p className="px-12 text-sm text-amber-300/90">加载失败：{r.error}</p>
          </section>
        ) : (
          <PosterRow
            key={r.title}
            title={r.title}
            videos={r.items}
            onSelect={onSelect}
            focusKey={`shelf-${i}`}
          />
        ),
      )}
    </div>
  )
}

/** 加载占位：保留标题与卡片轮廓，避免内容跳变（TV 端尤其明显） */
function ShelfSkeleton({ title, index }: { title: string; index: number }) {
  return (
    <section className="space-y-3" aria-busy="true">
      <h2 className="px-12 text-lg font-semibold tracking-tight text-zinc-300">{title}</h2>
      <div className="flex gap-4 overflow-hidden px-12 pb-6 pt-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={`${index}-${i}`} className="w-52 shrink-0 md:w-56">
            <div className="aspect-[3/4] animate-pulse rounded-2xl bg-white/[0.06]" />
            <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-white/[0.05]" />
          </div>
        ))}
      </div>
    </section>
  )
}
