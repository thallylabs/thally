#!/usr/bin/env node
/**
 * `thally-scan` command line. Help text is generated from the same option
 * tables the parser uses, so the two cannot drift.
 *
 * Exit codes: 0 success; 2 usage error; 3 the scanned site's status is
 * `error` or `skipped`; 1 unexpected failure.
 */

import { realpathSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'

import { runBatch, type CaptureBodiesSetting } from './batch.js'
import { buildFrame } from './frame/frame.js'
import { methodology } from './methodology/methodology.js'
import { defaultCaptureBodies, siteKeyFor } from './net/capture.js'
import { stableStringify } from './output/stable-json.js'
import { replaySite, scanSite } from './scan.js'
import type { RateLimiter, SiteResult, Transport } from './types.js'
import { scannerVersion } from './version.js'

/** Injectable I/O and seams for in-process use and tests. */
export interface CliIo {
  stdout: (text: string) => void
  stderr: (text: string) => void
  env?: Record<string, string | undefined>
  transport?: Transport
  rateLimiter?: RateLimiter
  sleep?: (ms: number) => Promise<void>
  now?: () => Date
}

interface OptionSpec {
  name: string
  type: 'string' | 'boolean'
  value?: string
  description: string
}

interface CommandSpec {
  name: string
  usage: string
  summary: string
  options: OptionSpec[]
}

const CAPTURE_OPTIONS: OptionSpec[] = [
  { name: 'captures', type: 'string', value: '<dir>', description: 'Record status, headers and body hash of every request under <dir>.' },
  { name: 'capture-bodies', type: 'string', value: '<all|none|pct>', description: 'Share of sites whose raw bodies are kept (default 10).' },
]
const PRIVATE_OPTION: OptionSpec = {
  name: 'allow-private-network', type: 'boolean', description: 'Allow loopback and private addresses. For local testing only.',
}

const COMMANDS: CommandSpec[] = [
  {
    name: 'scan',
    usage: 'thally-scan scan <url> [options]',
    summary: 'Scan one documentation site and print its score and per-check results.',
    options: [
      { name: 'json', type: 'boolean', description: 'Print the full result as canonical JSON.' },
      ...CAPTURE_OPTIONS,
      { name: 'replay', type: 'string', value: '<dir>', description: 'Replay a capture directory recorded with bodies instead of fetching.' },
      PRIVATE_OPTION,
    ],
  },
  {
    name: 'batch',
    usage: 'thally-scan batch --input <sample.csv> --out <dir> [options]',
    summary: 'Scan every site in a CSV and write results.jsonl, results.csv and summary.json. Resumable.',
    options: [
      { name: 'input', type: 'string', value: '<file>', description: 'CSV with a `url` column, or a frame CSV (`decision`, `docs_root`).' },
      { name: 'out', type: 'string', value: '<dir>', description: 'Output directory.' },
      { name: 'concurrency', type: 'string', value: '<n>', description: 'Sites scanned in parallel (default 4).' },
      { name: 'retry-errors', type: 'boolean', description: 'Re-scan sites whose recorded status is error or skipped.' },
      ...CAPTURE_OPTIONS,
      PRIVATE_OPTION,
    ],
  },
  {
    name: 'frame',
    usage: 'thally-scan frame --out <sample.csv> [options]',
    summary: 'Build the sample frame from the GitHub search API (GITHUB_TOKEN optional) with a decision and reason per repository.',
    options: [
      { name: 'out', type: 'string', value: '<file>', description: 'Output CSV path; frame-meta.json is written beside it.' },
      { name: 'limit', type: 'string', value: '<n>', description: 'Repositories to consider, at most 1000 (default 1000).' },
      { name: 'captures', type: 'string', value: '<dir>', description: 'Record every request under <dir>/frame.' },
      PRIVATE_OPTION,
    ],
  },
]

const GLOBAL_OPTIONS: OptionSpec[] = [
  { name: 'help', type: 'boolean', description: 'Show help.' },
  { name: 'version', type: 'boolean', description: 'Show the scanner and methodology versions.' },
]

class UsageError extends Error {}

function optionLines(options: OptionSpec[]): string[] {
  const labels = options.map((option) => `--${option.name}${option.value ? ` ${option.value}` : ''}`)
  const width = Math.max(...labels.map((label) => label.length))
  return options.map((option, i) => `  ${labels[i].padEnd(width)}  ${option.description}`)
}

/** Help text for the whole CLI or one command. */
export function helpText(command?: string): string {
  const spec = COMMANDS.find((entry) => entry.name === command)
  if (spec) {
    return [`Usage: ${spec.usage}`, '', spec.summary, '', 'Options:', ...optionLines([...spec.options, GLOBAL_OPTIONS[0]]), ''].join('\n')
  }
  const width = Math.max(...COMMANDS.map((entry) => entry.name.length))
  return [
    'Usage: thally-scan <command> [options]',
    '',
    `Black-box agent-readiness scanner (${methodology.id} v${methodology.version}).`,
    '',
    'Commands:',
    ...COMMANDS.map((entry) => `  ${entry.name.padEnd(width)}  ${entry.summary}`),
    '',
    'Global options:',
    ...optionLines(GLOBAL_OPTIONS),
    '',
    ...COMMANDS.flatMap((entry) => [`${entry.usage}`, ...optionLines(entry.options), '']),
    'Exit codes: 0 ok, 2 usage error, 3 site status error or skipped, 1 unexpected failure.',
    '',
  ].join('\n')
}

function parseCommand(spec: CommandSpec, argv: string[]) {
  const options: Record<string, { type: 'string' | 'boolean' }> = {}
  for (const option of [...spec.options, ...GLOBAL_OPTIONS]) options[option.name] = { type: option.type }
  try {
    return parseArgs({ args: argv, options, allowPositionals: true, strict: true })
  } catch (error) {
    throw new UsageError((error as Error).message)
  }
}

function parseCaptureBodies(value: string | undefined): CaptureBodiesSetting | undefined {
  if (value === undefined) return undefined
  if (value === 'all' || value === 'none') return value
  const pct = Number(value)
  if (!Number.isInteger(pct) || pct < 0 || pct > 100) throw new UsageError('--capture-bodies must be all, none or an integer 0-100')
  return pct
}

function positiveInt(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1) throw new UsageError(`--${name} must be a positive integer`)
  return n
}

