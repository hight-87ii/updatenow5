import {
  Body,
  Controller,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Roles, Public } from '../auth/decorators/roles.decorator.js';
import type { AuthenticatedRequest } from '../auth/guards/session-auth.guard.js';
import { PaymentsService } from './payments.service.js';

@Controller()
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('orders/:id/pay')
  @Roles('BUYER')
  @HttpCode(200)
  initiatePayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @Body() body?: { returnUrl?: string },
  ) {
    return this.paymentsService.initiatePayment(id, req.user.id, body?.returnUrl);
  }

  @Post('payments/webhook')
  @Public()
  @HttpCode(200)
  handleWebhook(
    @Body() body: unknown,
    @Req() req: Request,
    @Ip() ip: string,
  ) {
    const clientIp = (req.headers['x-forwarded-for'] as string) || ip;
    const rawPayload = (req as any).rawBody ?? body;
    return this.paymentsService.handleWebhook(rawPayload, req.headers, clientIp);
  }
}
