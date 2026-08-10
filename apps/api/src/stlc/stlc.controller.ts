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
import { StlcService } from './stlc.service';

@Controller()
@UseGuards(SessionAuthGuard)
export class StlcController {
  constructor(private readonly stlc: StlcService) {}

  @Get('stlc/phases')
  catalog() {
    return this.stlc.catalog();
  }

  @Get('orgs/:orgId/projects/:projectId/stlc/phases')
  listPhases(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.stlc.listPhases(user, orgId, projectId);
  }

  @Get('orgs/:orgId/projects/:projectId/stlc/phases/:phaseId')
  getPhase(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('phaseId') phaseId: string,
  ) {
    return this.stlc.getPhase(user, orgId, projectId, phaseId);
  }

  @Patch('orgs/:orgId/projects/:projectId/stlc/phases/:phaseId/document')
  patchDocument(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('phaseId') phaseId: string,
    @Body() body: { document?: Record<string, unknown>; documentVersion?: number },
  ) {
    return this.stlc.patchDocument(user, orgId, projectId, phaseId, body);
  }

  @Post('orgs/:orgId/projects/:projectId/stlc/phases/:phaseId/accept')
  acceptPhase(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('phaseId') phaseId: string,
  ) {
    return this.stlc.acceptPhase(user, orgId, projectId, phaseId);
  }

  @Get('orgs/:orgId/projects/:projectId/stlc/phases/:phaseId/download')
  downloadPhase(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('phaseId') phaseId: string,
    @Query('format') format: string | undefined,
    @Res() res: Response,
  ) {
    return this.stlc.downloadPhase(
      user,
      orgId,
      projectId,
      phaseId,
      format ?? 'json',
      res,
    );
  }

  @Post('orgs/:orgId/projects/:projectId/stlc/cycles')
  startNextCycle(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.stlc.startNextCycle(user, orgId, projectId);
  }
}
