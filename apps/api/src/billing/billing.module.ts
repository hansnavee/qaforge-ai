import { Module } from '@nestjs/common';
import { OrgsModule } from '../orgs/orgs.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PlanModule } from './plan.module';

@Module({
  imports: [OrgsModule, PlanModule],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService, PlanModule],
})
export class BillingModule {}
