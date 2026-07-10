import { execFileSync } from 'node:child_process'

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
