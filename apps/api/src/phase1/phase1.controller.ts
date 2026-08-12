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
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.phase1.listTestCases(
      user.id,
      orgId,
      projectId,
      includeArchived === '1' || includeArchived === 'true',
    );
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

  @Post('orgs/:orgId/projects/:projectId/test-cases/generate')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 },
    }),
  )
  generateTestCases(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.phase1.generateTestCases(
      user.id,
      orgId,
      projectId,
      body,
      file,
    );
  }

  @Post('orgs/:orgId/projects/:projectId/test-cases/bulk-create')
  bulkCreateTestCases(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    return this.phase1.bulkCreateTestCases(user.id, orgId, projectId, body);
  }

  @Post('orgs/:orgId/projects/:projectId/test-cases/generate-apply')
  generateApply(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    return this.phase1.generateApply(user.id, orgId, projectId, body);
  }

  @Get('orgs/:orgId/projects/:projectId/ai-prompts')
  listAiPrompts(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.phase1.listAiPrompts(user.id, orgId, projectId);
  }

  @Post('orgs/:orgId/projects/:projectId/ai-prompts')
  createAiPrompt(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    return this.phase1.createAiPrompt(user.id, orgId, projectId, body);
  }

  @Delete('orgs/:orgId/projects/:projectId/ai-prompts')
  clearAiPrompts(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.phase1.clearAiPrompts(user.id, orgId, projectId);
  }

  @Delete('orgs/:orgId/projects/:projectId/ai-prompts/:promptId')
  deleteAiPrompt(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('promptId') promptId: string,
  ) {
    return this.phase1.deleteAiPrompt(user.id, orgId, projectId, promptId);
  }

  @Post('orgs/:orgId/projects/:projectId/test-cases/import')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 },
    }),
  )
  importTestCases(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.phase1.importTestCases(
      user.id,
      orgId,
      projectId,
      body,
      file,
    );
  }

  @Post('orgs/:orgId/projects/:projectId/test-cases/status')
  setCaseStatus(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    return this.phase1.setCaseStatus(user.id, orgId, projectId, body);
  }

  @Patch('orgs/:orgId/projects/:projectId/test-cases/bulk')
  bulkUpdateTestCases(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    return this.phase1.bulkUpdateTestCases(user.id, orgId, projectId, body);
  }

  @Delete('orgs/:orgId/projects/:projectId/test-cases/bulk')
  bulkDeleteTestCases(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    return this.phase1.bulkDeleteTestCases(user.id, orgId, projectId, body);
  }

  @Post('orgs/:orgId/projects/:projectId/test-cases/restore')
  bulkRestoreTestCases(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    return this.phase1.bulkRestoreTestCases(user.id, orgId, projectId, body);
  }

  @Post('orgs/:orgId/projects/:projectId/test-cases/:testCaseId/duplicate')
  duplicateTestCase(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('testCaseId') testCaseId: string,
  ) {
    return this.phase1.duplicateTestCase(
      user.id,
      orgId,
      projectId,
      testCaseId,
    );
  }

  @Post('orgs/:orgId/projects/:projectId/feature-groups')
  createFeatureFolder(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    return this.phase1.createFeatureFolder(user.id, orgId, projectId, body);
  }

  @Get('orgs/:orgId/case-fields')
  listOrgCaseFields(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
  ) {
    return this.phase1.listOrgCaseFields(user.id, orgId);
  }

  @Post('orgs/:orgId/case-fields')
  createOrgCaseField(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Body() body: unknown,
  ) {
    return this.phase1.createOrgCaseField(user.id, orgId, body);
  }

  @Patch('orgs/:orgId/case-fields/:fieldId')
  updateOrgCaseField(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('fieldId') fieldId: string,
    @Body() body: unknown,
  ) {
    return this.phase1.updateOrgCaseField(user.id, orgId, fieldId, body);
  }

  @Delete('orgs/:orgId/case-fields/:fieldId')
  deleteOrgCaseField(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('fieldId') fieldId: string,
  ) {
    return this.phase1.deleteOrgCaseField(user.id, orgId, fieldId);
  }

  @Get('orgs/:orgId/projects/:projectId/tcms/case-fields')
  listCaseFields(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.phase1.listCaseFields(user.id, orgId, projectId);
  }

  @Get('orgs/:orgId/projects/:projectId/tcms/case-templates')
  listCaseTemplates(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.phase1.listCaseTemplates(user.id, orgId, projectId);
  }

  @Post('orgs/:orgId/projects/:projectId/tcms/case-templates')
  createCaseTemplate(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    return this.phase1.createCaseTemplate(user.id, orgId, projectId, body);
  }

  @Patch('orgs/:orgId/projects/:projectId/tcms/case-templates/:templateId')
  updateCaseTemplate(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('templateId') templateId: string,
    @Body() body: unknown,
  ) {
    return this.phase1.updateCaseTemplate(
      user.id,
      orgId,
      projectId,
      templateId,
      body,
    );
  }

  @Delete('orgs/:orgId/projects/:projectId/tcms/case-templates/:templateId')
  deleteCaseTemplate(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('templateId') templateId: string,
  ) {
    return this.phase1.deleteCaseTemplate(
      user.id,
      orgId,
      projectId,
      templateId,
    );
  }

  @Get('orgs/:orgId/projects/:projectId/tcms/folders')
  listTcmsFolders(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.phase1.listTcmsFolders(user.id, orgId, projectId);
  }

  @Post('orgs/:orgId/projects/:projectId/tcms/folders')
  createTcmsFolder(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    return this.phase1.createTcmsFolder(user.id, orgId, projectId, body);
  }

  @Patch('orgs/:orgId/projects/:projectId/tcms/folders/:folderId')
  updateTcmsFolder(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('folderId') folderId: string,
    @Body() body: unknown,
  ) {
    return this.phase1.updateTcmsFolder(
      user.id,
      orgId,
      projectId,
      folderId,
      body,
    );
  }

  @Delete('orgs/:orgId/projects/:projectId/tcms/folders/:folderId')
  deleteTcmsFolder(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('folderId') folderId: string,
    @Body() body: unknown,
  ) {
    return this.phase1.deleteTcmsFolder(
      user.id,
      orgId,
      projectId,
      folderId,
      body,
    );
  }

  @Get('orgs/:orgId/projects/:projectId/tcms/tcr')
  downloadTcmsTcr(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Query('format') format: string,
    @Res() res: Response,
  ) {
    return this.phase1.downloadTcmsTcr(
      user.id,
      orgId,
      projectId,
      format,
      res,
    );
  }

  @Post('orgs/:orgId/projects/:projectId/tcms/runs/propose')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 },
    }),
  )
  proposeTcmsRun(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.phase1.proposeTcmsRun(
      user.id,
      orgId,
      projectId,
      body,
      file,
    );
  }

  @Post('orgs/:orgId/projects/:projectId/tcms/runs')
  createTcmsRun(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    return this.phase1.createTcmsRun(user.id, orgId, projectId, body);
  }

  @Get('orgs/:orgId/projects/:projectId/tcms/runs')
  listTcmsRuns(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.phase1.listTcmsRuns(
      user.id,
      orgId,
      projectId,
      includeArchived === '1' || includeArchived === 'true',
    );
  }

  @Get('orgs/:orgId/projects/:projectId/tcms/runs/:executionId')
  getTcmsRun(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('executionId') executionId: string,
  ) {
    return this.phase1.getTcmsRun(user.id, orgId, projectId, executionId);
  }

  @Post('orgs/:orgId/projects/:projectId/tcms/runs/:executionId/start')
  startTcmsRun(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('executionId') executionId: string,
  ) {
    return this.phase1.startTcmsRun(user.id, orgId, projectId, executionId);
  }

  @Post('orgs/:orgId/projects/:projectId/tcms/runs/:executionId/ai-execute')
  aiExecuteTcmsRun(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('executionId') executionId: string,
    @Body() body: unknown,
  ) {
    return this.phase1.aiExecuteTcmsRun(
      user.id,
      orgId,
      projectId,
      executionId,
      body,
    );
  }

  @Post('orgs/:orgId/projects/:projectId/tcms/runs/:executionId/pause')
  pauseTcmsRun(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('executionId') executionId: string,
  ) {
    return this.phase1.pauseTcmsRun(user.id, orgId, projectId, executionId);
  }

  @Post('orgs/:orgId/projects/:projectId/tcms/runs/:executionId/resume')
  resumeTcmsRun(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('executionId') executionId: string,
  ) {
    return this.phase1.resumeTcmsRun(user.id, orgId, projectId, executionId);
  }

  @Post('orgs/:orgId/projects/:projectId/tcms/runs/:executionId/stop')
  stopTcmsRun(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('executionId') executionId: string,
  ) {
    return this.phase1.stopTcmsRun(user.id, orgId, projectId, executionId);
  }

  @Post('orgs/:orgId/projects/:projectId/tcms/runs/:executionId/complete')
  completeTcmsRun(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('executionId') executionId: string,
  ) {
    return this.phase1.completeTcmsRun(user.id, orgId, projectId, executionId);
  }

  @Patch('orgs/:orgId/projects/:projectId/tcms/runs/:executionId')
  updateTcmsRun(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('executionId') executionId: string,
    @Body() body: unknown,
  ) {
    return this.phase1.updateTcmsRun(
      user.id,
      orgId,
      projectId,
      executionId,
      body,
    );
  }

  @Delete('orgs/:orgId/projects/:projectId/tcms/runs/:executionId')
  deleteTcmsRun(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('executionId') executionId: string,
    @Query('permanent') permanent?: string,
  ) {
    return this.phase1.deleteTcmsRun(
      user.id,
      orgId,
      projectId,
      executionId,
      permanent === '1' || permanent === 'true',
    );
  }

  @Post('orgs/:orgId/projects/:projectId/tcms/runs/:executionId/restore')
  restoreTcmsRun(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('executionId') executionId: string,
  ) {
    return this.phase1.restoreTcmsRun(user.id, orgId, projectId, executionId);
  }

  @Get('orgs/:orgId/projects/:projectId/tcms/runs/:executionId/tcr')
  downloadTcmsRunTcr(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('executionId') executionId: string,
    @Query('format') format: string,
    @Res() res: Response,
  ) {
    return this.phase1.downloadTcmsTcr(
      user.id,
      orgId,
      projectId,
      format,
      res,
      executionId,
    );
  }

  @Post('orgs/:orgId/projects/:projectId/results')
  upsertTestResult(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    return this.phase1.upsertTestResult(user.id, orgId, projectId, body);
  }

  @Patch('orgs/:orgId/projects/:projectId/results/:resultId')
  patchTestResult(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('resultId') resultId: string,
    @Body() body: unknown,
  ) {
    return this.phase1.patchTestResult(
      user.id,
      orgId,
      projectId,
      resultId,
      body,
    );
  }

  @Post('orgs/:orgId/projects/:projectId/results/:resultId/screenshot')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 8 * 1024 * 1024 },
    }),
  )
  attachResultScreenshot(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('resultId') resultId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.phase1.attachResultScreenshot(
      user.id,
      orgId,
      projectId,
      resultId,
      file,
    );
  }

  @Post('orgs/:orgId/projects/:projectId/results/:resultId/evidence')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  attachResultEvidence(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('resultId') resultId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.phase1.attachResultEvidence(
      user.id,
      orgId,
      projectId,
      resultId,
      file,
    );
  }

  @Get('orgs/:orgId/projects/:projectId/tcms/automation/scripts')
  listAutomatedScripts(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.phase1.listAutomatedScripts(user.id, orgId, projectId);
  }

  @Get('orgs/:orgId/projects/:projectId/tcms/automation/heals')
  listAutomationHeals(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.phase1.listAutomationHeals(user.id, orgId, projectId);
  }

  @Post('orgs/:orgId/projects/:projectId/tcms/automation/heals/:healId/approve')
  approveHeal(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('healId') healId: string,
  ) {
    return this.phase1.decideHeal(user.id, orgId, projectId, healId, 'approve');
  }

  @Post('orgs/:orgId/projects/:projectId/tcms/automation/heals/:healId/reject')
  rejectHeal(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('healId') healId: string,
  ) {
    return this.phase1.decideHeal(user.id, orgId, projectId, healId, 'reject');
  }

  @Post('orgs/:orgId/projects/:projectId/tcms/automation/scripts/:testCaseId/clear-quarantine')
  clearQuarantine(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('testCaseId') testCaseId: string,
  ) {
    return this.phase1.clearQuarantine(user.id, orgId, projectId, testCaseId);
  }

  @Post('orgs/:orgId/projects/:projectId/tcms/automation/scripts/:testCaseId/rerecord')
  rerecordScript(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('testCaseId') testCaseId: string,
  ) {
    return this.phase1.rerecordScript(user.id, orgId, projectId, testCaseId);
  }

  @Post('orgs/:orgId/projects/:projectId/tcms/automation/scripts/execute')
  executeAutomatedScripts(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    return this.phase1.executeAutomatedScripts(
      user.id,
      orgId,
      projectId,
      body,
    );
  }

  @Post('orgs/:orgId/projects/:projectId/tcms/automation/pause')
  pauseProjectAutomation(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.phase1.pauseProjectAutomation(user.id, orgId, projectId);
  }

  @Post('orgs/:orgId/projects/:projectId/tcms/automation/stop')
  stopProjectAutomation(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.phase1.stopProjectAutomation(user.id, orgId, projectId);
  }

  @Get('orgs/:orgId/projects/:projectId/tcms/automation/reports')
  listAutomationReports(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.phase1.listAutomationReports(user.id, orgId, projectId);
  }

  @Get('orgs/:orgId/projects/:projectId/tcms/automation/reports/:reportId/html')
  downloadAutomationReportHtml(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('reportId') reportId: string,
    @Query('download') download: string,
    @Res() res: Response,
  ) {
    return this.phase1.downloadAutomationReport(
      user.id,
      orgId,
      projectId,
      reportId,
      'html',
      res,
      download === '1' || download === 'true' ? 'attachment' : 'inline',
    );
  }

  @Get('orgs/:orgId/projects/:projectId/tcms/automation/reports/:reportId/zip')
  downloadAutomationReportZip(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('reportId') reportId: string,
    @Res() res: Response,
  ) {
    return this.phase1.downloadAutomationReport(
      user.id,
      orgId,
      projectId,
      reportId,
      'zip',
      res,
      'attachment',
    );
  }

  @Get('orgs/:orgId/projects/:projectId/tcms/automation')
  listTcmsAutomation(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.phase1.listTcmsAutomation(user.id, orgId, projectId);
  }

  @Post('orgs/:orgId/projects/:projectId/tcms/automation')
  saveAutomationStack(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    return this.phase1.saveAutomationStack(user.id, orgId, projectId, body);
  }

  @Get('orgs/:orgId/projects/:projectId/tcms/automation/download')
  downloadAutomationPack(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Res() res: Response,
  ) {
    return this.phase1.downloadAutomationPack(user.id, orgId, projectId, res);
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

  @Post('orgs/:orgId/projects/:projectId/test-cases/ready')
  markCasesReady(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    return this.phase1.markCasesReady(user.id, orgId, projectId, body);
  }

  @Get('orgs/:orgId/projects/:projectId/execution-preview')
  previewExecution(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Query('runKind') runKind?: string,
    @Query('featureKey') featureKey?: string,
  ) {
    return this.phase1.previewExecution(user.id, orgId, projectId, {
      runKind,
      featureKey,
    });
  }

  @Delete('orgs/:orgId/projects/:projectId/test-cases/:testCaseId')
  deleteTestCase(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('testCaseId') testCaseId: string,
    @Query('permanent') permanent?: string,
  ) {
    return this.phase1.deleteTestCase(
      user.id,
      orgId,
      projectId,
      testCaseId,
      permanent === '1' || permanent === 'true',
    );
  }

  @Post('orgs/:orgId/projects/:projectId/test-cases/:testCaseId/restore')
  restoreTestCase(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('testCaseId') testCaseId: string,
  ) {
    return this.phase1.restoreTestCase(user.id, orgId, projectId, testCaseId);
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
      orderBy: { createdAt: 'asc' },
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
      orderBy: { createdAt: 'asc' },
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
