import {
  BadRequestException,
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
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { CurrentUser } from '../auth/auth.decorator';
import { SessionAuthGuard } from '../auth/auth.guard';
import type { SessionUser } from '../auth/auth';
import { ProjectsService } from './projects.service';
import { RequirementExtractionService } from './requirement-extraction.service';
import { RequirementReviewService } from './requirement-review.service';
import {
  answerReviewQuestionSchema,
  createManualRequirementSchema,
  updateManualRequirementSchema,
} from '@qaforge/shared';

const fileUpload = FileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

@Controller('orgs/:orgId/projects')
@UseGuards(SessionAuthGuard)
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly extraction: RequirementExtractionService,
    private readonly review: RequirementReviewService,
  ) {}

  @Post()
  @UseInterceptors(fileUpload)
  create(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Body() body: Record<string, unknown>,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (file) {
      return this.projects.createWithUpload(
        user,
        orgId,
        {
          name: typeof body.name === 'string' ? body.name : undefined,
          appUrl: typeof body.appUrl === 'string' ? body.appUrl : undefined,
          description:
            typeof body.description === 'string' ? body.description : undefined,
        },
        file,
      );
    }
    return this.projects.create(user, orgId, body);
  }

  @Get()
  list(@CurrentUser() user: SessionUser, @Param('orgId') orgId: string) {
    return this.projects.list(user.id, orgId);
  }

  @Get(':projectId/requirements')
  listRequirements(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.projects.listRequirements(user.id, orgId, projectId);
  }

  @Post(':projectId/requirements')
  @UseInterceptors(fileUpload)
  addRequirement(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.projects.addRequirement(user, orgId, projectId, {
      file,
      body,
    });
  }

  @Post(':projectId/extract-requirements')
  extractRequirements(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.extraction.extract(user, orgId, projectId);
  }

  @Post(':projectId/extracted-requirements')
  createExtractedRequirement(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    createManualRequirementSchema.parse(body);
    return this.extraction.createManual(user, orgId, projectId, body);
  }

  @Patch(':projectId/extracted-requirements/:requirementKey')
  updateExtractedRequirement(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('requirementKey') requirementKey: string,
    @Body() body: unknown,
  ) {
    updateManualRequirementSchema.parse(body);
    return this.extraction.updateManual(
      user,
      orgId,
      projectId,
      requirementKey,
      body,
    );
  }

  @Delete(':projectId/extracted-requirements/:requirementKey')
  deleteExtractedRequirement(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('requirementKey') requirementKey: string,
  ) {
    return this.extraction.deleteManual(
      user,
      orgId,
      projectId,
      requirementKey,
    );
  }

  @Post(':projectId/clear-requirements')
  clearRequirements(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.extraction.clearAllRequirements(user, orgId, projectId);
  }

  @Get(':projectId/extracted-requirements')
  listExtracted(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.extraction.list(user.id, orgId, projectId);
  }

  @Get(':projectId/extracted-requirements/export')
  exportExtracted(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Query('format') format: string,
    @Res() res: Response,
  ) {
    return this.extraction.exportRequirements(
      user.id,
      orgId,
      projectId,
      format || 'xlsx',
      res,
    );
  }

  @Get(':projectId/extracted-requirements/:requirementKey')
  getExtracted(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('requirementKey') requirementKey: string,
  ) {
    return this.extraction.getByKey(
      user.id,
      orgId,
      projectId,
      requirementKey,
    );
  }

  @Get(':projectId/extraction-debug')
  extractionDebug(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.extraction.getExtractionDebug(user.id, orgId, projectId);
  }

  @Post(':projectId/review-requirements')
  reviewRequirements(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.review.reviewAll(user, orgId, projectId);
  }

  @Post(':projectId/extracted-requirements/:requirementKey/review')
  reviewOne(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('requirementKey') requirementKey: string,
  ) {
    return this.review.reviewOne(user, orgId, projectId, requirementKey);
  }

  @Get(':projectId/review-summary')
  reviewSummary(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.review.getSummary(user.id, orgId, projectId);
  }

  @Get(':projectId/stlc-handoff')
  stlcHandoff(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.review.getStlcHandoff(user.id, orgId, projectId);
  }

  @Post(':projectId/approve-requirements')
  approveRequirements(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.review.approveRequirements(user, orgId, projectId);
  }

  @Get(':projectId/review-questions')
  reviewQuestions(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.review.listQuestions(user.id, orgId, projectId);
  }

  @Post(':projectId/review-questions/:questionId/answer')
  answerReviewQuestion(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('questionId') questionId: string,
    @Body() body: unknown,
  ) {
    const parsed = answerReviewQuestionSchema.parse(body);
    return this.review.answerQuestion(
      user,
      orgId,
      projectId,
      questionId,
      parsed.answer,
    );
  }

  @Get(':projectId/review-conflicts')
  reviewConflicts(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.review.listConflicts(user.id, orgId, projectId);
  }

  @Get(':projectId/review-features')
  reviewFeatures(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.review.listFeatures(user.id, orgId, projectId);
  }

  @Post(':projectId/extracted-requirements/:requirementKey/duplicate-decision')
  resolveDuplicate(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('requirementKey') requirementKey: string,
    @Body() body: { decision?: string },
  ) {
    const decision = body?.decision;
    if (
      decision !== 'keep_both' &&
      decision !== 'mark_not_duplicate' &&
      decision !== 'merge'
    ) {
      throw new BadRequestException(
        'decision must be keep_both | mark_not_duplicate | merge',
      );
    }
    return this.review.resolveDuplicateDecision(
      user,
      orgId,
      projectId,
      requirementKey,
      decision,
    );
  }

  @Get(':projectId/review-relations')
  reviewRelations(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.review.listRelations(user.id, orgId, projectId);
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
