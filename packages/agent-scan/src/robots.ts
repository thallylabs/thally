/**
 * RFC 9309 robots.txt parsing and matching.
 *
 * - Groups start at one or more `User-agent` lines; a `User-agent` line after
 *   rules starts a new group. Groups naming the same product token merge.
 * - The product token is matched case-insensitively against the leading
 *   `[A-Za-z_-]` run of each `User-agent` value; `*` is the fallback group.
 * - The longest matching pattern wins, ties go to Allow, `*` and `$` are
 *   supported, and `/robots.txt` is always allowed.
 */

import type { RobotsRules } from './types.js'

interface Rule {
  allow: boolean
  pattern: string
  matcher: RegExp
}

interface Group {
  agents: string[]
  rules: Rule[]
}

function compilePattern(pattern: string): RegExp {
  let source = '^'
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '*') source += '.*'
    else if (ch === '$' && i === pattern.length - 1) source += '$'
    else source += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(source)
}

function productToken(value: string): string {
  if (value.trim() === '*') return '*'
  const match = /^[A-Za-z_-]+/.exec(value.trim())
  return match ? match[0].toLowerCase() : ''
}

/** Parse a robots.txt body. Unknown lines are ignored, as RFC 9309 requires. */
export function parseRobots(body: string): RobotsRules {
  const groups: Group[] = []
  const sitemaps: string[] = []
  let current: Group | null = null
  let lastWasAgent = false
  for (const rawLine of body.split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const key = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] }
        groups.push(current)
      }
      current.agents.push(productToken(value))
      lastWasAgent = true
      continue
    }
    if (key === 'sitemap') {
      try {
        const url = new URL(value)
        if (url.protocol === 'http:' || url.protocol === 'https:') sitemaps.push(url.href)
      } catch {
        // Relative or malformed sitemap URLs are ignored.
      }
      continue
    }
    lastWasAgent = false
    if ((key === 'allow' || key === 'disallow') && current) {
      // An empty Disallow means "allow everything" and adds no rule.
      if (!value) continue
      current.rules.push({ allow: key === 'allow', pattern: value, matcher: compilePattern(value) })
    }
  }

  function rulesFor(userAgent: string): Rule[] | null {
    const token = productToken(userAgent)
    const named = groups.filter((group) => group.agents.includes(token) && token !== '')
    if (named.length > 0) return named.flatMap((group) => group.rules)
    const fallback = groups.filter((group) => group.agents.includes('*'))
    if (fallback.length > 0) return fallback.flatMap((group) => group.rules)
    return null
  }

  return {
    sitemaps,
    isAllowed(userAgent: string, path: string): boolean {
      if (path === '/robots.txt') return true
      const rules = rulesFor(userAgent)
      if (!rules) return true
      let best: Rule | null = null
      for (const rule of rules) {
        if (!rule.matcher.test(path)) continue
        if (
          !best ||
          rule.pattern.length > best.pattern.length ||
          (rule.pattern.length === best.pattern.length && rule.allow && !best.allow)
        ) {
          best = rule
        }
      }
      return best ? best.allow : true
    },
  }
}

/** Rules used when robots.txt is missing (4xx): everything is allowed. */
export function allowAllRobots(): RobotsRules {
  return parseRobots('')
}

/** Rules used when robots.txt is unreachable: RFC 9309 assumes complete disallow. */
export function disallowAllRobots(): RobotsRules {
  return parseRobots('User-agent: *\nDisallow: /')
}
