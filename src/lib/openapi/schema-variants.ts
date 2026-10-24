/** Schema shapes shared by the API page and the Try it form: allOf merging and oneOf/anyOf variants. */

function isSchema(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

/** The object members of a schema's `oneOf` (else `anyOf`); null when it has none. */
function unionMembers(schema: Record<string, unknown>): Array<Record<string, unknown>> | null {
  const list = Array.isArray(schema.oneOf) ? schema.oneOf : Array.isArray(schema.anyOf) ? schema.anyOf : null
  const members = list?.filter(isSchema)
  return members?.length ? members : null
}

/** The part of a schema that fragments of an allOf contribute to the merged one. */
function structure({ properties, required, type }: Record<string, unknown>) {
  return { properties, required, type }
}

/** Adds the properties, required names and type of plain, already flat fragments to `base`. */
function mergeFragments(base: Record<string, unknown>, fragments: Array<Record<string, unknown>>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base }
  const mergedProps: Record<string, unknown> = {}
  const mergedRequired: string[] = []

  for (const f of fragments) {
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

/**
 * Merges allOf fragments into a single flat schema so the renderer can
 * iterate over a unified properties map instead of checking each fragment.
 *
 * A oneOf/anyOf that is a fragment of the allOf (or sits beside it) is never dropped. With one
 * member it is merged like any other fragment. With several, the result is a union whose members
 * each carry the properties around it, so the renderer lists them as it lists any other union.
 * Two unions give every pairing of their members.
 */
export function flattenSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(schema.allOf)) return schema

  const { allOf, anyOf, oneOf, ...rest } = schema as { allOf: Array<unknown>; anyOf?: unknown; oneOf?: unknown } & Record<string, unknown>
  const fragments = [...allOf, ...(anyOf || oneOf ? [{ anyOf, oneOf }] : [])].filter(isSchema).map(flattenSchema)
  const at = fragments.findIndex((fragment) => unionMembers(fragment))
  if (at < 0) return mergeFragments(rest, fragments)

  const members = unionMembers(fragments[at]) as Array<Record<string, unknown>>
  // What the union fragment holds besides its members is shared by all of them.
  const shared = { ...fragments[at], anyOf: undefined, oneOf: undefined }
  const withMember = (member: Record<string, unknown>) => fragments.flatMap((fragment, index) => (index === at ? [shared, member] : [fragment]))
  if (members.length === 1) return flattenSchema({ ...rest, allOf: withMember(members[0]) })

  // The union has no type or properties of its own: each member lists them, with its own title and description.
  const outer = { ...rest }
  for (const key of ['properties', 'required', 'type']) delete outer[key]
  return {
    ...outer,
    anyOf: members.map((member) => {
      const flat = flattenSchema(member)
      const own = { ...flat }
      for (const key of ['properties', 'required', 'type']) delete own[key]
      return flattenSchema({ ...own, allOf: [structure(rest), ...withMember(structure(flat))] })
    }),
  }
}

export interface SchemaVariant {
  /** The variant's own title, or its discriminator value. */
  label?: string
  schema: Record<string, unknown>
}

export function unionVariants(schema: Record<string, unknown>): Array<SchemaVariant> | null {
  const entries = unionMembers(schema)
  if (!entries) return null
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
