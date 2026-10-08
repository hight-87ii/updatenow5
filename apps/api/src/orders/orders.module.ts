import { Module } from '@nestjs/common';
import {
  OrdersController,
  ShowtimeOrdersController,
} from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { OrderExpiryScheduler } from './order-expiry.scheduler.js';

@Module({
  controllers: [OrdersController, ShowtimeOrdersController],
  providers: [OrdersService, OrderExpiryScheduler],
  exports: [OrdersService, OrderExpiryScheduler],
})
export class OrdersModule {}

