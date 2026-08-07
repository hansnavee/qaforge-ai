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
import { OrgsService } from '../orgs/orgs.service';
import { ProjectsService } from './projects.service';

/**
 * Flat /projects routes for the web client (resolves the user's default org).
 * Prefer org-scoped /orgs/:orgId/projects when the org is known.
 */
@Controller('projects')
@UseGuards(SessionAuthGuard)
export class ProjectsCompatController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly orgs: OrgsService,
  ) {}

  private async defaultOrgId(userId: string) {
    return this.orgs.getDefaultOrgId(userId);
  }

  @Post()
  async create(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    const orgId = await this.defaultOrgId(user.id);
    return this.projects.create(user, orgId, body);
  }

  @Get()
  async list(@CurrentUser() user: SessionUser) {
    const orgId = await this.defaultOrgId(user.id);
    return this.projects.list(user.id, orgId);
  }

  @Get(':projectId')
  async get(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
  ) {
    const orgId = await this.defaultOrgId(user.id);
    return this.projects.get(user.id, orgId, projectId);
  }

  @Patch(':projectId')
  async update(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    const orgId = await this.defaultOrgId(user.id);
    return this.projects.update(user, orgId, projectId, body);
  }

  @Delete(':projectId')
  async remove(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
  ) {
    const orgId = await this.defaultOrgId(user.id);
    return this.projects.softDelete(user, orgId, projectId);
  }
}
