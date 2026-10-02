/** Schema shapes shared by the API page and the Try it form: allOf merging and oneOf/anyOf variants. */

/**
 * Merges allOf fragments into a single flat schema so the renderer can
 * iterate over a unified properties map instead of checking each fragment.
 */
export function flattenSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(schema.allOf)) return schema

  const merged: Record<string, unknown> = { ...schema }
  const allOf = schema.allOf as Array<unknown>
  delete (merged as Record<string, unknown>).allOf

  const mergedProps: Record<string, unknown> = {}
  const mergedRequired: string[] = []

  for (const fragment of allOf) {
    if (!fragment || typeof fragment !== 'object') continue
    const f = flattenSchema(fragment as Record<string, unknown>)
    if (f.properties && typeof f.properties === 'object') {
      Object.assign(mergedProps, f.properties as Record<string, unknown>)
    }
    if (Array.isArray(f.required)) {
      mergedRequired.push(...(f.required as string[]))
    }
    if (!merged.type && f.type) merged.type = f.type
  }

  if (Object.keys(mergedProps).length > 0) {
    merged.properties = { ...((merged.properties as Record<string, unknown>) ?? {}), ...mergedProps }
  }
  if (mergedRequired.length > 0) {
    const existing = Array.isArray(merged.required) ? (merged.required as string[]) : []
    merged.required = [...new Set([...existing, ...mergedRequired])]
  }
  return merged
}


export interface SchemaVariant {
  /** The variant's own title, or its discriminator value. */
  label?: string
  schema: Record<string, unknown>
}

export function unionVariants(schema: Record<string, unknown>): Array<SchemaVariant> | null {
  const list = Array.isArray(schema.oneOf) ? schema.oneOf : Array.isArray(schema.anyOf) ? schema.anyOf : null
  const entries = list?.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
  if (!entries?.length) return null
  const discriminator = (schema.discriminator as { propertyName?: unknown } | undefined)?.propertyName
  return entries.flatMap((entry) => {
    const flat = flattenSchema(entry)
    // A variant that is only a union itself is spread into this one, as live does.
    const inner = flat.properties ? null : unionVariants(flat)
    if (inner) return inner
    const property = typeof discriminator === 'string' ? (flat.properties as Record<string, Record<string, unknown>> | undefined)?.[discriminator] : undefined
    const value = property?.const ?? (Array.isArray(property?.enum) ? property.enum[0] : undefined)
    return [{
      label: typeof flat.title === 'string' ? flat.title : value !== undefined ? String(value) : undefined,
      schema: flat,
    }]
  })
}
