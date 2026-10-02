/** Fail-closed pruning of OpenAPI operations that only access-restricted pages document; shared by local and remote specs. */
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import { splitOpenApiRef } from './openapi-ref.js'

/**
 * Whether a frontmatter `openapi:` value ("GET /x", "specs/api.json GET /x")
 * names this spec. A bare operation resolves to the default spec; a prefixed
 * one to the spec whose path ends with the prefix, on a segment boundary.
 */
export function specRefMatches(ref: string, specPath: string, specFilename: string, isDefault: boolean): boolean {
  const prefix = /^(?:(\S+)\s+)?(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|WEBHOOK)\s/i.exec(`${ref} `)?.[1]
  if (!prefix) return isDefault
  const wanted = prefix.replace(/^\/+/, '').toLowerCase()
  // Whole path segments only: `pi/openapi.json` does not name `api/openapi.json`.
  const lowerPath = specPath.toLowerCase()
  return lowerPath === wanted || lowerPath.endsWith(`/${wanted}`) || specFilename.toLowerCase() === wanted
}

/** `GET /x` / `webhook name` normalised so two spellings of one operation compare equal. */
function operationKey(operation: string): string {
  const [first, ...rest] = operation.trim().split(/\s+/)
  return `${first.toLowerCase()} ${rest.join(' ')}`
}

/** Operation keys of the refs that name this spec. */
function keysFor(spec: { sourcePath: string; filename: string }, refs: ReadonlyArray<string>): Array<string> {
  return [...new Set(
    refs.filter((ref) => specRefMatches(ref, spec.sourcePath, spec.filename, true))
      .map((ref) => splitOpenApiRef(ref)?.operation).filter((op): op is string => !!op).map(operationKey),
  )]
}

/** Operations only withheld refs name (`withheld`) and those a kept ref names (`kept`), for one spec. */
export function withheldOperationKeys(
  spec: { sourcePath: string; filename: string },
  withheldRefs: ReadonlyArray<string>,
  keptRefs: ReadonlyArray<string>,
): { withheld: Array<string>; kept: Array<string> } {
  const kept = keysFor(spec, keptRefs)
  return { withheld: keysFor(spec, withheldRefs).filter((key) => !kept.includes(key)), kept }
}

/**
 * Marks the given operations `x-excluded` (the renderer's sanitizer then drops
 * them from every published surface); returns the new bytes and the operations
 * marked. `keptKeys` stop a `$ref` path item shared with a public operation
 * from being excluded whole.
 */
export function markExcluded(content: Buffer, operationKeys: ReadonlyArray<string>, keptKeys: ReadonlyArray<string> = []): { content: Buffer; excluded: Array<string> } {
  const untouched = { content, excluded: [] as Array<string> }
  if (operationKeys.length === 0) return untouched
  const text = content.toString('utf8')
  type Entries = Record<string, Record<string, unknown> | undefined>
  let doc: { paths?: Entries; webhooks?: Entries; 'x-webhooks'?: Entries }
  try { doc = parseYaml(text) } catch { return untouched }
  if (!doc || typeof doc !== 'object') return untouched
  const excluded: Array<string> = []
  for (const key of operationKeys) {
    const [method, ...rest] = key.split(' ')
    const name = rest.join(' ')
    if (method === 'webhook') {
      const entry = doc.webhooks?.[name] ?? doc['x-webhooks']?.[name]
      if (entry && typeof entry === 'object') { entry['x-excluded'] = true; excluded.push(`WEBHOOK ${name}`) }
      continue
    }
    const entry = doc.paths?.[name]
    if (!entry || typeof entry !== 'object') continue
    // A `$ref` entry may share its item with other operations: exclude it only when no kept ref names the path.
    const target = typeof entry.$ref === 'string'
      ? (keptKeys.some((k) => k.slice(k.indexOf(' ') + 1) === name) ? undefined : entry)
      : entry[method]
    if (target && typeof target === 'object') { (target as Record<string, unknown>)['x-excluded'] = true; excluded.push(`${method.toUpperCase()} ${name}`) }
  }
  if (excluded.length === 0) return untouched
  const out = text.trimStart().startsWith('{') ? `${JSON.stringify(doc, null, 2)}\n` : stringifyYaml(doc)
  return { content: Buffer.from(out), excluded }
}

/** Warning text for a published spec that access-restricted pages also name. */
export function sharedSpecMessage(path: string, excluded: ReadonlyArray<string> = []): string {
  return excluded.length
    ? `OpenAPI spec ${path} is shared with access-restricted pages and is published, but ${excluded.length} operation(s) documented only on those pages were withheld from it (${excluded.join(', ')}). Review the rest of the spec before publishing.`
    : `OpenAPI spec ${path} is shared with access-restricted pages and is published; it may describe restricted endpoints. Review it before publishing.`
}
