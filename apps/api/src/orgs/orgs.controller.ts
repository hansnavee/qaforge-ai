import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
    @Body() body: unknown,
  ) {
    return this.orgs.addMember(user, orgId, body);
  }

  @Patch(':orgId/members/:membershipId')
  updateMember(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('membershipId') membershipId: string,
    @Body() body: unknown,
  ) {
    return this.orgs.updateMember(user, orgId, membershipId, body);
  }

  @Delete(':orgId/members/:membershipId')
  removeMember(
    @CurrentUser() user: SessionUser,
    @Param('orgId') orgId: string,
    @Param('membershipId') membershipId: string,
  ) {
    return this.orgs.removeMember(user, orgId, membershipId);
  }
}
