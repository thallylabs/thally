/**
 * Node HTTP transport: one exchange per call, no redirects, no retries.
 *
 * DNS answers are validated inside the socket's `lookup` hook, so the address
 * that passed the SSRF guard is the address that is connected to. Bodies are
 * decompressed here and the byte cap applies to decompressed bytes, which
 * bounds decompression bombs.
 */

import { lookup as dnsLookup } from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import type { LookupFunction } from 'node:net'
import { isIP } from 'node:net'
import type { Readable } from 'node:stream'
import zlib from 'node:zlib'

import type { ErrorCode, Transport, TransportError, TransportRequest, TransportResponse } from '../types.js'
import { bareHostname, isPublicAddress } from './guard.js'

/** A resolver returning every address for a hostname. */
export type Resolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>

/** Options for `createNodeTransport`. */
export interface NodeTransportOptions {
  /** Permit loopback and private addresses. Only for local testing. */
  allowPrivateNetwork?: boolean
  /** Override DNS resolution (tests). */
  resolver?: Resolver
}

const defaultResolver: Resolver = (hostname) =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, order: 'verbatim' }, (error, addresses) => {
      if (error) reject(error)
      else resolve(addresses)
    })
  })

class GuardError extends Error {
  code = 'PRIVATE_ADDRESS'
}

const TLS_CODES = /^(ERR_TLS|ERR_SSL|CERT_|UNABLE_TO_|DEPTH_ZERO|SELF_SIGNED|ERR_OSSL|HOSTNAME_MISMATCH)/

/** Map a Node network error to a stable code. */
export function mapNetworkError(error: unknown): ErrorCode {
  const code = String((error as { code?: string })?.code ?? '')
  if (code === 'PRIVATE_ADDRESS') return 'private_address'
  if (code === 'TIMEOUT' || code === 'ETIMEDOUT' || code === 'ABORT_ERR') return 'timeout'
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EAI_FAIL' || code === 'EAI_NODATA' || code === 'EAI_NONAME') return 'dns'
  if (TLS_CODES.test(code)) return 'tls'
  return 'connection'
}

function decompressor(encoding: string): zlib.Gunzip | zlib.Inflate | zlib.BrotliDecompress | null {
  const last = encoding.split(',').map((token) => token.trim().toLowerCase()).filter(Boolean).pop() ?? ''
  if (last === 'gzip' || last === 'x-gzip') return zlib.createGunzip()
  if (last === 'deflate') return zlib.createInflate()
  if (last === 'br') return zlib.createBrotliDecompress()
  return null
}

/** Sort headers by lower-case name; a stable sort keeps repeated headers in arrival order. */
export function sortHeaders(raw: string[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = []
  for (let i = 0; i + 1 < raw.length; i += 2) pairs.push([raw[i].toLowerCase(), raw[i + 1]])
  return pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
}

/** Create the default Node transport. */
export function createNodeTransport(options: NodeTransportOptions = {}): Transport {
  const allowPrivate = options.allowPrivateNetwork ?? false
  const resolver = options.resolver ?? defaultResolver

  const lookup: LookupFunction = (hostname, lookupOptions, callback) => {
    resolver(hostname).then(
      (addresses) => {
        if (addresses.length === 0) {
          callback(Object.assign(new Error('no addresses'), { code: 'ENOTFOUND' }), '', 4)
          return
        }
        if (!allowPrivate && !addresses.every((entry) => isPublicAddress(entry.address))) {
          callback(new GuardError('private address'), '', 4)
          return
        }
        if (lookupOptions.all) callback(null, addresses as never)
        else callback(null, addresses[0].address, addresses[0].family)
      },
      (error) => callback(error, '', 4),
    )
  }

  return {
    request(req: TransportRequest): Promise<TransportResponse | TransportError> {
      return new Promise((resolve) => {
        let settled = false
        // Early guard failures finish before the timer exists.
        const timeout: { id?: ReturnType<typeof setTimeout> } = {}
        const finish = (value: TransportResponse | TransportError) => {
          if (settled) return
          settled = true
          clearTimeout(timeout.id)
          resolve(value)
        }
        let url: URL
        try {
          url = new URL(req.url)
        } catch {
          finish({ error: 'invalid_url' })
          return
        }
        const host = bareHostname(url.hostname)
        if (isIP(host) && !allowPrivate && !isPublicAddress(host)) {
          finish({ error: 'private_address' })
          return
        }
        const client = url.protocol === 'https:' ? https : http
        const request = client.request({
          protocol: url.protocol,
          hostname: host,
          port: url.port || undefined,
          path: `${url.pathname}${url.search}`,
          method: req.method,
          headers: req.headers,
          lookup,
          agent: false,
          ...(url.protocol === 'https:' && !isIP(host) ? { servername: host } : {}),
        })
        timeout.id = setTimeout(() => {
          request.destroy(Object.assign(new Error('timeout'), { code: 'TIMEOUT' }))
        }, req.timeoutMs)

        request.on('error', (error) => finish({ error: mapNetworkError(error) }))
        request.on('response', (response) => {
          const status = response.statusCode ?? 0
          const headers = sortHeaders(response.rawHeaders)
          const limit = Math.min(req.maxBodyBytes, req.stopAfterBytes ?? Number.POSITIVE_INFINITY)
          const chunks: Buffer[] = []
          let total = 0
          let truncated = false
          const done = () => {
            finish({ url: req.url, status, headers, body: new Uint8Array(Buffer.concat(chunks)), truncated })
          }
          if (req.method === 'HEAD' || status === 204 || status === 304) {
            response.resume()
            done()
            return
          }
          const encoding = String(response.headers['content-encoding'] ?? '')
          const inflater = decompressor(encoding)
          const stream: Readable = inflater ? response.pipe(inflater) : response
          stream.on('data', (chunk: Buffer) => {
            if (truncated) return
            if (total + chunk.length > limit) {
              chunks.push(chunk.subarray(0, limit - total))
              total = limit
              truncated = true
              done()
              response.destroy()
              inflater?.destroy()
              return
            }
            chunks.push(chunk)
            total += chunk.length
          })
          stream.on('end', done)
          stream.on('error', (error) => {
            if (!truncated) finish({ error: mapNetworkError(error) })
          })
          response.on('error', (error) => {
            if (!truncated) finish({ error: mapNetworkError(error) })
          })
        })
        request.end()
      })
    },
  }
}
