/**
 * Validate authored navigation and links against the routes the runtime can
 * serve, including locale fallback and literal redirect chains. Validation is
 * read-only unless the caller explicitly enables orphan-navigation fixes.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname, relative } from 'node:path'
import { execFileSync } from 'node:child_process'
import { parseFrontmatter } from './frontmatter.js'
import { parse as parseYaml } from 'yaml'
import remarkMdx from 'remark-mdx'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { readDocsJson, writeDocsJson, type DocsJsonConfig } from './docs-json.js'
import { API_GROUPS_MAX_DEPTH, groupKeyState, listedOperationKeys, operationDescription, pageState, parseDocReference, type CheckSpec, type DocReference } from './openapi-publication.js'
import { manualApiProblems } from './manual-api-check.js'
import { findPublicSpecs, shadowNote, specHasHiddenOperations } from './public-specs.js'
import { projectNavigationContract } from '@thallylabs/core/navigation'
import { componentIds, constantString, fieldAnchorBase, fieldAnchorName, numberFieldIds, numberHeadingIds, plainInlineText, slugify } from '@thallylabs/core/slugify'
import { validateIntegrations } from '@thallylabs/migrate'
import { checkExternalLinks, type ExternalLinkCheckOptions, type ExternalLinkReference } from './external-links.js'

export interface LintIssue {
  severity: 'error' | 'warning'
  message: string
  file?: string
  line?: number
}

export interface CheckOptions {
  fix: boolean
  ci: boolean
  /** Also HEAD-check external links on public hosts (network). Off by default for deterministic CI. */
  external?: boolean
  /** Test seam for the external-link checker's resolver, requester, and limits. */
  externalLinkOptions?: ExternalLinkCheckOptions
  /** Flag pages whose `sources` changed since their `verifiedCommit` (needs git history). */
  drift?: boolean
  /** Optional structured diagnostics sink used by migration reports. */
  onIssues?: (issues: Array<LintIssue>) => void
  /** Migration's terminal renderer owns diagnostics when running an inline step. */
  silent?: boolean
}

/** Run a git command in the project, returning success + trimmed stdout. */
function gitLocal(projectDir: string, args: Array<string>): { ok: boolean; out: string } {
  try {
    const out = execFileSync('git', args, { cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return { ok: true, out: out.trim() }
  } catch {
    return { ok: false, out: '' }
  }
}

/**
 * Provenance drift: a page is stale when a file it declares in `sources` has
 * changed since the `verifiedCommit` it was last checked against. Deterministic,
 * zero-inference. Fails toward "can't tell" — a verifiedCommit missing from
 * history (e.g. a shallow CI clone) is flagged, never silently passed.
 */
function checkDrift(projectDir: string, file: string, data: Record<string, unknown>, issues: Array<LintIssue>): void {
  const sources = data.sources
  const verifiedCommit = data.verifiedCommit
  if (!Array.isArray(sources) || sources.length === 0 || typeof verifiedCommit !== 'string' || !verifiedCommit.trim()) {
    return
  }

  const commit = verifiedCommit.trim()
  // Is the verified commit even in this checkout? Shallow clones drop old history.
  if (!gitLocal(projectDir, ['cat-file', '-e', `${commit}^{commit}`]).ok) {
    issues.push({
      severity: 'warning',
      message: `Cannot verify freshness: verifiedCommit "${commit.slice(0, 8)}" is not in git history — run with a full clone (fetch-depth: 0).`,
      file,
    })
    return
  }

  for (const src of sources) {
    if (typeof src !== 'string' || !src.trim()) continue
    const colon = src.indexOf(':')
    let filePath = src
    if (colon > 0) {
      const alias = src.slice(0, colon)
      if (alias !== '.' && alias !== 'self') {
        issues.push({
          severity: 'warning',
          message: `Cross-repo source "${src}" — drift check skipped (needs the referenced repo; see multi-repo setup).`,
          file,
        })
        continue
      }
      filePath = src.slice(colon + 1)
    }
    filePath = filePath.replace(/^\.\//, '').replace(/#.*$/, '') // strip ./ and #fragment
    const changed = gitLocal(projectDir, ['log', '--format=%H', `${commit}..HEAD`, '--', filePath]).out
    if (changed) {
      const n = changed.split('\n').filter(Boolean).length
      issues.push({
        severity: 'warning',
        message: `Drift: source "${src}" changed in ${n} commit(s) since it was verified — this page may be stale.`,
        file,
      })
    }
  }
}

function scanMdx(dir: string, results: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry)
    try {
      const stat = statSync(fullPath)
      if (stat.isDirectory()) scanMdx(fullPath, results)
      else if (extname(entry).toLowerCase() === '.mdx') results.push(fullPath)
    } catch {
      // skip
    }
  }
}

function addOrphanToNav(projectDir: string, pageId: string): void {
  const config = readDocsJson(projectDir)
  const tab = config.tabs.find((candidate) => !candidate.href && !candidate.api
    && (candidate.pages?.length || candidate.groups?.length))
  if (!tab) return
  if (tab.pages) {
    if (!tab.pages.includes(pageId)) {
      tab.pages.push(pageId)
      writeDocsJson(projectDir, config)
    }
    return
  }
  if (!tab.groups) return
  const lastGroup = tab.groups[tab.groups.length - 1]
  const existing = lastGroup.pages.filter((p): p is string => typeof p === 'string')
  if (!existing.includes(pageId)) {
    lastGroup.pages.push(pageId)
    writeDocsJson(projectDir, config)
  }
}

const EXPLICIT_ID_ATTRIBUTE = /\bid=(?:"([^"]*)"|'([^']*)'|\{["']([^"'}]*)["']\})/g
const NAMED_ANCHOR = /<a\b[^>]*\bname=(?:"([^"]*)"|'([^']*)')/g

