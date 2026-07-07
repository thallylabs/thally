import fs from 'node:fs'
import path from 'node:path'

/**
 * Load the docs project's AGENTS.md — style rules, never-touch files, review
 * requirements — to steer the agent. Freeform markdown, fed into the system
 * prompt. Empty string when absent.
 */
export function loadAgentsGuidance(projectDir: string): string {
  for (const name of ['AGENTS.md', '.github/AGENTS.md']) {
    const filePath = path.join(projectDir, name)
    try {
      if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf8').slice(0, 8000)
    } catch {
      // unreadable — treat as absent
    }
  }
  return ''
}
