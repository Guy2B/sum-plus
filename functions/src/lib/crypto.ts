import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * AES-256-GCM envelope for connector credentials (IMAP app passwords, OAuth
 * tokens). The key comes from Secret Manager (CONNECTOR_ENCRYPTION_KEY, 32
 * random bytes, base64). Associated data binds a ciphertext to its owner so a
 * blob copied to another user's document cannot be decrypted there.
 */
export interface Sealed {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

function keyFrom(secret: string): Buffer {
  const key = Buffer.from(secret, 'base64');
  if (key.length !== 32) throw new Error('CONNECTOR_ENCRYPTION_KEY must be 32 bytes (base64)');
  return key;
}

export function seal(plaintext: string, secret: string, aad: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

export function open(sealed: Sealed, secret: string, aad: string): string {
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), Buffer.from(sealed.iv, 'base64'));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8');
}

/** Constant-time HMAC-SHA256 verification (hex digest), used for payment webhooks. */
export function verifyHmacSha256(rawBody: Buffer, signatureHex: string, secret: string): boolean {
  if (!signatureHex || !/^[0-9a-f]+$/i.test(signatureHex)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const given = Buffer.from(signatureHex, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}
