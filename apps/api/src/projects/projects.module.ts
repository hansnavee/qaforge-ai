import { Module } from '@nestjs/common';
import { OrgsModule } from '../orgs/orgs.module';
import { ProjectsCompatController } from './projects-compat.controller';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { RequirementExtractionService } from './requirement-extraction.service';

@Module({
  imports: [OrgsModule],
  controllers: [ProjectsController, ProjectsCompatController],
  providers: [ProjectsService, RequirementExtractionService],
  exports: [ProjectsService, RequirementExtractionService],
})
export class ProjectsModule {}
