/** Dependency-free helpers shared by the OpenAPI normalizer, the sanitizer and build scripts. */

export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'] as const

export function buildOperationKey(method: string, path: string, isWebhook = false) {
  const prefix = isWebhook ? 'WEBHOOK ' : ''
  return `${prefix}${method.toUpperCase()} ${path}`
}

export function isExtensionSet(value: unknown) {
  return value === true || value === 'true'
}
