/**
 * `npm run check:agents` — the Agent Readiness Score for the local project.
 * `thally check --agents` runs this script, so its flags (`--min`, `--json`)
 * and exit codes are a CLI contract.
 */

import { createRequire } from 'node:module'
import path from 'node:path'

/**
 * Golden-question evaluation reuses the site's search engine, whose module
 * graph includes Next's `server-only` build marker. Outside a bundler that
 * marker throws on import; Next resolves it to an empty module for server
 * code and Vitest aliases it the same way. This CLI is server-side code, so
 * it pre-resolves the marker to the same empty module before loading the app.
 */
function stubServerOnlyMarker(): void {
  try {
    const localRequire = createRequire(path.join(process.cwd(), 'package.json'))
    const id = localRequire.resolve('server-only')
    localRequire.cache[id] = { id, filename: id, loaded: true, exports: {} } as NodeJS.Module
  } catch {
    // Not installed: nothing imports it, so there is nothing to stub.
  }
}

function parseArgs(argv: Array<string>) {
  let min = 80
  let json = false
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--json') json = true
    else if (arg === '--min') {
      const value = Number(argv[i + 1])
      if (!Number.isNaN(value)) min = value
      i += 1
    } else if (arg.startsWith('--min=')) {
      const value = Number(arg.slice('--min='.length))
      if (!Number.isNaN(value)) min = value
    }
  }
  return { min, json }
}

const STATUS_MARKS: Record<string, string> = { pass: '✓', warn: '•', fail: '✗', skip: '–' }

async function main() {
  const { min, json } = parseArgs(process.argv.slice(2))
  stubServerOnlyMarker()
  const { ensureDocPublication } = await import('@/data/docs')
  const { computeLocalAgentReadiness } = await import('@/lib/agent-readiness')
  await ensureDocPublication()
  const report = await computeLocalAgentReadiness()

  if (json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(report, null, 2))
  } else {
    // eslint-disable-next-line no-console
    console.log(`\nAgent Readiness Score: ${report.score}/100 (grade ${report.grade}) · ${report.totalPages} pages · methodology v${report.version}\n`)
    for (const sub of report.subscores) {
      const status = sub.status ?? (sub.score >= 1 ? 'pass' : 'warn')
      const value = sub.available ? `${Math.round(sub.score * 100)}%` : 'n/a'
      // eslint-disable-next-line no-console
      console.log(`  ${STATUS_MARKS[status] ?? '•'} ${sub.label}: ${value}  — ${sub.detail}`)
      for (const offender of sub.offenders.slice(0, 5)) {
        // eslint-disable-next-line no-console
        console.log(`      - ${offender.href} (${offender.reason})`)
      }
      const affected = sub.affectedCount ?? sub.offenders.length
      if (affected > 5) {
        // eslint-disable-next-line no-console
        console.log(`      …and ${affected - 5} more`)
      }
      if (sub.available && sub.score < 1 && sub.fixHint) {
        // eslint-disable-next-line no-console
        console.log(`      Fix: ${sub.fixHint}`)
      }
    }
    // eslint-disable-next-line no-console
    console.log('')
  }

  if (report.score < min) {
    // eslint-disable-next-line no-console
    console.error(`Agent Readiness Score ${report.score} is below the required minimum of ${min}.`)
    process.exit(1)
  }
}

void main()