function formatValue(value: number | null): string {
  return value === null ? '-' : String(Math.round(value * 1000) / 1000)
}

/** Human-readable summary of one site result. */
export function formatResult(result: SiteResult): string {
  const lines: string[] = []
  if (result.status !== 'ok') {
    lines.push(`${result.input}  ${result.status.toUpperCase()} (${result.reason})`)
    if (result.docsRoot) lines.push(`Docs root: ${result.docsRoot}`)
    lines.push(`Requests: ${result.requests.used}/${result.requests.budget}`)
    return `${lines.join('\n')}\n`
  }
  lines.push(`${result.docsRoot}  score ${result.score} (${result.grade})`)
  lines.push(`Platform: ${result.platform.platform} (${result.platform.confidence} confidence)  Thally-hosted: ${result.thallyHosted ? 'yes' : 'no'}`)
  lines.push(`Sample: ${result.sample.pages.length} pages from ${result.sample.source}  Requests: ${result.requests.used}/${result.requests.budget}${result.requests.exhausted ? ' (budget exhausted)' : ''}`)
  lines.push(`Categories: ${result.categories.map((category) => `${category.id} ${category.score ?? 'n/a'}`).join('  ')}`)
  lines.push('')
  const idWidth = Math.max(...result.checks.map((check) => check.id.length))
  for (const check of result.checks) {
    const status = check.status === 'not_applicable' ? 'N/A ' : check.status.toUpperCase().padEnd(4)
    const scored = check.scored ? '' : ' (not scored)'
    lines.push(`${status}  ${check.id.padEnd(idWidth)}  ${formatValue(check.value).padEnd(5)}  ${check.detail}${scored}${check.evidence[0] ? `  ${check.evidence[0]}` : ''}`)
  }
  lines.push('', `Methodology ${result.methodology.id} v${result.methodology.version}, scanner ${result.scannerVersion}`)
  return `${lines.join('\n')}\n`
}

async function runScan(argv: string[], io: CliIo): Promise<number> {
  const spec = COMMANDS[0]
  const { values, positionals } = parseCommand(spec, argv)
  if (values.help) {
    io.stdout(helpText('scan'))
    return 0
  }
  const allowPrivateNetwork = values['allow-private-network'] === true
  let result: SiteResult
  if (typeof values.replay === 'string') {
    if (positionals.length > 0) throw new UsageError('scan --replay takes no URL; the capture names its input')
    result = await replaySite(values.replay, { allowPrivateNetwork })
  } else {
    if (positionals.length !== 1) throw new UsageError('scan needs exactly one URL')
    const url = positionals[0]
    const captureBodies = parseCaptureBodies(values['capture-bodies'] as string | undefined)
    result = await scanSite(url, {
      allowPrivateNetwork,
      ...(io.transport ? { transport: io.transport } : {}),
      ...(io.rateLimiter ? { rateLimiter: io.rateLimiter } : {}),
      ...(io.sleep ? { sleep: io.sleep } : {}),
      ...(io.now ? { now: io.now } : {}),
      ...(typeof values.captures === 'string'
        ? {
            captureDir: values.captures,
            captureBodies: captureBodies === undefined
              ? defaultCaptureBodies(siteKeyFor(url))
              : captureBodies === 'all' || (captureBodies !== 'none' && defaultCaptureBodies(siteKeyFor(url), captureBodies)),
          }
        : {}),
    })
  }
  io.stdout(values.json ? `${stableStringify(result)}\n` : formatResult(result))
  return result.status === 'ok' ? 0 : 3
}

