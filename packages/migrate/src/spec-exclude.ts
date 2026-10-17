/** Fail-closed pruning of OpenAPI operations that only access-restricted pages document; shared by local and remote specs. */
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import { canonicalSpecRef, isRemoteSpecRef, resolveSpecRef, splitOpenApiRef, withoutSpecExtension } from './openapi-ref.js'

/** A spec as exclusion sees it: where it was read from (what pages name), and the name it is saved under (which they never do). */
interface SpecIdentity {
  sourcePath: string
  filename: string
}

/**
 * Whether a frontmatter `openapi:` value ("GET /x", "specs/api.json GET /x")
 * can name the spec read from `specPath`: a deliberately wide test, for refs
 * that withhold. A bare operation resolves to the default spec; a prefixed one
 * to the spec whose path ends with the prefix, on a segment boundary; the
 * extension may be left out (`openapi` names `docs/openapi.yml`). The prefix is
 * read like a page's own (`canonicalSpecRef`), in any letter case. Each spec is
 * asked on its own, so a prefix that fits several specs names every one of
 * them: callers withholding an operation fail closed on an ambiguous prefix.
 */
export function specRefMatches(ref: string, specPath: string, isDefault: boolean): boolean {
  const prefix = splitOpenApiRef(ref)?.specRef
  if (!prefix) return isDefault
  const wanted = (isRemoteSpecRef(prefix) ? prefix.trim() : canonicalSpecRef(prefix)).toLowerCase()
  // Whole path segments only: `pi/openapi.json` does not name `api/openapi.json`.
  const lowerPath = specPath.toLowerCase()
  const stem = withoutSpecExtension(lowerPath)
  return lowerPath === wanted || lowerPath.endsWith(`/${wanted}`) || stem === wanted || stem.endsWith(`/${wanted}`)
}

/** The sources `ref` resolves to among `specs`, the way a page's spec prefix does: one match, or every candidate of an ambiguous name. */
function resolvedSources(ref: string, specs: ReadonlyArray<SpecIdentity>): { unique: boolean; sources: Array<string> } {
  const specRef = splitOpenApiRef(ref)?.specRef
  if (!specRef || isRemoteSpecRef(specRef)) return { unique: false, sources: [] }
  const resolved = resolveSpecRef(specRef, specs)
  if (resolved.kind === 'match') return { unique: true, sources: [resolved.spec.sourcePath] }
  return { unique: false, sources: resolved.kind === 'ambiguous' ? resolved.candidates.map((candidate) => candidate.sourcePath) : [] }
}

/** A ref that withholds names the spec if the wide test says so or a page would resolve it there (fail closed: either suffices). */
function refWithholdsFrom(ref: string, spec: SpecIdentity, specs: ReadonlyArray<SpecIdentity>): boolean {
  return specRefMatches(ref, spec.sourcePath, true) || resolvedSources(ref, specs).sources.includes(spec.sourcePath)
}

/**
 * A ref that keeps an operation public keeps it in one spec only: the one a
 * page would resolve it to. A prefix that fits several specs, or none, keeps
 * nothing public; a remote address keeps it in that spec. A bare operation
 * names no spec, so it keeps nothing: callers name the spec it belongs to (its
 * tab's, or the site's default) before passing it, and leave it out when that
 * cannot be established.
 */
function refKeepsIn(ref: string, spec: SpecIdentity, specs: ReadonlyArray<SpecIdentity>): boolean {
  const specRef = splitOpenApiRef(ref)?.specRef
  if (!specRef) return false
  if (isRemoteSpecRef(specRef)) return specRefMatches(ref, spec.sourcePath, false)
  const { unique, sources } = resolvedSources(ref, specs)
  return unique && sources[0] === spec.sourcePath
}

/** `GET /x` / `webhook name` normalised so two spellings of one operation compare equal. */
export function operationKey(operation: string): string {
  const [first, ...rest] = operation.trim().split(/\s+/)
  return `${first.toLowerCase()} ${rest.join(' ')}`
}

/** Operation keys of the refs `names` accepts. */
function keysFor(refs: ReadonlyArray<string>, names: (ref: string) => boolean): Array<string> {
  return [...new Set(
    refs.filter(names).map((ref) => splitOpenApiRef(ref)?.operation).filter((op): op is string => !!op).map(operationKey),
  )]
}

/**
 * Operations only withheld refs name (`withheld`) and those a kept ref names
 * (`kept`), for one spec. `specs` are all the specs pages can name, so a ref is
 * resolved among them as a page's would be; without it the spec stands alone.
 * Kept refs must name their spec: a bare one never keeps an operation public.
 */
export function withheldOperationKeys(
  spec: SpecIdentity,
  withheldRefs: ReadonlyArray<string>,
  keptRefs: ReadonlyArray<string>,
  specs: ReadonlyArray<SpecIdentity> = [spec],
): { withheld: Array<string>; kept: Array<string> } {
  const kept = keysFor(keptRefs, (ref) => refKeepsIn(ref, spec, specs))
  return { withheld: keysFor(withheldRefs, (ref) => refWithholdsFrom(ref, spec, specs)).filter((key) => !kept.includes(key)), kept }
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
