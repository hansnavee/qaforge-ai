import { Module } from '@nestjs/common';
import { OrgsModule } from '../orgs/orgs.module';
import { RunnerAuthGuard } from './runner-auth.guard';
import { RunnerJobsController } from './runner-jobs.controller';
import { RunnersController } from './runners.controller';
import { RunnersService } from './runners.service';

@Module({
  imports: [OrgsModule],
  controllers: [RunnersController, RunnerJobsController],
  providers: [RunnersService, RunnerAuthGuard],
  exports: [RunnersService],
})
export class RunnersModule {}
