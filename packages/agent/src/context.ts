import { execFileSync } from 'node:child_process'
import {
  parseOwnerRepo,
  fetchCommit,
  fetchDefaultBranch,
  buildTrackContext,
  type GithubFetchOptions,
} from '@doxlabs/mcp/track'

/** Resolve a git ref (e.g. `HEAD~1`, a SHA, `main`) into a unified diff. */
export function resolveDiff(projectDir: string, ref: string): string {
  for (const args of [['diff', `${ref}...HEAD`], ['diff', ref]]) {
    try {
      const out = execFileSync('git', args, { cwd: projectDir, encoding: 'utf8' })
      if (out.trim()) return out.slice(0, 20000)
    } catch {
      // try the next form
    }
  }
  return ''
}

/** Fetch a GitHub PR's title, body, and diff via the `gh` CLI (needs gh auth). */
export function resolvePrContext(prUrl: string): string {
  let pr: { title: string; body: string; number: number; url: string }
  try {
    const json = execFileSync('gh', ['pr', 'view', prUrl, '--json', 'title,body,number,url'], { encoding: 'utf8' })
    pr = JSON.parse(json)
  } catch (err) {
    throw new Error(`Could not read the PR via gh (is it installed and authenticated?): ${err instanceof Error ? err.message : String(err)}`)
  }

  let diff = ''
  try {
    diff = execFileSync('gh', ['pr', 'diff', prUrl], { encoding: 'utf8' }).slice(0, 20000)
  } catch {
    // diff is best-effort
  }

  return [
    `# Product PR #${pr.number}: ${pr.title}`,
    `URL: ${pr.url}`,
    '',
    pr.body?.trim() || '(no description)',
    diff ? `\n## Diff\n\`\`\`diff\n${diff}\n\`\`\`` : '',
  ].join('\n')
}

/**
 * Resolve a tracked-repo commit spec (`owner/repo@sha`, or `owner/repo` for the
 * latest commit on main) into task context via the GitHub API. Used by Dox
 * Track (`dox agent --from-commit`, the docs-repo Action's `from_commit` path).
 */
export async function resolveCommitContext(spec: string, options?: GithubFetchOptions): Promise<string> {
  const ref = parseOwnerRepo(spec)
  if (!ref) {
    throw new Error(`Invalid commit spec "${spec}" — expected owner/repo or owner/repo@sha`)
  }
  // Resolve the commit in a SINGLE fetch: /commits/{ref} accepts a branch name
  // and returns the head commit (sha + files), so no separate sha lookup. A
  // sha-less spec resolves against the repo's ACTUAL default branch (not a
  // hardcoded "main"), so master-/develop-default repos work.
  const commitRef = ref.sha ?? (await fetchDefaultBranch(ref.owner, ref.repo, options))
  const commit = await fetchCommit(ref.owner, ref.repo, commitRef, options)
  // Reuse the single distiller so the preview and the agent see identical context.
  return buildTrackContext(ref, commit)
}
