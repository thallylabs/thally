import { describe, it, expect } from 'vitest'
import { resolveCommitContext } from '../context.js'
import { buildToolBridge } from '../tools.js'

function fakeFetch(routes: Record<string, unknown>): typeof fetch {
  return (async (url: unknown) => {
    const key = Object.keys(routes).find((fragment) => String(url).includes(fragment))
    if (!key) return { ok: false, status: 404, json: async () => ({}) } as Response
    return { ok: true, status: 200, json: async () => routes[key] } as Response
  }) as typeof fetch
}

describe('resolveCommitContext', () => {
  it('formats a pinned commit spec into capped markdown context', async () => {
    const fetchImpl = fakeFetch({
      '/commits/8c1f2ab': {
        sha: '8c1f2ab0000',
        html_url: 'https://github.com/acme/api/commit/8c1f2ab',
        commit: { message: 'feat: payments' },
        files: [{ filename: 'src/pay.ts', status: 'added', additions: 5, deletions: 0, patch: '+pay' }],
      },
    })
    const context = await resolveCommitContext('acme/api@8c1f2ab', { fetchImpl, token: 't' })
    expect(context).toContain('# Tracked commit acme/api@8c1f2ab')
    expect(context).toContain('feat: payments')
    expect(context).toContain('### src/pay.ts (added, +5/-0)')
    expect(context.length).toBeLessThanOrEqual(20000)
  })

  it('resolves the default branch then fetches the commit in one call (no separate sha lookup)', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const impl = (async (url: unknown, init?: unknown) => {
      calls.push({ url: String(url), init: init as RequestInit })
      // sha-less spec: /repos → default_branch master; /commits/master → head commit
      if (String(url).includes('/commits/master')) {
        return { ok: true, status: 200, json: async () => ({ sha: 'latest99', commit: { message: 'tip' }, files: [] }) } as Response
      }
      return { ok: true, status: 200, json: async () => ({ default_branch: 'master' }) } as Response
    }) as typeof fetch
    const context = await resolveCommitContext('acme/api', { fetchImpl: impl })
    expect(context).toContain('acme/api@latest9')
    // Exactly two calls: default-branch lookup + commit fetch (no /commits?sha= list).
    expect(calls).toHaveLength(2)
    expect(calls.some((c) => c.url.includes('?sha='))).toBe(false)
  })

  it('rejects malformed specs', async () => {
    await expect(resolveCommitContext('not a spec')).rejects.toThrow(/owner\/repo/)
  })
})

describe('agent tool whitelist', () => {
  it('never exposes sync_from_repo (or other non-whitelisted tools) to the model', () => {
    const bridge = buildToolBridge('.')
    const names = bridge.claudeTools.map((tool) => tool.name)
    expect(names).not.toContain('sync_from_repo')
    expect(names).not.toContain('create_project')
    expect(names).toContain('update_page')
  })
})

describe('generated workflow shell-safety (Dox Track injection hardening)', () => {
  it('DOCS_AGENT_WORKFLOW passes dispatch values via env, never inline in the run script', async () => {
    const { DOCS_AGENT_WORKFLOW } = await import('../scaffold.js')
    // The instruction must be an env var, not expanded into the shell assignment.
    expect(DOCS_AGENT_WORKFLOW).toMatch(/INSTRUCTION:\s*\$\{\{\s*github\.event\.client_payload\.instruction/)
    expect(DOCS_AGENT_WORKFLOW).not.toMatch(/INSTRUCTION="\$\{\{/)
  })
  it('trackSenderWorkflow never inlines pusher.name or the commit message into the run script', async () => {
    const { trackSenderWorkflow } = await import('../scaffold.js')
    const yaml = trackSenderWorkflow('acme/docs', { owner: 'acme', repo: 'api', outputTab: 'API Reference' })
    // pusher.name flows through env; the run body references only $DOX_REQUESTER.
    expect(yaml).toMatch(/DOX_REQUESTER:\s*\$\{\{\s*github\.event\.pusher\.name/)
    expect(yaml).not.toMatch(/requester\]=\$\{\{\s*github\.event\.pusher\.name/)
    // No unescaped double-quotes around the tab that could break the assignment.
    expect(yaml).not.toContain('\\"API Reference\\"')
  })
})
