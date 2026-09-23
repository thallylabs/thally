/** Runtime-portable bounded JSON body reader for public request boundaries. */

export const BODY_TOO_LARGE_ERROR = 'body_too_large'

/**
 * Read and parse JSON without allowing declared or chunked bodies to exceed
 * the caller's budget. The stream is cancelled as soon as it crosses the cap.
 */
export async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(BODY_TOO_LARGE_ERROR)
  }

  const reader = request.body?.getReader()
  if (!reader) return null
  const chunks: Array<Uint8Array> = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > maxBytes) {
      await reader.cancel()
      throw new Error(BODY_TOO_LARGE_ERROR)
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(bytes))
}
