import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorator';
import { SessionAuthGuard } from '../auth/auth.guard';
import type { SessionUser } from '../auth/auth';
import { GithubService } from './github.service';

@Controller()
@UseGuards(SessionAuthGuard)
export class GithubController {
  constructor(private readonly github: GithubService) {}

  @Get('orgs/:orgId/github/status')
  status(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
  ) {
    return this.github.status(user.id, orgId);
  }

  @Post('orgs/:orgId/github/connect')
  connect(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Body() body: { accessToken: string; login: string },
  ) {
    return this.github.connect(user, orgId, body);
  }

  @Post('orgs/:orgId/executions/:executionId/github/push')
  push(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('executionId') executionId: string,
    @Body()
    body: { repoFullName: string; createRepo?: boolean; branch?: string },
  ) {
    return this.github.push(user, orgId, executionId, body);
  }
}
