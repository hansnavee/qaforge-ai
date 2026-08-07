import { Module } from '@nestjs/common';
import { OrgsModule } from '../orgs/orgs.module';
import { ProjectsCompatController } from './projects-compat.controller';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [OrgsModule],
  controllers: [ProjectsController, ProjectsCompatController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
