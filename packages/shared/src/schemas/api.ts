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

export const createProjectSchema = z.object({
  name: z.string().trim().min(2),
  appUrl: optionalUrl,
  requirementText: z.string().optional(),
  framework: frameworkSchema.default('PLAYWRIGHT'),
  language: languageSchema.default('TYPESCRIPT'),
  environment: environmentSchema.default('QA'),
  loginUrl: optionalUrl,
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const createRequirementPasteSchema = z.object({
  sourceType: z.literal('PASTE').optional().default('PASTE'),
  originalContent: z.string().trim().min(1),
});

export type CreateRequirementPasteInput = z.infer<
  typeof createRequirementPasteSchema
>;

export const requirementTypeSchema = z.enum([
  'FUNCTIONAL',
  'NON_FUNCTIONAL',
  'BUSINESS_RULE',
]);

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
  source: extractedRequirementSourceSchema.optional().nullable(),
});

export const extractionAiResponseSchema = z.object({
  requirements: z.array(extractedRequirementSchema).min(1),
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
