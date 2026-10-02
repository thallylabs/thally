import { buildSchemaExample } from '@/lib/openapi/schema-example'
import type { NormalizedResponse } from '@/lib/openapi/types'

export interface ResponseExample {
  key: string
  label: string
  value: unknown
}

/**
 * The examples shown for one response status: the media type's own `example`
 * and `examples`, or, when the spec has none, one built from its schema.
 */
export function responseExamples(response: NormalizedResponse): Array<ResponseExample> {
  const content = response.contents.find((c) => c.mediaType.includes('json')) ?? response.contents[0]
  if (!content) return []
  const authored: Array<ResponseExample> = [
    ...(content.example !== undefined ? [{ key: 'example', label: 'Example', value: content.example }] : []),
    ...content.examples.map((e) => ({ key: e.key, label: e.summary ?? e.key, value: e.value })),
  ]
  if (authored.length) return authored
  const generated = content.schema ? buildSchemaExample(content.schema, () => null, new Set<string>(), true) : undefined
  return generated === undefined ? [] : [{ key: 'example', label: 'Example', value: generated }]
}

export function formatExample(value: unknown): string {
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2)
    } catch {
      return value
    }
  }
  return JSON.stringify(value, null, 2) ?? String(value)
}
