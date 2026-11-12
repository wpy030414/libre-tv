import type { VideoSummary } from '@libre-tv/shared/types'
import { useState } from 'react'
import { api, fmtDuration, fmtViews } from '@/api/client'
import { Focusable } from './Focusable'

/** tvOS 海报卡片：竖版 2:3 海报 + 底部渐变标题 */
export function PosterCard({
  video,
  onSelect,
  focusKey,
}: {
  video: VideoSummary
  onSelect: () => void
  focusKey?: string
}) {
  const [failed, setFailed] = useState(false)
  const cover = api.image(video.source, video.coverUrl)

  return (
    <div className="w-52 shrink-0 md:w-56">
      <Focusable focusKey={focusKey} onEnter={onSelect} className="w-full">
        <div className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-zinc-900">
          {cover && !failed ? (
            <img
              src={cover}
              alt=""
              loading="lazy"
              onError={() => setFailed(true)}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-950 px-3 text-center text-xs text-zinc-500">
              {video.title}
            </div>
          )}

          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />

          {video.durationSec ? (
            <span className="absolute right-2.5 top-2.5 rounded-md bg-black/70 px-2 py-0.5 text-xs font-medium tabular-nums text-white/90 backdrop-blur">
              {fmtDuration(video.durationSec)}
            </span>
          ) : null}

          <div className="absolute inset-x-0 bottom-0 p-4">
            <p className="line-clamp-2 text-[15px] font-semibold leading-snug text-white drop-shadow">
              {video.title}
            </p>
          </div>
        </div>
      </Focusable>

      <div className="mt-2 flex items-center gap-2 px-1 text-xs text-zinc-400">
        <span className="truncate">{video.uploader ?? ''}</span>
        {video.views ? <span className="shrink-0">· {fmtViews(video.views)}</span> : null}
      </div>
    </div>
  )
}

/** 横向海报行：tvOS 首页经典 shelf，标题 + 可左右滚动的卡片 */
export function PosterRow({
  title,
  videos,
  onSelect,
  focusKey,
}: {
  title: string
  videos: VideoSummary[]
  onSelect: (v: VideoSummary) => void
  focusKey?: string
}) {
  if (videos.length === 0) return null
  return (
    <section className="space-y-3" data-shelf={focusKey}>
      <h2 className="px-12 text-lg font-semibold tracking-tight text-zinc-300">{title}</h2>
      <div className="flex gap-4 overflow-x-auto px-12 pb-6 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {videos.map((v, i) => (
          <PosterCard
            key={`${v.source}:${v.id}`}
            video={v}
            onSelect={() => onSelect(v)}
            focusKey={focusKey ? `${focusKey}-${i}` : undefined}
          />
        ))}
      </div>
    </section>
  )
}
