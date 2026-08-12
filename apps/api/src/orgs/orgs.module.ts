import { Module } from '@nestjs/common';
import { PlanModule } from '../billing/plan.module';
import { OrgsController } from './orgs.controller';
import { OrgsService } from './orgs.service';

@Module({
  imports: [PlanModule],
  controllers: [OrgsController],
  providers: [OrgsService],
  exports: [OrgsService],
})
export class OrgsModule {}