/** Visit rendered prose lines while respecting the opening fence's marker and length. */
function forEachNonFencedLine(content: string, visit: (line: string, lineNumber: number) => void): void {
  let fence: string | undefined
  for (const [index, line] of content.split('\n').entries()) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (marker) {
      if (!fence) fence = marker[1]
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length
        && /^\s*$/.test(line.slice(marker[0].length))) fence = undefined
      continue
    }
    if (!fence) visit(line, index + 1)
  }
}

const mdxParser = unified().use(remarkParse).use(remarkMdx)
/** For a page MDX cannot read: the content parser falls back to plain Markdown too, and its headings still resolve. */
const markdownParser = unified().use(remarkParse)

/** A node of the MDX syntax tree, the one the renderer and the content parser read; JSX elements carry their tag name and attributes. */
interface MdxNode {
  type: string
  name?: string | null
  depth?: number
  value?: string
  attributes?: Array<{ type: string; name?: string; value?: unknown }>
  children?: Array<MdxNode>
}

/** A literal string attribute, as MDX decodes it; `null` for an expression, `undefined` when the attribute is absent. */
function stringAttribute(node: MdxNode, name: string): string | null | undefined {
  const attribute = node.attributes?.find((item) => item.type === 'mdxJsxAttribute' && item.name === name)
  if (!attribute) return undefined
  return typeof attribute.value === 'string' ? attribute.value : null
}

/** A heading may hold a JSX comment with `#id` to keep an id its text would not slugify to; the same pattern as the renderer's heading pass. */
const HEADING_ID_MARKER = /^\s*\/\*\s*#(\S+?)\s*\*\/\s*$/

/**
 * What the renderer's heading pass reads as a heading's text: plain text, inline
 * code and the text of inline markup, and nothing from a JSX element or a `{…}`
 * expression inside it (`## Deploy <Badge>New</Badge>` is `deploy`). With
 * `components`, the text the heading component renders instead, which it slugs
 * when the pass gave the heading no id: the children of a component and a string
 * in braces count too.
 */
function headingText(node: MdxNode, components: boolean): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value ?? ''
  if (node.type === 'break') return '\n'
  if (node.type === 'mdxTextExpression') return components ? constantString(node) ?? '' : ''
  if (node.type === 'mdxJsxTextElement' && !components) return ''
  return (node.children ?? []).map((child) => headingText(child, components)).join('')
}

/** Step title sizes that render a heading; `p` is plain text. */
const STEP_HEADING_SIZES = ['h2', 'h3', 'h4']

/** What a page gives ids to, read from its MDX syntax tree as the renderer's heading pass reads the rendered one. */
interface PageIds {
  /** Headings (h2 to h6) and the `<Step>` titles that render as headings, in document order. */
  headings: Array<{ base: string; explicit: boolean }>
  /** The anchor base of each `<ParamField>` and `<ResponseField>` that has a literal name and no `id` of its own, in document order. */
  fieldBases: Array<string>
  /** Every `id` an author wrote on a JSX element, and each one a component makes from its text. */
  reserved: Set<string>
}

/**
 * Read the ids of a page the way the renderer's heading pass does: a heading is an
 * h2 to h6 of any form (ATX or setext, inside a component, a list or a quote; a
 * code fence or an indented block is code), with the id of a `{/* #id *\/}`
 * comment in it if it has one; a `<Step>` whose title renders as a heading (`titleSize`
 * h2, h3 or h4, on the step or, failing that, on the `<Steps>` around it) is one
 * too. A tag written inside inline code or a comment is not an element, so it counts
 * for nothing. Only literal strings count, as in the renderer. The page is read
 * as MDX alone: the renderer also reads GFM, which turns a tight `a~b~c` or a
 * footnote reference in a heading into other text, and so another id.
 */
function readPageIds(content: string): PageIds {
  let tree: MdxNode
  try {
    tree = mdxParser.parse(content) as unknown as MdxNode
  } catch {
    tree = markdownParser.parse(content) as unknown as MdxNode
  }
  const page: PageIds = { headings: [], fieldBases: [], reserved: new Set() }
  const visit = (node: MdxNode, stepSize: string | undefined): void => {
    let childSize = stepSize
    if (node.type === 'heading' && (node.depth ?? 0) >= 2) {
      const children = node.children ?? []
      const marker = children.findIndex((child) => child.type === 'mdxTextExpression' && HEADING_ID_MARKER.test(child.value ?? ''))
      const given = marker < 0 ? undefined : HEADING_ID_MARKER.exec(children[marker].value ?? '')![1]
      const heading = marker < 0 ? node : { ...node, children: children.filter((_, index) => index !== marker) }
      // A heading made only of components has no id of its own in the renderer's pass, but the heading component slugs the text it renders: that id is numbered with the rest.
      const base = given ?? (slugify(headingText(heading, false)) || slugify(headingText(heading, true)))
      page.headings.push({ base, explicit: given !== undefined })
    } else if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
      const authored = stringAttribute(node, 'id')?.trim()
      if (authored) page.reserved.add(authored)
      for (const id of componentIds(node.name ?? '', (attribute) => stringAttribute(node, attribute))) page.reserved.add(id)
      // `<Steps>` hands its size to every step below it, set or not (a React context).
      if (node.name === 'Steps') childSize = stringAttribute(node, 'titleSize') ?? undefined
      if (node.name === 'Step') {
        const own = stringAttribute(node, 'titleSize')
        const size = own === undefined ? stepSize : own
        const title = stringAttribute(node, 'title')?.trim()
        if (title && size && STEP_HEADING_SIZES.includes(size)) {
          page.headings.push({ base: authored || slugify(plainInlineText(title)), explicit: !!authored })
        }
      }
      if (node.name === 'ParamField' || node.name === 'ResponseField') {
        const name = fieldAnchorName(node.name, (attribute) => stringAttribute(node, attribute))
        const base = name === undefined ? undefined : fieldAnchorBase(name)
        if (!authored && base) page.fieldBases.push(base)
      }
    }
    for (const child of node.children ?? []) visit(child, childSize)
  }
  visit(tree, undefined)
  return page
}

