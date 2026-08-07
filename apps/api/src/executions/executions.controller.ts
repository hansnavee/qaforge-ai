import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorator';
import { SessionAuthGuard } from '../auth/auth.guard';
import type { SessionUser } from '../auth/auth';
import { ExecutionsService } from './executions.service';

@Controller()
@UseGuards(SessionAuthGuard)
export class ExecutionsController {
  constructor(private readonly executions: ExecutionsService) {}

  @Post('orgs/:orgId/projects/:projectId/executions')
  create(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.executions.create(user, orgId, projectId);
  }

  @Get('orgs/:orgId/projects/:projectId/executions')
  listForProject(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.executions.listForProject(user.id, orgId, projectId);
  }

  @Get('orgs/:orgId/executions/:executionId')
  get(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('executionId') executionId: string,
  ) {
    return this.executions.get(user.id, orgId, executionId);
  }

  @Post('orgs/:orgId/executions/:executionId/clarify')
  clarify(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('executionId') executionId: string,
    @Body() body: unknown,
  ) {
    return this.executions.clarify(user, orgId, executionId, body);
  }

  @Post('orgs/:orgId/executions/:executionId/continue-after-login')
  continueAfterLogin(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('executionId') executionId: string,
  ) {
    return this.executions.continueAfterLogin(user, orgId, executionId);
  }

  @Get('orgs/:orgId/executions/:executionId/events')
  events(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('executionId') executionId: string,
    @Query('after') after?: string,
  ) {
    return this.executions.getEvents(user.id, orgId, executionId, after);
  }
}
