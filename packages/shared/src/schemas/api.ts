import { z } from 'zod';
import { frameworkSchema } from './frameworks.js';
import { languageSchema } from './languages.js';
import { environmentSchema } from './environments.js';

export const createOrganizationSchema = z.object({
  name: z.string().min(2),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

const optionalUrl = z
  .union([z.string().url(), z.literal('')])
  .optional()
  .transform((value): string | undefined =>
    !value || value === '' ? undefined : value,
  );

export const projectAnalysisStatusSchema = z.enum([
  'NOT_STARTED',
  'READY',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'STALE',
]);

export const createProjectSchema = z.object({
  name: z.string().trim().min(2),
  description: z.string().trim().max(5000).optional(),
  appUrl: optionalUrl,
  requirementText: z.string().optional(),
  framework: frameworkSchema.default('PLAYWRIGHT'),
  language: languageSchema.default('TYPESCRIPT'),
  environment: environmentSchema.default('QA'),
  loginUrl: optionalUrl,
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = createProjectSchema.partial().extend({
  name: z.string().trim().min(2).optional(),
  status: z.string().optional(),
  analysisStatus: projectAnalysisStatusSchema.optional(),
  testStrategy: z.enum(['SPRINT', 'KANBAN']).optional(),
  kanbanWipLimit: z.number().int().min(1).max(200).nullable().optional(),
  healRequiresReview: z.boolean().optional(),
  llmHealRequiresApproval: z.boolean().optional(),
  allowExecuteQuarantined: z.boolean().optional(),
});

export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const requirementTypeSchema = z.enum([
  'FUNCTIONAL',
  'NON_FUNCTIONAL',
  'BUSINESS_RULE',
]);

export const createManualRequirementSchema = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().max(20000).optional().default(''),
  type: requirementTypeSchema.default('FUNCTIONAL'),
});

export type CreateManualRequirementInput = z.infer<
  typeof createManualRequirementSchema
>;

export const updateManualRequirementSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  description: z.string().trim().max(20000).optional(),
  type: requirementTypeSchema.optional(),
});

export type UpdateManualRequirementInput = z.infer<
  typeof updateManualRequirementSchema
>;

export const createRequirementPasteSchema = z.object({
  sourceType: z.literal('PASTE').optional().default('PASTE'),
  originalContent: z.string().trim().min(1),
});

export type CreateRequirementPasteInput = z.infer<
  typeof createRequirementPasteSchema
>;

export const extractedRequirementSourceSchema = z.object({
  document: z.string().optional().nullable(),
  page: z.number().int().positive().optional().nullable(),
  section: z.string().optional().nullable(),
  text: z.string().optional().nullable(),
});

export const extractedRequirementSchema = z.object({
  requirementKey: z
    .string()
    .regex(/^REQ-\d{3,}$/i)
    .transform((k) => k.toUpperCase()),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  type: requirementTypeSchema,
  priority: z.string().trim().min(1).nullable().optional(),
  acceptanceCriteria: z.array(z.string()).default([]),
  businessRules: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([]),
  supportingInformation: z.array(z.string()).default([]),
  source: extractedRequirementSourceSchema.optional().nullable(),
  sourceText: z.string().optional().nullable(),
  section: z.string().optional().nullable(),
});

export const extractionTableSchema = z.object({
  type: z.literal('TABLE_DATA').optional(),
  section: z.string().nullable().optional(),
  headers: z.array(z.string()),
  rows: z.array(z.array(z.string())),
});

export const extractionAiResponseSchema = z.object({
  requirements: z.array(extractedRequirementSchema).min(1),
  documentElements: z
    .object({
      sections: z
        .array(
          z.object({
            type: z.literal('SECTION').optional(),
            title: z.string(),
            level: z.number().int().optional(),
          }),
        )
        .optional()
        .default([]),
      tables: z.array(extractionTableSchema).optional().default([]),
    })
    .optional(),
});

export type ExtractionAiResponse = z.infer<typeof extractionAiResponseSchema>;
export type ExtractedRequirementInput = z.infer<
  typeof extractedRequirementSchema
>;

export const startExecutionSchema = z.object({
  projectId: z.string().min(1),
});

export type StartExecutionInput = z.infer<typeof startExecutionSchema>;

