type RawObject = Record<string, unknown>

/**
 * A sample value for a schema: its own example/default/const/enum first, then
 * its shape (the first variant of a union). `placeholders` gives strings and
 * numbers the `<string>` / `123` look the live docs use. Imported by the data
 * layer and by the response panel, which builds response examples on demand.
 */
export function buildSchemaExample(schema: RawObject | undefined, resolveRef: (ref: string) => RawObject | null, seen = new Set<string>(), placeholders = false): unknown {
  if (!schema) {
    return undefined
  }
  if (schema.example !== undefined) {
    return schema.example
  }
  if (schema.default !== undefined) {
    return schema.default
  }
  if (schema.const !== undefined) {
    return schema.const
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0]
  }
  if (typeof schema.$ref === 'string') {
    if (seen.has(schema.$ref)) {
      return undefined
    }
    seen.add(schema.$ref)
    const resolved = resolveRef(schema.$ref)
    if (resolved) {
      return buildSchemaExample(resolved, resolveRef, seen, placeholders)
    }
  }
  // A union is sampled by its first variant, as the live docs do.
  const variants = Array.isArray(schema.oneOf) ? schema.oneOf : Array.isArray(schema.anyOf) ? schema.anyOf : undefined
  if (variants?.length && variants[0] && typeof variants[0] === 'object') {
    return buildSchemaExample(variants[0] as RawObject, resolveRef, new Set(seen), placeholders)
  }
  if (Array.isArray(schema.allOf)) {
    return schema.allOf.reduce<unknown>((acc, fragment) => {
      const sample = fragment && typeof fragment === 'object' ? buildSchemaExample(fragment as RawObject, resolveRef, new Set(seen), placeholders) : undefined
      if (Array.isArray(acc) || Array.isArray(sample)) {
        return sample ?? acc
      }
      if (typeof acc === 'object' && acc !== null && typeof sample === 'object' && sample !== null) {
        return { ...(acc as RawObject), ...(sample as RawObject) }
      }
      return sample ?? acc
    }, {})
  }

  const type = typeof schema.type === 'string' ? schema.type : undefined
  if (type === 'object' || schema.properties) {
    const properties = schema.properties && typeof schema.properties === 'object' ? (schema.properties as Record<string, RawObject>) : {}
    const result: Record<string, unknown> = {}
    Object.entries(properties).forEach(([key, value]) => {
      result[key] = buildSchemaExample(value, resolveRef, new Set(seen), placeholders) ?? ''
    })
    return result
  }
  if (type === 'array' && schema.items && typeof schema.items === 'object') {
    const sampleItem = buildSchemaExample(schema.items as RawObject, resolveRef, new Set(seen), placeholders)
    return sampleItem !== undefined ? [sampleItem] : []
  }
  if (type === 'boolean') {
    return true
  }
  if (type === 'integer' || type === 'number') {
    if (!placeholders) {
      return 0
    }
    return typeof schema.minimum === 'number' ? schema.minimum + 1 : 123
  }
  if (placeholders && typeof schema.format === 'string' && schema.format in formatSamples) {
    return formatSamples[schema.format]
  }
  return placeholders ? '<string>' : ''
}

// What the live docs show for common string formats.
const formatSamples: Record<string, string> = {
  uuid: '3c90c3cc-0d44-4b50-8888-8dd25736052a',
  'date-time': '2023-11-07T05:31:56Z',
  date: '2023-11-07',
  email: 'jsmith@example.com',
}
