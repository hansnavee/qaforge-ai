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
import { OrgsService } from './orgs.service';

@Controller('orgs')
@UseGuards(SessionAuthGuard)
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  @Post()
  create(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    return this.orgs.create(user, body);
  }

  @Get()
  list(@CurrentUser() user: SessionUser) {
    return this.orgs.listForUser(user.id);
  }

  @Get(':orgId')
  get(@CurrentUser() user: SessionUser, @Param('orgId') orgId: string) {
    return this.orgs.getById(user.id, orgId);
  }

  @Post(':orgId/members')
  addMember(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Body() body: { email: string; role: string },
  ) {
    return this.orgs.addMember(user, orgId, body);
  }
}
