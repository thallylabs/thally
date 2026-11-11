import { describe, expect, it } from 'vitest'

import { parsePage } from '../html.js'
import { detectPlatform } from '../platform.js'

const detect = (url: string, body: string, headers: Array<[string, string]> = []) =>
  detectPlatform({ url, headers, page: parsePage(body, url) })

describe('platform detection (descriptive, AC1)', () => {
  it('detects high-confidence platforms from generator, assets and hosts', () => {
    expect(detect('https://d.test/', '<meta name="generator" content="Docusaurus v3.5.2">')).toMatchObject({ platform: 'docusaurus', confidence: 'high' })
    expect(detect('https://d.test/', '<script src="/_mintlify/app.js"></script>')).toMatchObject({ platform: 'mintlify', confidence: 'high' })
    expect(detect('https://d.test/', '<link rel="stylesheet" href="https://static.gitbook.com/a.css">')).toMatchObject({ platform: 'gitbook', confidence: 'high' })
    expect(detect('https://x.readme.io/', '<html></html>')).toMatchObject({ platform: 'readme', confidence: 'high' })
    expect(detect('https://x.readthedocs.io/', '<html></html>')).toMatchObject({ platform: 'readthedocs', confidence: 'high' })
    expect(detect('https://d.test/', '<html></html>', [['x-fern-host', 'a']])).toMatchObject({ platform: 'fern', confidence: 'high' })
    expect(detect('https://d.test/', '<meta name="generator" content="mkdocs-1.6, mkdocs-material-9">')).toMatchObject({ platform: 'mkdocs', confidence: 'high' })
    expect(detect('https://d.test/', '<script id="thally-runtime-name-shim"></script><script src="/_next/static/a.js"></script>'))
      .toEqual({ platform: 'thally', confidence: 'high', signals: ['html:script#thally-runtime-name-shim'] })
  })

  it('falls back to low-confidence signals, then unknown', () => {
    expect(detect('https://d.test/', '<script src="/_next/static/a.js"></script>')).toMatchObject({ platform: 'nextjs', confidence: 'low' })
    expect(detect('https://d.test/', '<script src="_static/documentation_options.js"></script><link href="_static/x.css">')).toMatchObject({ platform: 'sphinx', confidence: 'low' })
    expect(detect('https://d.test/', '<html></html>', [['link', '</api>; rel="api-catalog"'], ['x-llms-txt', '/llms.txt']])).toMatchObject({ platform: 'thally', confidence: 'low' })
    expect(detect('https://d.test/', '<html></html>')).toEqual({ platform: 'unknown', confidence: 'low', signals: [] })
  })
})
