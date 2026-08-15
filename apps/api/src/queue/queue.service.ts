import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

export const EXECUTIONS_QUEUE = 'executions';
export const RUN_EXECUTION_JOB = 'run-execution';
export const GROUND_CASES_JOB = 'ground-cases';
export const AI_EXECUTE_JOB = 'ai-execute-run';
export const AI_GENERATE_JOB = 'ai-generate-run';

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

  async enqueueAiExecute(opts: {
    executionId: string;
    testCaseIds?: string[];
    browser?: string;
    headless?: boolean;
    username?: string;
    password?: string;
    appUrl?: string;
    loginUrl?: string;
    browserstackUsername?: string;
    browserstackAccessKey?: string;
  }) {
    if (!this.queue) {
      this.logger.warn(
        `Queue unavailable; AI execute for ${opts.executionId} not enqueued`,
      );
      return null;
    }
    return this.queue.add(
      AI_EXECUTE_JOB,
      opts,
      {
        jobId: `ai-exec-${opts.executionId}-${Date.now()}`,
        removeOnComplete: 50,
        removeOnFail: 50,
        attempts: 1,
      },
    );
  }

  async enqueueAiGenerate(runId: string) {
    if (!this.queue) {
      this.logger.warn(`Queue unavailable; AI generate ${runId} not enqueued`);
      return null;
    }
    return this.queue.add(
      AI_GENERATE_JOB,
      { runId },
      {
        jobId: `ai-gen-${runId}`,
        removeOnComplete: 50,
        removeOnFail: 50,
        attempts: 1,
      },
    );
  }

  async publishPause(executionId: string) {
    if (!this.pub) return;
    await this.pub.set(
      `execution:${executionId}:pause-flag`,
      '1',
      'EX',
      60 * 60,
    );
  }

  async clearPause(executionId: string) {
    if (!this.pub) return;
    await this.pub.del(`execution:${executionId}:pause-flag`);
  }

  async enqueueGroundCases(projectId: string, executionId: string) {
    if (!this.queue) {
      this.logger.warn(`Queue unavailable; ground-cases for ${projectId} skipped`);
      return null;
    }
    return this.queue.add(
      GROUND_CASES_JOB,
      { projectId, executionId },
      {
        jobId: `ground-${executionId}-${Date.now()}`,
        removeOnComplete: 50,
        removeOnFail: 50,
        attempts: 2,
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
    // Durable flag so a fast human approve before the worker subscribes is not lost
    await this.pub.set(
      `execution:${executionId}:continue-flag`,
      '1',
      'EX',
      60 * 60,
    );
    await this.pub.publish(
      `execution:${executionId}:continue`,
      JSON.stringify({
        executionId,
        continue: true,
        at: new Date().toISOString(),
      }),
    );
  }

  async publishCancel(executionId: string) {
    if (!this.pub) return;
    await this.pub.set(
      `execution:${executionId}:cancel-flag`,
      '1',
      'EX',
      60 * 60,
    );
    await this.pub.publish(
      `execution:${executionId}:continue`,
      JSON.stringify({
        executionId,
        cancel: true,
        at: new Date().toISOString(),
      }),
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
    const body = {
      executionId,
      skip: Boolean(payload.skip),
      answers: payload.answers ?? {},
      at: new Date().toISOString(),
    };
    // Durable payload so skip/answers are not lost before the worker subscribes
    await this.pub.set(
      `execution:${executionId}:clarify-flag`,
      JSON.stringify(body),
      'EX',
      60 * 60,
    );
    await this.pub.publish(
      `execution:${executionId}:clarify`,
      JSON.stringify(body),
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
