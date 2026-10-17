/** Dependency-free helpers shared by the OpenAPI normalizer, the sanitizer and build scripts. */

export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'] as const

export function buildOperationKey(method: string, path: string, isWebhook = false) {
  const prefix = isWebhook ? 'WEBHOOK ' : ''
  return `${prefix}${method.toUpperCase()} ${path}`
}

/**
 * The key of an authored reference (`METHOD /path`, or `WEBHOOK METHOD name`),
 * as `buildOperationKey` makes it: whitespace collapsed, method and the
 * `WEBHOOK` marker case-insensitive, path or name exact. Null when it is neither form.
 */
export function operationKeyFromRef(ref: string) {
  const match = /^(WEBHOOK )?(\S+) (.+)$/i.exec(ref.trim().replace(/\s+/g, ' '))
  return match ? buildOperationKey(match[2], match[3], Boolean(match[1])) : null
}

export function isExtensionSet(value: unknown) {
  return value === true || value === 'true'
}
