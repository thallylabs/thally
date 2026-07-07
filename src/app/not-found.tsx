import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 text-center text-foreground">
      <div className="space-y-3">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-foreground/60">404</p>
        <h1 className="text-4xl font-semibold">We misplaced that page</h1>
        <p className="text-foreground/70">
          The document you asked for does not exist in this workspace yet.
        </p>
      </div>
      <Button asChild>
        <Link href="/">Back to docs</Link>
      </Button>
    </div>
  )
}

