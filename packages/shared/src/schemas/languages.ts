import { z } from 'zod';

export const Language = {
  TYPESCRIPT: 'TYPESCRIPT',
  JAVA: 'JAVA',
  CSHARP: 'CSHARP',
} as const;

export type Language = (typeof Language)[keyof typeof Language];

export const languageSchema = z.enum(['TYPESCRIPT', 'JAVA', 'CSHARP']);
