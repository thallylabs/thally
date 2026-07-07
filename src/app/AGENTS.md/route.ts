import fs from 'node:fs'
import path from 'node:path'
import { buildAgentsManifest } from '@/lib/agent-manifest'

export const runtime = 'nodejs'

export function GET() {
  // Author override: a physical AGENTS.md at the project root wins over the
  // generated default, so teams can hand-tune the agent guidance.
  try {
    const custom = path.join(process.cwd(), 'AGENTS.md')
    if (fs.existsSync(custom)) {
      return new Response(fs.readFileSync(custom, 'utf8'), {
        headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
      })
    }
  } catch {
    // fall through to the generated manifest
  }

  return new Response(buildAgentsManifest(), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