export const continueAfterLoginSchema = z.object({
  executionId: z.string().min(1),
});

export type ContinueAfterLoginInput = z.infer<typeof continueAfterLoginSchema>;

export const clarifyExecutionSchema = z.object({
  answers: z.record(z.string(), z.string()).default({}),
  skip: z.boolean().optional(),
});

export type ClarifyExecutionInput = z.infer<typeof clarifyExecutionSchema>;

export const reviewQuestionPrioritySchema = z.enum([
  'CRITICAL',
  'HIGH',
  'MEDIUM',
  'LOW',
]);

export const reviewQuestionCategorySchema = z.enum([
  'BUSINESS_RULE',
  'BUSINESS_FLOW',
  'ACTOR',
  'ROLE_PERMISSION',
  'PRECONDITION',
  'STATE',
  'STATE_TRANSITION',
  'EXCEPTION',
  'BUSINESS_OUTCOME',
  'FUNCTIONAL_BEHAVIOR',
  'VALIDATION',
  'ERROR_HANDLING',
  'INPUT',
  'OUTPUT',
  'NAVIGATION',
  'DATA',
]);

export const answerReviewQuestionSchema = z.object({
  answer: z.string().trim().min(1),
});

export type AnswerReviewQuestionInput = z.infer<
  typeof answerReviewQuestionSchema
>;

export const rejectRequirementsSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, 'Rejection reason is required')
    .max(4000),
});

export type RejectRequirementsInput = z.infer<typeof rejectRequirementsSchema>;

export const reviewFactStatusSchema = z.enum([
  'CONFIRMED',
  'INFERRED',
  'MISSING',
  'DERIVED_FROM_USER_ANSWER',
]);

export const reviewFactSchema = z.object({
  text: z.string(),
  status: reviewFactStatusSchema,
  source: z.string().nullish(),
});

export const businessReviewPayloadSchema = z.object({
  intent: reviewFactSchema.nullable(),
  actors: z.array(reviewFactSchema),
  rules: z.array(reviewFactSchema),
  preconditions: z.array(reviewFactSchema),
  flow: z.array(reviewFactSchema),
  states: z.array(reviewFactSchema),
  transitions: z.array(reviewFactSchema),
  exceptions: z.array(reviewFactSchema),
  outcomes: z.array(reviewFactSchema),
  dependencies: z.array(reviewFactSchema),
  permissions: z.array(reviewFactSchema),
});

export const functionalReviewPayloadSchema = z.object({
  inputs: z.array(reviewFactSchema),
  outputs: z.array(reviewFactSchema),
  validations: z.array(reviewFactSchema),
  successBehavior: z.array(reviewFactSchema),
  failureBehavior: z.array(reviewFactSchema),
  errorHandling: z.array(reviewFactSchema),
  navigation: z.array(reviewFactSchema),
  dataHandling: z.array(reviewFactSchema),
});

export const requirementReviewStatusSchema = z.enum([
  'BLOCKED',
  'NEEDS_CLARIFICATION',
  'REVIEW_RECOMMENDED',
  'READY_FOR_TEST_DESIGN',
]);

export const reviewQuestionSchema = z.object({
  id: z.string(),
  questionKey: z.string(),
  category: reviewQuestionCategorySchema,
  priority: reviewQuestionPrioritySchema,
  question: z.string(),
  reason: z.string(),
  blocking: z.boolean(),
  status: z.enum(['OPEN', 'ANSWERED', 'DISMISSED']),
  answer: z.string().nullable().optional(),
  answeredAt: z.union([z.string(), z.date()]).nullable().optional(),
});

export const reviewConflictSchema = z.object({
  id: z.string(),
  summary: z.string(),
  detail: z.string(),
  status: z.enum(['OPEN', 'RESOLVED']),
  requirementA: z.object({
    requirementKey: z.string(),
    title: z.string(),
  }),
  requirementB: z.object({
    requirementKey: z.string(),
    title: z.string(),
  }),
  createdAt: z.union([z.string(), z.date()]).optional(),
});

