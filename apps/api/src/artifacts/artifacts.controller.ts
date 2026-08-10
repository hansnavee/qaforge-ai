import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/auth.decorator';
import { SessionAuthGuard } from '../auth/auth.guard';
import type { SessionUser } from '../auth/auth';
import { ArtifactsService } from './artifacts.service';

@Controller('orgs/:orgId/executions/:executionId')
@UseGuards(SessionAuthGuard)
export class ArtifactsController {
  constructor(private readonly artifacts: ArtifactsService) {}

  @Get('artifacts')
  list(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('executionId') executionId: string,
  ) {
    return this.artifacts.list(user.id, orgId, executionId);
  }

  @Get('artifacts/by-key')
  async getByKey(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('executionId') executionId: string,
    @Query('key') key: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.artifacts.getByStorageKey(
      user.id,
      orgId,
      executionId,
      decodeURIComponent(key || ''),
      res,
    );
  }

  @Get('artifacts/by-type/:type')
  async getByType(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('executionId') executionId: string,
    @Param('type') type: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.artifacts.downloadByType(
      user.id,
      orgId,
      executionId,
      type,
      res,
    );
  }

  @Get('download-zip')
  async downloadZip(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('executionId') executionId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.artifacts.downloadZip(user.id, orgId, executionId, res);
  }
}
