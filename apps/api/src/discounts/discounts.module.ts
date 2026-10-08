import { Module } from '@nestjs/common';
import { DiscountCodesService } from './discounts.service.js';
import { DiscountCodesController, OrderDiscountController, ShowtimeDiscountController } from './discounts.controller.js';

@Module({
  controllers: [DiscountCodesController, OrderDiscountController, ShowtimeDiscountController],
  providers: [DiscountCodesService],
  exports: [DiscountCodesService],
})
export class DiscountsModule {}