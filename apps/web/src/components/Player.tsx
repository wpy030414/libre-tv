import { useEffect, useRef, useState } from 'react'
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation'

/**
 * tvOS 风格全屏播放器：
 * - <video> 原生控件全部隐藏，仅用自绘控制条（遥控器友好）
 * - 确认键 = 播放/暂停，左右 = 快退/快进 10s，上下 = 音量
 * - 任意键唤出控制条，5s 无操作自动隐藏
 */
export function Player({
  src,
  title,
  startAtMs = 0,
  onExit,
  onProgress,
}: {
  src: string
  title: string
  startAtMs?: number
  onExit: () => void
  onProgress: (positionMs: number, durationMs: number) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const { ref: focusRef } = useFocusable({
    focusKey: 'PLAYER',
    isFocusBoundary: true,
    onEnterPress: () => toggle(),
  })
  const [playing, setPlaying] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSave = useRef(0)

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (startAtMs > 0) v.currentTime = startAtMs / 1000
    void v.play().catch(() => setPlaying(false))
  }, [startAtMs])

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
      // 卸载时主动暂停并清空 src：媒体随 DOM 移除会中断未决的 play()，
      // 不处理会在控制台留下 AbortError
      const v = videoRef.current
      if (v) {
        v.pause()
        v.removeAttribute('src')
        v.load()
      }
    }
  }, [])

  const poke = () => {
    setShowControls(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setShowControls(false), 5000)
  }

  const toggle = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) void v.play().catch(() => setPlaying(false))
    else v.pause()
    poke()
  }

  const seek = (delta: number) => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Math.max(0, Math.min(v.duration || Infinity, v.currentTime + delta))
    poke()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const v = videoRef.current
      if (!v) return
      switch (e.key) {
        case ' ':
        case 'Enter':
          e.preventDefault()
          toggle()
          break
        case 'ArrowLeft':
          e.preventDefault()
          seek(-10)
          break
        case 'ArrowRight':
          e.preventDefault()
          seek(10)
          break
        case 'Escape':
        case 'Backspace':
          onExit()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div ref={focusRef} className="fixed inset-0 z-50 bg-black" onMouseMove={poke}>
      <video
        ref={videoRef}
        src={src}
        className="h-full w-full object-contain"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => {
          const v = e.currentTarget
          setPosition(v.currentTime * 1000)
          setDuration((v.duration || 0) * 1000)
          const now = Date.now()
          if (now - lastSave.current > 10_000) {
            lastSave.current = now
            onProgress(v.currentTime * 1000, (v.duration || 0) * 1000)
          }
        }}
        onEnded={onExit}
        onClick={toggle}
        autoPlay
      />

      <div
        className={[
          'pointer-events-none absolute inset-0 flex flex-col justify-between bg-gradient-to-b from-black/70 via-transparent to-black/80 p-10 transition-opacity duration-300',
          showControls ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
      >
        <div className="flex items-start justify-between">
          <h1 className="max-w-3xl text-xl font-semibold text-white/95 drop-shadow">{title}</h1>
          <span className="rounded-lg bg-white/10 px-3 py-1 text-sm text-white/80 backdrop-blur">
            Esc 返回
          </span>
        </div>

        <div className="space-y-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/25">
            <div
              className="h-full rounded-full bg-white"
              style={{ width: `${duration ? (position / duration) * 100 : 0}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-sm tabular-nums text-white/80">
            <span>{clock(position)}</span>
            <span className="text-white/60">
              {playing ? '▶ 播放中' : '⏸ 已暂停'} · ←/→ 快退/快进 10s · 空格 暂停
            </span>
            <span>{clock(duration)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function clock(ms: number): string {
  if (!ms || ms < 0) return '0:00'
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}
