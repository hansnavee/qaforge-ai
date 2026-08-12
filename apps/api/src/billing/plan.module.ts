import { Module } from '@nestjs/common';
import { PlanUsageService } from './plan-usage.service';

@Module({
  providers: [PlanUsageService],
  exports: [PlanUsageService],
})
export class PlanModule {}
