import type { ExecutionPhase } from './schemas/execution.js';

export type AgentEvent = {
  executionId: string;
  type: string;
  phase?: ExecutionPhase;
  message: string;
  timestamp: string;
  data?: unknown;
};
