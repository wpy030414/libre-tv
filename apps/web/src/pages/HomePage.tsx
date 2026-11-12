import type { VideoSummary } from '@libre-tv/shared/types'
import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { PosterRow } from '@/components/PosterCard'

const SHELVES: Array<{ key: string; title: string }> = [
  { key: 'new', title: '最新上傳' },
  { key: '裏番', title: '裏番' },
  { key: 'Motion Anime', title: 'Motion Anime' },
  { key: '3DCG', title: '3DCG' },
]

export function HomePage({ onSelect }: { onSelect: (v: VideoSummary) => void }) {
  const [rows, setRows] = useState<Array<{ title: string; items: VideoSummary[] }>>([])
  const [error, setError] = useState<string>()

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const results = await Promise.all(
          SHELVES.map(async (s) => ({
            title: s.title,
            items: (await api.list('hanime1', 1, s.key === 'new' ? undefined : s.key)).items,
          })),
        )
        if (alive) setRows(results)
      } catch (e) {
        if (alive) setError((e as Error).message)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="space-y-2 pb-24">
      {error ? <p className="px-12 pt-8 text-sm text-amber-300">加载失败：{error}</p> : null}
      {rows.length === 0 && !error ? (
        <p className="px-12 pt-10 text-sm text-zinc-500">正在加载片库…</p>
      ) : null}
      {rows.map((r, i) => (
        <PosterRow
          key={r.title}
          title={r.title}
          videos={r.items}
          onSelect={onSelect}
          focusKey={`shelf-${i}`}
        />
      ))}
    </div>
  )
}
