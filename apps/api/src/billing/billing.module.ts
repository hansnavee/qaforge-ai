import { Module } from '@nestjs/common';
import { OrgsModule } from '../orgs/orgs.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';

@Module({
  imports: [OrgsModule],
  controllers: [BillingController],
  providers: [BillingService],
})
export class BillingModule {}
