import { BadRequestException } from '@nestjs/common';
import type { ZodSchema } from 'zod';

export function parseBody<T>(schema: ZodSchema<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new BadRequestException({
      message: 'Validation failed',
      issues: result.error.flatten(),
    });
  }
  return result.data;
}
