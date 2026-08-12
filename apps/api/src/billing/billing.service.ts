import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { prisma } from '@qaforge/database';
import { Role, type PlanId } from '@qaforge/shared';
import Stripe from 'stripe';
import { AuditService } from '../common/audit.service';
import type { SessionUser } from '../auth/auth';
import { OrgsService } from '../orgs/orgs.service';
import { PlanUsageService } from './plan-usage.service';

function stripePriceForPlan(plan: PlanId): string | undefined {
  if (plan === 'PRO') return process.env.STRIPE_PRICE_PRO;
  if (plan === 'ENTERPRISE') return process.env.STRIPE_PRICE_ENTERPRISE;
  return undefined;
}

function planFromStripePrice(priceId: string | undefined): PlanId {
  if (!priceId) return 'FREE';
  if (priceId === process.env.STRIPE_PRICE_ENTERPRISE) return 'ENTERPRISE';
  if (priceId === process.env.STRIPE_PRICE_PRO) return 'PRO';
  return 'PRO';
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private stripe: Stripe | null = null;

  constructor(
    private readonly orgs: OrgsService,
    private readonly audit: AuditService,
    private readonly planUsage: PlanUsageService,
  ) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (key) {
      this.stripe = new Stripe(key);
    } else {
      this.logger.warn('STRIPE_SECRET_KEY not set; billing will use mock URLs');
    }
  }

  async checkout(
    user: SessionUser,
    orgId: string,
    targetPlan: Exclude<PlanId, 'FREE'> = 'PRO',
  ) {
    await this.orgs.requireMembership(user.id, orgId, Role.OWNER);

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      include: { subscription: true },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const priceId = stripePriceForPlan(targetPlan);

    if (targetPlan === 'ENTERPRISE' && !priceId) {
      return {
        url: `${appUrl}/app/billing?contact=enterprise`,
        mock: true,
        contactSales: true,
        plan: 'ENTERPRISE',
      };
    }

    if (!this.stripe || !priceId) {
      return {
        url: `${appUrl}/billing/mock-checkout?orgId=${orgId}&plan=${targetPlan}`,
        mock: true,
        plan: targetPlan,
      };
    }

    let customerId = org.subscription?.stripeCustomerId;
    if (!customerId) {
      const customer = await this.stripe.customers.create({
        email: user.email,
        name: org.name,
        metadata: { organizationId: orgId },
      });
      customerId = customer.id;
      await prisma.subscription.upsert({
        where: { organizationId: orgId },
        create: {
          organizationId: orgId,
          stripeCustomerId: customerId,
          plan: 'FREE',
          status: 'active',
        },
        update: { stripeCustomerId: customerId },
      });
    }

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/app/billing?success=1&plan=${targetPlan}`,
      cancel_url: `${appUrl}/app/billing?canceled=1`,
      metadata: { organizationId: orgId, targetPlan },
    });

    await this.audit.log({
      organizationId: orgId,
      userId: user.id,
      action: 'billing.checkout',
      resource: 'subscription',
      resourceId: org.subscription?.id,
      metadata: { targetPlan },
    });

    return { url: session.url, plan: targetPlan };
  }

  async portal(user: SessionUser, orgId: string) {
    await this.orgs.requireMembership(user.id, orgId, Role.OWNER);

    const sub = await prisma.subscription.findUnique({
      where: { organizationId: orgId },
    });
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    if (!this.stripe || !sub?.stripeCustomerId) {
      return {
        url: `${appUrl}/billing/mock-portal?orgId=${orgId}`,
        mock: true,
      };
    }

    const session = await this.stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${appUrl}/app/billing`,
    });
    return { url: session.url };
  }

  async getBilling(userId: string, orgId: string) {
    await this.orgs.requireMembership(userId, orgId, Role.VIEWER);
    const subscription = await prisma.subscription.findUnique({
      where: { organizationId: orgId },
    });
    if (!subscription) throw new NotFoundException('Subscription not found');

    const summary = await this.planUsage.getUsageSummary(orgId);

    return {
      subscription,
      plan: summary.plan,
      status: subscription.status,
      features: summary.features,
      limits: summary.limits,
      usage: summary.usage,
      projects: summary.projects,
      seats: summary.seats,
      upgradeUrl: '/app/billing',
    };
  }

  async handleWebhook(rawBody: Buffer, signature: string | undefined) {
    if (!this.stripe) {
      this.logger.warn('Stripe webhook received but Stripe not configured');
      return { received: true, mock: true };
    }

    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      throw new BadRequestException('STRIPE_WEBHOOK_SECRET not configured');
    }
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (err) {
      throw new BadRequestException(`Webhook signature verification failed: ${(err as Error).message}`);
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const orgId = session.metadata?.organizationId;
        const targetPlan = (session.metadata?.targetPlan ?? 'PRO') as PlanId;
        if (orgId) {
          await prisma.subscription.upsert({
            where: { organizationId: orgId },
            create: {
              organizationId: orgId,
              stripeCustomerId:
                typeof session.customer === 'string' ? session.customer : undefined,
              stripeSubId:
                typeof session.subscription === 'string'
                  ? session.subscription
                  : undefined,
              plan: targetPlan === 'ENTERPRISE' ? 'ENTERPRISE' : 'PRO',
              status: 'active',
            },
            update: {
              stripeCustomerId:
                typeof session.customer === 'string' ? session.customer : undefined,
              stripeSubId:
                typeof session.subscription === 'string'
                  ? session.subscription
                  : undefined,
              plan: targetPlan === 'ENTERPRISE' ? 'ENTERPRISE' : 'PRO',
              status: 'active',
            },
          });
          await this.audit.log({
            organizationId: orgId,
            action: 'billing.checkout.completed',
            resource: 'subscription',
            metadata: { sessionId: session.id, plan: targetPlan },
          });
        }
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const existing = await prisma.subscription.findFirst({
          where: { stripeSubId: sub.id },
        });
        if (existing) {
          const active = sub.status === 'active' || sub.status === 'trialing';
          const priceId = sub.items.data[0]?.price?.id;
          const plan = active ? planFromStripePrice(priceId) : 'FREE';
          await prisma.subscription.update({
            where: { id: existing.id },
            data: {
              status: sub.status,
              plan,
              currentPeriodEnd: new Date(
                ((sub as { current_period_end?: number }).current_period_end ?? 0) * 1000,
              ),
            },
          });
        }
        break;
      }
      default:
        this.logger.debug(`Unhandled Stripe event ${event.type}`);
    }

    return { received: true };
  }
}
