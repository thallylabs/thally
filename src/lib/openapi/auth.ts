import type { NormalizedAuthScheme } from '@/lib/openapi/types'

/** Only header credentials are sent: the relay blocks cookies, and a key in a URL would be logged and cached. */
export const isSendableScheme = (scheme: NormalizedAuthScheme) => scheme.in === 'header'

const base64 = (value: string) => {
  const bytes = new TextEncoder().encode(value)
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
}

/** `user:password` is encoded here; a value that is already base64 (the old docs.json form) passes through. */
function basicValue(value: string) {
  return value.includes(':') ? base64(value) : value
}

/**
 * Authorization headers for the typed credentials. An empty credential sends
 * no header; with `placeholders` the sample shows `<token>` in its place.
 */
export function authHeaders(
  schemes: Array<NormalizedAuthScheme>,
  values: Record<string, string>,
  placeholders = false,
): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const scheme of schemes.filter(isSendableScheme)) {
    const typed = (values[scheme.name] ?? '').trim()
    if (!typed && !placeholders) continue
    if (scheme.kind === 'bearer') headers[scheme.paramName] = `Bearer ${typed || '<token>'}`
    else if (scheme.kind === 'basic') headers[scheme.paramName] = `Basic ${typed ? basicValue(typed) : '<credentials>'}`
    else headers[scheme.paramName] = typed || '<token>'
  }
  return headers
}

/** The "Authorizations" row text: how the credential is sent, then the spec's own description. */
export function authDescription(scheme: NormalizedAuthScheme): string {
  const how =
    scheme.kind === 'bearer'
      ? 'Bearer authentication header of the form `Bearer <token>`, where `<token>` is your auth token.'
      : scheme.kind === 'basic'
        ? 'Basic authentication header of the form `Basic <credentials>`, where `<credentials>` is the base64 encoding of `username:password`.'
        : `API key sent in the \`${scheme.paramName}\` ${scheme.in === 'cookie' ? 'cookie' : scheme.in === 'query' ? 'query parameter' : 'header'}.`
  return scheme.description ? `${how}\n\n${scheme.description}` : how
}
