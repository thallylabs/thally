import { resolveGithubToken, type GithubAppCreds } from '@thallylabs/mcp/track'
import { siteConfig } from '@/data/site'
import { getEffectiveSiteConfig } from '@/lib/admin/site-config'
import { getDecryptedGithubApp } from '@/lib/admin/settings'
import { parseRepo } from '@/lib/tasks'
import type { SubscoreResult } from '@/lib/agent-readiness/types'

export type DispatchAgentResult =
  | { ok: true; docsRepo: string }
  | {
      ok: false
      code: 'no_repo' | 'bad_repo' | 'no_token' | 'dispatch_failed'
      message: string
      status: number
    }

/** Docs repo the agent should open PRs against (env wins, then admin/site config). */
export async function resolveDocsRepoUrl(): Promise<string> {
  const effective = await getEffectiveSiteConfig()
  return ((process.env.THALLY_REPO_URL ?? process.env.DOX_REPO_URL)?.trim() || effective.repoUrl || siteConfig.repoUrl || '').trim()
}

/** Build a concrete agent instruction from a readiness subscore + its offenders. */
export function buildReadinessFixInstruction(sub: SubscoreResult): string {
  const lines = [
    `Fix the agent-readiness check "${sub.label}".`,
    '',
    `Current status: ${sub.detail}`,
    '',
    'Update the documentation so this check passes. Prefer minimal, reviewable edits that address the concrete gaps below.',
  ]
  if (sub.offenders.length > 0) {
    lines.push('', 'Affected pages:')
    for (const offender of sub.offenders.slice(0, 40)) {
      lines.push(`- ${offender.href} — ${offender.reason}`)
    }
  }
  return lines.join('\n')
}

export async function dispatchDocsAgent(opts: {
  instruction: string
  requester?: string
  fetchImpl?: typeof fetch
}): Promise<DispatchAgentResult> {
  const repoUrl = await resolveDocsRepoUrl()
  if (!repoUrl) {
    return {
      ok: false,
      code: 'no_repo',
      status: 400,
      message:
        'No docs repository configured. Set the repository URL in Admin → Settings (or THALLY_REPO_URL) so the docs agent can open a PR.',
    }
  }

  const parsed = parseRepo(repoUrl)
  if (!parsed) {
    return {
      ok: false,
      code: 'bad_repo',
      status: 400,
      message: 'The configured repository URL is not a valid GitHub repo URL.',
    }
  }

  const docsRepo = `${parsed.owner}/${parsed.repo}`
  const app = await getDecryptedGithubApp().catch(() => null)
  const appCreds: GithubAppCreds | undefined = app
    ? { appId: app.appId, installationId: app.installationId, privateKey: app.privateKey }
    : undefined

  const token = await resolveGithubToken({ appCreds, fetchImpl: opts.fetchImpl }).catch(() => undefined)
  if (!token) {
    return {
      ok: false,
      code: 'no_token',
      status: 503,
      message:
        'No GitHub credentials available to dispatch the docs agent. Connect GitHub in Admin → Settings, or set THALLY_GITHUB_TOKEN.',
    }
  }

  const fetchImpl = opts.fetchImpl ?? fetch
  const response = await fetchImpl(`https://api.github.com/repos/${docsRepo}/dispatches`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      event_type: 'thally-document',
      client_payload: {
        instruction: opts.instruction.slice(0, 4000),
        ...(opts.requester ? { requester: opts.requester } : {}),
        source: 'readiness',
      },
    }),
  })

  if (!response.ok) {
    return {
      ok: false,
      code: 'dispatch_failed',
      status: 502,
      message: `GitHub rejected the agent dispatch (${response.status}). Check that the docs agent workflow exists on ${docsRepo} and the token can create repository_dispatch events.`,
    }
  }

  return { ok: true, docsRepo }
}
