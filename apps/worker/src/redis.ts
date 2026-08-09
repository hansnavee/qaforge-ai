import { Redis } from 'ioredis';
import type { AgentEvent } from '@qaforge/shared';

let redis: Redis | null = null;
let subRedis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    const url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
    redis = new Redis(url, { maxRetriesPerRequest: null });
  }
  return redis;
}

export function getSubRedis(): Redis {
  if (!subRedis) {
    const url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
    subRedis = new Redis(url, { maxRetriesPerRequest: null });
  }
  return subRedis;
}

export function eventsChannel(executionId: string): string {
  return `execution:${executionId}:events`;
}

export function continueChannel(executionId: string): string {
  return `execution:${executionId}:continue`;
}

export function clarifyChannel(executionId: string): string {
  return `execution:${executionId}:clarify`;
}

export type ClarifySignalPayload = {
  executionId: string;
  skip?: boolean;
  answers?: Record<string, string>;
  at?: string;
};

export async function publishEvent(event: AgentEvent): Promise<void> {
  const client = getRedis();
  await client.publish(eventsChannel(event.executionId), JSON.stringify(event));
  const key = `execution:${event.executionId}:event-log`;
  await client.rpush(key, JSON.stringify(event));
  await client.ltrim(key, -500, -1);
  await client.expire(key, 60 * 60 * 24);
}

export async function waitForContinueSignal(
  executionId: string,
  timeoutMs = 30 * 60 * 1000,
): Promise<void> {
  const redis = getRedis();
  const flagKey = `execution:${executionId}:continue-flag`;

  // Consume durable flag first (handles approve-before-subscribe races)
  const preexisting = await redis.getdel(flagKey);
  if (preexisting) return;

  const sub = getSubRedis().duplicate();
  const channel = continueChannel(executionId);

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      void redis.del(flagKey).catch(() => undefined);
      void sub.unsubscribe(channel).finally(() => {
        sub.disconnect();
        resolve();
      });
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      void sub.unsubscribe(channel).finally(() => {
        sub.disconnect();
        reject(new Error(`Timed out waiting for continue on ${channel}`));
      });
    }, timeoutMs);

    // Poll durable flag in case publish landed between getdel and subscribe
    const poll = setInterval(() => {
      void redis.getdel(flagKey).then((v) => {
        if (v) finish();
      });
    }, 1000);

    void sub.subscribe(channel, (err: Error | null | undefined) => {
      if (err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(poll);
        sub.disconnect();
        reject(err);
      }
    });

    sub.on('message', (ch: string, message: string) => {
      if (ch !== channel) return;
      // Accept plain "continue" or JSON payloads that include continue/executionId
      if (
        message === 'continue' ||
        message.includes('continue') ||
        message.includes(executionId)
      ) {
        finish();
      }
    });
  });
}

export async function waitForClarifySignal(
  executionId: string,
  timeoutMs = 30 * 60 * 1000,
): Promise<ClarifySignalPayload> {
  const sub = getSubRedis().duplicate();
  const channel = clarifyChannel(executionId);

  return new Promise<ClarifySignalPayload>((resolve, reject) => {
    const timer = setTimeout(() => {
      void sub.unsubscribe(channel).finally(() => {
        sub.disconnect();
        reject(new Error(`Timed out waiting for clarification on ${channel}`));
      });
    }, timeoutMs);

    void sub.subscribe(channel, (err: Error | null | undefined) => {
      if (err) {
        clearTimeout(timer);
        sub.disconnect();
        reject(err);
      }
    });

    sub.on('message', (ch: string, message: string) => {
      if (ch !== channel) return;
      clearTimeout(timer);
      let payload: ClarifySignalPayload = {
        executionId,
        skip: false,
        answers: {},
      };
      try {
        const parsed = JSON.parse(message) as ClarifySignalPayload;
        payload = {
          executionId,
          skip: Boolean(parsed.skip),
          answers:
            parsed.answers && typeof parsed.answers === 'object'
              ? parsed.answers
              : {},
          at: parsed.at,
        };
      } catch {
        payload = { executionId, skip: true, answers: {} };
      }
      void sub.unsubscribe(channel).finally(() => {
        sub.disconnect();
        resolve(payload);
      });
    });
  });
}

export async function publishClarificationQuestions(
  executionId: string,
  questions: unknown,
): Promise<void> {
  const client = getRedis();
  await client.set(
    `execution:${executionId}:clarification-questions`,
    JSON.stringify(questions),
    'EX',
    60 * 60 * 24,
  );
}
