/**
 * Body decoding above the transport, so captures always hold raw bytes. The
 * charset comes from Content-Type, else (for HTML) a `<meta>` declaration in
 * the first 1024 bytes, else UTF-8. Undecodable bytes become U+FFFD.
 */

import { createHash } from 'node:crypto'

/** Lower-case media type without parameters, or null. */
export function mediaTypeOf(contentType: string | null | undefined): string | null {
  if (!contentType) return null
  const type = contentType.split(';')[0].trim().toLowerCase()
  return type || null
}

function charsetParam(contentType: string | null | undefined): string | null {
  if (!contentType) return null
  const match = /;\s*charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType)
  return match ? match[1].toLowerCase() : null
}

function sniffHtmlCharset(bytes: Uint8Array): string | null {
  const head = Buffer.from(bytes.subarray(0, 1024)).toString('latin1')
  const direct = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)
  return direct ? direct[1].toLowerCase() : null
}

function decoderFor(label: string | null): TextDecoder {
  try {
    return new TextDecoder(label ?? 'utf-8', { fatal: false })
  } catch {
    return new TextDecoder('utf-8', { fatal: false })
  }
}

/** Decode a body to text. */
export function decodeBody(bytes: Uint8Array, contentType: string | null | undefined): string {
  const type = mediaTypeOf(contentType)
  const isHtml = type === 'text/html' || type === 'application/xhtml+xml'
  const label = charsetParam(contentType) ?? (isHtml ? sniffHtmlCharset(bytes) : null)
  return decoderFor(label).decode(bytes).replace(/^﻿/, '')
}

/** Hex SHA-256 of a body. */
export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}
