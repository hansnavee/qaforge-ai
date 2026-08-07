const SENSITIVE_KEYS = [
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'apiKey',
  'authorization',
  'cookie',
  'encryptedAccessToken',
  'encryptedConfig',
  'stripeSecret',
  'webhookSecret',
];

const REDACTED = '[REDACTED]';

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEYS.some((k) => lower.includes(k.toLowerCase()));
}

/** Deep-clone and redact sensitive fields from objects before logging/audit. */
export function redactSecrets<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item)) as T;
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      out[key] = REDACTED;
    } else if (val && typeof val === 'object') {
      out[key] = redactSecrets(val);
    } else {
      out[key] = val;
    }
  }
  return out as T;
}
