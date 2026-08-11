import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentRunner, RunnerAuthGuard } from './runner-auth.guard';
import { RunnersService, type RunnerPrincipal } from './runners.service';

@Controller('runners')
@UseGuards(RunnerAuthGuard)
export class RunnerJobsController {
  constructor(private readonly runners: RunnersService) {}

  @Post('heartbeat')
  heartbeat(
    @CurrentRunner() runner: RunnerPrincipal,
    @Body() body: unknown,
  ) {
    return this.runners.heartbeat(runner, body);
  }

  @Get('jobs/next')
  nextJob(@CurrentRunner() runner: RunnerPrincipal) {
    return this.runners.claimNext(runner);
  }

  @Post('jobs/:executionId/events')
  events(
    @CurrentRunner() runner: RunnerPrincipal,
    @Param('executionId') executionId: string,
    @Body() body: unknown,
  ) {
    return this.runners.recordCaseEvent(runner, executionId, body);
  }

  @Post('jobs/:executionId/complete')
  complete(
    @CurrentRunner() runner: RunnerPrincipal,
    @Param('executionId') executionId: string,
    @Body() body: unknown,
  ) {
    return this.runners.completeJob(runner, executionId, body);
  }
}
