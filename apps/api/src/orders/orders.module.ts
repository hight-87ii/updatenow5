import { Module } from '@nestjs/common';
import {
  OrdersController,
  ShowtimeOrdersController,
} from './orders.controller.js';
import { OrdersService } from './orders.service.js';

@Module({
  controllers: [OrdersController, ShowtimeOrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
