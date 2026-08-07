import type { Request, Response, NextFunction } from 'express';

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/**
 * Simple in-memory sliding-window rate limiter (per IP + optional org).
 * For production multi-instance deploy, swap for Redis-backed limiter.
 */
export function rateLimit(opts: {
  windowMs?: number;
  max?: number;
  keyPrefix?: string;
} = {}) {
  const windowMs = opts.windowMs ?? 60_000;
  const max = opts.max ?? 120;
  const keyPrefix = opts.keyPrefix ?? 'rl';

  return (req: Request, res: Response, next: NextFunction) => {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      'unknown';
    const key = `${keyPrefix}:${ip}:${req.method}:${req.path.split('/').slice(0, 4).join('/')}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > max) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }
    next();
  };
}
