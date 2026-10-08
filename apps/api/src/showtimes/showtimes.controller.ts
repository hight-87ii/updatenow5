import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Public, Roles } from '../auth/decorators/roles.decorator.js';
import type { AuthenticatedRequest } from '../auth/guards/session-auth.guard.js';
import { ShowtimesService } from './showtimes.service.js';
import { validateSeatMap } from './seat-map.js';
@Controller('showtimes')
export class ShowtimesController {
  constructor(private readonly service: ShowtimesService) {}
  @Public() @Get() list(@Query('cursor') cursor?: string) {
    return this.service.list(cursor);
  }
  @Roles('ORGANIZER') @Post('validate-map') validate(@Body() body: unknown) {
    return { errors: validateSeatMap(body) };
  }
  @Roles('ORGANIZER') @Get(':id/manage') manage(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.manage(id, req.user.id);
  }
  @Roles('ORGANIZER') @Post(':id/seat-map') import(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    return this.service.importMap(id, req.user.id, body);
  }
  @Roles('ORGANIZER') @Patch(':id/prices') prices(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    return this.service.prices(id, req.user.id, body);
  }
  @Roles('ORGANIZER') @Patch(':id/ticket-limit') ticketLimit(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    return this.service.ticketLimit(id, req.user.id, body);
  }
  @Roles('ORGANIZER') @Patch(':id/status') status(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    return this.service.status(id, req.user.id, body);
  }
  @Public() @Get(':id/seats') seats(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.publicSeats(id);
  }
  @Roles('ORGANIZER') @Get(':id/manage/seats') ownedSeats(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.ownedSeats(id, req.user.id);
  }
  @Public() @Get(':id') detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.detail(id);
  }
}
