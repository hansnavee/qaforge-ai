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
import { ProjectsService } from './projects.service';
import { RequirementExtractionService } from './requirement-extraction.service';
import { RequirementReviewService } from './requirement-review.service';
import { answerReviewQuestionSchema } from '@qaforge/shared';

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

  @Get(':projectId/extracted-requirements')
  listExtracted(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.extraction.list(user.id, orgId, projectId);
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
