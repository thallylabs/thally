/**
 * Bounded, exact three-way merging for editable framework source only.
 *
 * This is not a fuzzy patcher or a semantic resolver: ambiguous edits stay in
 * review. Callers must separately prove regular files, trusted old/upstream
 * identity, ownership, and exact local preconditions before committing bytes.
 */
import { diffLines, type Change } from 'diff'

export const STARTER_SOURCE_MERGE_LIMITS = Object.freeze({
  bytes: 256 * 1024,
  lines: 20_000,
  editLength: 2_048,
  hunks: 512,
  milliseconds: 250,
  planAttempts: 8,
  planMilliseconds: 1_000,
})

/** Do not let an archive ownership rule opt integrity or generated data in. */
export function isStarterSourceMergePath(path: string): boolean {
  const parts = path.split('/')
  if (parts.some(part => !part || part === '.' || part === '..' || part.startsWith('.') ||
      /^(?:generated|__generated__|node_modules)$/i.test(part) ||
      /(?:^|[._-])(?:identity|provenance)(?:[._-]|$)/i.test(part)) || path.includes('\\') || path.includes('\0')) return false
  const filename = parts.at(-1)!
  if (/^(?:starter-release|stable-scaffold-release|previous-scaffold-releases)\./i.test(filename) ||
      /^(?:next|postcss|eslint)\.config\./.test(filename) ||
      /^(?:src\/content|snippets|public)(?:\/|$)/.test(path) ||
      path === 'src/data/site.ts' || path === 'src/mdx/custom-components.tsx') return false
  return /\.(?:[cm]?[jt]sx?|css|mdx?)$/.test(filename)
}

interface SourceText {
  text: string
  newline: '\n' | '\r\n'
}

function sourceText(bytes: Buffer): SourceText | undefined {
  if (bytes.byteLength > STARTER_SOURCE_MERGE_LIMITS.bytes || bytes.includes(0)) return undefined
  const value = bytes.toString('utf8')
  if (!Buffer.from(value, 'utf8').equals(bytes)) return undefined
  const text = value.replace(/\r\n/g, '\n')
  // Mixed endings and lone CR are not a checkout conversion we can preserve.
  if (text.includes('\r') || (value.includes('\r\n') && text.split('\n').length !== value.split('\r\n').length)) return undefined
  if (lines(text).length > STARTER_SOURCE_MERGE_LIMITS.lines) return undefined
  return { text, newline: value.includes('\r\n') ? '\r\n' : '\n' }
}

function lines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? []
}

interface Edit {
  start: number
  end: number
  replacement: string
}

function edits(changes: Change[]): Edit[] {
  const result: Edit[] = []
  let offset = 0
  let pending: Edit | undefined
  for (const change of changes) {
    if (!change.added && !change.removed) {
      if (pending) result.push(pending)
      pending = undefined
      offset += change.count
    } else {
      pending ??= { start: offset, end: offset, replacement: '' }
      if (change.removed) {
        offset += change.count
        pending.end = offset
      } else {
        pending.replacement += change.value
      }
    }
  }
  if (pending) result.push(pending)
  return result
}

function applyEdits(base: string[], changes: Edit[]): string {
  const output: string[] = []
  let offset = 0
  for (const edit of changes) {
    output.push(base.slice(offset, edit.start).join(''), edit.replacement)
    offset = edit.end
  }
  output.push(base.slice(offset).join(''))
  return output.join('')
}

function touches(left: Edit, right: Edit): boolean {
  // Insertions touching either edge of a replacement are deliberately left for
  // review: their intended ordering cannot be proved from the shared base.
  if (left.start === left.end) return left.start >= right.start && left.start <= right.end
  if (right.start === right.end) return right.start >= left.start && right.start <= left.end
  return left.start < right.end && right.start < left.end
}

/**
 * Return merged UTF-8 source, or undefined for ineligible/ambiguous/bounded-out
 * input. Uniform CRLF checkout conversion is normalized only for comparison;
 * output keeps local line endings and exact final-newline edits. No source or
 * diff content is logged, and no conflict markers are synthesized.
 */
export function mergeStarterSourceContents(
  path: string,
  baseBytes: Buffer,
  localBytes: Buffer,
  upstreamBytes: Buffer,
): string | undefined {
  if (!isStarterSourceMergePath(path)) return undefined
  const base = sourceText(baseBytes), local = sourceText(localBytes), upstream = sourceText(upstreamBytes)
  if (!base || !local || !upstream) return undefined
  const deadline = Date.now() + STARTER_SOURCE_MERGE_LIMITS.milliseconds
  const diff = (text: string): Change[] | undefined => {
    const timeout = deadline - Date.now()
    if (timeout <= 0) return undefined
    return diffLines(base.text, text, { timeout, maxEditLength: STARTER_SOURCE_MERGE_LIMITS.editLength })
  }
  const localDiff = diff(local.text), upstreamDiff = diff(upstream.text)
  if (!localDiff || !upstreamDiff || Date.now() > deadline) return undefined
  const localEdits = edits(localDiff), upstreamEdits = edits(upstreamDiff)
  if (localEdits.length + upstreamEdits.length > STARTER_SOURCE_MERGE_LIMITS.hunks) return undefined
  const baseLines = lines(base.text)
  // Verify our hunk representation against both exact inputs, never trusting a
  // partial diff result or treating whitespace/final-newline edits as equal.
  if (applyEdits(baseLines, localEdits) !== local.text || applyEdits(baseLines, upstreamEdits) !== upstream.text) return undefined
  const merged = [...localEdits]
  for (const change of upstreamEdits) {
    if (localEdits.some(localChange => localChange.start === change.start && localChange.end === change.end && localChange.replacement === change.replacement)) continue
    if (localEdits.some(localChange => touches(localChange, change))) return undefined
    merged.push(change)
  }
  merged.sort((left, right) => left.start - right.start || left.end - right.end)
  const result = applyEdits(baseLines, merged).replace(/\n/g, local.newline)
  return Buffer.byteLength(result, 'utf8') <= STARTER_SOURCE_MERGE_LIMITS.bytes && Date.now() <= deadline ? result : undefined
}
