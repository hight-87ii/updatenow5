import { Module } from '@nestjs/common';
import {
  OrdersController,
  ShowtimeOrdersController,
} from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { WaitingModule } from '../waiting/waiting.module.js';

@Module({
  imports: [WaitingModule],
  controllers: [OrdersController, ShowtimeOrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
