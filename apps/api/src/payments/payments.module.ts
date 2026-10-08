import { Module, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PAYMENT_GATEWAY } from './gateways/payment-gateway.interface.js';
import { MomoGateway } from './gateways/momo.gateway.js';
import { MockPaymentGateway } from './gateways/mock.gateway.js';
import { AccountantNotifier } from './accountant-notifier.js';
import { PaymentsService } from './payments.service.js';
import { PaymentsController } from './payments.controller.js';
import {
  MockGatewayController,
  MockGatewayEnabledGuard,
} from './mock-gateway.controller.js';
import { MockGatewayService } from './mock-gateway.service.js';

import { OrdersModule } from '../orders/orders.module.js';

export const paymentGatewayProvider: Provider = {
  provide: PAYMENT_GATEWAY,
  useFactory: (
    config: ConfigService,
    momoGateway: MomoGateway,
    mockGateway: MockPaymentGateway,
  ) => {
    const gatewayType = config
      .get<string>('PAYMENT_GATEWAY', 'momo')
      .toLowerCase();
    if (gatewayType === 'mock') {
      return mockGateway;
    }
    return momoGateway;
  },
  inject: [ConfigService, MomoGateway, MockPaymentGateway],
};

@Module({
  imports: [PrismaModule, ConfigModule, OrdersModule],
  controllers: [PaymentsController, MockGatewayController],
  providers: [
    MomoGateway,
    MockPaymentGateway,
    paymentGatewayProvider,
    AccountantNotifier,
    PaymentsService,
    MockGatewayService,
    MockGatewayEnabledGuard,
  ],
  exports: [
    PaymentsService,
    PAYMENT_GATEWAY,
    AccountantNotifier,
    MockPaymentGateway,
    MockGatewayService,
  ],
})
export class PaymentsModule {}
