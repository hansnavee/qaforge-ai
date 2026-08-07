import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorator';
import { SessionAuthGuard } from '../auth/auth.guard';
import type { SessionUser } from '../auth/auth';
import { ProjectsService } from './projects.service';

@Controller('orgs/:orgId/projects')
@UseGuards(SessionAuthGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post()
  create(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Body() body: unknown,
  ) {
    return this.projects.create(user, orgId, body);
  }

  @Get()
  list(@CurrentUser() user: SessionUser, @Param('orgId') orgId: string) {
    return this.projects.list(user.id, orgId);
  }

  @Get(':projectId')
  get(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.projects.get(user.id, orgId, projectId);
  }

  @Patch(':projectId')
  update(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    return this.projects.update(user, orgId, projectId, body);
  }

  @Delete(':projectId')
  remove(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.projects.softDelete(user, orgId, projectId);
  }
}
