import { Module } from '@nestjs/common';
import { OrgsModule } from '../orgs/orgs.module';
import { ExecutionsController } from './executions.controller';
import { ExecutionsGateway } from './executions.gateway';
import { ExecutionsService } from './executions.service';

@Module({
  imports: [OrgsModule],
  controllers: [ExecutionsController],
  providers: [ExecutionsService, ExecutionsGateway],
  exports: [ExecutionsService],
})
export class ExecutionsModule {}
