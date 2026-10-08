import { Module } from '@nestjs/common';
import { HoldsService } from './holds.service.js';
import { HoldsController } from './holds.controller.js';
import { HoldExpiryScheduler } from './hold-expiry.scheduler.js';
import { WaitingModule } from '../waiting/waiting.module.js';
@Module({
  imports: [WaitingModule],
  controllers: [HoldsController],
  providers: [HoldsService, HoldExpiryScheduler],
  exports: [HoldsService],
})
export class HoldsModule {}
