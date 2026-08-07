import { z } from 'zod';

export const Role = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MEMBER: 'MEMBER',
  VIEWER: 'VIEWER',
} as const;

export type Role = (typeof Role)[keyof typeof Role];

export const roleSchema = z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']);
