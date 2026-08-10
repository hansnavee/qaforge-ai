import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
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

  @Post('orgs/:orgId/projects/:projectId/stlc/start')
  startStlc(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.phase1.start(user, orgId, projectId);
  }

  @Post('projects/:projectId/stlc/start')
  startStlcCompat(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
  ) {
    return this.phase1.startCompat(user, projectId);
  }

  @Post('orgs/:orgId/projects/:projectId/requirements/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 },
    }),
  )
  uploadRequirement(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.phase1.uploadRequirement(user, orgId, projectId, file);
  }

  @Post('projects/:projectId/requirements/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 },
    }),
  )
  uploadRequirementCompat(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.phase1.uploadRequirementCompat(user, projectId, file);
  }

  @Get('orgs/:orgId/projects/:projectId/requirements/documents')
  listDocuments(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.phase1.listRequirementDocuments(user.id, orgId, projectId);
  }

  @Get('projects/:projectId/requirements/documents')
  listDocumentsCompat(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
  ) {
    return this.phase1.listRequirementDocumentsCompat(user.id, projectId);
  }

  @Get('orgs/:orgId/projects/:projectId/stlc/final-pack')
  downloadFinalPack(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Res() res: Response,
  ) {
    return this.phase1.downloadFinalPack(user.id, orgId, projectId, res);
  }

  @Get('projects/:projectId/stlc/final-pack')
  downloadFinalPackCompat(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
    @Res() res: Response,
  ) {
    return this.phase1.downloadFinalPackCompat(user.id, projectId, res);
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

  @Post('orgs/:orgId/projects/:projectId/test-cases')
  createTestCase(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    return this.phase1.createTestCase(user.id, orgId, projectId, body);
  }

  @Patch('orgs/:orgId/projects/:projectId/test-cases/:testCaseId')
  updateTestCase(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('testCaseId') testCaseId: string,
    @Body() body: unknown,
  ) {
    return this.phase1.updateTestCase(
      user.id,
      orgId,
      projectId,
      testCaseId,
      body,
    );
  }

  @Delete('orgs/:orgId/projects/:projectId/test-cases/:testCaseId')
  deleteTestCase(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('testCaseId') testCaseId: string,
  ) {
    return this.phase1.deleteTestCase(user.id, orgId, projectId, testCaseId);
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

  @Get('orgs/:orgId/automation')
  listAutomationOrg(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
  ) {
    return this.phase1.listAutomationForOrg(user.id, orgId);
  }

  @Get('automation')
  async listAutomationCompat(@CurrentUser() user: SessionUser) {
    const { prisma } = await import('@qaforge/database');
    const m = await prisma.membership.findFirst({
      where: { userId: user.id },
      select: { organizationId: true },
    });
    if (!m) return { items: [] };
    return this.phase1.listAutomationForOrg(user.id, m.organizationId);
  }

  @Get('orgs/:orgId/projects/:projectId/automation')
  listAutomationProject(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.phase1.listAutomationForProject(user.id, orgId, projectId);
  }

  @Get('orgs/:orgId/reports')
  listReports(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
  ) {
    return this.phase1.listReports(user.id, orgId);
  }

  @Get('reports')
  async listReportsCompat(@CurrentUser() user: SessionUser) {
    const { prisma } = await import('@qaforge/database');
    const m = await prisma.membership.findFirst({
      where: { userId: user.id },
      select: { organizationId: true },
    });
    if (!m) return [];
    return this.phase1.listReports(user.id, m.organizationId);
  }

  @Get('orgs/:orgId/reports/:executionId')
  getReport(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('executionId') executionId: string,
  ) {
    return this.phase1.getReport(user.id, orgId, executionId);
  }

  @Get('reports/:executionId')
  async getReportCompat(
    @CurrentUser() user: SessionUser,
    @Param('executionId') executionId: string,
  ) {
    const { prisma } = await import('@qaforge/database');
    const ex = await prisma.execution.findUnique({
      where: { id: executionId },
      select: { project: { select: { organizationId: true } } },
    });
    if (!ex) return null;
    return this.phase1.getReport(
      user.id,
      ex.project.organizationId,
      executionId,
    );
  }
}
