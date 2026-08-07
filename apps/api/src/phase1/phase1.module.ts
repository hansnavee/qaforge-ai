import { Module } from '@nestjs/common';
import { OrgsModule } from '../orgs/orgs.module';
import { QueueModule } from '../queue/queue.module';
import { CommonModule } from '../common/common.module';
import { Phase1Controller } from './phase1.controller';
import { Phase1Service } from './phase1.service';

@Module({
  imports: [OrgsModule, QueueModule, CommonModule],
  controllers: [Phase1Controller],
  providers: [Phase1Service],
  exports: [Phase1Service],
})
export class Phase1Module {}
