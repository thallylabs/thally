import { NextResponse } from 'next/server'
import { getTrackingConfig } from '@/data/docs'
import { getStorage } from '@/lib/storage'
import { siteConfig } from '@/data/site'
import { parseRepo } from '@/lib/tasks'
import { getDecryptedGithubApp } from '@/lib/admin/settings'
import { verifyGithubSignature, matchPullRequestEvent, processPullRequest } from '@/lib/track/webhook'

export const runtime = 'nodejs'

/**
 * Thally Track webhook — MERGED pull_request events from tracked product repos
 * land here. Verifies the HMAC signature (THALLY_TRACK_WEBHOOK_SECRET), matches the
 * merged PR against docs.json `tracking.repos`, and relays a
 * `repository_dispatch` to the docs repo, whose "Thally docs agent" workflow drafts
 * the documentation PR. Configure the GitHub webhook to send "Pull requests"
 * events.
 *
 * Response contract: 401 for bad/missing signature (or unconfigured secret,
 * fail-closed); 200 for every no-op (with a `reason`) — never 5xx, GitHub
 * auto-disables hooks that keep failing; 202 when a task was dispatched.
 */
export async function POST(request: Request) {
  // The connected GitHub App (Connect-GitHub flow) carries its own webhook
  // secret; the manual-webhook path uses THALLY_TRACK_WEBHOOK_SECRET. Accept a
  // signature that matches EITHER — a decrypt failure just drops that candidate.
  const app = await getDecryptedGithubApp().catch(() => null)
  const secrets = [(process.env.THALLY_TRACK_WEBHOOK_SECRET ?? process.env.DOX_TRACK_WEBHOOK_SECRET)?.trim(), app?.webhookSecret ?? undefined].filter(
    (s): s is string => Boolean(s),
  )
  if (secrets.length === 0) {
    return NextResponse.json({ error: 'webhook_not_configured' }, { status: 401 })
  }

  // HMAC is over the raw bytes — read text BEFORE parsing.
  const raw = await request.text()
  const signature = request.headers.get('x-hub-signature-256')
  if (!secrets.some((secret) => verifyGithubSignature(raw, signature, secret))) {
    return NextResponse.json({ error: 'bad_signature' }, { status: 401 })
  }

  const event = request.headers.get('x-github-event')
  if (event === 'ping') return NextResponse.json({ ok: true, pong: true })
  if (event !== 'pull_request') return NextResponse.json({ ok: true, noop: true, reason: 'unhandled_event' })

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
    const match = matchPullRequestEvent(payload, getTrackingConfig())
    if (!match) return NextResponse.json({ ok: true, noop: true, reason: 'not_tracked' })

    // Dispatch target = a DEPLOYER-set value (the THALLY_REPO_URL env or the
    // git-committed siteConfig.repoUrl), NOT the admin-editable override —
    // routing secret-bearing Actions shouldn't change via an unreviewed
    // dashboard edit. THALLY_REPO_URL lets a deployment that keeps site.ts as the
    // template default (repoUrl: '') still point Track at its own repo.
    const repoForDispatch = (process.env.THALLY_REPO_URL ?? process.env.DOX_REPO_URL)?.trim() || siteConfig.repoUrl
    const docsRef = repoForDispatch ? parseRepo(repoForDispatch) : null

    const result = await processPullRequest(match, {
      storage: getStorage(),
      docsRepo: docsRef ? `${docsRef.owner}/${docsRef.repo}` : null,
      // Prefer the connected App's installation token; else the resolver falls
      // back to the env PAT chain.
      appCreds: app ? { appId: app.appId, installationId: app.installationId, privateKey: app.privateKey } : undefined,
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