export const reviewDashboardSummarySchema = z.object({
  total: z.number(),
  reviewed: z.number(),
  business: z.object({
    ready: z.number(),
    needsClarification: z.number(),
    blocked: z.number(),
  }),
  functional: z.object({
    complete: z.number(),
    partial: z.number(),
    incomplete: z.number(),
  }),
  questions: z.object({
    critical: z.number(),
    high: z.number(),
    medium: z.number(),
    low: z.number(),
  }),
  openConflicts: z.number(),
  businessReadinessPct: z.number(),
  functionalReadinessPct: z.number(),
  byReviewStatus: z.object({
    blocked: z.number(),
    needsClarification: z.number(),
    reviewRecommended: z.number(),
    readyForTestDesign: z.number(),
  }),
});

export type ReviewDashboardSummary = z.infer<
  typeof reviewDashboardSummarySchema
>;

export const saveEnvironmentSchema = z.object({
  appUrl: z.string().max(2000).optional().default(''),
  loginUrl: z.string().max(2000).optional(),
  username: z.string().max(200).optional(),
  password: z.string().max(500).optional(),
  browserMode: z.enum(['HEADLESS', 'HEADED']).optional(),
  confirmProduction: z.boolean().optional(),
});

export type SaveEnvironmentInput = z.infer<typeof saveEnvironmentSchema>;

export const executionSelectionSchema = z.object({
  testCaseIds: z.array(z.string().min(1)).max(500).optional(),
  runKind: z.enum(['SPRINT', 'REGRESSION', 'SYSTEM']).optional(),
  featureKey: z.string().max(64).nullable().optional(),
  browserMode: z.enum(['HEADLESS', 'HEADED']).optional(),
});

export type ExecutionSelectionInput = z.infer<typeof executionSelectionSchema>;

export const testCaseReadySchema = z.object({
  ready: z.boolean(),
  ids: z.array(z.string().min(1)).max(500).optional(),
  featureKey: z.string().max(64).optional(),
});

export type TestCaseReadyInput = z.infer<typeof testCaseReadySchema>;

export const caseStatusSchema = z.enum(['DRAFT', 'APPROVED', 'READY']);

export const testCaseWriteSchema = z.object({
  externalId: z.string().min(1).max(64).optional(),
  module: z.string().max(200).nullable().optional(),
  scenario: z.string().min(1).max(2000).optional(),
  preconditions: z.string().max(8000).nullable().optional(),
  steps: z.array(z.string().max(2000)).max(100).optional(),
  expected: z.string().min(1).max(8000).optional(),
  priority: z.string().max(40).nullable().optional(),
  severity: z.string().max(40).nullable().optional(),
  type: z.string().max(80).nullable().optional(),
  requirementKey: z.string().max(64).nullable().optional(),
  designTechnique: z.string().max(64).nullable().optional(),
  featureKey: z.string().max(64).nullable().optional(),
  folderId: z.string().min(1).nullable().optional(),
  designMode: z.enum(['GENERIC', 'UI_GROUNDED']).nullable().optional(),
  priorityLabel: z.enum(['HIGH', 'MEDIUM', 'LOW']).nullable().optional(),
  readyForExecution: z.boolean().optional(),
  caseStatus: caseStatusSchema.optional(),
  testData: z.record(z.string(), z.string()).nullable().optional(),
  customFields: z
    .record(z.string(), z.union([z.string(), z.boolean(), z.number()]))
    .nullable()
    .optional(),
  templateId: z.string().min(1).nullable().optional(),
});

export type TestCaseWriteInput = z.infer<typeof testCaseWriteSchema>;

export const generateTestCasesSchema = z.object({
  prompt: z.string().max(100_000).optional(),
  folderId: z.string().min(1).nullable().optional(),
  includeProjectRequirements: z.boolean().optional(),
  reviewApplication: z.boolean().optional(),
  techniques: z
    .array(
      z.enum([
        'HAPPY_PATH',
        'EQUIVALENCE',
        'BOUNDARY',
        'DECISION_TABLE',
        'STATE_TRANSITION',
        'NEGATIVE',
        'ERROR_GUESSING',
      ]),
    )
    .min(1)
    .max(7)
    .optional(),
  type: z.string().max(80).optional(),
  priorityLabel: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
});

export type GenerateTestCasesInput = z.infer<typeof generateTestCasesSchema>;

