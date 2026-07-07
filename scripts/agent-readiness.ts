import { computeAgentReadiness } from '@/lib/agent-readiness'

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

function main() {
  const { min, json } = parseArgs(process.argv.slice(2))
  const report = computeAgentReadiness()

  if (json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(report, null, 2))
  } else {
    // eslint-disable-next-line no-console
    console.log(`\nAgent Readiness Score: ${report.score}/100 (grade ${report.grade}) · ${report.totalPages} pages\n`)
    for (const sub of report.subscores) {
      const pct = Math.round(sub.score * 100)
      // eslint-disable-next-line no-console
      console.log(`  ${pct === 100 ? '✓' : '•'} ${sub.label}: ${pct}%  — ${sub.detail}`)
      for (const offender of sub.offenders.slice(0, 5)) {
        // eslint-disable-next-line no-console
        console.log(`      - ${offender.href} (${offender.reason})`)
      }
      if (sub.offenders.length > 5) {
        // eslint-disable-next-line no-console
        console.log(`      …and ${sub.offenders.length - 5} more`)
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

main()
