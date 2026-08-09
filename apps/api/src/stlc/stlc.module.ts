import { Module } from '@nestjs/common';
import { OrgsModule } from '../orgs/orgs.module';
import { ExecutionsModule } from '../executions/executions.module';
import { ProjectsModule } from '../projects/projects.module';
import { StlcController } from './stlc.controller';
import { StlcService } from './stlc.service';

@Module({
  imports: [OrgsModule, ExecutionsModule, ProjectsModule],
  controllers: [StlcController],
  providers: [StlcService],
  exports: [StlcService],
})
export class StlcModule {}
