/** Build and publish through provider adapters, preserving their live output. */

import { terminal } from 'create-thally-docs/terminal'
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

  terminal.info('Checking agent readiness before deploy…')
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

  terminal.info('Building production site…')
  const buildExit = await adapter.build()
  if (buildExit !== 0) return buildExit

  await confirmAgentReadiness()

  const prod = args.hasFlag('--prod', '--production')

  terminal.info(`Deploying with ${adapter.label}…`)
  const deployExit = await adapter.deploy(prod)

  if (deployExit !== 0) {
    terminal.error(`Deployment with ${adapter.label} did not complete.`)
    terminal.section('Deploy manually', [
      'Vercel: npx vercel deploy --prod',
      'Cloudflare: npm run deploy:cloudflare',
    ])
    return deployExit
  }

  const base = SITE_URL_HINT ?? '<your-url>'
  terminal.success(`Deployed with ${adapter.label}.`)
  terminal.section('Agent endpoints', [
    `${base}/llms.txt`,
    `${base}/ai.txt`,
    `${base}/api/docs-index`,
    `${base}/api/agent-readiness`,
  ])
  return 0
}
