import { randomBytes, scryptSync, timingSafeEqual, createHash, createCipheriv, createDecipheriv } from 'node:crypto'

/** 32-byte AES key derived from THALLY_AUTH_SECRET (arbitrary-length string). */
function deriveKey(): Buffer | null {
  const secret = (process.env.THALLY_AUTH_SECRET ?? process.env.DOX_AUTH_SECRET)?.trim()
  if (!secret || secret.length < 16) return null
  return createHash('sha256').update(secret).digest()
}

/**
 * AES-256-GCM encrypt a secret for storage. Format: `iv:tag:ciphertext` (hex),
 * random IV per call. Returns null when THALLY_AUTH_SECRET is absent — the caller
 * must REFUSE to store rather than fall back to plaintext (a silent downgrade).
 */
export function encryptSecret(plain: string): string | null {
  const key = deriveKey()
  if (!key) return null
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`
}

/** Decrypt; null on missing secret, malformed blob, or auth failure — the caller
 * degrades to env (e.g. after a secret rotation) instead of crashing. */
export function decryptSecret(blob: string): string | null {
  const key = deriveKey()
  if (!key) return null
  const [ivHex, tagHex, ctHex] = blob.split(':')
  if (!ivHex || !tagHex || !ctHex) return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'))
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
    return Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

/**
 * Salted scrypt hash for the docs-access password. Format: `salt:hash` (hex).
 * We store the hash, never the plaintext — a GET of settings must never return it.
 */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(plain, salt, 32)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

export function verifyPasswordHash(plain: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':')
  if (!saltHex || !hashHex) return false
  try {
    const hash = scryptSync(plain, Buffer.from(saltHex, 'hex'), 32)
    const expected = Buffer.from(hashHex, 'hex')
    return hash.length === expected.length && timingSafeEqual(hash, expected)
  } catch {
    return false
  }
}
