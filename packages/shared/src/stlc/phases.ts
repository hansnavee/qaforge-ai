/**
 * Canonical 10-phase STLC registry — Senior QA AI + human Accept gates.
 * UI, API, and orchestrator must read from this (do not hardcode phase lists).
 */

export const TestingLevel = {
  SMOKE: 'SMOKE',
  SANITY: 'SANITY',
  FUNCTIONAL: 'FUNCTIONAL',
  INTEGRATION: 'INTEGRATION',
  REGRESSION: 'REGRESSION',
  UAT_READY: 'UAT_READY',
} as const;

export type TestingLevel = (typeof TestingLevel)[keyof typeof TestingLevel];

export const TESTING_LEVELS: TestingLevel[] = [
  TestingLevel.SMOKE,
  TestingLevel.SANITY,
  TestingLevel.FUNCTIONAL,
  TestingLevel.INTEGRATION,
  TestingLevel.REGRESSION,
  TestingLevel.UAT_READY,
];

export const StlcPhaseId = {
  REQUIREMENTS: 'REQUIREMENTS',
  PLANNING: 'PLANNING',
  DESIGN: 'DESIGN',
  ENVIRONMENT: 'ENVIRONMENT',
  DATA: 'DATA',
  EXECUTION: 'EXECUTION',
  DEFECTS: 'DEFECTS',
  AUTOMATION: 'AUTOMATION',
  REPORTING: 'REPORTING',
  SIGNOFF: 'SIGNOFF',
  DONE: 'DONE',
} as const;

export type StlcPhaseId = (typeof StlcPhaseId)[keyof typeof StlcPhaseId];

export type StlcDownloadFormat =
  | 'json'
  | 'md'
  | 'html'
  | 'csv'
  | 'zip'
  | 'junit';

export type StlcPhaseDefinition = {
  index: number;
  id: Exclude<StlcPhaseId, 'DONE'>;
  label: string;
  agentName: string;
  /** Execution status while waiting for human Accept */
  awaitStatus: string;
  /** Project.stlcStage while this phase is active / awaiting Accept */
  stage: Exclude<StlcPhaseId, 'DONE'>;
  /** Next stage after Accept */
  nextStage: StlcPhaseId;
  approveAction: string;
  downloads: StlcDownloadFormat[];
  description: string;
};

