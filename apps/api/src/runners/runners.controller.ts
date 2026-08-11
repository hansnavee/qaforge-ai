import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorator';
import { SessionAuthGuard } from '../auth/auth.guard';
import type { SessionUser } from '../auth/auth';
import { RunnersService } from './runners.service';

@Controller('orgs/:orgId/runners')
@UseGuards(SessionAuthGuard)
export class RunnersController {
  constructor(private readonly runners: RunnersService) {}

  @Get('status')
  status(@CurrentUser() user: SessionUser, @Param('orgId') orgId: string) {
    return this.runners.status(user.id, orgId);
  }

  @Post()
  create(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Body() body: { name?: string },
  ) {
    return this.runners.createToken(user.id, orgId, body?.name);
  }
}
