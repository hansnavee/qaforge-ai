import { z } from 'zod';

export const ExecutionStatus = {
  PENDING: 'PENDING',
  QUEUED: 'QUEUED',
  AWAITING_CLARIFICATION: 'AWAITING_CLARIFICATION',
  AWAITING_LOGIN: 'AWAITING_LOGIN',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;

export type ExecutionStatus = (typeof ExecutionStatus)[keyof typeof ExecutionStatus];

export const executionStatusSchema = z.enum([
  'PENDING',
  'QUEUED',
  'AWAITING_CLARIFICATION',
  'AWAITING_LOGIN',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

export const ExecutionPhase = {
  INIT: 'INIT',
  REQUIREMENTS: 'REQUIREMENTS',
  CLARIFICATION: 'CLARIFICATION',
  AUTHENTICATION: 'AUTHENTICATION',
  DISCOVERY: 'DISCOVERY',
  FUNCTIONAL: 'FUNCTIONAL',
  UI_UX: 'UI_UX',
  API: 'API',
  ACCESSIBILITY: 'ACCESSIBILITY',
  PERFORMANCE: 'PERFORMANCE',
  SECURITY: 'SECURITY',
  PRODUCT: 'PRODUCT',
  TEST_CASES: 'TEST_CASES',
  AUTOMATION: 'AUTOMATION',
  EXECUTION: 'EXECUTION',
  FAILURE_ANALYSIS: 'FAILURE_ANALYSIS',
  REPORT: 'REPORT',
  GITHUB: 'GITHUB',
  DONE: 'DONE',
} as const;

export type ExecutionPhase = (typeof ExecutionPhase)[keyof typeof ExecutionPhase];

export const executionPhaseSchema = z.enum([
  'INIT',
  'REQUIREMENTS',
  'CLARIFICATION',
  'AUTHENTICATION',
  'DISCOVERY',
  'FUNCTIONAL',
  'UI_UX',
  'API',
  'ACCESSIBILITY',
  'PERFORMANCE',
  'SECURITY',
  'PRODUCT',
  'TEST_CASES',
  'AUTOMATION',
  'EXECUTION',
  'FAILURE_ANALYSIS',
  'REPORT',
  'GITHUB',
  'DONE',
]);
