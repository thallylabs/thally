import { buildEmbeddingIndex } from '@/lib/embeddings/index-store'

interface BuildStats {
  chunks: Array<unknown>
  provider: string
  embeddedPages?: number
  reusedPages?: number
}

async function main() {
  const start = Date.now()
  const index = (await buildEmbeddingIndex()) as unknown as BuildStats
  const elapsed = Date.now() - start
  // eslint-disable-next-line no-console
  console.log(
    `[dox] embeddings: ${index.chunks.length} chunks · provider ${index.provider} · ` +
      `${index.embeddedPages ?? 0} page(s) embedded, ${index.reusedPages ?? 0} reused · ${elapsed}ms`,
  )
}

main().catch((error) => {
  // Never fail the build on embedding generation — retrieval falls back to a
  // lazy in-process build at runtime.
  // eslint-disable-next-line no-console
  console.warn('[dox] embeddings build skipped:', error instanceof Error ? error.message : error)
  process.exit(0)
})
