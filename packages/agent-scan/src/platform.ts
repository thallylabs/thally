/**
 * Descriptive docs-platform detection from the docs root response. Rules run
 * in a fixed order; the first high-confidence match wins, else the first
 * low-confidence match, else `unknown`. Low-confidence guesses should be left
 * out of platform-level statistics.
 */

import type { PageFacts } from './html.js'
import type { PlatformGuess } from './types.js'

/** Inputs for platform detection. */
export interface PlatformInput {
  /** Final URL of the docs root fetch. */
  url: string
  headers: Array<[string, string]>
  page: PageFacts | null
}

type Platform = PlatformGuess['platform']

interface Rule {
  platform: Platform
  high: (input: Derived) => string | null
  low: (input: Derived) => string | null
}

interface Derived {
  host: string
  generator: string
  assets: string[]
  headers: Array<[string, string]>
  page: PageFacts | null
}

function assetMatch(input: Derived, test: (asset: string) => boolean, label: string): string | null {
  const hit = input.assets.find(test)
  return hit ? `${label}:${hit}` : null
}

function assetHost(asset: string, base: string): string {
  try {
    return new URL(asset, base).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function header(input: Derived, name: string): string | null {
  const hit = input.headers.find(([key]) => key === name)
  return hit ? hit[1] : null
}

function generatorStarts(input: Derived, prefix: string): string | null {
  return input.generator.toLowerCase().startsWith(prefix.toLowerCase()) ? `meta:generator=${input.generator}` : null
}

const RULES: Rule[] = [
  {
    platform: 'thally',
    high: (input) => (input.page?.hasThallyShim ? 'html:script#thally-runtime-name-shim' : null),
    low: (input) => {
      const link = header(input, 'link') ?? ''
      return header(input, 'x-llms-txt') !== null && /rel="?api-catalog"?/i.test(link) ? 'header:x-llms-txt+link:api-catalog' : null
    },
  },
  {
    platform: 'mintlify',
    high: (input) =>
      (input.generator.toLowerCase().includes('mintlify') ? `meta:generator=${input.generator}` : null) ??
      assetMatch(input, (asset) => asset.includes('/_mintlify/'), 'asset'),
    low: (input) => (/\.mintlify\.(app|dev)$/.test(input.host) ? `host:${input.host}` : null),
  },
  {
    platform: 'gitbook',
    high: (input) =>
      generatorStarts(input, 'GitBook') ??
      assetMatch(input, (asset) => {
        const host = assetHost(asset, `https://${input.host}/`)
        return host === 'static.gitbook.com' || host.endsWith('.gitbook.io')
      }, 'asset'),
    low: (input) => (input.host.endsWith('.gitbook.io') ? `host:${input.host}` : null),
  },
  {
    platform: 'docusaurus',
    high: (input) => generatorStarts(input, 'Docusaurus'),
    low: (input) => (input.page?.hasDocusaurusRoot ? 'html:div#__docusaurus' : null),
  },
  {
    platform: 'readme',
    high: (input) =>
      (input.host.endsWith('.readme.io') ? `host:${input.host}` : null) ??
      assetMatch(input, (asset) => assetHost(asset, `https://${input.host}/`) === 'cdn.readme.io', 'asset'),
    low: () => null,
  },
  {
    platform: 'fern',
    high: (input) => {
      const fernHeader = input.headers.find(([key]) => key.startsWith('x-fern-'))
      if (fernHeader) return `header:${fernHeader[0]}`
      return input.host.endsWith('.docs.buildwithfern.com') ? `host:${input.host}` : null
    },
    low: (input) => assetMatch(input, (asset) => asset.toLowerCase().includes('fern'), 'asset'),
  },
  {
    platform: 'readthedocs',
    high: (input) => (/\.(readthedocs\.io|readthedocs-hosted\.com)$/.test(input.host) ? `host:${input.host}` : null),
    low: (input) => assetMatch(input, (asset) => asset.toLowerCase().includes('readthedocs'), 'asset'),
  },
  { platform: 'mkdocs', high: (input) => generatorStarts(input, 'mkdocs'), low: () => null },
  { platform: 'vitepress', high: (input) => generatorStarts(input, 'VitePress'), low: () => null },
  { platform: 'starlight', high: (input) => generatorStarts(input, 'Starlight'), low: () => null },
  {
    platform: 'sphinx',
    high: () => null,
    low: (input) => {
      const hasStatic = input.assets.some((asset) => asset.includes('_static/'))
      const marker = input.assets.find((asset) => /searchindex\.js|documentation_options\.js/.test(asset))
      return hasStatic && marker ? `asset:${marker}` : null
    },
  },
  {
    platform: 'nextra',
    high: () => null,
    low: (input) =>
      (input.page?.hasNextraClass ? 'html:class*=nextra' : null) ??
      assetMatch(input, (asset) => asset.toLowerCase().includes('nextra'), 'asset'),
  },
  {
    platform: 'nextjs',
    high: () => null,
    low: (input) => assetMatch(input, (asset) => asset.includes('/_next/static/'), 'asset'),
  },
]

/** Guess the docs platform from the docs root response. */
export function detectPlatform(input: PlatformInput): PlatformGuess {
  let host = ''
  try {
    host = new URL(input.url).hostname.toLowerCase()
  } catch {
    host = ''
  }
  const derived: Derived = {
    host,
    generator: input.page?.generator ?? '',
    assets: input.page?.assetUrls ?? [],
    headers: input.headers,
    page: input.page,
  }
  for (const rule of RULES) {
    const signal = rule.high(derived)
    if (signal) return { platform: rule.platform, confidence: 'high', signals: [signal] }
  }
  for (const rule of RULES) {
    const signal = rule.low(derived)
    if (signal) return { platform: rule.platform, confidence: 'low', signals: [signal] }
  }
  return { platform: 'unknown', confidence: 'low', signals: [] }
}
