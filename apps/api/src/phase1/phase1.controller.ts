import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/auth.decorator';
import { SessionAuthGuard } from '../auth/auth.guard';
import type { SessionUser } from '../auth/auth';
import { Phase1Service } from './phase1.service';

@Controller()
@UseGuards(SessionAuthGuard)
export class Phase1Controller {
  constructor(private readonly phase1: Phase1Service) {}

  @Post('orgs/:orgId/projects/:projectId/phase1/start')
  start(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.phase1.start(user, orgId, projectId);
  }

  @Post('projects/:projectId/phase1/start')
  startCompat(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
  ) {
    return this.phase1.startCompat(user, projectId);
  }

  @Patch('orgs/:orgId/projects/:projectId/requirements')
  updateRequirements(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    return this.phase1.updateRequirements(user, orgId, projectId, body);
  }

  @Patch('projects/:projectId/requirements')
  updateRequirementsCompat(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    return this.phase1.updateRequirementsCompat(user, projectId, body);
  }

  @Post('orgs/:orgId/projects/:projectId/clarify')
  clarify(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    return this.phase1.clarify(user, orgId, projectId, body);
  }

  @Post('projects/:projectId/clarify')
  clarifyCompat(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    return this.phase1.clarifyCompat(user, projectId, body);
  }

  @Get('orgs/:orgId/projects/:projectId/workspace')
  workspace(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.phase1.getWorkspace(user.id, orgId, projectId);
  }

  @Get('projects/:projectId/workspace')
  workspaceCompat(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
  ) {
    return this.phase1.getWorkspaceCompat(user.id, projectId);
  }

  @Get('orgs/:orgId/projects/:projectId/test-cases')
  testCases(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.phase1.listTestCases(user.id, orgId, projectId);
  }

  @Get('projects/:projectId/test-cases')
  testCasesCompat(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
  ) {
    return this.phase1.listTestCasesCompat(user.id, projectId);
  }

  @Get('orgs/:orgId/projects/:projectId/test-cases/download')
  async downloadTestCases(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Query('format') format: string | undefined,
    @Res() res: Response,
  ) {
    return this.phase1.downloadTestCases(
      user.id,
      orgId,
      projectId,
      format ?? 'csv',
      res,
    );
  }

  @Get('projects/:projectId/test-cases/download')
  async downloadTestCasesCompat(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
    @Query('format') format: string | undefined,
    @Res() res: Response,
  ) {
    return this.phase1.downloadTestCasesCompat(
      user.id,
      projectId,
      format ?? 'csv',
      res,
    );
  }

  @Get('orgs/:orgId/projects/:projectId/bugs')
  bugs(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.phase1.listBugs(user.id, orgId, projectId);
  }

  @Get('projects/:projectId/bugs')
  bugsCompat(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
  ) {
    return this.phase1.listBugsCompat(user.id, projectId);
  }

  @Get('orgs/:orgId/projects/:projectId/bugs/download')
  async downloadBugs(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Query('format') format: string | undefined,
    @Res() res: Response,
  ) {
    return this.phase1.downloadBugs(
      user.id,
      orgId,
      projectId,
      format ?? 'csv',
      res,
    );
  }

  @Get('projects/:projectId/bugs/download')
  async downloadBugsCompat(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
    @Query('format') format: string | undefined,
    @Res() res: Response,
  ) {
    return this.phase1.downloadBugsCompat(
      user.id,
      projectId,
      format ?? 'csv',
      res,
    );
  }

  @Get('orgs/:orgId/projects/:projectId/results')
  results(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.phase1.listResults(user.id, orgId, projectId);
  }

  @Get('projects/:projectId/results')
  resultsCompat(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
  ) {
    return this.phase1.listResultsCompat(user.id, projectId);
  }

  @Get('orgs/:orgId/projects/:projectId/results/download')
  async downloadResults(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Query('format') format: string | undefined,
    @Res() res: Response,
  ) {
    return this.phase1.downloadResults(
      user.id,
      orgId,
      projectId,
      format ?? 'csv',
      res,
    );
  }

  @Get('projects/:projectId/results/download')
  async downloadResultsCompat(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
    @Query('format') format: string | undefined,
    @Res() res: Response,
  ) {
    return this.phase1.downloadResultsCompat(
      user.id,
      projectId,
      format ?? 'csv',
      res,
    );
  }
}
