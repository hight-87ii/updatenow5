import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { hashSessionToken } from '../auth/auth.service.js';
import type { AuthenticatedRequest } from '../auth/guards/session-auth.guard.js';
import { HoldsService } from './holds.service.js';
import { UseGuards } from '@nestjs/common';
import { WaitingAdmissionGuard } from '../waiting/waiting.guard.js';
import { WaitingService } from '../waiting/waiting.service.js';

@Controller('showtimes/:id/holds')
@Roles('BUYER')
export class HoldsController {
  constructor(
    private readonly service: HoldsService,
    private readonly waiting: WaitingService,
  ) {}
  @Post()
  @HttpCode(200)
  @UseGuards(WaitingAdmissionGuard)
  async claim(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    const state = await this.service.claim(
      id,
      req.user.id,
      req.sessionHash ?? hashSessionToken(req.sessionToken),
      body,
      req.holdClient,
    );
    // S-40b: a confirmed hold proves activity — extend the admission turn.
    // Touch never fails the hold response; a lost turn is reported via status.
    await this.waiting.touch(
      id,
      this.waiting.memberKey(
        req.user.id,
        req.sessionHash ?? hashSessionToken(req.sessionToken),
      ),
    );
    return state;
  }
  @Get()
  current(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.current(
      id,
      req.user.id,
      req.sessionHash ?? hashSessionToken(req.sessionToken),
    );
  }
}
