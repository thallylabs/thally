/**
 * Anchors of `<ParamField>` and `<ResponseField>`, as Mintlify serves them.
 *
 * Kept here, dependency-free, because the MDX heading pass runs in the runtime
 * source generator, which cannot rely on `@thallylabs/core` being built. These
 * MUST stay identical to `fieldAnchorBase`, `fieldAnchorName` and
 * `uniqueFieldId` in `@thallylabs/core` (packages/core/src/slugify.ts): `thally
 * check` uses that copy, and a mismatch breaks links to a field.
 */

/**
 * Anchor base of a `<ParamField>` or `<ResponseField>`, as Mintlify serves it:
 * `param-` and the field's name in kebab case, for both components. A camel-case
 * boundary starts a new word (`expiresInDays`, `GitHub`), any run of characters
 * that are not letters or digits separates words (`ratelimits[].name`,
 * `--root-key`, `utm_campaign`), and digits stay with the letters before them
 * (`latency_p75`). Undefined when the name leaves nothing to spell.
 */
export function fieldAnchorBase(name: string): string | undefined {
  const words = name
    .normalize('NFC')
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/(^-|-$)/g, '')
  return words ? `param-${words}` : undefined
}

/** Attributes that name a field, in the order the component shows them. */
const FIELD_NAME_ATTRIBUTES = new Map([
  ['ParamField', ['path', 'query', 'header', 'body', 'name']],
  ['ResponseField', ['name']],
])

/**
 * The name a field element shows, which its anchor is made from. `attribute`
 * reads one literal attribute: a string, or `null` for a value that is not one
 * (an expression). Undefined for any other tag and for a field with no name.
 */
export function fieldAnchorName(tag: string, attribute: (name: string) => string | null | undefined): string | undefined {
  for (const name of FIELD_NAME_ATTRIBUTES.get(tag) ?? []) {
    const value = attribute(name)
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

/**
 * The anchor of one field on a page, given the ids the page already uses. A
 * repeat is numbered from `-1` in document order (`param-app-id`,
 * `param-app-id-1`, `param-app-id-2`), and the numbering is shared by both
 * components. The id is recorded in `used`.
 */
export function uniqueFieldId(base: string, used: Set<string>): string {
  let id = base
  for (let occurrence = 1; used.has(id); occurrence++) id = `${base}-${occurrence}`
  used.add(id)
  return id
}
