import { Worker, type Job } from 'bullmq';
import { prisma } from '@qaforge/database';
import { AwaitingHumanError } from './awaiting-human.js';
import { getRedis } from './redis.js';
import { runExecution, type ExecutionJobData } from './orchestrator.js';
import { runPhase1Execution } from './phase1-orchestrator.js';

export type JobData = ExecutionJobData & { runMode?: string };

async function processJob(job: Job<JobData>): Promise<void> {
  if (job.name !== 'run-execution') {
    console.warn(`[worker] Ignoring unknown job name: ${job.name}`);
    return;
  }

  const executionId = job.data.executionId;
  if (!executionId) {
    throw new Error('Job missing executionId');
  }

  const row = await prisma.execution.findUnique({
    where: { id: executionId },
    select: { runMode: true, status: true },
  });
  if (row?.status === 'CANCELLED' || row?.status === 'COMPLETED') {
    console.log(
      `[worker] Skip ${executionId} — already ${row.status}`,
    );
    return;
  }
  const runMode = job.data.runMode ?? row?.runMode ?? 'FULL';

  console.log(`[worker] Processing execution ${executionId} mode=${runMode}`);
  try {
    if (runMode === 'PHASE1' || runMode === 'STLC') {
      await runPhase1Execution(executionId);
    } else {
      await runExecution(executionId);
    }
    console.log(`[worker] Finished execution ${executionId}`);
  } catch (err) {
    if (err instanceof AwaitingHumanError) {
      console.log(
        `[worker] Released slot — ${executionId} paused at ${err.awaitStatus}`,
      );
      return;
    }
    throw err;
  }
}

async function main() {
  const connection = getRedis();
  // Parallel STLC runs; human gates release the slot (see AwaitingHumanError).
  const concurrency = Math.max(
    1,
    Number(process.env.WORKER_CONCURRENCY ?? 3),
  );

  const worker = new Worker<JobData>(
    'executions',
    async (job) => processJob(job),
    {
      connection,
      concurrency,
    },
  );

  worker.on('ready', () => {
    console.log('[worker] BullMQ worker ready on queue "executions"');
  });

  worker.on('failed', (job, err) => {
    console.error(
      `[worker] Job ${job?.id} failed:`,
      err?.message ?? err,
    );
  });

  worker.on('completed', (job) => {
    console.log(`[worker] Job ${job.id} completed`);
  });

  const shutdown = async () => {
    console.log('[worker] Shutting down...');
    await worker.close();
    connection.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  console.error('[worker] Fatal:', err);
  process.exit(1);
});
