import {
  Controller,
  Get,
  Param,
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

  @Get('download-zip')
  async downloadZip(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('executionId') executionId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.artifacts.downloadZip(user.id, orgId, executionId, res);
    if (result && typeof result === 'object' && 'url' in result) {
      return result;
    }
    return result;
  }
}
