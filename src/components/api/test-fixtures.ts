import { normalizeSpec } from '@/lib/openapi/normalize'
import type { ApiSpecConfig, OpenAPIDocument, ResolvedSpec } from '@/lib/openapi/types'

/** Normalizes an inline spec and returns its first operation (or first webhook). */
export function operationFrom(document: OpenAPIDocument, webhook = false) {
  const config: ApiSpecConfig = { id: 't', label: 'T', source: { type: 'inline', document } }
  const op = normalizeSpec({ config, document } as ResolvedSpec).operations.find((o) => o.isWebhook === webhook)
  if (!op) throw new Error('no operation')
  return op
}
