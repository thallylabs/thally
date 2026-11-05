/**
 * Ids of the rows of a generated API page, spelled as Mintlify spells them so a link to a field keeps working:
 * `parameter-<name>`, `body-<path>` and `response-<path>` (`#body-explicit-deposit`,
 * `#response-requests-items-data-failed-tx-hash`). Every name on the path is in kebab case; the items of an array add
 * `items`; a union adds `one-of-<n>` after its field, counting its members that are not null from 0, and a field that
 * may be null is that one member (`body-invoice-id-one-of-0`). A row takes the page's first body and the response that
 * is shown, so no id repeats across media types; see `uniqueIds` for names that spell alike.
 */

import { fieldAnchorBase } from '@/lib/field-anchor'
import { allowsNull, flattenSchema, unionVariants } from '@/lib/openapi/schema-variants'

type Schema = Record<string, unknown>

/** A name in kebab case, as `ParamField` spells an anchor; undefined when nothing is left to spell. */
const kebab = (name: string) => fieldAnchorBase(name)?.slice('param-'.length)

/** How many array levels a schema lists the fields of its items through (`getNestedSchema` in the operation panel). */
export function arrayDepth(schema: Schema): number {
  const flat = flattenSchema(schema)
  return flat.type === 'array' && flat.items && typeof flat.items === 'object' ? 1 + arrayDepth(flat.items as Schema) : 0
}

/** The id the rows listed from a schema hang from, below `parent`: one `items` per array level. */
export const itemsParent = (parent: string | undefined, schema: Schema) => parent && `${parent}${'-items'.repeat(arrayDepth(schema))}`

/** The id the rows of one union member hang from: `parent-one-of-<n>`, then the member's own array levels. */
export const memberParent = (parent: string | undefined, index: number, member: Schema) => itemsParent(parent && `${parent}-one-of-${index}`, member)

/** The name of a parameter, which is the same whether it is in the path, the query or a header. */
export const parameterId = (name: string) => {
  const segment = kebab(name)
  return segment && `parameter-${segment}`
}

/**
 * The id of the row of a field of the object whose rows hang from `parent`, and the id its own rows hang from.
 * A union leaves the numbering of its members to `memberParent`, so a nullable one is the member 0 itself.
 * Neither is set without a `parent` (a body that is not given ids) or when the name leaves nothing to spell.
 */
export function fieldIds(parent: string | undefined, name: string, schema: Schema): { id?: string; nested?: string } {
  const segment = kebab(name)
  if (!parent || !segment) return {}
  const base = `${parent}-${segment}`
  const variants = unionVariants(schema)
  if (variants) return { id: variants.length === 1 ? `${base}-one-of-0` : base, nested: base }
  const nullable = schema.nullable === true || (Array.isArray(schema.type) && schema.type.includes('null')) || allowsNull(schema)
  const id = nullable ? `${base}-one-of-0` : base
  return { id, nested: itemsParent(id, schema) }
}

/**
 * Ids as given, but a repeat gets `-2`, `-3` ... in order, so no two rows on a page share one. `taken` holds the ids of the
 * levels above (a `user_id` row and the `id` row of a `user` object spell alike); `rowsBelow` is what the rows of one level
 * pass down. Rows of different branches that spell alike are not told apart: the ids are fixed by the schema, not by what
 * else renders, so a rerender or a tab never renumbers them.
 */
export function uniqueIds(ids: ReadonlyArray<string | undefined>, taken: ReadonlySet<string> = new Set()): Array<string | undefined> {
  const used = new Set(taken)
  return ids.map((id) => {
    if (!id) return id
    let unique = id
    for (let count = 2; used.has(unique); count++) unique = `${id}-${count}`
    used.add(unique)
    return unique
  })
}

/** The ids taken at a level and above it, for the levels below. */
export function rowsBelow(taken: ReadonlySet<string>, ids: ReadonlyArray<string | undefined>): Set<string> {
  return new Set([...taken, ...ids.filter((id): id is string => Boolean(id))])
}