export const aiPromptSourceSchema = z.enum([
  'GENERATE',
  'UPDATE',
  'ENV_REFRESH',
]);

export const aiPromptHistoryCreateSchema = z.object({
  prompt: z.string().min(1).max(100_000),
  source: aiPromptSourceSchema.optional(),
  caseCount: z.number().int().min(0).max(10_000).optional(),
});

export type AiPromptHistoryCreateInput = z.infer<
  typeof aiPromptHistoryCreateSchema
>;

export const generateApplySchema = z.object({
  mode: z.enum(['create', 'update']),
  prompt: z.string().max(100_000).optional(),
  source: aiPromptSourceSchema.optional(),
  folderId: z.string().min(1).nullable().optional(),
  templateId: z.string().min(1).nullable().optional(),
  /** Prefer updating these existing case ids (order maps to cases[] when lengths match). */
  caseIds: z.array(z.string().min(1)).max(200).optional(),
  /** When true, skip fingerprint upsert and always insert (AI apply defaults to upsert). */
  forceCreate: z.boolean().optional(),
  cases: z.array(testCaseWriteSchema).min(1).max(200),
});

export type GenerateApplyInput = z.infer<typeof generateApplySchema>;

/** AI QA Engineer intent shell — Suggest plans; Execute applies via tools. */
export const aiAgentIntentSchema = z.object({
  intent: z.string().min(1).max(100_000),
  permissionLevel: z.enum(['SUGGEST', 'EXECUTE']).default('SUGGEST'),
  reviewApplication: z.boolean().optional(),
  includeProjectRequirements: z.boolean().optional(),
  folderId: z.string().min(1).nullable().optional(),
  techniques: z
    .array(
      z.enum([
        'HAPPY_PATH',
        'EQUIVALENCE',
        'BOUNDARY',
        'DECISION_TABLE',
        'STATE_TRANSITION',
        'NEGATIVE',
        'ERROR_GUESSING',
      ]),
    )
    .min(1)
    .max(7)
    .optional(),
});

export type AiAgentIntentInput = z.infer<typeof aiAgentIntentSchema>;

export const jiraTicketListSchema = z.object({
  mode: z.enum(['BROWSE', 'PROMPT', 'KEYS', 'EPIC']).default('BROWSE'),
  prompt: z.string().max(2000).optional(),
  keys: z.array(z.string().min(1).max(32)).max(50).optional(),
  epicKey: z.string().min(1).max(32).optional(),
});

export type JiraTicketListInput = z.infer<typeof jiraTicketListSchema>;

export const jiraImportRequirementsSchema = z.object({
  keys: z.array(z.string().min(1).max(32)).min(1).max(50),
});

export type JiraImportRequirementsInput = z.infer<
  typeof jiraImportRequirementsSchema
>;

export const testCaseBulkCreateSchema = z.object({
  folderId: z.string().min(1).nullable().optional(),
  templateId: z.string().min(1).nullable().optional(),
  cases: z.array(testCaseWriteSchema).min(1).max(200),
});

export type TestCaseBulkCreateInput = z.infer<typeof testCaseBulkCreateSchema>;

export const importTestCasesSchema = z.object({
  folderId: z.string().min(1).nullable().optional(),
  templateId: z.string().min(1).nullable().optional(),
  updateExisting: z.boolean().optional(),
});

export type ImportTestCasesInput = z.infer<typeof importTestCasesSchema>;

export const caseFieldTypeSchema = z.enum([
  'TEXT',
  'TEXTAREA',
  'DROPDOWN',
  'CHECKBOX',
  'NUMBER',
]);

export const caseFieldWriteSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/i, 'key must be alphanumeric')
    .optional(),
  label: z.string().trim().min(1).max(80),
  type: caseFieldTypeSchema.optional(),
  options: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  required: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  projectId: z.string().min(1).nullable().optional(),
});

export type CaseFieldWriteInput = z.infer<typeof caseFieldWriteSchema>;

export const caseTemplateWriteSchema = z.object({
  name: z.string().trim().min(1).max(80),
  isDefault: z.boolean().optional(),
  fieldKeys: z.array(z.string().min(1).max(40)).max(50).optional(),
  defaults: z
    .object({
      type: z.string().max(80).optional(),
      priorityLabel: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
      preconditions: z.string().max(8000).optional(),
      designTechnique: z.string().max(64).optional(),
    })
    .optional(),
});

