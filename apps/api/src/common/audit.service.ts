import { Injectable } from '@nestjs/common';
import { prisma } from '@qaforge/database';
import { redactSecrets } from './redaction';

export type AuditInput = {
  organizationId?: string | null;
  userId?: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown> | null;
};

@Injectable()
export class AuditService {
  async log(input: AuditInput) {
    return prisma.auditLog.create({
      data: {
        organizationId: input.organizationId ?? null,
        userId: input.userId ?? null,
        action: input.action,
        resource: input.resource,
        resourceId: input.resourceId ?? null,
        metadata: input.metadata
          ? (redactSecrets(input.metadata) as object)
          : undefined,
      },
    });
  }
}
