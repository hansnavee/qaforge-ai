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

  @Post('orgs/:orgId/executions/:executionId/approve-test-plan')
  approveTestPlan(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('executionId') executionId: string,
  ) {
    return this.executions.approveTestPlan(user, orgId, executionId);
  }

  @Post('orgs/:orgId/executions/:executionId/approve-test-design')
  approveTestDesign(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('executionId') executionId: string,
  ) {
    return this.executions.approveTestDesign(user, orgId, executionId);
  }

  @Post('orgs/:orgId/executions/:executionId/approve-environment')
  approveEnvironment(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('executionId') executionId: string,
  ) {
    return this.executions.approveEnvironment(user, orgId, executionId);
  }

  @Post('orgs/:orgId/executions/:executionId/approve-test-data')
  approveTestData(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('executionId') executionId: string,
    @Body() body: unknown,
  ) {
    return this.executions.approveTestData(user, orgId, executionId, body);
  }

  @Post('orgs/:orgId/executions/:executionId/approve-test-execution')
  approveTestExecution(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('executionId') executionId: string,
  ) {
    return this.executions.approveTestExecution(user, orgId, executionId);
  }

  @Post('orgs/:orgId/executions/:executionId/approve-defects')
  approveDefects(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('executionId') executionId: string,
  ) {
    return this.executions.approveDefects(user, orgId, executionId);
  }

  @Post('orgs/:orgId/executions/:executionId/approve-regression')
  approveRegression(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('executionId') executionId: string,
  ) {
    return this.executions.approveRegression(user, orgId, executionId);
  }

  @Post('orgs/:orgId/executions/:executionId/approve-automation')
  approveAutomation(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('executionId') executionId: string,
  ) {
    return this.executions.approveAutomation(user, orgId, executionId);
  }

  @Post('orgs/:orgId/executions/:executionId/approve-report')
  approveReport(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('executionId') executionId: string,
  ) {
    return this.executions.approveReport(user, orgId, executionId);
  }

  @Post('orgs/:orgId/executions/:executionId/approve-qa-signoff')
  approveQaSignoff(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('executionId') executionId: string,
  ) {
    return this.executions.approveQaSignoff(user, orgId, executionId);
  }

  @Post('orgs/:orgId/executions/:executionId/continue-after-login')
  continueAfterLogin(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('executionId') executionId: string,
  ) {
    return this.executions.continueAfterLogin(user, orgId, executionId);
  }

  @Post('orgs/:orgId/executions/:executionId/cancel')
  cancel(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('executionId') executionId: string,
  ) {
    return this.executions.cancel(user, orgId, executionId);
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
