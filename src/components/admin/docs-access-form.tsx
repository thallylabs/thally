'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'

export function DocsAccessForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError(null)

    const res = await fetch('/api/access/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    })

    if (!res.ok) {
      setError('Invalid password.')
      setLoading(false)
      return
    }

    const next = searchParams.get('next') ?? '/'
    router.replace(next)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="w-full max-w-sm rounded-xl border border-border bg-background p-8 shadow-sm"
      >
        <h1 className="text-2xl font-semibold tracking-tight">Protected documentation</h1>
        <p className="mt-2 text-sm text-muted-foreground">This site requires a password to view.</p>

        <label className="mt-6 block text-sm font-medium" htmlFor="access-password">
          Password
        </label>
        <input
          id="access-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring"
          required
        />

        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

        <Button type="submit" className="mt-6 w-full" disabled={loading}>
          {loading ? 'Checking…' : 'Continue'}
        </Button>
      </form>
    </div>
  )
}
