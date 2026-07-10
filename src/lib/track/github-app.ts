import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto'
import { getSiteUrl } from '@/lib/site-url'

// ---------------------------------------------------------------------------
// "Connect GitHub" — GitHub App Manifest flow (the Netlify/Vercel-style access
// path for Dox Track). The admin dashboard POSTs a manifest to GitHub, the user
// creates + installs THEIR OWN app in a couple of clicks, GitHub redirects back
// with a one-time `code`, and we exchange it for the app's id + private key +
// webhook secret — no key paste. Everything stays on the user's infra.
//
// Docs: https://docs.github.com/apps/sharing-github-apps/registering-a-github-app-from-a-manifest
// ---------------------------------------------------------------------------

export interface AppManifest {
  name: string
  url: string
  redirect_url: string
  /** Where GitHub returns the user AFTER they install the app (carries installation_id). */
  setup_url: string
  hook_attributes: { url: string; active: boolean }
  public: boolean
  default_permissions: Record<string, string>
  default_events: Array<string>
}

/**
 * Build the App manifest. The `redirect_url` (where GitHub returns the one-time
 * code that exchanges into the private key) and the webhook `hook_attributes.url`
 * are derived from the CANONICAL site URL (`DOX_SITE_URL`) — never a request
 * header, which is spoofable and would be a credential-exfil path.
 */
export function buildAppManifest(opts?: { siteUrl?: string; appName?: string }): AppManifest {
  const base = (opts?.siteUrl ?? getSiteUrl()).replace(/\/+$/, '')
  return {
    name: opts?.appName?.trim() || 'Dox Track',
    url: base,
    redirect_url: `${base}/api/admin/github-app/callback`,
    setup_url: `${base}/api/admin/github-app/callback`,
    hook_attributes: { url: `${base}/api/track/webhook`, active: true },
    public: false,
    // Least privilege for Track: read the tracked repos' PRs, open docs PRs on
    // the docs repo, read repo metadata. No code-read/write beyond contents.
    default_permissions: {
      pull_requests: 'write',
      contents: 'write',
      metadata: 'read',
    },
    default_events: ['pull_request'],
  }
}

export interface ManifestConversion {
  id: number
  slug: string
  htmlUrl: string
  pem: string
  webhookSecret: string
}

/**
 * Exchange the one-time manifest `code` GitHub redirects back with for the newly
 * created app's credentials. Single-use and short-lived on GitHub's side.
 */
export async function exchangeManifestCode(
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ManifestConversion> {
  const res = await fetchImpl(
    `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,
    { method: 'POST', headers: { Accept: 'application/vnd.github+json' } },
  )
  if (!res.ok) {
    throw new Error(`GitHub manifest conversion failed (${res.status}) — the code may be expired or already used.`)
  }
  const body = (await res.json()) as {
    id: number
    slug: string
    html_url: string
    pem: string
    webhook_secret: string
  }
  return { id: body.id, slug: body.slug, htmlUrl: body.html_url, pem: body.pem, webhookSecret: body.webhook_secret }
}

// ---------------------------------------------------------------------------
// CSRF state — a short-lived HMAC token (keyed on DOX_AUTH_SECRET) round-tripped
// through GitHub so the callback can prove the flow it's completing is one we
// started. The callback is also admin-gated; this is defense in depth.
// ---------------------------------------------------------------------------

function stateSecret(): string | null {
  const s = process.env.DOX_AUTH_SECRET?.trim()
  return s && s.length >= 16 ? s : null
}

/** Mint a signed state, or null if DOX_AUTH_SECRET is absent (caller must refuse). */
export function signManifestState(): string | null {
  const secret = stateSecret()
  if (!secret) return null
  const payload = `${randomBytes(12).toString('hex')}.${Date.now().toString(36)}`
  const sig = createHmac('sha256', secret).update(payload).digest('hex')
  return `${payload}.${sig}`
}

/** Verify a state is well-formed, correctly signed, and not older than maxAgeMs. */
export function verifyManifestState(state: string | null, maxAgeMs = 15 * 60 * 1000): boolean {
  if (!state) return false
  const secret = stateSecret()
  if (!secret) return false
  const parts = state.split('.')
  if (parts.length !== 3) return false
  const [nonce, ts, sig] = parts
  const expected = createHmac('sha256', secret).update(`${nonce}.${ts}`).digest('hex')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false
  const age = Date.now() - parseInt(ts, 36)
  return Number.isFinite(age) && age >= 0 && age <= maxAgeMs
}
