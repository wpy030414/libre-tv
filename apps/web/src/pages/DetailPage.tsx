import type { VideoDetail, VideoSummary } from '@libre-tv/shared/types'
import { useEffect, useState } from 'react'
import { ArrowLeft, Download, Play } from 'lucide-react'
import { api, fmtDuration, fmtViews } from '@/api/client'
import { Focusable } from '@/components/Focusable'

/**
 * 详情页：海报 + 元数据 + 播放/下载/清晰度选择 + 相关推荐。
 * 播放走 /api/library/play（本地优先，在线时回退源站直放）。
 */
export function DetailPage({
  source,
  id,
  onPlay,
  onBack,
  onSelect,
}: {
  source: string
  id: string
  onPlay: (item: {
    source: string
    id: string
    title: string
    url: string
    startAtMs: number
  }) => void
  onBack: () => void
  onSelect: (v: VideoSummary) => void
}) {
  const [detail, setDetail] = useState<VideoDetail>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string>()
  const [local, setLocal] = useState<{ quality: string } | null>(null)

  useEffect(() => {
    let alive = true
    setDetail(undefined)
    setError(undefined)
    void (async () => {
      try {
        const [d, progress, lib] = await Promise.all([
          api.detail(source, id),
          api.progress(source, id).catch(() => null),
          api.library().catch(() => []),
        ])
        if (!alive) return
        setDetail(d)
        const hit = lib.find((l) => l.key === `${source}:${id}`)
        if (hit) setLocal({ quality: hit.quality })
        if (progress?.positionMs) setStartAt(progress.positionMs)
      } catch (e) {
        if (alive) setError((e as Error).message)
      }
    })()
    return () => {
      alive = false
    }
  }, [source, id])

  const [startAt, setStartAt] = useState(0)

  const play = async (quality?: string) => {
    setBusy(true)
    setNotice(undefined)
    try {
      const r = await api.play(source, id, quality)
      onPlay({ source, id, title: detail?.title ?? '', url: r.url, startAtMs: startAt })
    } catch (e) {
      setNotice((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const download = async (quality?: string) => {
    setBusy(true)
    setNotice(undefined)
    try {
      await api.download(source, id, quality)
      setNotice('已加入下载队列（完成后自动使用本地文件）')
    } catch (e) {
      setNotice((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const cover = detail ? api.image(source, detail.coverUrl) : undefined

  return (
    <div className="min-h-screen pb-24">
      {/* 背景封面大图 + 渐变遮罩 */}
      <div className="relative h-[46vh] w-full overflow-hidden">
        {cover ? (
          <img src={cover} alt="" className="h-full w-full object-cover opacity-60 blur-[2px]" />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-[hsl(var(--background))] via-background/40 to-transparent" />
        <BackButton onBack={onBack} />
      </div>

      <div className="-mt-40 px-12">
        <div className="flex gap-10">
          <div className="w-52 shrink-0 overflow-hidden rounded-2xl shadow-2xl">
            {cover ? (
              <img src={cover} alt="" className="aspect-[3/4] w-full object-cover" />
            ) : (
              <div className="aspect-[3/4] w-full bg-zinc-800" />
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-4 pt-10">
            <h1 className="line-clamp-2 text-3xl font-bold leading-tight text-white">
              {detail?.title ?? (error ? '加载失败' : '加载中…')}
            </h1>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-400">
              {detail?.uploader ? <span className="text-zinc-200">{detail.uploader}</span> : null}
              {detail?.views ? <span>{fmtViews(detail.views)}</span> : null}
              {detail?.durationSec ? <span>{fmtDuration(detail.durationSec)}</span> : null}
              {local ? (
                <span className="rounded bg-emerald-400/15 px-2 py-0.5 text-emerald-300">
                  已在本地（{local.quality}p）
                </span>
              ) : null}
            </div>

            {detail?.tags?.length ? (
              <div className="flex flex-wrap gap-2">
                {detail.tags.slice(0, 8).map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-white/10 px-3 py-1 text-xs text-zinc-300"
                  >
                    {t}
                  </span>
                ))}
              </div>
            ) : null}

            {error ? <p className="text-sm text-amber-300">{error}</p> : null}
            {notice ? <p className="text-sm text-sky-300">{notice}</p> : null}

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <ActionButton
                icon={<Play className="h-5 w-5" />}
                label={startAt > 0 ? `继续播放 ${fmtDuration(startAt / 1000)}` : '播放'}
                primary
                disabled={busy || !detail}
                onClick={() => void play()}
              />
              <ActionButton
                icon={<Download className="h-5 w-5" />}
                label={local ? '重新下载' : '下载到本地'}
                disabled={busy || !detail}
                onClick={() => void download()}
              />
              {detail?.qualities?.map((q) => (
                <ActionButton
                  key={q.label}
                  label={`${q.label}p`}
                  small
                  disabled={busy}
                  onClick={() => void play(q.label)}
                />
              ))}
            </div>
          </div>
        </div>

        {detail?.related?.length ? (
          <div className="mt-12">
            <RelatedRow videos={detail.related} onSelect={onSelect} />
          </div>
        ) : null}
      </div>
    </div>
  )
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <div className="absolute left-8 top-6">
      <Focusable onEnter={onBack} scale="sm">
        <span className="flex items-center gap-2 rounded-full bg-black/50 px-4 py-2 text-sm text-white/90 backdrop-blur">
          <ArrowLeft className="h-4 w-4" /> 返回
        </span>
      </Focusable>
    </div>
  )
}

function ActionButton({
  icon,
  label,
  onClick,
  disabled,
  primary,
  small,
}: {
  icon?: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  primary?: boolean
  small?: boolean
}) {
  return (
    <Focusable
      onEnter={disabled ? undefined : onClick}
      scale="sm"
      className={disabled ? 'pointer-events-none opacity-40' : ''}
    >
      <span
        className={[
          'flex items-center gap-2 rounded-xl font-semibold',
          small ? 'px-4 py-2 text-sm' : 'px-6 py-3 text-base',
          primary ? 'bg-white text-black' : 'bg-white/15 text-white',
        ].join(' ')}
      >
        {icon}
        {label}
      </span>
    </Focusable>
  )
}

function RelatedRow({
  videos,
  onSelect,
}: {
  videos: VideoSummary[]
  onSelect: (v: VideoSummary) => void
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-zinc-300">相关推荐</h2>
      <div className="flex gap-4 overflow-x-auto pb-6 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {videos.map((v) => (
          <Focusable
            key={`${v.source}:${v.id}`}
            onEnter={() => onSelect(v)}
            scale="sm"
            className="w-40 shrink-0"
          >
            <div className="aspect-video overflow-hidden rounded-xl bg-zinc-900">
              <img
                src={api.image(v.source, v.coverUrl)}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </div>
            <p className="mt-2 line-clamp-2 px-1 text-xs text-zinc-400">{v.title}</p>
          </Focusable>
        ))}
      </div>
    </section>
  )
}