/**
 * Every id a rendered page exposes as a link target: its headings, numbered as
 * the renderer numbers them (`numberHeadingIds`), then its fields (`numberFieldIds`,
 * which skips every id an author wrote and every one a component makes), the ids
 * authored on JSX elements and made by components, and any element in the text
 * with a literal `id` attribute or legacy `<a name>`. Read from the syntax tree
 * like the renderer, so a heading's level, form and place agree with the page.
 */
export function extractHeadingAnchors(content: string): Set<string> {
  const anchors = new Set<string>()
  forEachNonFencedLine(content, (line) => {
    for (const idMatch of line.matchAll(EXPLICIT_ID_ATTRIBUTE)) {
      const id = idMatch[1] ?? idMatch[2] ?? idMatch[3]
      if (id) anchors.add(id)
    }
    // Legacy Markdown exports and notebook conversions commonly use
    // `<a name="section">`; browsers resolve fragments to those too.
    for (const nameMatch of line.matchAll(NAMED_ANCHOR)) {
      const name = nameMatch[1] ?? nameMatch[2]
      if (name) anchors.add(name)
    }
  })
  const page = readPageIds(content)
  const { ids, used } = numberHeadingIds(page.headings)
  for (const id of ids) if (id) anchors.add(id)
  for (const id of numberFieldIds(page.fieldBases, used, page.reserved)) anchors.add(id)
  for (const id of page.reserved) anchors.add(id)
  return anchors
}

/** Compare URL-encoded fragments with the IDs the browser resolves. */
function decodedFragment(fragment: string): string {
  try { return decodeURIComponent(fragment) } catch { return fragment }
}

interface FoundLink {
  target: string
  line: number
}

function extractLinks(content: string): FoundLink[] {
  const links: FoundLink[] = []
  forEachNonFencedLine(content, (rawLine, lineNumber) => {
    const line = rawLine.replace(/`[^`]*`/g, '') // strip inline code spans
    // Markdown links [text](target) and bare href="target"
    for (const m of line.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      links.push({ target: m[1], line: lineNumber })
    }
    for (const m of line.matchAll(/href=["']([^"']+)["']/g)) {
      links.push({ target: m[1], line: lineNumber })
    }
  })
  return links
}

/** Local image references: markdown `![]()` images and `src="..."` attributes. */
function extractImageRefs(content: string): FoundLink[] {
  const refs: FoundLink[] = []
  forEachNonFencedLine(content, (rawLine, lineNumber) => {
    const line = rawLine.replace(/`[^`]*`/g, '')
    for (const m of line.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      refs.push({ target: m[1], line: lineNumber })
    }
    for (const m of line.matchAll(/\bsrc=["']([^"']+)["']/g)) {
      refs.push({ target: m[1], line: lineNumber })
    }
  })
  return refs
}

function localizedPage(
  pageId: string,
  secondaryLocales: Set<string>,
): { navPageId: string; locale?: string } {
  const [first, ...rest] = pageId.split('/')
  if (secondaryLocales.has(first) && rest.length > 0) {
    return { navPageId: rest.join('/'), locale: first }
  }
  return { navPageId: pageId }
}

function pageIdToPath(pageId: string, secondaryLocales: Set<string>): string {
  const { navPageId, locale } = localizedPage(pageId, secondaryLocales)
  const basePath = navPageId === 'introduction' ? '/' : `/${navPageId}`
  return locale ? `/${locale}${basePath === '/' ? '' : basePath}` : basePath
}

interface ResolvedLink {
  path: string
  anchor?: string
  external?: boolean
  cycle?: boolean
}

interface DynamicRedirect {
  regex: RegExp
  paramNames: Array<string>
  destination: string
}

/**
 * Compile a Next.js-style redirect source into a matcher, for a source that
 * contains a dynamic segment (`:param`, `:param*`, `:param+`, `:param?`) —
 * the same syntax `next.config.ts` passes straight to Next's own
 * `redirects()`. A purely literal source (no `:`) doesn't need this; it
 * stays in the exact-match map below. `*`/`+` consume the rest of the path
 * including further `/` segments, matching Next's own behavior.
 */
