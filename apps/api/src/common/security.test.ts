import { describe, expect, it, beforeAll } from 'vitest';
import { encrypt, decrypt } from './encryption';
import { redactSecrets } from './redaction';

beforeAll(() => {
  process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
});

describe('encryption', () => {
  it('round-trips plaintext', () => {
    const cipher = encrypt('hello-secret');
    expect(cipher).not.toContain('hello-secret');
    expect(decrypt(cipher)).toBe('hello-secret');
  });
});

describe('redaction', () => {
  it('never leaves passwords or tokens in audit payloads', () => {
    const redacted = redactSecrets({
      user: 'navee',
      password: 'SuperSecret123!',
      accessToken: 'tok_abc',
      nested: { cookie: 'session=abc', safe: true },
    }) as {
      password: string;
      nested: { safe: boolean };
    };
    expect(JSON.stringify(redacted)).not.toMatch(/SuperSecret/);
    expect(JSON.stringify(redacted)).not.toMatch(/tok_abc/);
    expect(JSON.stringify(redacted)).not.toMatch(/session=abc/);
    expect(redacted.nested.safe).toBe(true);
    expect(redacted.password).toBe('[REDACTED]');
  });
});
