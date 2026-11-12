import type { DownloadJob, LibraryItem } from '@libre-tv/shared/types'
import { useEffect, useState } from 'react'
import { Trash2, Wifi, WifiOff } from 'lucide-react'
import { api, fmtBytes, fmtDuration } from '@/api/client'
import { Focusable } from '@/components/Focusable'

/** 本地库：已下载条目 + 下载队列 + 在线/离线切换 */
export function LibraryPage({
  onPlay,
  onSelect,
}: {
  onPlay: (item: {
    source: string
    id: string
    title: string
    url: string
    startAtMs: number
  }) => void
  onSelect: (item: LibraryItem) => void
}) {
  const [items, setItems] = useState<LibraryItem[]>([])
  const [jobs, setJobs] = useState<DownloadJob[]>([])
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState<string>()

  const refresh = async () => {
    try {
      const [lib, dl, mode] = await Promise.all([api.library(), api.downloads(), api.mode()])
      setItems(lib)
      setJobs(dl)
      setOffline(mode.offline)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  useEffect(() => {
    void refresh()
    const id = setInterval(() => void refresh(), 3000)
    return () => clearInterval(id)
  }, [])

  const playLocal = async (item: LibraryItem) => {
    const progress = await api.progress(item.source, item.id).catch(() => null)
    onPlay({
      source: item.source,
      id: item.id,
      title: item.meta.title,
      url: `/api/library/media/${item.fileName}`,
      startAtMs: progress?.positionMs ?? 0,
    })
  }

  const remove = async (key: string) => {
    await api.deleteItem(key).catch(() => {})
    await refresh()
  }

  const active = jobs.filter((j) => j.status === 'downloading' || j.status === 'queued')
  const failed = jobs.filter((j) => j.status === 'error')

  return (
    <div className="space-y-10 px-12 pb-24 pt-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">本地库</h1>
        <Focusable onEnter={() => void api.setMode(!offline).then(refresh)} scale="sm">
          <span
            className={[
              'flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold',
              offline ? 'bg-amber-400 text-black' : 'bg-white/10 text-white',
            ].join(' ')}
          >
            {offline ? <WifiOff className="h-4 w-4" /> : <Wifi className="h-4 w-4" />}
            {offline ? '离线模式（仅本地）' : '在线模式'}
          </span>
        </Focusable>
      </div>

      {error ? <p className="text-sm text-amber-300">{error}</p> : null}

      {active.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">下载队列</h2>
          {active.map((j) => (
            <div key={j.key} className="rounded-xl bg-white/5 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="truncate text-zinc-200">
                  {j.title || j.key} · {j.quality}p
                </span>
                <span className="ml-4 shrink-0 tabular-nums text-zinc-400">
                  {j.status === 'queued'
                    ? '排队中'
                    : `${j.progress}% · ${fmtBytes(j.receivedBytes)}`}
                </span>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-sky-400"
                  style={{ width: `${j.progress}%` }}
                />
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {failed.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">失败任务</h2>
          {failed.map((j) => (
            <p key={j.key} className="text-sm text-amber-300/90">
              {j.title || j.key}：{j.error}
            </p>
          ))}
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
          已下载 · {items.length}
        </h2>
        {items.length === 0 ? (
          <p className="text-sm text-zinc-500">
            {offline ? '离线模式下没有可播放内容，请先切回在线并下载。' : '还没有下载任何视频。'}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-5 md:grid-cols-3 xl:grid-cols-4">
            {items.map((it) => (
              <Focusable
                key={it.key}
                onEnter={() => void playLocal(it)}
                className="overflow-hidden rounded-2xl bg-zinc-900"
              >
                <div className="aspect-video overflow-hidden">
                  {it.coverFile ? (
                    <img
                      src={`/api/library/media/${it.coverFile}`}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center bg-zinc-800 p-4 text-center text-xs text-zinc-500">
                      {it.meta.title}
                    </div>
                  )}
                </div>
                <div className="space-y-1 p-3">
                  <p className="line-clamp-2 text-sm font-medium text-white">{it.meta.title}</p>
                  <div className="flex items-center justify-between text-[11px] text-zinc-500">
                    <span>
                      {it.quality}p · {fmtBytes(it.sizeBytes)}
                      {it.meta.durationSec ? ` · ${fmtDuration(it.meta.durationSec)}` : ''}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onSelect(it)
                      }}
                      className="text-zinc-600 hover:text-zinc-300"
                      aria-label="详情"
                    >
                      <Trash2
                        className="h-3.5 w-3.5"
                        onClick={(e) => {
                          e.stopPropagation()
                          void remove(it.key)
                        }}
                      />
                    </button>
                  </div>
                </div>
              </Focusable>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
