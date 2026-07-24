import type { ParsedArgs } from '../router.js'
import { projectScripts, run, runFramework } from '../process.js'

const SITE_URL_HINT = process.env.THALLY_SITE_URL ?? process.env.DOX_SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'

interface Adapter {
  id: 'vercel' | 'cloudflare'
  label: string
  build: () => Promise<number>
  deploy: (prod: boolean) => Promise<number>
}

const ADAPTERS: Record<Adapter['id'], Adapter> = {
  vercel: {
    id: 'vercel',
    label: 'Vercel',
    build: () => runFramework('build', 'build'),
    deploy: (prod) => run(npx, ['vercel', 'deploy', ...(prod ? ['--prod'] : [])]),
  },
  cloudflare: {
    id: 'cloudflare',
    label: 'Cloudflare Workers',
    // The OpenNext build both compiles Next.js and adapts its output for
    // workerd. Running the generic Next build first would perform the most
    // expensive part twice and would not validate the actual edge artifact.
    build: () => run(npx, ['opennextjs-cloudflare', 'build']),
    deploy: () => run(npx, ['opennextjs-cloudflare', 'deploy']),
  },
}

function selectAdapter(args: ParsedArgs): Adapter {
  if (args.hasFlag('--cloudflare', '--cf')) return ADAPTERS.cloudflare
  return ADAPTERS.vercel
}

/**
 * Confirm the agent wedge before shipping: run the project's Agent Readiness
 * Score so the deploy surfaces "your docs answer agents correctly." Best-effort
 * — skipped (never fails the deploy) when there's no check:agents script.
 */
async function confirmAgentReadiness(): Promise<void> {
  const scripts = projectScripts()
  if (!scripts['check:agents']) return

  process.stdout.write('\n  Checking Agent Readiness before deploy...\n')
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  await run(npm, ['run', 'check:agents'])
}

/**
 * Build, confirm agent readiness, then deploy via a provider adapter. Vercel is
 * the default; pass --cloudflare for Cloudflare Workers. If the adapter CLI
 * isn't available we print clear next steps rather than failing hard.
 */
export async function runDeploy(args: ParsedArgs): Promise<number> {
  const adapter = selectAdapter(args)

  process.stdout.write('\n  Building production site...\n')
  const buildExit = await adapter.build()
  if (buildExit !== 0) return buildExit

  await confirmAgentReadiness()

  const prod = args.hasFlag('--prod', '--production')

  process.stdout.write(`\n  Deploying with ${adapter.label}...\n`)
  const deployExit = await adapter.deploy(prod)

  if (deployExit !== 0) {
    process.stdout.write(
      '\n  Deploy did not complete. To deploy manually:\n' +
        '    • Vercel:     npx vercel deploy --prod\n' +
        '    • Cloudflare: npm run deploy:cloudflare\n\n',
    )
    return deployExit
  }

  const base = SITE_URL_HINT ?? '<your-url>'
  process.stdout.write(
    `\n  Deployed via ${adapter.label}. Your docs now answer agents at:\n` +
      `    • ${base}/llms.txt\n` +
      `    • ${base}/ai.txt\n` +
      `    • ${base}/api/docs-index\n` +
      `    • ${base}/api/agent-readiness\n\n`,
  )
  return 0
}
