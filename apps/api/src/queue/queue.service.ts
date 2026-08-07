import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

export const EXECUTIONS_QUEUE = 'executions';
export const RUN_EXECUTION_JOB = 'run-execution';

@Injectable()
export class QueueService implements OnModuleInit {
  private readonly logger = new Logger(QueueService.name);
  private connection: IORedis | null = null;
  private queue: Queue | null = null;
  private pub: IORedis | null = null;

  onModuleInit() {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    try {
      this.connection = new IORedis(url, { maxRetriesPerRequest: null });
      this.pub = new IORedis(url, { maxRetriesPerRequest: null });
      this.queue = new Queue(EXECUTIONS_QUEUE, { connection: this.connection });
      this.logger.log(`BullMQ queue "${EXECUTIONS_QUEUE}" connected`);
    } catch (err) {
      this.logger.warn(`Redis unavailable: ${(err as Error).message}`);
    }
  }

  getRedis(): IORedis | null {
    return this.pub;
  }

  createSubscriber(): IORedis | null {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    try {
      return new IORedis(url, { maxRetriesPerRequest: null });
    } catch {
      return null;
    }
  }

  async enqueueRunExecution(
    executionId: string,
    options?: { jobId?: string; runMode?: string },
  ) {
    if (!this.queue) {
      this.logger.warn(`Queue unavailable; job for ${executionId} not enqueued`);
      return null;
    }
    return this.queue.add(
      RUN_EXECUTION_JOB,
      { executionId, runMode: options?.runMode ?? 'FULL' },
      {
        jobId: options?.jobId ?? `run-${executionId}`,
        removeOnComplete: 100,
        removeOnFail: 200,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    );
  }

  async publishExecutionEvent(executionId: string, event: unknown) {
    if (!this.pub) return;
    const channel = `execution:${executionId}:events`;
    const payload = JSON.stringify(event);
    await this.pub.publish(channel, payload);
    await this.pub.rpush(`execution:${executionId}:events:log`, payload);
    await this.pub.ltrim(`execution:${executionId}:events:log`, -500, -1);
  }

  async publishContinue(executionId: string) {
    if (!this.pub) return;
    await this.pub.publish(
      `execution:${executionId}:continue`,
      JSON.stringify({ executionId, at: new Date().toISOString() }),
    );
  }

  async publishClarify(
    executionId: string,
    payload: {
      skip?: boolean;
      answers?: Record<string, string>;
    },
  ) {
    if (!this.pub) return;
    await this.pub.publish(
      `execution:${executionId}:clarify`,
      JSON.stringify({
        executionId,
        skip: Boolean(payload.skip),
        answers: payload.answers ?? {},
        at: new Date().toISOString(),
      }),
    );
  }

  async setClarificationQuestions(
    executionId: string,
    questions: unknown,
  ) {
    if (!this.pub) return;
    await this.pub.set(
      `execution:${executionId}:clarification-questions`,
      JSON.stringify(questions),
      'EX',
      60 * 60 * 24,
    );
  }

  async getClarificationQuestions(executionId: string): Promise<unknown | null> {
    if (!this.pub) return null;
    const raw = await this.pub.get(
      `execution:${executionId}:clarification-questions`,
    );
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async getEventsAfter(executionId: string, after?: string): Promise<unknown[]> {
    if (!this.pub) return [];
    const key = `execution:${executionId}:events:log`;
    const raw = await this.pub.lrange(key, 0, -1);
    const events = raw.map((r) => {
      try {
        return JSON.parse(r) as { timestamp?: string };
      } catch {
        return null;
      }
    }).filter(Boolean) as { timestamp?: string }[];

    if (!after) return events;
    return events.filter((e) => (e.timestamp ?? '') > after);
  }

  async close() {
    await this.queue?.close();
    await this.connection?.quit();
    await this.pub?.quit();
  }
}