function compileDynamicRedirectSource(source: string, destination: string): DynamicRedirect | null {
  if (!source.includes(':')) return null
  const paramNames: Array<string> = []
  let pattern = ''
  source.split('/').forEach((segment, index) => {
    const match = segment.match(/^:([A-Za-z_][A-Za-z0-9_]*)([*+?]?)$/)
    const separator = index === 0 ? '' : '/'
    if (!match) {
      pattern += separator + segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return
    }
    const [, name, quantifier] = match
    paramNames.push(name)
    // `*` and `?` also match with the whole segment (and its `/`) absent.
    if (quantifier === '*') pattern += `(?:${separator}(.*))?`
    else if (quantifier === '?') pattern += `(?:${separator}([^/]+))?`
    else pattern += `${separator}(${quantifier === '+' ? '.+' : '[^/]+'})`
  })
  return { regex: new RegExp(`^${pattern}$`), paramNames, destination }
}

/** Substitute a dynamic redirect's matched params into its destination template. */
function resolveDynamicRedirectDestination(redirect: DynamicRedirect, match: RegExpMatchArray): string {
  return redirect.destination.replace(/:([A-Za-z_][A-Za-z0-9_]*)[*+?]?/g, (whole, name: string) => {
    const index = redirect.paramNames.indexOf(name)
    return index === -1 ? whole : (match[index + 1] ?? '')
  })
}

const MAX_REDIRECT_HOPS = 20

const MISSING_DESCRIPTION = 'Missing "description" in frontmatter'