export const STLC_PHASES: StlcPhaseDefinition[] = [
  {
    index: 1,
    id: StlcPhaseId.REQUIREMENTS,
    label: 'Requirement Analysis',
    agentName: 'AI Analyzer Agent',
    awaitStatus: 'AWAITING_REQUIREMENTS_APPROVAL',
    stage: StlcPhaseId.REQUIREMENTS,
    nextStage: StlcPhaseId.PLANNING,
    approveAction: 'approve-requirements',
    downloads: ['json', 'md', 'csv', 'html'],
    description:
      'Senior QA analyzes requirements, gaps, and clarifying questions',
  },
  {
    index: 2,
    id: StlcPhaseId.PLANNING,
    label: 'Test Planning',
    agentName: 'AI Test Strategy Agent',
    awaitStatus: 'AWAITING_PLAN_APPROVAL',
    stage: StlcPhaseId.PLANNING,
    nextStage: StlcPhaseId.DESIGN,
    approveAction: 'approve-test-plan',
    downloads: ['json', 'md', 'html'],
    description:
      'Senior QA prepares strategy, then continues into case design in one pass',
  },
  {
    index: 3,
    id: StlcPhaseId.DESIGN,
    label: 'Test Case Development',
    agentName: 'AI Test Design Agent',
    awaitStatus: 'AWAITING_DESIGN_APPROVAL',
    stage: StlcPhaseId.DESIGN,
    nextStage: StlcPhaseId.ENVIRONMENT,
    approveAction: 'approve-test-design',
    downloads: ['json', 'csv', 'md', 'html'],
    description:
      'Documented cases for human review — edit/delete anytime, including after Accept',
  },
  {
    index: 4,
    id: StlcPhaseId.ENVIRONMENT,
    label: 'Test Environment Setup',
    agentName: 'AI Environment Agent',
    awaitStatus: 'AWAITING_ENV_APPROVAL',
    stage: StlcPhaseId.ENVIRONMENT,
    nextStage: StlcPhaseId.DATA,
    approveAction: 'approve-environment',
    downloads: ['json', 'md', 'html'],
    description:
      'Senior QA verifies browsers, URL, credentials readiness, and data access',
  },
  {
    index: 5,
    id: StlcPhaseId.DATA,
    label: 'Test Data Preparation',
    agentName: 'AI Test Data Agent',
    awaitStatus: 'AWAITING_DATA_APPROVAL',
    stage: StlcPhaseId.DATA,
    nextStage: StlcPhaseId.EXECUTION,
    approveAction: 'approve-test-data',
    downloads: ['json', 'csv', 'md'],
    description: 'Senior QA prepares datasets for positive/negative/boundary',
  },
  {
    index: 6,
    id: StlcPhaseId.EXECUTION,
    label: 'Test Execution',
    agentName: 'AI Test Executor Agent',
    awaitStatus: 'AWAITING_EXECUTION_APPROVAL',
    stage: StlcPhaseId.EXECUTION,
    nextStage: StlcPhaseId.DEFECTS,
    approveAction: 'approve-test-execution',
    downloads: ['json', 'csv', 'html', 'zip'],
    description:
      'Senior QA executes smoke → sanity → functional/integration with evidence',
  },
  {
    index: 7,
    id: StlcPhaseId.DEFECTS,
    label: 'Defect Reporting',
    agentName: 'AI Bug Reporting Agent',
    awaitStatus: 'AWAITING_DEFECT_APPROVAL',
    stage: StlcPhaseId.DEFECTS,
    nextStage: StlcPhaseId.AUTOMATION,
    approveAction: 'approve-defects',
    downloads: ['json', 'csv', 'md', 'html'],
    description: 'Senior QA logs and triages defects from execution failures',
  },
  {
    index: 8,
    id: StlcPhaseId.AUTOMATION,
    label: 'Test Automation',
    agentName: 'AI Test Automation Agent',
    awaitStatus: 'AWAITING_AUTOMATION_APPROVAL',
    stage: StlcPhaseId.AUTOMATION,
    nextStage: StlcPhaseId.REPORTING,
    approveAction: 'approve-automation',
    downloads: ['json', 'zip', 'md'],
    description: 'Senior QA automates stable smoke/regression candidates',
  },
  {
    index: 9,
    id: StlcPhaseId.REPORTING,
    label: 'Test Reporting',
    agentName: 'AI Test Report Agent',
    awaitStatus: 'AWAITING_REPORT_APPROVAL',
    stage: StlcPhaseId.REPORTING,
    nextStage: StlcPhaseId.SIGNOFF,
    approveAction: 'approve-report',
    downloads: ['html', 'md', 'csv', 'junit', 'zip'],
    description: 'Senior QA prepares executive and detailed HTML reports',
  },
  {
    index: 10,
    id: StlcPhaseId.SIGNOFF,
    label: 'Test Closure / Sign-off',
    agentName: 'AI Sign-off Agent',
    awaitStatus: 'AWAITING_QA_SIGNOFF',
    stage: StlcPhaseId.SIGNOFF,
    nextStage: StlcPhaseId.DONE,
    approveAction: 'approve-qa-signoff',
    downloads: ['json', 'md', 'html'],
    description:
      'Senior QA evaluates exit criteria and recommends go/no-go; human Accepts',
  },
];

export function getStlcPhase(id: string): StlcPhaseDefinition | undefined {
  return STLC_PHASES.find((p) => p.id === id);
}

export function stlcPhaseIndex(stage: string | null | undefined): number {
  const s = (stage ?? StlcPhaseId.REQUIREMENTS).toUpperCase();
  if (s === StlcPhaseId.DONE) return STLC_PHASES.length + 1;
  const found = STLC_PHASES.find((p) => p.id === s || p.stage === s);
  return found?.index ?? 1;
}

/** True if `current` is at or past `target` in the STLC order. */
export function stlcStageReached(
  current: string | null | undefined,
  target: Exclude<StlcPhaseId, 'DONE'>,
): boolean {
  const cur = stlcPhaseIndex(current);
  const tgt = stlcPhaseIndex(target);
  return cur >= tgt;
}

export type PhaseValidation = {
  passed: boolean;
  blockers: string[];
  summary: string;
};

export type PhaseDocState = {
  phaseId: string;
  agentName: string;
  status: 'RUNNING' | 'READY_FOR_REVIEW' | 'ACCEPTED' | 'LOCKED' | 'FAILED';
  validation: PhaseValidation | null;
  document: Record<string, unknown>;
  documentVersion: number;
  editedByHuman: boolean;
  updatedAt: string;
  approvedAt?: string | null;
};

export type StlcPhaseDocsMap = Partial<
  Record<Exclude<StlcPhaseId, 'DONE'>, PhaseDocState>
>;
