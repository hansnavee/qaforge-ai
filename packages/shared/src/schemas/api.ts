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