/** Follow literal and Next.js-style dynamic site redirects without accepting cycles as reachable pages. */
function resolveLink(target: string, redirects: ReadonlyMap<string, string>, dynamicRedirects: ReadonlyArray<DynamicRedirect> = []): ResolvedLink {
  let current = target
  let anchor: string | undefined
  const seen = new Set<string>()
  while (true) {
    if (/^(?:https?:)?\/\//i.test(current)) return { path: current, external: true }
    const hash = current.indexOf('#')
    if (hash >= 0) anchor = current.slice(hash + 1)
    const beforeHash = hash >= 0 ? current.slice(0, hash) : current
    const path = beforeHash.split('?', 1)[0].replace(/\/$/, '') || '/'
    // A wildcard can keep matching its own destination (`/docs/:p*` -> `/docs/v2/:p*`), producing a new path every hop.
    if (seen.has(path) || seen.size >= MAX_REDIRECT_HOPS) return { path, anchor, cycle: true }
    seen.add(path)
    const literalRedirect = redirects.get(path)
    if (literalRedirect) {
      current = literalRedirect
      continue
    }
    const dynamicMatch = dynamicRedirects
      .map((redirect) => ({ redirect, match: path.match(redirect.regex) }))
      .find((candidate): candidate is { redirect: DynamicRedirect; match: RegExpMatchArray } => candidate.match !== null)
    if (!dynamicMatch) return { path, anchor }
    current = resolveDynamicRedirectDestination(dynamicMatch.redirect, dynamicMatch.match)
  }
}

/**
 * Specs under `public/` are served verbatim. Independently of docs.json (which
 * may already point at a migrated copy elsewhere), flag any that carry hidden or
 * excluded operations, or that are not the configured source.
 */
function checkPublicSpecs(projectDir: string, tabs: Array<{ api?: { source?: string } }>, issues: LintIssue[]): void {
  const configured = tabs.flatMap((tab) => (tab.api?.source ? [tab.api.source.replace(/^\.\//, '')] : []))
  const isConfigured = (spec: { path: string; urlPath: string }) =>
    configured.some((source) => source === `/${spec.urlPath}` || source === spec.path)
  const hasElsewhereSource = configured.some((source) => !/^https?:/i.test(source))
  const { specs, skipped } = findPublicSpecs(projectDir)
  for (const spec of specs) {
    if (isConfigured(spec)) continue // validateOpenApi already reports it
    if (!spec.hasHiddenOperations && !hasElsewhereSource) continue
    issues.push({
      severity: 'warning',
      file: spec.path,
      message: `${spec.path} is an OpenAPI file served publicly as /${spec.urlPath}${spec.hasHiddenOperations ? ' and it contains x-excluded/x-hidden operations, which are downloadable from it' : ' but is not the spec this site is configured with (an old copy?)'}.${shadowNote(spec.urlPath)} Re-running migration into an existing site does not remove old copies from public/: delete this file manually`,
    })
  }
  for (const path of skipped) {
    issues.push({ severity: 'warning', file: path, message: `${path} is too large to inspect; if it is an OpenAPI file with hidden operations it is served as-is from public/` })
  }
}

/** A tab's spec as the docs route serves it; no document when it is remote or cannot be read here. */
function loadCheckSpec(projectDir: string, source: string, overrides: unknown): CheckSpec {
  if (/^https?:/i.test(source)) return { source, overrides }
  const specPath = source.startsWith('/') ? join(projectDir, 'public', source.slice(1)) : join(projectDir, source)
  try {
    const raw = readFileSync(specPath, 'utf8')
    return { source, overrides, document: /\.json$/i.test(source) ? JSON.parse(raw) : parseYaml(raw) }
  } catch {
    return { source, overrides } // validateOpenApi reports a missing or invalid spec
  }
}

/**
 * A key in an API tab's `api.groups` that matches no published operation of its
 * spec is skipped by the sidebar (a typo, or a hidden or excluded operation), and
 * so is an entry that is not a group or a key, or a group nested too deep. A group
 * icon that is not text is dropped, and `groups` that is not a list is ignored (the
 * generated navigation shows instead). Remote and unreadable specs cannot be judged here.
 * Checks the root tabs and the tabs of every `i18n.navigation` locale, as the
 * sidebar renders them.
 */
export function checkApiGroupKeys(projectDir: string, config: DocsJsonConfig, issues: LintIssue[]): void {
  const versions = config.navigation?.versions
  const seen = new Set<unknown>()
  const scopes: Array<[locale: string | undefined, tabs: unknown]> = [[undefined, config.tabs], ...Object.entries(config.i18n?.navigation ?? {})]
  for (const [locale, tabs] of scopes) {
    for (const tab of (Array.isArray(tabs) ? tabs : []) as Array<ApiGroupsTab | null>) {
      if (!tab || typeof tab !== 'object' || seen.has(tab)) continue
      seen.add(tab)
      checkTabApiGroups(projectDir, tab, locale, versions, issues)
    }
  }
}

interface ApiGroupsTab {
  tab: string
  hidden?: boolean
  version?: string
  api?: { source?: string; navigation?: boolean; groups?: unknown }
}

function checkTabApiGroups(projectDir: string, tab: ApiGroupsTab, locale: string | undefined, versions: unknown, issues: LintIssue[]): void {
  const name = `API tab "${tab.tab}"${locale ? ` (locale ${locale})` : ''}`
  // The sidebar renders a hidden tab when its `version` is a `navigation.versions` label
  // (getSidebarCollections in src/data/docs.ts); every other hidden tab has no sidebar to check.
  // Malformed `navigation.versions` (not a list, null entries) registers no version.
  const rendered = !tab.hidden || Boolean(tab.version && Array.isArray(versions)
    && versions.some((version) => version !== null && typeof version === 'object' && version.label === tab.version))
  // `navigation: false` turns the generated sidebar off, so `api.groups` is unused there.
  if (!rendered || typeof tab.api?.source !== 'string' || tab.api.navigation === false) return
  if (tab.api.groups !== undefined && !Array.isArray(tab.api.groups)) {
    issues.push({
      severity: 'warning',
      file: 'docs.json',
      message: `${name}: api.groups must be a list of groups, so the tab shows the generated navigation. A list looks like [{ "group": "Name", "pages": ["GET /path"] }]`,
    })
  }
  const skipped = { malformed: 0, tooDeep: false, badIcon: 0 }
  const keys = listedOperationKeys(tab.api.groups, skipped)
  if (skipped.malformed > 0) {
    issues.push({
      severity: 'warning',
      file: 'docs.json',
      message: `${name}: api.groups has ${skipped.malformed} ${skipped.malformed === 1 ? 'entry that is' : 'entries that are'} not a group with a "pages" list or an operation key. ${skipped.malformed === 1 ? 'It is' : 'They are'} left out of the sidebar. A group looks like { "group": "Name", "pages": ["GET /path"] }`,
    })
  }
  if (skipped.badIcon > 0) {
    issues.push({
      severity: 'warning',
      file: 'docs.json',
      message: `${name}: api.groups has ${skipped.badIcon} ${skipped.badIcon === 1 ? 'group' : 'groups'} whose "icon" is not text. The icon is dropped and the group is still listed. Use an icon name or an image path`,
    })
  }
  if (skipped.tooDeep) {
    issues.push({
      severity: 'warning',
      file: 'docs.json',
      message: `${name}: api.groups nests groups deeper than ${API_GROUPS_MAX_DEPTH} levels. Groups beyond that level are left out of the sidebar`,
    })
  }
  if (keys.length === 0) return
  const spec = loadCheckSpec(projectDir, tab.api.source, (tab.api as { overrides?: unknown }).overrides)
  if (!spec.document || typeof spec.document !== 'object') return // remote, unreadable or empty: validateOpenApi reports it
  for (const key of keys) {
    const state = groupKeyState(spec.document, key, spec.overrides)
    if (state === 'published') continue
    issues.push({
      severity: 'warning',
      file: 'docs.json',
      message: `${name}: api.groups lists "${key}", which matches no published operation in ${spec.source}${state === 'unknown' ? '' : ` (it is ${state})`}. It is left out of the sidebar. Check the method and path, or publish the operation`,
    })
  }
}

/**
 * A page whose `openapi:` frontmatter names a hidden or excluded operation of
 * the site's default spec (the first visible API tab's, which is what the
 * route consults) 404s and is left out of every listing. Unknown operations
 * are not reported, and remote specs cannot be judged here.
 *
 * A page with no description of its own is described by its operation, so it
 * is reported as missing one only when the operation has none either, or cannot
 * be read here. The site resolves a page's reference against the specs of hidden
 * tabs too (after the visible ones), and so does that lookup.
 */
function checkOperationPages(
  projectDir: string,
  tabs: Array<{ hidden?: boolean; api?: { source?: string } }>,
  pages: Array<{ file: string; reference: DocReference; hasDescription: boolean }>,
  issues: LintIssue[],
): void {
  if (pages.length === 0) return
  const load = (hidden: boolean): Array<CheckSpec> => tabs
    .filter((tab) => Boolean(tab.hidden) === hidden && typeof tab.api?.source === 'string')
    .map((tab) => {
      const api = tab.api as { source: string; overrides?: unknown; webhookGroup?: unknown }
      return { ...loadCheckSpec(projectDir, api.source, api.overrides), ...(typeof api.webhookGroup === 'string' ? { webhookGroup: api.webhookGroup } : {}) }
    })
  // The specs the docs route serves, in its order: visible API tabs, the first being the default.
  const specs = load(false)
  const described = pages.some((page) => !page.hasDescription) ? [...specs, ...load(true)] : specs
  for (const { file, reference, hasDescription } of pages) {
    const state = specs.length > 0 ? pageState(reference, specs) : 'unknown'
    if (state === 'hidden' || state === 'excluded') {
      const operation = `${reference.specRef ? `${reference.specRef} ` : ''}${reference.method} ${reference.path}`
      issues.push({
        severity: 'warning',
        file,
        message: `page ${file} points at ${state} operation ${operation} and is not published: it returns 404 and is left out of navigation, search, sitemap and llms.txt. Publish the operation or point the page at another one`,
      })
    } else if (!hasDescription && operationDescription(reference, described) === undefined) {
      issues.push({ severity: 'warning', message: MISSING_DESCRIPTION, file })
    }
  }
}

function validateOpenApi(projectDir: string, source: string, issues: LintIssue[], overrides?: unknown): void {
  // Runtime URL-style sources are author-owned files below `public/`, while
  // relative sources are resolved from the project root.
  const specPath = source.startsWith('/')
    ? join(projectDir, 'public', source.slice(1))
    : join(projectDir, source)
  if (!existsSync(specPath)) {
    issues.push({ severity: 'error', message: `API reference points at "${source}" but the file does not exist`, file: source })
    return
  }
  let spec: unknown
  try {
    const raw = readFileSync(specPath, 'utf8')
    spec = source.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw)
  } catch (err) {
    issues.push({ severity: 'error', message: `OpenAPI spec is not valid ${source.endsWith('.json') ? 'JSON' : 'YAML'}: ${(err as Error).message}`, file: source })
    return
  }
  const s = spec as Record<string, unknown>
  // Files under public/ are served verbatim by the host, bypassing the
  // publication filter that drops hidden/excluded operations.
  if (s && typeof s === 'object' && (source.startsWith('/') || source.replace(/^\.\//, '').startsWith('public/')) &&
    specHasHiddenOperations(s, overrides)) {
    issues.push({
      severity: 'warning',
      message: `OpenAPI spec "${source}" lives under public/ and contains x-excluded/x-hidden operations; public/ is served as-is, so those operations would be downloadable.${shadowNote(source.replace(/^\.?\/+/, '').replace(/^public\//, ''))} Move it to a project-root path such as "openapi/${source.split('/').pop()}", update docs.json, and delete the copy in public/ (re-running migration into an existing site does not remove old copies from public/)`,
      file: source,
    })
  }
  if (typeof s?.openapi !== 'string' && typeof s?.swagger !== 'string') {
    issues.push({ severity: 'error', message: 'OpenAPI spec is missing the "openapi" (or "swagger") version field', file: source })
  }
  if (typeof s?.info !== 'object' || s.info === null) {
    issues.push({ severity: 'error', message: 'OpenAPI spec is missing the "info" object', file: source })
  }
  const paths = s?.paths
  // OpenAPI 3.1 only needs one of paths, webhooks or components (a webhook-only spec is valid).
  const is31 = typeof s?.openapi === 'string' && s.openapi.startsWith('3.1')
  const hasOtherRoot = (key: string): boolean => typeof s?.[key] === 'object' && s[key] !== null
  if (typeof paths !== 'object' || paths === null) {
    if (!is31 || !(hasOtherRoot('webhooks') || hasOtherRoot('components'))) {
      issues.push({ severity: 'error', message: is31 ? 'OpenAPI spec needs a "paths", "webhooks" or "components" object' : 'OpenAPI spec is missing the "paths" object', file: source })
    }
  } else {
    const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'])
    for (const [p, ops] of Object.entries(paths as Record<string, unknown>)) {
      if (typeof ops !== 'object' || ops === null) {
        issues.push({ severity: 'error', message: `OpenAPI path "${p}" is not an object`, file: source })
        continue
      }
      const hasOp = Object.keys(ops as Record<string, unknown>).some((k) => methods.has(k.toLowerCase()))
      if (!hasOp && typeof (ops as Record<string, unknown>).$ref !== 'string') {
        issues.push({ severity: 'warning', message: `OpenAPI path "${p}" has no operations`, file: source })
      }
    }
  }
}

/** Check a site's content and return a CLI-compatible success or failure code. */
export async function runCheck(projectDir: string, options: CheckOptions): Promise<number> {
  const { fix, ci } = options

  if (!existsSync(join(projectDir, 'docs.json'))) {
    if (!options.silent) console.error(`\n  ❌ Not a Thally project: docs.json not found in ${projectDir}\n`)
    else options.onIssues?.([{ severity: 'error', message: `docs.json not found in ${projectDir}` }])
    return 1
  }

  const contentDir = join(projectDir, 'src', 'content')
  const issues: LintIssue[] = []
  const config = readDocsJson(projectDir)
  const secondaryLocales = new Set(
    (config.i18n?.locales ?? [])
      .map((locale) => locale.code)
      .filter((code) => code !== config.i18n?.defaultLocale),
  )
  const generatedApiPaths = new Set([
    '/api',
    ...Array.from(secondaryLocales, (locale) => `/${locale}/api`),
  ])
  const redirectDestinations = new Map(
    (config.redirects ?? [])
      .filter((redirect) => !redirect.source.includes(':'))
      .map((redirect) => [
        redirect.source.replace(/\/$/, '') || '/',
        redirect.destination,
      ]),
  )
  const dynamicRedirects = (config.redirects ?? []).flatMap((redirect) => {
    const compiled = compileDynamicRedirectSource(redirect.source, redirect.destination)
    return compiled ? [compiled] : []
  })

  for (const message of validateIntegrations((config as { integrations?: unknown }).integrations)) {
    issues.push({ severity: 'warning', message, file: 'docs.json' })
  }

  const navigation = projectNavigationContract(config)
  const navPageIds = new Set(navigation.authoredPageIds)
  for (const tab of navigation.emptyTabs) {
    issues.push({ severity: 'error', message: `Tab "${tab}" has no groups and no href — it will render empty` })
  }

  for (const dup of navigation.duplicatePageIds) {
    // Reusing one page in multiple sections is supported by both Mintlify and
    // Thally. Surface the editorial ambiguity without failing an otherwise
    // valid migration or CI run.
    issues.push({ severity: 'warning', message: `[duplicate] "${dup}" appears more than once in docs.json` })
  }

  for (const pageId of navPageIds) {
    const candidates = [join(contentDir, `${pageId}.mdx`), join(contentDir, `${pageId}/index.mdx`)]
    if (!candidates.some((c) => existsSync(c))) {
      issues.push({ severity: 'error', message: `"${pageId}" is in docs.json but has no MDX file`, file: `src/content/${pageId}.mdx` })
    }
  }

  const allFiles: string[] = []
  if (existsSync(contentDir)) scanMdx(contentDir, allFiles)

  const fixedOrphans: string[] = []
  const operationPages: Array<{ file: string; reference: DocReference; hasDescription: boolean }> = []
  const validPaths = new Set<string>(['/'])
  const anchorsByPath = new Map<string, Set<string>>()
  const linksByFile: Array<{ file: string; path: string; anchors: Set<string>; links: FoundLink[]; images: FoundLink[]; offset: number }> = []

  for (const filePath of allFiles) {
    const rel = filePath.slice(contentDir.length + 1).replace(/\.mdx$/, '').replace(/\\/g, '/')
    const pageId = rel.endsWith('/index') ? rel.slice(0, -6) : rel

    let data: Record<string, unknown> = {}
    let content = ''
    let lineOffset = 0
    try {
      const raw = readFileSync(filePath, 'utf8')
      const parsed = parseFrontmatter(raw)
      data = parsed.data
      content = parsed.content
      // Links/anchors are found in `content` (frontmatter stripped); offset the
      // reported line numbers back to the raw file so CI annotations land right.
      lineOffset = raw.slice(0, raw.indexOf(content)).split('\n').length - 1
    } catch {
      issues.push({ severity: 'error', message: `Could not parse frontmatter`, file: relative(projectDir, filePath) })
      continue
    }

    const { navPageId } = localizedPage(pageId, secondaryLocales)
    if (!navPageIds.has(navPageId) && data.hidden !== true) {
      if (fix) {
        addOrphanToNav(projectDir, pageId)
        fixedOrphans.push(pageId)
      } else {
        issues.push({ severity: 'warning', message: `"${pageId}" is not in docs.json nav (orphan)`, file: relative(projectDir, filePath) })
      }
    }

    const rel2 = relative(projectDir, filePath)
    if (!data.title) issues.push({ severity: 'warning', message: `Missing "title" in frontmatter`, file: rel2 })
    const reference = parseDocReference(data.openapi)
    // The site describes an API page by its operation when the page has no description, so only the spec can say it has none.
    if (!data.description && !reference) issues.push({ severity: 'warning', message: MISSING_DESCRIPTION, file: rel2 })
    if (typeof data.openapi !== 'string' && content.trim().length < 50) {
      issues.push({ severity: 'warning', message: `Very short body (${content.trim().length} chars) — page may be empty`, file: rel2 })
    }

    if (reference) operationPages.push({ file: rel2, reference, hasDescription: Boolean(data.description) })
    for (const message of manualApiProblems(rel2, data, Boolean(reference), content, (config as { api?: unknown }).api)) {
      issues.push({ severity: 'warning', file: rel2, message })
    }

    if (options.drift) checkDrift(projectDir, rel2, data, issues)

    const path = pageIdToPath(pageId, secondaryLocales)
    const anchors = extractHeadingAnchors(content)
    validPaths.add(path)
    // The runtime accepts the explicit introduction slug as well as `/`.
    validPaths.add(`/${pageId}`)
    anchorsByPath.set(path, anchors)
    anchorsByPath.set(`/${pageId}`, anchors)
    linksByFile.push({ file: rel2, path, anchors, links: extractLinks(content), images: extractImageRefs(content), offset: lineOffset })
  }

  // Reader routes fall back to the primary document when no translated file
  // exists. Use its anchors only for those fallback paths; real translations
  // retain their own headings and may differ from the source language.
  for (const [path, anchors] of [...anchorsByPath]) {
    if (secondaryLocales.has(path.split('/')[1])) continue
    for (const locale of secondaryLocales) {
      const localized = `/${locale}${path === '/' ? '' : path}`
      if (validPaths.has(localized)) continue
      validPaths.add(localized)
      anchorsByPath.set(localized, anchors)
    }
  }

  // Broken internal link + anchor detection (after all valid paths are known).
  const externalLinks: Array<ExternalLinkReference> = []
  for (const { file, anchors, links, offset } of linksByFile) {
    for (const { target, line: contentLine } of links) {
      const line = contentLine + offset
      if (/^(https?:|mailto:|tel:)/i.test(target)) {
        // External — collected here and network-checked only with --external.
        if (/^https?:/i.test(target)) externalLinks.push({ url: target, file, line })
        continue
      }
      if (target.startsWith('#')) {
        const anchor = target.slice(1)
        if (anchor && !anchors.has(decodedFragment(anchor))) {
          issues.push({ severity: 'warning', message: `Broken anchor: "${target}" not found on this page`, file, line })
        }
        continue
      }
      if (!target.startsWith('/')) continue // relative/asset links — not validated
      const { path, anchor, cycle, external } = resolveLink(target, redirectDestinations, dynamicRedirects)
      if (external) continue
      const isGeneratedApiPath = Array.from(generatedApiPaths).some(
        (prefix) => path === prefix || path.startsWith(`${prefix}/`),
      )
      if (!cycle && (isGeneratedApiPath || path.startsWith('/_next') || /\.[a-z0-9]+$/i.test(path))) continue // generated/assets
      if (cycle || !validPaths.has(path)) {
        issues.push({ severity: 'error', message: `Broken link: "${target}" — no page at "${path}"`, file, line })
      } else if (anchor && !anchorsByPath.get(path)?.has(decodedFragment(anchor))) {
        issues.push({ severity: 'warning', message: `Broken anchor: "${target}" — no heading "#${anchor}" on that page`, file, line })
      }
    }
  }

  // Local image existence: a broken `<img>`/`![]()` src doesn't fail `next
  // build` (Next.js just renders a broken image), so this is a warning, not
  // an error — unlike a broken internal link, which 404s. Only root-relative
  // paths are checked (asset copy always writes under `public/`); external
  // URLs, data URIs, and template-interpolated values are skipped.
  const publicDir = join(projectDir, 'public')
  for (const { file, images, offset } of linksByFile) {
    for (const { target, line: contentLine } of images) {
      const line = contentLine + offset
      if (/^(https?:|data:|\{)/i.test(target)) continue
      if (!target.startsWith('/')) continue
      const pathOnly = target.split(/[?#]/, 1)[0]
      let decoded: string
      try {
        decoded = decodeURIComponent(pathOnly)
      } catch {
        continue
      }
      if (!existsSync(join(publicDir, decoded))) {
        issues.push({ severity: 'warning', message: `Image not found: "${target}" has no file under public/`, file, line })
      }
    }
  }

  // OpenAPI validation for each API tab.
  for (const tab of config.tabs) {
    if (tab.api?.source) validateOpenApi(projectDir, tab.api.source, issues, (tab.api as { overrides?: unknown }).overrides)
  }

  checkPublicSpecs(projectDir, config.tabs, issues)
  checkOperationPages(projectDir, config.tabs, operationPages, issues)
  checkApiGroupKeys(projectDir, config, issues)

  if (options.external && externalLinks.length > 0) {
    issues.push(...await checkExternalLinks(externalLinks, options.externalLinkOptions))
  }

  const errors = issues.filter((i) => i.severity === 'error')
  options.onIssues?.(issues)
  const warnings = issues.filter((i) => i.severity === 'warning')

  if (options.silent) return errors.length > 0 ? 1 : 0

  if (ci) {
    // GitHub Actions annotations (::error / ::warning), then a compact summary.
    for (const issue of issues) {
      const loc = issue.file ? `file=${issue.file}${issue.line ? `,line=${issue.line}` : ''}` : ''
      console.log(`::${issue.severity} ${loc}::${issue.message}`)
    }
    console.log(`\nthally check: ${errors.length} error(s), ${warnings.length} warning(s)`)
    return errors.length > 0 ? 1 : 0
  }

  console.log(`\n  Linting ${projectDir}...\n`)
  if (errors.length === 0 && warnings.length === 0 && fixedOrphans.length === 0) {
    console.log('  ✅ No issues found.\n')
    return 0
  }
  console.log(`  ❌ ${errors.length} error${errors.length !== 1 ? 's' : ''}, ⚠️  ${warnings.length} warning${warnings.length !== 1 ? 's' : ''}\n`)

  if (errors.length > 0) {
    console.log('  ERRORS:')
    for (const issue of errors) {
      console.log(`    ${issue.message}`)
      if (issue.file) console.log(`    → ${issue.file}${issue.line ? `:${issue.line}` : ''}`)
    }
    console.log('')
  }
  if (warnings.length > 0) {
    console.log('  WARNINGS:')
    for (const issue of warnings) {
      console.log(`    ${issue.message}`)
      if (issue.file) console.log(`    → ${issue.file}${issue.line ? `:${issue.line}` : ''}`)
    }
    console.log('')
  }
  if (fixedOrphans.length > 0) {
    console.log(`  ✅ Auto-fixed ${fixedOrphans.length} orphan page${fixedOrphans.length > 1 ? 's' : ''} (added to nav):`)
    for (const p of fixedOrphans) console.log(`    + ${p}`)
    console.log('')
  }
  if (!fix && warnings.some((w) => w.message.includes('orphan'))) {
    console.log('  Tip: run with --fix to auto-add orphan pages to navigation.\n')
  }

  return errors.length > 0 ? 1 : 0
}
