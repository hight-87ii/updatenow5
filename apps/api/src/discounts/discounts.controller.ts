import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/guards/session-auth.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { DiscountCodesService } from './discounts.service.js';

@Controller('events/:eventId/discount-codes')
export class DiscountCodesController {
  constructor(private readonly service: DiscountCodesService) {}

  @Post()
  @Roles('ORGANIZER')
  @HttpCode(201)
  create(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: {
      code: string;
      type: 'PERCENTAGE' | 'FIXED_AMOUNT';
      value: number;
      maxUses: number;
      validFrom: string;
      validTo: string;
    },
  ) {
    return this.service.create(eventId, req.user.id, {
      ...body,
      validFrom: new Date(body.validFrom),
      validTo: new Date(body.validTo),
    });
  }

  @Get()
  @Roles('ORGANIZER')
  findAll(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.findByEvent(eventId, req.user.id);
  }

  @Get(':id')
  @Roles('ORGANIZER')
  findOne(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.findOne(eventId, id, req.user.id);
  }

  @Patch(':id')
  @Roles('ORGANIZER')
  update(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: {
      code?: string;
      type?: 'PERCENTAGE' | 'FIXED_AMOUNT';
      value?: number;
      maxUses?: number;
      validFrom?: string;
      validTo?: string;
    },
  ) {
    const updateData: {
      code?: string;
      type?: 'PERCENTAGE' | 'FIXED_AMOUNT';
      value?: number;
      maxUses?: number;
      validFrom?: Date;
      validTo?: Date;
    } = {};
    if (body.code !== undefined) updateData.code = body.code;
    if (body.type !== undefined) updateData.type = body.type;
    if (body.value !== undefined) updateData.value = body.value;
    if (body.maxUses !== undefined) updateData.maxUses = body.maxUses;
    if (body.validFrom !== undefined) updateData.validFrom = new Date(body.validFrom);
    if (body.validTo !== undefined) updateData.validTo = new Date(body.validTo);
    return this.service.update(eventId, id, req.user.id, updateData);
  }

  @Delete(':id')
  @Roles('ORGANIZER')
  @HttpCode(204)
  delete(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.delete(eventId, id, req.user.id);
  }
}

@Controller('orders')
export class OrderDiscountController {
  constructor(private readonly service: DiscountCodesService) {}

  @Post(':id/discount')
  @Roles('BUYER')
  @HttpCode(200)
  applyDiscount(
    @Param('id', ParseUUIDPipe) orderId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: { code: string },
  ) {
    return this.service.applyToOrder(orderId, req.user.id, body.code);
  }

  @Delete(':id/discount')
  @Roles('BUYER')
  @HttpCode(204)
  removeDiscount(
    @Param('id', ParseUUIDPipe) orderId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.removeFromOrder(orderId, req.user.id);
  }
}

@Controller('showtimes')
export class ShowtimeDiscountController {
  constructor(private readonly service: DiscountCodesService) {}

  @Get(':id/discount/validate')
  @HttpCode(200)
  validateDiscount(
    @Param('id', ParseUUIDPipe) showtimeId: string,
    @Req() req: { query: { code?: string } },
  ) {
    const code = req.query.code;
    if (!code || typeof code !== 'string') {
      return { valid: false, error: 'Thiếu mã giảm giá.' };
    }
    return this.service.validateForShowtime(showtimeId, code);
  }
}