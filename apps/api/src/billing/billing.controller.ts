import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../auth/auth.decorator';
import { SessionAuthGuard } from '../auth/auth.guard';
import type { SessionUser } from '../auth/auth';
import { BillingService } from './billing.service';

@Controller()
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post('billing/checkout')
  @UseGuards(SessionAuthGuard)
  checkout(
    @CurrentUser() user: SessionUser,
    @Body() body: { orgId: string },
  ) {
    return this.billing.checkout(user, body.orgId);
  }

  @Post('billing/webhook')
  webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ) {
    const raw = req.rawBody ?? Buffer.from('');
    return this.billing.handleWebhook(raw, signature);
  }

  @Get('billing/portal')
  @UseGuards(SessionAuthGuard)
  portal(
    @CurrentUser() user: SessionUser,
    @Query('orgId') orgId: string,
  ) {
    return this.billing.portal(user, orgId);
  }

  @Get('orgs/:orgId/billing')
  @UseGuards(SessionAuthGuard)
  getBilling(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
  ) {
    return this.billing.getBilling(user.id, orgId);
  }
}
