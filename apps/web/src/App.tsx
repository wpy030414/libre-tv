import { Button } from '@/components/ui/button'

export function App() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">libre-tv — Ready</h1>
        <p className="mt-2 text-sm text-muted-foreground">Apple TV 风格聚合前端 · 源接口化后端</p>
        <Button variant="secondary" className="mt-6">
          Hello, tvOS
        </Button>
      </div>
    </div>
  )
}
