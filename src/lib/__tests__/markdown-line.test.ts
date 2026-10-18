/** An OpenAPI description is Markdown; a page's meta tags carry it as one line of plain text, as Mintlify's do. */

import { describe, expect, it } from 'vitest'
import { markdownLine } from '../markdown-line'

describe('markdownLine', () => {
  // [description as the spec writes it, the meta description trigger.dev serves]
  it.each([
    ['Without a `filter[createdAt]` value, only runs created in the last 7 days are returned. See [runs.list() best practices](/runs/list-best-practices).',
      'Without a filter[createdAt] value, only runs created in the last 7 days are returned. See runs.list() best practices.'],
    ['**Private beta:** [request access](https://trigger.dev/webhooks-beta) to use webhooks. Its status becomes `inactive` and its URL responds with `404`.',
      'Private beta: request access to use webhooks. Its status becomes inactive and its URL responds with 404.'],
    ['Send a JSON body (use `{}` when you have no fields to set).', 'Send a JSON body (use {} when you have no fields to set).'],
    ['Phase 1 of the batch API.\nCreates a batch record.\n\nStream items next.', 'Phase 1 of the batch API. Creates a batch record. Stream items next.'],
  ])('reads %j as one plain line', (markdown, expected) => {
    expect(markdownLine(markdown)).toBe(expected)
  })

  it('strips emphasis and images, drops tags, and keeps identifiers with underscores and stars intact', () => {
    expect(markdownLine('Use *either* _form_ or __both__, see ![diagram](/x.png) and <br/>the batch_scrape.started event, 2 * 3 * 4.'))
      .toBe('Use either form or both, see diagram and the batch_scrape.started event, 2 * 3 * 4.')
  })

  it('keeps a backslash-escaped character and text inside a code span as written', () => {
    expect(markdownLine('Escaped \\*stars\\* and `**not bold**`.')).toBe('Escaped *stars* and **not bold**.')
  })

  it('returns an empty line for nothing', () => {
    expect(markdownLine('  \n ')).toBe('')
  })
})
