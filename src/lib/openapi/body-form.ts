import { flattenSchema, unionVariants } from '@/lib/openapi/schema-variants'

type Schema = Record<string, unknown>

/** The JSON type a schema describes, ignoring `null` in a `type: [x, null]` list. */
export function schemaKind(schema: Schema): string | undefined {
  const flat = flattenSchema(schema)
  const type = Array.isArray(flat.type) ? flat.type.find((entry) => entry !== 'null') : flat.type
  if (typeof type === 'string') return type
  if (flat.properties) return 'object'
  if (flat.items) return 'array'
  return undefined
}

/** The value a freshly added field or array item starts with: required fields only, and defaults. */
export function emptyValue(schema: Schema): unknown {
  const flat = flattenSchema(schema)
  if (flat.default !== undefined) return flat.default
  if (flat.const !== undefined) return flat.const
  const variants = unionVariants(flat)
  if (variants && !flat.type) return emptyValue(variants[0].schema)
  const kind = schemaKind(flat)
  if (kind === 'object') {
    const properties = (flat.properties ?? {}) as Record<string, Schema>
    const required = Array.isArray(flat.required) ? (flat.required as Array<string>) : []
    return Object.fromEntries(required.filter((key) => properties[key]).map((key) => [key, emptyValue(properties[key])]))
  }
  if (kind === 'array') return []
  if (kind === 'boolean') return false
  if (Array.isArray(flat.enum) && flat.enum.length) return flat.enum[0]
  if (kind === 'integer' || kind === 'number') return undefined
  return ''
}

/** Which oneOf/anyOf variant a value belongs to: the first whose own fields cover the value's keys, then by type. */
export function activeVariant(variants: Array<{ schema: Schema }>, value: unknown): number {
  const found = variants.findIndex(({ schema }) => {
    const kind = schemaKind(schema)
    if (kind === 'object') {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
      const properties = (flattenSchema(schema).properties ?? {}) as Record<string, Schema>
      return Object.entries(value).every(([key, entry]) => {
        const property = properties[key]
        if (!property) return false
        const constant = flattenSchema(property).const
        const enumeration = flattenSchema(property).enum
        return constant !== undefined ? constant === entry : !Array.isArray(enumeration) || enumeration.includes(entry)
      })
    }
    if (kind === 'array') return Array.isArray(value)
    if (kind === 'integer' || kind === 'number') return typeof value === 'number'
    if (kind === 'boolean') return typeof value === 'boolean'
    return typeof value === 'string'
  })
  return found === -1 ? 0 : found
}

/** The flat `name=value` pairs of a form body: arrays repeat the name, objects are sent as JSON. */
export function formPairs(value: unknown): Array<[string, string]> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
  return Object.entries(value).flatMap(([key, entry]): Array<[string, string]> => {
    const items = Array.isArray(entry) ? entry : [entry]
    return items
      .filter((item) => item !== undefined && item !== null)
      .map((item): [string, string] => [key, typeof item === 'object' ? JSON.stringify(item) : String(item)])
  })
}

/** An `application/x-www-form-urlencoded` body. */
export const encodeUrlencoded = (value: unknown) => new URLSearchParams(formPairs(value)).toString()

export const isMultipart = (mediaType?: string) => Boolean(mediaType?.toLowerCase().startsWith('multipart/'))
export const isUrlencoded = (mediaType?: string) => Boolean(mediaType?.toLowerCase().startsWith('application/x-www-form-urlencoded'))

/** A schema the typed form can edit: an object (or a union of them) with a JSON-shaped body. */
export function isFormEditable(schema: Schema | undefined): boolean {
  if (!schema) return false
  const flat = flattenSchema(schema)
  return schemaKind(flat) === 'object' || Boolean(unionVariants(flat))
}

/** Sets `key` on a copy of `object`, or removes it when `next` is undefined, an empty string or NaN. */
export function withField(object: unknown, key: string, next: unknown, keepEmpty: boolean): Record<string, unknown> {
  const copy = { ...(typeof object === 'object' && object !== null && !Array.isArray(object) ? (object as Record<string, unknown>) : {}) }
  const empty = next === undefined || (typeof next === 'number' && Number.isNaN(next)) || (next === '' && !keepEmpty)
  if (empty) delete copy[key]
  else copy[key] = next
  return copy
}
