import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { buildCurlCommand } from '@/components/api/use-try-it-controller'

describe('buildCurlCommand', () => {
  it('joins every line but the last with a continuation and parses as shell', () => {
    const lines = buildCurlCommand(
      'post',
      'https://api.example.com/v2/scrape',
      { Authorization: 'Bearer <token>', 'Content-Type': 'application/json' },
      `{"name":"it's"}`,
    )
    expect(lines).toEqual([
      'curl --request POST \\',
      '  --url https://api.example.com/v2/scrape \\',
      "  --header 'Authorization: Bearer <token>' \\",
      "  --header 'Content-Type: application/json' \\",
      `  --data '{"name":"it'"'"'s"}'`,
    ])
    execFileSync('sh', ['-n'], { input: lines.join('\n') })
  })
})
