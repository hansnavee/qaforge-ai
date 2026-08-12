import { Module } from '@nestjs/common';
import { PlanModule } from '../billing/plan.module';
import { CommonModule } from '../common/common.module';
import { OrgsModule } from '../orgs/orgs.module';
import { ProjectsCompatController } from './projects-compat.controller';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { RequirementExtractionService } from './requirement-extraction.service';
import { RequirementReviewService } from './requirement-review.service';

@Module({
  imports: [OrgsModule, CommonModule, PlanModule],
  controllers: [ProjectsController, ProjectsCompatController],
  providers: [
    ProjectsService,
    RequirementExtractionService,
    RequirementReviewService,
  ],
  exports: [
    ProjectsService,
    RequirementExtractionService,
    RequirementReviewService,
  ],
})
export class ProjectsModule {}
