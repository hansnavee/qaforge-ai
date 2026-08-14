import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';

function formatZodIssues(error: z.ZodError): string {
  const { fieldErrors, formErrors } = error.flatten();
  const fields = Object.entries(fieldErrors).flatMap(([key, msgs]) =>
    (msgs ?? []).map((msg) => `${key}: ${msg}`),
  );
  const parts = [...formErrors, ...fields].filter(Boolean);
  return parts.join('; ') || 'Validation failed';
}

export function parseBody<S extends z.ZodTypeAny>(
  schema: S,
  body: unknown,
): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new BadRequestException({
      message: formatZodIssues(result.error),
      issues: result.error.flatten(),
    });
  }
  return result.data;
}
