import { describe, it, expect } from 'vitest'
import { parseOrigin } from '@/lib/tasks'
import { getTrackingConfig } from '@/data/docs'

describe('parseOrigin', () => {
  it('honors the stamped trailer', () => {
    expect(parseOrigin('summary…\n\n---\nDrafted by the Thally docs agent (origin: track) — please review.')).toBe('track')
    expect(parseOrigin('Drafted by the Thally docs agent (origin: drift) — please review.')).toBe('drift')
    expect(parseOrigin('Drafted by the Thally docs agent (origin: merge)')).toBe('merge')
    expect(parseOrigin('Drafted by the Thally docs agent (origin: mention)')).toBe('mention')
    // cli maps to manual (no dedicated chip)
    expect(parseOrigin('Drafted by the Thally docs agent (origin: cli)')).toBe('manual')
  })
  it('is not hijacked by summary text that merely quotes the marker format', () => {
    // A PR documenting Track itself quotes "(origin: merge)" in its summary, but
    // the authoritative trailer says track — the trailer must win.
    const body =
      'This page documents the marker, e.g. "(origin: merge)".\n\n---\nDrafted by the Thally docs agent (origin: track) — please review.'
    expect(parseOrigin(body)).toBe('track')
  })
  it('does not misfire on a cli PR whose summary contains heuristic words', () => {
    // 'stale' in the summary must not override the explicit cli (→manual) trailer.
    expect(parseOrigin('Refresh the stale install guide.\n\n---\nDrafted by the Thally docs agent (origin: cli).')).toBe(
      'manual',
    )
  })
  it('keeps the legacy heuristics for unmarked (pre-marker/hand-authored) bodies', () => {
    expect(parseOrigin('this page has gone stale')).toBe('drift')
    expect(parseOrigin('changes merged in acme/api@8c1f2ab00')).toBe('merge')
    expect(parseOrigin('Requested by kay.')).toBe('mention')
    expect(parseOrigin('hand-rolled PR body')).toBe('manual')
  })
})

describe('getTrackingConfig', () => {
  it('always returns a repos array', () => {
    const config = getTrackingConfig()
    expect(Array.isArray(config.repos)).toBe(true)
  })
})
