export const DESIGN_TECHNIQUES = [
  'HAPPY_PATH',
  'EQUIVALENCE',
  'BOUNDARY',
  'DECISION_TABLE',
  'STATE_TRANSITION',
  'NEGATIVE',
  'ERROR_GUESSING',
] as const;

export type DesignTechnique = (typeof DESIGN_TECHNIQUES)[number];

export const TECHNIQUE_LABELS: Record<DesignTechnique, string> = {
  HAPPY_PATH: 'Happy path',
  EQUIVALENCE: 'Equivalence partitioning',
  BOUNDARY: 'Boundary value analysis',
  DECISION_TABLE: 'Decision table',
  STATE_TRANSITION: 'State transition',
  NEGATIVE: 'Negative testing',
  ERROR_GUESSING: 'Error guessing',
};
