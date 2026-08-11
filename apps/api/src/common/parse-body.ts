import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';

export function parseBody<S extends z.ZodTypeAny>(
  schema: S,
  body: unknown,
): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new BadRequestException({
      message: 'Validation failed',
      issues: result.error.flatten(),
    });
  }
  return result.data;
}
