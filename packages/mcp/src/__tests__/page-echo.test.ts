import { describe, expect, it } from 'vitest'

import { readPageBodyDelimiter, stripEchoedPageHeader } from '../lib/page-echo.js'

const BODY = '## createMonitor(options?)\n\nCreate a new monitor.'

describe('stripEchoedPageHeader', () => {
  it('strips the legacy H1/slug/blockquote/rule preamble', () => {
    const echoed = [
      '# Pulsekit API',
      '*pulsekit/api*',
      '',
      '> API reference for pulsekit.',
      '',
      '---',
      '',
      BODY,
    ].join('\n')
    expect(stripEchoedPageHeader(echoed, 'pulsekit/api')).toBe(BODY)
  })

  it('strips the legacy preamble without description or rule', () => {
    const echoed = ['# Pulsekit API', '*pulsekit/api*', '', BODY].join('\n')
    expect(stripEchoedPageHeader(echoed, 'pulsekit/api')).toBe(BODY)
  })

  it('strips an echoed labelled header up to the body delimiter', () => {
    const echoed = [
      'id: pulsekit/api',
      'title: Pulsekit API',
      'description: API reference.',
      '',
      readPageBodyDelimiter(),
      '',
      BODY,
    ].join('\n')
    expect(stripEchoedPageHeader(echoed, 'pulsekit/api')).toBe(BODY)
  })

  it('keeps an organic body that opens with a heading', () => {
    const organic = `# Getting started\n\nInstall the package.`
    expect(stripEchoedPageHeader(organic, 'guides/start')).toBe(organic)
  })

  it('keeps a body that mentions the page id outside the echo shape', () => {
    const organic = `See *pulsekit/api* for details.\n\n${BODY}`
    expect(stripEchoedPageHeader(organic, 'pulsekit/api')).toBe(organic)
  })

  it('ignores a delimiter that appears deep inside the body', () => {
    const organic = [BODY, '', 'x', 'y', 'z', 'w', 'v', readPageBodyDelimiter()].join('\n')
    expect(stripEchoedPageHeader(organic, 'pulsekit/api')).toBe(organic)
  })

  it('only strips when the italicised id matches this page', () => {
    const otherPage = ['# Title', '*some/other-page*', '', BODY].join('\n')
    expect(stripEchoedPageHeader(otherPage, 'pulsekit/api')).toBe(otherPage)
  })
})
