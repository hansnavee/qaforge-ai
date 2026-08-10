import { createHash } from 'node:crypto';
import {
  OpenRouterLlmClient,
  R2ArtifactStore,
  type AgentContext,
  type ArtifactStore,
} from '@qaforge/agent-sdk';
import { prisma } from '@qaforge/database';
import type { ExecutionPhase } from '@qaforge/shared';
import { publishEvent } from './redis.js';

export type ExecutionJobData = {
  executionId: string;
};

export async function createAgentContext(opts: {
  organizationId: string;
  projectId: string;
  executionId: string;
  browserSessionId?: string;
  artifactStore?: ArtifactStore;
}): Promise<AgentContext> {
  const artifactStore =
    opts.artifactStore ??
    new R2ArtifactStore({
      executionId: opts.executionId,
      fallbackRootDir: `${process.cwd()}/.artifacts`,
    });

  const llmBase = new OpenRouterLlmClient();
  const tokensUsed = { total: 0 };
  const llm: import('@qaforge/agent-sdk').LlmClient = {
    complete: async (opts) => {
      const result = await llmBase.complete(opts);
      tokensUsed.total += result.tokensUsed ?? 0;
      return result;
    },
  };

  const putArtifactJson = async (type: string, data: unknown): Promise<string> => {
    const key = `${opts.executionId}/${type.toLowerCase().replace(/_/g, '-')}.json`;
    const body = JSON.stringify(data, null, 2);
    const stored = await artifactStore.put(key, body, 'application/json');
    const checksum = createHash('sha256').update(body).digest('hex');
    await prisma.artifact.create({
      data: {
        executionId: opts.executionId,
        type,
        storageKey: stored.key,
        mime: 'application/json',
        size: stored.size,
        checksum,
      },
    });
    return stored.key;
  };

  const getArtifactJson = async <T>(type: string): Promise<T | null> => {
    const row = await prisma.artifact.findFirst({
      where: { executionId: opts.executionId, type },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) return null;
    try {
      const buf = await artifactStore.get(row.storageKey);
      return JSON.parse(buf.toString('utf8')) as T;
    } catch {
      return null;
    }
  };

  const emit: AgentContext['emit'] = async (event) => {
    await publishEvent({
      executionId: opts.executionId,
      type: event.type,
      phase: event.phase as ExecutionPhase | undefined,
      message: event.message,
      timestamp: new Date().toISOString(),
      data: event.data,
    });
  };

  return {
    organizationId: opts.organizationId,
    projectId: opts.projectId,
    executionId: opts.executionId,
    browserSessionId: opts.browserSessionId,
    artifactStore,
    llm,
    tokensUsed,
    emit,
    getArtifactJson,
    putArtifactJson,
  };
}

export async function putBinaryArtifact(opts: {
  executionId: string;
  type: string;
  key: string;
  body: Buffer | string;
  mime: string;
  store: ArtifactStore;
}): Promise<string> {
  const stored = await opts.store.put(opts.key, opts.body, opts.mime);
  const buf = Buffer.isBuffer(opts.body)
    ? opts.body
    : Buffer.from(opts.body, 'utf8');
  const checksum = createHash('sha256').update(buf).digest('hex');
  await prisma.artifact.create({
    data: {
      executionId: opts.executionId,
      type: opts.type,
      storageKey: stored.key,
      mime: opts.mime,
      size: stored.size,
      checksum,
    },
  });
  return stored.key;
}
