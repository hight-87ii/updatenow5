import { Controller, Delete, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { hashSessionToken } from '../auth/auth.service.js';
import type { AuthenticatedRequest } from '../auth/guards/session-auth.guard.js';
import { WaitingService } from './waiting.service.js';

@Controller('showtimes/:id/waiting')
@Roles('BUYER')
export class WaitingController {
  constructor(private readonly waiting: WaitingService) {}

  private member(req: AuthenticatedRequest): string {
    const hash = req.sessionHash ?? hashSessionToken(req.sessionToken);
    return this.waiting.memberKey(req.user.id, hash);
  }

  @Post()
  join(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthenticatedRequest) {
    return this.waiting.join(id, this.member(req));
  }

  @Get()
  status(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthenticatedRequest) {
    return this.waiting.status(id, this.member(req));
  }

  @Delete()
  leave(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthenticatedRequest) {
    return this.waiting.leave(id, this.member(req));
  }
}
