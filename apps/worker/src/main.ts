import { Worker, type Job } from 'bullmq';
import { prisma } from '@qaforge/database';
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
    select: { runMode: true },
  });
  const runMode = job.data.runMode ?? row?.runMode ?? 'FULL';

  console.log(`[worker] Processing execution ${executionId} mode=${runMode}`);
  if (runMode === 'PHASE1') {
    await runPhase1Execution(executionId);
  } else {
    await runExecution(executionId);
  }
  console.log(`[worker] Finished execution ${executionId}`);
}

async function main() {
  const connection = getRedis();

  const worker = new Worker<JobData>(
    'executions',
    async (job) => processJob(job),
    {
      connection,
      concurrency: Number(process.env.WORKER_CONCURRENCY ?? 1),
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
