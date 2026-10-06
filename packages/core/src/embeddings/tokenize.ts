/**
 * Unicode-aware word tokenization shared by the local embedder and BM25.
 *
 * The previous `[a-z0-9]+` tokenizer silently dropped every non-ASCII letter:
 * Spanish "configuración" became "configuraci" + "n", and Chinese, Japanese,
 * Russian or Hindi prose produced no tokens at all, so translated pages could
 * never be retrieved. This module keeps two invariants:
 *
 * - **ASCII parity.** For pure-ASCII input the token stream is identical to
 *   the old `[a-z0-9]+` split (underscores, apostrophes and dots still split
 *   words), so English ranking — which was tuned against that split — does not
 *   move.
 * - **No whitespace assumption for unspaced scripts.** Han, Kana, Thai, Lao,
 *   Khmer and Myanmar text has no spaces between words. Those runs are split
 *   with ICU word boundaries (`Intl.Segmenter`, available in Node and workerd)
 *   and fall back to character bigrams where the segmenter is missing.
 *
 * Both the index side and the query side must call the same function here, or
 * the two would disagree about what a word is.
 */

/** Letters, combining marks (needed by Devanagari, Thai, …) and digits. */
const WORD_RUN = /[\p{L}\p{M}\p{N}]+/gu

/** Scripts written without spaces between words. */
const UNSPACED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u

/** Tokens the English stemmer and stoplist may act on. */
const LATIN_TOKEN = /^[\p{Script=Latin}\p{N}]+$/u

let segmenter: Intl.Segmenter | null | undefined

function wordSegmenter(): Intl.Segmenter | null {
  if (segmenter !== undefined) return segmenter
  try {
    segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
      ? new Intl.Segmenter(undefined, { granularity: 'word' })
      : null
  } catch {
    segmenter = null
  }
  return segmenter
}

/** Overlapping character pairs: the standard CJK fallback when no dictionary is available. */
function bigrams(run: string): Array<string> {
  const chars = Array.from(run)
  if (chars.length <= 1) return chars
  const pairs: Array<string> = []
  for (let i = 0; i < chars.length - 1; i += 1) pairs.push(chars[i] + chars[i + 1])
  return pairs
}

function splitUnspacedRun(run: string): Array<string> {
  const icu = wordSegmenter()
  if (!icu) return bigrams(run)
  const tokens: Array<string> = []
  for (const part of icu.segment(run)) {
    if (part.isWordLike) tokens.push(part.segment)
  }
  return tokens
}

/** True for a token from a script written without spaces (kept even when one character long). */
export function isUnspacedScriptToken(token: string): boolean {
  return UNSPACED_SCRIPT.test(token)
}

/** True for a Latin-script (or numeric) token — the only kind the English stemmer understands. */
export function isLatinToken(token: string): boolean {
  return LATIN_TOKEN.test(token)
}

/**
 * Split text into lowercased, NFKC-normalized word tokens in document order.
 * No stopword or length filtering happens here; callers apply their own.
 */
export function wordTokens(text: string): Array<string> {
  const runs = text.normalize('NFKC').toLowerCase().match(WORD_RUN)
  if (!runs) return []
  const tokens: Array<string> = []
  for (const run of runs) {
    if (UNSPACED_SCRIPT.test(run)) tokens.push(...splitUnspacedRun(run))
    else tokens.push(run)
  }
  return tokens
}

/**
 * Whether a token is long enough to carry signal. One-letter words in spaced
 * scripts ("a", "в") are noise; a single Han character is often a whole word.
 */
export function isMeaningfulToken(token: string): boolean {
  return token.length >= 2 || isUnspacedScriptToken(token)
}
