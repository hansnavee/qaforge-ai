/**
 * QA Tool Interface — Agent speaks intents; providers implement backends.
 * Phase 1 scaffold: contracts + Internal TCMS / Playwright provider stubs.
 */

export type QaToolContext = {
  orgId: string;
  projectId: string;
  userId?: string;
  permissionLevel?: 'SUGGEST' | 'EXECUTE' | 'AUTONOMOUS' | 'PRODUCTION';
};

export type QaRequirement = {
  id?: string;
  key: string;
  title: string;
  description?: string | null;
};

export type QaTestCaseInput = {
  scenario: string;
  module?: string | null;
  designTechnique?: string | null;
  requirementKey?: string | null;
  preconditions?: string | null;
  steps: string[];
  expected: string;
  priorityLabel?: 'HIGH' | 'MEDIUM' | 'LOW';
  type?: string | null;
  testData?: Record<string, string> | null;
  externalId?: string | null;
  forceCreate?: boolean;
};

export type QaTestCase = QaTestCaseInput & {
  id: string;
  externalId: string;
};

export type QaDefectInput = {
  title: string;
  description?: string;
  severity?: string;
  testCaseId?: string;
  executionId?: string;
};

export type QaDefect = QaDefectInput & { id: string; externalRef?: string | null };

/** Abstract tool surface the Agent calls. */
export interface QaToolProvider {
  readonly id: string;
  requirement?: {
    list(ctx: QaToolContext): Promise<QaRequirement[]>;
  };
  testcase: {
    list(ctx: QaToolContext): Promise<QaTestCase[]>;
    /** Upsert by fingerprint unless forceCreate. */
    upsert(
      ctx: QaToolContext,
      input: QaTestCaseInput,
    ): Promise<{ case: QaTestCase; created: boolean; updated: boolean }>;
  };
  defect?: {
    create(ctx: QaToolContext, input: QaDefectInput): Promise<QaDefect>;
  };
  browser?: {
    open(url: string): Promise<void>;
    click(target: string): Promise<void>;
    fill(target: string, value: string): Promise<void>;
    screenshot(name: string): Promise<Uint8Array | null>;
  };
  report?: {
    generate(ctx: QaToolContext, executionId: string): Promise<{ url?: string }>;
  };
}

export type QaToolRegistry = {
  get(id: string): QaToolProvider | undefined;
  list(): QaToolProvider[];
  register(provider: QaToolProvider): void;
};

export function createQaToolRegistry(
  providers: QaToolProvider[] = [],
): QaToolRegistry {
  const map = new Map<string, QaToolProvider>();
  for (const p of providers) map.set(p.id, p);
  return {
    get: (id) => map.get(id),
    list: () => [...map.values()],
    register: (provider) => {
      map.set(provider.id, provider);
    },
  };
}

/** Default provider ids. */
export const QA_TOOL_PROVIDER = {
  INTERNAL_TCMS: 'internal-tcms',
  PLAYWRIGHT: 'playwright',
  JIRA: 'jira',
} as const;
