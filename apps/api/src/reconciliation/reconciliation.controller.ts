import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { AuthenticatedRequest } from '../auth/guards/session-auth.guard.js';
import { ReconciliationService } from './reconciliation.service.js';

@Controller('accounting/reconciliations')
@Roles('ACCOUNTANT')
export class ReconciliationController {
  constructor(private readonly service: ReconciliationService) {}
  @Post() create(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.service.create(req.user.id, body);
  }
  @Get() list() { return this.service.list(); }
  @Get(':id') detail(@Param('id', ParseUUIDPipe) id: string) { return this.service.detail(id); }
}
