import { z } from 'zod';

export const Environment = {
  DEV: 'DEV',
  QA: 'QA',
  UAT: 'UAT',
  PRODUCTION: 'PRODUCTION',
} as const;

export type Environment = (typeof Environment)[keyof typeof Environment];

export const environmentSchema = z.enum(['DEV', 'QA', 'UAT', 'PRODUCTION']);
