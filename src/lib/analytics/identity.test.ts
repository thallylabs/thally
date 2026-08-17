/** Privacy identity regression coverage: stability, rotation, and minimization. */

import { describe, expect, it } from 'vitest'

import { createDailyVisitorKey, externalReferrerDomain } from './identity'

function visitorRequest(url = 'https://docs.example.com/quickstart', address = '203.0.113.8'): Request {
  return new Request(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 ExampleBrowser/1.0',
      'x-nf-client-connection-ip': address,
    },
  })
}

describe('daily analytics identity', () => {
  it('is stable within one site and UTC day', async () => {
    const morning = Date.parse('2026-08-17T01:00:00Z')
    const evening = Date.parse('2026-08-17T23:00:00Z')

    expect(await createDailyVisitorKey(visitorRequest(), 'secret', morning)).toBe(
      await createDailyVisitorKey(visitorRequest(), 'secret', evening),
    )
  })

  it('rotates across days, sites, and visitors', async () => {
    const today = Date.parse('2026-08-17T12:00:00Z')
    const tomorrow = Date.parse('2026-08-18T12:00:00Z')
    const base = await createDailyVisitorKey(visitorRequest(), 'secret', today)

    expect(await createDailyVisitorKey(visitorRequest(), 'secret', tomorrow)).not.toBe(base)
    expect(
      await createDailyVisitorKey(visitorRequest('https://other.example.com/quickstart'), 'secret', today),
    ).not.toBe(base)
    expect(await createDailyVisitorKey(visitorRequest(undefined, '203.0.113.9'), 'secret', today)).not.toBe(base)
  })

  it('does not invent one shared visitor when request identity is missing', async () => {
    expect(await createDailyVisitorKey(new Request('https://docs.example.com/quickstart'), 'secret')).toBeUndefined()
  })
})

describe('referrer minimization', () => {
  it('keeps only normalized external hostnames', () => {
    expect(
      externalReferrerDomain('https://www.Google.com/search?q=private#result', 'https://docs.example.com/quickstart'),
    ).toBe('google.com')
  })

  it('drops same-site, invalid, and non-http referrers', () => {
    expect(
      externalReferrerDomain('https://docs.example.com/introduction', 'https://docs.example.com/quickstart'),
    ).toBeUndefined()
    expect(externalReferrerDomain('not a url', 'https://docs.example.com')).toBeUndefined()
    expect(externalReferrerDomain('file:///private/path', 'https://docs.example.com')).toBeUndefined()
  })
})
