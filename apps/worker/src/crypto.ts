import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('ENCRYPTION_KEY is not set');
  }

  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }

  try {
    const b64 = Buffer.from(raw, 'base64');
    if (b64.length === 32) return b64;
  } catch {
    // fall through to hash
  }

  return createHash('sha256').update(raw).digest();
}

export function hasEncryptionKey(): boolean {
  return Boolean(process.env.ENCRYPTION_KEY);
}

export function decrypt(payload: string): string {
  const key = getKey();
  const buf = Buffer.from(payload, 'base64');
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error('Invalid encrypted payload');
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    'utf8',
  );
}

/** Encrypt plaintext (used by tests / local tooling). */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}
