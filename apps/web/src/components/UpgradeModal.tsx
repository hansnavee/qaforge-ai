'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import type { PlanLimitErrorBody } from '@/lib/plan';
import { planLimitMessage } from '@/lib/plan';

export function UpgradeModal({
  open,
  error,
  onClose,
}: {
  open: boolean;
  error: PlanLimitErrorBody | null;
  onClose: () => void;
}) {
  if (!open || !error) return null;

  return (
    <Modal
      open={open}
      title="Upgrade required"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Not now
          </Button>
          <Link href={error.upgradeUrl ?? '/app/billing'}>
            <Button>View plans</Button>
          </Link>
        </>
      }
    >
      <p className="text-sm text-muted">{planLimitMessage(error)}</p>
      {error.plan === 'FREE' ? (
        <p className="mt-3 text-sm">
          Pro unlocks unlimited script replay, rule-based healing, cloud runner,
          and higher AI limits.
        </p>
      ) : null}
    </Modal>
  );
}

export function ProFeatureNotice({
  feature,
  children,
}: {
  feature: string;
  children?: ReactNode;
}) {
  return (
    <p className="rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-muted">
      <span className="font-medium text-fg">{feature}</span> is available on{' '}
      <Link href="/app/billing" className="text-accent underline">
        Pro
      </Link>
      . {children}
    </p>
  );
}
