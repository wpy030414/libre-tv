import { useState, type ReactNode } from 'react'
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { cn } from '@/lib/utils'

/**
 * tvOS 焦点组件：非焦点态无边框、轻微缩放；获焦时白描边 + 放大 + 上浮。
 * 焦点态由空间导航驱动，鼠标悬停只做视觉补充（电视上鼠标不参与）。
 */
interface FocusableProps {
  children: ReactNode
  className?: string
  /** 遥控器确认键 / Enter */
  onEnter?: () => void
  /** 方向键在获焦组件上按下（自定义移动行为时用） */
  onArrow?: (dir: 'up' | 'down' | 'left' | 'right') => void
  focusKey?: string
  /** 大卡片用更大放大倍率 */
  scale?: 'sm' | 'md' | 'lg'
}

export function Focusable({
  children,
  className,
  onEnter,
  onArrow,
  focusKey,
  scale = 'md',
}: FocusableProps) {
  const { ref, focused } = useFocusable({
    focusKey,
    onEnterPress: onEnter,
    onArrowPress: (dir) => {
      onArrow?.(dir as 'up' | 'down' | 'left' | 'right')
      return true
    },
  })
  const [hovered, setHovered] = useState(false)
  const active = focused || hovered
  const zoom = scale === 'lg' ? 1.08 : scale === 'sm' ? 1.04 : 1.06

  return (
    <div
      ref={ref}
      onClick={onEnter}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        'relative cursor-pointer rounded-2xl outline-none transition-all duration-200 will-change-transform',
        active
          ? 'z-10 shadow-[0_0_0_3px_rgba(255,255,255,0.92),0_18px_50px_-12px_rgba(0,0,0,0.85)]'
          : 'shadow-none',
        className,
      )}
      style={{ transform: active ? `scale(${zoom})` : 'scale(1)' }}
    >
      {children}
    </div>
  )
}
