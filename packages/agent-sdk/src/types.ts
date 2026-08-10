export interface AgentHandler<TInput = unknown, TOutput = unknown> {
  id: string;
  name: string;
  inputSchema?: unknown;
  run(ctx: AgentContext, input: TInput): Promise<TOutput>;
}

export interface AgentContext {
  organizationId: string;
  projectId: string;
  executionId: string;
  browserSessionId?: string;
  artifactStore: ArtifactStore;
  llm: LlmClient;
  /** Accumulated LLM tokens for the current agent run (reset by orchestrator). */
  tokensUsed?: { total: number };
  emit: (event: {
    type: string;
    phase?: string;
    message: string;
    data?: unknown;
  }) => Promise<void>;
  getArtifactJson: <T>(type: string) => Promise<T | null>;
  putArtifactJson: (type: string, data: unknown) => Promise<string>;
}

export interface ArtifactStore {
  put(
    key: string,
    body: Buffer | string,
    mime: string,
  ): Promise<{ key: string; size: number }>;
  get(key: string): Promise<Buffer>;
  signedUrl(key: string, ttlSeconds?: number): Promise<string>;
}

export interface LlmClient {
  complete(opts: {
    system?: string;
    prompt: string;
    json?: boolean;
    model?: 'fast' | 'reasoning';
    maxTokens?: number;
    temperature?: number;
  }): Promise<{ text: string; tokensUsed: number }>;
}