export type CaseTemplateWriteInput = z.infer<typeof caseTemplateWriteSchema>;

export const testCaseStatusSchema = z.object({
  status: caseStatusSchema,
  ids: z.array(z.string().min(1)).max(500),
});

export type TestCaseStatusInput = z.infer<typeof testCaseStatusSchema>;

export const testCaseBulkUpdateSchema = z.object({
  ids: z.array(z.string().min(1)).max(500),
  status: caseStatusSchema.optional(),
  priorityLabel: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
  type: z.string().max(80).optional(),
  designTechnique: z.string().max(64).nullable().optional(),
  featureKey: z.string().max(64).nullable().optional(),
  folderId: z.string().min(1).nullable().optional(),
  module: z.string().max(200).nullable().optional(),
  requirementKey: z.string().max(64).nullable().optional(),
});

export type TestCaseBulkUpdateInput = z.infer<typeof testCaseBulkUpdateSchema>;

export const testCaseBulkDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).max(500),
  permanent: z.boolean().optional(),
});

export const testCaseRestoreSchema = z.object({
  ids: z.array(z.string().min(1)).max(500),
});

export const createFeatureFolderSchema = z.object({
  name: z.string().trim().min(1).max(120),
  parentId: z.string().min(1).nullable().optional(),
});

export const createTcmsFolderSchema = createFeatureFolderSchema;

export const updateTcmsFolderSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  parentId: z.string().min(1).nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export const deleteTcmsFolderSchema = z.object({
  deleteCases: z.boolean().optional(),
});

export const createTcmsRunSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  testCaseIds: z.array(z.string().min(1)).max(500).optional().default([]),
  folderIds: z.array(z.string().min(1)).max(100).optional().default([]),
  runKind: z.enum(['MANUAL', 'AUTOMATION']).optional(),
  browserMode: z.enum(['HEADLESS', 'HEADED']).optional(),
  featureKey: z.string().max(64).nullable().optional(),
  folderId: z.string().min(1).nullable().optional(),
  status: z.enum(['PENDING', 'RUNNING']).optional(),
});

export const proposeTcmsRunSchema = z.object({
  prompt: z.string().max(100_000).optional(),
  name: z.string().trim().min(1).max(120).optional(),
});

export type ProposeTcmsRunInput = z.infer<typeof proposeTcmsRunSchema>;

export const aiExecuteRunSchema = z.object({
  appUrl: z.string().max(2000).optional().default(''),
  loginUrl: z.string().max(2000).optional(),
  username: z.string().max(200).optional(),
  password: z.string().max(500).optional(),
  browser: z.enum(['chromium', 'firefox', 'webkit']).optional(),
  browserMode: z.enum(['HEADLESS', 'HEADED']).optional(),
  target: z.enum(['LOCAL', 'CLOUD']).optional(),
  confirmProduction: z.boolean().optional(),
  testCaseIds: z.array(z.string().min(1)).max(500).optional(),
  /** RECORD re-runs NL steps; REPLAY uses ActionLog when present. */
  executeMode: z.enum(['RECORD', 'REPLAY']).optional(),
});

export type AiExecuteRunInput = z.infer<typeof aiExecuteRunSchema>;

export type CreateTcmsRunInput = z.infer<typeof createTcmsRunSchema>;

export const updateTcmsRunSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  addTestCaseIds: z.array(z.string().min(1)).max(500).optional(),
  removeTestCaseIds: z.array(z.string().min(1)).max(500).optional(),
  testCaseIds: z.array(z.string().min(1)).max(500).optional(),
});

export type UpdateTcmsRunInput = z.infer<typeof updateTcmsRunSchema>;

export const testResultWriteSchema = z.object({
  status: z.enum(['PASSED', 'FAILED', 'BLOCKED', 'SKIPPED', 'ERROR']),
  message: z.string().max(8000).nullable().optional(),
  testCaseId: z.string().min(1).optional(),
  executionId: z.string().min(1).optional(),
  durationMs: z.number().int().min(0).max(86_400_000).optional(),
});

export type TestResultWriteInput = z.infer<typeof testResultWriteSchema>;
