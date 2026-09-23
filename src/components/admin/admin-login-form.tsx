'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertCircle } from 'lucide-react'
import { BrandMark } from '@/components/admin/brand-mark'
import { resolveSafeReturnPath } from '@/lib/safe-return-path'
import { getAuthErrorMessage } from '@/lib/admin/auth-error'

export function AdminLoginForm({ siteName = 'Thally', oidcEnabled = false }: { siteName?: string; oidcEnabled?: boolean }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      })

      if (!res.ok) {
        setError(getAuthErrorMessage('admin', res.status))
        return
      }

      router.replace(resolveSafeReturnPath(searchParams.get('next'), '/admin'))
    } catch {
      setError('Unable to sign in. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="ds-auth">
      <form onSubmit={(e) => void handleSubmit(e)} className="ds-auth-card ds-rise">
        <div className="ds-auth-logo" style={{ background: 'none' }}>
          <BrandMark size={44} />
        </div>

        <p className="mt-6 ds-workspace-sub">{siteName} Admin</p>
        <h1
          className="mt-1"
          style={{
            fontFamily: 'var(--ds-font-heading)',
            fontSize: 'var(--ds-text-h3)',
            fontWeight: 'var(--ds-fw-bold)',
            letterSpacing: 'var(--ds-tracking-tight)',
            color: 'var(--ds-text-primary)',
          }}
        >
          Sign in
        </h1>
        <p className="mt-2" style={{ fontSize: 'var(--ds-text-sm)', color: 'var(--ds-text-muted)' }}>
          Enter your project admin password to view analytics, readiness, and traffic insights.
        </p>

        <label
          className="mt-6 block"
          htmlFor="password"
          style={{ fontSize: 'var(--ds-text-sm)', fontWeight: 'var(--ds-fw-medium)', color: 'var(--ds-text-secondary)' }}
        >
          Admin password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="ds-input ds-focusable mt-2"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'admin-login-error' : undefined}
          placeholder="••••••••••••"
          autoComplete="current-password"
          autoFocus
          required
        />

        {error ? (
          <p id="admin-login-error" role="alert" className="mt-3 flex items-center gap-1.5" style={{ fontSize: 'var(--ds-text-sm)', color: 'var(--ds-danger)' }}>
            <AlertCircle className="h-4 w-4" />
            {error}
          </p>
        ) : null}

        <button type="submit" className="ds-btn ds-btn--primary ds-focusable mt-6 w-full" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
        {oidcEnabled ? (
          <>
            <div className="mt-4 text-center" style={{ fontSize: 'var(--ds-text-sm)', color: 'var(--ds-text-muted)' }}>
              or
            </div>
            {/* OIDC must perform a full document navigation so the browser follows
                the provider redirect rather than treating the API route as a page. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/api/admin/auth/oidc"
              className="ds-btn ds-btn--secondary ds-focusable mt-4 w-full"
              style={{ display: 'flex', justifyContent: 'center' }}
            >
              Sign in with SSO
            </a>
          </>
        ) : null}
      </form>
    </div>
  )
}
