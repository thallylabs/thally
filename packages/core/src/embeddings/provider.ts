import type { EmbeddingProvider, EmbeddingVector } from './types.js'

// 384 dims caused frequent bucket collisions between unrelated words (e.g.
// "work" and "component"), letting spurious matches outrank true ones. 4096
// keeps vectors cheap while making collisions rare.
const LOCAL_DIMENSIONS = 4096

// English function words carry no retrieval signal but dominate short queries
// ("How does navigation work?" is 3/4 stopwords). Dropping them from both
// documents and queries keeps cosine scores about content words.
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'do', 'does',
  'for', 'from', 'has', 'have', 'how', 'if', 'in', 'into', 'is', 'it', 'its',
  'my', 'no', 'not', 'of', 'on', 'or', 'our', 'so', 'than', 'that', 'the',
  'their', 'them', 'then', 'there', 'these', 'they', 'this', 'to', 'was',
  'we', 'were', 'what', 'when', 'where', 'which', 'who', 'why', 'will',
  'with', 'you', 'your',
])

function fnv1a(input: string, seed = 0x811c9dc5): number {
  let hash = seed
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function tokenize(text: string): Array<string> {
  const matches = text.toLowerCase().match(/[a-z0-9]+/g)
  if (!matches) return []
  return matches.filter((token) => token.length >= 2 && !STOPWORDS.has(token))
}

function l2normalize(vector: EmbeddingVector): EmbeddingVector {
  let sumSquares = 0
  for (const value of vector) sumSquares += value * value
  if (sumSquares === 0) return vector
  const norm = Math.sqrt(sumSquares)
  return vector.map((value) => value / norm)
}

/**
 * Deterministic, offline embedding via signed feature hashing (the lexical
 * baseline used by many hybrid-search systems). No model download, no API key,
 * no network — so the default experience is fully zero-config.
 */
export function embedLocal(text: string, dimensions = LOCAL_DIMENSIONS): EmbeddingVector {
  const vector = new Array<number>(dimensions).fill(0)
  for (const token of tokenize(text)) {
    const index = fnv1a(token) % dimensions
    const sign = fnv1a(token, 0x9dc5811c) & 1 ? 1 : -1
    vector[index] += sign
  }
  return l2normalize(vector)
}

export const localHashProvider: EmbeddingProvider = {
  // v2: 4096 dims + stopword filtering. The id doubles as the embedding-cache
  // key, so bumping it discards vectors from the incompatible v1 space.
  id: 'local-hash-v2',
  dimensions: LOCAL_DIMENSIONS,
  async embed(texts) {
    return texts.map((text) => embedLocal(text, LOCAL_DIMENSIONS))
  },
}

function createOpenAIProvider(apiKey: string): EmbeddingProvider {
  const model = (process.env.THALLY_EMBEDDING_MODEL ?? process.env.DOX_EMBEDDING_MODEL) ?? 'text-embedding-3-small'
  const dimensions = Number((process.env.THALLY_EMBEDDING_DIMENSIONS ?? process.env.DOX_EMBEDDING_DIMENSIONS) ?? 1536)
  return {
    id: `openai:${model}`,
    dimensions,
    async embed(texts) {
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, input: texts }),
      })
      if (!response.ok) {
        throw new Error(`Embedding provider error: ${response.status} ${await response.text()}`)
      }
      const json = (await response.json()) as { data: Array<{ embedding: Array<number> }> }
      return json.data.map((item) => item.embedding)
    },
  }
}

let cachedProvider: EmbeddingProvider | null = null

/**
 * Resolve the active embedding provider. Defaults to the local provider; opts
 * into a hosted provider only when explicitly configured with an API key.
 */
export function getEmbeddingProvider(): EmbeddingProvider {
  if (cachedProvider) return cachedProvider

  const providerName = ((process.env.THALLY_EMBEDDING_PROVIDER ?? process.env.DOX_EMBEDDING_PROVIDER) ?? 'local').toLowerCase()
  const apiKey = (process.env.THALLY_EMBEDDING_API_KEY ?? process.env.DOX_EMBEDDING_API_KEY) ?? process.env.OPENAI_API_KEY

  if (providerName === 'openai' && apiKey) {
    cachedProvider = createOpenAIProvider(apiKey)
  } else {
    cachedProvider = localHashProvider
  }
  return cachedProvider
}

/** Test hook to reset the memoized provider. */
export function resetEmbeddingProvider() {
  cachedProvider = null
}
