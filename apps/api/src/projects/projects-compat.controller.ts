import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../auth/auth.decorator';
import { SessionAuthGuard } from '../auth/auth.guard';
import type { SessionUser } from '../auth/auth';
import { OrgsService } from '../orgs/orgs.service';
import { ProjectsService } from './projects.service';
import { RequirementExtractionService } from './requirement-extraction.service';

const fileUpload = FileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

/**
 * Flat /projects routes for the web client (resolves the user's default org).
 * Prefer org-scoped /orgs/:orgId/projects when the org is known.
 */
@Controller('projects')
@UseGuards(SessionAuthGuard)
export class ProjectsCompatController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly extraction: RequirementExtractionService,
    private readonly orgs: OrgsService,
  ) {}

  private async defaultOrgId(userId: string) {
    return this.orgs.getDefaultOrgId(userId);
  }

  @Post()
  @UseInterceptors(fileUpload)
  async create(
    @CurrentUser() user: SessionUser,
    @Body() body: Record<string, unknown>,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const orgId = await this.defaultOrgId(user.id);
    if (file) {
      return this.projects.createWithUpload(
        user,
        orgId,
        {
          name: typeof body.name === 'string' ? body.name : undefined,
          appUrl: typeof body.appUrl === 'string' ? body.appUrl : undefined,
        },
        file,
      );
    }
    return this.projects.create(user, orgId, body);
  }

  @Get()
  async list(@CurrentUser() user: SessionUser) {
    const orgId = await this.defaultOrgId(user.id);
    return this.projects.list(user.id, orgId);
  }

  @Get(':projectId/requirements')
  async listRequirements(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
  ) {
    const orgId = await this.defaultOrgId(user.id);
    return this.projects.listRequirements(user.id, orgId, projectId);
  }

  @Post(':projectId/requirements')
  @UseInterceptors(fileUpload)
  async addRequirement(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const orgId = await this.defaultOrgId(user.id);
    return this.projects.addRequirement(user, orgId, projectId, {
      file,
      body,
    });
  }

  @Post(':projectId/extract-requirements')
  async extractRequirements(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
  ) {
    const orgId = await this.defaultOrgId(user.id);
    return this.extraction.extract(user, orgId, projectId);
  }

  @Get(':projectId/extracted-requirements')
  async listExtracted(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
  ) {
    const orgId = await this.defaultOrgId(user.id);
    return this.extraction.list(user.id, orgId, projectId);
  }

  @Get(':projectId/extracted-requirements/:requirementKey')
  async getExtracted(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
    @Param('requirementKey') requirementKey: string,
  ) {
    const orgId = await this.defaultOrgId(user.id);
    return this.extraction.getByKey(
      user.id,
      orgId,
      projectId,
      requirementKey,
    );
  }

  @Get(':projectId/extraction-debug')
  async extractionDebug(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
  ) {
    const orgId = await this.defaultOrgId(user.id);
    return this.extraction.getExtractionDebug(user.id, orgId, projectId);
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
