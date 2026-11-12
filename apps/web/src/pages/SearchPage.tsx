import type { VideoSummary } from '@libre-tv/shared/types'
import { useState } from 'react'
import { Search as SearchIcon } from 'lucide-react'
import { api } from '@/api/client'
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { PosterRow } from '@/components/PosterCard'

const QUICK = ['Azur Lane', '原神', 'NTR', 'MMD', '3D']

/** 搜索页：输入框直接接收键盘；电视遥控器上用快捷词 + 确认进入 */
export function SearchPage({ onSelect }: { onSelect: (v: VideoSummary) => void }) {
  const [kw, setKw] = useState('')
  const [results, setResults] = useState<VideoSummary[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [submitted, setSubmitted] = useState('')

  const run = async (q: string) => {
    const query = q.trim()
    if (!query) return
    setBusy(true)
    setError(undefined)
    setSubmitted(query)
    try {
      const page = await api.search('hanime1', query, 1)
      setResults(page.items)
    } catch (e) {
      setError((e as Error).message)
      setResults([])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-8 px-12 pb-24 pt-8">
      <form
        className="flex max-w-3xl items-center gap-3 rounded-2xl bg-white/10 px-5 py-4 ring-1 ring-white/15 backdrop-blur focus-within:ring-2 focus-within:ring-white/70"
        onSubmit={(e) => {
          e.preventDefault()
          void run(kw)
        }}
      >
        <SearchIcon className="h-5 w-5 shrink-0 text-zinc-400" />
        <input
          value={kw}
          onChange={(e) => setKw(e.target.value)}
          placeholder="搜索片名、社团、标签…（键盘输入后回车）"
          className="w-full bg-transparent text-lg text-white placeholder:text-zinc-500 focus:outline-none"
          autoFocus
        />
      </form>

      <div className="flex flex-wrap gap-3">
        {QUICK.map((q) => (
          <QuickChip
            key={q}
            label={q}
            onSelect={() => {
              setKw(q)
              void run(q)
            }}
          />
        ))}
      </div>

      {error ? <p className="text-sm text-amber-300">搜索失败：{error}</p> : null}
      {busy ? <p className="text-sm text-zinc-400">搜索中…</p> : null}
      {!busy && submitted && results.length === 0 && !error ? (
        <p className="text-sm text-zinc-500">「{submitted}」没有结果</p>
      ) : null}

      {results.length > 0 ? (
        <PosterRow
          title={`「${submitted}」的结果`}
          videos={results}
          onSelect={onSelect}
          focusKey="search"
        />
      ) : null}
    </div>
  )
}

function QuickChip({ label, onSelect }: { label: string; onSelect: () => void }) {
  const { ref, focused } = useFocusable({ onEnterPress: onSelect })
  return (
    <button
      ref={ref}
      onClick={onSelect}
      className={[
        'rounded-full px-5 py-2 text-sm font-medium transition-all duration-200',
        focused ? 'scale-105 bg-white text-black' : 'bg-white/10 text-zinc-300',
      ].join(' ')}
    >
      {label}
    </button>
  )
}
