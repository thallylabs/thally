/**
 * Resumable batch scanning. Each finished site is appended to
 * `results.jsonl` as one canonical JSON line; a rerun skips inputs that
 * already have a line. `results.csv` and `summary.json` are rebuilt in full
 * from `results.jsonl` at the end of every run. One site's failure never
 * stops the batch.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, truncateSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { defaultCaptureBodies, siteKeyFor } from './net/capture.js'
import { parseCsvRecords } from './output/csv.js'
import { resultsToCsv } from './output/results-csv.js'
import { stableStringify } from './output/stable-json.js'
import { summarize } from './output/summary.js'
import { scanSite } from './scan.js'
import type { ScanOptions, SiteResult } from './types.js'

/** Share of sites whose capture keeps raw bodies. */
export type CaptureBodiesSetting = 'all' | 'none' | number

/** Options for `runBatch`. */
export interface BatchOptions extends Omit<ScanOptions, 'captureDir' | 'captureBodies' | 'thallyHostedOverride'> {
  /** Path to the input CSV (a frame `sample.csv` or a single `url` column). */
  input: string
  outDir: string
  /** Sites scanned in parallel; default 4. The per-host limiter is shared. */
  concurrency?: number
  captureDir?: string
  /** Default: a deterministic 10% of sites. */
  captureBodies?: CaptureBodiesSetting
  /** Re-run sites whose recorded result is `error` or `skipped`. */
  retryErrors?: boolean
  /** Called after each site's line is written. */
  onResult?: (result: SiteResult) => void
  /** Called when a site throws unexpectedly; the batch continues. */
  onFailure?: (input: string, error: unknown) => void
}

/** What a batch run did. */
export interface BatchReport {
  total: number
  alreadyDone: number
  scanned: number
  failed: string[]
}

/**
 * Read scan inputs from CSV text. A frame CSV (`decision`, `docs_root`)
 * contributes its included docs roots; otherwise the `url` column is used.
 * Duplicates are dropped, first occurrence wins.
 */
export function readBatchInputs(csvText: string): string[] {
  const records = parseCsvRecords(csvText)
  const inputs: string[] = []
  for (const record of records) {
    let value = ''
    if ('decision' in record && 'docs_root' in record) {
      if (record.decision === 'include') value = record.docs_root
    } else if ('url' in record) value = record.url
    else throw new Error('Input CSV needs a `url` column, or `decision` and `docs_root` columns from `thally-scan frame`.')
    if (value && !inputs.includes(value)) inputs.push(value)
  }
  return inputs
}

/**
 * Read `results.jsonl`, truncating a partial trailing line left by a crash.
 * Returns the latest result per input.
 */
export function readResults(path: string): Map<string, SiteResult> {
  const latest = new Map<string, SiteResult>()
  if (!existsSync(path)) return latest
  const raw = readFileSync(path, 'utf8')
  const lastNewline = raw.lastIndexOf('\n')
  const complete = lastNewline === -1 ? '' : raw.slice(0, lastNewline + 1)
  if (complete.length !== raw.length) truncateSync(path, Buffer.byteLength(complete))
  for (const line of complete.split('\n')) {
    if (!line.trim()) continue
    try {
      const result = JSON.parse(line) as SiteResult
      if (typeof result.input === 'string') latest.set(result.input, result)
    } catch {
      // A corrupt line is ignored; its site is scanned again.
    }
  }
  return latest
}

function captureBodiesFor(setting: CaptureBodiesSetting | undefined, input: string): boolean {
  if (setting === 'all') return true
  if (setting === 'none') return false
  return defaultCaptureBodies(siteKeyFor(input), setting ?? 10)
}

/** Rewrite `results.csv` and `summary.json` from `results.jsonl`, in input order. */
export function writeAggregates(outDir: string, inputs: string[]): SiteResult[] {
  const latest = readResults(join(outDir, 'results.jsonl'))
  const order = new Map(inputs.map((input, index) => [input, index]))
  const results = [...latest.values()].sort((a, b) => {
    const x = order.get(a.input) ?? Number.MAX_SAFE_INTEGER
    const y = order.get(b.input) ?? Number.MAX_SAFE_INTEGER
    return x !== y ? x - y : a.input < b.input ? -1 : a.input > b.input ? 1 : 0
  })
  writeFileSync(join(outDir, 'results.csv'), resultsToCsv(results))
  writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify(JSON.parse(stableStringify(summarize(results))), null, 2)}\n`)
  return results
}

/** Scan every input in the CSV, resuming from an existing `results.jsonl`. */
export async function runBatch(options: BatchOptions): Promise<BatchReport> {
  const inputs = readBatchInputs(readFileSync(options.input, 'utf8'))
  mkdirSync(options.outDir, { recursive: true })
  const jsonlPath = join(options.outDir, 'results.jsonl')
  const existing = readResults(jsonlPath)
  const pending = inputs.filter((input) => {
    const previous = existing.get(input)
    if (!previous) return true
    return options.retryErrors === true && previous.status !== 'ok'
  })
  const report: BatchReport = { total: inputs.length, alreadyDone: inputs.length - pending.length, scanned: 0, failed: [] }
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 4))
  let next = 0
  const worker = async () => {
    while (next < pending.length) {
      const input = pending[next++]
      try {
        const result = await scanSite(input, {
          ...options,
          captureDir: options.captureDir,
          captureBodies: captureBodiesFor(options.captureBodies, input),
        })
        appendFileSync(jsonlPath, `${stableStringify(result)}\n`)
        report.scanned++
        options.onResult?.(result)
      } catch (error) {
        report.failed.push(input)
        options.onFailure?.(input, error)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, pending.length)) }, worker))
  writeAggregates(options.outDir, inputs)
  return report
}
