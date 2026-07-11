import { describe, it, expect, afterEach } from 'vitest'
import { encryptSecret, decryptSecret, hashPassword, verifyPasswordHash } from '@/lib/admin/secrets'

describe('secrets — password hashing (docs access)', () => {
  it('hashes and verifies, rejects wrong / malformed', () => {
    const h = hashPassword('hunter2')
    expect(h).toContain(':')
    expect(verifyPasswordHash('hunter2', h)).toBe(true)
    expect(verifyPasswordHash('wrong', h)).toBe(false)
    expect(verifyPasswordHash('x', 'malformed')).toBe(false)
  })
})

describe('secrets — API key encryption (AES-GCM)', () => {
  afterEach(() => {
    delete process.env.THALLY_AUTH_SECRET
  })

  it('round-trips with a secret; random IV → distinct ciphertexts', () => {
    process.env.THALLY_AUTH_SECRET = 'test-secret-at-least-16-chars'
    const a = encryptSecret('sk-ant-123')!
    const b = encryptSecret('sk-ant-123')!
    expect(a).not.toEqual(b) // random IV per encrypt
    expect(decryptSecret(a)).toBe('sk-ant-123')
    expect(decryptSecret(b)).toBe('sk-ant-123')
  })

  it('refuses to encrypt without THALLY_AUTH_SECRET (never plaintext)', () => {
    expect(encryptSecret('sk-ant-123')).toBeNull()
  })

  it('degrades to null (no throw) on tamper, rotated secret, or malformed blob', () => {
    process.env.THALLY_AUTH_SECRET = 'test-secret-at-least-16-chars'
    const blob = encryptSecret('sk-ant-123')!

    const parts = blob.split(':')
    parts[2] = `deadbeef${parts[2].slice(8)}` // tamper ciphertext → auth tag fails
    expect(decryptSecret(parts.join(':'))).toBeNull()

    process.env.THALLY_AUTH_SECRET = 'a-different-secret-16chars-xx'
    expect(decryptSecret(blob)).toBeNull() // rotated secret

    expect(decryptSecret('nope')).toBeNull() // malformed
  })
})