async function runBatchCommand(argv: string[], io: CliIo): Promise<number> {
  const { values, positionals } = parseCommand(COMMANDS[1], argv)
  if (values.help) {
    io.stdout(helpText('batch'))
    return 0
  }
  if (positionals.length > 0) throw new UsageError('batch takes no positional arguments')
  if (typeof values.input !== 'string' || typeof values.out !== 'string') throw new UsageError('batch needs --input and --out')
  const report = await runBatch({
    input: values.input,
    outDir: values.out,
    concurrency: positiveInt(values.concurrency as string | undefined, 'concurrency', 4),
    retryErrors: values['retry-errors'] === true,
    allowPrivateNetwork: values['allow-private-network'] === true,
    ...(typeof values.captures === 'string' ? { captureDir: values.captures } : {}),
    captureBodies: parseCaptureBodies(values['capture-bodies'] as string | undefined),
    ...(io.transport ? { transport: io.transport } : {}),
    ...(io.rateLimiter ? { rateLimiter: io.rateLimiter } : {}),
    ...(io.sleep ? { sleep: io.sleep } : {}),
    ...(io.now ? { now: io.now } : {}),
    onResult: (result) => io.stderr(`${result.status === 'ok' ? `${String(result.score).padStart(3)} ${result.grade}` : result.status.toUpperCase()}  ${result.input}\n`),
    onFailure: (input) => io.stderr(`FAILED  ${input} (will be retried on the next run)\n`),
  })
  io.stdout(`Sites: ${report.total}  already done: ${report.alreadyDone}  scanned: ${report.scanned}  failed: ${report.failed.length}\nWrote ${values.out}/results.jsonl, results.csv, summary.json\n`)
  return report.failed.length > 0 ? 1 : 0
}

async function runFrame(argv: string[], io: CliIo): Promise<number> {
  const { values, positionals } = parseCommand(COMMANDS[2], argv)
  if (values.help) {
    io.stdout(helpText('frame'))
    return 0
  }
  if (positionals.length > 0) throw new UsageError('frame takes no positional arguments')
  if (typeof values.out !== 'string') throw new UsageError('frame needs --out')
  const limit = positiveInt(values.limit as string | undefined, 'limit', 1000)
  if (limit > 1000) throw new UsageError('--limit cannot exceed 1000 (the GitHub search API cap)')
  const env = io.env ?? process.env
  const rows = await buildFrame({
    out: values.out,
    limit,
    token: env.GITHUB_TOKEN || undefined,
    allowPrivateNetwork: values['allow-private-network'] === true,
    ...(typeof values.captures === 'string' ? { captureDir: values.captures } : {}),
    ...(io.transport ? { transport: io.transport } : {}),
    ...(io.rateLimiter ? { rateLimiter: io.rateLimiter } : {}),
    ...(io.sleep ? { sleep: io.sleep } : {}),
    ...(io.now ? { now: io.now } : {}),
    ...(env.THALLY_SCAN_GITHUB_API ? { apiBase: env.THALLY_SCAN_GITHUB_API } : {}),
    onRow: (row) => io.stderr(`${String(row.rank).padStart(4)} ${row.decision.padEnd(7)} ${row.reason.padEnd(19)} ${row.repo}\n`),
  })
  io.stdout(`Repositories: ${rows.length}  included: ${rows.filter((row) => row.decision === 'include').length}\nWrote ${values.out}\n`)
  return 0
}

/**
 * Run the CLI with the given arguments (without the node and script paths).
 * Returns the exit code instead of exiting, so it can run in process.
 */
export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const [command, ...rest] = argv
  try {
    if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
      io.stdout(helpText(rest[0]))
      return command === undefined ? 2 : 0
    }
    if (command === '--version' || command === '-v') {
      io.stdout(`${scannerVersion} (${methodology.id} v${methodology.version})\n`)
      return 0
    }
    if (command === 'scan') return await runScan(rest, io)
    if (command === 'batch') return await runBatchCommand(rest, io)
    if (command === 'frame') return await runFrame(rest, io)
    throw new UsageError(`Unknown command: ${command}`)
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`thally-scan: ${error.message}\nRun 'thally-scan --help' for usage.\n`)
      return 2
    }
    io.stderr(`thally-scan: ${(error as Error)?.message ?? String(error)}\n`)
    return 1
  }
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isMainModule()) {
  runCli(process.argv.slice(2), {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  }).then((code) => {
    process.exitCode = code
  })
}
