import { Module } from '@nestjs/common';
import { PlanModule } from '../billing/plan.module';
import { OrgsModule } from '../orgs/orgs.module';
import { QueueModule } from '../queue/queue.module';
import { CommonModule } from '../common/common.module';
import { RunnersModule } from '../runners/runners.module';
import { Phase1Controller } from './phase1.controller';
import { Phase1Service } from './phase1.service';
import { AiGenerateCasesService } from './ai-generate-cases.service';

@Module({
  imports: [OrgsModule, QueueModule, CommonModule, RunnersModule, PlanModule],
  controllers: [Phase1Controller],
  providers: [Phase1Service, AiGenerateCasesService],
  exports: [Phase1Service],
})
export class Phase1Module {}
