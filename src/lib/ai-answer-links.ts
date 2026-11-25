/** Active answer links must name an evidence page, including its exact query. */

import type { AiAnswerSource } from '@/lib/ai-answer-sources'

/** Allow section fragments on known pages without accepting invented hosts. */
export function aiAnswerLink(value: string, sources: ReadonlyArray<AiAnswerSource>, origin = 'https://documentation.invalid'): string | undefined {
  if (!value || value.length > 2048 || /[\s\\\u0000-\u001f\u007f]/u.test(value) || value.startsWith('//')) return undefined
  try {
    const base = new URL(origin).origin
    const target = new URL(value, base)
    if (target.username || target.password || target.origin !== base || !['http:', 'https:'].includes(target.protocol)) return undefined
    // Dot-segment normalization can turn a local path into //host. Returning
    // that pathname alone would change its meaning to a protocol-relative URL.
    if (target.pathname.startsWith('//')) return undefined
    if (!value.startsWith('/') && !/^https?:\/\//i.test(value)) return undefined
    return sources.some((source) => {
      const evidence = new URL(source.url, base)
      return evidence.origin === base && target.pathname === evidence.pathname && target.search === evidence.search
    }) ? `${target.pathname}${target.search}${target.hash}` : undefined
  } catch { return undefined }
}
