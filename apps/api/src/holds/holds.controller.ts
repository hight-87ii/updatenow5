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

@Controller('showtimes/:id/holds')
@Roles('BUYER')
export class HoldsController {
  constructor(private readonly service: HoldsService) {}
  @Post()
  @HttpCode(200)
  @UseGuards(WaitingAdmissionGuard)
  claim(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    return this.service.claim(
      id,
      req.user.id,
      req.sessionHash ?? hashSessionToken(req.sessionToken),
      body,
      req.holdClient,
    );
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
