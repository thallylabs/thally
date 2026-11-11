/**
 * Capture and replay at the transport boundary.
 *
 * A capture directory holds `meta.json`, `exchanges.jsonl` (one line per
 * transport attempt, in issue order) and, when bodies are kept,
 * content-addressed `bodies/<sha256>` files. Captures never store request
 * headers other than Accept, never store Authorization, and redact
 * `set-cookie` values. Replaying a capture with bodies reproduces the scan
 * byte for byte.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { stableStringify } from '../output/stable-json.js'
import type { ErrorCode, Transport, TransportRequest, TransportResponse } from '../types.js'
import { sha256Hex } from './decode.js'

/** One recorded transport attempt. */
export interface CapturedExchange {
  seq: number
  method: 'GET' | 'HEAD'
  url: string
  accept: string
  stopAfterBytes?: number
  status: number | null
  headers: Array<[string, string]>
  bodySha256: string | null
  bytes: number
  truncated: boolean
  error: ErrorCode | null
}

/** Contents of `meta.json`. */
export interface CaptureMeta {
  schema: 1
  input: string
  scannedAt: string
  methodology: { id: string; version: string }
  scannerVersion: string
  bodies: boolean
}

/** Records exchanges made through the wrapped transport. */
export interface CaptureRecorder {
  transport: Transport
  exchanges: CapturedExchange[]
  bodies: Map<string, Uint8Array>
}

/**
 * Deterministic capture directory name for an input URL:
 * `<hostname>-<first 12 hex of sha256(input)>`.
 */
export function siteKeyFor(input: string): string {
  let host = 'invalid'
  try {
    host = new URL(input).hostname.replace(/[^a-zA-Z0-9.-]/g, '_') || 'invalid'
  } catch {
    host = 'invalid'
  }
  return `${host}-${sha256Hex(input).slice(0, 12)}`
}

/** Default body share: a deterministic 10% of sites by site key. */
export function defaultCaptureBodies(siteKey: string, percent = 10): boolean {
  return Number.parseInt(sha256Hex(siteKey).slice(0, 8), 16) % 100 < percent
}

function requestKey(req: Pick<TransportRequest, 'method' | 'url' | 'stopAfterBytes'> & { accept: string }): string {
  return `${req.method} ${req.url} ${req.accept} ${req.stopAfterBytes ?? ''}`
}

/** Wrap a transport so every exchange is recorded. */
export function createCaptureRecorder(inner: Transport): CaptureRecorder {
  const exchanges: CapturedExchange[] = []
  const bodies = new Map<string, Uint8Array>()
  const transport: Transport = {
    async request(req) {
      const seq = exchanges.length
      const placeholder = {} as CapturedExchange
      exchanges.push(placeholder)
      const result = await inner.request(req)
      const base = {
        seq,
        method: req.method,
        url: req.url,
        accept: req.headers.accept ?? '',
        ...(req.stopAfterBytes !== undefined ? { stopAfterBytes: req.stopAfterBytes } : {}),
      }
      if ('error' in result) {
        Object.assign(placeholder, { ...base, status: null, headers: [], bodySha256: null, bytes: 0, truncated: false, error: result.error })
      } else {
        const sha = sha256Hex(result.body)
        bodies.set(sha, result.body)
        Object.assign(placeholder, {
          ...base,
          status: result.status,
          headers: result.headers.map(([name, value]): [string, string] => [name, name === 'set-cookie' ? '[redacted]' : value]),
          bodySha256: sha,
          bytes: result.body.byteLength,
          truncated: result.truncated,
          error: null,
        })
      }
      return result
    },
  }
  return { transport, exchanges, bodies }
}

/** Write a capture directory, replacing any previous capture for the site. */
export function writeCapture(dir: string, meta: CaptureMeta, recorder: CaptureRecorder): void {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'meta.json'), `${stableStringify(meta)}\n`)
  writeFileSync(join(dir, 'exchanges.jsonl'), recorder.exchanges.map((exchange) => `${stableStringify(exchange)}\n`).join(''))
  if (!meta.bodies) return
  mkdirSync(join(dir, 'bodies'), { recursive: true })
  const hashes = [...recorder.bodies.keys()].sort()
  for (const sha of hashes) writeFileSync(join(dir, 'bodies', sha), recorder.bodies.get(sha)!)
}

/** Read `meta.json` from a capture directory. */
export function readCaptureMeta(dir: string): CaptureMeta {
  return JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as CaptureMeta
}

/**
 * A transport that answers from a capture directory. Requests are matched on
 * method, URL, Accept and prefix length; repeated requests (retries) replay
 * in recorded order. Unmatched requests return `capture_miss`. Throws when
 * the capture was recorded without bodies, because it cannot be replayed.
 */
export function createReplayTransport(dir: string): Transport {
  const meta = readCaptureMeta(dir)
  if (!meta.bodies) throw new Error('This capture was recorded without bodies and can only be audited, not replayed.')
  const queues = new Map<string, CapturedExchange[]>()
  const lines = readFileSync(join(dir, 'exchanges.jsonl'), 'utf8').split('\n').filter(Boolean)
  for (const line of lines) {
    const exchange = JSON.parse(line) as CapturedExchange
    const key = requestKey(exchange)
    const queue = queues.get(key) ?? []
    queue.push(exchange)
    queues.set(key, queue)
  }
  return {
    async request(req) {
      const queue = queues.get(requestKey({ ...req, accept: req.headers.accept ?? '' }))
      const exchange = queue?.shift()
      if (!exchange) return { error: 'capture_miss' }
      if (exchange.error) return { error: exchange.error }
      let body: Uint8Array
      try {
        body = exchange.bytes === 0 ? new Uint8Array() : new Uint8Array(readFileSync(join(dir, 'bodies', exchange.bodySha256 ?? '')))
      } catch {
        return { error: 'capture_miss' }
      }
      const response: TransportResponse = {
        url: req.url,
        status: exchange.status ?? 0,
        headers: exchange.headers,
        body,
        truncated: exchange.truncated,
      }
      return response
    },
  }
}
