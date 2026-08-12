import { Module } from '@nestjs/common';
import { PlanModule } from '../billing/plan.module';
import { OrgsModule } from '../orgs/orgs.module';
import { ExecutionsController } from './executions.controller';
import { ExecutionsGateway } from './executions.gateway';
import { ExecutionsService } from './executions.service';

@Module({
  imports: [OrgsModule, PlanModule],
  controllers: [ExecutionsController],
  providers: [ExecutionsService, ExecutionsGateway],
  exports: [ExecutionsService],
})
export class ExecutionsModule {}
