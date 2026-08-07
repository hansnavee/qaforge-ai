import { z } from 'zod';
import { frameworkSchema } from './frameworks.js';
import { languageSchema } from './languages.js';
import { environmentSchema } from './environments.js';

export const createOrganizationSchema = z.object({
  name: z.string().min(2),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const createProjectSchema = z.object({
  name: z.string().min(1),
  appUrl: z.string().url(),
  requirementText: z.string().optional(),
  framework: frameworkSchema,
  language: languageSchema,
  environment: environmentSchema,
  loginUrl: z.string().url().optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

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
