import { useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { useEffect, useState } from 'react'
import { api } from '@/api/client'

/**
 * 顶部 Tab 栏（tvOS 风格）：获焦时大标题 + 阴影浮起。
 * 左右方向键在 tab 间移动，确认键进入。
 */
export interface TabItem {
  key: string
  label: string
}

export function TopTabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: TabItem[]
  active: string
  onSelect: (key: string) => void
}) {
  return (
    <nav className="flex items-center gap-8 px-12 pt-8">
      {tabs.map((t) => (
        <Tab
          key={t.key}
          focusKey={`TAB-${t.key}`}
          label={t.label}
          active={active === t.key}
          onSelect={() => onSelect(t.key)}
        />
      ))}
    </nav>
  )
}

function Tab({
  label,
  active,
  onSelect,
  focusKey,
}: {
  label: string
  active: boolean
  onSelect: () => void
  focusKey: string
}) {
  const { ref, focused } = useFocusable({ focusKey, onEnterPress: onSelect })
  return (
    <button
      ref={ref}
      onClick={onSelect}
      className={[
        'rounded-full px-1 text-xl font-semibold transition-all duration-200',
        focused
          ? 'scale-110 text-white drop-shadow-[0_0_18px_rgba(255,255,255,0.35)]'
          : active
            ? 'text-white'
            : 'text-zinc-500',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

/** 全局状态条：在线/离线 + 下载中任务数，右上角常驻 */
export function StatusPill() {
  const [offline, setOffline] = useState(false)
  const [active, setActive] = useState(0)

  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const [m, jobs] = await Promise.all([api.mode(), api.downloads()])
        if (!alive) return
        setOffline(m.offline)
        setActive(jobs.filter((j) => j.status === 'downloading' || j.status === 'queued').length)
      } catch {
        /* 离线/服务异常时保持静默 */
      }
    }
    void tick()
    const id = setInterval(tick, 4000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  return (
    <div className="pointer-events-none absolute right-10 top-12 z-30 flex items-center gap-2 text-xs font-medium">
      {active > 0 ? (
        <span className="rounded-full bg-black/60 px-3 py-1 text-white/80 backdrop-blur">
          ↓ {active} 个下载中
        </span>
      ) : null}
      <span
        className={[
          'rounded-full px-3 py-1 backdrop-blur',
          offline ? 'bg-amber-400/20 text-amber-300' : 'bg-emerald-400/15 text-emerald-300',
        ].join(' ')}
      >
        {offline ? '离线模式' : '在线'}
      </span>
    </div>
  )
}
