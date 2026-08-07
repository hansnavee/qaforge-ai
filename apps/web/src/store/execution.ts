import { create } from 'zustand';

export type LiveEvent = {
  executionId?: string;
  type: string;
  phase?: string;
  message: string;
  timestamp: string;
  data?: unknown;
};

type ExecutionState = {
  executionId: string | null;
  status: string | null;
  phase: string | null;
  events: LiveEvent[];
  scores: Record<string, number> | null;
  setExecutionId: (id: string | null) => void;
  setStatus: (status: string | null, phase?: string | null) => void;
  setScores: (scores: Record<string, number> | null) => void;
  appendEvents: (events: LiveEvent[]) => void;
  reset: () => void;
};

export const useExecutionStore = create<ExecutionState>((set) => ({
  executionId: null,
  status: null,
  phase: null,
  events: [],
  scores: null,
  setExecutionId: (id) => set({ executionId: id }),
  setStatus: (status, phase) =>
    set((s) => ({
      status,
      phase: phase === undefined ? s.phase : phase,
    })),
  setScores: (scores) => set({ scores }),
  appendEvents: (events) =>
    set((s) => {
      const seen = new Set(s.events.map((e) => `${e.timestamp}|${e.type}|${e.message}`));
      const next = events.filter(
        (e) => !seen.has(`${e.timestamp}|${e.type}|${e.message}`),
      );
      return { events: [...s.events, ...next].slice(-400) };
    }),
  reset: () =>
    set({
      executionId: null,
      status: null,
      phase: null,
      events: [],
      scores: null,
    }),
}));
