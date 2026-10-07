/**
 * Mint a read-only, group-scoped reader token for an agent or MCP client.
 *
 *   THALLY_READER_TOKEN_KEYS="k1:<32+ char secret>" \
 *     npm run reader-token -- --label ci-agent --groups beta,partners --days 30
 *
 * The token is signed with the FIRST key in THALLY_READER_TOKEN_KEYS and is
 * accepted only as `Authorization: Bearer thrt_…`. Revoke it by adding its
 * token id (printed below) — or its key id to revoke every token from that
 * key — to docs.json `auth.tokens.revoked`, or by removing the key from the
 * environment. The token is printed once; it is not stored anywhere.
 */

import { mintAgentToken } from '@/lib/reader-auth/session'

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function main() {
  const label = argument('label') ?? 'agent'
  const groups = (argument('groups') ?? '').split(',').map((group) => group.trim()).filter(Boolean)
  const days = Number(argument('days') ?? '30')
  if (!Number.isFinite(days) || days <= 0) throw new Error('--days must be a positive number (maximum 365).')
  const minted = await mintAgentToken({ label, groups, expiresInSeconds: Math.round(days * 24 * 60 * 60), tokenId: argument('id') })
  console.error(
    `Token id: ${minted.tokenId}\nKey id:   ${minted.kid}\nGroups:   ${groups.join(', ') || '(none: signed-in pages without groups only)'}\nExpires:  ${new Date(minted.expiresAt * 1000).toISOString()}\n`,
  )
  // The token alone goes to stdout so it can be piped into a secret store.
  console.log(minted.token)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
