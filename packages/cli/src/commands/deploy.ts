/**
 * Build and publish through provider adapters, preserving their live output.
 *
 * The deployed URL is read from what the provider CLI itself prints (Vercel
 * writes the deployment URL to stdout; Wrangler prints the `workers.dev` URL),
 * falling back to an explicitly configured public site URL. A loopback URL is
 * never reported as a deployment. The Agent Readiness Score is informational:
 * its result is reported honestly but never blocks the deploy.
 */

import { terminal } from 'create-thally-docs/terminal'
import type { ParsedArgs } from '../router.js'
import { projectScripts, run, runFramework, runTee } from '../process.js'

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

interface Adapter {
  id: 'vercel' | 'cloudflare'
  label: string
  build: () => Promise<number>
  deploy: (prod: boolean, onLine: (line: string) => void) => Promise<number>
  /** Recognize the provider's own deployment-URL line. */
  parseUrl: (line: string) => string | undefined
}

/** Return an https origin for a candidate URL, or undefined when unusable. */
function publicOrigin(candidate: string | undefined): string | undefined {
  if (!candidate) return undefined
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
    if (isLoopbackHost(url.hostname)) return undefined
    return url.origin
  } catch {
    return undefined
  }
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'localhost' || host.endsWith('.localhost') || /^127(?:\.\d{1,3}){3}$/.test(host)
    || host === '0.0.0.0' || host === '[::1]' || host === '[::]'
}

/** Vercel prints the deployment URL (and only that) on stdout. */
export function parseVercelDeploymentUrl(line: string): string | undefined {
  const match = /^(https:\/\/[a-z0-9.-]+\.[a-z]{2,})\/?$/i.exec(line.trim())
  return match ? publicOrigin(match[1]) : undefined
}

/** Wrangler reports the Worker's `*.workers.dev` URL after an upload. */
export function parseWorkersDeploymentUrl(line: string): string | undefined {
  const match = /(https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev)\b/i.exec(line)
  return match ? publicOrigin(match[1]) : undefined
}

const ADAPTERS: Record<Adapter['id'], Adapter> = {
  vercel: {
    id: 'vercel',
    label: 'Vercel',
    build: () => runFramework('build', 'build'),
    deploy: (prod, onLine) => runTee(npx, ['vercel', 'deploy', ...(prod ? ['--prod'] : [])], onLine),
    parseUrl: parseVercelDeploymentUrl,
  },
  cloudflare: {
    id: 'cloudflare',
    label: 'Cloudflare Workers',
    // The OpenNext build both compiles Next.js and adapts its output for
    // workerd. Running the generic Next build first would perform the most
    // expensive part twice and would not validate the actual edge artifact.
    build: () => run(npx, ['opennextjs-cloudflare', 'build']),
    deploy: (_prod, onLine) => runTee(npx, ['opennextjs-cloudflare', 'deploy'], onLine),
    parseUrl: parseWorkersDeploymentUrl,
  },
}

function selectAdapter(args: ParsedArgs): Adapter {
  if (args.hasFlag('--cloudflare', '--cf')) return ADAPTERS.cloudflare
  return ADAPTERS.vercel
}

/** Outcome of the pre-deploy Agent Readiness Score. */
export type ReadinessOutcome = 'passed' | 'below-minimum' | 'unavailable'

/**
 * Run the project's Agent Readiness Score before shipping. Best-effort: a low
 * score is surfaced but never fails the deploy, and projects without a
 * `check:agents` script skip it.
 */
async function confirmAgentReadiness(): Promise<ReadinessOutcome> {
  if (!projectScripts()['check:agents']) return 'unavailable'
  terminal.info('Checking agent readiness before deploy…')
  const exit = await run(npm, ['run', 'check:agents'])
  return exit === 0 ? 'passed' : 'below-minimum'
}

/** Summary lines for a completed deploy; exported for tests. */
export function deploySummary(baseUrl: string | undefined, readiness: ReadinessOutcome): {
  endpoints: Array<string>
  readiness: string
} {
  const base = baseUrl ?? '<your-site-url>'
  const endpoints = [
    `${base}/llms.txt`,
    `${base}/api/mcp`,
    `${base}/api/docs-index`,
    `${base}/api/agent-readiness`,
  ]
  const readinessText = {
    passed: 'Agent Readiness Score: met the minimum before deploy.',
    'below-minimum': 'Agent Readiness Score: below the minimum (see the report above). The deploy continued; run "thally check --agents" to fix the gaps.',
    unavailable: 'Agent Readiness Score: skipped (this project has no "check:agents" script).',
  }[readiness]
  return { endpoints, readiness: readinessText }
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

  const readiness = await confirmAgentReadiness()
  if (readiness === 'below-minimum') {
    terminal.warn('Agent Readiness Score is below the minimum. Deploying anyway; the summary below repeats this.')
  }

  const prod = args.hasFlag('--prod', '--production')

  terminal.info(`Deploying with ${adapter.label}…`)
  let deployedUrl: string | undefined
  const deployExit = await adapter.deploy(prod, (line) => {
    deployedUrl ??= adapter.parseUrl(line)
  })

  if (deployExit !== 0) {
    terminal.error(`Deployment with ${adapter.label} did not complete.`)
    terminal.section('Deploy manually', [
      'Vercel: npx vercel deploy --prod',
      'Cloudflare: npm run deploy:cloudflare',
    ])
    return deployExit
  }

  const configured = publicOrigin(
    (process.env.THALLY_SITE_URL ?? process.env.DOX_SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL)?.trim(),
  )
  // A Vercel preview URL is the deployment just created; a configured
  // production URL may not serve it yet. Prefer what the provider reported.
  const baseUrl = deployedUrl ?? configured
  const summary = deploySummary(baseUrl, readiness)
  terminal.success(baseUrl ? `Deployed with ${adapter.label}: ${baseUrl}` : `Deployed with ${adapter.label}.`)
  terminal.section('Agent endpoints', summary.endpoints)
  if (!baseUrl) terminal.info('Replace <your-site-url> with the URL your provider printed above.')
  if (readiness === 'below-minimum') terminal.warn(summary.readiness)
  else terminal.info(summary.readiness)
  return 0
}
