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
