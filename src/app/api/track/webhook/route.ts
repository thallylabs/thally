import { NextResponse } from 'next/server'
import { getTrackingConfig } from '@/data/docs'
import { getStorage } from '@/lib/storage'
import { siteConfig } from '@/data/site'
import { parseRepo } from '@/lib/tasks'
import { verifyGithubSignature, matchPushEvent, processPush } from '@/lib/track/webhook'

export const runtime = 'nodejs'

/**
 * Dox Track webhook — GitHub pushes from tracked product repos land here.
 * Verifies the HMAC signature (DOX_TRACK_WEBHOOK_SECRET), matches the push
 * against docs.json `tracking.repos`, and relays a `repository_dispatch` to
 * the docs repo, whose "Dox docs agent" workflow drafts the documentation PR.
 *
 * Response contract: 401 for bad/missing signature (or unconfigured secret,
 * fail-closed); 200 for every no-op (with a `reason`) — never 5xx, GitHub
 * auto-disables hooks that keep failing; 202 when a task was dispatched.
 */
export async function POST(request: Request) {
  const secret = process.env.DOX_TRACK_WEBHOOK_SECRET?.trim()
  if (!secret) {
    return NextResponse.json({ error: 'webhook_not_configured' }, { status: 401 })
  }

  // HMAC is over the raw bytes — read text BEFORE parsing.
  const raw = await request.text()
  if (!verifyGithubSignature(raw, request.headers.get('x-hub-signature-256'), secret)) {
    return NextResponse.json({ error: 'bad_signature' }, { status: 401 })
  }

  const event = request.headers.get('x-github-event')
  if (event === 'ping') return NextResponse.json({ ok: true, pong: true })
  if (event !== 'push') return NextResponse.json({ ok: true, noop: true, reason: 'unhandled_event' })

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return NextResponse.json({ ok: true, noop: true, reason: 'invalid_json' })
  }

  // Everything past signature verification is wrapped: a storage/network hiccup
  // must return 200 (noop), NOT 500 — GitHub auto-disables hooks that keep
  // failing, which would silently take Track offline.
  try {
    const match = matchPushEvent(payload, getTrackingConfig())
    if (!match) return NextResponse.json({ ok: true, noop: true, reason: 'not_tracked' })

    // Dispatch target = the git-committed repo (a reviewed value), NOT the
    // admin-editable override — routing secret-bearing Actions shouldn't change
    // via an unreviewed dashboard edit.
    const docsRef = siteConfig.repoUrl ? parseRepo(siteConfig.repoUrl) : null

    const result = await processPush(match, {
      storage: getStorage(),
      docsRepo: docsRef ? `${docsRef.owner}/${docsRef.repo}` : null,
    })

    if (result.status === 'dispatched') {
      return NextResponse.json({ ok: true, dispatched: true }, { status: 202 })
    }
    return NextResponse.json({ ok: true, noop: true, reason: result.reason })
  } catch (err) {
    console.error('[track] webhook processing error:', err)
    return NextResponse.json({ ok: true, noop: true, reason: 'processing_error' })
  }
}
